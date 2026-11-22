import type { ClassId, SkillId } from './types';

export interface SkillDef {
  id: SkillId;
  name: string;
  classId: ClassId;
  type: 'melee' | 'projectile';
  damage: { min: number; max: number };
  /** Seconds between uses. */
  cooldown: number;
  /** Maximum strike distance (melee reach, or projectile travel budget). */
  range: number;
  /** Chase stops here; between pursueRange and range the player stands and attacks. */
  pursueRange: number;
  /** Melee sweep half-arc is arcDeg/2 around facing. */
  arcDeg?: number;
  projectile?: {
    speed: number;
    radius: number;
    ttl: number;
  };
  /** Effect color (three.js hex). */
  color: number;
  cssColor: string;
}

export const SKILLS: readonly SkillDef[] = [
  {
    id: 'cleave',
    name: 'Cleave',
    classId: 'marauder',
    type: 'melee',
    damage: { min: 9, max: 14 },
    cooldown: 0.85,
    range: 2.7,
    pursueRange: 2.2,
    arcDeg: 110,
    color: 0xff6a3d,
    cssColor: '#ff6a3d',
  },
  {
    id: 'piercing-shot',
    name: 'Piercing Shot',
    classId: 'ranger',
    type: 'projectile',
    damage: { min: 7, max: 12 },
    cooldown: 0.75,
    range: 30,
    pursueRange: 11,
    projectile: { speed: 26, radius: 0.35, ttl: 1.25 },
    color: 0x9fe870,
    cssColor: '#9fe870',
  },
  {
    id: 'ember-bolt',
    name: 'Ember Bolt',
    classId: 'witch',
    type: 'projectile',
    damage: { min: 8, max: 13 },
    cooldown: 0.9,
    range: 30,
    pursueRange: 11,
    projectile: { speed: 20, radius: 0.4, ttl: 1.6 },
    color: 0xb07cff,
    cssColor: '#b07cff',
  },
] as const;

export function getSkill(id: SkillId): SkillDef {
  const def = SKILLS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown skill: ${id}`);
  return def;
}

/** Each class's basic attack (click-to-attack) for this slice. */
export function basicAttackFor(classId: ClassId): SkillDef {
  const def = SKILLS.find((s) => s.classId === classId);
  if (!def) throw new Error(`No basic attack for class: ${classId}`);
  return def;
}
