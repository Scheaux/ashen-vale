import { getClass } from '../content/classes';
import { getAffix, type AffixStat } from '../content/affixes';
import type { ClassDef } from '../content/types';
import type { ItemSlot } from '../content/items';
import { getPassive } from '../content/passives';
import type { GameState, InventoryState } from '../sim/state';
import { PLAYER_MAX_HP, PLAYER_BASE_MANA, SYNERGY, manaRegenFor } from '../sim/state';

/**
 * Player combat stats (slice 5+ rework). Three primary attributes drive
 * everything: strength feeds life, armour and attack damage; dexterity feeds
 * evasion, movement and attack damage; intelligence feeds mana, energy shield
 * and spell damage. Defence is three distinct layers — armour (mitigation of
 * attack hits), evasion (avoiding attack hits entirely) and energy shield (a
 * pool that absorbs before life). Offence splits into Attack Damage and Spell
 * Damage, matched against each skill's `damageClass`.
 */
export interface EffectiveStats {
  /** Primary attributes: class base + equipment. */
  strength: number;
  dexterity: number;
  intelligence: number;
  /** Offence. */
  attackDamagePct: number;
  spellDamagePct: number;
  /** Defence. */
  armour: number;
  evasion: number;
  energyShield: number;
  /** Vitals. */
  maxHp: number;
  maxMana: number;
  manaRegen: number;
  moveSpeedPct: number;
}

type Equipment = InventoryState['equipment'];

/** Shared bonus application for equipment affixes and passive effects. */
function applyStatBonus(stats: EffectiveStats, stat: AffixStat, value: number): void {
  switch (stat) {
    case 'maxHp':
      stats.maxHp += value;
      break;
    case 'maxMana':
      stats.maxMana += value;
      break;
    case 'attackDamagePct':
      stats.attackDamagePct += value;
      break;
    case 'spellDamagePct':
      stats.spellDamagePct += value;
      break;
    case 'armour':
      stats.armour += value;
      break;
    case 'evasion':
      stats.evasion += value;
      break;
    case 'energyShield':
      stats.energyShield += value;
      break;
    case 'moveSpeedPct':
      stats.moveSpeedPct += value;
      break;
    case 'strength':
      stats.strength += value;
      break;
    case 'dexterity':
      stats.dexterity += value;
      break;
    case 'intelligence':
      stats.intelligence += value;
      break;
  }
}

/** Chance cap for a fully evaded attack hit. */
export const EVADE_CAP = 0.75;
/** Mitigation cap for armour against a single hit. */
export const ARMOUR_CAP = 0.9;
/** Seconds without damage before the energy shield starts recharging. */
export const ES_RECHARGE_DELAY = 2;
/** Energy shield recharged per second (fraction of the pool). */
export const ES_RECHARGE_RATE = 0.35;

/**
 * Derived stats: class base + level growth + equipment affixes + passive
 * tree, then attribute synergies. Pure and recomputed on every change so
 * nothing stale can leak into combat.
 */
export function computeStats(
  classDef: ClassDef,
  level: number,
  equipment: Equipment,
  allocated: readonly string[] = [],
): EffectiveStats {
  const stats: EffectiveStats = {
    strength: classDef.stats.strength,
    dexterity: classDef.stats.dexterity,
    intelligence: classDef.stats.intelligence,
    attackDamagePct: 0,
    spellDamagePct: 0,
    armour: 0,
    evasion: 0,
    energyShield: 0,
    maxHp: PLAYER_MAX_HP + (level - 1) * 12,
    maxMana: PLAYER_BASE_MANA + (level - 1) * 4,
    manaRegen: 0,
    moveSpeedPct: 0,
  };

  for (const slot of Object.keys(equipment) as ItemSlot[]) {
    const item = equipment[slot];
    if (!item) continue;
    for (const affix of item.affixes) {
      applyStatBonus(stats, getAffix(affix.id).stat, affix.value);
    }
  }

  // Passive tree bonuses land before synergies so attribute nodes compound.
  for (const id of allocated) {
    const node = getPassive(id);
    if (!node) continue;
    for (const effect of node.effects) applyStatBonus(stats, effect.stat, effect.value);
  }

  // Attribute synergies (see SYNERGY in sim/state.ts).
  stats.maxHp += stats.strength * SYNERGY.strength.maxHp;
  stats.maxMana += stats.intelligence * SYNERGY.intelligence.maxMana;
  stats.manaRegen = manaRegenFor(stats.maxMana);
  stats.armour += stats.strength * SYNERGY.strength.armour;
  stats.evasion += stats.dexterity * SYNERGY.dexterity.evasion;
  stats.energyShield += stats.intelligence * SYNERGY.intelligence.energyShield;
  stats.attackDamagePct +=
    stats.strength * SYNERGY.strength.attackDamagePct + stats.dexterity * SYNERGY.dexterity.attackDamagePct;
  stats.spellDamagePct += stats.intelligence * SYNERGY.intelligence.spellDamagePct;
  stats.moveSpeedPct += stats.dexterity * SYNERGY.dexterity.moveSpeedPct;
  return stats;
}

export function getPlayerStats(state: GameState): EffectiveStats {
  return computeStats(
    getClass(state.player.classId),
    state.level,
    state.inventory.equipment,
    state.passives.allocated,
  );
}

/** Re-derive player combat stats after level or equipment changes. */
export function syncPlayerStats(state: GameState): void {
  const stats = getPlayerStats(state);
  const p = state.player;
  p.maxHp = Math.round(stats.maxHp);
  p.hp = Math.min(p.hp, p.maxHp);
  p.maxMana = Math.round(stats.maxMana);
  p.mana = Math.min(p.mana, p.maxMana);
  p.manaRegen = stats.manaRegen;
  p.maxEnergyShield = Math.round(stats.energyShield);
  p.energyShield = Math.min(p.energyShield, p.maxEnergyShield);
  p.armour = stats.armour;
  p.evasion = stats.evasion;
  p.attackDamagePct = stats.attackDamagePct;
  p.spellDamagePct = stats.spellDamagePct;
  const classDef = getClass(p.classId);
  p.speed = classDef.speed * (1 + stats.moveSpeedPct / 100);
}

/** Outgoing player damage after the matching offence multiplier. */
export function scalePlayerDamage(
  state: GameState,
  amount: number,
  damageClass: 'attack' | 'spell' = 'attack',
): number {
  const pct = damageClass === 'spell' ? state.player.spellDamagePct : state.player.attackDamagePct;
  return amount * (1 + pct / 100);
}

/** Chance to completely evade an incoming attack hit. Spells cannot be evaded. */
export function evadeChance(evasion: number): number {
  return Math.min(EVADE_CAP, evasion / (evasion + 200));
}

/**
 * Armour mitigation against one hit (PoE-style diminishing returns): armour
 * matters more against many small hits than against one huge one, and never
 * fully negates a hit.
 */
export function armourMitigation(armour: number, hit: number): number {
  return Math.min(ARMOUR_CAP, armour / (armour + 10 * hit));
}
