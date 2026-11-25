import { getSkill, activeSkillsFor } from '../content/skills';
import { getRune, type RuneDef, type RuneId } from '../content/runes';
import { LOADOUT_SLOTS, type LoadoutSlot, type SkillId } from '../content/types';
import type { GameState, SkillState } from '../sim/state';

/**
 * Skill-point progression and the six-slot loadout (RMB, Q, W, E, R, F).
 * The signature skill is granted free at rank 1; every other rank costs one
 * point from the level budget. The basic attack is never part of this system.
 */

export const MAX_SKILL_RANK = 5;
export const SKILL_POINTS_PER_LEVEL = 1;
export const RANK_DAMAGE_STEP = 0.15;
export const RANK_COOLDOWN_STEP = 0.04;

export type LoadoutRefusal =
  | 'unknown'
  | 'basic'
  | 'wrong-class'
  | 'already-unlocked'
  | 'level'
  | 'points'
  | 'max-rank'
  | 'not-unlocked'
  | 'slot'
  | 'unknown-rune'
  | 'rune-level';

export type LoadoutResult = { ok: true } | { ok: false; reason: LoadoutRefusal };

export function skillRank(state: GameState, id: SkillId): number {
  return state.skills.ranks[id] ?? 0;
}

/** One point per level gained after level 1. */
export function skillPointsTotal(state: GameState): number {
  return Math.max(0, state.level - 1) * SKILL_POINTS_PER_LEVEL;
}

/** The signature skill's first rank is free; every other rank costs a point. */
export function skillPointsSpent(state: GameState): number {
  const ranks = Object.values(state.skills.ranks).filter((rank): rank is number => typeof rank === 'number' && rank > 0);
  if (ranks.length === 0) return 0;
  return Math.max(0, ranks.reduce((sum, rank) => sum + rank, 0) - 1);
}

export function skillPointsAvailable(state: GameState): number {
  return Math.max(0, skillPointsTotal(state) - skillPointsSpent(state));
}

export function runeFor(state: GameState, id: SkillId): RuneDef | null {
  const runeId = state.skills.runes[id];
  return runeId ? getRune(runeId) : null;
}

export function skillDamageMultiplier(state: GameState, id: SkillId): number {
  const rank = Math.max(1, skillRank(state, id));
  return (1 + RANK_DAMAGE_STEP * (rank - 1)) * (runeFor(state, id)?.damageMult ?? 1);
}

export function skillCooldownMultiplier(state: GameState, id: SkillId): number {
  const rank = Math.max(1, skillRank(state, id));
  const rankMult = Math.max(0.4, 1 - RANK_COOLDOWN_STEP * (rank - 1));
  return rankMult * (runeFor(state, id)?.cooldownMult ?? 1);
}

export function skillManaCost(state: GameState, id: SkillId): number {
  return Math.ceil(getSkill(id).manaCost * (runeFor(state, id)?.manaMult ?? 1));
}

export function skillAreaMultiplier(state: GameState, id: SkillId): number {
  return runeFor(state, id)?.areaMult ?? 1;
}

/** Effective damage range for tooltips and the skill library. */
export function effectiveSkillDamage(state: GameState, id: SkillId): { min: number; max: number } {
  const skill = getSkill(id);
  const power = skillDamageMultiplier(state, id);
  return { min: Math.round(skill.damage.min * power), max: Math.round(skill.damage.max * power) };
}

export function canSetRune(state: GameState, id: SkillId, runeId: RuneId | null): LoadoutResult {
  const base = validateActive(state, id);
  if (!base.ok) return base;
  if (skillRank(state, id) <= 0) return { ok: false, reason: 'not-unlocked' };
  if (runeId === null) return { ok: true };
  const rune = getRune(runeId);
  if (!rune) return { ok: false, reason: 'unknown-rune' };
  if (state.level < rune.unlockLevel) return { ok: false, reason: 'rune-level' };
  return { ok: true };
}

/** Runes are free to swap once their level gate is met. */
export function setRune(state: GameState, id: SkillId, runeId: RuneId | null): LoadoutResult {
  const result = canSetRune(state, id, runeId);
  if (!result.ok) return result;
  if (runeId === null) delete state.skills.runes[id];
  else state.skills.runes[id] = runeId;
  return { ok: true };
}

export function effectiveSkillCooldown(state: GameState, id: SkillId): number {
  return Math.round(getSkill(id).cooldown * skillCooldownMultiplier(state, id) * 10) / 10;
}

function validateActive(state: GameState, id: SkillId): LoadoutResult {
  const skill = getSkill(id);
  if (!skill) return { ok: false, reason: 'unknown' };
  if (skill.role !== 'active') return { ok: false, reason: 'basic' };
  if (skill.classId !== state.player.classId) return { ok: false, reason: 'wrong-class' };
  return { ok: true };
}

export function canUnlockSkill(state: GameState, id: SkillId): LoadoutResult {
  const base = validateActive(state, id);
  if (!base.ok) return base;
  if (skillRank(state, id) > 0) return { ok: false, reason: 'already-unlocked' };
  const skill = getSkill(id);
  if (state.level < skill.unlockLevel) return { ok: false, reason: 'level' };
  if (skillPointsAvailable(state) < 1) return { ok: false, reason: 'points' };
  return { ok: true };
}

export function unlockSkill(state: GameState, id: SkillId): LoadoutResult {
  const result = canUnlockSkill(state, id);
  if (!result.ok) return result;
  state.skills.ranks[id] = 1;
  return { ok: true };
}

export function canUpgradeSkill(state: GameState, id: SkillId): LoadoutResult {
  const base = validateActive(state, id);
  if (!base.ok) return base;
  const rank = skillRank(state, id);
  if (rank <= 0) return { ok: false, reason: 'not-unlocked' };
  if (rank >= MAX_SKILL_RANK) return { ok: false, reason: 'max-rank' };
  if (skillPointsAvailable(state) < 1) return { ok: false, reason: 'points' };
  return { ok: true };
}

export function upgradeSkill(state: GameState, id: SkillId): LoadoutResult {
  const result = canUpgradeSkill(state, id);
  if (!result.ok) return result;
  state.skills.ranks[id] = (state.skills.ranks[id] ?? 0) + 1;
  return { ok: true };
}

export function slotIndex(slot: LoadoutSlot): number {
  return LOADOUT_SLOTS.indexOf(slot);
}

export function skillInSlot(state: GameState, slot: LoadoutSlot): SkillId | null {
  return state.skills.loadout[slotIndex(slot)] ?? null;
}

/** Equip an unlocked active skill into a slot; a skill can occupy only one slot. */
export function equipSkill(state: GameState, slot: LoadoutSlot, id: SkillId): LoadoutResult {
  const index = slotIndex(slot);
  if (index < 0) return { ok: false, reason: 'slot' };
  const base = validateActive(state, id);
  if (!base.ok) return base;
  if (skillRank(state, id) <= 0) return { ok: false, reason: 'not-unlocked' };
  state.skills.loadout = state.skills.loadout.map((equipped) => (equipped === id ? null : equipped));
  state.skills.loadout[index] = id;
  return { ok: true };
}

export function clearSkillSlot(state: GameState, slot: LoadoutSlot): void {
  const index = slotIndex(slot);
  if (index >= 0) state.skills.loadout[index] = null;
}

/**
 * Default state for a new character (signature only) or a legacy save
 * (all actives available at the saved level, loaded into Q/W/E).
 */
export function defaultSkillState(classId: GameState['player']['classId'], level: number, legacy = false): SkillState {
  const actives = activeSkillsFor(classId);
  const starting = actives[0];
  const ranks: Partial<Record<SkillId, number>> = {};
  const loadout: Array<SkillId | null> = LOADOUT_SLOTS.map(() => null);
  if (legacy) {
    const available = actives.filter((skill) => skill.unlockLevel <= level);
    for (const skill of available) ranks[skill.id] = 1;
    const slots: LoadoutSlot[] = ['q', 'w', 'e', 'r', 'f'];
    available.slice(0, slots.length).forEach((skill, index) => {
      loadout[slotIndex(slots[index])] = skill.id;
    });
  } else {
    ranks[starting.id] = 1;
    loadout[slotIndex('q')] = starting.id;
  }
  return { ranks, loadout, runes: {} };
}

export function loadoutRefusalMessage(result: Extract<LoadoutResult, { ok: false }>): string {
  switch (result.reason) {
    case 'unknown':
      return 'Unknown skill';
    case 'basic':
      return 'The basic attack is bound to left click';
    case 'wrong-class':
      return 'That skill belongs to another class';
    case 'already-unlocked':
      return 'Already unlocked';
    case 'level':
      return 'Level up to unlock that skill';
    case 'points':
      return 'No skill points available — level up to earn more';
    case 'max-rank':
      return 'That skill is already at max rank';
    case 'not-unlocked':
      return 'Unlock the skill first';
    case 'slot':
      return 'Unknown skill slot';
    case 'unknown-rune':
      return 'Unknown rune';
    case 'rune-level':
      return 'Level up to use that rune';
  }
}
