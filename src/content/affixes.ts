import type { ItemSlot } from './items';

export type AffixStat =
  | 'maxHp'
  | 'damagePct'
  | 'moveSpeedPct'
  | 'damageReductionPct'
  | 'strength'
  | 'dexterity'
  | 'intelligence';

export interface AffixDef {
  id: string;
  label: string;
  stat: AffixStat;
  /** Roll range at item level 1. */
  min: number;
  max: number;
  /** Added to the roll per item level. */
  perLevel: number;
  /** Slots this affix can roll on. */
  slots: ItemSlot[];
  /** Selection weight. */
  weight: number;
}

export const AFFIXES: readonly AffixDef[] = [
  { id: 'life', label: 'of the Ox', stat: 'maxHp', min: 8, max: 14, perLevel: 2, slots: ['helm', 'chest', 'gloves', 'boots', 'amulet'], weight: 100 },
  { id: 'bulwark', label: 'of the Bulwark', stat: 'maxHp', min: 16, max: 26, perLevel: 3, slots: ['chest', 'helm'], weight: 60 },
  { id: 'brutality', label: 'Brutal', stat: 'damagePct', min: 4, max: 8, perLevel: 1, slots: ['weapon', 'amulet', 'gloves'], weight: 90 },
  { id: 'warlord', label: 'Warlord\'s', stat: 'damagePct', min: 9, max: 15, perLevel: 1.5, slots: ['weapon'], weight: 45 },
  { id: 'haste', label: 'of Haste', stat: 'moveSpeedPct', min: 2, max: 4, perLevel: 0.4, slots: ['boots', 'amulet'], weight: 70 },
  { id: 'fortress', label: 'Fortified', stat: 'damageReductionPct', min: 2, max: 4, perLevel: 0.5, slots: ['chest', 'helm', 'gloves'], weight: 70 },
  { id: 'might', label: 'of Might', stat: 'strength', min: 2, max: 5, perLevel: 0.6, slots: ['weapon', 'chest', 'helm'], weight: 80 },
  { id: 'grace', label: 'of Grace', stat: 'dexterity', min: 2, max: 5, perLevel: 0.6, slots: ['gloves', 'boots', 'amulet'], weight: 80 },
  { id: 'insight', label: 'of Insight', stat: 'intelligence', min: 2, max: 5, perLevel: 0.6, slots: ['helm', 'amulet', 'weapon'], weight: 80 },
  { id: 'ironhide', label: 'Ironhide', stat: 'damageReductionPct', min: 5, max: 8, perLevel: 0.6, slots: ['chest'], weight: 40 },
] as const;

export function getAffix(id: string): AffixDef {
  const def = AFFIXES.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown affix: ${id}`);
  return def;
}
