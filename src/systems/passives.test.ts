import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { PASSIVE_NODES } from '../content/passives';
import type { ZoneLayout } from '../content/types';
import { createGameState, type GameState, type SimEvent } from '../sim/state';
import { damagePlayer } from './combat';
import {
  allocatePassive,
  canAllocatePassive,
  canRefundPassive,
  passivePointsAvailable,
  passivePointsSpent,
  passivePointsTotal,
  refundPassive,
} from './passives';
import { grantXp, xpToNext } from './progression';
import { getPlayerStats, scalePlayerDamage, syncPlayerStats } from './stats';

function layout(): ZoneLayout {
  return {
    seed: 13,
    name: 'passives-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

function freshState(classId: 'marauder' | 'ranger' | 'witch' = 'marauder', level = 6): GameState {
  const state = createGameState(getClass(classId), layout());
  // Level up without rng noise: grant exactly what the curve needs.
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  grantXp(state, total, []);
  syncPlayerStats(state);
  return state;
}

describe('passive tree shape', () => {
  it('is a connected graph of ~30 nodes hanging off the root', () => {
    expect(PASSIVE_NODES.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(PASSIVE_NODES.map((n) => n.id));
    expect(ids.size).toBe(PASSIVE_NODES.length);
    for (const node of PASSIVE_NODES) {
      if (node.id === 'root') {
        expect(node.prereqs).toHaveLength(0);
        continue;
      }
      expect(node.prereqs.length).toBeGreaterThan(0);
      for (const prereq of node.prereqs) expect(ids.has(prereq)).toBe(true);
      // No cycles: prerequisites must appear earlier in the list.
      for (const prereq of node.prereqs) {
        const prereqIndex = PASSIVE_NODES.findIndex((n) => n.id === prereq);
        const nodeIndex = PASSIVE_NODES.findIndex((n) => n.id === node.id);
        expect(prereqIndex).toBeLessThan(nodeIndex);
      }
    }
    for (const node of PASSIVE_NODES.filter((n) => n.id !== 'root')) {
      expect(node.effects.length).toBeGreaterThan(0);
    }
  });
});

describe('allocation rules', () => {
  it('grants the root and one point per level', () => {
    const state = freshState('marauder', 6);
    expect(state.passives.allocated).toEqual(['root']);
    expect(passivePointsTotal(state)).toBe(5);
    expect(passivePointsSpent(state)).toBe(0);
    expect(passivePointsAvailable(state)).toBe(5);

    const level1 = createGameState(getClass('marauder'), layout());
    expect(passivePointsAvailable(level1)).toBe(0);
    expect(canAllocatePassive(level1, 'o1')).toEqual({ ok: false, reason: 'no-points' });
  });

  it('unlocks nodes only through allocated prerequisites', () => {
    const state = freshState('marauder', 6);
    expect(canAllocatePassive(state, 'o4')).toEqual({ ok: false, reason: 'locked' }); // needs o1
    expect(canAllocatePassive(state, 'o1')).toEqual({ ok: true });

    expect(allocatePassive(state, 'o1').ok).toBe(true);
    expect(canAllocatePassive(state, 'o4')).toEqual({ ok: true });
    expect(canAllocatePassive(state, 'o1')).toEqual({ ok: false, reason: 'already-allocated' });
    expect(canAllocatePassive(state, 'nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(canAllocatePassive(state, 'root')).toEqual({ ok: false, reason: 'root' });
  });

  it('multi-prerequisite nodes need every path connected', () => {
    const state = freshState('marauder', 10);
    for (const id of ['o1', 'o4', 'o3']) expect(allocatePassive(state, id).ok).toBe(true);
    expect(canAllocatePassive(state, 'o8')).toEqual({ ok: false, reason: 'locked' }); // o8 needs o4 AND o6
    expect(allocatePassive(state, 'o6').ok).toBe(true);
    expect(canAllocatePassive(state, 'o8')).toEqual({ ok: true });
  });

  it('spends exactly one point per node and refuses when empty', () => {
    const state = freshState('marauder', 3); // 2 points
    expect(allocatePassive(state, 'd1').ok).toBe(true);
    expect(allocatePassive(state, 'd2').ok).toBe(true);
    expect(allocatePassive(state, 'd3')).toEqual({ ok: false, reason: 'no-points' });
    expect(passivePointsSpent(state)).toBe(2);
    expect(passivePointsAvailable(state)).toBe(0);
    expect(state.passives.allocated).toEqual(['root', 'd1', 'd2']);
  });
});

describe('refund rules', () => {
  it('refunds a leaf and gives the point back', () => {
    const state = freshState('marauder', 6);
    allocatePassive(state, 'd1');
    allocatePassive(state, 'd4');
    expect(refundPassive(state, 'd4')).toEqual({ ok: true });
    expect(passivePointsAvailable(state)).toBe(4); // 5 total, d1 still allocated
    expect(state.passives.allocated).toEqual(['root', 'd1']);
    expect(canRefundPassive(state, 'd4')).toEqual({ ok: false, reason: 'not-allocated' });

    expect(refundPassive(state, 'd1').ok).toBe(true);
    expect(passivePointsAvailable(state)).toBe(5); // full reset
  });

  it('never orphans an allocated node', () => {
    const state = freshState('marauder', 6);
    allocatePassive(state, 'o1');
    allocatePassive(state, 'o4');
    expect(refundPassive(state, 'o1')).toEqual({ ok: false, reason: 'has-dependents' });
    expect(state.passives.allocated).toContain('o1');

    expect(refundPassive(state, 'o4').ok).toBe(true); // refund the dependent first
    expect(refundPassive(state, 'o1').ok).toBe(true);
  });

  it('the root is permanent', () => {
    const state = freshState('marauder', 6);
    expect(refundPassive(state, 'root')).toEqual({ ok: false, reason: 'root' });
  });
});

describe('build choices change combat numbers', () => {
  it('offence nodes raise attack damage and combat output', () => {
    const state = freshState('marauder', 10);
    syncPlayerStats(state);
    const before = scalePlayerDamage(state, 100, 'attack');
    const spellBefore = scalePlayerDamage(state, 100, 'spell');

    for (const id of ['o1', 'o4', 'o7']) expect(allocatePassive(state, id).ok).toBe(true);

    expect(scalePlayerDamage(state, 100, 'attack')).toBeGreaterThan(before);
    expect(scalePlayerDamage(state, 100, 'spell')).toBeCloseTo(spellBefore, 8); // attack nodes don't help spells
  });

  it('defence nodes raise armour, evasion and energy shield', () => {
    const state = freshState('marauder', 10);
    const base = getPlayerStats(state);

    for (const id of ['d1', 'd3', 'd2', 'd7']) expect(allocatePassive(state, id).ok).toBe(true);
    const after = getPlayerStats(state);

    expect(after.armour).toBeGreaterThan(base.armour);
    expect(after.evasion).toBeGreaterThan(base.evasion);
    expect(after.energyShield).toBeGreaterThan(base.energyShield);
    expect(after.maxHp).toBeGreaterThan(base.maxHp);
  });

  it('attribute nodes trigger synergies on top of their flat value', () => {
    const state = freshState('witch', 10);
    const base = getPlayerStats(state);

    allocatePassive(state, 'o2');
    allocatePassive(state, 'o5');
    allocatePassive(state, 'o9');
    allocatePassive(state, 'o11'); // Archmage: +14% spell damage, +4 intelligence
    const after = getPlayerStats(state);

    expect(after.spellDamagePct).toBeGreaterThan(base.spellDamagePct + 14); // synergy adds beyond the flat roll
    expect(after.intelligence).toBe(base.intelligence + 4);
    expect(after.maxMana).toBeGreaterThan(base.maxMana); // INT feeds mana
  });

  it('the witch\'s build shows up in the damage pipeline, and refunds undo it', () => {
    const state = freshState('witch', 10);
    state.player.energyShield = 0;
    const events: SimEvent[] = [];
    const hpBefore = state.player.hp;
    damagePlayer(state, 30, events, { damageClass: 'spell' });
    const firstHit = hpBefore - state.player.hp;

    allocatePassive(state, 'd2'); // Lifeforce: +18 life... hit damage unchanged but pool bigger
    expect(state.player.maxHp).toBeGreaterThan(hpBefore);

    allocatePassive(state, 'o2');
    const scaled = scalePlayerDamage(state, 100, 'spell');
    refundPassive(state, 'o2');
    expect(scalePlayerDamage(state, 100, 'spell')).toBeLessThan(scaled);
    expect(firstHit).toBe(30);
  });
});
