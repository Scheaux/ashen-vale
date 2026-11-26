import type { Rarity } from '../content/items';
import type { ItemInstance } from '../sim/items';
import type { GameState } from '../sim/state';

export type SalvageResult = { ok: true; value: number } | { ok: false; reason: string };

export const SALVAGE_RARITY_VALUE: Record<Rarity, number> = {
  normal: 1,
  magic: 2,
  rare: 4,
  unique: 10,
};

export function salvageValue(item: ItemInstance): number {
  const levelBonus = Math.floor(item.itemLevel / 5);
  const qualityBonus = Math.floor(item.quality / 10);
  return Math.max(1, (1 + levelBonus) * SALVAGE_RARITY_VALUE[item.rarity] + qualityBonus);
}

/** Bag-only salvage: removes one bag item and credits Ember Dust. */
export function salvageItem(state: GameState, uid: string): SalvageResult {
  const equipped = Object.values(state.inventory.equipment)
    .some((item) => item?.uid === uid);
  if (equipped) {
    return { ok: false, reason: 'Unequip the item before salvaging' };
  }

  const index = state.inventory.bags.findIndex((item) => item.uid === uid);
  if (index < 0) {
    return { ok: false, reason: 'Item is no longer owned' };
  }

  const value = salvageValue(state.inventory.bags[index]);
  state.inventory.bags = state.inventory.bags.filter((_, i) => i !== index);
  state.currency.dust += value;
  return { ok: true, value };
}
