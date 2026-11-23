import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createGameState, type GameState, type SimEvent } from '../sim/state';
import { damagePlayer, stepPlayerCombat } from './combat';
import {
  armourMitigation,
  ES_RECHARGE_DELAY,
  ES_RECHARGE_RATE,
  evadeChance,
  syncPlayerStats,
} from './stats';

function layout(): ZoneLayout {
  return {
    seed: 11,
    name: 'stats-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    enemySpawns: [],
  };
}

function freshState(classId: 'marauder' | 'ranger' | 'witch'): GameState {
  const state = createGameState(getClass(classId), layout());
  syncPlayerStats(state);
  return state;
}

describe('defence layers (stat rework)', () => {
  it('attack hits roll evasion; spells never miss', () => {
    const state = freshState('ranger');
    const events: SimEvent[] = [];
    state.player.evasion = 1e6; // hit the evade cap
    state.player.energyShield = 0;

    let evades = 0;
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      const before = state.runStats.evades;
      damagePlayer(state, 1, events, { damageClass: 'attack' });
      if (state.runStats.evades > before) evades++;
      else hits++;
    }
    expect(evades).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0); // the cap keeps some hits landing

    const hpBefore = state.player.hp;
    damagePlayer(state, 1, events, { damageClass: 'spell' });
    expect(state.runStats.evades).toBe(evades); // spells never roll evasion
    expect(state.player.hp).toBeLessThan(hpBefore);
  });

  it('armour mitigates attack hits with diminishing returns; spells bypass it', () => {
    const state = freshState('marauder');
    const events: SimEvent[] = [];
    state.player.evasion = 0;
    state.player.energyShield = 0;

    damagePlayer(state, 100, events, { damageClass: 'spell' });
    const spellTaken = state.runStats.damageTaken;
    expect(spellTaken).toBe(100); // nothing to stop a spell

    damagePlayer(state, 100, events, { damageClass: 'attack' });
    const attackTaken = state.runStats.damageTaken - spellTaken;
    expect(attackTaken).toBeLessThan(100);
    expect(attackTaken).toBeGreaterThan(0);

    // Same mitigation the pipeline uses: armour helps more against small hits.
    expect(armourMitigation(200, 10)).toBeGreaterThan(armourMitigation(200, 100));
    expect(armourMitigation(1e6, 5)).toBeLessThanOrEqual(0.9);
  });

  it('energy shield absorbs first, then life', () => {
    const state = freshState('witch');
    const events: SimEvent[] = [];
    expect(state.player.maxEnergyShield).toBeGreaterThan(0);
    const es = state.player.energyShield;
    const hp = state.player.hp;

    damagePlayer(state, Math.round(es * 0.5), events, { damageClass: 'spell' });
    expect(state.player.hp).toBe(hp); // fully absorbed
    expect(state.player.energyShield).toBeLessThan(es);
    expect(events.some((ev) => ev.kind === 'damage' && (ev.absorbed ?? 0) > 0)).toBe(true);

    damagePlayer(state, es, events, { damageClass: 'spell' });
    expect(state.player.energyShield).toBe(0);
    expect(state.player.hp).toBeLessThan(hp); // overflow reaches life
    expect(state.player.esRechargeDelay).toBeCloseTo(ES_RECHARGE_DELAY, 5);
  });

  it('the shield recharges only after the no-damage delay', () => {
    const state = freshState('witch');
    const events: SimEvent[] = [];
    damagePlayer(state, state.player.energyShield, events, { damageClass: 'spell' });
    expect(state.player.energyShield).toBe(0);

    // Within the delay: no recharge.
    for (let i = 0; i < 60; i++) stepPlayerCombat(state, 1 / 60, events);
    expect(state.player.energyShield).toBe(0);

    // After the delay: the pool refills at the recharge rate.
    const ticks = Math.ceil((ES_RECHARGE_DELAY + 1 / ES_RECHARGE_RATE) * 60);
    for (let i = 0; i < ticks && state.player.energyShield < state.player.maxEnergyShield; i++) {
      stepPlayerCombat(state, 1 / 60, events);
    }
    expect(state.player.energyShield).toBe(state.player.maxEnergyShield);
    expect(evadeChance(state.player.evasion)).toBeGreaterThanOrEqual(0);
  });

  it('evasion chance grows with the rating and is capped', () => {
    expect(evadeChance(0)).toBe(0);
    expect(evadeChance(200)).toBeCloseTo(0.5, 5);
    expect(evadeChance(1e9)).toBeLessThanOrEqual(0.75);
    expect(evadeChance(500)).toBeGreaterThan(evadeChance(100));
  });
});
