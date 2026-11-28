import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { generateZoneLayout } from '../content/zone';
import { createGameState, drainEvents, type GameState, type SimEvent } from '../sim/state';
import { damageEnemy } from './combat';
import { activeBounds, stepMovement } from './movement';
import { stepObjectives } from './objectives';

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

/** Kill every camp enemy and run one objective step. */
function clearAllCamps(state: GameState): void {
  for (const enemy of state.enemies.filter((e) => e.camp >= 0 && !e.dead)) {
    enemy.hp = 0;
    enemy.dead = true;
  }
  stepObjectives(state, []);
}

function enterArena(state: GameState, events: SimEvent[] = []): void {
  state.player.position.x = state.arena.center.x;
  state.player.position.z = state.arena.center.z;
  stepObjectives(state, events);
}

function warden(state: GameState) {
  return state.enemies.find((e) => e.defId === 'ashen-warden');
}

describe('zone objectives (optional camps, end Warden)', () => {
  it('clears camps as their last member falls and toasts progress', () => {
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

  it('keeps the Warden asleep when every optional camp is cleared', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];

    clearAllCamps(state);
    expect(state.objectives.campCleared.every(Boolean)).toBe(true);
    expect(state.objectives.bossSpawned).toBe(false);
    expect(warden(state)).toBeUndefined();
    expect(events.some((e) => e.kind === 'objective' && e.text.includes('Warden'))).toBe(false);
  });

  it('wakes the Warden when the hero enters the end arena', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];

    stepObjectives(state, events);
    expect(state.objectives.bossSpawned).toBe(false);

    enterArena(state, events);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(warden(state)?.dead).toBe(false);
    expect(events.some((e) => e.kind === 'objective' && e.text.includes('Warden stirs'))).toBe(true);
  });

  it('does not move the hero when the Warden wakes', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    state.player.position = { x: state.arena.center.x, z: state.arena.center.z + state.arena.radius - 1 };
    const before = { ...state.player.position };

    stepObjectives(state, []);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(state.player.position).toEqual(before);
  });

  it('still supports the frozen camp trigger for legacy fixture zones', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    state.bossTrigger = 'camps';

    clearAllCamps(state);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(warden(state)?.dead).toBe(false);
  });

  it('fires victory only when the Warden falls in the final campaign zone', () => {
    const finalState = createGameState(getClass('marauder'), layoutWithCamps());
    const finalEvents: SimEvent[] = [];
    enterArena(finalState);
    kill(finalState, warden(finalState)!.id, finalEvents);
    stepObjectives(finalState, finalEvents);
    expect(finalState.objectives.bossDefeated).toBe(true);
    expect(finalEvents.some((e) => e.kind === 'victory')).toBe(true);

    const earlierState = createGameState(getClass('marauder'), layoutWithCamps());
    earlierState.finalZone = 'drowned-ossuary';
    const earlierEvents: SimEvent[] = [];
    enterArena(earlierState);
    kill(earlierState, warden(earlierState)!.id, earlierEvents);
    stepObjectives(earlierState, earlierEvents);
    expect(earlierState.objectives.bossDefeated).toBe(true);
    expect(earlierEvents.some((e) => e.kind === 'victory')).toBe(false);
    expect(earlierEvents.some((e) => e.kind === 'objective' && e.text.includes('Gate opens'))).toBe(true);
  });

  it('opens the gate alongside a final-zone victory', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    enterArena(state);
    kill(state, warden(state)!.id, events);
    stepObjectives(state, events);

    const victoryIndex = events.findIndex((e) => e.kind === 'victory');
    const gateIndex = events.findIndex((e) => e.kind === 'objective' && e.text.includes('Gate opens'));
    expect(victoryIndex).toBeGreaterThanOrEqual(0);
    // The gate toast is emitted after victory so the victory screen's toast
    // clear cannot swallow it.
    expect(gateIndex).toBeGreaterThan(victoryIndex);
  });

  it('never clamps the hero to the arena while the Warden is live', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    enterArena(state);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(activeBounds(state)).toBe(state.bounds);

    // Walk back toward the zone spawn; the live fight must not pull the hero
    // back inside the arena.
    state.player.position.x = state.arena.center.x;
    state.player.position.z = state.arena.center.z;
    state.player.moveTarget = { x: 0, z: 0 };
    for (let i = 0; i < 60 * 3; i++) stepMovement(state, 1 / 60);

    const distToArena = Math.hypot(
      state.player.position.x - state.arena.center.x,
      state.player.position.z - state.arena.center.z,
    );
    expect(distToArena).toBeGreaterThan(state.arena.radius);
    expect(activeBounds(state)).toBe(state.bounds);
    drainEvents(state);
  });

  it('lets a campless zone wake its end boss', () => {
    const plain: ZoneLayout = {
      ...layoutWithCamps(),
      enemySpawns: [{ enemyId: 'ashen-husk', x: 4, z: 4, elite: [] }],
    };
    const state = createGameState(getClass('marauder'), plain);
    expect(state.objectives.campsTotal).toBe(0);

    stepObjectives(state, []);
    expect(state.objectives.bossSpawned).toBe(false);

    enterArena(state);
    expect(state.objectives.bossSpawned).toBe(true);
  });
});

describe('linear moor objectives', () => {
  it('boots with 16 optional camps and the Warden asleep at the end', () => {
    const layout = generateZoneLayout();
    const state = createGameState(getClass('ranger'), layout);

    expect(state.corridor).toEqual(layout.corridor);
    expect(state.objectives.campsTotal).toBe(16);
    expect(state.objectives.campCleared).toHaveLength(16);
    expect(state.objectives.bossSpawned).toBe(false);
    expect(state.portal).toEqual({ x: 0, z: -80 });
    expect(state.arena.center).toEqual({ x: 0, z: -72 });
    expect(state.enemies.some((enemy) => enemy.defId === 'ashen-warden')).toBe(false);

    stepObjectives(state, []);
    expect(state.objectives.bossSpawned).toBe(false);
  });

  it('clearing all 16 camps never gates the Warden', () => {
    const layout = generateZoneLayout();
    const state = createGameState(getClass('marauder'), layout);
    for (const enemy of state.enemies) {
      if (enemy.camp >= 0) enemy.dead = true;
    }
    stepObjectives(state, []);
    expect(state.objectives.campCleared.every(Boolean)).toBe(true);
    expect(state.objectives.bossSpawned).toBe(false);
    expect(state.enemies.some((enemy) => enemy.defId === 'ashen-warden')).toBe(false);

    // Walking into the end clearing still wakes him, with camps irrelevant.
    state.player.position = { x: state.arena.center.x, z: state.arena.center.z };
    stepObjectives(state, []);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(state.enemies.some((enemy) => enemy.defId === 'ashen-warden')).toBe(true);
  });

  it('ends the final-zone run and opens the portal when the Warden dies', () => {
    const layout = generateZoneLayout();
    const state = createGameState(getClass('witch'), layout);
    const events: SimEvent[] = [];

    state.player.position = { x: state.arena.center.x, z: state.arena.center.z + state.arena.radius - 1 };
    stepObjectives(state, events);
    expect(state.objectives.bossSpawned).toBe(true);
    const boss = state.enemies.find((enemy) => enemy.defId === 'ashen-warden')!;
    kill(state, boss.id, events);
    stepObjectives(state, events);

    expect(state.objectives.bossDefeated).toBe(true);
    expect(events.some((event) => event.kind === 'victory')).toBe(true);
    expect(events.some((event) => event.kind === 'objective' && event.text.includes('Gate opens'))).toBe(true);
    expect(state.portal).toEqual({ x: 0, z: -80 });
  });

  it('keeps the corridor walkable after the Warden wakes', () => {
    const layout = generateZoneLayout();
    const state = createGameState(getClass('marauder'), layout);
    state.player.position = { x: state.arena.center.x, z: state.arena.center.z };
    stepObjectives(state, []);
    expect(state.objectives.bossSpawned).toBe(true);
    expect(activeBounds(state)).toBe(state.bounds);

    // Retreat up the corridor: the Warden no longer holds an arena clamp.
    state.player.moveTarget = { x: 12, z: 10 };
    for (let i = 0; i < 60 * 12; i++) stepMovement(state, 1 / 60);
    expect(state.player.position.z).toBeGreaterThan(state.arena.center.z + state.arena.radius);
    drainEvents(state);
  });
});
