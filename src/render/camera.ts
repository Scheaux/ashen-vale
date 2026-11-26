import * as THREE from 'three';
import type { GroundSampler } from './terrainSurface';

/** Ground height changes are limited to this many world units per second. */
const GROUND_SLEW = 6;
/** Keep this much air between the target-to-camera line and the terrain. */
const LOS_CLEARANCE = 0.4;
/** Interior samples between the target and the camera, including the camera end. */
const LOS_SAMPLES = 6;

/**
 * Isometric-style orbit rig: follows the player with damped smoothing,
 * wheel zoom (clamped) and right-drag yaw rotation.
 *
 * The sampled ground height is low-passed so hills do not jerk the focus, and
 * the camera lifts when terrain would intrude into the target-to-camera sight
 * line. Without a sampler (unit tests, pose review) the rig behaves exactly
 * like the old groundY = 0 camera.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Fixed 45° isometric view: no yaw rotation. */
  readonly yaw = Math.PI / 4;
  readonly pitch = 0.78;
  distance = 18;

  private readonly target = new THREE.Vector3(0, 0, 18);
  private readonly desired = new THREE.Vector3(0, 0, 18);
  private readonly samplePoint = new THREE.Vector3();
  private sampler: GroundSampler | null = null;
  /** Low-passed ground height used as the follow target. */
  private groundY = 0;
  /** Vertical camera offset keeping the sight line clear of terrain. */
  private lift = 0;
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

  /** Attach (or detach) the render-only ground sampler. */
  setGroundSampler(sampler: GroundSampler | null): void {
    this.sampler = sampler;
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
    const ground = this.sampler?.heightAt(x, z) ?? 0;
    const step = GROUND_SLEW * dt;
    this.groundY += THREE.MathUtils.clamp(ground - this.groundY, -step, step);
    this.desired.set(x, this.groundY, z);
    this.target.lerp(this.desired, 1 - Math.exp(-8 * dt));
    this.updateCamera();
  }

  snapTo(x: number, z: number, groundY?: number): void {
    const y = groundY ?? this.sampler?.heightAt(x, z) ?? 0;
    this.groundY = y;
    this.target.set(x, y, z);
    this.desired.copy(this.target);
    // Drop any stale crest lift; updateCamera recomputes against the new pose.
    this.lift = 0;
    this.shakeTime = 0;
    this.shakeAmplitude = 0;
    this.updateCamera();
  }

  /** Positive delta zooms out; the range stays close for readability. */
  zoom(deltaY: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + deltaY * 0.0012), 12, 21);
    this.updateCamera();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(): void {
    const horiz = Math.cos(this.pitch) * this.distance;
    const y = this.target.y + Math.sin(this.pitch) * this.distance;
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
    const cameraX = this.target.x + Math.sin(this.yaw) * horiz + sx;
    const cameraZ = this.target.z + Math.cos(this.yaw) * horiz + sz;
    const cameraY = y + sy;
    this.lift = this.sampler ? this.requiredLift(cameraX, cameraY, cameraZ) : 0;
    this.camera.position.set(cameraX, cameraY + this.lift, cameraZ);
    this.camera.lookAt(this.target.x + sx * 0.35, this.target.y + 1.1 + sy * 0.2, this.target.z + sz * 0.35);
    this.camera.updateMatrixWorld();
  }

  /**
   * Height the camera must rise so the whole target-to-camera line keeps
   * LOS_CLEARANCE above the heightfield. Sampling starts one step past the
   * target (the target sits on the ground by definition) and includes the
   * camera end, where terrain intrusion is most likely.
   */
  private requiredLift(cameraX: number, cameraY: number, cameraZ: number): number {
    const sampler = this.sampler;
    if (!sampler) return 0;
    let lift = 0;
    for (let i = 1; i <= LOS_SAMPLES; i++) {
      const t = i / LOS_SAMPLES;
      this.samplePoint.set(
        THREE.MathUtils.lerp(this.target.x, cameraX, t),
        THREE.MathUtils.lerp(this.target.y, cameraY, t),
        THREE.MathUtils.lerp(this.target.z, cameraZ, t),
      );
      const ground = sampler.heightAt(this.samplePoint.x, this.samplePoint.z);
      // Raising the camera by L raises this sample of the line by t * L.
      const required = (ground + LOS_CLEARANCE - this.samplePoint.y) / t;
      if (required > lift) lift = required;
    }
    return lift;
  }
}
