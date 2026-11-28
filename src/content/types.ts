/** Shared content contracts: authored data stays separate from runtime state. */

export interface Vec2 {
  x: number;
  z: number;
}

export type ClassId = 'marauder' | 'ranger' | 'witch';
export type ZoneId = 'ashen-moor' | 'drowned-ossuary';
export type EnemyId = 'ashen-husk' | 'cinder-cultist' | 'mire-skitterer' | 'ashen-warden';
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
  | 'meteor-strike'
  | 'leap-slam'
  | 'blast-shot'
  | 'frost-nova';

/** Six PoE-style skill loadout slots: right click plus Q/W/E/R/F. */
export type LoadoutSlot = 'rmb' | 'q' | 'w' | 'e' | 'r' | 'f';
export const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['rmb', 'q', 'w', 'e', 'r', 'f'];

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

/**
 * Long, linear playable band. The walkable area is every point within `radius`
 * of the polyline through `points`, including the rounded end caps.
 */
export interface ZoneCorridor {
  points: Vec2[];
  radius: number;
}

export type EliteModifier = 'vital' | 'savage' | 'swift' | 'volatile';

export interface EnemySpawn {
  enemyId: EnemyId;
  x: number;
  z: number;
  /** Empty for normal enemies; 1-2 modifiers for elites. */
  elite: EliteModifier[];
  /** Camp index for objective tracking (-1 or absent: not part of a camp). */
  camp?: number;
}

export interface ZoneLayout {
  seed: number;
  name: string;
  bounds: ZoneBounds;
  spawn: { x: number; z: number };
  colliders: CircleCollider[];
  props: PropPlacement[];
  enemySpawns: EnemySpawn[];
  /** Boss arena at the far end of the zone (slice 7). */
  arena: ZoneBounds;
  /** Where the Ashen Warden waits at the far end of the zone. */
  bossSpawn: EnemySpawn;
  /** Linear walkable band; legacy fixtures may omit it and use circle bounds. */
  corridor?: ZoneCorridor;
  /** Portal behind the end encounter; opens when the zone boss falls. */
  portal?: Vec2;
}
