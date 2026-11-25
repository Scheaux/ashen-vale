import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { activeSkillsFor, basicAttackFor, getSkill } from '../content/skills';
import { LOADOUT_SLOTS, type CircleCollider, type SkillId, type ZoneLayout } from '../content/types';
import { createGameState, drainEvents, type GameState, type SimEvent } from '../sim/state';
import { stepRun } from '../sim/run';
import { damageEnemy, damagePlayer, stepPlayerCombat, stepStrikes, canCast } from './combat';
import { equipSkill, unlockSkill } from './loadout';

function layoutWith(enemies: Array<{ x: number; z: number }> = [], colliders: CircleCollider[] = []): ZoneLayout {
  return {
    seed: 5,
    name: 'skills-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders,
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
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

/** Level up and unlock/equip the requested actives through the real rules. */
function prepare(state: GameState, ids: SkillId[]): void {
  state.level = Math.max(state.level, 9);
  for (const id of ids) {
    if ((state.skills.ranks[id] ?? 0) === 0) expect(unlockSkill(state, id).ok).toBe(true);
  }
  ids.forEach((id, index) => {
    expect(equipSkill(state, LOADOUT_SLOTS[index + 1], id).ok).toBe(true);
  });
}

describe('skill roster (post-release)', () => {
  it('gives every class one basic attack and three unlockable actives', () => {
    for (const classId of ['marauder', 'ranger', 'witch'] as const) {
      expect(basicAttackFor(classId).role).toBe('basic');
      const actives = activeSkillsFor(classId);
      expect(actives).toHaveLength(4);
      expect(actives.map((s) => s.unlockLevel)).toEqual([1, 2, 4, 6]);
      expect(actives.every((s) => s.classId === classId && s.role === 'active')).toBe(true);
    }
  });

  it('starts with the signature skill in Q and every other slot empty', () => {
    for (const classId of ['marauder', 'ranger', 'witch'] as const) {
      const state = createGameState(getClass(classId), layoutWith());
      const signature = activeSkillsFor(classId)[0];
      expect(state.skills.ranks[signature.id]).toBe(1);
      expect(state.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(signature.id);
      expect(state.skills.loadout.filter(Boolean)).toHaveLength(1);
    }
  });

  it('keeps the basic attack free and prices the active skills in mana', () => {
    for (const classId of ['marauder', 'ranger', 'witch'] as const) {
      expect(basicAttackFor(classId).manaCost).toBe(0);
      for (const skill of activeSkillsFor(classId)) {
        expect(skill.manaCost).toBeGreaterThan(0);
        expect(skill.cooldown).toBeGreaterThan(0);
      }
    }
  });
});

describe('casting, mana and cooldowns', () => {
  it('consumes mana, starts the committed attack and starts the cooldown', () => {
    const state = createGameState(getClass('witch'), layoutWith([{ x: 0, z: 24 }]));
    prepare(state, ['ember-nova']);
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
    prepare(state, ['ember-nova']);
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
    prepare(state, ['sunder']);
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
    prepare(state, ['whirlwind']);
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
    prepare(state, ['ember-nova']);
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
    prepare(state, ['sunder']);
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
    prepare(state, ['split-shot']);
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
    prepare(state, ['reckless-charge']);
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

  it('Frost Nova chills everything it hits', () => {
    const state = createGameState(getClass('witch'), layoutWith([{ x: 0, z: 20 }, { x: 0, z: 30 }]));
    prepare(state, ['frost-nova']);
    const events: SimEvent[] = [];
    const [near, far] = state.enemies;
    state.player.castRequest = { skillId: 'frost-nova', x: 0, z: 20 };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);
    expect(near.chillTime).toBeGreaterThan(0);
    expect(far.chillTime).toBe(0);
    expect(events.some((ev) => ev.kind === 'burst' && ev.skillId === 'frost-nova')).toBe(true);
  });

  it('Leap Slam travels and shatters the landing area once', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 12 }]));
    prepare(state, ['leap-slam']);
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    const before = { ...state.player.position };
    state.player.castRequest = { skillId: 'leap-slam', x: 0, z: 11 };
    stepPlayerCombat(state, 1 / 60, events);
    runUntilCastDone(state, events);
    expect(Math.hypot(state.player.position.x - before.x, state.player.position.z - before.z)).toBeGreaterThan(3);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    const bursts = events.filter((ev) => ev.kind === 'burst' && ev.skillId === 'leap-slam');
    expect(bursts).toHaveLength(1);
  });

  it('Blast Shot damages every enemy in its impact radius', () => {
    const state = createGameState(getClass('ranger'), layoutWith([{ x: 0, z: 20 }, { x: 0.8, z: 20.6 }]));
    prepare(state, ['blast-shot']);
    const events: SimEvent[] = [];
    const [first, second] = state.enemies;
    state.player.castRequest = { skillId: 'blast-shot', x: 0, z: 20 };
    stepPlayerCombat(state, 1 / 60, events);
    for (let i = 0; i < 240 && (state.projectiles.length > 0 || state.player.attack); i++) {
      stepRun(state, 1 / 60);
    }
    expect(first.hp).toBeLessThan(first.maxHp);
    expect(second.hp).toBeLessThan(second.maxHp);
    expect([...events, ...state.events].some((ev) => ev.kind === 'burst' && ev.skillId === 'blast-shot')).toBe(true);
  });

  it('a fan loosed at point-blank range survives its birth tick', () => {
    const state = createGameState(getClass('ranger'), layoutWith([{ x: 0, z: 18.5 }]));
    prepare(state, ['split-shot']);
    state.player.castRequest = { skillId: 'split-shot', x: 0, z: 18.5 };

    let peak = 0;
    for (let i = 0; i < 60; i++) {
      stepRun(state, 1 / 60);
      peak = Math.max(peak, state.projectiles.length);
    }
    // The whole fan must be observable before contact resolves...
    expect(peak).toBe(3);
    // ...and it still lands on the enemy standing on top of the ranger.
    expect(state.enemies[0].hp).toBeLessThan(state.enemies[0].maxHp);
  });

  it('ground strikes aim at the requested point, not the player position', () => {
    const state = createGameState(getClass('ranger'), layoutWith());
    prepare(state, ['rain-of-arrows']);
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
