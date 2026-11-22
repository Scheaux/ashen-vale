/**
 * Deterministic seeded RNG (mulberry32). All gameplay-relevant randomness
 * (zone population, prop placement) must flow through a seeded instance so
 * tests and replays are reproducible.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Integer in [min, max] (inclusive). */
export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty array');
  return items[Math.floor(rng() * items.length)];
}

/** True with probability p (0..1). */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
