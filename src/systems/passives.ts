import { getPassive, PASSIVE_NODES, PASSIVE_ROOT } from '../content/passives';
import type { GameState } from '../sim/state';
import { syncPlayerStats } from './stats';

/**
 * Passive skill tree rules (slice 6): one point per level, nodes unlock only
 * when every prerequisite is allocated, and a refund is blocked when it would
 * orphan an allocated node. Allocations and refunds are validated
 * transactions — nothing partial is ever written.
 */

export type PassiveRefusal =
  | 'unknown'
  | 'root'
  | 'already-allocated'
  | 'no-points'
  | 'locked'
  | 'not-allocated'
  | 'has-dependents';

export type PassiveResult = { ok: true } | { ok: false; reason: PassiveRefusal };

/** Total points earned: one per level gained (level 1 starts with none). */
export function passivePointsTotal(state: GameState): number {
  return Math.max(0, state.level - 1);
}

export function passivePointsSpent(state: GameState): number {
  return state.passives.allocated.filter((id) => id !== PASSIVE_ROOT).length;
}

export function passivePointsAvailable(state: GameState): number {
  return passivePointsTotal(state) - passivePointsSpent(state);
}

function isAllocated(state: GameState, id: string): boolean {
  return state.passives.allocated.includes(id);
}

export function canAllocatePassive(state: GameState, id: string): PassiveResult {
  const node = getPassive(id);
  if (!node) return { ok: false, reason: 'unknown' };
  if (id === PASSIVE_ROOT) return { ok: false, reason: 'root' };
  if (isAllocated(state, id)) return { ok: false, reason: 'already-allocated' };
  if (!node.prereqs.every((prereq) => isAllocated(state, prereq))) return { ok: false, reason: 'locked' };
  if (passivePointsAvailable(state) <= 0) return { ok: false, reason: 'no-points' };
  return { ok: true };
}

export function allocatePassive(state: GameState, id: string): PassiveResult {
  const result = canAllocatePassive(state, id);
  if (!result.ok) return result;
  state.passives.allocated.push(id);
  syncPlayerStats(state); // passive effects feed derived combat stats immediately
  return { ok: true };
}

export function canRefundPassive(state: GameState, id: string): PassiveResult {
  const node = getPassive(id);
  if (!node) return { ok: false, reason: 'unknown' };
  if (id === PASSIVE_ROOT) return { ok: false, reason: 'root' };
  if (!isAllocated(state, id)) return { ok: false, reason: 'not-allocated' };
  const orphans = PASSIVE_NODES.filter((n) => n.prereqs.includes(id) && isAllocated(state, n.id));
  if (orphans.length > 0) return { ok: false, reason: 'has-dependents' };
  return { ok: true };
}

export function refundPassive(state: GameState, id: string): PassiveResult {
  const result = canRefundPassive(state, id);
  if (!result.ok) return result;
  state.passives.allocated = state.passives.allocated.filter((allocated) => allocated !== id);
  syncPlayerStats(state);
  return { ok: true };
}

/** Short UI message for a refused transaction. */
export function passiveRefusalMessage(result: Extract<PassiveResult, { ok: false }>): string {
  switch (result.reason) {
    case 'unknown':
      return 'Unknown passive node';
    case 'root':
      return "The Exile's Path cannot be changed";
    case 'already-allocated':
      return 'Already allocated';
    case 'no-points':
      return 'No passive points left — level up to earn more';
    case 'locked':
      return 'Connect this node to your allocated path first';
    case 'not-allocated':
      return 'That node is not allocated';
    case 'has-dependents':
      return 'Refund the nodes beyond it first';
  }
}
