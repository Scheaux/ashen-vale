import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createGameState, drainEvents, type GameState, type SimEvent } from '../sim/state';
import { damageEnemy } from './combat';
import { activeBounds } from './movement';
import { stepObjectives } from './objectives';
import { stepRun } from '../sim/run';

function layoutWithCamps(): ZoneLayout {
  return {
    seed: 21,
    name: 'objectives-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    enemySpawns: [
      { enemyId: 'ashen-husk', x: -6, z: 10, elite: [], camp: 0 },
      { enemyId: 'ashen-husk', x: -4, z: 11, elite: [], camp: 0 },
      { enemyId: 'mire-skitterer', x: 6, z: 10, elite: [], camp: 1 },
    ],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [], camp: -1 },
  };
}

function kill(state: GameState, id: string, events: SimEvent[]): void {
  const enemy = state.enemies.find((e) => e.id === id && !e.dead);
  if (enemy) damageEnemy(state, enemy, 100000, events);
}

describe('zone objectives (slice 7)', () => {
  it('clears camps as their last member falls', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];

    stepObjectives(state, events);
    expect(state.objectives.campsTotal).toBe(2);
    expect(state.objectives.campCleared.filter(Boolean)).toHaveLength(0);

    kill(state, 'enemy-0', events);
    stepObjectives(state, events);
    expect(state.objectives.campCleared.filter(Boolean)).toHaveLength(0); // one member stands

    kill(state, 'enemy-1', events);
    stepObjectives(state, events);
    expect(state.objectives.campCleared.filter(Boolean)).toHaveLength(1);
    expect(events.some((e) => e.kind === 'objective' && e.text.includes('1/2'))).toBe(true);
  });

  it('spawns the Warden only after every camp falls', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];

    kill(state, 'enemy-0', events);
    kill(state, 'enemy-1', events);
    stepObjectives(state, events);
    expect(state.objectives.bossSpawned).toBe(false);

    kill(state, 'enemy-2', events);
    stepObjectives(state, events);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(state.enemies.some((e) => e.defId === 'ashen-warden' && !e.dead)).toBe(true);
    expect(events.some((e) => e.kind === 'objective' && e.text.includes('Warden stirs'))).toBe(true);
  });

  it('fires victory when the Warden falls', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    for (const id of ['enemy-0', 'enemy-1', 'enemy-2']) kill(state, id, events);
    stepObjectives(state, events);
    const boss = state.enemies.find((e) => e.defId === 'ashen-warden');
    expect(boss).toBeDefined();

    stepObjectives(state, events); // alive: no victory yet
    expect(state.objectives.bossDefeated).toBe(false);

    kill(state, boss!.id, events);
    stepObjectives(state, events);
    expect(state.objectives.bossDefeated).toBe(true);
    expect(events.some((e) => e.kind === 'victory')).toBe(true);
    expect(events.some((e) => e.kind === 'objective' && e.text.includes('fallen'))).toBe(true);
  });

  it('zones without camps never gate or spawn the boss', () => {
    const plain: ZoneLayout = {
      ...layoutWithCamps(),
      enemySpawns: [{ enemyId: 'ashen-husk', x: 4, z: 4, elite: [] }],
    };
    const state = createGameState(getClass('marauder'), plain);
    const events: SimEvent[] = [];
    stepObjectives(state, events);
    expect(state.objectives.campsTotal).toBe(0);
    expect(state.objectives.bossSpawned).toBe(false);

    kill(state, 'enemy-0', events);
    stepObjectives(state, events);
    expect(state.objectives.bossSpawned).toBe(false);
  });

  it('the arena bounds engage only for the live Warden fight', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    expect(activeBounds(state)).toBe(state.bounds);

    for (const id of ['enemy-0', 'enemy-1', 'enemy-2']) kill(state, id, events);
    stepObjectives(state, events);
    expect(activeBounds(state)).toBe(state.arena); // fight is on

    const boss = state.enemies.find((e) => e.defId === 'ashen-warden');
    kill(state, boss!.id, events);
    stepObjectives(state, events);
    expect(activeBounds(state)).toBe(state.bounds); // moor reopens
  });

  it('the arena keeps the hero inside during the fight', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    for (const id of ['enemy-0', 'enemy-1', 'enemy-2']) kill(state, id, events);
    stepObjectives(state, events);

    // Far outside the arena: movement clamps back inside.
    state.player.position.x = 0;
    state.player.position.z = 30;
    state.player.moveTarget = { x: 0, z: 38 };
    for (let i = 0; i < 60; i++) stepRun(state, 1 / 60);
    const dist = Math.hypot(
      state.player.position.x - state.arena.center.x,
      state.player.position.z - state.arena.center.z,
    );
    expect(dist).toBeLessThanOrEqual(state.arena.radius);
    drainEvents(state);
  });
});
