import type { GameState, HazardState, SimEvent } from '../sim/state';
import { damagePlayer } from './combat';

function playerInside(state: GameState, hazard: HazardState): boolean {
  const p = state.player;
  return Math.hypot(p.position.x - hazard.x, p.position.z - hazard.z) <= hazard.radius + p.radius;
}

function hitPlayer(state: GameState, hazard: HazardState, events: SimEvent[]): void {
  if (!playerInside(state, hazard)) return;
  damagePlayer(state, hazard.damage, events, {
    attackId: hazard.id,
    sourceName: hazard.sourceName,
    damageClass: 'spell',
  });
}

/**
 * Advance hazards: a telegraphed fuse, one detonation, then optional pool
 * ticks. The telegraph event is emitted at spawn so the tell-order recorder
 * can attribute each damage tick to a preceding warning.
 */
export function stepHazards(state: GameState, dt: number, events: SimEvent[]): void {
  if (state.hazards.length === 0) return;
  const remaining: HazardState[] = [];
  for (const hazard of state.hazards) {
    hazard.age += dt;

    if (!hazard.detonated) {
      if (hazard.age < hazard.fuse) {
        remaining.push(hazard);
        continue;
      }
      hazard.detonated = true;
      hitPlayer(state, hazard, events);
      if (hazard.duration <= 0) continue;
      hazard.tickTimer = hazard.tickInterval;
      remaining.push(hazard);
      continue;
    }

    hazard.tickTimer -= dt;
    if (hazard.tickTimer <= 0) {
      hitPlayer(state, hazard, events);
      hazard.tickTimer += hazard.tickInterval;
    }
    if (hazard.age < hazard.fuse + hazard.duration) remaining.push(hazard);
  }
  state.hazards = remaining;
}
