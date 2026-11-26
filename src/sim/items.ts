import type { Rng } from '../core/rng';
import { AFFIXES, formatStatBonus, getAffix, type AffixDef } from '../content/affixes';
import {
  getItemBase,
  getUnique,
  ITEM_BASES,
  UNIQUES,
  type ItemSlot,
  type Rarity,
} from '../content/items';

/**
 * Runtime item instances. Identity lives in `uid` and must be conserved
 * across every transfer (see systems/inventory.ts); stats are rolled from the
 * content pools and never hardcoded here.
 */
export interface ItemAffix {
  id: string;
  value: number;
}

export interface ItemInstance {
  uid: string;
  baseId: string;
  slot: ItemSlot;
  rarity: Rarity;
  name: string;
  itemLevel: number;
  /** Crafting quality 0–20%; scales the base implicit and affix values. */
  quality: number;
  /** Innate base stat (weapons, armour, boots or amulet). */
  implicit: ItemAffix | null;
  affixes: ItemAffix[];
}

export const RARITY_WEIGHTS: Array<{ rarity: Rarity; weight: number }> = [
  { rarity: 'normal', weight: 42 },
  { rarity: 'magic', weight: 34 },
  { rarity: 'rare', weight: 19 },
  { rarity: 'unique', weight: 5 },
];

export const AFFIX_COUNTS: Record<Rarity, [number, number]> = {
  normal: [0, 0],
  magic: [1, 2],
  rare: [3, 4],
  unique: [0, 0],
};

export function rollRarity(rng: Rng): Rarity {
  let roll = rng() * RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  for (const entry of RARITY_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.rarity;
  }
  return 'normal';
}

export function rollAffixValue(rng: Rng, def: AffixDef, itemLevel: number): number {
  return Math.round(def.min + rng() * (def.max - def.min) + def.perLevel * itemLevel);
}

/** Roll one weighted legal affix for a slot; used by drops and crafting. */
export function rollAffixForSlot(
  rng: Rng,
  slot: ItemSlot,
  itemLevel: number,
  exclude: ReadonlySet<string> = new Set(),
): ItemAffix | null {
  const pool = AFFIXES.filter((affix) => affix.slots.includes(slot) && !exclude.has(affix.id));
  if (pool.length === 0) return null;
  let roll = rng() * pool.reduce((sum, affix) => sum + affix.weight, 0);
  for (const def of pool) {
    roll -= def.weight;
    if (roll <= 0) return { id: def.id, value: rollAffixValue(rng, def, itemLevel) };
  }
  return { id: pool[pool.length - 1].id, value: rollAffixValue(rng, pool[pool.length - 1], itemLevel) };
}

function pickAffixes(
  rng: Rng,
  slot: ItemSlot,
  count: number,
  itemLevel: number,
  exclude: ReadonlySet<string>,
): ItemAffix[] {
  const affixes: ItemAffix[] = [];
  const used = new Set(exclude);
  while (affixes.length < count) {
    const affix = rollAffixForSlot(rng, slot, itemLevel, used);
    if (!affix) break;
    used.add(affix.id);
    affixes.push(affix);
  }
  return affixes;
}

/** Maximum affixes for a rarity; crafting cannot exceed this. */
export function maxAffixesFor(rarity: Rarity): number {
  return AFFIX_COUNTS[rarity][1];
}

/** Quality scales both the base implicit and every affix value. */
export function effectiveItemValue(item: Pick<ItemInstance, 'quality'>, value: number): number {
  return value * (1 + item.quality / 100);
}

function nameFor(rarity: Rarity, baseName: string, uniqueName?: string): string {
  switch (rarity) {
    case 'unique':
      return uniqueName ?? baseName;
    case 'rare':
      return `Grim ${baseName}`;
    case 'magic':
      return baseName;
    default:
      return baseName;
  }
}

/** Roll a complete item instance. Rng-driven: deterministic per sim seed. */
export function rollItem(rng: Rng, itemLevel: number, forcedRarity?: Rarity): ItemInstance {
  const rarity = forcedRarity ?? rollRarity(rng);
  const uid = `item-${Math.floor(rng() * 1e9).toString(36)}-${itemLevel}`;

  if (rarity === 'unique') {
    const unique = UNIQUES[Math.floor(rng() * UNIQUES.length)];
    return {
      uid,
      baseId: unique.id,
      slot: unique.slot,
      rarity,
      name: unique.name,
      itemLevel,
      quality: 0,
      implicit: null,
      affixes: unique.affixes.map((a) => ({ ...a })),
    };
  }

  const base = ITEM_BASES[Math.floor(rng() * ITEM_BASES.length)];
  const [min, max] = AFFIX_COUNTS[rarity];
  const count = min + Math.floor(rng() * (max - min + 1));
  const implicit = base.implicit
    ? {
      id: base.implicit.id,
      value: Math.round(base.implicit.min + rng() * (base.implicit.max - base.implicit.min) +
        base.implicit.perLevel * itemLevel),
    }
    : null;
  return {
    uid,
    baseId: base.id,
    slot: base.slot,
    rarity,
    name: nameFor(rarity, base.name),
    itemLevel,
    quality: 0,
    implicit,
    affixes: pickAffixes(rng, base.slot, count, itemLevel, new Set(implicit ? [implicit.id] : [])),
  };
}

/** Plain stat line for tooltips, e.g. "+45 to Armour" or "50% increased Armour". */
export function affixLine(affix: ItemAffix): string {
  return formatStatBonus(getAffix(affix.id).stat, affix.value);
}

/** Display name for an equipped/base reference. */
export function baseDisplayName(baseId: string): string {
  try {
    return getUnique(baseId).name;
  } catch {
    return getItemBase(baseId).name;
  }
}
