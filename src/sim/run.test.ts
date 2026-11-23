import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { damagePlayer } from '../systems/combat';
import { respawnPlayer, stepRun } from './run';
import { createGameState, drainEvents } from './state';

const layout: ZoneLayout = {
  seed: 9,
  name: 'Respawn fixture',
  bounds: { center: { x: 0, z: 0 }, radius: 42 },
  spawn: { x: 0, z: 18 },
  colliders: [],
  props: [],
  enemySpawns: [
    { enemyId: 'cinder-cultist', x: 0, z: 8, elite: [] },
    { enemyId: 'ashen-husk', x: 1.5, z: 18, elite: [] },
  ],
};

describe('run lifecycle', () => {
  it('cancels a live bolt and melee windup without discarding encounter progress', () => {
    const state = createGameState(getClass('marauder'), layout);
    state.xp = 12;
    const [cultist, husk] = state.enemies;
    husk.hp -= 5;
    for (let i = 0; i < 75; i++) stepRun(state, 1 / 60);
    // Keep the husk in a new windup while a real cultist bolt is airborne.
    husk.phase = 'windup';
    husk.phaseTime = 0.79;
    husk.attackId = 'old-husk-windup';
    expect(state.projectiles[0]?.owner).toBe(cultist.id);
    state.player.attackTargetId = husk.id;
    state.player.attackCooldown = 0.5;
    damagePlayer(state, 1000, state.events);
    drainEvents(state);
    const deathTick = state.tick;
    stepRun(state, 1 / 60);
    expect(state.tick).toBe(deathTick);

    respawnPlayer(state, layout.spawn);
    expect(state.projectiles).toHaveLength(0);
    expect(state.xp).toBe(12);
    expect(husk.hp).toBe(husk.maxHp - 5);
    expect(state.player).toMatchObject({ hp: state.player.maxHp, position: layout.spawn, attackTargetId: null, attackCooldown: 0 });
    for (const enemy of state.enemies) {
      expect(enemy).toMatchObject({ phase: 'idle', phaseTime: 0, attackId: null, aggro: false, velocity: { x: 0, z: 0 } });
    }
    for (let i = 0; i < 10; i++) stepRun(state, 1 / 60);
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.events.some((ev) => ev.kind === 'telegraph' && ev.enemyId === husk.id)).toBe(true);
  });
});
