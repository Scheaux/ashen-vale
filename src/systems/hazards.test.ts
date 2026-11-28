import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createEnemyState, createGameState, type SimEvent } from '../sim/state';
import { spawnHazard } from '../sim/hazards';
import { damageEnemy } from './combat';
import { stepEnemies } from './enemyAi';
import { stepHazards } from './hazards';

function layout(enemies: ZoneLayout['enemySpawns'] = []): ZoneLayout {
  return {
    seed: 5,
    name: 'hazard-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: enemies,
  };
}

describe('ground hazards', () => {
  it('detonates after its fuse and damages a player inside the circle', () => {
    const state = createGameState(getClass('marauder'), layout());
    state.player.energyShield = 0;
    const events: SimEvent[] = [];
    spawnHazard(state, {
      kind: 'volatile',
      x: state.player.position.x,
      z: state.player.position.z,
      radius: 2.8,
      fuse: 0.4,
      damage: 14,
      sourceName: 'Volatile Husk',
      color: 0xff7a3d,
    }, events);
    expect(state.hazards).toHaveLength(1);
    expect(events.some((ev) => ev.kind === 'hazard')).toBe(true);

    const before = state.player.hp;
    for (let i = 0; i < 40; i++) stepHazards(state, 1 / 60, events);
    expect(state.player.hp).toBeLessThan(before);
    expect(state.hazards).toHaveLength(0);
    expect(events.some((ev) => ev.kind === 'damage' && ev.targetKind === 'player')).toBe(true);
  });

  it('does not damage a player who leaves the circle', () => {
    const state = createGameState(getClass('ranger'), layout());
    const events: SimEvent[] = [];
    spawnHazard(state, {
      kind: 'volatile',
      x: 12,
      z: 12,
      radius: 2.5,
      fuse: 0.2,
      damage: 20,
      sourceName: 'Volatile Cultist',
      color: 0xff7a3d,
    }, events);
    const before = state.player.hp;
    for (let i = 0; i < 30; i++) stepHazards(state, 1 / 60, events);
    expect(state.player.hp).toBe(before);
    expect(state.hazards).toHaveLength(0);
  });

  it('ticks a lingering cinder pool, then expires', () => {
    const state = createGameState(getClass('witch'), layout());
    state.player.energyShield = 0;
    const events: SimEvent[] = [];
    spawnHazard(state, {
      kind: 'cinder',
      x: state.player.position.x,
      z: state.player.position.z,
      radius: 3,
      fuse: 0.15,
      duration: 0.7,
      tickInterval: 0.2,
      damage: 2,
      sourceName: 'The Ashen Warden',
      color: 0xff5a33,
    }, events);
    const before = state.player.hp;
    for (let i = 0; i < 80; i++) stepHazards(state, 1 / 60, events);
    expect(state.player.hp).toBeLessThan(before);
    expect(state.hazards).toHaveLength(0);
  });

  it('spawns a volatile blast when a volatile elite dies', () => {
    const state = createGameState(getClass('marauder'), layout([
      { enemyId: 'ashen-husk', x: 0, z: 16, elite: ['volatile'], camp: 0 },
    ]));
    const events: SimEvent[] = [];
    const enemy = state.enemies[0];
    damageEnemy(state, enemy, 9999, events);
    expect(enemy.dead).toBe(true);
    expect(state.hazards).toHaveLength(1);
    expect(state.hazards[0].kind).toBe('volatile');
    expect(events.some((ev) => ev.kind === 'hazard')).toBe(true);
  });

  it('leaves a cinder pool after the Warden slams', () => {
    const state = createGameState(getClass('marauder'), layout());
    // Boss at home in its arena, already in phase 2 (slam pattern).
    const boss = createEnemyState({ enemyId: 'ashen-warden', x: 0, z: -30, elite: [], camp: -1 }, 'boss-test');
    boss.bossPhase = 1;
    state.enemies.push(boss);
    state.player.position = { x: 0, z: -27 };
    state.player.hp = state.player.maxHp;
    const events: SimEvent[] = [];
    for (let i = 0; i < 240 && state.hazards.length === 0; i++) {
      stepEnemies(state, 1 / 60, events);
      state.player.hp = state.player.maxHp;
    }
    expect(state.hazards.some((hazard) => hazard.kind === 'cinder')).toBe(true);
    expect(events.some((ev) => ev.kind === 'hazard')).toBe(true);
  });
});
