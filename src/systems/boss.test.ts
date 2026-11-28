import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { getEnemy } from '../content/enemies';
import type { ZoneLayout } from '../content/types';
import { createEnemyState, createGameState, type EnemyState, type GameState, type SimEvent } from '../sim/state';
import { stepEnemies } from './enemyAi';

function layoutWithCamps(): ZoneLayout {
  return {
    seed: 21,
    name: 'boss-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    enemySpawns: [{ enemyId: 'ashen-husk', x: -6, z: 10, elite: [], camp: 0 }],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [], camp: -1 },
  };
}

function spawnBoss(state: GameState): EnemyState {
  const boss = createEnemyState(state.bossSpawn, 'boss-test');
  state.enemies.push(boss);
  state.objectives.bossSpawned = true;
  // No evasion, no armour: strikes in these tests read raw damage.
  state.player.evasion = 0;
  state.player.armour = 0;
  return boss;
}

describe('Ashen Warden boss encounter (slice 7)', () => {
  it('advances phases as hp falls and calls adds', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    const boss = spawnBoss(state);
    const minionsBefore = state.enemies.length;

    boss.hp = Math.floor(boss.maxHp * 0.5); // below phase 2's threshold
    stepEnemies(state, 1 / 60, events);
    expect(boss.bossPhase).toBe(1);
    expect(state.enemies.length).toBe(minionsBefore + 3); // phase 2 brings three adds
    expect(events.some((e) => e.kind === 'boss-phase' && e.phase === 1)).toBe(true);
    expect(state.enemies.some((e) => e.id.startsWith('add-') && e.aggro)).toBe(true);

    boss.hp = Math.floor(boss.maxHp * 0.2); // below phase 3's threshold
    stepEnemies(state, 1 / 60, events);
    expect(boss.bossPhase).toBe(2);
    expect(events.some((e) => e.kind === 'boss-phase' && e.phase === 2)).toBe(true);
  });

  it('phase patterns carry their own telegraph shapes', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    const boss = spawnBoss(state);
    boss.hp = Math.floor(boss.maxHp * 0.5); // phase 2: ground slams
    state.player.position.x = boss.position.x + 2;
    state.player.position.z = boss.position.z;

    let slamTelegraph: Extract<SimEvent, { kind: 'telegraph' }> | undefined;
    for (let i = 0; i < 600 && !slamTelegraph; i++) {
      stepEnemies(state, 1 / 60, events);
      slamTelegraph = events.find(
        (e): e is Extract<SimEvent, { kind: 'telegraph' }> => e.kind === 'telegraph' && e.shape === 'slam',
      );
    }
    expect(slamTelegraph).toBeDefined();
    expect(slamTelegraph!.tier).toBe('boss');
    // The slam is announced where the player stood when the windup started.
    expect(Math.hypot(slamTelegraph!.x - boss.strikeTarget.x, slamTelegraph!.z - boss.strikeTarget.z)).toBeLessThan(0.01);
    expect(slamTelegraph!.radius).toBe(getEnemy('ashen-warden').boss!.phases[1].attack.range);
  });

  it('the slam hurts only heroes standing in the landing circle', () => {
    const runSlam = (inside: boolean): number => {
      const state = createGameState(getClass('marauder'), layoutWithCamps());
      const events: SimEvent[] = [];
      const boss = spawnBoss(state);
      boss.bossPhase = 1; // slam pattern
      boss.strikeTarget = { x: 0, z: -30 };
      boss.attackId = 'slam-test';
      boss.phase = 'windup';
      boss.phaseTime = getEnemy('ashen-warden').boss!.phases[1].attack.windup - 0.001;
      state.player.position.x = inside ? 0 : 25;
      state.player.position.z = -30;
      stepEnemies(state, 1 / 60, events);
      const hit = events.find((e) => e.kind === 'damage' && e.targetKind === 'player');
      return hit && hit.kind === 'damage' ? hit.amount : 0;
    };

    expect(runSlam(true)).toBeGreaterThan(0);
    expect(runSlam(false)).toBe(0);
  });

  it('the enraged phase multiplier scales its strikes', () => {
    const state = createGameState(getClass('marauder'), layoutWithCamps());
    const events: SimEvent[] = [];
    const boss = spawnBoss(state);
    boss.hp = Math.floor(boss.maxHp * 0.2);
    stepEnemies(state, 1 / 60, events); // advance to the enraged phase
    expect(boss.bossPhase).toBe(2);

    const attack = getEnemy('ashen-warden').boss!.phases[2].attack;
    boss.attackId = 'rage-test';
    boss.phase = 'windup';
    boss.phaseTime = attack.windup - 0.001;
    boss.windupFacing = 0; // +Z, straight at the hero
    boss.lungeRemaining = 6;
    boss.lungeHit = false;
    state.player.position.x = boss.position.x;
    state.player.position.z = boss.position.z + 1.5;

    stepEnemies(state, 1 / 60, events); // windup -> active, the charge starts
    stepEnemies(state, 1 / 60, events); // travel sweeps through the hero

    const hit = events.find((e) => e.kind === 'damage' && e.targetKind === 'player');
    expect(hit).toBeDefined();
    if (hit?.kind === 'damage') {
      // 1.35x over the pounce's 18-26 base.
      expect(hit.amount).toBeGreaterThanOrEqual(Math.floor(attack.damage.min * 1.35));
    }
  });
});
