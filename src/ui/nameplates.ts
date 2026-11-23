import * as THREE from 'three';
import { ELITE_MODIFIERS, getEnemy } from '../content/enemies';
import type { GameState } from '../sim/state';

interface Plate {
  el: HTMLElement;
}

/**
 * DOM nameplates for elite enemies (modifier-colored label floating above the
 * head). Positions are reprojected from world space each frame.
 */
export class NameplateLayer {
  private readonly root: HTMLDivElement;
  private readonly plates = new Map<string, Plate>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'nameplate-layer';
    parent.appendChild(this.root);
  }

  clear(): void {
    this.root.replaceChildren();
    this.plates.clear();
  }

  sync(state: GameState, camera: THREE.Camera): void {
    const alive = new Set<string>();

    for (const enemy of state.enemies) {
      if (enemy.dead || enemy.elite.length === 0) continue;
      alive.add(enemy.id);

      let plate = this.plates.get(enemy.id);
      if (!plate) {
        const el = document.createElement('div');
        const mod = ELITE_MODIFIERS[enemy.elite[0]];
        el.className = 'nameplate';
        el.textContent = `${mod.label} ${getEnemy(enemy.defId).name}`;
        el.style.color = mod.cssColor;
        this.root.appendChild(el);
        plate = { el };
        this.plates.set(enemy.id, plate);
      }

      const v = new THREE.Vector3(enemy.position.x, 2.55, enemy.position.z).project(camera);
      if (v.z > 1) {
        plate.el.style.display = 'none';
        continue;
      }
      plate.el.style.display = 'block';
      plate.el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
      plate.el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    }

    for (const [id, plate] of this.plates) {
      if (!alive.has(id)) {
        plate.el.remove();
        this.plates.delete(id);
      }
    }
  }
}
