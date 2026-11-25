export type RuneId = 'cruel' | 'wide' | 'swift';

export interface RuneDef {
  id: RuneId;
  name: string;
  description: string;
  unlockLevel: number;
  damageMult: number;
  manaMult: number;
  cooldownMult: number;
  areaMult: number;
  color: number;
  cssColor: string;
  glyph: string;
}

/**
 * One rune per active skill. Runes are level-gated build choices, not point
 * purchases: each has a clear trade-off and changes the skill's numbers only.
 */
export const RUNES: readonly RuneDef[] = [
  {
    id: 'cruel',
    name: 'Cruel Rune',
    description: '+25% damage, +15% mana cost.',
    unlockLevel: 3,
    damageMult: 1.25,
    manaMult: 1.15,
    cooldownMult: 1,
    areaMult: 1,
    color: 0xff7a4d,
    cssColor: '#ff7a4d',
    glyph: '◆',
  },
  {
    id: 'wide',
    name: 'Wide Rune',
    description: '+30% area or arc, -10% damage.',
    unlockLevel: 5,
    damageMult: 0.9,
    manaMult: 1,
    cooldownMult: 1,
    areaMult: 1.3,
    color: 0xe8c877,
    cssColor: '#e8c877',
    glyph: '◇',
  },
  {
    id: 'swift',
    name: 'Swift Rune',
    description: '-20% cooldown, -10% damage.',
    unlockLevel: 7,
    damageMult: 0.9,
    manaMult: 1,
    cooldownMult: 0.8,
    areaMult: 1,
    color: 0x8fdcff,
    cssColor: '#8fdcff',
    glyph: '↯',
  },
] as const;

export function getRune(id: string): RuneDef | null {
  return RUNES.find((rune) => rune.id === id) ?? null;
}
