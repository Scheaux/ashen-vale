import type { ItemSlot } from './items';

export type AffixStat =
  | 'maxHp'
  | 'maxMana'
  | 'attackDamagePct'
  | 'spellDamagePct'
  | 'armour'
  | 'evasion'
  | 'energyShield'
  | 'moveSpeedPct'
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
  // Vitals
  { id: 'life', label: 'of the Ox', stat: 'maxHp', min: 8, max: 14, perLevel: 2, slots: ['helm', 'chest', 'gloves', 'boots', 'amulet'], weight: 100 },
  { id: 'bulwark', label: 'of the Bulwark', stat: 'maxHp', min: 16, max: 26, perLevel: 3, slots: ['chest', 'helm'], weight: 60 },
  { id: 'mind', label: 'of the Mind', stat: 'maxMana', min: 8, max: 14, perLevel: 2, slots: ['helm', 'amulet'], weight: 70 },
  // Offence: attack damage
  { id: 'brutality', label: 'Brutal', stat: 'attackDamagePct', min: 4, max: 8, perLevel: 1, slots: ['weapon', 'gloves', 'amulet'], weight: 90 },
  { id: 'warlord', label: 'Warlord\'s', stat: 'attackDamagePct', min: 9, max: 15, perLevel: 1.5, slots: ['weapon'], weight: 45 },
  // Offence: spell damage
  { id: 'sorcery', label: 'Sorcerer\'s', stat: 'spellDamagePct', min: 4, max: 8, perLevel: 1, slots: ['weapon', 'helm', 'amulet'], weight: 90 },
  { id: 'arcane', label: 'Arcane', stat: 'spellDamagePct', min: 9, max: 15, perLevel: 1.5, slots: ['weapon'], weight: 45 },
  // Defence: armour
  { id: 'fortress', label: 'Fortified', stat: 'armour', min: 15, max: 30, perLevel: 4, slots: ['chest', 'helm', 'gloves'], weight: 70 },
  { id: 'ironhide', label: 'Ironhide', stat: 'armour', min: 40, max: 70, perLevel: 8, slots: ['chest'], weight: 40 },
  // Defence: evasion
  { id: 'phantasm', label: 'Phantom\'s', stat: 'evasion', min: 15, max: 30, perLevel: 4, slots: ['gloves', 'boots', 'helm'], weight: 70 },
  { id: 'shadowstep', label: 'of Shadows', stat: 'evasion', min: 40, max: 70, perLevel: 8, slots: ['boots'], weight: 40 },
  // Defence: energy shield
  { id: 'warding', label: 'Warding', stat: 'energyShield', min: 10, max: 20, perLevel: 3, slots: ['helm', 'chest', 'amulet'], weight: 70 },
  { id: 'aegis', label: 'Aegis', stat: 'energyShield', min: 25, max: 45, perLevel: 5, slots: ['chest'], weight: 40 },
  // Utility
  { id: 'haste', label: 'of Haste', stat: 'moveSpeedPct', min: 2, max: 4, perLevel: 0.4, slots: ['boots', 'amulet'], weight: 70 },
  // Attributes
  { id: 'might', label: 'of Might', stat: 'strength', min: 2, max: 5, perLevel: 0.6, slots: ['weapon', 'chest', 'helm'], weight: 80 },
  { id: 'grace', label: 'of Grace', stat: 'dexterity', min: 2, max: 5, perLevel: 0.6, slots: ['gloves', 'boots', 'amulet'], weight: 80 },
  { id: 'insight', label: 'of Insight', stat: 'intelligence', min: 2, max: 5, perLevel: 0.6, slots: ['helm', 'amulet', 'weapon'], weight: 80 },
] as const;

export function getAffix(id: string): AffixDef {
  const def = AFFIXES.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown affix: ${id}`);
  return def;
}

/** Whether an affix value reads as a percentage on tooltips. */
export function isPercentStat(stat: AffixStat): boolean {
  return stat === 'attackDamagePct' || stat === 'spellDamagePct' || stat === 'moveSpeedPct';
}
