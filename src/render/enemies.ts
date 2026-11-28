import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENEMIES, getEnemy, ELITE_MODIFIERS } from '../content/enemies';
import type { EnemyState, GameState, SimEvent } from '../sim/state';
import { phaseAttackProgress, type CreaturePoseInput } from './anim';
import { createCultistRig } from './cultistModel';
import { disposeMeshTree } from './dispose';
import { scoreTarget, TargetProjection } from './targeting';
import { createHuskRig } from './huskModel';
import { createSkittererRig } from './skittererModel';
import type { TerrainSurface } from './terrainSurface';

interface CreatureModel {
  root: THREE.Group;
  flashMaterials: THREE.MeshStandardMaterial[];
  pose(input: CreaturePoseInput): void;
}

interface EnemyView {
  model: CreatureModel;
  /** One-draw silhouette used while the enemy is far from the hero. */
  far: THREE.Mesh;
  /** Small modifier-colored ring under a far elite silhouette. */
  farElite: THREE.Mesh | null;
  hitTime: number;
  flash: number;
  facing: number;
  eliteRing: THREE.Mesh | null;
}

const HIT_DURATION = 0.26;
const DEATH_DURATION = 1.4;
const MAX_BARS = 64;
const MAX_BLOBS = 96;
/** Detailed jointed rigs are only worth their draw calls up close. */
const DETAIL_RANGE = 16;
/** Hard cap on jointed rigs: silhouettes cover the rest without a call spike. */
const MAX_DETAILED = 8;
/** Damaged health bars stay readable slightly beyond the detailed range. */
const BAR_RANGE = 19;
const BODY_HEIGHT: Record<EnemyState['defId'], number> = {
  'ashen-husk': 1.62,
  'cinder-cultist': 1.85,
  'mire-skitterer': 1.02,
  'ashen-warden': 2.9,
};

/** Soft radial blob used as a cheap contact shadow for enemy rigs. */
function createBlobTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** Give a primitive a flat vertex color so many parts can share one draw call. */
function colorized(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  if (geo !== geometry) geometry.dispose();
  const count = geo.getAttribute('position').count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Merged silhouette for each archetype: one unlit, vertex-colored draw call
 * with glowing eyes. Cheap enough to keep every distant enemy on screen.
 */
function farSilhouette(defId: EnemyState['defId'], color: number, eyeColor: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (
    geometry: THREE.BufferGeometry,
    partColor: number,
    x: number,
    y: number,
    z: number,
    rotZ = 0,
  ): void => {
    geometry.rotateZ(rotZ);
    geometry.translate(x, y, z);
    parts.push(colorized(geometry, partColor));
  };

  if (defId === 'cinder-cultist') {
    add(new THREE.ConeGeometry(0.38, 1.35, 8), color, 0, 0.68, 0);
    add(new THREE.SphereGeometry(0.16, 8, 6), color, 0, 1.5, 0.02);
    add(new THREE.CylinderGeometry(0.025, 0.025, 1.55, 5), 0x4d3a24, 0.32, 0.95, 0.06);
    add(new THREE.SphereGeometry(0.035, 6, 5), eyeColor, -0.06, 1.52, 0.16);
    add(new THREE.SphereGeometry(0.035, 6, 5), eyeColor, 0.06, 1.52, 0.16);
  } else if (defId === 'mire-skitterer') {
    const body = new THREE.SphereGeometry(0.36, 10, 7);
    body.scale(1, 0.62, 1.35);
    add(body, color, 0, 0.5, 0);
    add(new THREE.SphereGeometry(0.2, 8, 6), color, 0, 0.56, 0.42);
    for (const side of [-1, 1]) {
      for (const front of [-1, 1]) {
        add(new THREE.CapsuleGeometry(0.035, 0.32, 2, 5), color, side * 0.28, 0.22, front * 0.18, side * 0.7);
      }
    }
    add(new THREE.SphereGeometry(0.035, 6, 5), eyeColor, -0.09, 0.62, 0.58);
    add(new THREE.SphereGeometry(0.035, 6, 5), eyeColor, 0.09, 0.62, 0.58);
  } else {
    add(new THREE.CapsuleGeometry(0.23, 0.55, 3, 8), color, 0, 1.02, 0);
    add(new THREE.SphereGeometry(0.17, 9, 7), color, 0, 1.55, 0.06);
    for (const side of [-1, 1]) {
      add(new THREE.CapsuleGeometry(0.062, 0.56, 2, 6), color, side * 0.31, 1.0, 0, side * 0.22);
      add(new THREE.CapsuleGeometry(0.075, 0.42, 2, 6), color, side * 0.13, 0.38, 0);
      add(new THREE.SphereGeometry(0.036, 6, 5), eyeColor, side * 0.065, 1.56, 0.19);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? new THREE.SphereGeometry(0.35, 8, 6);
}

/**
 * Enemy views: one jointed rig per sim entity (husk / cultist / skitterer),
 * posed each frame from authoritative state — locomotion speed, facing,
 * phase-driven strike progress, deadTime — plus timed hit flinches.
 * Elites get a modifier-colored aura ring. Health bars billboard to camera.
 */
export class EnemyViews {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, EnemyView>();
  private readonly targetProjection = new TargetProjection();
  private readonly farGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly farMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  private readonly detailedIds = new Set<string>();
  private readonly barBg: THREE.InstancedMesh;
  private readonly barFill: THREE.InstancedMesh;
  private readonly blob: THREE.InstancedMesh;
  private readonly barMatrix = new THREE.Matrix4();
  private readonly barPos = new THREE.Vector3();
  private readonly barScale = new THREE.Vector3();
  private readonly barOffset = new THREE.Vector3();
  private readonly barQuat = new THREE.Quaternion();
  private readonly barNormal = new THREE.Vector3();
  private readonly barRight = new THREE.Vector3();
  private readonly blobMatrix = new THREE.Matrix4();
  private readonly blobPosition = new THREE.Vector3();
  private readonly blobQuaternion = new THREE.Quaternion();
  private readonly blobScale = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projectionScreen = new THREE.Matrix4();
  private readonly boundingSphere = new THREE.Sphere();
  private readonly sphereCenter = new THREE.Vector3();
  private highlightedId: string | null = null;
  /** Live boss id, tracked from authoritative state for probeBoss(). */
  private bossId: string | null = null;

  constructor(scene: THREE.Scene, private readonly terrain: TerrainSurface) {
    scene.add(this.group);
    const barGeometry = new THREE.PlaneGeometry(1, 1);
    this.barBg = new THREE.InstancedMesh(
      barGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x120d0c,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
      }),
      MAX_BARS,
    );
    this.barFill = new THREE.InstancedMesh(
      barGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xc23c2e,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
      MAX_BARS,
    );
    this.barBg.renderOrder = 10;
    this.barFill.renderOrder = 11;
    for (const mesh of [this.barBg, this.barFill]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }

    const blobGeometry = new THREE.CircleGeometry(1, 20);
    blobGeometry.rotateX(-Math.PI / 2);
    this.blob = new THREE.InstancedMesh(
      blobGeometry,
      new THREE.MeshBasicMaterial({
        map: createBlobTexture(),
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
      MAX_BLOBS,
    );
    this.blob.count = 0;
    this.blob.frustumCulled = false;
    this.blob.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.blob);

    // Build all silhouettes once so the first distant archetype never hitches
    // and the GPU resource count is stable across run/quit cycles.
    for (const def of ENEMIES) this.farGeometryFor(def.id);
  }

  pick(state: GameState, camera: THREE.Camera, width: number, height: number, x: number, y: number):
    { id: string; point: THREE.Vector3; radius: number } | null {
    let best: { id: string; point: THREE.Vector3; radius: number } | null = null;
    let bestScore = Infinity;
    let bestDepth = Infinity;
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      const view = this.views.get(enemy.id);
      if (!view) continue;
      const origin = view.model.root.position;
      const area = this.targetProjection.project(camera, width, height, origin, BODY_HEIGHT[enemy.defId], enemy.radius);
      if (!area) continue;
      const score = scoreTarget(area, x, y, enemy.id === this.highlightedId);
      if (!Number.isFinite(score)) continue;
      if (score < bestScore - 0.025 || (Math.abs(score - bestScore) <= 0.025 && area.depth < bestDepth)) {
        best = { id: enemy.id, point: origin, radius: enemy.radius };
        bestScore = score;
        bestDepth = area.depth;
      }
    }
    return best;
  }

  setHighlight(enemyId: string | null): void {
    this.highlightedId = enemyId;
  }

  /** Number of enemies currently using their full jointed rig (QA budget probe). */
  get detailedCount(): number {
    return this.detailedIds.size;
  }

  /** Health bars currently submitted (QA readability/budget probe). */
  get visibleBars(): number {
    return this.barBg.count;
  }

  clear(): void {
    for (const view of this.views.values()) {
      disposeMeshTree(view.model.root);
      if (view.farElite) disposeMeshTree(view.farElite);
      view.far.removeFromParent();
    }
    this.views.clear();
    this.highlightedId = null;
    this.bossId = null;
    this.barBg.count = 0;
    this.barFill.count = 0;
    this.blob.count = 0;
  }

  /** Consume authoritative events: damage -> hit flinch + flash. */
  handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind !== 'damage' || ev.targetKind !== 'enemy') continue;
      const view = this.views.get(ev.targetId);
      if (view) {
        view.hitTime = HIT_DURATION;
        view.flash = 1;
      }
    }
  }

  sync(state: GameState, dt: number, alpha: number, camera: THREE.Camera): void {
    for (const [id, view] of this.views) {
      if (!state.enemies.some((e) => e.id === id)) {
        disposeMeshTree(view.model.root);
        if (view.farElite) disposeMeshTree(view.farElite);
        view.far.removeFromParent();
        this.views.delete(id);
      }
    }

    camera.updateMatrixWorld();
    this.projectionScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionScreen);

    // Detail budget: on-screen rigs near the hero get jointed animation;
    // everyone else keeps a one-call silhouette (the boss always keeps its rig).
    this.detailedIds.clear();
    const candidates = state.enemies
      .map((enemy) => ({
        id: enemy.id,
        defId: enemy.defId,
        distance: Math.hypot(
          enemy.position.x - state.player.position.x,
          enemy.position.z - state.player.position.z,
        ),
        visible: this.isOnScreen(enemy),
      }))
      .filter((candidate) =>
        candidate.defId === 'ashen-warden' || (candidate.distance <= DETAIL_RANGE && candidate.visible))
      .sort((a, b) => a.distance - b.distance);
    for (const candidate of candidates.slice(0, MAX_DETAILED)) this.detailedIds.add(candidate.id);

    for (const enemy of state.enemies) {
      let view = this.views.get(enemy.id);
      if (!view) {
        view = this.createView(enemy);
        this.views.set(enemy.id, view);
        this.group.add(view.model.root);
      }
      this.updateView(view, enemy, dt, alpha);
    }
    this.updateBars(state, camera);
    this.updateBlobs(state);
    this.bossId = state.enemies.find((enemy) => enemy.defId === 'ashen-warden' && !enemy.dead)?.id ?? null;
  }

  /**
   * QA probe for the live Warden model root. `y` is the root's world height and
   * `height` is the sampled terrain height underneath it; `error` is their
   * absolute difference. Real cast shadows are screenshot-only and not probed.
   */
  probeBoss(): { id: string; y: number; height: number; error: number } | null {
    const id = this.bossId;
    if (!id) return null;
    const view = this.views.get(id);
    if (!view) return null;
    const root = view.model.root.position;
    const height = this.terrain.heightAt(root.x, root.z);
    return { id, y: root.y, height, error: Math.abs(root.y - height) };
  }

  private farGeometryFor(defId: EnemyState['defId']): THREE.BufferGeometry {
    let geometry = this.farGeometries.get(defId);
    if (!geometry) {
      const def = getEnemy(defId);
      geometry = farSilhouette(defId, def.color, def.eyeColor);
      this.farGeometries.set(defId, geometry);
    }
    return geometry;
  }

  private createModel(defId: EnemyState['defId']): CreatureModel {
    const def = getEnemy(defId);
    switch (defId) {
      case 'cinder-cultist':
        return createCultistRig(def);
      case 'mire-skitterer':
        return createSkittererRig(def);
      default:
        return createHuskRig(def);
    }
  }

  private createView(enemy: EnemyState): EnemyView {
    const model = this.createModel(enemy.defId);
    model.root.position.set(enemy.position.x, 0, enemy.position.z);
    // Enemies use one instanced blob shadow instead of a shadow-map pass per
    // limb; the Warden keeps its real cast shadow for presence.
    if (enemy.defId !== 'ashen-warden') {
      model.root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.castShadow = false;
      });
    }

    const far = new THREE.Mesh(this.farGeometryFor(enemy.defId), this.farMaterial);
    far.position.set(enemy.position.x, 0, enemy.position.z);
    far.visible = false;
    this.group.add(far);

    let farElite: THREE.Mesh | null = null;
    if (enemy.elite.length > 0) {
      const mod = ELITE_MODIFIERS[enemy.elite[0]];
      farElite = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.82, 24),
        new THREE.MeshBasicMaterial({
          color: mod.color,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      farElite.rotation.x = -Math.PI / 2;
      farElite.position.y = 0.06;
      far.add(farElite);
    }

    // Elite aura ring on the ground.
    let eliteRing: THREE.Mesh | null = null;
    if (enemy.elite.length > 0) {
      const modColor = ELITE_MODIFIERS[enemy.elite[0]].color;
      eliteRing = new THREE.Mesh(
        new THREE.RingGeometry(0.78, 0.98, 36),
        new THREE.MeshBasicMaterial({
          color: modColor,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      eliteRing.rotation.x = -Math.PI / 2;
      eliteRing.position.y = 0.035;
      model.root.add(eliteRing);
    }

    return { model, far, farElite, hitTime: 0, flash: 0, facing: enemy.facing, eliteRing };
  }

  private updateView(view: EnemyView, enemy: EnemyState, dt: number, alpha: number): void {
    const def = getEnemy(enemy.defId);

    // Interpolate one tick rather than damping: a fast pounce must not lag
    // several body lengths behind its actual contact point.
    const x = THREE.MathUtils.lerp(enemy.previousPosition.x, enemy.position.x, alpha);
    const z = THREE.MathUtils.lerp(enemy.previousPosition.z, enemy.position.z, alpha);
    const groundY = this.terrain.heightAt(x, z);
    view.model.root.position.set(x, groundY, z);
    view.far.position.set(x, groundY, z);

    // Facing: locked during windup/active (the counterplay reads off it),
    // smoothed during chase.
    if (enemy.phase === 'windup' || enemy.phase === 'active') {
      view.facing = enemy.windupFacing;
    } else {
      const diff = Math.atan2(Math.sin(enemy.facing - view.facing), Math.cos(enemy.facing - view.facing));
      view.facing += diff * Math.min(1, 10 * dt);
    }
    view.model.root.rotation.y = view.facing;
    view.far.rotation.y = view.facing;

    const detailed = this.detailedIds.has(enemy.id);
    view.model.root.visible = detailed;
    view.far.visible = !detailed && !enemy.dead;

    view.flash = Math.max(0, view.flash - dt * 4.5);
    if (view.hitTime > 0) view.hitTime = Math.max(0, view.hitTime - dt);

    // Far silhouettes keep only a subtle stride bob; the jointed rig is skipped.
    if (!detailed) {
      if (view.far.visible) {
        const stride = Math.min(1, Math.hypot(enemy.velocity.x, enemy.velocity.z) / Math.max(0.01, enemy.speed));
        view.far.position.y = groundY + Math.abs(Math.sin(enemy.phaseTime * 7)) * 0.045 * stride;
      }
      return;
    }

    // Hit flash + hover tint + a cool chill wash, plus a warm windup ember:
    // normal enemies have no ground tell, so the body itself must telegraph.
    const flash: number = view.flash * view.flash;
    const hover = enemy.id === this.highlightedId ? 1 : 0;
    const chill = enemy.chillTime > 0 ? 1 : 0;
    const windup = enemy.phase === 'windup'
      ? Math.min(1, enemy.phaseTime / Math.max(0.15, def.attack.windup))
      : 0;
    const windupPulse = windup * (0.65 + 0.35 * Math.sin(performance.now() / 120));
    for (const mat of view.model.flashMaterials) {
      mat.emissive.setRGB(
        flash * 0.55 + hover * 0.22 + chill * 0.06 + windupPulse * 0.22,
        flash * 0.4 + hover * 0.16 + chill * 0.22 + windupPulse * 0.08,
        flash * 0.32 + hover * 0.1 + chill * 0.42 + windupPulse * 0.03,
      );
    }

    // Pose from authoritative state; the strike curve follows the AI phases.
    const speedNow = Math.hypot(enemy.velocity.x, enemy.velocity.z);
    view.model.pose({
      time: performance.now() / 1000,
      distance: speedNow * dt,
      speedRatio: enemy.dead ? 0 : Math.min(1, speedNow / Math.max(0.01, enemy.speed)),
      attack: enemy.dead ? null : phaseAttackProgress(enemy.phase, enemy.phaseTime, def.attack),
      hit: enemy.dead ? null : view.hitTime > 0 ? 1 - view.hitTime / HIT_DURATION : null,
      death: enemy.dead ? Math.min(1, enemy.deadTime / DEATH_DURATION) : null,
    });

    // Elite ring pulse.
    if (view.eliteRing) {
      const mat = view.eliteRing.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 420));
    }
  }

  /** One instanced background + one instanced fill draw call for every visible bar. */
  private updateBars(state: GameState, camera: THREE.Camera): void {
    this.barQuat.copy(camera.quaternion);
    this.barNormal.set(0, 0, 1).applyQuaternion(camera.quaternion);
    this.barRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    let count = 0;
    for (const enemy of state.enemies) {
      if (count >= MAX_BARS) break;
      if (enemy.dead || !this.isOnScreen(enemy)) continue;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      if (ratio >= 1) continue;
      const distance = Math.hypot(
        enemy.position.x - state.player.position.x,
        enemy.position.z - state.player.position.z,
      );
      if (distance > BAR_RANGE) continue;

      this.barPos.set(
        enemy.position.x,
        this.terrain.heightAt(enemy.position.x, enemy.position.z) + BODY_HEIGHT[enemy.defId] + 0.35,
        enemy.position.z,
      );
      this.barScale.set(1.3, 0.15, 1);
      this.barMatrix.compose(this.barPos, this.barQuat, this.barScale);
      this.barBg.setMatrixAt(count, this.barMatrix);

      this.barOffset.copy(this.barRight).multiplyScalar(-(0.65 - 0.62 * ratio));
      this.barOffset.addScaledVector(this.barNormal, 0.012);
      this.barPos.add(this.barOffset);
      this.barScale.set(1.24 * ratio, 0.1, 1);
      this.barMatrix.compose(this.barPos, this.barQuat, this.barScale);
      this.barFill.setMatrixAt(count, this.barMatrix);
      count++;
    }
    this.barBg.count = count;
    this.barFill.count = count;
    if (count > 0) {
      this.barBg.instanceMatrix.needsUpdate = true;
      this.barFill.instanceMatrix.needsUpdate = true;
    }
  }

  private isOnScreen(enemy: EnemyState): boolean {
    this.sphereCenter.set(enemy.position.x, 0.9, enemy.position.z);
    this.boundingSphere.set(this.sphereCenter, enemy.radius + 1.2);
    return this.frustum.intersectsSphere(this.boundingSphere);
  }

  /** Instanced soft contact shadows keep every rig grounded in one draw call. */
  private updateBlobs(state: GameState): void {
    let count = 0;
    for (const enemy of state.enemies) {
      if (count >= MAX_BLOBS) break;
      if (enemy.defId === 'ashen-warden') continue;
      this.blobPosition.set(
        enemy.position.x,
        this.terrain.heightAt(enemy.position.x, enemy.position.z) + 0.035,
        enemy.position.z,
      );
      const scale = enemy.radius * 1.75;
      this.blobScale.set(scale, 1, scale);
      this.blobMatrix.compose(this.blobPosition, this.blobQuaternion, this.blobScale);
      this.blob.setMatrixAt(count++, this.blobMatrix);
    }
    this.blob.count = count;
    if (count > 0) this.blob.instanceMatrix.needsUpdate = true;
  }
}
