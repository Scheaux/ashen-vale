import type { ItemSlot } from './items';

/**
 * Item stat vocabulary (plain-language rework): affix lines read as direct
 * stat modifiers — flat bonuses as `+X to Stat`, percentage ones as
 * `X% increased Stat` — with no flavour naming in between. The same
 * vocabulary drives item tooltips, passive tooltips and the character sheet.
 */
export type AffixStat =
  | 'maxHp'
  | 'maxMana'
  | 'attackDamage'
  | 'spellDamage'
  | 'attackDamagePct'
  | 'spellDamagePct'
  | 'armour'
  | 'evasion'
  | 'energyShield'
  | 'armourIncPct'
  | 'evasionIncPct'
  | 'energyShieldIncPct'
  | 'moveSpeedPct'
  | 'strength'
  | 'dexterity'
  | 'intelligence';

export interface AffixDef {
  id: string;
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
  // Flat additions: "+X to Stat"
  { id: 'life', stat: 'maxHp', min: 8, max: 14, perLevel: 2, slots: ['helm', 'chest', 'gloves', 'boots', 'amulet'], weight: 100 },
  { id: 'life-greater', stat: 'maxHp', min: 16, max: 26, perLevel: 3, slots: ['chest', 'helm'], weight: 60 },
  { id: 'mana', stat: 'maxMana', min: 8, max: 14, perLevel: 2, slots: ['helm', 'amulet'], weight: 70 },
  { id: 'mana-greater', stat: 'maxMana', min: 18, max: 28, perLevel: 3, slots: ['amulet'], weight: 45 },
  { id: 'armour', stat: 'armour', min: 15, max: 30, perLevel: 4, slots: ['chest', 'helm', 'gloves'], weight: 70 },
  { id: 'armour-greater', stat: 'armour', min: 40, max: 70, perLevel: 8, slots: ['chest'], weight: 40 },
  { id: 'evasion', stat: 'evasion', min: 15, max: 30, perLevel: 4, slots: ['gloves', 'boots', 'helm'], weight: 70 },
  { id: 'evasion-greater', stat: 'evasion', min: 40, max: 70, perLevel: 8, slots: ['boots'], weight: 40 },
  { id: 'energy-shield', stat: 'energyShield', min: 10, max: 20, perLevel: 3, slots: ['helm', 'chest', 'amulet'], weight: 70 },
  { id: 'energy-shield-greater', stat: 'energyShield', min: 25, max: 45, perLevel: 5, slots: ['chest'], weight: 40 },
  { id: 'attack-damage', stat: 'attackDamage', min: 2, max: 4, perLevel: 0.4, slots: ['weapon', 'gloves', 'amulet'], weight: 90 },
  { id: 'attack-damage-greater', stat: 'attackDamage', min: 5, max: 8, perLevel: 0.6, slots: ['weapon'], weight: 45 },
  { id: 'spell-damage', stat: 'spellDamage', min: 2, max: 4, perLevel: 0.4, slots: ['weapon', 'helm', 'amulet'], weight: 90 },
  { id: 'spell-damage-greater', stat: 'spellDamage', min: 5, max: 8, perLevel: 0.6, slots: ['weapon'], weight: 45 },
  { id: 'strength', stat: 'strength', min: 2, max: 5, perLevel: 0.6, slots: ['weapon', 'chest', 'helm'], weight: 80 },
  { id: 'strength-greater', stat: 'strength', min: 6, max: 10, perLevel: 0.8, slots: ['chest', 'helm'], weight: 45 },
  { id: 'dexterity', stat: 'dexterity', min: 2, max: 5, perLevel: 0.6, slots: ['gloves', 'boots', 'amulet'], weight: 80 },
  { id: 'dexterity-greater', stat: 'dexterity', min: 6, max: 10, perLevel: 0.8, slots: ['gloves', 'boots'], weight: 45 },
  { id: 'intelligence', stat: 'intelligence', min: 2, max: 5, perLevel: 0.6, slots: ['helm', 'amulet', 'weapon'], weight: 80 },
  { id: 'intelligence-greater', stat: 'intelligence', min: 6, max: 10, perLevel: 0.8, slots: ['helm', 'amulet'], weight: 45 },
  // Percentage increases: "X% increased Stat"
  { id: 'increased-armour', stat: 'armourIncPct', min: 8, max: 15, perLevel: 1, slots: ['chest', 'helm'], weight: 55 },
  { id: 'increased-evasion', stat: 'evasionIncPct', min: 8, max: 15, perLevel: 1, slots: ['boots', 'gloves'], weight: 55 },
  { id: 'increased-energy-shield', stat: 'energyShieldIncPct', min: 8, max: 15, perLevel: 1, slots: ['helm', 'amulet'], weight: 55 },
  { id: 'increased-attack-damage', stat: 'attackDamagePct', min: 4, max: 8, perLevel: 1, slots: ['weapon', 'gloves', 'amulet'], weight: 90 },
  { id: 'increased-attack-damage-greater', stat: 'attackDamagePct', min: 9, max: 15, perLevel: 1.5, slots: ['weapon'], weight: 45 },
  { id: 'increased-spell-damage', stat: 'spellDamagePct', min: 4, max: 8, perLevel: 1, slots: ['weapon', 'helm', 'amulet'], weight: 90 },
  { id: 'increased-spell-damage-greater', stat: 'spellDamagePct', min: 9, max: 15, perLevel: 1.5, slots: ['weapon'], weight: 45 },
  { id: 'increased-movement-speed', stat: 'moveSpeedPct', min: 2, max: 4, perLevel: 0.4, slots: ['boots', 'amulet'], weight: 70 },
  { id: 'increased-movement-speed-greater', stat: 'moveSpeedPct', min: 5, max: 8, perLevel: 0.5, slots: ['boots'], weight: 40 },
] as const;

export function getAffix(id: string): AffixDef {
  const def = AFFIXES.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown affix: ${id}`);
  return def;
}

const STAT_NAMES: Record<AffixStat, string> = {
  maxHp: 'Life',
  maxMana: 'Mana',
  attackDamage: 'Attack Damage',
  spellDamage: 'Spell Damage',
  attackDamagePct: 'Attack Damage',
  spellDamagePct: 'Spell Damage',
  armour: 'Armour',
  evasion: 'Evasion',
  energyShield: 'Energy Shield',
  armourIncPct: 'Armour',
  evasionIncPct: 'Evasion',
  energyShieldIncPct: 'Energy Shield',
  moveSpeedPct: 'Movement Speed',
  strength: 'Strength',
  dexterity: 'Dexterity',
  intelligence: 'Intelligence',
};

const INCREASED_STATS = new Set<AffixStat>([
  'attackDamagePct',
  'spellDamagePct',
  'armourIncPct',
  'evasionIncPct',
  'energyShieldIncPct',
  'moveSpeedPct',
]);

/** Whether a bonus reads as "X% increased Stat" rather than "+X to Stat". */
export function isIncreasedStat(stat: AffixStat): boolean {
  return INCREASED_STATS.has(stat);
}

/** Plain stat line, e.g. "+45 to Armour" or "50% increased Armour". */
export function formatStatBonus(stat: AffixStat, value: number): string {
  const name = STAT_NAMES[stat] ?? stat;
  return INCREASED_STATS.has(stat) ? `${value}% increased ${name}` : `+${value} to ${name}`;
}
