import type { GameState, SimEvent } from '../sim/state';
import { syncPlayerStats } from './stats';

/** XP needed to advance from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(60 * Math.pow(level, 1.45));
}

/** Grant XP; level-ups are atomic per grant and always fully applied. */
export function grantXp(state: GameState, amount: number, events: SimEvent[]): void {
  state.xp += Math.max(0, Math.round(amount));
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext;
    state.level += 1;
    state.xpToNext = xpToNext(state.level);
    syncPlayerStats(state); // level growth feeds maxHp/speed
    events.push({ kind: 'levelup', level: state.level });
  }
}
