import { getEnemy } from '../content/enemies';
import type { EnemyState, GameState, SimEvent } from '../sim/state';
import { rollItem } from '../sim/items';
import { refillFlasksOnKill } from './flasks';
import { pickupDrop } from './inventory';
import { grantXp } from './progression';

/**
 * Loot pipeline: deaths award XP and may drop an item; drops are claimed by
 * walking over them (validated pickup transactions). Every kill also refills
 * one flask charge on each flask (slice 5).
 */
const DROP_CHANCE = 0.68;
const PICKUP_RADIUS = 1.5;

/** Called from the central damage pipeline on every enemy death. */
export function onEnemyDeath(state: GameState, enemy: EnemyState, events: SimEvent[]): void {
  const def = getEnemy(enemy.defId);
  grantXp(state, def.xp, events);
  refillFlasksOnKill(state);

  // Crafting economy: every kill gives dust, elites give a rune, the boss
  // awards a rune and a quality ember.
  state.currency.dust += 1;
  if (enemy.elite.length > 0) state.currency.rune += 1;
  if (def.boss) {
    state.currency.rune += 2;
    state.currency.quality += 1;
  }

  if (state.rng() > DROP_CHANCE) return;
  const itemLevel = Math.max(1, Math.round(state.level * 0.8 + 1 + state.rng() * 2));
  const item = rollItem(state.rng, itemLevel);
  const angle = state.rng() * Math.PI * 2;
  const drop = {
    id: `drop-${state.tick}-${state.loot.length}-${Math.floor(state.rng() * 1e6)}`,
    item,
    x: enemy.position.x + Math.cos(angle) * 0.9,
    z: enemy.position.z + Math.sin(angle) * 0.9,
  };
  state.loot.push(drop);
}

/** Auto-pickup when the player walks over a drop. */
export function stepPickups(state: GameState, events: SimEvent[]): void {
  if (state.loot.length === 0) return;
  for (const drop of [...state.loot]) {
    const dist = Math.hypot(drop.x - state.player.position.x, drop.z - state.player.position.z);
    if (dist > PICKUP_RADIUS) continue;
    const result = pickupDrop(state, drop.id, events);
    if (!result.ok && result.reason === 'bag-full') break; // no partial spam
  }
}
