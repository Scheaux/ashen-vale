import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { getZoneDef } from '../content/zones';
import { createEnemyState, createGameState, type GameState } from '../sim/state';
import { respawnPointFor } from '../systems/movement';
import { syncPlayerStats } from '../systems/stats';
import { restoredXpToNext, type SaveGame } from './schema';

/**
 * Rebuild a live GameState from a character checkpoint. Saves are milestone
 * snapshots, not replay state: the live layout rebuilds the zone, cleared
 * camps stay cleared, and a boss fight that was live restarts from its spawn.
 * 5.0b only knows the moor; ossuary saves stay on disk until 5.0d.
 */
export function restoreGameState(save: SaveGame, layout: ZoneLayout): GameState {
  if (save.zoneId !== 'ashen-moor') {
    throw new Error(`${getZoneDef(save.zoneId).name} is not available yet`);
  }
  if (save.zoneSeed !== layout.seed) {
    throw new Error('That save belongs to a different realm');
  }

  const state = createGameState(getClass(save.classId), layout, 0xc0ffee, save.zoneId);
  state.level = save.level;
  state.xp = save.xp;
  state.xpToNext = restoredXpToNext(save.level);
  state.passives.allocated = [...save.passives];
  state.skills.ranks = { ...save.skills.ranks };
  state.skills.loadout = [...save.skills.loadout];
  state.skills.runes = { ...save.skills.runes };
  state.currency = { ...save.currency };
  state.inventory = {
    bags: save.inventory.bags.map((item) => ({
      ...item,
      implicit: item.implicit ? { ...item.implicit } : null,
      affixes: item.affixes.map((affix) => ({ ...affix })),
    })),
    equipment: Object.fromEntries(
      Object.entries(save.inventory.equipment).map(([slot, item]) => [
        slot,
        item
          ? { ...item, implicit: item.implicit ? { ...item.implicit } : null, affixes: item.affixes.map((affix) => ({ ...affix })) }
          : null,
      ]),
    ) as GameState['inventory']['equipment'],
  };

  syncPlayerStats(state);
  const p = state.player;
  p.hp = Math.min(save.hp > 0 ? save.hp : p.maxHp, p.maxHp);
  p.mana = p.maxMana;
  p.energyShield = p.maxEnergyShield;
  p.cooldowns = {};
  p.attack = null;
  p.castRequest = null;
  p.attackTargetId = null;
  p.moveTarget = null;
  p.velocity = { x: 0, z: 0 };
  p.position = clampToBounds(save.position.x, save.position.z, state.bounds.center, state.bounds.radius - 2);
  p.previousPosition = { ...p.position };
  const dx = state.bounds.center.x - p.position.x;
  const dz = state.bounds.center.z - p.position.z;
  p.facing = Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : Math.PI;

  state.flasks.health.charges = Math.min(save.flasks.health, state.flasks.health.max);
  state.flasks.mana.charges = Math.min(save.flasks.mana, state.flasks.mana.max);

  applyProgress(state, save);

  // A live Warden restarts at full health; the hero waits at the arena
  // threshold rather than at the saved spot (or outside the active bounds).
  if (state.objectives.bossSpawned && !state.objectives.bossDefeated) {
    const threshold = respawnPointFor(state, layout);
    p.position = { ...threshold };
    p.previousPosition = { ...threshold };
    const ax = state.arena.center.x - p.position.x;
    const az = state.arena.center.z - p.position.z;
    p.facing = Math.hypot(ax, az) > 0.01 ? Math.atan2(ax, az) : Math.PI;
  }
  return state;
}

function applyProgress(state: GameState, save: SaveGame): void {
  const saved = save.progress[save.zoneId];
  const o = state.objectives;
  // The live layout decides how many camps actually exist; the save is always
  // the authored slot count and may be longer than a test/legacy layout.
  o.campCleared = Array.from({ length: o.campsTotal }, (_, index) => saved.campsCleared[index] === true);
  o.bossSpawned = saved.bossSpawned;
  o.bossDefeated = saved.bossDefeated;

  // A cleared camp leaves no enemies behind, exactly as if they had been slain.
  state.enemies = state.enemies.filter((enemy) => enemy.camp < 0 || !o.campCleared[enemy.camp]);

  if (o.bossSpawned && !o.bossDefeated) {
    state.enemies.push(createEnemyState(state.bossSpawn, `boss-restored-${state.tick}`));
  }
}

function clampToBounds(
  x: number,
  z: number,
  center: { x: number; z: number },
  radius: number,
): { x: number; z: number } {
  const dx = x - center.x;
  const dz = z - center.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= radius || dist === 0) return { x, z };
  const scale = radius / dist;
  return { x: center.x + dx * scale, z: center.z + dz * scale };
}
