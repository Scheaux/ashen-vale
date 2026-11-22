import type { ClassDef, ClassId } from './types';

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'marauder',
    name: 'The Marauder',
    epithet: 'Breaker of Lines',
    description:
      'A warrior of the frozen north. Charges headlong into the dark and leaves only rubble behind.',
    color: 0xc0392b,
    cssColor: '#c0392b',
    speed: 5.4,
    stats: { strength: 24, dexterity: 10, intelligence: 6 },
  },
  {
    id: 'ranger',
    name: 'The Ranger',
    epithet: 'Thorn of the Waste',
    description:
      'A hunter forged in the Ashen Moor. Strikes from the distance where the dead cannot reach.',
    color: 0x6fae4f,
    cssColor: '#6fae4f',
    speed: 6.0,
    stats: { strength: 10, dexterity: 24, intelligence: 8 },
  },
  {
    id: 'witch',
    name: 'The Witch',
    epithet: 'Bearer of the Ember-Curse',
    description:
      'Cast out for her gifts. The night answers when she calls, and it burns.',
    color: 0x8e6fc4,
    cssColor: '#8e6fc4',
    speed: 5.2,
    stats: { strength: 8, dexterity: 10, intelligence: 24 },
  },
] as const;

export function getClass(id: ClassId): ClassDef {
  const def = CLASSES.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown class: ${id}`);
  return def;
}
