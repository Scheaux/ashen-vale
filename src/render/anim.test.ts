import { describe, expect, it } from 'vitest';
import * as A from './anim';

/**
 * Measurement tests for the combat-animation standard (see anim.ts).
 * These sample the actual curves the rigs play and assert the arm rules,
 * so a bad keyframe fails CI before anyone has to look at a frame.
 */

const SAMPLES = Array.from({ length: 201 }, (_, i) => i / 200);
const MID = SAMPLES.filter((p) => p >= 0.1 && p <= 0.9);

describe('keyLerp', () => {
  it('eases between control points and clamps outside them', () => {
    const keys: Array<[number, number]> = [
      [0, 10],
      [1, 50],
    ];
    expect(A.keyLerp(-1, keys)).toBe(10);
    expect(A.keyLerp(2, keys)).toBe(50);
    expect(A.keyLerp(0.5, keys)).toBeCloseTo(30, 5);
    expect(A.keyLerp(0.25, keys)).toBeGreaterThan(10);
    expect(A.keyLerp(0.25, keys)).toBeLessThan(30);
  });

  it('returns flat values before the first and after the last key', () => {
    const keys: Array<[number, number]> = [
      [0.2, 3],
      [0.8, 7],
    ];
    expect(A.keyLerp(0, keys)).toBe(3);
    expect(A.keyLerp(1, keys)).toBe(7);
  });
});

describe('hero melee strike (measured rules)', () => {
  it('rule 2: shoulder raise never exceeds 105deg', () => {
    for (const p of SAMPLES) {
      expect(Math.abs(A.heroMeleeArm(p).raiseRad)).toBeLessThanOrEqual(A.ARM_RULES.maxRaise + 1e-9);
    }
  });

  it('rule 3: elbow flexion stays within [10, 152]deg', () => {
    for (const p of SAMPLES) {
      const flex = A.heroMeleeArm(p).flexRad;
      expect(flex).toBeGreaterThanOrEqual(A.ARM_RULES.minFlex - 1e-9);
      expect(flex).toBeLessThanOrEqual(A.ARM_RULES.maxFlex + 1e-9);
    }
  });

  it('rule 3: striking elbow keeps >= 20deg through the middle 80%', () => {
    for (const p of MID) {
      expect(A.heroMeleeArm(p).flexRad).toBeGreaterThanOrEqual(A.ARM_RULES.minMidFlex);
    }
  });

  it('rule 4: contact reach >= 60% of arm length at contact', () => {
    const arm = A.heroMeleeArm(A.HERO_ARM.contact);
    const dist = A.handDistance(A.HERO_ARM.upper, A.HERO_ARM.fore, arm.flexRad);
    expect(dist / (A.HERO_ARM.upper + A.HERO_ARM.fore)).toBeGreaterThanOrEqual(A.ARM_RULES.minContactReachRatio);
  });
});

describe('hero ranged release (measured rules)', () => {
  it('rules 2-4 hold for the draw/release arm', () => {
    for (const p of SAMPLES) {
      const arm = A.heroRangedArm(p);
      expect(Math.abs(arm.raiseRad)).toBeLessThanOrEqual(A.ARM_RULES.maxRaise + 1e-9);
      expect(arm.flexRad).toBeGreaterThanOrEqual(A.ARM_RULES.minFlex - 1e-9);
      expect(arm.flexRad).toBeLessThanOrEqual(A.ARM_RULES.maxFlex + 1e-9);
    }
    for (const p of MID) {
      expect(A.heroRangedArm(p).flexRad).toBeGreaterThanOrEqual(A.ARM_RULES.minMidFlex);
    }
    const contact = A.heroRangedArm(0.6);
    const dist = A.handDistance(A.HERO_ARM.upper, A.HERO_ARM.fore, contact.flexRad);
    expect(dist / (A.HERO_ARM.upper + A.HERO_ARM.fore)).toBeGreaterThanOrEqual(A.ARM_RULES.minContactReachRatio);
  });
});

describe('husk slam (measured rules)', () => {
  it('rules 2-4 hold for both slamming arms', () => {
    for (const p of SAMPLES) {
      const arm = A.huskSlamArm(p);
      expect(Math.abs(arm.raiseRad)).toBeLessThanOrEqual(A.ARM_RULES.maxRaise + 1e-9);
      expect(arm.flexRad).toBeGreaterThanOrEqual(A.ARM_RULES.minFlex - 1e-9);
      expect(arm.flexRad).toBeLessThanOrEqual(A.ARM_RULES.maxFlex + 1e-9);
    }
    for (const p of MID) {
      expect(A.huskSlamArm(p).flexRad).toBeGreaterThanOrEqual(A.ARM_RULES.minMidFlex);
    }
    const contact = A.huskSlamArm(A.HUSK_ARM.contact);
    const dist = A.handDistance(A.HUSK_ARM.upper, A.HUSK_ARM.fore, contact.flexRad);
    expect(dist / (A.HUSK_ARM.upper + A.HUSK_ARM.fore)).toBeGreaterThanOrEqual(A.ARM_RULES.minContactReachRatio);
  });
});

describe('locomotion and layers', () => {
  it('walk pose outputs stay bounded', () => {
    for (const phase of SAMPLES.map((p) => p * Math.PI * 2)) {
      for (const s of [0, 0.5, 1]) {
        const w = A.walkPose(phase, s);
        for (const v of Object.values(w)) {
          expect(Math.abs(v)).toBeLessThanOrEqual(1);
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  it('walk phase advances by distance and wraps', () => {
    const phase = A.walkPhaseAdvance(6, 0.2);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
    expect(A.walkPhaseAdvance(0, 0)).toBe(0);
  });

  it('hit flinch is a bounded envelope that returns to rest', () => {
    expect(A.hitFlinch(0).leanRad).toBeCloseTo(0, 6);
    expect(A.hitFlinch(1).leanRad).toBeCloseTo(0, 6);
    expect(Math.abs(A.hitFlinch(0.5).leanRad)).toBeGreaterThan(0);
  });

  it('death curve falls and settles monotonically', () => {
    const a = A.deathCurve(0.2).fallRad;
    const b = A.deathCurve(0.5).fallRad;
    const c = A.deathCurve(1).fallRad;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe('HitClock', () => {
  it('runs the cosmetic flinch once and returns to idle', () => {
    const clock = new A.HitClock();
    expect(clock.hitProgress).toBeNull();
    clock.triggerHit();
    expect(clock.hitProgress).toBe(0);
    clock.advance(clock.hitDuration / 2);
    expect(clock.hitProgress).toBeCloseTo(0.5);
    clock.advance(10);
    expect(clock.hitProgress).toBeNull();
  });
});
