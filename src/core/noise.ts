/**
 * Smooth, seedless 2D value noise for terrain shaping and texture detail.
 * Deterministic for given coordinates (hash-based, no global state).
 */
function hash2(xi: number, yi: number): number {
  let h = (xi * 374761393 + yi * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [-1, 1]. */
export function noise2D(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const value = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return value * 2 - 1;
}

/** Two-octave noise in roughly [-1, 1]. */
export function fbm2D(x: number, y: number, octaves = 2): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** Hermite smoothstep between edges a and b, clamped to [0, 1]. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
