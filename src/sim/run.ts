import { stepPlayerCombat, stepProjectiles, stepStrikes } from '../systems/combat';
import { resetEnemyCombat, stepEnemies } from '../systems/enemyAi';
import { refillFlasks } from '../systems/flasks';
import { stepPickups } from '../systems/loot';
import { stepMovement } from '../systems/movement';
import type { GameState, Vec2 } from './state';

/** The authoritative order for a gameplay tick, shared with regression tests. */
export function stepRun(state: GameState, dt: number): void {
  if (state.player.hp <= 0) return;
  const events = state.events;
  stepPlayerCombat(state, dt, events);
  stepMovement(state, dt);
  stepStrikes(state, dt, events);
  stepEnemies(state, dt, events);
  if (state.player.hp <= 0) return;
  stepProjectiles(state, dt, events);
  if (state.player.hp > 0) stepPickups(state, events);
}

/** Preserve loot, progression, and enemy health/positions, but cancel every old action. */
export function respawnPlayer(state: GameState, spawn: Vec2): void {
  const p = state.player;
  p.hp = p.maxHp;
  p.mana = p.maxMana;
  p.position = { ...spawn };
  p.previousPosition = { ...spawn };
  p.facing = Math.PI;
  p.velocity = { x: 0, z: 0 };
  p.attackTargetId = null;
  p.moveTarget = null;
  p.attack = null;
  p.castRequest = null;
  p.cooldowns = {};
  state.projectiles.length = 0;
  state.strikes.length = 0;
  refillFlasks(state);
  state.runStats = { kills: 0, damageTaken: 0, evades: 0, seconds: 0, lastBlow: null };
  for (const enemy of state.enemies) {
    if (!enemy.dead) resetEnemyCombat(enemy);
  }
}
