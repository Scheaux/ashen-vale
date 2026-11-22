import * as THREE from 'three';
import type { SimEvent } from '../sim/state';

interface TelegraphView {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Fade-out timer once the strike has passed. */
  fade: number;
}

const TELEGRAPH_COLOR = 0xff4a33;

/**
 * Ground telegraphs drawn from authoritative 'telegraph' sim events: a
 * pulsing sector for arc sweeps and pounces, a directional strip for bolts.
 * The shape is drawn from the enemy's LOCKED windup facing, so what the
 * player sees is exactly what the strike will hit.
 */
export class TelegraphLayer {
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, TelegraphView>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind !== 'telegraph') continue;
      let view = this.views.get(ev.enemyId);
      if (view) {
        this.group.remove(view.mesh);
        view.mesh.geometry.dispose();
      }

      let geometry: THREE.BufferGeometry;
      let rotationY: number;
      if (ev.shape === 'bolt') {
        geometry = new THREE.PlaneGeometry(0.55, 7);
        geometry.translate(0, 3.5, 0);
        geometry.rotateX(Math.PI / 2); // strip runs along +Z
        rotationY = ev.facing;
      } else {
        const half = (ev.arcDeg / 2) * (Math.PI / 180);
        const radius = ev.range + 0.4;
        geometry = new THREE.RingGeometry(0.25, radius, 32, 1, -half, half * 2);
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

  sync(state: { enemies: Array<{ id: string; phase: string; position: { x: number; z: number } }> }, dt: number): void {
    for (const [id, view] of this.views) {
      const enemy = state.enemies.find((e) => e.id === id);
      const active = enemy && (enemy.phase === 'windup' || enemy.phase === 'active');
      if (enemy && active) {
        view.mesh.position.x = enemy.position.x;
        view.mesh.position.z = enemy.position.z;
        view.fade = 0;
        // Pulse brighter through the windup so urgency reads.
        const pulse = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(performance.now() / 90));
        view.material.opacity = pulse;
      } else {
        view.fade += dt;
        view.material.opacity = Math.max(0, 0.3 - view.fade * 1.6);
        if (view.fade > 0.25) {
          this.group.remove(view.mesh);
          view.mesh.geometry.dispose();
          view.material.dispose();
          this.views.delete(id);
        }
      }
    }
  }
}
