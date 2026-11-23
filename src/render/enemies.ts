import * as THREE from 'three';
import { getEnemy, ELITE_MODIFIERS } from '../content/enemies';
import type { EnemyState, GameState, SimEvent } from '../sim/state';
import { phaseAttackProgress, type CreaturePoseInput } from './anim';
import { createCultistRig } from './cultistModel';
import { disposeMeshTree } from './dispose';
import { scoreTarget, TargetProjection } from './targeting';
import { createHuskRig } from './huskModel';
import { createSkittererRig } from './skittererModel';

interface CreatureModel {
  root: THREE.Group;
  flashMaterials: THREE.MeshStandardMaterial[];
  pose(input: CreaturePoseInput): void;
}

interface EnemyView {
  model: CreatureModel;
  barFill: THREE.Mesh;
  barRoot: THREE.Group;
  hitTime: number;
  flash: number;
  facing: number;
  eliteRing: THREE.Mesh | null;
}

const HIT_DURATION = 0.26;
const DEATH_DURATION = 1.4;
const BODY_HEIGHT: Record<EnemyState['defId'], number> = {
  'ashen-husk': 1.62,
  'cinder-cultist': 1.85,
  'mire-skitterer': 1.02,
};

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
  private highlightedId: string | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
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

  clear(): void {
    for (const view of this.views.values()) disposeMeshTree(view.model.root);
    this.views.clear();
    this.highlightedId = null;
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
        this.views.delete(id);
      }
    }

    for (const enemy of state.enemies) {
      let view = this.views.get(enemy.id);
      if (!view) {
        view = this.createView(enemy);
        this.views.set(enemy.id, view);
        this.group.add(view.model.root);
      }
      this.updateView(view, enemy, dt, alpha, camera);
    }
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

    const barRoot = new THREE.Group();
    barRoot.position.y = 2.15;
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x120d0c, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    barRoot.add(barBg);
    const barFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.24, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xb3382c, depthWrite: false }),
    );
    barFill.position.z = 0.001;
    barRoot.add(barFill);
    model.root.add(barRoot);

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

    return { model, barFill, barRoot, hitTime: 0, flash: 0, facing: enemy.facing, eliteRing };
  }

  private updateView(view: EnemyView, enemy: EnemyState, dt: number, alpha: number, camera: THREE.Camera): void {
    const def = getEnemy(enemy.defId);

    // Interpolate one tick rather than damping: a fast pounce must not lag
    // several body lengths behind its actual contact point.
    view.model.root.position.x = THREE.MathUtils.lerp(enemy.previousPosition.x, enemy.position.x, alpha);
    view.model.root.position.z = THREE.MathUtils.lerp(enemy.previousPosition.z, enemy.position.z, alpha);

    // Facing: locked during windup/active (the counterplay reads off it),
    // smoothed during chase.
    if (enemy.phase === 'windup' || enemy.phase === 'active') {
      view.facing = enemy.windupFacing;
    } else {
      const diff = Math.atan2(Math.sin(enemy.facing - view.facing), Math.cos(enemy.facing - view.facing));
      view.facing += diff * Math.min(1, 10 * dt);
    }
    view.model.root.rotation.y = view.facing;

    // Hit flash + hover tint across body materials.
    view.flash = Math.max(0, view.flash - dt * 4.5);
    if (view.hitTime > 0) view.hitTime = Math.max(0, view.hitTime - dt);
    const flash: number = view.flash * view.flash;
    const hover = enemy.id === this.highlightedId ? 1 : 0;
    for (const mat of view.model.flashMaterials) {
      mat.emissive.setRGB(flash * 0.55 + hover * 0.22, flash * 0.4 + hover * 0.16, flash * 0.32 + hover * 0.1);
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

    // Health bar.
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    view.barFill.scale.x = ratio;
    view.barFill.position.x = -0.62 + 0.62 * ratio;
    view.barRoot.visible = ratio < 1 && !enemy.dead;
    view.barRoot.quaternion.copy(camera.quaternion);
  }
}
