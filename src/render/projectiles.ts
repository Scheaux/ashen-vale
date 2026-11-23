import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { disposeMeshTree } from './dispose';

interface ProjectileView {
  mesh: THREE.Object3D;
  light: THREE.PointLight | null;
}

/** Physical arrows and luminous spell bolts, following the same sim positions. */
export class ProjectileViews {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, ProjectileView>();
  private readonly direction = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  clear(): void {
    for (const view of this.views.values()) this.remove(view);
    this.views.clear();
  }

  private remove(view: ProjectileView): void {
    disposeMeshTree(view.mesh);
    view.light?.dispose();
    view.light?.removeFromParent();
  }

  sync(state: GameState): void {
    for (const [id, view] of this.views) {
      if (!state.projectiles.some((p) => p.id === id)) {
        this.remove(view);
        this.views.delete(id);
      }
    }

    for (const proj of state.projectiles) {
      let view = this.views.get(proj.id);
      if (!view) {
        const isArrow = proj.skillId === 'piercing-shot';
        const light = isArrow ? null : new THREE.PointLight(proj.color, 7, 8, 2);
        const mesh = isArrow ? this.createArrow() : new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 12, 10),
          new THREE.MeshBasicMaterial({ color: proj.color }),
        );
        if (isArrow && this.direction.set(proj.velocity.x, 0, proj.velocity.z).lengthSq() > 0) {
          mesh.quaternion.setFromUnitVectors(this.up, this.direction.normalize());
        }
        this.group.add(mesh);
        if (light) this.group.add(light);
        view = { mesh, light };
        this.views.set(proj.id, view);
      }
      view.mesh.position.set(proj.position.x, proj.y, proj.position.z);
      view.light?.position.copy(view.mesh.position);
    }
  }

  private createArrow(): THREE.Group {
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.57, 6),
      new THREE.MeshBasicMaterial({ color: 0xbc9a69 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 5),
      new THREE.MeshBasicMaterial({ color: 0xe4dfc2 }));
    const feather = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 4),
      new THREE.MeshBasicMaterial({ color: 0xa5ba63 }));
    tip.position.y = 0.31;
    feather.position.y = -0.24;
    arrow.add(shaft, tip, feather);
    return arrow;
  }
}
