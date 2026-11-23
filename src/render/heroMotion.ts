import * as THREE from 'three';
import { BASIC_ATTACK_CONTACT } from '../content/skills';
import type { ClassId } from '../content/types';
import { clamp } from '../core/math';
import { smoothstep } from '../core/noise';
import { deg, keyLerp } from './anim';

export const HERO_LEG = { upper: 0.4, lower: 0.42, hipOffset: 0.02, ankle: 0.048 } as const;
export const HERO_BOOT = { length: 0.25, center: 0.053 } as const;
export const HERO_GAIT = {
  marauder: { stride: 2.56, lift: 0.107, bob: 0.022, cape: 0.67 },
  ranger: { stride: 2.70, lift: 0.15, bob: 0.015, cape: 0.69 },
  witch: { stride: 2.30, lift: 0.09, bob: 0.009, cape: 1.19 },
} as const;

const BODY = {
  marauder: { lean: 0.24, runLean: 0.15, bank: 0.19, sway: 0.068, pelvicYaw: 0.19, chestYaw: 0.31, headLead: 0.23, armL: 0.43, armR: 0.27, surge: 0.052 },
  ranger: { lean: 0.15, runLean: 0.145, bank: 0.10, sway: 0.038, pelvicYaw: 0.105, chestYaw: 0.16, headLead: 0.46, armL: 0.13, armR: 0.30, surge: 0.032 },
  witch: { lean: 0.06, runLean: 0.12, bank: 0.06, sway: 0.024, pelvicYaw: 0.055, chestYaw: 0.08, headLead: 0.18, armL: 0.13, armR: 0.075, surge: 0.017 },
} as const;

export function travelPose(id: ClassId, phase: number, speed: number, turn: number, effort: number) {
  const params = BODY[id];
  const cycle = phase * 2 * Math.PI;
  const support = Math.sin(cycle + 0.22) * speed;
  const rotation = Math.cos(cycle + 0.2) * speed;
  const bank = turn * speed;
  const run = smoothstep(0.4, 1, speed);
  return {
    side: -params.sway * support + params.sway * 0.27 * bank,
    surge: params.surge * (0.55 * run + effort * speed + Math.sin(2 * cycle) * speed * 0.28),
    hipsYaw: params.pelvicYaw * rotation,
    hipsRoll: params.sway * (support - bank * 0.5),
    chestYaw: -params.chestYaw * Math.cos(cycle - 0.3) * speed - bank * params.bank * 0.67,
    chestRoll: (support * 0.62 - bank) * params.bank,
    chestPitch: params.lean * speed + params.runLean * run
      + params.lean * 0.53 * effort * speed + params.surge * Math.cos(2 * cycle) * speed * 0.46,
    headYaw: params.headLead * bank,
    armL: -params.armL * rotation,
    armR: params.armR * Math.cos(cycle - 0.19) * speed,
    bob: Math.cos(2 * cycle + 0.6) * HERO_GAIT[id].bob * speed,
  };
}

export function heroStep(id: ClassId, speed: number) {
  const run = smoothstep(0.28, 0.92, speed);
  const gait = HERO_GAIT[id];
  return {
    stride: keyLerp(speed, [[0, 0.72], [0.4, 1.42], [1, gait.stride]]),
    // Longer strides lower cadence; shorten the running contact phase to
    // keep planted reach about the same (stance × stride).
    stance: 0.60 - 0.25 * run,
    clearance: gait.lift * (0.65 + 0.35 * run),
  };
}

export function advanceHeroStride(phase: number, distance: number, stride: number): number {
  return (phase + Math.max(0, distance) / stride) % 1;
}

/** The heel or toe stays grounded while the boot rolls in place. */
export function bootPivot(pitch: number): number {
  return HERO_BOOT.center + (pitch > 0 ? 1 : -1) * HERO_BOOT.length / 2;
}

/** Sagittal sole path: linear stance cancels the root's forward travel. */
export function strideFoot(phase: number, { stride, stance, clearance }: ReturnType<typeof heroStep>, blend = 1) {
  const p = ((phase % 1) + 1) % 1;
  const reach = 0.5 * stance * stride;
  let z: number;
  let lift = 0;
  let pitch: number;
  if (p < stance) {
    const t = p / stance;
    z = reach - p * stride;
    pitch = keyLerp(t, [[0, -0.16], [0.21, 0], [0.73, 0], [1, 0.25]]);
  } else {
    const t = (p - stance) / (1 - stance);
    const travel = t * t * (3 - 2 * t);
    // Match stance velocity at both ends: smooth pickup and touchdown.
    const tangent = -stride * (1 - stance) * t * (1 - t) * (1 - 2 * t);
    z = reach * (2 * travel - 1) + tangent;
    lift = clearance * Math.sin(Math.PI * t) ** 2;
    pitch = keyLerp(t, [[0, 0.25], [0.32, 0.06], [0.66, -0.19], [1, -0.16]]);
  }
  pitch *= blend;
  const pivot = bootPivot(pitch);
  return {
    z: z * blend + pivot * (1 - Math.cos(pitch)) + HERO_LEG.ankle * Math.sin(pitch),
    lift: lift * blend + HERO_LEG.ankle * (Math.cos(pitch) - 1) + pivot * Math.sin(pitch),
    pitch,
  };
}

const DOWN = new THREE.Vector3(0, -1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

/** Two-bone solve in actor space: pelvis sway is independent of the planted sole. */
export class HeroLegSolver {
  private readonly line = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly kneeCenter = new THREE.Vector3();
  private readonly lowerDirection = new THREE.Vector3();
  private readonly lowerRotation = new THREE.Quaternion();

  solve(x: number, down: number, z: number, pitch: number, thigh: THREE.Quaternion, shin: THREE.Quaternion, foot: THREE.Quaternion): void {
    const { upper, lower } = HERO_LEG;
    this.line.set(x, -down, z);
    const length = clamp(this.line.length(), Math.abs(upper - lower) + 0.001, upper + lower - 0.001);
    this.line.normalize();
    // Project the forward knee pole perpendicular to the hip–ankle line.
    this.pole.set(0, 0, 1).projectOnPlane(this.line).normalize();
    const along = (upper ** 2 + length ** 2 - lower ** 2) / (2 * length);
    this.kneeCenter.copy(this.line).multiplyScalar(along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
    this.lowerDirection.copy(this.line).multiplyScalar(length).sub(this.kneeCenter).normalize();
    thigh.setFromUnitVectors(DOWN, this.kneeCenter.normalize());
    this.lowerRotation.setFromUnitVectors(DOWN, this.lowerDirection);
    shin.copy(thigh).invert().multiply(this.lowerRotation);
    foot.setFromAxisAngle(RIGHT, pitch).premultiply(this.lowerRotation.invert());
  }
}

export function attackStance(id: ClassId, p: number) {
  const hit = id === 'marauder' ? BASIC_ATTACK_CONTACT.melee : BASIC_ATTACK_CONTACT.projectile;
  const plant = smoothstep(0, 0.22, p) * (1 - smoothstep(0.81, 1, p));
  const weight = keyLerp(p, [[0, 0], [0.25, 0.8], [hit, 1], [0.8, 0.72], [1, 0]]);
  if (id === 'marauder') return {
    spread: plant * 0.30, width: plant * 0.062,
    leftLift: Math.sin(plant * Math.PI) * 0.052,
    drop: keyLerp(p, [[0, 0], [0.25, 0.135], [hit, 0.102], [0.69, 0.16], [1, 0]]),
    shift: keyLerp(p, [[0, 0], [0.24, -0.132], [hit, 0.163], [0.71, 0.133], [1, 0]]),
    side: keyLerp(p, [[0, 0], [0.25, 0.087], [hit, -0.105], [0.7, -0.145], [1, 0]]),
    hips: deg(keyLerp(p, [[0, 0], [0.22, 32], [hit, -26], [0.72, -33], [1, 0]])),
    chestYaw: deg(keyLerp(p, [[0, 0], [0.30, 15], [hit, -14], [0.69, -19], [1, 0]])),
    chestPitch: keyLerp(p, [[0, 0], [0.25, -0.095], [hit, 0.21], [0.71, 0.28], [1, 0]]),
    chestRoll: keyLerp(p, [[0, 0], [0.27, -0.15], [hit, 0.13], [0.73, 0.2], [1, 0]]),
    weight,
  };
  if (id === 'ranger') return {
    spread: plant * 0.22, width: plant * 0.044, leftLift: Math.sin(plant * Math.PI) * 0.033,
    drop: weight * 0.052,
    shift: weight * 0.025,
    side: keyLerp(p, [[0, 0], [0.36, 0.043], [hit, -0.026], [1, 0]]),
    hips: deg(31 * weight),
    chestYaw: keyLerp(p, [[0, 0], [0.36, 0.15], [hit, 0.12], [0.71, 0.16], [1, 0]]),
    chestPitch: 0.036 * weight, chestRoll: -0.045 * weight, weight,
  };
  return {
    spread: plant * 0.08, width: plant * 0.014, leftLift: Math.sin(plant * Math.PI) * 0.016,
    drop: weight * 0.027,
    shift: keyLerp(p, [[0, 0], [0.4, -0.031], [hit, 0.053], [1, 0]]),
    side: weight * -0.018,
    hips: deg(7 * weight),
    chestYaw: keyLerp(p, [[0, 0], [0.38, -0.11], [hit, 0.058], [1, 0]]),
    chestPitch: keyLerp(p, [[0, 0], [0.38, -0.064], [hit, 0.103], [1, 0]]),
    chestRoll: weight * 0.027,
    weight,
  };
}

export function staffPose(p: number) {
  const release = BASIC_ATTACK_CONTACT.projectile;
  return {
    raise: deg(keyLerp(p, [[0, 16], [0.39, 42], [release, 59], [0.76, 53], [1, 16]])),
    flex: deg(keyLerp(p, [[0, 29], [0.39, 85], [release, 46], [0.82, 41], [1, 29]])),
    freeRaise: deg(keyLerp(p, [[0, 7], [0.39, 41], [release, 29], [0.78, 25], [1, 7]])),
    freeFlex: deg(keyLerp(p, [[0, 13], [0.39, 72], [release, 53], [0.84, 37], [1, 13]])),
    pitch: keyLerp(p, [[0, -0.08], [0.39, -0.24], [release, 0.63], [0.83, 0.23], [1, -0.08]]),
  };
}

/** Torso-space direction from the fist to the axe head. Carry low; lift only to strike. */
export function axeHaft(p: number | null, speed: number) {
  const carry = { x: 0.14 + speed * 0.07, y: -0.4 - speed * 0.08, z: -0.87 };
  if (p === null) return carry;
  const contact = BASIC_ATTACK_CONTACT.melee;
  return {
    x: keyLerp(p, [[0, carry.x], [0.28, 0.55], [contact, 0.5], [0.72, -0.61], [1, carry.x]]),
    y: keyLerp(p, [[0, carry.y], [0.28, 0.73], [contact, 0.16], [0.72, -0.52], [1, carry.y]]),
    z: keyLerp(p, [[0, carry.z], [0.28, -0.44], [contact, 0.86], [0.72, 0.61], [1, carry.z]]),
  };
}

/** Bow-arm lift, cross-body draw, and quick slack after the loose. */
export function bowPose(p: number) {
  const release = BASIC_ATTACK_CONTACT.projectile;
  return {
    bowRaise: deg(keyLerp(p, [[0, 23], [0.26, 88], [0.48, 94], [release, 93], [0.83, 69], [1, 23]])),
    bowFlex: deg(keyLerp(p, [[0, 22], [0.26, 26], [release, 23], [0.83, 33], [1, 22]])),
    drawRaise: deg(keyLerp(p, [[0, 6], [0.24, 83], [0.48, 84], [release, 87], [0.75, 73], [1, 6]])),
    drawFlex: deg(keyLerp(p, [[0, 18], [0.24, 38], [0.48, 111], [release, 113], [0.75, 120], [1, 18]])),
    drawYaw: keyLerp(p, [[0, 0], [0.25, -0.6], [0.49, -0.64], [release, -0.62], [0.74, 0.23], [1, 0]]),
    tension: keyLerp(p, [[0, 0], [0.22, 0], [0.34, 0.86], [0.48, 1], [release, 1], [release + 0.045, 0], [1, 0]]),
  };
}
