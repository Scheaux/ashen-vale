import * as THREE from 'three';
import type { SimEvent } from '../sim/state';
import { disposeMeshTree } from './dispose';

interface TelegraphView {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Fade-out timer once the strike has passed. */
  fade: number;
}

const TELEGRAPH_COLOR = 0xff4a33;

/**
 * Ground telegraphs drawn from authoritative 'telegraph' sim events: a
 * pulsing sector for arc sweeps and a locked lane for pounces and bolts.
 * The shape is drawn from the enemy's LOCKED windup facing, so what the
 * player sees is exactly what the strike will hit.
 */
export class TelegraphLayer {
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, TelegraphView>();

  constructor(scene: THREE.Scene) {
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

      let geometry: THREE.BufferGeometry;
      let rotationY: number;
      if (ev.shape === 'bolt' || ev.shape === 'pounce') {
        const lane = new THREE.Shape();
        lane.moveTo(ev.radius, 0);
        lane.lineTo(ev.radius, ev.range);
        lane.absarc(0, ev.range, ev.radius, 0, Math.PI, false);
        lane.lineTo(-ev.radius, 0);
        lane.absarc(0, 0, ev.radius, Math.PI, Math.PI * 2, false);
        geometry = new THREE.ShapeGeometry(lane, 16);
        geometry.rotateX(Math.PI / 2); // strip runs along +Z
        rotationY = ev.facing;
      } else {
        const half = (ev.arcDeg / 2) * (Math.PI / 180);
        geometry = new THREE.RingGeometry(0, ev.range, 32, 1, -half, half * 2);
        geometry.rotateX(-Math.PI / 2);
        // Sector is centered on local +X; align +X with the locked facing.
        rotationY = ev.facing - Math.PI / 2;
      }

      const material = new THREE.MeshBasicMaterial({
        color: TELEGRAPH_COLOR,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(ev.x, 0.045, ev.z);
      mesh.rotation.y = rotationY;
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
        const pulse = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(performance.now() / 90));
        view.material.opacity = pulse;
      } else {
        view.fade += dt;
        view.material.opacity = Math.max(0, 0.3 - view.fade * 1.6);
        if (view.fade > 0.25) {
          disposeMeshTree(view.mesh);
          this.views.delete(id);
        }
      }
    }
  }
}
