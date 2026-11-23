import type {
  ClassDef,
  CircleCollider,
  EnemySpawn,
  EliteModifier,
  SkillId,
  ZoneBounds,
  ZoneLayout,
} from '../content/types';
import { getEnemy } from '../content/enemies';
import type { ItemSlot } from '../content/items';
import { createRng, type Rng } from '../core/rng';
import type { ItemInstance } from './items';

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerState {
  position: Vec2;
  /** Position at the start of the current tick, for render interpolation. */
  previousPosition: Vec2;
  velocity: Vec2;
  /** Facing angle in radians (0 = +Z). */
  facing: number;
  /** Click-to-move destination, or null when idle. */
  moveTarget: Vec2 | null;
  /** Enemy being pursued/attacked, or null. */
  attackTargetId: string | null;
  attackCooldown: number;
  /** Committed basic attack; normalized pose and contact share this clock. */
  attack: { elapsed: number; facing: number } | null;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  classId: ClassDef['id'];
}

/**
 * Enemy AI state machine (see systems/enemyAi.ts for transitions):
 *   idle -> chase -> windup (telegraph, facing locked) -> active (strike)
 *   -> recovery -> chase.  Death exits any state.
 */
export type EnemyPhase = 'idle' | 'chase' | 'windup' | 'active' | 'recovery';

export interface EnemyState {
  id: string;
  defId: EnemySpawn['enemyId'];
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  facing: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damageMult: number;
  elite: EliteModifier[];
  phase: EnemyPhase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /** Attack cooldown remaining (starts ticking after recovery). */
  attackCooldown: number;
  /** Facing locked at windup start — the dodge counterplay reads off this. */
  windupFacing: number;
  attackId: string | null;
  /** Locked pounce travel budget and whether this dash has already hit. */
  lungeRemaining: number;
  lungeHit: boolean;
  aggro: boolean;
  dead: boolean;
  /** Seconds since death, for the corpse fade. */
  deadTime: number;
}

export interface ProjectileState {
  id: string;
  /** 'player' or the enemy id that fired it. */
  owner: string;
  attackId?: string;
  skillId: SkillId | 'enemy-bolt';
  position: Vec2;
  /** Fixed projectile height. */
  y: number;
  velocity: Vec2;
  damage: number;
  radius: number;
  ttl: number;
  color: number;
}

export interface LootDrop {
  id: string;
  item: ItemInstance;
  x: number;
  z: number;
}

export interface InventoryState {
  bags: ItemInstance[];
  equipment: Record<ItemSlot, ItemInstance | null>;
}

/**
 * Authoritative combat events emitted by the simulation. Rendering and UI
 * consume these; they never infer gameplay outcomes from visual state.
 */
export type SimEvent =
  | { kind: 'attack'; sourceId: string; skillId: string; x: number; z: number }
  | {
      kind: 'telegraph';
       enemyId: string;
       attackId: string;
      shape: 'melee-arc' | 'bolt' | 'pounce';
      x: number;
      z: number;
      facing: number;
       range: number;
       radius: number;
      arcDeg: number;
      duration: number;
    }
  | {
      kind: 'damage';
      targetKind: 'player' | 'enemy';
       targetId: string;
       attackId?: string;
      amount: number;
      x: number;
      y: number;
      z: number;
    }
  | { kind: 'death'; targetKind: 'player' | 'enemy'; targetId: string; x: number; z: number }
  | { kind: 'levelup'; level: number }
  | { kind: 'pickup'; name: string; rarity: string };

export interface GameState {
  tick: number;
  zoneSeed: number;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  colliders: CircleCollider[];
  bounds: ZoneBounds;
  inventory: InventoryState;
  loot: LootDrop[];
  /** Character progression (slice 4). */
  level: number;
  xp: number;
  xpToNext: number;
  /** Events accumulated since the last drain. */
  events: SimEvent[];
  /** Seeded RNG for gameplay rolls; excluded from serialization. */
  rng: Rng;
}

export const PLAYER_MAX_HP = 120;

export function createGameState(def: ClassDef, layout: ZoneLayout, seed = 0xc0ffee): GameState {
  return {
    tick: 0,
    zoneSeed: layout.seed,
    player: {
      position: { x: layout.spawn.x, z: layout.spawn.z },
      previousPosition: { x: layout.spawn.x, z: layout.spawn.z },
      velocity: { x: 0, z: 0 },
      facing: Math.PI, // look back into the zone from the spawn edge
      moveTarget: null,
      attackTargetId: null,
      attackCooldown: 0,
      attack: null,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      speed: def.speed,
      radius: 0.55,
      classId: def.id,
    },
    enemies: layout.enemySpawns.map((spawn, i) => {
      const enemyDef = getEnemy(spawn.enemyId);
      const elite = spawn.elite;
      let maxHp = enemyDef.maxHp;
      let speed = enemyDef.speed;
      let damageMult = 1;
      if (elite.includes('vital')) maxHp = Math.round(maxHp * 2.2);
      if (elite.includes('swift')) speed *= 1.25;
      if (elite.includes('savage')) damageMult *= 1.6;
      return {
        id: `enemy-${i}`,
        defId: spawn.enemyId,
        position: { x: spawn.x, z: spawn.z },
        previousPosition: { x: spawn.x, z: spawn.z },
        velocity: { x: 0, z: 0 },
        facing: 0,
        hp: maxHp,
        maxHp,
        speed,
        radius: enemyDef.radius,
        damageMult,
        elite,
        phase: 'idle' as const,
        phaseTime: 0,
        attackCooldown: 0,
        windupFacing: 0,
        attackId: null,
        lungeRemaining: 0,
        lungeHit: false,
        aggro: false,
        dead: false,
        deadTime: 0,
      };
    }),
    projectiles: [],
    colliders: layout.colliders.map((c) => ({ ...c })),
    bounds: {
      center: { ...layout.bounds.center },
      radius: layout.bounds.radius,
    },
    inventory: {
      bags: [],
      equipment: { weapon: null, helm: null, chest: null, gloves: null, boots: null, amulet: null },
    },
    loot: [],
    level: 1,
    xp: 0,
    xpToNext: 60,
    events: [],
    rng: createRng(seed),
  };
}

/** Take ownership of accumulated sim events (drained once per render frame). */
export function drainEvents(state: GameState): SimEvent[] {
  if (state.events.length === 0) return [];
  return state.events.splice(0, state.events.length);
}
