import * as THREE from 'three';
import { RARITY_COLORS, type Rarity } from '../content/items';
import type { GameState } from '../sim/state';
import { disposeMeshTree } from './dispose';

interface LootView {
  crystal: THREE.Mesh;
  beam: THREE.Mesh;
  beamMaterial: THREE.MeshBasicMaterial;
  phase: number;
}

const BEAM_OPACITY: Record<Rarity, number> = {
  normal: 0.1,
  magic: 0.18,
  rare: 0.28,
  unique: 0.42,
};

/**
 * Ground loot: a rotating rarity-colored crystal with a vertical light beam —
 * rare and unique drops are readable from across the screen.
 */
export class LootViews {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, LootView>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  clear(): void {
    for (const view of this.views.values()) this.remove(view);
    this.views.clear();
  }

  private remove(view: LootView): void {
    disposeMeshTree(view.crystal);
    disposeMeshTree(view.beam);
  }

  sync(state: GameState, elapsed: number): void {
    for (const [id, view] of this.views) {
      if (!state.loot.some((d) => d.id === id)) {
        this.remove(view);
        this.views.delete(id);
      }
    }

    for (const drop of state.loot) {
      let view = this.views.get(drop.id);
      if (!view) {
        const color = RARITY_COLORS[drop.item.rarity];
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.22),
          new THREE.MeshBasicMaterial({ color: color.hex }),
        );
        crystal.position.set(drop.x, 0.4, drop.z);

        const beamMaterial = new THREE.MeshBasicMaterial({
          color: color.hex,
          transparent: true,
          opacity: BEAM_OPACITY[drop.item.rarity],
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 2.4, 10, 1, true), beamMaterial);
        beam.position.set(drop.x, 1.2, drop.z);

        this.group.add(crystal, beam);
        view = { crystal, beam, beamMaterial, phase: drop.x * 3.1 + drop.z * 1.7 };
        this.views.set(drop.id, view);
      }

      view.crystal.rotation.y = elapsed * 1.4 + view.phase;
      view.crystal.position.y = 0.42 + Math.sin(elapsed * 2 + view.phase) * 0.08;
      view.beamMaterial.opacity =
        BEAM_OPACITY[drop.item.rarity] *
        (0.8 + 0.2 * Math.sin(elapsed * 2.4 + view.phase));
    }
  }
}
