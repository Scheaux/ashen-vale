import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { activeSkillsFor } from '../content/skills';
import { LOADOUT_SLOTS, type ZoneLayout } from '../content/types';
import { createGameState, type GameState } from '../sim/state';
import {
  MAX_SKILL_RANK,
  canUnlockSkill,
  clearSkillSlot,
  defaultSkillState,
  effectiveSkillCooldown,
  effectiveSkillDamage,
  equipSkill,
  skillCooldownMultiplier,
  skillDamageMultiplier,
  skillInSlot,
  skillPointsAvailable,
  skillPointsSpent,
  skillPointsTotal,
  skillRank,
  unlockSkill,
  upgradeSkill,
} from './loadout';

function layout(): ZoneLayout {
  return {
    seed: 5,
    name: 'loadout-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

function stateFor(classId: 'marauder' | 'ranger' | 'witch' = 'marauder'): GameState {
  return createGameState(getClass(classId), layout());
}

describe('skill-point economy', () => {
  it('grants one point per level after level 1 and the signature rank is free', () => {
    const state = stateFor();
    expect(skillPointsTotal(state)).toBe(0);
    expect(skillPointsSpent(state)).toBe(0);
    expect(skillPointsAvailable(state)).toBe(0);
    state.level = 4;
    expect(skillPointsTotal(state)).toBe(3);
    expect(skillPointsAvailable(state)).toBe(3);
  });

  it('gates unlocks by level and spends one point', () => {
    const state = stateFor();
    const [, second, third] = activeSkillsFor('marauder');
    expect(canUnlockSkill(state, second.id)).toMatchObject({ ok: false, reason: 'level' });
    state.level = 2;
    expect(canUnlockSkill(state, second.id).ok).toBe(true);
    expect(unlockSkill(state, second.id).ok).toBe(true);
    expect(skillRank(state, second.id)).toBe(1);
    expect(skillPointsAvailable(state)).toBe(0);
    expect(unlockSkill(state, second.id)).toMatchObject({ ok: false, reason: 'already-unlocked' });
    expect(canUnlockSkill(state, third.id)).toMatchObject({ ok: false, reason: 'level' });
    state.level = 4;
    expect(unlockSkill(state, third.id).ok).toBe(true);
    expect(skillPointsSpent(state)).toBe(2);
  });

  it('upgrades ranks up to the cap with one point each', () => {
    const state = stateFor('ranger');
    const signature = activeSkillsFor('ranger')[0];
    state.level = 5; // 4 points, exactly the four upgrades
    for (let rank = 2; rank <= MAX_SKILL_RANK; rank++) {
      expect(upgradeSkill(state, signature.id).ok).toBe(true);
      expect(skillRank(state, signature.id)).toBe(rank);
    }
    expect(upgradeSkill(state, signature.id)).toMatchObject({ ok: false, reason: 'max-rank' });
    expect(skillPointsSpent(state)).toBe(MAX_SKILL_RANK - 1);
    expect(skillPointsAvailable(state)).toBe(0);
  });

  it('scales damage up and cooldown down with rank', () => {
    const state = stateFor('witch');
    const signature = activeSkillsFor('witch')[0];
    state.level = 3;
    const base = effectiveSkillDamage(state, signature.id);
    const baseCooldown = effectiveSkillCooldown(state, signature.id);
    expect(upgradeSkill(state, signature.id).ok).toBe(true);
    const upgraded = effectiveSkillDamage(state, signature.id);
    expect(skillDamageMultiplier(state, signature.id)).toBeCloseTo(1.15);
    expect(skillCooldownMultiplier(state, signature.id)).toBeCloseTo(0.96);
    expect(upgraded.min).toBeGreaterThan(base.min);
    expect(effectiveSkillCooldown(state, signature.id)).toBeLessThan(baseCooldown);
  });
});

describe('loadout slots', () => {
  it('starts with only the signature skill in Q', () => {
    const state = stateFor();
    const signature = activeSkillsFor('marauder')[0];
    expect(skillInSlot(state, 'q')).toBe(signature.id);
    expect(LOADOUT_SLOTS.filter((slot) => skillInSlot(state, slot) !== null)).toEqual(['q']);
  });

  it('equips, moves and clears a skill without duplicating it', () => {
    const state = stateFor();
    const signature = activeSkillsFor('marauder')[0];
    state.level = 2;
    const second = activeSkillsFor('marauder')[1];
    expect(unlockSkill(state, second.id).ok).toBe(true);
    expect(equipSkill(state, 'w', second.id).ok).toBe(true);
    expect(skillInSlot(state, 'w')).toBe(second.id);
    expect(equipSkill(state, 'e', second.id).ok).toBe(true);
    expect(skillInSlot(state, 'w')).toBeNull();
    expect(skillInSlot(state, 'e')).toBe(second.id);
    clearSkillSlot(state, 'e');
    expect(skillInSlot(state, 'e')).toBeNull();
    expect(skillInSlot(state, 'q')).toBe(signature.id);
  });

  it('refuses locked, basic, wrong-class and duplicate targets', () => {
    const state = stateFor('ranger');
    state.level = 4;
    const signature = activeSkillsFor('ranger')[0];
    expect(equipSkill(state, 'w', signature.id).ok).toBe(true); // move, not duplicate
    expect(skillInSlot(state, 'q')).toBeNull();
    expect(equipSkill(state, 'rmb', 'cleave' as never)).toMatchObject({ ok: false, reason: 'basic' });
    expect(equipSkill(state, 'rmb', 'whirlwind' as never)).toMatchObject({ ok: false, reason: 'wrong-class' });
    const third = activeSkillsFor('ranger')[2];
    expect(equipSkill(state, 'rmb', third.id)).toMatchObject({ ok: false, reason: 'not-unlocked' });
  });
});

describe('defaults and legacy migration', () => {
  it('builds a signature-only state for a new character', () => {
    const state = defaultSkillState('witch', 1);
    const signature = activeSkillsFor('witch')[0];
    expect(state.ranks).toEqual({ [signature.id]: 1 });
    expect(state.loadout.filter(Boolean)).toEqual([signature.id]);
  });

  it('loads all actives available at the saved level for legacy saves', () => {
    const legacy = defaultSkillState('marauder', 4, true);
    const actives = activeSkillsFor('marauder');
    expect(Object.keys(legacy.ranks)).toHaveLength(3);
    expect(legacy.loadout.filter(Boolean)).toEqual(actives.map((skill) => skill.id));
    expect(legacy.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(actives[0].id);
    expect(legacy.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
    expect(legacy.loadout[LOADOUT_SLOTS.indexOf('e')]).toBe(actives[2].id);
  });
});
