import * as THREE from 'three';
import type { GameState, HazardState } from '../sim/state';
import { disposeMeshTree } from './dispose';
import type { TerrainSurface } from './terrainSurface';

interface HazardView {
  fill: THREE.Mesh;
  ring: THREE.Mesh;
  fillMaterial: THREE.MeshBasicMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
}

function circlePolygon(x: number, z: number, radius: number, segments: number) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius };
  });
}

function ringQuads(x: number, z: number, inner: number, outer: number, segments: number) {
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

/**
 * Ground hazards: volatile elite death blasts and the Warden's lingering
 * cinder pools. The sim owns the fuse/ticks; this layer only draws the
 * warning and the pool so the player can read the danger and leave.
 */
export class HazardLayer {
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, HazardView>();

  constructor(scene: THREE.Scene, private readonly terrain: TerrainSurface) {
    scene.add(this.group);
  }

  clear(): void {
    for (const view of this.views.values()) this.disposeView(view);
    this.views.clear();
  }

  sync(state: GameState): void {
    for (const [id, view] of this.views) {
      if (!state.hazards.some((hazard) => hazard.id === id)) {
        this.disposeView(view);
        this.views.delete(id);
      }
    }

    const now = performance.now();
    for (const hazard of state.hazards) {
      let view = this.views.get(hazard.id);
      if (!view) {
        view = this.createView(hazard);
        this.views.set(hazard.id, view);
      }
      this.updateView(view, hazard, now);
    }
  }

  private createView(hazard: HazardState): HazardView {
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: hazard.color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: hazard.color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const fill = new THREE.Mesh(
      this.terrain.drape([circlePolygon(hazard.x, hazard.z, hazard.radius * 0.92, 22)], 0.07),
      fillMaterial,
    );
    const ring = new THREE.Mesh(
      this.terrain.drape(ringQuads(hazard.x, hazard.z, hazard.radius * 0.84, hazard.radius, 22), 0.08),
      ringMaterial,
    );
    fill.renderOrder = 4;
    ring.renderOrder = 5;
    this.group.add(fill, ring);
    return { fill, ring, fillMaterial, ringMaterial };
  }

  private updateView(view: HazardView, hazard: HazardState, now: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(now / 95);
    if (!hazard.detonated) {
      const urgency = Math.max(0, Math.min(1, hazard.age / Math.max(0.001, hazard.fuse)));
      view.fillMaterial.opacity = 0.08 + 0.18 * urgency;
      view.ringMaterial.opacity = 0.3 + 0.25 * urgency + 0.12 * pulse;
      view.ring.scale.setScalar(1 + 0.035 * pulse * urgency);
    } else {
      view.fillMaterial.opacity = 0.16 + 0.08 * pulse;
      view.ringMaterial.opacity = 0.34 + 0.16 * pulse;
      view.ring.scale.setScalar(1);
    }
  }

  private disposeView(view: HazardView): void {
    disposeMeshTree(view.fill);
    disposeMeshTree(view.ring);
  }
}
