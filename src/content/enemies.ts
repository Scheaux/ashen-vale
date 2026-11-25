import type { EnemyId, EliteModifier } from './types';

/** Attack shapes the AI telegraphs before the active window. */
export type AttackShape = 'melee-arc' | 'bolt' | 'pounce' | 'slam';

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
  projectile?: {
    speed: number;
    radius: number;
    ttl: number;
  };
  damage: { min: number; max: number };
  /** Attack hits can be evaded and mitigated by armour; spells bypass both. */
  damageClass?: 'attack' | 'spell';
}

export type EnemyBehavior = 'bruiser' | 'kiter' | 'swarmer';

/** One boss phase (slice 7): its own pattern, pace and summoned adds. */
export interface BossPhaseDef {
  /** Enter the phase when the hp fraction falls to this level. */
  hpFraction: number;
  /** Announced on entry. */
  label: string;
  speedMult: number;
  damageMult: number;
  /** The pattern the boss fights with in this phase. */
  attack: AttackDef;
  /** Minion ids summoned on entering the phase. */
  adds: EnemyId[];
}

export interface BossDef {
  phases: BossPhaseDef[];
}

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
  /** Bosses cycle through phases as their hp falls (slice 7). */
  boss?: BossDef;
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
  volatile: { label: 'Volatile', color: 0xff7a3d, cssColor: '#ff7a3d' },
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
      damageClass: 'spell',
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
      damage: { min: 2, max: 5 },
    },
    color: 0x2e3a2c,
    eyeColor: 0x9fe870,
    xp: 9,
  },
  {
    id: 'ashen-warden',
    name: 'The Ashen Warden',
    maxHp: 720,
    speed: 3.8,
    radius: 1.15,
    aggroRange: 26,
    behavior: 'bruiser',
    attack: {
      shape: 'melee-arc',
      range: 3.6,
      windup: 0.9,
      active: 0.22,
      recovery: 0.6,
      cooldown: 1.6,
      arcDeg: 130,
      damage: { min: 12, max: 18 },
    },
    boss: {
      phases: [
        {
          // Phase 1: measured sweeps — the warm-up read.
          hpFraction: 1,
          label: 'The Ashen Warden wakes',
          speedMult: 1,
          damageMult: 1,
          attack: {
            shape: 'melee-arc',
            range: 3.6,
            windup: 0.9,
            active: 0.22,
            recovery: 0.6,
            cooldown: 1.6,
            arcDeg: 130,
            damage: { min: 12, max: 18 },
          },
          adds: [],
        },
        {
          // Phase 2: telegraphed ground slams where you stand, and aid arrives.
          hpFraction: 0.66,
          label: 'The Warden calls for aid',
          speedMult: 1.12,
          damageMult: 1.15,
          attack: {
            shape: 'slam',
            range: 3.8,
            windup: 1.1,
            active: 0.25,
            recovery: 0.7,
            cooldown: 2.2,
            damage: { min: 16, max: 24 },
          },
          adds: ['mire-skitterer', 'mire-skitterer', 'ashen-husk'],
        },
        {
          // Phase 3: enraged charges — fast, committed, punishing.
          hpFraction: 0.33,
          label: 'The Warden is enraged',
          speedMult: 1.32,
          damageMult: 1.35,
          attack: {
            shape: 'pounce',
            range: 9,
            windup: 0.7,
            active: 0.3,
            recovery: 0.55,
            cooldown: 1.5,
            arcDeg: 80,
            damage: { min: 18, max: 26 },
          },
          adds: ['mire-skitterer', 'mire-skitterer'],
        },
      ],
    },
    color: 0x55262c,
    eyeColor: 0xff4a33,
    xp: 220,
  },
] as const;

export function getEnemy(id: EnemyId): EnemyDef {
  const def = ENEMIES.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown enemy: ${id}`);
  return def;
}
