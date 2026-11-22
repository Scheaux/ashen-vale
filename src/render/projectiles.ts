import * as THREE from 'three';
import type { GameState } from '../sim/state';

interface ProjectileView {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
}

/** Emissive projectile orbs with a small travelling light. */
export class ProjectileViews {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, ProjectileView>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  sync(state: GameState): void {
    for (const [id, view] of this.views) {
      if (!state.projectiles.some((p) => p.id === id)) {
        this.group.remove(view.mesh);
        this.group.remove(view.light);
        this.views.delete(id);
      }
    }

    for (const proj of state.projectiles) {
      let view = this.views.get(proj.id);
      if (!view) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 12, 10),
          new THREE.MeshBasicMaterial({ color: proj.color }),
        );
        const light = new THREE.PointLight(proj.color, 7, 8, 2);
        this.group.add(mesh, light);
        view = { mesh, light };
        this.views.set(proj.id, view);
      }
      view.mesh.position.set(proj.position.x, proj.y, proj.position.z);
      view.light.position.copy(view.mesh.position);
    }
  }
}
