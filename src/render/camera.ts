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
  private clock = 0;
  private shakeTime = 0;
  private shakeDuration = 0.24;
  private shakeAmplitude = 0;
  private reducedMotion = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 420);
    this.snapTo(0, 18);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.shakeTime = 0;
      this.shakeAmplitude = 0;
    }
  }

  /** Short decaying camera punch; ignored when reduced motion is requested. */
  shake(amplitude: number, duration = 0.24): void {
    if (this.reducedMotion) return;
    this.shakeAmplitude = Math.max(this.shakeAmplitude, amplitude);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  /** Damped follow of the player position (called every frame). */
  follow(x: number, z: number, dt: number): void {
    this.clock += dt;
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.shakeTime <= 0) this.shakeAmplitude = 0;
    this.desired.set(x, 0, z);
    this.target.lerp(this.desired, 1 - Math.exp(-8 * dt));
    this.updateCamera();
  }

  snapTo(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.desired.copy(this.target);
    this.shakeTime = 0;
    this.shakeAmplitude = 0;
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
    let sx = 0;
    let sy = 0;
    let sz = 0;
    if (this.shakeTime > 0) {
      const falloff = this.shakeTime / this.shakeDuration;
      const amount = this.shakeAmplitude * falloff;
      sx = Math.sin(this.clock * 91) * amount;
      sy = Math.cos(this.clock * 73) * amount * 0.55;
      sz = Math.cos(this.clock * 57) * amount * 0.7;
    }
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz + sx,
      y + sy,
      this.target.z + Math.cos(this.yaw) * horiz + sz,
    );
    this.camera.lookAt(this.target.x + sx * 0.35, 1.1 + sy * 0.2, this.target.z + sz * 0.35);
    this.camera.updateMatrixWorld();
  }
}
