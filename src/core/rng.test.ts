import { describe, expect, it } from 'vitest';
import { chance, createRng, int, pick, range } from './rng';

describe('createRng', () => {
  it('produces a deterministic sequence for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('helpers', () => {
  it('range stays within bounds', () => {
    const rng = createRng(9);
    for (let i = 0; i < 500; i++) {
      const v = range(rng, -3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
  });

  it('int is inclusive on both ends', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(int(rng, 1, 3));
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it('pick returns elements of the array only', () => {
    const rng = createRng(13);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
    expect(() => pick(rng, [])).toThrow();
  });

  it('chance respects probability extremes', () => {
    const rng = createRng(17);
    for (let i = 0; i < 50; i++) {
      expect(chance(rng, 1)).toBe(true);
      expect(chance(rng, 0)).toBe(false);
    }
  });
});
