import type { ItemSlot } from '../content/items';
import type { GameState, SimEvent } from '../sim/state';
import { syncPlayerStats } from './stats';

/**
 * Inventory transfers as transactions (per the inventory contract):
 *   1. validate source ownership and destination legality,
 *   2. compute the entire next state,
 *   3. commit once or reject without changing either side.
 * Item identity (uid) is conserved across every transfer.
 */
export const BAG_CAP = 40;

export type InvResult = { ok: true } | { ok: false; reason: string };

export function pickupDrop(state: GameState, dropId: string, events: SimEvent[]): InvResult {
  const idx = state.loot.findIndex((d) => d.id === dropId);
  if (idx < 0) return { ok: false, reason: 'unknown-drop' };
  if (state.inventory.bags.length >= BAG_CAP) return { ok: false, reason: 'bag-full' };

  const drop = state.loot[idx];
  // Commit: item moves from world to bag as one identity-preserving step.
  state.inventory.bags.push(drop.item);
  state.loot.splice(idx, 1);
  events.push({ kind: 'pickup', name: drop.item.name, rarity: drop.item.rarity });
  return { ok: true };
}

export function equipItem(state: GameState, uid: string): InvResult {
  const idx = state.inventory.bags.findIndex((i) => i.uid === uid);
  if (idx < 0) return { ok: false, reason: 'not-in-bag' };

  const item = state.inventory.bags[idx];
  const previous = state.inventory.equipment[item.slot];

  // Compute the whole next bag first (swap: the old item returns to the bag).
  const nextBags = state.inventory.bags.filter((_, i) => i !== idx);
  if (previous) nextBags.push(previous);

  // Commit once.
  state.inventory.bags = nextBags;
  state.inventory.equipment[item.slot] = item;
  syncPlayerStats(state);
  return { ok: true };
}

export function unequipItem(state: GameState, slot: ItemSlot): InvResult {
  const item = state.inventory.equipment[slot];
  if (!item) return { ok: false, reason: 'empty-slot' };
  if (state.inventory.bags.length >= BAG_CAP) return { ok: false, reason: 'bag-full' };

  state.inventory.equipment[slot] = null;
  state.inventory.bags.push(item);
  syncPlayerStats(state);
  return { ok: true };
}

/** Total owned items (bags + equipped) — used by conservation tests. */
export function ownedItemCount(state: GameState): number {
  const equipped = Object.values(state.inventory.equipment).filter(Boolean).length;
  return state.inventory.bags.length + equipped;
}
