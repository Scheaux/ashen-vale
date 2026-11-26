import { describe, expect, it } from 'vitest';
import { AFFIXES, formatStatBonus, getAffix } from '../content/affixes';
import { ITEM_BASES, UNIQUES } from '../content/items';
import { affixLine, type ItemAffix } from './items';

describe('affix stat lines (plain-language rework)', () => {
  it('reads flat bonuses as "+X to Stat"', () => {
    expect(affixLine({ id: 'armour', value: 45 })).toBe('+45 to Armour');
    expect(affixLine({ id: 'attack-damage', value: 3 })).toBe('+3 to Attack Damage');
    expect(affixLine({ id: 'spell-damage', value: 4 })).toBe('+4 to Spell Damage');
    expect(affixLine({ id: 'life', value: 28 })).toBe('+28 to Life');
    expect(affixLine({ id: 'mana', value: 12 })).toBe('+12 to Mana');
    expect(affixLine({ id: 'energy-shield', value: 14 })).toBe('+14 to Energy Shield');
    expect(affixLine({ id: 'strength', value: 5 })).toBe('+5 to Strength');
    expect(affixLine({ id: 'dexterity', value: 3 })).toBe('+3 to Dexterity');
    expect(affixLine({ id: 'intelligence', value: 6 })).toBe('+6 to Intelligence');
  });

  it('reads percentage bonuses as "X% increased Stat"', () => {
    expect(affixLine({ id: 'increased-armour', value: 50 })).toBe('50% increased Armour');
    expect(affixLine({ id: 'increased-evasion', value: 15 })).toBe('15% increased Evasion');
    expect(affixLine({ id: 'increased-energy-shield', value: 10 })).toBe('10% increased Energy Shield');
    expect(affixLine({ id: 'increased-attack-damage', value: 20 })).toBe('20% increased Attack Damage');
    expect(affixLine({ id: 'increased-spell-damage', value: 12 })).toBe('12% increased Spell Damage');
    expect(affixLine({ id: 'increased-movement-speed', value: 4 })).toBe('4% increased Movement Speed');
  });

  it('never emits flavour names — every line is a stat modifier', () => {
    for (const def of AFFIXES) {
      const line = affixLine({ id: def.id, value: def.min });
      expect(line).toMatch(/^(\+\d+ to [A-Za-z ]+|\d+% increased [A-Za-z ]+)$/);
    }
    expect(formatStatBonus('maxHp', 18)).toBe('+18 to Life');
  });

  it('references only known affixes from bases and uniques', () => {
    for (const base of ITEM_BASES) {
      const implicit = base.implicit;
      if (implicit) expect(() => getAffix(implicit.id)).not.toThrow();
    }
    for (const unique of UNIQUES) {
      for (const affix of unique.affixes) expect(() => getAffix(affix.id)).not.toThrow();
    }
  });

  it('rolls items whose lines all read as stat modifiers', () => {
    const affixes: ItemAffix[] = [
      { id: 'life-greater', value: 22 },
      { id: 'increased-attack-damage-greater', value: 11 },
      { id: 'armour', value: 25 },
    ];
    expect(affixes.map(affixLine)).toEqual([
      '+22 to Life',
      '11% increased Attack Damage',
      '+25 to Armour',
    ]);
  });
});
