import * as THREE from 'three';
import type { SimEvent } from '../sim/state';
import { disposeMeshTree } from './dispose';
import type { TerrainSurface } from './terrainSurface';

interface TelegraphView {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Fade-out timer once the strike has passed. */
  fade: number;
}

const TELEGRAPH_COLOR = 0xff4a33;

export function warningFootprints(ev: Extract<SimEvent, { kind: 'telegraph' }>) {
  const sin = Math.sin(ev.facing);
  const cos = Math.cos(ev.facing);
  const point = (x: number, z: number) => ({ x: ev.x + x * cos + z * sin, z: ev.z - x * sin + z * cos });
  if (ev.shape === 'bolt' || ev.shape === 'pounce') {
    const cap = (front: boolean) => Array.from({ length: 17 }, (_, i) => {
      const t = i / 16 * Math.PI;
      return point(Math.cos(t) * ev.radius * (front ? -1 : 1),
        front ? ev.range + Math.sin(t) * ev.radius : -Math.sin(t) * ev.radius);
    });
    return [[...cap(false), ...cap(true)]];
  }

  if (ev.shape === 'slam') {
    // Ground slam: a disc at the locked landing point.
    const disc = Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return point(Math.cos(t) * ev.radius, Math.sin(t) * ev.radius);
    });
    return [disc];
  }

  const arc = THREE.MathUtils.degToRad(ev.arcDeg);
  // Keep each sector convex, including any future sweep wider than 180°.
  const parts = Math.max(1, Math.ceil(arc / Math.PI));
  return Array.from({ length: parts }, (_, part) => [
    point(0, 0),
    ...Array.from({ length: 33 }, (_, i) => {
      const angle = -arc / 2 + (part + i / 32) * arc / parts;
      return point(Math.sin(angle) * ev.range, Math.cos(angle) * ev.range);
    }),
  ]);
}

/**
 * Ground telegraphs drawn from authoritative 'telegraph' sim events: a
 * pulsing sector for arc sweeps and a locked lane for pounces and bolts.
 * The shape is drawn from the enemy's LOCKED windup facing, so what the
 * player sees is exactly what the strike will hit.
 */
export class TelegraphLayer {
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, TelegraphView>();

  constructor(scene: THREE.Scene, private readonly terrain: TerrainSurface) {
    scene.add(this.group);
  }

  clear(): void {
    for (const view of this.views.values()) disposeMeshTree(view.mesh);
    this.views.clear();
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind !== 'telegraph') continue;
      const view = this.views.get(ev.enemyId);
      if (view) disposeMeshTree(view.mesh);

      const geometry = this.terrain.drape(warningFootprints(ev));
      const material = new THREE.MeshBasicMaterial({
        color: TELEGRAPH_COLOR,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      this.group.add(mesh);
      this.views.set(ev.enemyId, { mesh, material, fade: 0 });
    }
  }

  sync(state: { enemies: Array<{ id: string; phase: string; dead: boolean }> }, dt: number): void {
    for (const [id, view] of this.views) {
      const enemy = state.enemies.find((e) => e.id === id);
      if (enemy && !enemy.dead && (enemy.phase === 'windup' || enemy.phase === 'active')) {
        view.fade = 0;
        // Pulse brighter through the windup so urgency reads.
        const pulse = 0.20 + 0.17 * (0.5 + 0.5 * Math.sin(performance.now() / 90));
        view.material.opacity = pulse;
      } else {
        view.fade += dt;
        view.material.opacity = Math.max(0, 0.37 - view.fade * 1.85);
        if (view.fade > 0.25) {
          disposeMeshTree(view.mesh);
          this.views.delete(id);
        }
      }
    }
  }
}
