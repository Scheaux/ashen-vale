import { angleLerp } from '../core/math';
import type { CircleCollider, ZoneBounds, ZoneLayout } from '../content/types';
import type { GameState, Vec2 } from '../sim/state';

/**
 * Click-to-move steering with arrival slowdown, circle-vs-circle collision
 * resolution against zone colliders, and a soft circular boundary.
 * Pure and deterministic: same state + same dt => same result.
 */

const ARRIVE_EPSILON = 0.14;
const SLOW_RADIUS = 1.3;
const ACCEL = 14;
const STOP_SPEED = 0.02;

/** Set the move destination, clamped inside the walkable bounds. */
export function setMoveTarget(state: GameState, target: Vec2): void {
  const { center, radius } = activeBounds(state);
  const dx = target.x - center.x;
  const dz = target.z - center.z;
  const dist = Math.hypot(dx, dz);
  const maxDist = radius - 1;
  let x = target.x;
  let z = target.z;
  if (dist > maxDist) {
    x = center.x + (dx / dist) * maxDist;
    z = center.z + (dz / dist) * maxDist;
  }
  state.player.moveTarget = { x, z };
}

/**
 * The whole zone stays walkable. The end-zone Warden has no arena clamp, so
 * the hero can retreat down the moor mid-fight; the arena only drives the
 * encounter trigger, AI leash and checkpoint threshold.
 */
export function activeBounds(state: GameState): ZoneBounds {
  return state.bounds;
}

/**
 * Checkpoint/Continue respawn point: a live boss fight restarts the hero just
 * inside the arena threshold on the zone-spawn side; otherwise the normal zone
 * spawn is used. The result is clamped to the walkable zone bounds.
 */
export function respawnPointFor(state: GameState, layout: ZoneLayout): Vec2 {
  const o = state.objectives;
  if (!o.bossSpawned || o.bossDefeated) {
    return { x: layout.spawn.x, z: layout.spawn.z };
  }

  const { center, radius } = state.arena;
  const inset = Math.min(1, radius / 2);
  const dx = layout.spawn.x - center.x;
  const dz = layout.spawn.z - center.z;
  const dist = Math.hypot(dx, dz);
  const nx = dist > 1e-6 ? dx / dist : 0;
  const nz = dist > 1e-6 ? dz / dist : 1;
  let x = center.x + nx * (radius - inset);
  let z = center.z + nz * (radius - inset);

  // The arena is inside the zone in normal layouts; keep the threshold legal
  // even when a fixture places it close to the outer walkable boundary.
  const bx = x - layout.bounds.center.x;
  const bz = z - layout.bounds.center.z;
  const boundDist = Math.hypot(bx, bz);
  const limit = Math.max(0, layout.bounds.radius - state.player.radius);
  if (boundDist > limit && boundDist > 0) {
    const scale = limit / boundDist;
    x = layout.bounds.center.x + bx * scale;
    z = layout.bounds.center.z + bz * scale;
  }
  return { x, z };
}

export function cancelMove(state: GameState): void {
  state.player.moveTarget = null;
}

/** Push a circle out of overlapping colliders and cancel inward velocity. */
export function resolveCircleCollisions(
  position: Vec2,
  velocity: Vec2,
  radius: number,
  colliders: readonly CircleCollider[],
): void {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of colliders) {
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const minDist = radius + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist) continue;

      if (d2 <= 1e-9) {
        // Degenerate overlap: push out along +Z.
        position.z += minDist;
        if (velocity.z < 0) velocity.z = 0;
      } else {
        const d = Math.sqrt(d2);
        const push = (minDist - d) / d;
        position.x += dx * push;
        position.z += dz * push;
        // Cancel the inward velocity component so bodies slide, not stick.
        const nx = dx / d;
        const nz = dz / d;
        const vn = velocity.x * nx + velocity.z * nz;
        if (vn < 0) {
          velocity.x -= nx * vn;
          velocity.z -= nz * vn;
        }
      }
      moved = true;
    }
    if (!moved) break;
  }
}

/** Keep a circle inside the zone bounds; cancels outward velocity at the rim. */
export function clampCircleToBounds(
  position: Vec2,
  velocity: Vec2 | null,
  radius: number,
  bounds: ZoneBounds,
): boolean {
  const { center, radius: boundRadius } = bounds;
  const dx = position.x - center.x;
  const dz = position.z - center.z;
  const dist = Math.hypot(dx, dz);
  const maxDist = boundRadius - radius;
  if (dist <= maxDist) return false;

  const nx = dx / dist;
  const nz = dz / dist;
  position.x = center.x + nx * maxDist;
  position.z = center.z + nz * maxDist;
  if (velocity) {
    const vn = velocity.x * nx + velocity.z * nz;
    if (vn > 0) {
      velocity.x -= nx * vn;
      velocity.z -= nz * vn;
    }
  }
  return true;
}

/** Advance player movement by one fixed sim tick. */
export function stepMovement(state: GameState, dt: number): void {
  const p = state.player;
  let desiredX = 0;
  let desiredZ = 0;

  if (p.moveTarget && !p.attack) {
    const dx = p.moveTarget.x - p.position.x;
    const dz = p.moveTarget.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= ARRIVE_EPSILON) {
      p.moveTarget = null;
    } else {
      const speedScale = Math.min(1, dist / SLOW_RADIUS);
      desiredX = (dx / dist) * p.speed * speedScale;
      desiredZ = (dz / dist) * p.speed * speedScale;
    }
  }

  const blend = Math.min(1, ACCEL * dt);
  p.velocity.x += (desiredX - p.velocity.x) * blend;
  p.velocity.z += (desiredZ - p.velocity.z) * blend;
  if (!p.moveTarget && Math.hypot(p.velocity.x, p.velocity.z) < STOP_SPEED) {
    p.velocity.x = 0;
    p.velocity.z = 0;
  }

  p.previousPosition.x = p.position.x;
  p.previousPosition.z = p.position.z;

  p.position.x += p.velocity.x * dt;
  p.position.z += p.velocity.z * dt;

  resolveCircleCollisions(p.position, p.velocity, p.radius, state.colliders);
  clampCircleToBounds(p.position, p.velocity, p.radius, activeBounds(state));

  const speedNow = Math.hypot(p.velocity.x, p.velocity.z);
  if (speedNow > 0.1) {
    const targetFacing = Math.atan2(p.velocity.x, p.velocity.z);
    p.facing = angleLerp(p.facing, targetFacing, Math.min(1, 12 * dt));
  }

  state.tick += 1;
}
