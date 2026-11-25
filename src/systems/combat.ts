import { angleDiff, angleLerp, segmentDistanceSq } from '../core/math';
import { getEnemy, type AttackDef } from '../content/enemies';
import { basicAttackFor, getSkill, type SkillDef } from '../content/skills';
import { skillAreaMultiplier, skillCooldownMultiplier, skillDamageMultiplier, skillManaCost, skillRank } from './loadout';
import type { SkillId } from '../content/types';
import type { AreaStrike, EnemyState, GameState, PlayerState, SimEvent, Vec2 } from '../sim/state';
import { spawnHazard } from '../sim/hazards';
import { onEnemyDeath } from './loot';
import {
  cancelMove,
  clampCircleToBounds,
  resolveCircleCollisions,
  setMoveTarget,
} from './movement';
import {
  armourMitigation,
  ES_RECHARGE_DELAY,
  ES_RECHARGE_RATE,
  evadeChance,
  scalePlayerDamage,
} from './stats';

/**
 * Centralized combat pipeline. All damage flows through damageEnemy/damagePlayer
 * so cooldowns, damage rolls and death cannot be duplicated across call sites.
 * Every outcome is reported through authoritative SimEvents.
 *
 * Incoming player damage runs the full defence stack: evasion (attack hits
 * only), then armour mitigation (attack hits only), then energy shield
 * absorption, then life.
 */

/** Normalized window of a dash skill in which the player actually travels. */
const DASH_WINDOW = { start: 0.25, end: 0.92 } as const;

export interface PlayerDamageOptions {
  attackId?: string;
  sourceName?: string;
  /** Attacks can be evaded and are mitigated by armour; spells bypass both. */
  damageClass?: 'attack' | 'spell';
}

export function rollDamage(state: GameState, min: number, max: number): number {
  return Math.round(min + state.rng() * (max - min));
}

export function damageEnemy(state: GameState, enemy: EnemyState, amount: number, events: SimEvent[]): void {
  if (enemy.dead) return;
  const dealt = Math.max(1, Math.round(amount));
  enemy.hp = Math.max(0, enemy.hp - dealt);
  events.push({
    kind: 'damage',
    targetKind: 'enemy',
    targetId: enemy.id,
    amount: dealt,
    x: enemy.position.x,
    y: 1.6,
    z: enemy.position.z,
  });
  if (enemy.hp === 0) {
    enemy.dead = true;
    enemy.deadTime = 0;
    state.runStats.kills += 1;
    events.push({ kind: 'death', targetKind: 'enemy', targetId: enemy.id, x: enemy.position.x, z: enemy.position.z });
    if (enemy.elite.includes('volatile')) {
      spawnHazard(state, {
        kind: 'volatile',
        x: enemy.position.x,
        z: enemy.position.z,
        radius: 2.8,
        fuse: 1.0,
        damage: 18,
        sourceName: `${getEnemy(enemy.defId).name} (Volatile)`,
        color: 0xff7a3d,
      }, events);
    }
    onEnemyDeath(state, enemy, events); // XP + loot + flask charges from the central pipeline
  }
}

export function damagePlayer(
  state: GameState,
  amount: number,
  events: SimEvent[],
  opts: PlayerDamageOptions = {},
): void {
  const p = state.player;
  if (p.hp <= 0) return;
  const damageClass = opts.damageClass ?? 'attack';

  // 1) Evasion: attack hits can be dodged entirely; spells cannot.
  if (damageClass === 'attack' && state.rng() < evadeChance(p.evasion)) {
    state.runStats.evades += 1;
    events.push({ kind: 'evade', targetId: 'player', x: p.position.x, y: 2.1, z: p.position.z });
    return;
  }

  // 2) Armour: mitigation of attack hits, better against small hits than big ones.
  let hit = amount;
  if (damageClass === 'attack') hit *= 1 - armourMitigation(p.armour, hit);
  const dealt = Math.max(1, Math.round(hit));

  // 3) Energy shield absorbs first; only the overflow reaches life.
  const absorbed = Math.min(p.energyShield, dealt);
  p.energyShield -= absorbed;
  p.esRechargeDelay = ES_RECHARGE_DELAY;
  p.hp = Math.max(0, p.hp - (dealt - absorbed));

  state.runStats.damageTaken += dealt;
  state.runStats.lastBlow = { sourceName: opts.sourceName ?? 'the Ashen Moor', amount: dealt };
  events.push({
    kind: 'damage',
    targetKind: 'player',
    targetId: 'player',
    ...(opts.attackId ? { attackId: opts.attackId } : {}),
    amount: dealt,
    absorbed,
    x: p.position.x,
    y: 2.1,
    z: p.position.z,
  });
  if (p.hp === 0) {
    p.attack = null;
    events.push({ kind: 'death', targetKind: 'player', targetId: 'player', x: p.position.x, z: p.position.z });
  }
}

function findEnemy(state: GameState, id: string | null): EnemyState | null {
  if (!id) return null;
  return state.enemies.find((e) => e.id === id && !e.dead) ?? null;
}

/** Per-tick resource bookkeeping: cooldown sweep, mana regen, shield recharge. */
function tickPlayerResources(state: GameState, dt: number): void {
  const p = state.player;
  const cooldowns = p.cooldowns;
  for (const id of Object.keys(cooldowns) as SkillId[]) {
    const remaining = cooldowns[id];
    if (remaining !== undefined && remaining > 0) cooldowns[id] = Math.max(0, remaining - dt);
  }
  p.mana = Math.min(p.maxMana, p.mana + p.manaRegen * dt);
  if (p.esRechargeDelay > 0) {
    p.esRechargeDelay = Math.max(0, p.esRechargeDelay - dt);
  } else if (p.energyShield < p.maxEnergyShield) {
    p.energyShield = Math.min(p.maxEnergyShield, p.energyShield + p.maxEnergyShield * ES_RECHARGE_RATE * dt);
  }
  state.runStats.seconds += dt;
}

/** Can this skill be paid for and started right now? */
export function canCast(state: GameState, skill: SkillDef): 'ok' | 'mana' | 'cooldown' | 'locked' {
  const p = state.player;
  if (skill.role === 'active' && (skillRank(state, skill.id) <= 0 || !state.skills.loadout.includes(skill.id))) {
    return 'locked';
  }
  if ((p.cooldowns[skill.id] ?? 0) > 0) return 'cooldown';
  if (p.mana < skillManaCost(state, skill.id)) return 'mana';
  return 'ok';
}

/** Rolled skill damage including the player's rank multiplier. */
function playerSkillDamage(state: GameState, skill: SkillDef): number {
  const roll = rollDamage(state, skill.damage.min, skill.damage.max) * skillDamageMultiplier(state, skill.id);
  return scalePlayerDamage(state, roll, skill.damageClass);
}

/**
 * Player combat verb: hotbar cast requests come first and interrupt the basic
 * swing (active-skill casts stay committed); otherwise pursue the attack
 * target into range and auto-repeat the free basic attack on cooldown.
 */
export function stepPlayerCombat(state: GameState, dt: number, events: SimEvent[]): void {
  const p = state.player;
  tickPlayerResources(state, dt);
  if (p.hp <= 0) return;

  // A committed active-skill cast cannot be cancelled; the basic swing yields.
  const locked = p.attack !== null && getSkill(p.attack.skillId).role !== 'basic';
  const request = p.castRequest;
  if (request && !locked) {
    p.castRequest = null;
    const skill = getSkill(request.skillId);
    if (skill.classId !== p.classId) return;
    const ready = canCast(state, skill);
    if (ready !== 'ok') {
      events.push({ kind: 'refuse', reason: ready, label: skill.name });
      return;
    }
    startCast(state, skill, { x: request.x, z: request.z }, events);
    return;
  }

  if (p.attack) {
    stepAttack(state, dt, events);
    return;
  }

  const target = findEnemy(state, p.attackTargetId);
  if (!target) {
    p.attackTargetId = null;
    return;
  }

  const skill = basicAttackFor(p.classId);
  const dx = target.position.x - p.position.x;
  const dz = target.position.z - p.position.z;
  const dist = Math.hypot(dx, dz);

  if (dist > skill.pursueRange) {
    // Chase: movement consumes the destination each tick.
    setMoveTarget(state, target.position);
    return;
  }

  // In stance: stop moving and face the target.
  cancelMove(state);
  const aim = dist > 0.001 ? Math.atan2(dx, dz) : p.facing;
  p.facing = angleLerp(p.facing, aim, Math.min(1, 14 * dt));

  if (dist > skill.range || (p.cooldowns[skill.id] ?? 0) > 0 || Math.abs(angleDiff(p.facing, aim)) > 0.2) return;

  p.facing = aim;
  p.velocity.x = 0;
  p.velocity.z = 0;
  startCast(state, skill, { x: target.position.x, z: target.position.z }, events);
}

/** Commit to a skill: pay its mana, start its cooldown, lock the pose clock. */
function startCast(state: GameState, skill: SkillDef, aim: Vec2, events: SimEvent[]): void {
  const p = state.player;
  const dx = aim.x - p.position.x;
  const dz = aim.z - p.position.z;
  const facing = dx * dx + dz * dz > 1e-6 ? Math.atan2(dx, dz) : p.facing;
  cancelMove(state);
  p.facing = facing;
  p.velocity.x = 0;
  p.velocity.z = 0;
  p.attack = {
    skillId: skill.id,
    elapsed: 0,
    facing,
    aim: { x: aim.x, z: aim.z },
    hit: [],
    dashLeft: skill.dash?.distance ?? 0,
    impactDone: false,
  };
  p.cooldowns[skill.id] = skill.cooldown * skillCooldownMultiplier(state, skill.id);
  p.mana = Math.max(0, p.mana - skillManaCost(state, skill.id));
  events.push({ kind: 'attack', sourceId: 'player', skillId: skill.id, x: p.position.x, z: p.position.z, facing });
}

/** Advance a committed attack: dash travel, contact resolution, pose end. */
function stepAttack(state: GameState, dt: number, events: SimEvent[]): void {
  const p = state.player;
  const attack = p.attack;
  if (!attack) return;
  const skill = getSkill(attack.skillId);
  const previous = attack.elapsed;
  attack.elapsed += dt;

  if (skill.delivery === 'dash' && skill.dash) stepDashTravel(state, skill, attack, previous, dt, events);

  const contactTime = skill.duration * skill.contact;
  if (previous < contactTime && attack.elapsed >= contactTime) {
    resolvePlayerAttack(state, skill, attack, events);
  }

  // Leap Slam: the landing shockwave fires once when dash travel ends.
  if (skill.impactRadius && !attack.impactDone) {
    const landingTime = skill.duration * DASH_WINDOW.end;
    if (previous < landingTime && attack.elapsed >= landingTime) {
      attack.impactDone = true;
      const p = state.player;
      areaDamage(state, p.position.x, p.position.z, effectiveRadius(state, skill, skill.impactRadius),
        playerSkillDamage(state, skill), events, skill.color, skill.id, skill.chill);
    }
  }
  if (attack.elapsed >= skill.duration) p.attack = null;
}

/** Dash delivery: travel along the locked facing, hitting each enemy once. */
function stepDashTravel(
  state: GameState,
  skill: SkillDef,
  attack: NonNullable<PlayerState['attack']>,
  previous: number,
  dt: number,
  events: SimEvent[],
): void {
  const p = state.player;
  const startTime = skill.duration * DASH_WINDOW.start;
  const endTime = skill.duration * DASH_WINDOW.end;
  const from = Math.max(previous, startTime);
  const to = Math.min(attack.elapsed, endTime);
  if (to <= from || attack.dashLeft <= 0) return;

  const travel = Math.min((skill.dash?.speed ?? 0) * Math.min(dt, to - from), attack.dashLeft);
  attack.dashLeft -= travel;
  p.previousPosition.x = p.position.x;
  p.previousPosition.z = p.position.z;
  p.position.x += Math.sin(attack.facing) * travel;
  p.position.z += Math.cos(attack.facing) * travel;
  resolveCircleCollisions(p.position, p.velocity, p.radius, state.colliders);
  clampCircleToBounds(p.position, p.velocity, p.radius, state.bounds);

  // Leap Slam uses one landing shockwave instead of path damage.
  if (skill.impactRadius) return;

  const reach = (skill.radius ?? 1.2) + 0;
  for (const enemy of state.enemies) {
    if (enemy.dead || attack.hit.includes(enemy.id)) continue;
    const dist = Math.hypot(enemy.position.x - p.position.x, enemy.position.z - p.position.z);
    if (dist > reach + enemy.radius) continue;
    attack.hit.push(enemy.id);
    damageEnemy(state, enemy, playerSkillDamage(state, skill), events);
  }
}

/** Rune area scaling lives here so every delivery reads the same value. */
function effectiveRadius(state: GameState, skill: SkillDef, base: number): number {
  return base * skillAreaMultiplier(state, skill.id);
}

function effectiveArc(state: GameState, skill: SkillDef, base: number): number {
  return base * skillAreaMultiplier(state, skill.id);
}

/** Apply one pre-rolled hit to every enemy inside a circle, with optional chill. */
function areaDamage(
  state: GameState,
  x: number,
  z: number,
  radius: number,
  damage: number,
  events: SimEvent[],
  color: number,
  skillId: SkillId,
  chill = 0,
): void {
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    const dist = Math.hypot(enemy.position.x - x, enemy.position.z - z);
    if (dist > radius + enemy.radius) continue;
    damageEnemy(state, enemy, damage, events);
    if (chill > 0) enemy.chillTime = Math.max(enemy.chillTime, chill);
  }
  events.push({ kind: 'burst', skillId, x, z, radius, color });
}

function resolvePlayerAttack(
  state: GameState,
  skill: SkillDef,
  attack: NonNullable<PlayerState['attack']>,
  events: SimEvent[],
): void {
  const p = state.player;
  switch (skill.delivery) {
    case 'melee-arc': {
      const halfArc = (effectiveArc(state, skill, skill.arcDeg ?? 360) / 2) * (Math.PI / 180);
      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        const ex = enemy.position.x - p.position.x;
        const ez = enemy.position.z - p.position.z;
        const d = Math.hypot(ex, ez);
        if (d > skill.range + enemy.radius) continue;
        if (d > 0.001 && Math.abs(angleDiff(attack.facing, Math.atan2(ex, ez))) > halfArc) continue;
        damageEnemy(state, enemy, playerSkillDamage(state, skill), events);
      }
      break;
    }
    case 'projectile':
      spawnProjectile(state, skill, attack.facing);
      break;
    case 'spread': {
      const count = skill.count ?? 3;
      const spread = ((effectiveArc(state, skill, skill.spreadDeg ?? 20)) * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
        spawnProjectile(state, skill, attack.facing + offset);
      }
      break;
    }
    case 'nova': {
      const radius = effectiveRadius(state, skill, skill.radius ?? 0);
      areaDamage(state, p.position.x, p.position.z, radius, playerSkillDamage(state, skill),
        events, skill.color, skill.id, skill.chill);
      break;
    }
    case 'ground': {
      const strike: AreaStrike = {
        id: `strike-${state.tick}-${state.strikes.length}`,
        skillId: skill.id,
        x: attack.aim.x,
        z: attack.aim.z,
        radius: effectiveRadius(state, skill, skill.radius ?? 3),
        fuse: skill.fuse ?? 0.5,
        damage: playerSkillDamage(state, skill),
        color: skill.color,
      };
      state.strikes.push(strike);
      break;
    }
    case 'dash':
      // Travel damage is delivered during the active window (stepDashTravel).
      break;
  }
}

function spawnProjectile(state: GameState, skill: SkillDef, facing: number): void {
  const p = state.player;
  const spec = skill.projectile;
  if (!spec) return;
  state.projectiles.push({
    id: `proj-${state.tick}-${state.projectiles.length}`,
    owner: 'player',
    sourceName: skill.name,
    skillId: skill.id,
    position: { x: p.position.x, z: p.position.z },
    y: 1.25,
    velocity: { x: Math.sin(facing) * spec.speed, z: Math.cos(facing) * spec.speed },
    damage: playerSkillDamage(state, skill),
    radius: effectiveRadius(state, skill, spec.radius),
    ttl: spec.ttl,
    color: skill.color,
    visual: spec.visual,
    damageClass: skill.damageClass,
    age: 0,
    ...(skill.explodeRadius ? { explodeRadius: effectiveRadius(state, skill, skill.explodeRadius) } : {}),
    ...(skill.chill ? { chill: skill.chill } : {}),
  });
}

/** Enemy bolt travels along the direction advertised at windup start. */
export function spawnEnemyBolt(
  state: GameState,
  enemy: EnemyState,
  attack: AttackDef,
): void {
  const spec = attack.projectile;
  if (!spec) return;
  state.projectiles.push({
    id: `bolt-${state.tick}-${state.projectiles.length}`,
    owner: enemy.id,
    sourceName: getEnemy(enemy.defId).name,
    attackId: enemy.attackId ?? undefined,
    skillId: 'enemy-bolt',
    position: { x: enemy.position.x, z: enemy.position.z },
    y: 1.35,
    velocity: { x: Math.sin(enemy.windupFacing) * spec.speed, z: Math.cos(enemy.windupFacing) * spec.speed },
    damage: rollDamage(state, attack.damage.min, attack.damage.max) * enemy.damageMult,
    radius: spec.radius,
    ttl: Math.min(spec.ttl, attack.range / spec.speed),
    color: getEnemy(enemy.defId).eyeColor,
    visual: 'orb',
    damageClass: attack.damageClass ?? 'attack',
    age: 0,
  });
}

/** Move projectiles, resolve contact damage (per owner team), expire on hit or timeout. */
export function stepProjectiles(state: GameState, dt: number, events: SimEvent[]): void {
  if (state.projectiles.length === 0) return;
  const remaining = [];
  for (const proj of state.projectiles) {
    const x = proj.position.x;
    const z = proj.position.z;
    const travelDt = Math.min(dt, proj.ttl);
    proj.position.x += proj.velocity.x * travelDt;
    proj.position.z += proj.velocity.z * travelDt;
    proj.ttl -= dt;

    let consumed = false;
    // Birth-tick grace: a fan loosed at point-blank must survive the tick it
    // was born in (it has not been drawn yet), but contact resolves on the
    // very next tick — no dead zone at the muzzle.
    const born = proj.age === 0;
    proj.age += dt;
    if (!born) {
      if (proj.owner === 'player') {
        for (const enemy of state.enemies) {
          if (enemy.dead) continue;
          const dist = Math.hypot(enemy.position.x - proj.position.x, enemy.position.z - proj.position.z);
          if (dist > proj.radius + enemy.radius) continue;
          if (proj.explodeRadius) {
            areaDamage(state, proj.position.x, proj.position.z, proj.explodeRadius, proj.damage,
              events, proj.color, proj.skillId as SkillId, proj.chill ?? 0);
          } else {
            damageEnemy(state, enemy, proj.damage, events);
            if (proj.chill) enemy.chillTime = Math.max(enemy.chillTime, proj.chill);
          }
          consumed = true;
          break;
        }
      } else {
        const p = state.player;
        if (p.hp > 0 && segmentDistanceSq(p.position.x, p.position.z, x, z, proj.position.x, proj.position.z)
          <= (proj.radius + p.radius) ** 2) {
          damagePlayer(state, proj.damage, events, {
            ...(proj.attackId ? { attackId: proj.attackId } : {}),
            sourceName: proj.sourceName,
            damageClass: proj.damageClass,
          });
          consumed = true;
        }
      }
    }
    if (!consumed && proj.ttl > 0) remaining.push(proj);
  }
  state.projectiles = remaining;
}

/** Tick pending ground strikes: telegraphed fuse, then one authoritative burst. */
export function stepStrikes(state: GameState, dt: number, events: SimEvent[]): void {
  if (state.strikes.length === 0) return;
  const remaining: AreaStrike[] = [];
  for (const strike of state.strikes) {
    strike.fuse -= dt;
    if (strike.fuse > 0) {
      remaining.push(strike);
      continue;
    }
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      const dist = Math.hypot(enemy.position.x - strike.x, enemy.position.z - strike.z);
      if (dist > strike.radius + enemy.radius) continue;
      damageEnemy(state, enemy, strike.damage, events);
    }
    events.push({
      kind: 'burst',
      skillId: strike.skillId,
      x: strike.x,
      z: strike.z,
      radius: strike.radius,
      color: strike.color,
    });
  }
  state.strikes = remaining;
}
