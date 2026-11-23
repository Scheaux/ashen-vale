import type { GameState, SimEvent } from '../sim/state';

/**
 * Health and mana flasks with refill-on-kill charges (slice 5). Consumption
 * and refill go through here so charge accounting has a single owner.
 */
export type FlaskKind = 'health' | 'mana';

const HEALTH_RESTORE = 0.4;
const MANA_RESTORE = 0.55;

const FLASK_LABEL: Record<FlaskKind, string> = {
  health: 'Health Flask',
  mana: 'Mana Flask',
};

/** Drink a flask charge. Refuses (and reports why) when empty or dead. */
export function useFlask(state: GameState, kind: FlaskKind, events: SimEvent[]): boolean {
  const p = state.player;
  if (p.hp <= 0) return false;
  const flask = state.flasks[kind];
  if (flask.charges <= 0) {
    events.push({ kind: 'refuse', reason: 'flask-empty', label: FLASK_LABEL[kind] });
    return false;
  }
  flask.charges -= 1;
  if (kind === 'health') {
    const amount = Math.round(p.maxHp * HEALTH_RESTORE);
    p.hp = Math.min(p.maxHp, p.hp + amount);
    events.push({ kind: 'resource', resource: 'health', amount, x: p.position.x, y: 2.1, z: p.position.z });
  } else {
    const amount = Math.round(p.maxMana * MANA_RESTORE);
    p.mana = Math.min(p.maxMana, p.mana + amount);
    events.push({ kind: 'resource', resource: 'mana', amount, x: p.position.x, y: 2.1, z: p.position.z });
  }
  return true;
}

/** Every kill tops up each flask by one charge, capped at its maximum. */
export function refillFlasksOnKill(state: GameState): void {
  for (const kind of ['health', 'mana'] as const) {
    const flask = state.flasks[kind];
    flask.charges = Math.min(flask.max, flask.charges + 1);
  }
}

/** Full refill after death: a fresh attempt starts with full tools. */
export function refillFlasks(state: GameState): void {
  state.flasks.health.charges = state.flasks.health.max;
  state.flasks.mana.charges = state.flasks.mana.max;
}
