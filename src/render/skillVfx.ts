import * as THREE from 'three';
import { getSkill } from '../content/skills';
import type { SkillId } from '../content/types';
import type { GameState, SimEvent } from '../sim/state';
import { disposeMeshTree } from './dispose';
import type { TerrainSurface } from './terrainSurface';

/**
 * Skill VFX (slice 5): one visual language per delivery kind — slash arcs for
 * sweeps and charges, cast flares for shots, expanding rings for novas,
 * shard bursts for ground strikes, and draped telegraph runes for the fuse
 * tell. Rendering consumes authoritative sim events and the strike list; no
 * gameplay outcome is invented here.
 */

interface Transient {
  root: THREE.Group;
  age: number;
  life: number;
  tick(progress: number): void;
}

interface TelegraphView {
  meshes: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
}

const RING_SEGMENTS = 40;
/** Hard cap on simultaneous skill transients; oldest is retired first. */
const MAX_TRANSIENTS = 48;

export class SkillVfxLayer {
  private readonly group = new THREE.Group();
  private readonly transients: Transient[] = [];
  private readonly telegraphs = new Map<string, TelegraphView>();

  constructor(scene: THREE.Scene, private readonly terrain: TerrainSurface) {
    scene.add(this.group);
  }

  clear(): void {
    for (const transient of this.transients) disposeMeshTree(transient.root);
    this.transients.length = 0;
    for (const view of this.telegraphs.values()) this.disposeTelegraph(view);
    this.telegraphs.clear();
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'attack' && ev.sourceId === 'player') {
        const skill = getSkill(ev.skillId as SkillId);
        if (skill.delivery === 'melee-arc' || skill.delivery === 'dash') {
          this.spawnArc(skill.color, ev.x, ev.z, ev.facing, skill.delivery === 'dash' ? 40 : skill.arcDeg ?? 120);
        } else {
          this.spawnCastFlare(skill.color, ev.x, ev.z);
        }
      } else if (ev.kind === 'burst') {
        this.spawnBurst(ev.x, ev.z, ev.radius, ev.color);
      } else if (ev.kind === 'damage' && ev.targetKind === 'enemy') {
        this.spawnImpact(ev.x, ev.y, ev.z);
      } else if (ev.kind === 'death' && ev.targetKind === 'enemy') {
        this.spawnDeathPuff(ev.x, ev.z);
      }
    }
  }

  /** Draped telegraph runes for pending ground strikes, from authoritative state. */
  sync(state: GameState, dt: number): void {
    for (const [id, view] of this.telegraphs) {
      const strike = state.strikes.find((s) => s.id === id);
      if (!strike) {
        this.disposeTelegraph(view);
        this.telegraphs.delete(id);
      }
    }
    for (const strike of state.strikes) {
      let view = this.telegraphs.get(strike.id);
      if (!view) {
        view = this.createTelegraph(strike.x, strike.z, strike.radius, strike.color);
        this.telegraphs.set(strike.id, view);
      }
      const urgency = 1 - Math.min(1, strike.fuse / 1.2);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 80);
      view.materials[0].opacity = 0.1 + 0.1 * urgency;
      view.materials[1].opacity = 0.28 + 0.3 * urgency * pulse;
    }
    this.stepTransients(dt);
  }

  private stepTransients(dt: number): void {
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const transient = this.transients[i];
      transient.age += dt;
      const progress = Math.min(1, transient.age / transient.life);
      transient.tick(progress);
      if (progress >= 1) {
        disposeMeshTree(transient.root);
        this.transients.splice(i, 1);
      }
    }
  }

  /** Crescent slash for sweeps and charges, lying flat along the committed facing. */
  private spawnArc(color: number, x: number, z: number, facing: number, arcDeg: number): void {
    const arc = (arcDeg * Math.PI) / 180;
    const geometry = new THREE.RingGeometry(0.65, 2.3, 28, 1, Math.PI / 2 - arc / 2, arc);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -facing;
    const root = new THREE.Group();
    root.position.set(x, this.terrain.heightAt(x, z) + 0.12, z);
    root.add(mesh);
    this.group.add(root);
    this.pushTransient({
      root,
      age: 0,
      life: 0.32,
      tick: (t) => {
        root.scale.setScalar(0.72 + 0.5 * t);
        material.opacity = 0.8 * (1 - t) ** 1.6;
      },
    });
  }

  /** Small flare at the release point of shots and bolts. */
  private spawnCastFlare(color: number, x: number, z: number): void {
    const geometry = new THREE.RingGeometry(0.12, 0.55, 20);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    const root = new THREE.Group();
    root.position.set(x, this.terrain.heightAt(x, z) + 0.15, z);
    root.add(mesh);
    this.group.add(root);
    this.pushTransient({
      root,
      age: 0,
      life: 0.2,
      tick: (t) => {
        root.scale.setScalar(0.5 + 1.1 * t);
        material.opacity = 0.85 * (1 - t);
      },
    });
  }

  /** Ground strike detonation: expanding ring, rising shards, light flash. */
  private spawnBurst(x: number, z: number, radius: number, color: number): void {
    const baseY = this.terrain.heightAt(x, z);
    const root = new THREE.Group();
    root.position.set(x, baseY, z);
    this.group.add(root);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, RING_SEGMENTS), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    root.add(ring);

    const shardMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < 7; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 5), shardMaterial);
      const angle = (i / 7) * Math.PI * 2;
      shard.position.set(Math.cos(angle) * radius * 0.35, 0.3, Math.sin(angle) * radius * 0.35);
      shard.rotation.set(Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5);
      root.add(shard);
      shards.push(shard);
    }

    const light = new THREE.PointLight(color, 26, radius * 4.5, 2);
    light.position.set(0, 1.4, 0);
    root.add(light);

    this.pushTransient({
      root,
      age: 0,
      life: 0.5,
      tick: (t) => {
        root.scale.setScalar(0.35 + radius * 0.22 * t);
        ringMaterial.opacity = 0.85 * (1 - t) ** 1.4;
        shardMaterial.opacity = 0.9 * (1 - t) ** 1.8;
        light.intensity = 26 * (1 - t) ** 2;
        for (const shard of shards) shard.position.y += 0.09 * (1 - t);
      },
    });
  }

  /** Small contact ring where a player hit lands on an enemy. */
  private spawnImpact(x: number, y: number, z: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd9a8,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.42, 16), material);
    mesh.rotation.x = -Math.PI / 2;
    const root = new THREE.Group();
    root.position.set(x, this.terrain.heightAt(x, z) + y, z);
    root.add(mesh);
    this.group.add(root);
    this.pushTransient({
      root,
      age: 0,
      life: 0.2,
      tick: (t) => {
        root.scale.setScalar(0.6 + 1.8 * t);
        material.opacity = 0.8 * (1 - t) ** 1.5;
      },
    });
  }

  /** Ember-heavy collapse burst on an enemy death. */
  private spawnDeathPuff(x: number, z: number): void {
    const root = new THREE.Group();
    root.position.set(x, this.terrain.heightAt(x, z), z);
    this.group.add(root);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9a4d,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.55, 18), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    root.add(ring);

    const shardMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb36b,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), shardMaterial);
      const angle = (i / 5) * Math.PI * 2;
      shard.position.set(Math.cos(angle) * 0.25, 0.12, Math.sin(angle) * 0.25);
      shard.rotation.set(Math.sin(angle) * 0.55, 0, -Math.cos(angle) * 0.55);
      root.add(shard);
      shards.push(shard);
    }

    this.pushTransient({
      root,
      age: 0,
      life: 0.55,
      tick: (t) => {
        root.scale.setScalar(0.4 + 1.2 * t);
        ringMaterial.opacity = 0.7 * (1 - t) ** 1.2;
        shardMaterial.opacity = 0.8 * (1 - t) ** 1.5;
        for (const shard of shards) shard.position.y = 0.12 + t * 0.5;
      },
    });
  }

  /** Cap simultaneous effects by retiring the oldest. */
  private pushTransient(transient: Transient): void {
    if (this.transients.length >= MAX_TRANSIENTS) {
      const oldest = this.transients.shift();
      if (oldest) disposeMeshTree(oldest.root);
    }
    this.transients.push(transient);
  }

  /** Draped fill disc + outline ring conformed to the terrain. */
  private createTelegraph(x: number, z: number, radius: number, color: number): TelegraphView {
    const disc = circlePolygon(x, z, radius * 0.92, 22);
    const outline = ringQuads(x, z, radius * 0.88, radius, 22);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const fill = new THREE.Mesh(this.terrain.drape([disc]), fillMaterial);
    const ring = new THREE.Mesh(this.terrain.drape(outline), ringMaterial);
    this.group.add(fill, ring);
    return { meshes: [fill, ring], materials: [fillMaterial, ringMaterial] };
  }

  private disposeTelegraph(view: TelegraphView): void {
    for (const mesh of view.meshes) disposeMeshTree(mesh);
    for (const material of view.materials) material.dispose();
  }
}

function circlePolygon(x: number, z: number, radius: number, segments: number): Array<{ x: number; z: number }> {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius };
  });
}

/** A ring as N convex quads so the draper can conform each piece to the terrain. */
function ringQuads(
  x: number,
  z: number,
  inner: number,
  outer: number,
  segments: number,
): Array<Array<{ x: number; z: number }>> {
  return Array.from({ length: segments }, (_, i) => {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    return [
      { x: x + Math.cos(a0) * inner, z: z + Math.sin(a0) * inner },
      { x: x + Math.cos(a0) * outer, z: z + Math.sin(a0) * outer },
      { x: x + Math.cos(a1) * outer, z: z + Math.sin(a1) * outer },
      { x: x + Math.cos(a1) * inner, z: z + Math.sin(a1) * inner },
    ];
  });
}
