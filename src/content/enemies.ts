import type { EnemyId, EliteModifier } from './types';

/** Attack shapes the AI telegraphs before the active window. */
export type AttackShape = 'melee-arc' | 'bolt' | 'pounce';

export interface AttackDef {
  shape: AttackShape;
  /** Strike reach (arc radius / pounce range / bolt max travel). */
  range: number;
  /** Telegraph windup in seconds — the anticipation the player reads and dodges. */
  windup: number;
  /** Active window in seconds (the strike itself). */
  active: number;
  /** Recovery in seconds before the cooldown starts ticking. */
  recovery: number;
  /** Seconds between attack cycles after recovery. */
  cooldown: number;
  /** Sweep half-angle is arcDeg/2 around the locked facing. */
  arcDeg?: number;
  /** Pounce dash speed during the active window. */
  lungeSpeed?: number;
  projectile?: {
    speed: number;
    radius: number;
    ttl: number;
  };
  damage: { min: number; max: number };
}

export type EnemyBehavior = 'bruiser' | 'kiter' | 'swarmer';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  maxHp: number;
  /** Movement speed, world units per second. */
  speed: number;
  radius: number;
  /** Distance at which the enemy notices the player. */
  aggroRange: number;
  behavior: EnemyBehavior;
  attack: AttackDef;
  /** Kiter: distance band to hold outside of attacks. */
  preferredRange?: number;
  /** Body color (three.js hex). */
  color: number;
  /** Eye/glow color (three.js hex). */
  eyeColor: number;
  /** Experience awarded (used from slice 4). */
  xp: number;
}

export const ELITE_MODIFIERS: Record<EliteModifier, { label: string; color: number; cssColor: string }> = {
  vital: { label: 'Vital', color: 0xff5c4d, cssColor: '#ff5c4d' },
  savage: { label: 'Savage', color: 0xffb347, cssColor: '#ffb347' },
  swift: { label: 'Swift', color: 0x4dd2ff, cssColor: '#4dd2ff' },
};

export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'ashen-husk',
    name: 'Ashen Husk',
    maxHp: 46,
    speed: 3.4,
    radius: 0.62,
    aggroRange: 15,
    behavior: 'bruiser',
    attack: {
      shape: 'melee-arc',
      range: 2.4,
      windup: 0.8,
      active: 0.18,
      recovery: 0.5,
      cooldown: 1.3,
      arcDeg: 110,
      damage: { min: 3, max: 6 },
    },
    color: 0x3a2f42,
    eyeColor: 0xffb347,
    xp: 12,
  },
  {
    id: 'cinder-cultist',
    name: 'Cinder Cultist',
    maxHp: 38,
    speed: 2.9,
    radius: 0.58,
    aggroRange: 18,
    behavior: 'kiter',
    preferredRange: 11,
    attack: {
      shape: 'bolt',
      range: 24,
      windup: 1.0,
      active: 0.16,
      recovery: 0.55,
      cooldown: 1.6,
      projectile: { speed: 13, radius: 0.4, ttl: 2.2 },
      damage: { min: 5, max: 9 },
    },
    color: 0x4a2c22,
    eyeColor: 0xff7a3d,
    xp: 16,
  },
  {
    id: 'mire-skitterer',
    name: 'Mire Skitterer',
    maxHp: 26,
    speed: 5.2,
    radius: 0.5,
    aggroRange: 17,
    behavior: 'swarmer',
    attack: {
      shape: 'pounce',
      range: 5.5,
      windup: 0.5,
      active: 0.22,
      recovery: 0.35,
      cooldown: 1.1,
      arcDeg: 70,
      lungeSpeed: 11,
      damage: { min: 2, max: 5 },
    },
    color: 0x2e3a2c,
    eyeColor: 0x9fe870,
    xp: 9,
  },
] as const;

export function getEnemy(id: EnemyId): EnemyDef {
  const def = ENEMIES.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown enemy: ${id}`);
  return def;
}
