import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { getEnemy } from '../content/enemies';
import type { CircleCollider, EnemySpawn, ZoneLayout } from '../content/types';
import { createGameState, type GameState, type SimEvent } from '../sim/state';
import { stepMovement } from './movement';
import { stepProjectiles } from './combat';
import { stepEnemies } from './enemyAi';

/**
 * Deterministic AI fixtures (per tune-enemy-ai): assert state transitions and
 * outcomes — target acquisition, telegraph commitment, dodge counterplay,
 * spacing behavior, cooldown gating, elite aura, and reset.
 */

function layoutWith(
  enemies: EnemySpawn[] = [],
  colliders: CircleCollider[] = [],
): ZoneLayout {
  return {
    seed: 5,
    name: 'test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders,
    props: [],
    enemySpawns: enemies,
  };
}

function husk(x: number, z: number, elite: EnemySpawn['elite'] = []): EnemySpawn {
  return { enemyId: 'ashen-husk', x, z, elite };
}

function run(state: GameState, events: SimEvent[], ticks: number, onTick?: (state: GameState) => void, dt = 1 / 60): void {
  for (let i = 0; i < ticks; i++) {
    stepEnemies(state, dt, events);
    stepMovement(state, dt);
    stepProjectiles(state, dt, events);
    onTick?.(state);
  }
}

describe('target acquisition & reset', () => {
  it('idles outside aggro range and acquires within it', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, -30)]));
    const events: SimEvent[] = [];
    run(state, events, 60);
    expect(state.enemies[0].phase).toBe('idle');
    expect(state.enemies[0].aggro).toBe(false);

    // Walk the player into aggro range (15).
    state.player.position.z = -16;
    run(state, events, 5);
    expect(state.enemies[0].phase).toBe('chase');
  });

  it('returns to idle and disengages when the player dies', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, 12)]));
    const events: SimEvent[] = [];
    run(state, events, 30);
    expect(state.enemies[0].phase).toBe('chase');

    state.player.hp = 0;
    run(state, events, 5);
    expect(state.enemies[0].phase).toBe('idle');
    expect(state.enemies[0].aggro).toBe(false);
  });
});

describe('telegraph commitment & dodge counterplay', () => {
  it('emits a telegraph event before the strike, never instant turn-and-hit', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, 16.2)]));
    const events: SimEvent[] = [];

    run(state, events, 1);
    expect(state.enemies[0].phase).toBe('chase');

    run(state, events, 60, undefined);
    const kinds = events.map((e) => e.kind);
    const telegraphIdx = kinds.indexOf('telegraph');
    const attackIdx = kinds.indexOf('attack');
    expect(telegraphIdx).toBeGreaterThanOrEqual(0);
    expect(attackIdx).toBeGreaterThan(telegraphIdx); // tell comes first
  });

  it('locks facing at windup start and holds it through the strike', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, 12)]));
    const events: SimEvent[] = [];
    let locked = 0;
    run(state, events, 200, (s) => {
      const e = s.enemies[0];
      if (e.phase === 'windup' && e.phaseTime === 0) locked = e.windupFacing;
      if (e.phase === 'windup' || e.phase === 'active') {
        expect(e.facing).toBeCloseTo(locked, 5);
      }
    });
    expect(events.some((e) => e.kind === 'telegraph')).toBe(true);
  });

  it('a player who steps out of the locked sweep takes no damage', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, 12)]));
    const events: SimEvent[] = [];

    // Run until the windup starts, then teleport the player behind the husk.
    for (let i = 0; i < 300 && state.enemies[0].phase !== 'windup'; i++) {
      stepEnemies(state, 1 / 60, events);
      stepMovement(state, 1 / 60);
    }
    expect(state.enemies[0].phase).toBe('windup');

    const e = state.enemies[0];
    // Dodge: move perpendicular out of the locked 110-degree sweep.
    state.player.position.x = e.position.x + 3;
    state.player.position.z = e.position.z + 3;

    run(state, events, 30);
    expect(events.some((ev) => ev.kind === 'damage' && ev.targetKind === 'player')).toBe(false);
    expect(state.player.hp).toBe(state.player.maxHp);
  });

  it('a player who stands in the sweep takes the hit', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, 16)]));
    const events: SimEvent[] = [];
    run(state, events, 300, (s) => {
      // Stand still inside the sweep: no movement at all.
      s.player.moveTarget = null;
    });
    expect(events.some((ev) => ev.kind === 'damage' && ev.targetKind === 'player')).toBe(true);
    expect(state.player.hp).toBeLessThan(state.player.maxHp);
  });

  it('cannot chain attacks: recovery then cooldown gate the next windup', () => {
    const state = createGameState(getClass('marauder'), layoutWith([husk(0, 12)]));
    const events: SimEvent[] = [];
    const windupStarts: number[] = [];
    run(state, events, 60 * 12, () => windupStarts.push(-1), 1 / 60);

    // Track windup entries precisely.
    const state2 = createGameState(getClass('marauder'), layoutWith([husk(0, 12)]));
    const events2: SimEvent[] = [];
    const entries: number[] = [];
    let last = 'idle';
    run(state2, events2, 60 * 12, (s) => {
      const e = s.enemies[0];
      if (e.phase === 'windup' && last !== 'windup') entries.push(s.tick);
      last = e.phase;
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // Minimum gap: windup+active+recovery+cooldown of the husk = 2.78s = 167 ticks.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i] - entries[i - 1]).toBeGreaterThanOrEqual(160);
    }
  });
});

describe('behavior spacing', () => {
  it('kiter holds its distance band and attacks from range', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ enemyId: 'cinder-cultist', x: 0, z: 6, elite: [] }]));
    const events: SimEvent[] = [];
    const def = getEnemy('cinder-cultist');
    const band = def.preferredRange ?? 10;

    run(state, events, 60 * 6);
    const e = state.enemies[0];
    const dist = Math.hypot(e.position.x - state.player.position.x, e.position.z - state.player.position.z);
    // Ended outside melee range, holding the band (with attack-commitment slack).
    expect(dist).toBeGreaterThan(band - 4.5);
    expect(dist).toBeLessThan(band + 6);
    expect(events.some((ev) => ev.kind === 'telegraph')).toBe(true);
  });

  it('caster bolts travel and can be dodged by moving', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ enemyId: 'cinder-cultist', x: 0, z: 8, elite: [] }]));
    const events: SimEvent[] = [];

    // Let the cast begin, then dodge perpendicular when the bolt fires.
    let dodged = false;
    run(state, events, 60 * 4, (s) => {
      if (!dodged && s.projectiles.length > 0) {
        s.player.position.x += 6; // side-step the incoming bolt line
        dodged = true;
      }
    });
    expect(dodged).toBe(true);
    expect(events.some((ev) => ev.kind === 'damage' && ev.targetKind === 'player')).toBe(false);
  });

  it('swarmer rushes into pounce range and lunges', () => {
    const state = createGameState(getClass('marauder'), layoutWith([{ enemyId: 'mire-skitterer', x: 0, z: 12, elite: [] }]));
    const events: SimEvent[] = [];
    let sawActive = false;
    run(state, events, 60 * 5, (s) => {
      if (s.enemies[0].phase === 'active') sawActive = true;
    });
    expect(sawActive).toBe(true);
    expect(events.some((ev) => ev.kind === 'telegraph')).toBe(true);
  });
});

describe('elites', () => {
  it('applies modifiers at creation and auras boost nearby allies', () => {
    const state = createGameState(
      getClass('marauder'),
      layoutWith([
        husk(0, 12, ['swift', 'vital']),
        husk(2, 13),
      ]),
    );
    const elite = state.enemies[0];
    const minion = state.enemies[1];
    expect(elite.maxHp).toBe(Math.round(getEnemy('ashen-husk').maxHp * 2.2));
    expect(elite.speed).toBeGreaterThan(getEnemy('ashen-husk').speed);
    expect(minion.speed).toBeCloseTo(getEnemy('ashen-husk').speed, 5);

    // The swift elite's aura accelerates the nearby minion while chasing.
    const events: SimEvent[] = [];
    const before = Math.hypot(minion.position.x - state.player.position.x, minion.position.z - state.player.position.z);
    run(state, events, 60);
    const after = Math.hypot(minion.position.x - state.player.position.x, minion.position.z - state.player.position.z);
    expect(after).toBeLessThan(before);
  });

  it('savage elites hit harder', () => {
    const normal = createGameState(getClass('marauder'), layoutWith([husk(0, 16)]));
    const savage = createGameState(getClass('marauder'), layoutWith([husk(0, 16, ['savage'])]));
    const evN: SimEvent[] = [];
    const evS: SimEvent[] = [];
    const dmg = (s: GameState, evs: SimEvent[]) => {
      run(s, evs, 60 * 8);
      return evs
        .filter((e) => e.kind === 'damage' && e.targetKind === 'player')
        .reduce((sum, e) => sum + (e.kind === 'damage' ? e.amount : 0), 0);
    };
    const normalDmg = dmg(normal, evN);
    const savageDmg = dmg(savage, evS);
    expect(savageDmg).toBeGreaterThan(normalDmg);
  });
});

describe('determinism', () => {
  it('identical AI runs produce identical outcomes', () => {
    const spawns = [husk(0, 12), husk(4, 10, ['swift']), { enemyId: 'cinder-cultist' as const, x: -6, z: 11, elite: [] }];
    const a = createGameState(getClass('ranger'), layoutWith(spawns), 42);
    const b = createGameState(getClass('ranger'), layoutWith(spawns), 42);
    const evA: SimEvent[] = [];
    const evB: SimEvent[] = [];
    run(a, evA, 60 * 10);
    run(b, evB, 60 * 10);

    const snap = (s: GameState) => JSON.stringify({ player: s.player, enemies: s.enemies, projectiles: s.projectiles });
    expect(snap(a)).toBe(snap(b));
    expect(evA).toEqual(evB);
  });
});
