import { getAffix } from '../content/affixes';
import type { Rarity } from '../content/items';
import type { ItemInstance } from '../sim/items';
import type { GameState } from '../sim/state';
import {
  maxAffixesFor,
  rollAffixForSlot,
  rollAffixValue,
} from '../sim/items';
import { syncPlayerStats } from './stats';

export type CraftAction = 'reforge' | 'add' | 'quality';

export interface CraftResult {
  ok: boolean;
  reason?: string;
  detail?: string;
}

export const CRAFT_COSTS: Record<CraftAction, { currency: 'dust' | 'rune' | 'quality'; amount: number; label: string }> = {
  reforge: { currency: 'dust', amount: 1, label: 'Reforge affix' },
  add: { currency: 'rune', amount: 1, label: 'Add affix' },
  quality: { currency: 'quality', amount: 1, label: 'Quality +5%' },
};

export interface OwnedItem {
  item: ItemInstance;
  equipped: boolean;
}

export function ownedItems(state: GameState): OwnedItem[] {
  return [
    ...state.inventory.bags.map((item) => ({ item, equipped: false })),
    ...Object.values(state.inventory.equipment)
      .filter((item): item is ItemInstance => item !== null)
      .map((item) => ({ item, equipped: true })),
  ];
}

export function findOwnedItem(state: GameState, uid: string): OwnedItem | null {
  const bag = state.inventory.bags.find((item) => item.uid === uid);
  if (bag) return { item: bag, equipped: false };
  const equipped = (Object.values(state.inventory.equipment) as Array<ItemInstance | null>)
    .find((item) => item?.uid === uid);
  return equipped ? { item: equipped, equipped: true } : null;
}

function canSpend(state: GameState, action: CraftAction): CraftResult {
  const cost = CRAFT_COSTS[action];
  if (state.currency[cost.currency] < cost.amount) {
    return { ok: false, reason: `Not enough ${cost.currency}` };
  }
  return { ok: true };
}

export function canCraft(state: GameState, uid: string, action: CraftAction): CraftResult {
  const owned = findOwnedItem(state, uid);
  if (!owned) return { ok: false, reason: 'Item is no longer owned' };
  const { item } = owned;
  const spend = canSpend(state, action);
  if (!spend.ok) return spend;

  if (action === 'reforge') {
    if (item.rarity === 'unique') return { ok: false, reason: 'Unique affixes are fixed' };
    if (item.affixes.length === 0) return { ok: false, reason: 'No affix to reforge' };
    return { ok: true };
  }
  if (action === 'add') {
    if (item.rarity === 'unique') return { ok: false, reason: 'Unique affixes are fixed' };
    const cap = maxAffixesFor(item.rarity === 'normal' ? 'magic' : item.rarity);
    if (item.affixes.length >= cap) return { ok: false, reason: 'Affix slots are full' };
    return { ok: true };
  }
  if (item.quality >= 20) return { ok: false, reason: 'Quality is already 20%' };
  return { ok: true };
}

function spend(state: GameState, action: CraftAction): void {
  const cost = CRAFT_COSTS[action];
  state.currency[cost.currency] -= cost.amount;
}

function commit(state: GameState, equipped: boolean): void {
  if (equipped) syncPlayerStats(state);
}

export function reforgeAffix(state: GameState, uid: string): CraftResult {
  const check = canCraft(state, uid, 'reforge');
  if (!check.ok) return check;
  const owned = findOwnedItem(state, uid)!;
  const item = owned.item;
  const index = Math.floor(state.rng() * item.affixes.length);
  const affix = item.affixes[index];
  const def = getAffix(affix.id);
  const value = rollAffixValue(state.rng, def, item.itemLevel);
  item.affixes[index] = { id: affix.id, value };
  spend(state, 'reforge');
  commit(state, owned.equipped);
  return { ok: true, detail: `Reforged ${def.stat} to ${value}` };
}

export function addAffix(state: GameState, uid: string): CraftResult {
  const check = canCraft(state, uid, 'add');
  if (!check.ok) return check;
  const owned = findOwnedItem(state, uid)!;
  const item = owned.item;
  const exclude = new Set(item.affixes.map((affix) => affix.id));
  if (item.implicit) exclude.add(item.implicit.id);
  const affix = rollAffixForSlot(state.rng, item.slot, item.itemLevel, exclude);
  if (!affix) return { ok: false, reason: 'No legal affix remains' };
  item.affixes.push(affix);
  if (item.rarity === 'normal') item.rarity = 'magic';
  spend(state, 'add');
  commit(state, owned.equipped);
  return { ok: true, detail: `Added ${getAffix(affix.id).stat}` };
}

export function improveQuality(state: GameState, uid: string): CraftResult {
  const check = canCraft(state, uid, 'quality');
  if (!check.ok) return check;
  const owned = findOwnedItem(state, uid)!;
  owned.item.quality = Math.min(20, owned.item.quality + 5);
  spend(state, 'quality');
  commit(state, owned.equipped);
  return { ok: true, detail: `Quality is now ${owned.item.quality}%` };
}

/** Rarity after an add-affix craft (normal items become magic). */
export function resultingRarity(item: ItemInstance, action: CraftAction): Rarity {
  if (action === 'add' && item.rarity === 'normal') return 'magic';
  return item.rarity;
}
