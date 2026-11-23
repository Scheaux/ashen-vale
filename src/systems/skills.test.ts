import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { basicAttackFor, getSkill, skillsFor } from '../content/skills';
import type { CircleCollider, ZoneLayout } from '../content/types';
import { createGameState, drainEvents, type GameState, type SimEvent } from '../sim/state';
import { damageEnemy, damagePlayer, stepPlayerCombat, stepStrikes, canCast } from './combat';

function layoutWith(enemies: Array<{ x: number; z: number }> = [], colliders: CircleCollider[] = []): ZoneLayout {
  return {
    seed: 5,
    name: 'skills-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders,
    props: [],
    enemySpawns: enemies.map((e) => ({ enemyId: 'ashen-husk' as const, x: e.x, z: e.z, elite: [] })),
  };
}

/** Advance combat steps until the committed attack finishes (or a tick cap). */
function runUntilCastDone(state: GameState, events: SimEvent[], cap = 120): void {
  for (let i = 0; i < cap && state.player.attack; i++) {
    stepPlayerCombat(state, 1 / 60, events);
    stepStrikes(state, 1 / 60, events);
  }
}

describe('skill roster (slice 5)', () => {
  it('gives every class four hotbar skills on QWER', () => {
    for (const classId of ['marauder', 'ranger', 'witch'] as const) {
      const skills = skillsFor(classId);
      expect(skills.map((s) => s.slot)).toEqual(['q', 'w', 'e', 'r']);
      expect(skills.every((s) => s.classId === classId)).toBe(true);
    }
  });

  it('keeps the basic attack free and prices the active skills in mana', () => {
    for (const classId of ['marauder', 'ranger', 'witch'] as const) {
      expect(basicAttackFor(classId).manaCost).toBe(0);
      for (const skill of skillsFor(classId).filter((s) => s.slot !== 'q')) {
        expect(skill.manaCost).toBeGreaterThan(0);
        expect(skill.cooldown).toBeGreaterThan(0);
      }
    }
  });
});

describe('casting, mana and cooldowns', () => {
  it('consumes mana, starts the committed attack and starts the cooldown', () => {
    const state = createGameState(getClass('witch'), layoutWith([{ x: 0, z: 24 }]));
    const events: SimEvent[] = [];
    const skill = getSkill('ember-nova');
    state.player.castRequest = { skillId: 'ember-nova', x: 0, z: 24 };

    stepPlayerCombat(state, 1 / 60, events);

    expect(state.player.attack?.skillId).toBe('ember-nova');
    expect(state.player.mana).toBe(state.player.maxMana - skill.manaCost);
    expect(state.player.cooldowns['ember-nova']).toBe(skill.cooldown);
    expect(events.some((ev) => ev.kind === 'attack' && ev.skillId === 'ember-nova')).toBe(true);
  });

  it('refuses a cast without mana and reports it', () => {
    const state = createGameState(getClass('witch'), layoutWith([{ x: 0, z: 24 }]));
    const events: SimEvent[] = [];
    state.player.mana = 0;
    state.player.castRequest = { skillId: 'ember-nova', x: 0, z: 24 };

    stepPlayerCombat(state, 1 / 60, events);

    expect(state.player.attack).toBeNull();
    expect(state.player.mana).toBeLessThan(getSkill('ember-nova').manaCost); // regen ticked, but the cast stayed unpaid
    expect(events.some((ev) => ev.kind === 'refuse' && ev.reason === 'mana')).toBe(true);
  });

  it('refuses a recast while the skill is on cooldown', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 24 }]));
    const events: SimEvent[] = [];
    state.player.castRequest = { skillId: 'sunder', x: 0, z: 24 };
    stepPlayerCombat(state, 1 / 60, events);
    expect(state.player.attack).not.toBeNull();

    runUntilCastDone(state, events);
    expect(state.player.attack).toBeNull();

    state.player.castRequest = { skillId: 'sunder', x: 0, z: 24 };
    stepPlayerCombat(state, 1 / 60, events);
    expect(state.player.attack).toBeNull();
    expect(events.some((ev) => ev.kind === 'refuse' && ev.reason === 'cooldown')).toBe(true);
    expect(canCast(state, getSkill('sunder'))).toBe('cooldown');
  });

  it('regenerates mana over time up to the pool cap', () => {
    const state = createGameState(getClass('marauder'), layoutWith());
    const events: SimEvent[] = [];
    state.player.mana = 0;
    for (let i = 0; i < 120; i++) stepPlayerCombat(state, 1 / 60, events);
    expect(state.player.mana).toBeGreaterThan(0);
    expect(state.player.mana).toBeLessThanOrEqual(state.player.maxMana);

    for (let i = 0; i < 60 * 60; i++) stepPlayerCombat(state, 1 / 60, events);
    expect(state.player.mana).toBeCloseTo(state.player.maxMana, 5);
  });

  it('never charges mana for the basic attack', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 20 }]));
    const events: SimEvent[] = [];
    state.player.attackTargetId = state.enemies[0].id;
    for (let i = 0; i < 60; i++) stepPlayerCombat(state, 1 / 60, events);
    expect(events.some((ev) => ev.kind === 'attack' && ev.skillId === 'cleave')).toBe(true);
    expect(state.player.mana).toBe(state.player.maxMana);
  });

  it('a hotbar cast interrupts the repeating basic swing', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 20 }]));
    const events: SimEvent[] = [];
    state.player.attackTargetId = state.enemies[0].id;
    for (let i = 0; i < 60 && state.player.attack?.skillId !== 'cleave'; i++) {
      stepPlayerCombat(state, 1 / 60, events);
    }
    expect(state.player.attack?.skillId).toBe('cleave');

    state.player.castRequest = { skillId: 'whirlwind', x: 0, z: 20 };
    stepPlayerCombat(state, 1 / 60, events);

    expect(state.player.attack?.skillId).toBe('whirlwind');
    expect(state.player.mana).toBe(state.player.maxMana - getSkill('whirlwind').manaCost);
  });
});

describe('skill deliveries', () => {
  it('nova hits everything inside the radius and nothing beyond it', () => {
    const state = createGameState(getClass('witch'), layoutWith([{ x: 0, z: 20 }, { x: 0, z: 26 }]));
    const events: SimEvent[] = [];
    const [near, far] = state.enemies;
    state.player.castRequest = { skillId: 'ember-nova', x: 0, z: 20 };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);

    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(events.some((ev) => ev.kind === 'burst' && ev.skillId === 'ember-nova')).toBe(true);
  });

  it('ground strike holds its damage through the fuse, then bursts once', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 22 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    state.player.castRequest = { skillId: 'sunder', x: enemy.position.x, z: enemy.position.z };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);

    expect(state.strikes).toHaveLength(1);
    expect(enemy.hp).toBe(enemy.maxHp); // the tell deals no damage

    for (let i = 0; i < 60 && state.strikes.length > 0; i++) {
      stepStrikes(state, 1 / 60, events);
    }
    expect(state.strikes).toHaveLength(0);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(events.filter((ev) => ev.kind === 'burst' && ev.skillId === 'sunder')).toHaveLength(1);
  });

  it('spread launches the advertised fan of projectiles', () => {
    const state = createGameState(getClass('ranger'), layoutWith([{ x: 0, z: 28 }]));
    const events: SimEvent[] = [];
    const skill = getSkill('split-shot');
    state.player.castRequest = { skillId: 'split-shot', x: 0, z: 28 };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);

    expect(state.projectiles).toHaveLength(skill.count ?? 0);
    const angles = state.projectiles
      .map((p) => Math.atan2(p.velocity.x, p.velocity.z))
      .sort((a, b) => a - b);
    expect(angles[angles.length - 1] - angles[0]).toBeCloseTo(((skill.spreadDeg ?? 0) * Math.PI) / 180, 5);
  });

  it('dash travels along the facing and hits each enemy at most once', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 20 }, { x: 0, z: 23 }]));
    const events: SimEvent[] = [];
    const [first, second] = state.enemies;
    state.player.castRequest = { skillId: 'reckless-charge', x: 0, z: 30 };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);

    expect(state.player.position.z).toBeGreaterThan(23); // travelled through both
    for (const enemy of [first, second]) {
      const hits = events.filter((ev) => ev.kind === 'damage' && ev.targetId === enemy.id);
      expect(hits).toHaveLength(1);
      expect(enemy.hp).toBeLessThan(enemy.maxHp);
    }
  });

  it('ground strikes aim at the requested point, not the player position', () => {
    const state = createGameState(getClass('ranger'), layoutWith());
    const events: SimEvent[] = [];
    state.player.castRequest = { skillId: 'rain-of-arrows', x: 5, z: 25 };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);
    expect(state.strikes[0]).toMatchObject({ x: 5, z: 25 });
  });
});

describe('death recap bookkeeping', () => {
  it('records the killing blow and counters', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 20 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    damageEnemy(state, enemy, 10000, events);
    expect(state.runStats.kills).toBe(1);
    damagePlayer(state, 40, events, { attackId: 'test', sourceName: 'Ashen Husk', damageClass: 'spell' });
    expect(state.runStats.damageTaken).toBeGreaterThanOrEqual(40);
    expect(state.runStats.lastBlow).toMatchObject({ sourceName: 'Ashen Husk' });
    expect(state.runStats.seconds).toBeGreaterThanOrEqual(0);
    drainEvents(state);
  });
});
