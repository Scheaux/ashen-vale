import type { Rng } from '../core/rng';
import { AFFIXES, getAffix, isPercentStat, type AffixDef } from '../content/affixes';
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

function rollAffixValue(rng: Rng, def: AffixDef, itemLevel: number): number {
  return Math.round(def.min + rng() * (def.max - def.min) + def.perLevel * itemLevel);
}

function pickAffixes(rng: Rng, slot: ItemSlot, count: number, itemLevel: number): ItemAffix[] {
  const pool = AFFIXES.filter((a) => a.slots.includes(slot));
  const affixes: ItemAffix[] = [];
  const used = new Set<string>();
  while (affixes.length < count && used.size < pool.length) {
    let roll = rng() * pool.filter((a) => !used.has(a.id)).reduce((s, a) => s + a.weight, 0);
    for (const def of pool) {
      if (used.has(def.id)) continue;
      roll -= def.weight;
      if (roll <= 0) {
        used.add(def.id);
        affixes.push({ id: def.id, value: rollAffixValue(rng, def, itemLevel) });
        break;
      }
    }
  }
  return affixes;
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
      affixes: unique.affixes.map((a) => ({ ...a })),
    };
  }

  const base = ITEM_BASES[Math.floor(rng() * ITEM_BASES.length)];
  const [min, max] = AFFIX_COUNTS[rarity];
  const count = min + Math.floor(rng() * (max - min + 1));
  return {
    uid,
    baseId: base.id,
    slot: base.slot,
    rarity,
    name: nameFor(rarity, base.name),
    itemLevel,
    affixes: pickAffixes(rng, base.slot, count, itemLevel),
  };
}

/** Human-readable affix line for tooltips. */
export function affixLine(affix: ItemAffix): string {
  const def = getAffix(affix.id);
  const sign = isPercentStat(def.stat) ? '%' : '';
  return `+${affix.value}${sign} ${def.label.replace(/^(of |'s )?/, '')}`.trim();
}

/** Display name for an equipped/base reference. */
export function baseDisplayName(baseId: string): string {
  try {
    return getUnique(baseId).name;
  } catch {
    return getItemBase(baseId).name;
  }
}
