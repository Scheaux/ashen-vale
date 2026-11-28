import type {
  ClassDef,
  CircleCollider,
  EnemySpawn,
  EliteModifier,
  SkillId,
  ZoneBounds,
  ZoneId,
  ZoneLayout,
} from '../content/types';
import { LOADOUT_SLOTS } from '../content/types';
import {
  activeCampsForZone,
  ZONE_DEFS,
  ZONE_IDS,
  type BossTrigger,
} from '../content/zones';
import { getEnemy } from '../content/enemies';
import { startingSkillFor } from '../content/skills';
import type { RuneId } from '../content/runes';
import type { ItemSlot } from '../content/items';
import { PASSIVE_ROOT } from '../content/passives';
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
  /** Per-skill cooldown seconds remaining (slice 5 hotbar). */
  cooldowns: Partial<Record<SkillId, number>>;
  /** Hotbar cast request; consumed at the start of the next combat step. */
  castRequest: { skillId: SkillId; x: number; z: number } | null;
  /**
   * Committed attack (basic or hotbar skill). The normalized pose and the
   * contact frame share this clock; `aim` fixes ground-strike placement and
   * `hit` keeps dash travel from hitting one enemy twice.
   */
  attack: {
    skillId: SkillId;
    elapsed: number;
    facing: number;
    aim: Vec2;
    hit: string[];
    dashLeft: number;
    /** Leap Slam-style landing shockwave has fired once. */
    impactDone: boolean;
  } | null;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  /** Mana restored per second. */
  manaRegen: number;
  /** Energy shield: absorbs damage before hp and recharges out of combat. */
  energyShield: number;
  maxEnergyShield: number;
  /** Seconds without damage before the shield starts recharging. */
  esRechargeDelay: number;
  /** Derived combat stats (slice 5+ rework); kept current by syncPlayerStats. */
  armour: number;
  evasion: number;
  attackDamagePct: number;
  spellDamagePct: number;
  /** Flat "+X to Attack/Spell Damage" added to every skill roll. */
  addedAttackDamage: number;
  addedSpellDamage: number;
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
  /** Camp index for objective tracking (-1: boss, adds, or campless). */
  camp: number;
  /** Boss phase index (slice 7); 0 for everything else. */
  bossPhase: number;
  /** Locked landing point for slam attacks. */
  strikeTarget: Vec2;
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
  /** Remaining chill/slow seconds from Frost Nova; 0 = normal speed. */
  chillTime: number;
}

export interface ProjectileState {
  id: string;
  /** 'player' or the enemy id that fired it. */
  owner: string;
  /** Display name of the shooter, for the death recap. */
  sourceName: string;
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
  /** Renderer look: arrow mesh, glowing orb, or fast streak. */
  visual: 'arrow' | 'orb' | 'streak';
  /** Incoming damage classification: attacks can be evaded; spells cannot. */
  damageClass: 'attack' | 'spell';
  /** Seconds alive; contact is ignored during the spawn grace. */
  age: number;
  /** Blast Shot: damage every enemy inside this radius on impact. */
  explodeRadius?: number;
  /** Frost effect carried by a projectile, in seconds. */
  chill?: number;
}

/** Telegraphed ground danger: volatile elite death blasts and cinder pools. */
export interface HazardState {
  id: string;
  kind: 'volatile' | 'cinder';
  x: number;
  z: number;
  radius: number;
  /** Seconds before the first detonation/tick. */
  fuse: number;
  /** Lingering pool seconds after the first detonation (0 = one-shot). */
  duration: number;
  /** Seconds between pool damage ticks. */
  tickInterval: number;
  damage: number;
  sourceName: string;
  color: number;
  age: number;
  detonated: boolean;
  tickTimer: number;
}

/** Delayed player area strike (ground delivery): telegraphed, then detonates. */
export interface AreaStrike {
  id: string;
  skillId: SkillId;
  x: number;
  z: number;
  radius: number;
  /** Seconds until the strike lands. */
  fuse: number;
  /** Pre-rolled damage applied to every enemy caught in the radius. */
  damage: number;
  color: number;
}

export interface FlaskState {
  charges: number;
  max: number;
}

/** Per-life counters feeding the death recap. */
export interface RunStats {
  kills: number;
  damageTaken: number;
  /** Attack hits fully evaded (evasion). */
  evades: number;
  /** Simulated seconds survived this life. */
  seconds: number;
  lastBlow: { sourceName: string; amount: number } | null;
}

export interface LootDrop {
  id: string;
  item: ItemInstance;
  x: number;
  z: number;
}

/** Crafting currency earned from kills; spent at the bench. */
export interface CurrencyState {
  dust: number;
  rune: number;
  quality: number;
}

/** Per-zone objective tracking (slice 7+): camps, then the zone boss. */
export interface ZoneProgress {
  campsTotal: number;
  campCleared: boolean[];
  bossSpawned: boolean;
  bossDefeated: boolean;
}

export interface InventoryState {
  bags: ItemInstance[];
  equipment: Record<ItemSlot, ItemInstance | null>;
}

export interface PassivesState {
  /** Allocated passive node ids (slice 6); `root` is granted at creation. */
  allocated: string[];
}

/** Skill ranks and the six-slot loadout (post-release skill system). */
export interface SkillState {
  /** Active-skill rank; missing/0 means locked. Rank 1 is unlocked. */
  ranks: Partial<Record<SkillId, number>>;
  /** RMB, Q, W, E, R, F order; null means an empty slot. */
  loadout: Array<SkillId | null>;
  /** One rune per active skill; missing means no rune. */
  runes: Partial<Record<SkillId, RuneId>>;
}

/**
 * Authoritative combat events emitted by the simulation. Rendering and UI
 * consume these; they never infer gameplay outcomes from visual state.
 */
export type SimEvent =
  | { kind: 'attack'; sourceId: string; skillId: string; x: number; z: number; facing: number }
  | {
      kind: 'telegraph';
       enemyId: string;
       attackId: string;
      shape: 'melee-arc' | 'bolt' | 'pounce' | 'slam';
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
      /** Energy shield portion of the hit (player only). */
      absorbed?: number;
      x: number;
      y: number;
      z: number;
    }
  | { kind: 'evade'; targetId: string; x: number; y: number; z: number }
  | { kind: 'death'; targetKind: 'player' | 'enemy'; targetId: string; x: number; z: number }
  | { kind: 'hazard'; id: string; x: number; z: number; radius: number; color: number; duration: number }
  | { kind: 'levelup'; level: number }
  | { kind: 'pickup'; name: string; rarity: string }
  | {
      kind: 'burst';
      skillId: SkillId;
      x: number;
      z: number;
      radius: number;
      color: number;
    }
  | {
      kind: 'resource';
      resource: 'health' | 'mana';
      amount: number;
      x: number;
      y: number;
      z: number;
    }
  | { kind: 'refuse'; reason: 'mana' | 'cooldown' | 'flask-empty' | 'locked'; label: string }
  | { kind: 'objective'; text: string }
  | { kind: 'boss-phase'; bossId: string; phase: number; label: string }
  | { kind: 'victory' };

export interface GameState {
  tick: number;
  zoneId: ZoneId;
  zoneSeed: number;
  /** Per-zone progress; only the current zone advances in 5.0. */
  progress: Record<ZoneId, ZoneProgress>;
  /** Same object as progress[zoneId]. */
  objectives: ZoneProgress;
  bossTrigger: BossTrigger;
  finalZone: ZoneId;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  /** Pending player area strikes ticking down to their fuse. */
  strikes: AreaStrike[];
  /** Telegraphed enemy ground hazards (volatile deaths, cinder pools). */
  hazards: HazardState[];
  colliders: CircleCollider[];
  bounds: ZoneBounds;
  /** Boss arena bounds; active during the boss fight (slice 7). */
  arena: ZoneBounds;
  /** Where the Ashen Warden waits until the camps are cleared. */
  bossSpawn: EnemySpawn;
  inventory: InventoryState;
  loot: LootDrop[];
  /** Ember Dust, Ashen Runes and Quality Embers. */
  currency: CurrencyState;
  /** Passive skill tree allocation (slice 6). */
  passives: PassivesState;
  /** Active-skill ranks and the RMB/Q/W/E/R/F loadout. */
  skills: SkillState;
  /** Health/mana flasks with refill-on-kill charges. */
  flasks: { health: FlaskState; mana: FlaskState };
  /** Character progression (slice 4). */
  level: number;
  xp: number;
  xpToNext: number;
  /** Per-life counters for the death recap. */
  runStats: RunStats;
  /** Events accumulated since the last drain. */
  events: SimEvent[];
  /** Seeded RNG for gameplay rolls; excluded from serialization. */
  rng: Rng;
}

export const PLAYER_MAX_HP = 120;
export const PLAYER_BASE_MANA = 60;
export const FLASK_MAX_CHARGES = 4;

/**
 * Attribute synergy multipliers (slice 5+ stat rework): what each point of
 * strength / dexterity / intelligence is worth. Single source shared by
 * createGameState and stats derivation so the two can never drift.
 */
export const SYNERGY = {
  strength: { maxHp: 0.5, armour: 2.5, attackDamagePct: 0.4 },
  dexterity: { evasion: 2.5, moveSpeedPct: 0.08, attackDamagePct: 0.4 },
  intelligence: { maxMana: 1.5, energyShield: 2.5, spellDamagePct: 0.6 },
} as const;

/** Level-1 mana pool before equipment; shared with stats derivation. */
export function baseManaFor(intelligence: number): number {
  return Math.round(PLAYER_BASE_MANA + intelligence * SYNERGY.intelligence.maxMana);
}

/** Mana restored per second for a given pool; shared with stats derivation. */
export function manaRegenFor(maxMana: number): number {
  return 3 + maxMana * 0.02;
}

/** Build an enemy from a spawn; shared by zone population and boss adds. */
export function createEnemyState(spawn: EnemySpawn, id: string): EnemyState {
  const enemyDef = getEnemy(spawn.enemyId);
  const elite = spawn.elite;
  let maxHp = enemyDef.maxHp;
  let speed = enemyDef.speed;
  let damageMult = 1;
  if (elite.includes('vital')) maxHp = Math.round(maxHp * 2.2);
  if (elite.includes('swift')) speed *= 1.25;
  if (elite.includes('savage')) damageMult *= 1.6;
  return {
    id,
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
    camp: spawn.camp ?? -1,
    bossPhase: 0,
    strikeTarget: { x: spawn.x, z: spawn.z },
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
    chillTime: 0,
  };
}

export function createGameState(
  def: ClassDef,
  layout: ZoneLayout,
  seed = 0xc0ffee,
  zoneId: ZoneId = 'ashen-moor',
): GameState {
  const maxMana = baseManaFor(def.stats.intelligence);
  const maxHp = Math.round(PLAYER_MAX_HP + def.stats.strength * SYNERGY.strength.maxHp);
  const energyShield = Math.round(def.stats.intelligence * SYNERGY.intelligence.energyShield);
  const camps = new Set(layout.enemySpawns.map((s) => s.camp ?? -1).filter((c) => c >= 0));
  const startingSkill = startingSkillFor(def.id);
  const loadout: Array<SkillId | null> = LOADOUT_SLOTS.map(() => null);
  loadout[LOADOUT_SLOTS.indexOf('q')] = startingSkill.id;
  const progress = {} as Record<ZoneId, ZoneProgress>;
  for (const id of ZONE_IDS) {
    // The live layout supplies the current zone's camp count; inactive zones
    // hold their authored active-camp slots until a later chapter plays them.
    const campsTotal = id === zoneId ? camps.size : activeCampsForZone(id);
    progress[id] = {
      campsTotal,
      campCleared: Array.from({ length: campsTotal }, () => false),
      bossSpawned: false,
      bossDefeated: false,
    };
  }
  const finalZone = ZONE_IDS.find((id) => ZONE_DEFS[id].final) ?? zoneId;
  return {
    tick: 0,
    zoneId,
    zoneSeed: layout.seed,
    progress,
    objectives: progress[zoneId],
    bossTrigger: ZONE_DEFS[zoneId].bossTrigger,
    finalZone,
    player: {
      position: { x: layout.spawn.x, z: layout.spawn.z },
      previousPosition: { x: layout.spawn.x, z: layout.spawn.z },
      velocity: { x: 0, z: 0 },
      facing: Math.PI, // look back into the zone from the spawn edge
      moveTarget: null,
      attackTargetId: null,
      cooldowns: {},
      castRequest: null,
      attack: null,
      hp: maxHp,
      maxHp,
      mana: maxMana,
      maxMana,
      manaRegen: manaRegenFor(maxMana),
      energyShield,
      maxEnergyShield: energyShield,
      esRechargeDelay: 0,
      armour: def.stats.strength * SYNERGY.strength.armour,
      evasion: def.stats.dexterity * SYNERGY.dexterity.evasion,
      attackDamagePct:
        def.stats.strength * SYNERGY.strength.attackDamagePct +
        def.stats.dexterity * SYNERGY.dexterity.attackDamagePct,
      spellDamagePct: def.stats.intelligence * SYNERGY.intelligence.spellDamagePct,
      addedAttackDamage: 0,
      addedSpellDamage: 0,
      speed: def.speed,
      radius: 0.55,
      classId: def.id,
    },
    enemies: layout.enemySpawns.map((spawn, i) => createEnemyState(spawn, `enemy-${i}`)),
    projectiles: [],
    strikes: [],
    hazards: [],
    colliders: layout.colliders.map((c) => ({ ...c })),
    bounds: {
      center: { ...layout.bounds.center },
      radius: layout.bounds.radius,
    },
    arena: {
      center: { ...layout.arena.center },
      radius: layout.arena.radius,
    },
    bossSpawn: { ...layout.bossSpawn },
    inventory: {
      bags: [],
      equipment: { weapon: null, helm: null, chest: null, gloves: null, boots: null, amulet: null },
    },
    loot: [],
    currency: { dust: 0, rune: 0, quality: 0 },
    passives: { allocated: [PASSIVE_ROOT] },
    skills: {
      ranks: { [startingSkill.id]: 1 },
      loadout,
      runes: {},
    },
    flasks: {
      health: { charges: FLASK_MAX_CHARGES, max: FLASK_MAX_CHARGES },
      mana: { charges: FLASK_MAX_CHARGES, max: FLASK_MAX_CHARGES },
    },
    level: 1,
    xp: 0,
    xpToNext: 60,
    runStats: { kills: 0, damageTaken: 0, evades: 0, seconds: 0, lastBlow: null },
    events: [],
    rng: createRng(seed),
  };
}

/** Take ownership of accumulated sim events (drained once per render frame). */
export function drainEvents(state: GameState): SimEvent[] {
  if (state.events.length === 0) return [];
  return state.events.splice(0, state.events.length);
}
