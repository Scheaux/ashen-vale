import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createRng } from '../core/rng';
import { rollItem } from '../sim/items';
import { createGameState } from '../sim/state';
import type { ItemInstance } from '../sim/items';
import { equipItem, ownedItemCount } from './inventory';
import { getPlayerStats } from './stats';
import {
  addAffix,
  canCraft,
  findOwnedItem,
  improveQuality,
  ownedItems,
  reforgeAffix,
} from './crafting';

function layout(): ZoneLayout {
  return {
    seed: 5,
    name: 'craft-test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

describe('crafting transactions', () => {
  it('reforges one affix value and spends Ember Dust', () => {
    const state = createGameState(getClass('marauder'), layout());
    const item: ItemInstance = {
      uid: 'reforge-test',
      baseId: 'bone-cuirass',
      slot: 'chest',
      rarity: 'rare',
      name: 'Test Cuirass',
      itemLevel: 5,
      quality: 0,
      implicit: { id: 'armour', value: 20 },
      affixes: [{ id: 'life', value: 0 }],
    };
    state.inventory.bags.push(item);
    state.currency.dust = 2;
    const result = reforgeAffix(state, item.uid);
    expect(result.ok).toBe(true);
    expect(state.currency.dust).toBe(1);
    expect(item.affixes[0].value).toBeGreaterThan(0);
  });

  it('adds an affix to a normal item and upgrades it to magic', () => {
    const state = createGameState(getClass('ranger'), layout());
    const item = rollItem(createRng(21), 4, 'normal');
    state.inventory.bags.push(item);
    state.currency.rune = 5;
    expect(item.affixes).toHaveLength(0);
    expect(addAffix(state, item.uid).ok).toBe(true);
    expect(item.rarity).toBe('magic');
    expect(item.affixes).toHaveLength(1);
    expect(state.currency.rune).toBe(4);
    expect(addAffix(state, item.uid).ok).toBe(true);
    expect(item.affixes).toHaveLength(2);
    expect(canCraft(state, item.uid, 'add')).toMatchObject({ ok: false, reason: 'Affix slots are full' });
  });

  it('quality raises equipped stats and caps at 20%', () => {
    const state = createGameState(getClass('witch'), layout());
    const item: ItemInstance = {
      uid: 'quality-test',
      baseId: 'bone-cuirass',
      slot: 'chest',
      rarity: 'rare',
      name: 'Quality Cuirass',
      itemLevel: 6,
      quality: 0,
      implicit: { id: 'armour', value: 20 },
      affixes: [{ id: 'armour', value: 30 }],
    };
    state.inventory.bags.push(item);
    state.currency.quality = 5;
    expect(equipItem(state, item.uid).ok).toBe(true);
    const before = getPlayerStats(state).armour;
    expect(improveQuality(state, item.uid).ok).toBe(true);
    expect(item.quality).toBe(5);
    const after = getPlayerStats(state).armour;
    expect(after).toBeGreaterThan(before);
    for (let i = 0; i < 3; i++) expect(improveQuality(state, item.uid).ok).toBe(true);
    expect(item.quality).toBe(20);
    expect(canCraft(state, item.uid, 'quality')).toMatchObject({ ok: false, reason: 'Quality is already 20%' });
  });

  it('refuses uniques, missing items, and insufficient currency without changing anything', () => {
    const state = createGameState(getClass('marauder'), layout());
    const unique = rollItem(createRng(41), 9, 'unique');
    state.inventory.bags.push(unique);
    state.currency = { dust: 0, rune: 0, quality: 0 };
    expect(reforgeAffix(state, unique.uid)).toMatchObject({ ok: false });
    expect(addAffix(state, unique.uid)).toMatchObject({ ok: false });
    expect(reforgeAffix(state, 'missing')).toMatchObject({ ok: false });
    expect(canCraft(state, unique.uid, 'quality')).toMatchObject({ ok: false, reason: 'Not enough quality' });
    expect(ownedItemCount(state)).toBe(1);
    expect(findOwnedItem(state, unique.uid)?.equipped).toBe(false);
  });

  it('lists bag and equipped items without duplicating identities', () => {
    const state = createGameState(getClass('ranger'), layout());
    const a = rollItem(createRng(51), 3, 'magic');
    const b = rollItem(createRng(52), 3, 'magic');
    state.inventory.bags.push(a, b);
    expect(equipItem(state, b.uid).ok).toBe(true);
    const owned = ownedItems(state);
    expect(owned).toHaveLength(2);
    expect(new Set(owned.map((entry) => entry.item.uid)).size).toBe(2);
    expect(owned.find((entry) => entry.item.uid === b.uid)?.equipped).toBe(true);
    expect(ownedItemCount(state)).toBe(2);
  });
});
