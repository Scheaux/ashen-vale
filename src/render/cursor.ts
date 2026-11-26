import * as THREE from 'three';
import type { TerrainSurface } from './terrainSurface';

const UP = new THREE.Vector3(0, 1, 0);

function ringGeometry(inner: number, outer: number): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(inner, outer, 48);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function flatten(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Pointer feedback: a dim ground ring, a warm enemy ring, and a pulsing
 * move destination marker. Every ring samples the terrain height and normal so
 * it never sinks under a rise and lies flush with a slope.
 */
export class CursorMarker {
  private readonly hoverRing: THREE.Mesh;
  private readonly hoverMaterial: THREE.MeshBasicMaterial;
  private readonly destRing: THREE.Mesh;
  private readonly destMaterial: THREE.MeshBasicMaterial;
  private readonly hoverNormal = new THREE.Vector3(0, 1, 0);
  private readonly destNormal = new THREE.Vector3(0, 1, 0);
  private destVisible = false;

  constructor(
    scene: THREE.Scene,
    private readonly color: number,
    private readonly terrain: TerrainSurface,
  ) {
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.hoverRing = new THREE.Mesh(ringGeometry(0.3, 0.4), this.hoverMaterial);
    this.hoverRing.position.y = 0.025;
    this.hoverRing.visible = false;
    scene.add(this.hoverRing);

    this.destMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.destRing = new THREE.Mesh(ringGeometry(0.36, 0.52), this.destMaterial);
    this.destRing.position.y = 0.035;
    this.destRing.visible = false;
    scene.add(this.destRing);
  }

  setHover(point: THREE.Vector3 | null, enemyRadius?: number): void {
    if (point) {
      // Center clearance is unchanged; the ring only tilts to the slope.
      this.hoverRing.position.set(
        point.x,
        this.terrain.heightAt(point.x, point.z) + 0.025,
        point.z,
      );
      this.terrain.normalAt(point.x, point.z, this.hoverNormal);
      this.hoverRing.quaternion.setFromUnitVectors(UP, this.hoverNormal);
      this.hoverRing.scale.setScalar(enemyRadius === undefined ? 1 : (enemyRadius + 0.15) / 0.4);
      this.hoverMaterial.color.setHex(enemyRadius === undefined ? this.color : 0xff785e);
      this.hoverMaterial.opacity = enemyRadius === undefined ? 0.32 : 0.82;
      this.hoverRing.visible = true;
    } else {
      this.hoverRing.visible = false;
    }
  }

  setDestination(point: THREE.Vector3 | null): void {
    if (point) {
      // A fresh destination must cancel any fade left by the previous arrival.
      this.destFade = 0;
      this.destRing.position.set(
        point.x,
        this.terrain.heightAt(point.x, point.z) + 0.035,
        point.z,
      );
      this.terrain.normalAt(point.x, point.z, this.destNormal);
      this.destRing.quaternion.setFromUnitVectors(UP, this.destNormal);
      this.destRing.visible = true;
      this.destVisible = true;
      this.destMaterial.opacity = 0.85;
    } else if (this.destVisible) {
      // Arrival: quick fade-out handled by update().
      this.destVisible = false;
      this.destFade = 1;
    }
  }

  private destFade = 0;

  /** QA/debug snapshot of the ground-anchored markers and their surface normals. */
  probe(): {
    hover: { x: number; y: number; z: number } | null;
    destination: { x: number; y: number; z: number } | null;
    hoverNormal: { x: number; y: number; z: number } | null;
    destinationNormal: { x: number; y: number; z: number } | null;
  } {
    return {
      hover: this.hoverRing.visible
        ? { x: this.hoverRing.position.x, y: this.hoverRing.position.y, z: this.hoverRing.position.z }
        : null,
      destination: this.destVisible
        ? { x: this.destRing.position.x, y: this.destRing.position.y, z: this.destRing.position.z }
        : null,
      hoverNormal: this.hoverRing.visible ? flatten(this.hoverNormal) : null,
      destinationNormal: this.destVisible ? flatten(this.destNormal) : null,
    };
  }

  update(elapsed: number, dt: number): void {
    const pulse = 1 + Math.sin(elapsed * 5) * 0.07;
    this.destRing.scale.setScalar(pulse);
    if (this.destVisible) {
      this.destMaterial.opacity = 0.85;
      return;
    }
    if (this.destFade > 0) {
      this.destFade = Math.max(0, this.destFade - dt * 3);
      this.destMaterial.opacity = 0.85 * this.destFade;
      if (this.destFade === 0) this.destRing.visible = false;
    }
  }
}
