import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { CircleCollider, ZoneLayout } from '../content/types';
import { createGameState } from '../sim/state';
import { cancelMove, activeBounds, setMoveTarget, stepMovement } from './movement';

function testLayout(colliders: CircleCollider[] = []): ZoneLayout {
  return {
    seed: 1,
    name: 'test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders,
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

function runTicks(state: ReturnType<typeof createGameState>, ticks: number, dt = 1 / 60): void {
  for (let i = 0; i < ticks; i++) stepMovement(state, dt);
}

describe('stepMovement', () => {
  it('moves the player to the click target and stops', () => {
    const state = createGameState(getClass('ranger'), testLayout());
    setMoveTarget(state, { x: 6, z: 6 });
    runTicks(state, 60 * 5);

    expect(state.player.moveTarget).toBeNull();
    const p = state.player.position;
    expect(Math.hypot(p.x - 6, p.z - 6)).toBeLessThan(0.3);
    expect(Math.hypot(state.player.velocity.x, state.player.velocity.z)).toBeLessThan(0.05);
  });

  it('is deterministic for identical inputs', () => {
    const a = createGameState(getClass('marauder'), testLayout());
    const b = createGameState(getClass('marauder'), testLayout());
    setMoveTarget(a, { x: -10, z: 4 });
    setMoveTarget(b, { x: -10, z: 4 });
    runTicks(a, 300);
    runTicks(b, 300);
    expect(a.player.position).toEqual(b.player.position);
    expect(a.tick).toBe(300);
  });

  it('slides along colliders instead of passing through them', () => {
    // Collider directly on the spawn-to-target line (0,18) -> (0,2).
    const colliders: CircleCollider[] = [{ id: 'wall', x: 0, z: 10, radius: 1 }];
    const state = createGameState(getClass('ranger'), testLayout(colliders));
    setMoveTarget(state, { x: 0, z: 2 });
    runTicks(state, 60 * 4);

    const p = state.player.position;
    const distToCollider = Math.hypot(p.x - 0, p.z - 10);
    expect(distToCollider).toBeGreaterThanOrEqual(1 + state.player.radius - 1e-6);
    // Pressed up against the obstacle, unable to pass.
    expect(p.z).toBeGreaterThan(10);
    expect(state.player.moveTarget).not.toBeNull(); // target unreachable
  });

  it('slides around a collider to reach an offset target', () => {
    const colliders: CircleCollider[] = [{ id: 'wall', x: 0, z: 10, radius: 1 }];
    const state = createGameState(getClass('ranger'), testLayout(colliders));
    setMoveTarget(state, { x: 6, z: 4 });
    runTicks(state, 60 * 8);

    const p = state.player.position;
    expect(Math.hypot(p.x - 6, p.z - 4)).toBeLessThan(0.5);
    expect(state.player.moveTarget).toBeNull();
  });

  it('resolves deep overlap without tunneling', () => {
    const colliders: CircleCollider[] = [{ id: 'rock', x: 0, z: 18, radius: 1 }];
    const state = createGameState(getClass('marauder'), testLayout(colliders));
    // Spawn is inside the collider: the sim must push the player out.
    runTicks(state, 120);
    const dist = Math.hypot(state.player.position.x, state.player.position.z - 18);
    expect(dist).toBeGreaterThanOrEqual(1 + state.player.radius - 1e-6);
  });

  it('keeps the player inside the zone bounds', () => {
    const state = createGameState(getClass('witch'), testLayout());
    setMoveTarget(state, { x: 500, z: 500 });
    runTicks(state, 60 * 30);

    const dist = Math.hypot(state.player.position.x, state.player.position.z);
    expect(dist).toBeLessThanOrEqual(state.bounds.radius);
    // Destination outside bounds gets clamped too.
    setMoveTarget(state, { x: 500, z: 500 });
    const target = state.player.moveTarget;
    expect(target).not.toBeNull();
    expect(Math.hypot(target!.x, target!.z)).toBeLessThanOrEqual(state.bounds.radius);
  });

  it('faces the movement direction', () => {
    const state = createGameState(getClass('marauder'), testLayout());
    setMoveTarget(state, { x: 20, z: 18 }); // due +X from spawn (0, 18)
    runTicks(state, 60);
    expect(state.player.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it('cancelMove stops the player', () => {
    const state = createGameState(getClass('marauder'), testLayout());
    setMoveTarget(state, { x: -12, z: -12 });
    runTicks(state, 30);
    cancelMove(state);
    runTicks(state, 60);
    expect(Math.hypot(state.player.velocity.x, state.player.velocity.z)).toBeLessThan(0.05);
    expect(state.player.moveTarget).toBeNull();
  });

  it('keeps the whole zone walkable while a boss is live', () => {
    const state = createGameState(getClass('marauder'), testLayout());
    state.objectives.bossSpawned = true;
    expect(activeBounds(state)).toBe(state.bounds);

    // Start in the arena and walk back down the zone; no clamp holds the hero.
    state.player.position = { x: state.arena.center.x, z: state.arena.center.z };
    setMoveTarget(state, { x: 0, z: 0 });
    runTicks(state, 60 * 3);

    const distToArena = Math.hypot(
      state.player.position.x - state.arena.center.x,
      state.player.position.z - state.arena.center.z,
    );
    expect(distToArena).toBeGreaterThan(state.arena.radius);
  });
});
