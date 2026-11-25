import type { ClassId, SkillId } from './types';

/** Normalized strike keys used by both skill simulation and pose curves. */
export const BASIC_ATTACK_CONTACT = { melee: 0.45, projectile: 0.6 } as const;

/**
 * How a skill delivers its damage:
 *   melee-arc    — sweep around the committed facing (cleave)
 *   projectile   — one projectile along facing (shot, bolt, snipe)
 *   spread       — a fan of `count` projectiles around facing
 *   nova         — instant burst around the caster
 *   ground       — delayed area strike at the aim point (`fuse` tell)
 *   dash         — travel along facing, hitting each enemy at most once
 */
export type SkillDelivery = 'melee-arc' | 'projectile' | 'spread' | 'nova' | 'ground' | 'dash';

export type ProjectileVisual = 'arrow' | 'orb' | 'streak';

export interface SkillDef {
  id: SkillId;
  name: string;
  classId: ClassId;
  /** Attack Damage or Spell Damage scales this skill (stat rework). */
  damageClass: 'attack' | 'spell';
  /** Basic attacks are left-click only; active skills are loadout-eligible. */
  role: 'basic' | 'active';
  /** Character level required before the library allows unlocking. */
  unlockLevel: number;
  /** One-line mechanic summary for hotbar tooltips. */
  description: string;
  delivery: SkillDelivery;
  damage: { min: number; max: number };
  /** Seconds between uses. */
  cooldown: number;
  /** Mana paid on cast; basic attacks are free. */
  manaCost: number;
  /** Full committed pose duration and normalized contact/release frame. */
  duration: number;
  contact: number;
  /** Maximum strike distance (melee reach, or projectile travel budget). */
  range: number;
  /** Distance at which auto-pursuit stops and windup can begin. */
  pursueRange: number;
  /** Melee sweep half-arc is arcDeg/2 around facing. */
  arcDeg?: number;
  /** Impact radius for nova, ground and dash deliveries. */
  radius?: number;
  /** Seconds between the contact frame and a ground strike landing. */
  fuse?: number;
  /** spread: projectile count and total angular fan in degrees. */
  count?: number;
  spreadDeg?: number;
  /** dash: travel budget and speed during the active window. */
  dash?: { distance: number; speed: number };
  /** dash landing shockwave radius (Leap Slam). */
  impactRadius?: number;
  /** projectile impact explosion radius (Blast Shot). */
  explodeRadius?: number;
  /** nova/projectile chill application in seconds (Frost Nova). */
  chill?: number;
  projectile?: {
    speed: number;
    radius: number;
    ttl: number;
    visual: ProjectileVisual;
  };
  /** Effect color (three.js hex). */
  color: number;
  cssColor: string;
  /** Hotbar glyph (plain Unicode so it renders in headless QA). */
  glyph: string;
}

export const SKILLS: readonly SkillDef[] = [
  // ---------- Marauder ----------
  {
    id: 'cleave',
    name: 'Cleave',
    classId: 'marauder',
    damageClass: 'attack',
    role: 'basic',
    unlockLevel: 0,
    description: 'A wide axe sweep. Free — always ready.',
    delivery: 'melee-arc',
    damage: { min: 9, max: 14 },
    cooldown: 0.85,
    manaCost: 0,
    duration: 0.42,
    contact: BASIC_ATTACK_CONTACT.melee,
    range: 2.7,
    pursueRange: 2.2,
    arcDeg: 110,
    color: 0xff6a3d,
    cssColor: '#ff6a3d',
    glyph: '✕',
  },
  {
    id: 'sunder',
    name: 'Sunder',
    classId: 'marauder',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 1,
    description: 'Crack the ground at the target. Heavy impact after a short tell.',
    delivery: 'ground',
    damage: { min: 22, max: 32 },
    cooldown: 5,
    manaCost: 18,
    duration: 0.45,
    contact: 0.5,
    range: 9,
    pursueRange: 9,
    radius: 2.8,
    fuse: 0.5,
    color: 0xff8a4d,
    cssColor: '#ff8a4d',
    glyph: '▼',
  },
  {
    id: 'whirlwind',
    name: 'Whirlwind',
    classId: 'marauder',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 2,
    description: 'Spin in place, striking everything around you.',
    delivery: 'nova',
    damage: { min: 16, max: 24 },
    cooldown: 5.5,
    manaCost: 22,
    duration: 0.5,
    contact: 0.45,
    range: 3.6,
    pursueRange: 3.2,
    radius: 3.6,
    color: 0xffb266,
    cssColor: '#ffb266',
    glyph: '❂',
  },
  {
    id: 'reckless-charge',
    name: 'Reckless Charge',
    classId: 'marauder',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 4,
    description: 'Charge forward, carving through everything in the path.',
    delivery: 'dash',
    damage: { min: 18, max: 26 },
    cooldown: 9,
    manaCost: 26,
    duration: 0.6,
    contact: 0.25,
    range: 8,
    pursueRange: 8,
    radius: 1.4,
    dash: { distance: 8, speed: 15 },
    color: 0xe8574a,
    cssColor: '#e8574a',
    glyph: '➤',
  },

  // ---------- Ranger ----------
  {
    id: 'piercing-shot',
    name: 'Piercing Shot',
    classId: 'ranger',
    damageClass: 'attack',
    role: 'basic',
    unlockLevel: 0,
    description: 'Loose an arrow. Free — always ready.',
    delivery: 'projectile',
    damage: { min: 7, max: 12 },
    cooldown: 0.75,
    manaCost: 0,
    duration: 0.42,
    contact: BASIC_ATTACK_CONTACT.projectile,
    range: 30,
    pursueRange: 11,
    projectile: { speed: 26, radius: 0.35, ttl: 1.25, visual: 'arrow' },
    color: 0x9fe870,
    cssColor: '#9fe870',
    glyph: '✦',
  },
  {
    id: 'split-shot',
    name: 'Split Shot',
    classId: 'ranger',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 1,
    description: 'Three arrows loosed in a fan.',
    delivery: 'spread',
    damage: { min: 6, max: 10 },
    cooldown: 3.5,
    manaCost: 15,
    duration: 0.45,
    contact: BASIC_ATTACK_CONTACT.projectile,
    range: 30,
    pursueRange: 11,
    count: 3,
    spreadDeg: 24,
    projectile: { speed: 26, radius: 0.3, ttl: 1.1, visual: 'arrow' },
    color: 0xb8f08a,
    cssColor: '#b8f08a',
    glyph: '≋',
  },
  {
    id: 'snipe',
    name: 'Snipe',
    classId: 'ranger',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 2,
    description: 'One brutally fast shot for high damage.',
    delivery: 'projectile',
    damage: { min: 26, max: 38 },
    cooldown: 6,
    manaCost: 20,
    duration: 0.5,
    contact: BASIC_ATTACK_CONTACT.projectile,
    range: 34,
    pursueRange: 14,
    projectile: { speed: 64, radius: 0.45, ttl: 0.9, visual: 'streak' },
    color: 0xd6ff9e,
    cssColor: '#d6ff9e',
    glyph: '↯',
  },
  {
    id: 'rain-of-arrows',
    name: 'Rain of Arrows',
    classId: 'ranger',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 4,
    description: 'Call a hail of arrows down on the target area.',
    delivery: 'ground',
    damage: { min: 30, max: 42 },
    cooldown: 10,
    manaCost: 32,
    duration: 0.45,
    contact: 0.5,
    range: 14,
    pursueRange: 14,
    radius: 4.2,
    fuse: 0.75,
    color: 0x8fd66a,
    cssColor: '#8fd66a',
    glyph: '❋',
  },

  // ---------- Witch ----------
  {
    id: 'ember-bolt',
    name: 'Ember Bolt',
    classId: 'witch',
    damageClass: 'spell',
    role: 'basic',
    unlockLevel: 0,
    description: 'A smouldering dart of ember-curse fire. Free — always ready.',
    delivery: 'projectile',
    damage: { min: 8, max: 13 },
    cooldown: 0.9,
    manaCost: 0,
    duration: 0.42,
    contact: BASIC_ATTACK_CONTACT.projectile,
    range: 30,
    pursueRange: 11,
    projectile: { speed: 20, radius: 0.4, ttl: 1.6, visual: 'orb' },
    color: 0xb07cff,
    cssColor: '#b07cff',
    glyph: '◈',
  },
  {
    id: 'ember-nova',
    name: 'Ember Nova',
    classId: 'witch',
    damageClass: 'spell',
    role: 'active',
    unlockLevel: 1,
    description: 'A ring of cursed fire erupts around you.',
    delivery: 'nova',
    damage: { min: 18, max: 27 },
    cooldown: 5,
    manaCost: 20,
    duration: 0.5,
    contact: 0.45,
    range: 3.2,
    pursueRange: 3,
    radius: 3.2,
    color: 0xff7a5c,
    cssColor: '#ff7a5c',
    glyph: '✷',
  },
  {
    id: 'cinder-barrage',
    name: 'Cinder Barrage',
    classId: 'witch',
    damageClass: 'spell',
    role: 'active',
    unlockLevel: 2,
    description: 'A fan of three cinder bolts.',
    delivery: 'spread',
    damage: { min: 8, max: 13 },
    cooldown: 4,
    manaCost: 18,
    duration: 0.45,
    contact: BASIC_ATTACK_CONTACT.projectile,
    range: 30,
    pursueRange: 11,
    count: 3,
    spreadDeg: 18,
    projectile: { speed: 22, radius: 0.35, ttl: 1.5, visual: 'orb' },
    color: 0xc99bff,
    cssColor: '#c99bff',
    glyph: '✹',
  },
  {
    id: 'meteor-strike',
    name: 'Meteor Strike',
    classId: 'witch',
    damageClass: 'spell',
    role: 'active',
    unlockLevel: 4,
    description: 'Pull a burning stone from the sky onto the target area.',
    delivery: 'ground',
    damage: { min: 42, max: 58 },
    cooldown: 11,
    manaCost: 36,
    duration: 0.5,
    contact: 0.5,
    range: 13,
    pursueRange: 13,
    radius: 3.4,
    fuse: 0.8,
    color: 0xff9d4d,
    cssColor: '#ff9d4d',
    glyph: '☄',
  },
  // ---------- Post-release fourth actives ----------
  {
    id: 'leap-slam',
    name: 'Leap Slam',
    classId: 'marauder',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 6,
    description: 'Leap toward the target and shatter the ground on landing.',
    delivery: 'dash',
    damage: { min: 24, max: 34 },
    cooldown: 10,
    manaCost: 26,
    duration: 0.75,
    contact: 0.3,
    range: 7,
    pursueRange: 7,
    radius: 1.5,
    dash: { distance: 7, speed: 18 },
    impactRadius: 3.4,
    color: 0xffc266,
    cssColor: '#ffc266',
    glyph: '⇓',
  },
  {
    id: 'blast-shot',
    name: 'Blast Shot',
    classId: 'ranger',
    damageClass: 'attack',
    role: 'active',
    unlockLevel: 6,
    description: 'A heavy arrow that bursts on impact, striking everything nearby.',
    delivery: 'projectile',
    damage: { min: 20, max: 28 },
    cooldown: 8,
    manaCost: 22,
    duration: 0.5,
    contact: BASIC_ATTACK_CONTACT.projectile,
    range: 26,
    pursueRange: 11,
    explodeRadius: 2.6,
    projectile: { speed: 24, radius: 0.32, ttl: 1.1, visual: 'arrow' },
    color: 0xffbd6a,
    cssColor: '#ffbd6a',
    glyph: '✸',
  },
  {
    id: 'frost-nova',
    name: 'Frost Nova',
    classId: 'witch',
    damageClass: 'spell',
    role: 'active',
    unlockLevel: 6,
    description: 'A ring of frost that chills nearby enemies, slowing them.',
    delivery: 'nova',
    damage: { min: 14, max: 20 },
    cooldown: 7,
    manaCost: 24,
    duration: 0.5,
    contact: 0.45,
    range: 4.3,
    pursueRange: 3.8,
    radius: 4.3,
    chill: 2.4,
    color: 0x8fdcff,
    cssColor: '#8fdcff',
    glyph: '❄',
  },
] as const;

export function getSkill(id: SkillId): SkillDef {
  const def = SKILLS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown skill: ${id}`);
  return def;
}

/** Active skills in unlock order; the first is the class signature skill. */
export function activeSkillsFor(classId: ClassId): SkillDef[] {
  return SKILLS.filter((s) => s.classId === classId && s.role === 'active')
    .slice()
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.name.localeCompare(b.name));
}

/** Each class's signature active skill, granted free at level 1. */
export function startingSkillFor(classId: ClassId): SkillDef {
  const def = activeSkillsFor(classId)[0];
  if (!def) throw new Error(`No starting skill for class: ${classId}`);
  return def;
}

/** Each class's basic attack (left click); free and always available. */
export function basicAttackFor(classId: ClassId): SkillDef {
  const def = SKILLS.find((s) => s.classId === classId && s.role === 'basic');
  if (!def) throw new Error(`No basic attack for class: ${classId}`);
  return def;
}
