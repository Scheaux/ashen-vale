/** Shared content contracts: authored data stays separate from runtime state. */

export type ClassId = 'marauder' | 'ranger' | 'witch';
export type EnemyId = 'ashen-husk' | 'cinder-cultist' | 'mire-skitterer';
export type SkillId =
  | 'cleave'
  | 'sunder'
  | 'whirlwind'
  | 'reckless-charge'
  | 'piercing-shot'
  | 'split-shot'
  | 'snipe'
  | 'rain-of-arrows'
  | 'ember-bolt'
  | 'ember-nova'
  | 'cinder-barrage'
  | 'meteor-strike';

export interface ClassStats {
  strength: number;
  dexterity: number;
  intelligence: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  epithet: string;
  description: string;
  /** Accent color as hex number (three.js color). */
  color: number;
  /** Accent color as CSS string (UI). */
  cssColor: string;
  /** Base movement speed, world units per second. */
  speed: number;
  stats: ClassStats;
}

export type PropKind = 'rock' | 'deadTree' | 'pillar' | 'pillarBroken';

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  /** Y rotation in radians. */
  rotation: number;
  /** Uniform-ish scale factor (per-kind ranges applied at render). */
  scale: number;
  /** Extra tilt in radians (broken pillars lean). */
  tilt: number;
}

export interface CircleCollider {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface ZoneBounds {
  center: { x: number; z: number };
  radius: number;
}

export type EliteModifier = 'vital' | 'savage' | 'swift';

export interface EnemySpawn {
  enemyId: EnemyId;
  x: number;
  z: number;
  /** Empty for normal enemies; 1-2 modifiers for elites. */
  elite: EliteModifier[];
}

export interface ZoneLayout {
  seed: number;
  name: string;
  bounds: ZoneBounds;
  spawn: { x: number; z: number };
  colliders: CircleCollider[];
  props: PropPlacement[];
  enemySpawns: EnemySpawn[];
}
