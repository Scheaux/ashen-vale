import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import type { ItemInstance } from '../sim/items';
import { createGameState } from '../sim/state';
import type { GameState } from '../sim/state';
import { equipItem } from './inventory';
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

function cachedPlayerStats(state: GameState) {
  const p = state.player;
  return {
    hp: p.hp,
    maxHp: p.maxHp,
    mana: p.mana,
    maxMana: p.maxMana,
    manaRegen: p.manaRegen,
    energyShield: p.energyShield,
    maxEnergyShield: p.maxEnergyShield,
    armour: p.armour,
    evasion: p.evasion,
    attackDamagePct: p.attackDamagePct,
    spellDamagePct: p.spellDamagePct,
    addedAttackDamage: p.addedAttackDamage,
    addedSpellDamage: p.addedSpellDamage,
    speed: p.speed,
  };
}

describe('salvage transactions', () => {
  it('values rarity, item level and quality exactly', () => {
    expect(salvageValue(item({ rarity: 'normal', itemLevel: 1, quality: 0 }))).toBe(1);
    expect(salvageValue(item({ rarity: 'magic', itemLevel: 5, quality: 0 }))).toBe(4);
    expect(salvageValue(item({ rarity: 'rare', itemLevel: 10, quality: 10 }))).toBe(13);
    expect(salvageValue(item({ rarity: 'unique', itemLevel: 20, quality: 20 }))).toBe(52);
    // Boundary bonuses floor: quality 9 and level 4/19 must not round up.
    expect(salvageValue(item({ rarity: 'rare', itemLevel: 4, quality: 9 }))).toBe(4);
    expect(salvageValue(item({ rarity: 'unique', itemLevel: 19, quality: 19 }))).toBe(41);
  });

  it('removes exactly one bag item and credits Ember Dust', () => {
    const state = createGameState(getClass('marauder'), layout());
    const decoy = item({ uid: 'salvage-decoy', rarity: 'normal', itemLevel: 1, quality: 0 });
    const target = item({ uid: 'salvage-target', rarity: 'rare', itemLevel: 10, quality: 10 });
    const survivor = item({ uid: 'salvage-survivor', rarity: 'magic', itemLevel: 5, quality: 0 });
    state.inventory.bags.push(decoy, target, survivor);
    state.currency.dust = 3;

    const result = salvageItem(state, target.uid);

    expect(result).toEqual({ ok: true, value: 13 });
    expect(state.currency.dust).toBe(16);
    expect(state.inventory.bags.map((bag) => bag.uid)).toEqual([
      'salvage-decoy',
      'salvage-survivor',
    ]);

    const repeated = salvageItem(state, target.uid);
    expect(repeated).toEqual({ ok: false, reason: 'Item is no longer owned' });
    expect(state.currency.dust).toBe(16);
  });

  it('refuses equipped items without changing bags, dust or stats', () => {
    const state = createGameState(getClass('marauder'), layout());
    const gear = item({ uid: 'salvage-equipped', rarity: 'magic', itemLevel: 5, quality: 0 });
    state.inventory.bags.push(gear);
    state.currency.dust = 5;
    expect(equipItem(state, gear.uid).ok).toBe(true);
    const bagsBefore = [...state.inventory.bags];
    const currencyBefore = { ...state.currency };
    const statsBefore = cachedPlayerStats(state);

    const result = salvageItem(state, gear.uid);

    expect(result).toEqual({ ok: false, reason: 'Unequip the item before salvaging' });
    expect(state.inventory.bags).toEqual(bagsBefore);
    expect(state.currency).toEqual(currencyBefore);
    expect(state.inventory.equipment.chest).toBe(gear);
    expect(cachedPlayerStats(state)).toEqual(statsBefore);
  });

  it('refuses unknown uids without changing inventory, currency or stats', () => {
    const state = createGameState(getClass('ranger'), layout());
    const bagged = item({ uid: 'salvage-bagged', rarity: 'rare', itemLevel: 10, quality: 10 });
    const gear = item({ uid: 'salvage-unknown-equipped', rarity: 'magic', itemLevel: 5, quality: 0 });
    state.inventory.bags.push(bagged, gear);
    state.currency = { dust: 7, rune: 2, quality: 3 };
    expect(equipItem(state, gear.uid).ok).toBe(true);
    const bagsBefore = [...state.inventory.bags];
    const equipmentBefore = { ...state.inventory.equipment };
    const currencyBefore = { ...state.currency };
    const statsBefore = cachedPlayerStats(state);

    const result = salvageItem(state, 'missing');

    expect(result).toEqual({ ok: false, reason: 'Item is no longer owned' });
    expect(state.inventory.bags).toEqual(bagsBefore);
    expect(state.inventory.equipment).toEqual(equipmentBefore);
    expect(state.inventory.equipment.chest).toBe(gear);
    expect(state.currency).toEqual(currencyBefore);
    expect(cachedPlayerStats(state)).toEqual(statsBefore);
  });
});
