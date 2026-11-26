import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import type { ItemInstance } from '../sim/items';
import { createGameState } from '../sim/state';
import { equipItem } from './inventory';
import { getPlayerStats } from './stats';
import { salvageItem, salvageValue } from './salvage';

function layout(): ZoneLayout {
  return {
    seed: 5,
    name: 'salvage-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    uid: 'salvage-test',
    baseId: 'bone-cuirass',
    slot: 'chest',
    rarity: 'normal',
    name: 'Test Cuirass',
    itemLevel: 1,
    quality: 0,
    implicit: { id: 'armour', value: 20 },
    affixes: [],
    ...overrides,
  };
}

describe('salvage transactions', () => {
  it('values rarity, item level and quality exactly', () => {
    expect(salvageValue(item({ rarity: 'normal', itemLevel: 1, quality: 0 }))).toBe(1);
    expect(salvageValue(item({ rarity: 'magic', itemLevel: 5, quality: 0 }))).toBe(4);
    expect(salvageValue(item({ rarity: 'rare', itemLevel: 10, quality: 10 }))).toBe(13);
    expect(salvageValue(item({ rarity: 'unique', itemLevel: 20, quality: 20 }))).toBe(52);
  });

  it('removes exactly one bag item and credits Ember Dust', () => {
    const state = createGameState(getClass('marauder'), layout());
    const target = item({ uid: 'salvage-target', rarity: 'rare', itemLevel: 10, quality: 10 });
    const survivor = item({ uid: 'salvage-survivor', rarity: 'magic', itemLevel: 5, quality: 0 });
    state.inventory.bags.push(target, survivor);
    state.currency.dust = 3;

    const result = salvageItem(state, target.uid);

    expect(result).toEqual({ ok: true, value: 13 });
    expect(state.currency.dust).toBe(16);
    expect(state.inventory.bags).toHaveLength(1);
    expect(state.inventory.bags[0].uid).toBe('salvage-survivor');
  });

  it('refuses equipped items without changing bags, dust or stats', () => {
    const state = createGameState(getClass('marauder'), layout());
    const gear = item({ uid: 'salvage-equipped', rarity: 'magic', itemLevel: 5, quality: 0 });
    state.inventory.bags.push(gear);
    state.currency.dust = 5;
    expect(equipItem(state, gear.uid).ok).toBe(true);
    const statsBefore = getPlayerStats(state);

    const result = salvageItem(state, gear.uid);

    expect(result).toEqual({ ok: false, reason: 'Unequip the item before salvaging' });
    expect(state.inventory.bags).toHaveLength(0);
    expect(state.currency.dust).toBe(5);
    expect(state.inventory.equipment.chest).toBe(gear);
    expect(getPlayerStats(state)).toEqual(statsBefore);
  });

  it('refuses unknown uids without changing dust', () => {
    const state = createGameState(getClass('ranger'), layout());
    state.currency.dust = 2;

    const result = salvageItem(state, 'missing');

    expect(result).toEqual({ ok: false, reason: 'Item is no longer owned' });
    expect(state.currency.dust).toBe(2);
  });
});
