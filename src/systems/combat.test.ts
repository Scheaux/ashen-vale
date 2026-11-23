import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { basicAttackFor } from '../content/skills';
import type { CircleCollider, ZoneLayout } from '../content/types';
import { drainEvents, type GameState, type SimEvent } from '../sim/state';
import { createGameState } from '../sim/state';
import { stepRun } from '../sim/run';
import {
  damageEnemy,
  damagePlayer,
  stepPlayerCombat,
  stepProjectiles,
} from './combat';

function layoutWith(enemies: Array<{ x: number; z: number }> = [], colliders: CircleCollider[] = []): ZoneLayout {
  return {
    seed: 5,
    name: 'test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders,
    props: [],
    enemySpawns: enemies.map((e) => ({ enemyId: 'ashen-husk' as const, x: e.x, z: e.z, elite: [] })),
  };
}

function runCombatTicks(state: GameState, ticks: number, events: SimEvent[], dt = 1 / 60): void {
  for (let i = 0; i < ticks; i++) {
    stepRun(state, dt);
  }
  events.push(...drainEvents(state));
}

describe('damage pipeline', () => {
  it('damageEnemy applies damage and emits authoritative events', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 16 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];

    damageEnemy(state, enemy, 10, events);
    expect(enemy.hp).toBe(enemy.maxHp - 10);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'damage', targetKind: 'enemy', targetId: enemy.id, amount: 10 }),
    );
  });

  it('emits a single death event and refuses overkill damage', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 16 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];

    damageEnemy(state, enemy, 1000, events);
    expect(enemy.hp).toBe(0);
    expect(enemy.dead).toBe(true);
    const deaths = events.filter((e) => e.kind === 'death');
    expect(deaths).toHaveLength(1);

    damageEnemy(state, enemy, 5, events);
    expect(events.filter((e) => e.kind === 'damage')).toHaveLength(1);
  });

  it('damagePlayer clamps at zero and emits player death', () => {
    const state = createGameState(getClass('witch'), layoutWith());
    const events: SimEvent[] = [];
    damagePlayer(state, 500, events, { damageClass: 'spell' });
    expect(state.player.hp).toBe(0);
    expect(events.some((e) => e.kind === 'death' && e.targetKind === 'player')).toBe(true);

    damagePlayer(state, 10, events, { damageClass: 'spell' });
    expect(events.filter((e) => e.kind === 'damage')).toHaveLength(1);
  });
});

describe('player combat verb', () => {
  it('melee cleave deals one hit at the pose contact frame, not at startup', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 16 }]));
    const events: SimEvent[] = [];
    state.player.attackTargetId = state.enemies[0].id;

    stepPlayerCombat(state, 1 / 60, events);

    expect(events.some((e) => e.kind === 'attack' && e.sourceId === 'player')).toBe(true);
    const skill = basicAttackFor('marauder');
    const contact = skill.duration * skill.contact;
    stepPlayerCombat(state, contact - 0.001, events);
    expect(state.enemies[0].hp).toBe(state.enemies[0].maxHp);
    stepPlayerCombat(state, 0.002, events);
    stepPlayerCombat(state, 0.1, events);
    expect(events.filter((e) => e.kind === 'damage' && e.targetKind === 'enemy')).toHaveLength(1);
    expect(state.enemies[0].hp).toBeLessThan(state.enemies[0].maxHp);
  });

  it('melee arc ignores enemies behind the committed swing', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 16 }, { x: 0, z: 20 }]));
    const events: SimEvent[] = [];
    state.player.attackTargetId = state.enemies[0].id;

    stepPlayerCombat(state, 1 / 60, events);
    stepPlayerCombat(state, 0.25, events);
    expect(state.enemies[0].hp).toBeLessThan(state.enemies[0].maxHp);
    expect(state.enemies[1].hp).toBe(state.enemies[1].maxHp);
  });

  it('respects the attack cooldown', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 16 }]));
    const events: SimEvent[] = [];
    state.player.attackTargetId = state.enemies[0].id;

    stepPlayerCombat(state, 1 / 60, events);
    stepPlayerCombat(state, 1 / 60, events);
    expect(events.filter((e) => e.kind === 'attack')).toHaveLength(1);

    // Cooldown (0.85s) elapses -> second swing.
    for (let i = 0; i < 55; i++) stepPlayerCombat(state, 1 / 60, events);
    expect(events.filter((e) => e.kind === 'attack').length).toBeGreaterThanOrEqual(2);
  });

  it('pursues an out-of-range target and strikes once close', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 4 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    state.player.attackTargetId = enemy.id;

    const distBefore = Math.hypot(enemy.position.x - state.player.position.x, enemy.position.z - state.player.position.z);
    runCombatTicks(state, 60 * 6, events);
    const distAfter = Math.hypot(enemy.position.x - state.player.position.x, enemy.position.z - state.player.position.z);

    expect(distAfter).toBeLessThan(distBefore);
    expect(events.some((e) => e.kind === 'damage' && e.targetKind === 'enemy')).toBe(true);
  });

  it('ranger projectiles travel and hit the target', () => {
    const state = createGameState(getClass('ranger'), layoutWith([{ x: 0, z: 10 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    state.player.attackTargetId = enemy.id;

    stepPlayerCombat(state, 1 / 60, events);
    expect(state.projectiles).toHaveLength(0);
    stepPlayerCombat(state, 0.24, events);
    expect(state.projectiles).toHaveLength(0);
    stepPlayerCombat(state, 0.02, events);
    expect(state.projectiles).toHaveLength(1);

    for (let i = 0; i < 60; i++) stepProjectiles(state, 1 / 60, events);
    expect(state.projectiles).toHaveLength(0); // consumed on contact
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    expect(events.some((e) => e.kind === 'damage' && e.targetKind === 'enemy')).toBe(true);
  });

  it('a kill removes the enemy from play after the corpse fade', () => {
    const state = createGameState(getClass('witch'), layoutWith([{ x: 0, z: 10 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    state.player.attackTargetId = enemy.id;

    for (let i = 0; i < 60 * 12 && state.enemies.length > 0; i++) {
      runCombatTicks(state, 1, events);
    }

    expect(events.some((e) => e.kind === 'death' && e.targetKind === 'enemy')).toBe(true);
    expect(state.enemies).toHaveLength(0);
  });
});

describe('enemy brain (slice 2)', () => {
  it('aggros, approaches and damages the player', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 12 }]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];

    runCombatTicks(state, 60 * 5, events);

    expect(enemy.aggro).toBe(true);
    expect(events.some((e) => e.kind === 'attack' && e.sourceId === enemy.id)).toBe(true);
    // The energy shield absorbs before life: total vitality is what must drop.
    expect(state.player.hp + state.player.energyShield).toBeLessThan(state.player.maxHp + state.player.maxEnergyShield);
  });

  it('does not notice the player beyond aggro range', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: -30 }]));
    const events: SimEvent[] = [];
    runCombatTicks(state, 60 * 3, events);
    expect(state.enemies[0].aggro).toBe(false);
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(events.filter((e) => e.kind === 'attack')).toHaveLength(0);
  });

  it('is deterministic: identical runs produce identical outcomes', () => {
    const a = createGameState(getClass('ranger'), layoutWith([{ x: 0, z: 12 }, { x: 6, z: 10 }]), 99);
    const b = createGameState(getClass('ranger'), layoutWith([{ x: 0, z: 12 }, { x: 6, z: 10 }]), 99);
    const eventsA: SimEvent[] = [];
    const eventsB: SimEvent[] = [];
    a.player.attackTargetId = a.enemies[0].id;
    b.player.attackTargetId = b.enemies[0].id;

    runCombatTicks(a, 60 * 8, eventsA);
    runCombatTicks(b, 60 * 8, eventsB);

    const snapshot = (s: GameState) =>
      JSON.stringify({ player: s.player, enemies: s.enemies, projectiles: s.projectiles });
    expect(snapshot(a)).toBe(snapshot(b));
    expect(eventsA).toEqual(eventsB);
    expect(drainEvents(a)).toEqual(drainEvents(b));
  });
});
