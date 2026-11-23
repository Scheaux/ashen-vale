/** Shared math helpers for simulation and rendering. */

/** Lerp between angles along the shortest arc. */
export function angleLerp(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

/** Signed shortest-arc angle difference (b - a), in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Squared distance to a finite horizontal segment, including its endpoints. */
export function segmentDistanceSq(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1) : 0;
  return (px - ax - t * dx) ** 2 + (pz - az - t * dz) ** 2;
}
