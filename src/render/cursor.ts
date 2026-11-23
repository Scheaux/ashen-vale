import * as THREE from 'three';

function ringGeometry(inner: number, outer: number): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(inner, outer, 48);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Pointer feedback: a dim ground ring, a warm enemy ring, and a pulsing
 * move destination marker.
 */
export class CursorMarker {
  private readonly hoverRing: THREE.Mesh;
  private readonly hoverMaterial: THREE.MeshBasicMaterial;
  private readonly destRing: THREE.Mesh;
  private readonly destMaterial: THREE.MeshBasicMaterial;
  private destVisible = false;

  constructor(scene: THREE.Scene, private readonly color: number) {
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
      this.hoverRing.position.x = point.x;
      this.hoverRing.position.z = point.z;
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
      this.destRing.position.x = point.x;
      this.destRing.position.z = point.z;
      this.destRing.visible = true;
      this.destVisible = true;
    } else if (this.destVisible) {
      // Arrival: quick fade-out handled by update().
      this.destVisible = false;
      this.destFade = 1;
    }
  }

  private destFade = 0;

  update(elapsed: number, dt: number): void {
    const pulse = 1 + Math.sin(elapsed * 5) * 0.07;
    this.destRing.scale.setScalar(pulse);
    this.destMaterial.opacity = this.destVisible ? 0.85 : this.destMaterial.opacity;
    if (this.destFade > 0) {
      this.destFade = Math.max(0, this.destFade - dt * 3);
      this.destMaterial.opacity = 0.85 * this.destFade;
      if (this.destFade === 0) this.destRing.visible = false;
    }
  }
}
