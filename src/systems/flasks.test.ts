import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createGameState, type SimEvent } from '../sim/state';
import { damageEnemy } from './combat';
import { refillFlasks, refillFlasksOnKill, useFlask } from './flasks';

function layoutWith(enemies: Array<{ x: number; z: number }> = []): ZoneLayout {
  return {
    seed: 5,
    name: 'flasks-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: enemies.map((e) => ({ enemyId: 'ashen-husk' as const, x: e.x, z: e.z, elite: [] })),
  };
}

describe('flasks (slice 5)', () => {
  it('health flask restores a chunk of health and consumes one charge', () => {
    const state = createGameState(getClass('marauder'), layoutWith());
    const events: SimEvent[] = [];
    state.player.hp = Math.floor(state.player.maxHp * 0.3);
    const before = state.player.hp;

    expect(useFlask(state, 'health', events)).toBe(true);

    expect(state.player.hp).toBe(before + Math.round(state.player.maxHp * 0.4));
    expect(state.flasks.health.charges).toBe(state.flasks.health.max - 1);
    expect(events.some((ev) => ev.kind === 'resource' && ev.resource === 'health')).toBe(true);
  });

  it('mana flask restores mana and consumes one charge', () => {
    const state = createGameState(getClass('witch'), layoutWith());
    const events: SimEvent[] = [];
    state.player.mana = 0;

    expect(useFlask(state, 'mana', events)).toBe(true);

    expect(state.player.mana).toBe(Math.round(state.player.maxMana * 0.55));
    expect(state.flasks.mana.charges).toBe(state.flasks.mana.max - 1);
    expect(events.some((ev) => ev.kind === 'resource' && ev.resource === 'mana')).toBe(true);
  });

  it('refuses with an empty flask instead of restoring', () => {
    const state = createGameState(getClass('marauder'), layoutWith());
    const events: SimEvent[] = [];
    state.player.hp = 10;
    state.flasks.health.charges = 0;

    expect(useFlask(state, 'health', events)).toBe(false);

    expect(state.player.hp).toBe(10);
    expect(events.some((ev) => ev.kind === 'refuse' && ev.reason === 'flask-empty')).toBe(true);
  });

  it('does nothing while dead', () => {
    const state = createGameState(getClass('marauder'), layoutWith());
    const events: SimEvent[] = [];
    state.player.hp = 0;
    expect(useFlask(state, 'health', events)).toBe(false);
    expect(state.flasks.health.charges).toBe(state.flasks.health.max);
  });

  it('kills refill both flasks, capped at their maximum', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ x: 0, z: 20 }]));
    const events: SimEvent[] = [];
    state.flasks.health.charges = 2;
    state.flasks.mana.charges = 0;

    damageEnemy(state, state.enemies[0], 10000, events);
    expect(state.flasks.health.charges).toBe(3);
    expect(state.flasks.mana.charges).toBe(1);

    refillFlasksOnKill(state);
    refillFlasksOnKill(state);
    refillFlasksOnKill(state);
    expect(state.flasks.health.charges).toBe(state.flasks.health.max);
    expect(state.flasks.mana.charges).toBe(state.flasks.mana.max);
  });

  it('refills both flasks fully on the death retry', () => {
    const state = createGameState(getClass('marauder'), layoutWith());
    state.flasks.health.charges = 0;
    state.flasks.mana.charges = 1;
    refillFlasks(state);
    expect(state.flasks.health.charges).toBe(state.flasks.health.max);
    expect(state.flasks.mana.charges).toBe(state.flasks.mana.max);
  });
});
