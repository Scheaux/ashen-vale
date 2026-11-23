import * as THREE from 'three';

/**
 * Isometric-style orbit rig: follows the player with damped smoothing,
 * wheel zoom (clamped) and right-drag yaw rotation.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI * 0.22;
  pitch = 0.78;
  distance = 18;

  private readonly target = new THREE.Vector3(0, 0, 18);
  private readonly desired = new THREE.Vector3(0, 0, 18);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 420);
    this.snapTo(0, 18);
  }

  /** Damped follow of the player position (called every frame). */
  follow(x: number, z: number, dt: number): void {
    this.desired.set(x, 0, z);
    this.target.lerp(this.desired, 1 - Math.exp(-8 * dt));
    this.updateCamera();
  }

  snapTo(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.desired.copy(this.target);
    this.updateCamera();
  }

  /** Positive delta zooms out (wheel scrolling down). */
  zoom(deltaY: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + deltaY * 0.0012), 9, 32);
    this.updateCamera();
  }

  /** Right-drag horizontal pan rotates the camera around the player. */
  rotate(deltaX: number): void {
    this.yaw -= deltaX * 0.005;
    this.updateCamera();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(): void {
    const horiz = Math.cos(this.pitch) * this.distance;
    const y = Math.sin(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      y,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    this.camera.lookAt(this.target.x, 1.1, this.target.z);
    this.camera.updateMatrixWorld();
  }
}
