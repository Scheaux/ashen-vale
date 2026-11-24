import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createRng } from '../core/rng';
import { rollItem, type ItemInstance } from '../sim/items';
import { createGameState, type GameState, type SimEvent } from '../sim/state';
import { equipItem, ownedItemCount, pickupDrop, unequipItem, BAG_CAP } from './inventory';
import { grantXp, xpToNext } from './progression';
import { armourMitigation, computeStats, evadeChance, getPlayerStats, scalePlayerDamage, syncPlayerStats } from './stats';

function emptyLayout(): ZoneLayout {
  return {
    seed: 7,
    name: 'test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

function makeState(): GameState {
  return createGameState(getClass('marauder'), emptyLayout(), 7);
}

function dropIntoWorld(state: GameState, item: ItemInstance): string {
  const id = `drop-${state.loot.length}`;
  state.loot.push({ id, item, x: state.player.position.x, z: state.player.position.z });
  return id;
}

function lifeItem(value: number): ItemInstance {
  return {
    uid: `test-life-${value}-${Math.random()}`,
    baseId: 'padded-vest',
    slot: 'chest',
    rarity: 'magic',
    name: 'Padded Vest',
    itemLevel: 1,
    affixes: [{ id: 'life', value }],
  };
}

describe('pickup transactions', () => {
  it('moves a drop into the bag and emits a pickup event', () => {
    const state = makeState();
    const events: SimEvent[] = [];
    const item = rollItem(createRng(1), 1);
    const dropId = dropIntoWorld(state, item);

    const result = pickupDrop(state, dropId, events);
    expect(result).toEqual({ ok: true });
    expect(state.inventory.bags).toHaveLength(1);
    expect(state.inventory.bags[0].uid).toBe(item.uid);
    expect(state.loot).toHaveLength(0);
    expect(events.some((e) => e.kind === 'pickup')).toBe(true);
  });

  it('rejects unknown drops and full bags without mutating anything', () => {
    const state = makeState();
    const events: SimEvent[] = [];
    expect(pickupDrop(state, 'nope', events)).toEqual({ ok: false, reason: 'unknown-drop' });

    const item = rollItem(createRng(2), 1);
    const dropId = dropIntoWorld(state, item);
    state.inventory.bags = Array.from({ length: BAG_CAP }, () => lifeItem(1));
    const before = ownedItemCount(state);

    expect(pickupDrop(state, dropId, events)).toEqual({ ok: false, reason: 'bag-full' });
    expect(state.loot).toHaveLength(1); // drop still in the world
    expect(ownedItemCount(state)).toBe(before);
    expect(events).toHaveLength(0);
  });

  it('is idempotent: picking up the same drop twice fails cleanly', () => {
    const state = makeState();
    const events: SimEvent[] = [];
    const dropId = dropIntoWorld(state, rollItem(createRng(3), 1));
    expect(pickupDrop(state, dropId, events).ok).toBe(true);
    expect(pickupDrop(state, dropId, events)).toEqual({ ok: false, reason: 'unknown-drop' });
    expect(state.inventory.bags).toHaveLength(1);
  });
});

describe('equip/unequip transactions', () => {
  it('equips from the bag and returns the previous item to the bag (atomic swap)', () => {
    const state = makeState();
    const first = { ...lifeItem(10), uid: 'a', slot: 'chest' as const };
    const second = { ...lifeItem(20), uid: 'b', slot: 'chest' as const };
    state.inventory.bags.push(first, second);

    expect(equipItem(state, 'a').ok).toBe(true);
    expect(state.inventory.equipment.chest?.uid).toBe('a');

    expect(equipItem(state, 'b').ok).toBe(true);
    expect(state.inventory.equipment.chest?.uid).toBe('b');
    expect(state.inventory.bags.map((i) => i.uid)).toEqual(['a']);
  });

  it('conserves item identity across equip/unequip cycles', () => {
    const state = makeState();
    const item = { ...lifeItem(5), uid: 'keep-me' };
    state.inventory.bags.push(item);
    const before = ownedItemCount(state);

    equipItem(state, 'keep-me');
    unequipItem(state, 'chest');
    equipItem(state, 'keep-me');
    unequipItem(state, 'chest');

    expect(ownedItemCount(state)).toBe(before);
    expect(state.inventory.bags[0].uid).toBe('keep-me');
  });

  it('rejects unknown uids and empty-slot unequips', () => {
    const state = makeState();
    expect(equipItem(state, 'ghost')).toEqual({ ok: false, reason: 'not-in-bag' });
    expect(unequipItem(state, 'weapon')).toEqual({ ok: false, reason: 'empty-slot' });
  });

  it('rejects unequipping into a full bag', () => {
    const state = makeState();
    state.inventory.equipment.chest = { ...lifeItem(3), uid: 'equipped' };
    state.inventory.bags = Array.from({ length: BAG_CAP }, () => lifeItem(1));
    expect(unequipItem(state, 'chest')).toEqual({ ok: false, reason: 'bag-full' });
    expect(state.inventory.equipment.chest?.uid).toBe('equipped');
    expect(state.inventory.bags).toHaveLength(BAG_CAP);
  });

  it('repeated dispatch of the same equip is safe', () => {
    const state = makeState();
    state.inventory.bags.push({ ...lifeItem(7), uid: 'x' });
    expect(equipItem(state, 'x').ok).toBe(true);
    expect(equipItem(state, 'x')).toEqual({ ok: false, reason: 'not-in-bag' });
    expect(state.inventory.equipment.chest?.uid).toBe('x');
  });
});

describe('derived stats', () => {
  it('equipment affixes change vitals and combat numbers', () => {
    const state = makeState();
    const base = getPlayerStats(state);

    state.inventory.bags.push({ ...lifeItem(40), uid: 'hp' });
    equipItem(state, 'hp');
    syncPlayerStats(state);

    expect(getPlayerStats(state).maxHp).toBeGreaterThan(base.maxHp);
    expect(state.player.maxHp).toBe(Math.round(getPlayerStats(state).maxHp));
    expect(scalePlayerDamage(state, 100, 'attack')).toBeCloseTo(100 * (1 + getPlayerStats(state).attackDamagePct / 100), 5);
    expect(scalePlayerDamage(state, 100, 'spell')).toBeCloseTo(100 * (1 + getPlayerStats(state).spellDamagePct / 100), 5);
    expect(state.player.armour).toBeCloseTo(getPlayerStats(state).armour, 5);
    expect(state.player.evasion).toBeCloseTo(getPlayerStats(state).evasion, 5);
  });

  it('level growth feeds maxHp and armour mitigation is capped with diminishing returns', () => {
    const state = makeState();
    const level1 = getPlayerStats(state).maxHp;
    state.level = 5;
    syncPlayerStats(state);
    expect(getPlayerStats(state).maxHp).toBeGreaterThan(level1);

    const classDef = getClass('marauder');
    const armored = computeStats(classDef, 1, {
      weapon: null,
      helm: null,
      chest: { ...lifeItem(1), uid: 'c', affixes: [{ id: 'armour-greater', value: 500 }] },
      gloves: null,
      boots: null,
      amulet: null,
    });
    expect(armouredMitigationCapped(armored.armour)).toBeLessThanOrEqual(0.9);
    // Diminishing returns: big hits are mitigated less than small ones.
    expect(armourMitigation(armored.armour, 5)).toBeGreaterThan(armourMitigation(armored.armour, 50));
    expect(evadeChance(0)).toBe(0);
    expect(evadeChance(1e6)).toBeLessThanOrEqual(0.75);
    expect(evadeChance(400)).toBeGreaterThan(evadeChance(100));
  });

  it('class identity: warrior stacks armour, ranger evasion, witch energy shield', () => {
    const gear = { weapon: null, helm: null, chest: null, gloves: null, boots: null, amulet: null };
    const warrior = computeStats(getClass('marauder'), 1, gear);
    const archer = computeStats(getClass('ranger'), 1, gear);
    const witch = computeStats(getClass('witch'), 1, gear);

    expect(warrior.armour).toBeGreaterThan(archer.armour);
    expect(warrior.armour).toBeGreaterThan(witch.armour);
    expect(archer.evasion).toBeGreaterThan(warrior.evasion);
    expect(archer.evasion).toBeGreaterThan(witch.evasion);
    expect(witch.energyShield).toBeGreaterThan(warrior.energyShield);
    expect(witch.energyShield).toBeGreaterThan(archer.energyShield);

    // Offence split: attack builds out-scale spells and vice versa.
    expect(warrior.attackDamagePct).toBeGreaterThan(warrior.spellDamagePct);
    expect(archer.attackDamagePct).toBeGreaterThan(archer.spellDamagePct);
    expect(witch.spellDamagePct).toBeGreaterThan(witch.attackDamagePct);
  });
});

/** Helper: what a huge hit still gets reduced to, for cap assertions. */
function armouredMitigationCapped(armour: number): number {
  return armourMitigation(armour, 0.001);
}

describe('progression', () => {
  it('accumulates XP and levels up with events', () => {
    const state = makeState();
    const events: SimEvent[] = [];
    grantXp(state, xpToNext(1) - 1, events);
    expect(state.level).toBe(1);
    grantXp(state, 1, events);
    expect(state.level).toBe(2);
    expect(events.some((e) => e.kind === 'levelup' && e.level === 2)).toBe(true);
  });

  it('one large grant applies every level-up', () => {
    const state = makeState();
    const events: SimEvent[] = [];
    const total = xpToNext(1) + xpToNext(2) + xpToNext(3) + 5;
    grantXp(state, total, events);
    expect(state.level).toBe(4);
    expect(state.xp).toBe(5);
    expect(events.filter((e) => e.kind === 'levelup')).toHaveLength(3);
  });

  it('never grants negative xp', () => {
    const state = makeState();
    grantXp(state, -100, []);
    expect(state.xp).toBe(0);
    expect(state.level).toBe(1);
  });
});
