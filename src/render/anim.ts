import { clamp } from '../core/math';

/**
 * Procedural animation curves for the jointed rigs.
 *
 * ANIMATION RULES (condensed from the combat-animation standard;
 * the marked rules are measured by anim.test.ts against these curves):
 *   1. Every strike is anticipation -> contact -> recovery on the game clock. (reviewed)
 *   2. Shoulder raise <= 105deg from hanging at all times; no overhead raises. (test)
 *   3. Elbow flexion stays in [10, 152]deg; the striking arm keeps >= 20deg
 *      through the middle 80% of the move. (test)
 *   4. Contact reach: hand >= 60% of arm length from the shoulder at contact —
 *      reach into the blow, never lock the elbow. (test)
 *   5. Kinetic chain: hips lead the chest, the chest leads the arm. (reviewed)
 *   6. Follow-through carries the hand past the hip on a bent elbow; the arm
 *      never freezes pointing at the foe. (reviewed)
 *   7. Hands hold a pose: fist on grips, relaxed when empty. (reviewed)
 *   8. Poses are judged from the isometric game camera, not from the front. (reviewed)
 */

export function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/** Canonical arm segment lengths (shared by rigs and measurement tests). */
export const HERO_ARM = { upper: 0.28, fore: 0.26, contact: 0.45 } as const;
export const HUSK_ARM = { upper: 0.34, fore: 0.32, contact: 0.5 } as const;

export const ARM_RULES = {
  maxRaise: deg(105),
  minFlex: deg(10),
  maxFlex: deg(152),
  minMidFlex: deg(20),
  minContactReachRatio: 0.6,
} as const;

/** Smoothstep-eased interpolation across [[t, value], ...] control points. */
export function keyLerp(p: number, keys: ReadonlyArray<readonly [number, number]>): number {
  const t = clamp(p, 0, 1);
  if (keys.length === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const span = t1 - t0;
      const k = span <= 0 ? 1 : (t - t0) / span;
      const e = k * k * (3 - 2 * k);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}

export interface ArmPose {
  /** Shoulder raise from hanging; positive = forward/up. */
  raiseRad: number;
  /** Elbow flexion; 0 = straight. */
  flexRad: number;
}

/** Shared pose driver for all creature rigs (husk, cultist, skitterer). */
export interface CreaturePoseInput {
  time: number;
  /** Distance traveled this frame, for the walk phase (feet stay glued). */
  distance: number;
  speedRatio: number;
  /** Strike-curve progress in [0, 1], or null when not attacking. */
  attack: number | null;
  hit: number | null;
  death: number | null;
}

/**
 * Map the AI phase machine onto the strike curve: windup plays the
 * anticipation (0 -> 0.42), active the contact (-> 0.52), recovery the
 * follow-through (-> 1). Animation therefore always follows sim state.
 */
export function phaseAttackProgress(
  phase: 'idle' | 'chase' | 'windup' | 'active' | 'recovery',
  phaseTime: number,
  attack: { windup: number; active: number; recovery: number },
): number | null {
  switch (phase) {
    case 'windup':
      return clamp(phaseTime / Math.max(0.001, attack.windup), 0, 1) * 0.42;
    case 'active':
      return 0.42 + clamp(phaseTime / Math.max(0.001, attack.active), 0, 1) * 0.1;
    case 'recovery':
      return 0.52 + clamp(phaseTime / Math.max(0.001, attack.recovery), 0, 1) * 0.48;
    default:
      return null;
  }
}

/**
 * Straight-line distance from shoulder to hand for a two-segment arm with the
 * given elbow flexion (law of cosines).
 */
export function handDistance(upper: number, fore: number, flexRad: number): number {
  return Math.sqrt(upper * upper + fore * fore + 2 * upper * fore * Math.cos(flexRad));
}

// ---------------------------------------------------------------------------
// Hero: melee cleave (anticipation -> contact -> follow-through -> settle)
// ---------------------------------------------------------------------------

const HERO_MELEE_RAISE: ReadonlyArray<readonly [number, number]> = [
  [0, 8], [0.3, 95], [0.45, 55], [0.7, -12], [1, 8],
];
const HERO_MELEE_FLEX: ReadonlyArray<readonly [number, number]> = [
  [0, 12], [0.3, 88], [0.45, 42], [0.7, 72], [1, 12],
];
const HERO_MELEE_TWIST: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.3, 24], [0.45, -28], [0.72, -7], [1, 0],
];
const HERO_MELEE_LEAN: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.3, -5], [0.45, 7], [0.7, 3], [1, 0],
];

export function heroMeleeArm(p: number): ArmPose {
  return {
    raiseRad: deg(keyLerp(p, HERO_MELEE_RAISE)),
    flexRad: deg(keyLerp(p, HERO_MELEE_FLEX)),
  };
}

export function heroMeleeTorso(p: number): { twistRad: number; leanRad: number } {
  return {
    twistRad: deg(keyLerp(p, HERO_MELEE_TWIST)),
    leanRad: deg(keyLerp(p, HERO_MELEE_LEAN)),
  };
}

// ---------------------------------------------------------------------------
// Hero: ranged release (draw/charge -> hold -> release snap -> settle)
// ---------------------------------------------------------------------------

const HERO_RANGED_RAISE: ReadonlyArray<readonly [number, number]> = [
  [0, 15], [0.22, 62], [0.5, 62], [0.6, 72], [0.8, 42], [1, 15],
];
const HERO_RANGED_FLEX: ReadonlyArray<readonly [number, number]> = [
  [0, 15], [0.22, 88], [0.5, 88], [0.6, 34], [0.8, 30], [1, 15],
];
const HERO_RANGED_TWIST: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.22, -18], [0.5, -18], [0.6, 8], [0.8, 2], [1, 0],
];

export function heroRangedArm(p: number): ArmPose {
  return {
    raiseRad: deg(keyLerp(p, HERO_RANGED_RAISE)),
    flexRad: deg(keyLerp(p, HERO_RANGED_FLEX)),
  };
}

export function heroRangedTorso(p: number): { twistRad: number; leanRad: number } {
  return {
    twistRad: deg(keyLerp(p, HERO_RANGED_TWIST)),
    leanRad: deg(keyLerp(p, HERO_MELEE_LEAN)) * 0.5,
  };
}

// ---------------------------------------------------------------------------
// Husk: two-arm slam (high chamber -> slam -> dig out)
// ---------------------------------------------------------------------------

const HUSK_SLAM_RAISE: ReadonlyArray<readonly [number, number]> = [
  [0, 6], [0.42, 100], [0.52, 25], [0.72, -14], [1, 6],
];
const HUSK_SLAM_FLEX: ReadonlyArray<readonly [number, number]> = [
  [0, 16], [0.42, 60], [0.52, 32], [0.72, 58], [1, 16],
];
const HUSK_SLAM_LEAN: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.42, -10], [0.52, 16], [0.72, 8], [1, 0],
];

export function huskSlamArm(p: number): ArmPose {
  return {
    raiseRad: deg(keyLerp(p, HUSK_SLAM_RAISE)),
    flexRad: deg(keyLerp(p, HUSK_SLAM_FLEX)),
  };
}

export function huskSlamLean(p: number): number {
  return deg(keyLerp(p, HUSK_SLAM_LEAN));
}

// ---------------------------------------------------------------------------
// Shared layers: locomotion, idle, hit, death
// ---------------------------------------------------------------------------

export interface WalkPose {
  legForwardL: number;
  legForwardR: number;
  kneeL: number;
  kneeR: number;
  armForwardL: number;
  armForwardR: number;
  bob: number;
  hipsTwist: number;
  torsoTwist: number;
}

export function walkPose(phase: number, speedRatio: number): WalkPose {
  const s = clamp(speedRatio, 0, 1);
  return {
    legForwardL: Math.sin(phase) * 0.62 * s,
    legForwardR: Math.sin(phase + Math.PI) * 0.62 * s,
    kneeL: Math.max(0, Math.sin(phase + 1.1)) * 0.85 * s,
    kneeR: Math.max(0, Math.sin(phase + Math.PI + 1.1)) * 0.85 * s,
    armForwardL: Math.sin(phase + Math.PI) * 0.42 * s,
    armForwardR: Math.sin(phase) * 0.42 * s,
    bob: -Math.cos(2 * phase) * 0.022 * s,
    hipsTwist: Math.sin(phase) * 0.07 * s,
    torsoTwist: -Math.sin(phase) * 0.09 * s,
  };
}

export function idlePose(time: number): {
  breathe: number;
  sway: number;
  headYaw: number;
  armSway: number;
} {
  return {
    breathe: Math.sin(time * 1.5) * 0.022,
    sway: Math.sin(time * 0.6) * 0.03,
    headYaw: Math.sin(time * 0.42) * 0.16,
    armSway: Math.sin(time * 1.05) * 0.045,
  };
}

export function hitFlinch(p: number): { leanRad: number; headRad: number; armFlareRad: number } {
  const env = Math.sin(clamp(p, 0, 1) * Math.PI);
  return {
    leanRad: -deg(14) * env,
    headRad: -deg(18) * env,
    armFlareRad: deg(10) * env,
  };
}

export function deathCurve(p: number): { fallRad: number; slumpRad: number; legFoldRad: number } {
  const t = clamp(p, 0, 1);
  const fall = t * t * (3 - 2 * t);
  return {
    fallRad: deg(82) * fall,
    slumpRad: deg(34) * fall,
    legFoldRad: deg(72) * fall,
  };
}

/** Advances by distance traveled so feet stay glued to the ground. */
export function walkPhaseAdvance(phase: number, distance: number, frequency = 2.2): number {
  return (phase + distance * frequency) % (Math.PI * 2);
}

/** Attack/hit timing envelope shared by every rig. */
export class AnimClock {
  attack = 0;
  hit = 0;
  attackDuration = 0.42;
  hitDuration = 0.26;

  advance(dt: number): void {
    this.attack = Math.max(0, this.attack - dt);
    this.hit = Math.max(0, this.hit - dt);
  }

  triggerAttack(): void {
    this.attack = this.attackDuration;
  }

  triggerHit(): void {
    this.hit = this.hitDuration;
  }

  /** Attack progress in [0, 1], or null when idle. */
  get attackProgress(): number | null {
    return this.attack > 0 ? 1 - this.attack / this.attackDuration : null;
  }

  get hitProgress(): number | null {
    return this.hit > 0 ? 1 - this.hit / this.hitDuration : null;
  }
}
