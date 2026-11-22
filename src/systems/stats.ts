import { getClass } from '../content/classes';
import { getAffix } from '../content/affixes';
import type { ClassDef } from '../content/types';
import type { ItemSlot } from '../content/items';
import type { GameState, InventoryState } from '../sim/state';
import { PLAYER_MAX_HP } from '../sim/state';

export interface EffectiveStats {
  maxHp: number;
  damagePct: number;
  moveSpeedPct: number;
  damageReductionPct: number;
  strength: number;
  dexterity: number;
  intelligence: number;
}

const DAMAGE_REDUCTION_CAP = 60;

type Equipment = InventoryState['equipment'];

/**
 * Derived stats: class base + level growth + equipment affixes. Pure and
 * recomputed on every change so nothing stale can leak into combat.
 */
export function computeStats(classDef: ClassDef, level: number, equipment: Equipment): EffectiveStats {
  const stats: EffectiveStats = {
    maxHp: PLAYER_MAX_HP + (level - 1) * 12,
    damagePct: 0,
    moveSpeedPct: 0,
    damageReductionPct: 0,
    strength: classDef.stats.strength,
    dexterity: classDef.stats.dexterity,
    intelligence: classDef.stats.intelligence,
  };

  for (const slot of Object.keys(equipment) as ItemSlot[]) {
    const item = equipment[slot];
    if (!item) continue;
    for (const affix of item.affixes) {
      const def = getAffix(affix.id);
      switch (def.stat) {
        case 'maxHp':
          stats.maxHp += affix.value;
          break;
        case 'damagePct':
          stats.damagePct += affix.value;
          break;
        case 'moveSpeedPct':
          stats.moveSpeedPct += affix.value;
          break;
        case 'damageReductionPct':
          stats.damageReductionPct += affix.value;
          break;
        case 'strength':
          stats.strength += affix.value;
          break;
        case 'dexterity':
          stats.dexterity += affix.value;
          break;
        case 'intelligence':
          stats.intelligence += affix.value;
          break;
      }
    }
  }

  // Attribute synergies: strength feeds health, dexterity feeds speed.
  stats.maxHp += stats.strength * 0.5;
  stats.moveSpeedPct += stats.dexterity * 0.08;
  stats.damagePct += stats.strength * 0.15 + stats.intelligence * 0.15;
  stats.damageReductionPct = Math.min(DAMAGE_REDUCTION_CAP, stats.damageReductionPct);
  return stats;
}

export function getPlayerStats(state: GameState): EffectiveStats {
  return computeStats(getClass(state.player.classId), state.level, state.inventory.equipment);
}

/** Re-derive player vitals after level or equipment changes. */
export function syncPlayerStats(state: GameState): void {
  const stats = getPlayerStats(state);
  state.player.maxHp = Math.round(stats.maxHp);
  state.player.hp = Math.min(state.player.hp, state.player.maxHp);
  const classDef = getClass(state.player.classId);
  state.player.speed = classDef.speed * (1 + stats.moveSpeedPct / 100);
}

/** Outgoing player damage after equipment multipliers. */
export function scalePlayerDamage(state: GameState, amount: number): number {
  return amount * (1 + getPlayerStats(state).damagePct / 100);
}

/** Incoming damage after armor multipliers. */
export function reducePlayerDamage(state: GameState, amount: number): number {
  return amount * (1 - getPlayerStats(state).damageReductionPct / 100);
}
