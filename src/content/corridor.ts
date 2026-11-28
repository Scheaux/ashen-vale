import type { Vec2, ZoneCorridor } from './types';

/** Nearest point on a corridor polyline, with its segment and arc parameter. */
export interface CorridorProjection extends Vec2 {
  /** Distance from the query point to the polyline. */
  distance: number;
  /** Segment index, or -1 for an empty corridor. */
  segment: number;
  /** Parameter along the chosen segment, 0..1. */
  t: number;
}

const EMPTY_PROJECTION: CorridorProjection = { x: 0, z: 0, distance: Infinity, segment: -1, t: 0 };

/** Closest point on the corridor centerline. Pure; keeps the nearest segment. */
export function projectToCorridor(corridor: ZoneCorridor, x: number, z: number): CorridorProjection {
  const points = corridor.points;
  if (points.length === 0) return { ...EMPTY_PROJECTION };
  if (points.length === 1) {
    const p = points[0];
    return { x: p.x, z: p.z, distance: Math.hypot(x - p.x, z - p.z), segment: 0, t: 0 };
  }

  let bestX = points[0].x;
  let bestZ = points[0].z;
  let bestDistSq = Infinity;
  let bestSegment = 0;
  let bestT = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    let t = 0;
    if (lenSq > 1e-12) {
      t = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distSq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestX = px;
      bestZ = pz;
      bestSegment = i;
      bestT = t;
    }
  }

  return { x: bestX, z: bestZ, distance: Math.sqrt(bestDistSq), segment: bestSegment, t: bestT };
}

/** Distance from a world point to the walkable corridor's centerline. */
export function distanceToCorridor(corridor: ZoneCorridor, x: number, z: number): number {
  return projectToCorridor(corridor, x, z).distance;
}

/** True when a point (optionally with a margin) lies in the capsule band. */
export function isInsideCorridor(corridor: ZoneCorridor, x: number, z: number, margin = 0): boolean {
  return distanceToCorridor(corridor, x, z) <= Math.max(0, corridor.radius - margin);
}

/** Clamp a point into the corridor band, including the rounded end caps. */
export function clampToCorridor(
  corridor: ZoneCorridor,
  x: number,
  z: number,
  margin = 0,
): Vec2 {
  const projection = projectToCorridor(corridor, x, z);
  const limit = Math.max(0, corridor.radius - margin);
  if (projection.distance <= limit || projection.distance < 1e-9) return { x, z };
  const scale = limit / projection.distance;
  return {
    x: projection.x + (x - projection.x) * scale,
    z: projection.z + (z - projection.z) * scale,
  };
}

/**
 * Keep a circle inside the corridor, cancelling outward velocity at the rim.
 * Returns true when the position moved.
 */
export function clampCircleToCorridor(
  position: Vec2,
  velocity: Vec2 | null,
  radius: number,
  corridor: ZoneCorridor,
): boolean {
  const projection = projectToCorridor(corridor, position.x, position.z);
  const limit = Math.max(0, corridor.radius - radius);
  if (projection.distance <= limit) return false;
  if (projection.distance < 1e-9) return false;

  const nx = (position.x - projection.x) / projection.distance;
  const nz = (position.z - projection.z) / projection.distance;
  position.x = projection.x + nx * limit;
  position.z = projection.z + nz * limit;
  if (velocity) {
    const vn = velocity.x * nx + velocity.z * nz;
    if (vn > 0) {
      velocity.x -= nx * vn;
      velocity.z -= nz * vn;
    }
  }
  return true;
}

/** Length of one polyline segment. */
export function corridorSegmentLength(corridor: ZoneCorridor, segment: number): number {
  const a = corridor.points[segment];
  const b = corridor.points[segment + 1];
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export interface CorridorSample extends Vec2 {
  /** Unit tangent pointing along the corridor (toward the end clearing). */
  tangentX: number;
  tangentZ: number;
  /** Unit normal to the right of the tangent. */
  normalX: number;
  normalZ: number;
  segment: number;
  t: number;
}

/** Sample a point and frame on a corridor segment at parameter t (0..1). */
export function corridorSample(
  corridor: ZoneCorridor,
  segment: number,
  t: number,
): CorridorSample {
  const a = corridor.points[segment] ?? corridor.points[0] ?? { x: 0, z: 0 };
  const b = corridor.points[segment + 1] ?? a;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const tx = len > 1e-9 ? dx / len : 0;
  const tz = len > 1e-9 ? dz / len : 1;
  return {
    x: a.x + dx * t,
    z: a.z + dz * t,
    tangentX: tx,
    tangentZ: tz,
    normalX: tz,
    normalZ: -tx,
    segment,
    t,
  };
}
