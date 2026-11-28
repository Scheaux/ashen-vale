import { angleDiff, angleLerp, segmentDistanceSq } from '../core/math';
import { clampCircleToCorridor, clampToCorridor, isInsideCorridor } from '../content/corridor';
import { getEnemy, type AttackDef, type BossPhaseDef, type EnemyDef } from '../content/enemies';
import type { ZoneCorridor } from '../content/types';
import { createEnemyState, type EnemyState, type GameState, type SimEvent } from '../sim/state';
import { spawnHazard } from '../sim/hazards';
import { damagePlayer, rollDamage, spawnEnemyBolt } from './combat';
import { activeBounds, clampCircleToBounds, resolveCircleCollisions } from './movement';

/**
 * Enemy AI: an explicit state machine with constrained intents.
 *
 *   idle      no aggro.            -> chase    when the player enters aggroRange
 *   chase     approach/reposition. -> windup   when in range and cooldown ready
 *   windup    COMMITMENT: facing + position lock; telegraph is visible.
 *             -> active after the windup duration (never instant turn-and-hit)
 *   active    strikes fire at entry; pounces hit once on swept contact.
 *             -> recovery after the active window
 *   recovery  no attacks, no repositioning beyond drift.
 *             -> chase; the attack cooldown starts here (prevents recovery spam)
 *   dead      exits any state.
 *
 * Perception -> intent -> motion are separate steps per tick: the intent is
 * chosen first, then movement executes it; a decision is never rewritten
 * mid-action. Collision results come from the authoritative collision pass.
 *
 * The end-zone boss adds one outer rule: it is leashed to its arena. It chases
 * while the hero is inside the encounter ring, never steps past the ring, and
 * walks back to the arena (keeping its current HP and phase) once the hero
 * retreats beyond it. Camp enemies are only corridor-clamped, never leashed.
 */

const AURA_RADIUS = 9;
const AURA_SPEED_MULT = 1.2;
/** The boss encounter leash extends this far past the arena ring. */
export const BOSS_LEASH_MARGIN = 10;
/** Close enough to the arena centre to end a leash return. */
const BOSS_HOME_EPSILON = 0.4;

/** Speed multiplier from living Swift elites' auras. */
function swiftAura(state: GameState, self: EnemyState): number {
  for (const other of state.enemies) {
    if (other === self || other.dead || !other.elite.includes('swift')) continue;
    const d = Math.hypot(other.position.x - self.position.x, other.position.z - self.position.z);
    if (d <= AURA_RADIUS) return AURA_SPEED_MULT;
  }
  return 1;
}

function enterPhase(enemy: EnemyState, phase: EnemyState['phase']): void {
  enemy.phase = phase;
  enemy.phaseTime = 0;
}

/** The pattern the enemy fights with: the active boss phase's, or the default. */
function activeAttack(enemy: EnemyState, def: EnemyDef): AttackDef {
  if (!def.boss) return def.attack;
  return def.boss.phases[enemy.bossPhase]?.attack ?? def.attack;
}

function currentBossPhase(def: EnemyDef, enemy: EnemyState): BossPhaseDef | null {
  return def.boss?.phases[enemy.bossPhase] ?? null;
}

function phaseDamageMult(def: EnemyDef, enemy: EnemyState): number {
  return currentBossPhase(def, enemy)?.damageMult ?? 1;
}

function phaseSpeedMult(def: EnemyDef, enemy: EnemyState): number {
  return currentBossPhase(def, enemy)?.speedMult ?? 1;
}

/** Warden encounter ring: the arena radius plus a modest return margin. */
export function bossLeashRadius(state: GameState): number {
  return state.arena.radius + BOSS_LEASH_MARGIN;
}

function distanceToArena(state: GameState, enemy: EnemyState): number {
  return Math.hypot(enemy.position.x - state.arena.center.x, enemy.position.z - state.arena.center.z);
}

/** A boss that has been carried outside its ring (e.g. by a committed pounce). */
function bossOutsideLeash(state: GameState, enemy: EnemyState): boolean {
  return distanceToArena(state, enemy) > bossLeashRadius(state);
}

/** The hero has retreated out of the encounter: the boss must not follow. */
function heroOutsideBossLeash(state: GameState): boolean {
  const p = state.player;
  return Math.hypot(p.position.x - state.arena.center.x, p.position.z - state.arena.center.z)
    > bossLeashRadius(state);
}

/** Summon a boss phase's minion adds around the boss, already in the fight. */
function spawnBossAdds(state: GameState, enemy: EnemyState, phase: BossPhaseDef): void {
  for (let i = 0; i < phase.adds.length; i++) {
    const angle = state.rng() * Math.PI * 2;
    const dist = 2.5 + state.rng() * 2;
    const add = createEnemyState(
      { enemyId: phase.adds[i], x: enemy.position.x + Math.cos(angle) * dist, z: enemy.position.z + Math.sin(angle) * dist, elite: [], camp: -1 },
      `add-${enemy.id}-${state.tick}-${i}`,
    );
    add.aggro = true;
    add.phase = 'chase';
    state.enemies.push(add);
  }
}

/** Bosses advance phases as their hp falls; entry fires adds and a toast. */
function advanceBossPhase(state: GameState, enemy: EnemyState, def: EnemyDef, events: SimEvent[]): void {
  if (!def.boss) return;
  const phases = def.boss.phases;
  while (enemy.bossPhase + 1 < phases.length && enemy.hp / enemy.maxHp <= phases[enemy.bossPhase + 1].hpFraction) {
    enemy.bossPhase++;
    const phase = phases[enemy.bossPhase];
    enemy.attackCooldown = Math.max(enemy.attackCooldown, 1.2); // a beat before the new pattern
    enemy.attackId = null;
    enterPhase(enemy, 'chase');
    spawnBossAdds(state, enemy, phase);
    events.push({ kind: 'boss-phase', bossId: enemy.id, phase: enemy.bossPhase, label: phase.label });
  }
}

/**
 * Furthest distance a straight pounce can travel before its lane leaves the
 * walkable band. Marched then bisected so the advertised tell and the actual
 * landing agree; the lunge can never be clamped to an unrelated point.
 */
function clipReachToCorridor(
  corridor: ZoneCorridor,
  x: number,
  z: number,
  vx: number,
  vz: number,
  reach: number,
  margin: number,
): number {
  if (reach <= 0) return 0;
  if (isInsideCorridor(corridor, x + vx * reach, z + vz * reach, margin)) return reach;

  const step = 0.25;
  let inside = 0;
  let outside = reach;
  for (let d = step; d < reach; d += step) {
    if (!isInsideCorridor(corridor, x + vx * d, z + vz * d, margin)) {
      outside = d;
      break;
    }
    inside = d;
  }
  for (let i = 0; i < 12; i++) {
    const mid = (inside + outside) / 2;
    if (isInsideCorridor(corridor, x + vx * mid, z + vz * mid, margin)) inside = mid;
    else outside = mid;
  }
  return inside;
}

/** Clip the advertised straight pounce lane to the first solid or fight edge. */
function pounceDistance(state: GameState, enemy: EnemyState, range: number): number {
  const vx = Math.sin(enemy.windupFacing);
  const vz = Math.cos(enemy.windupFacing);
  const { x, z } = enemy.position;
  let reach = range;

  if (state.corridor) {
    // In the linear bog the corridor is the walkable edge; the broad bounds
    // circle can cut off the rounded caps and is not the fight boundary.
    reach = clipReachToCorridor(state.corridor, x, z, vx, vz, reach, enemy.radius);
  } else {
    const bounds = activeBounds(state);
    const dx = x - bounds.center.x;
    const dz = z - bounds.center.z;
    const dot = dx * vx + dz * vz;
    const boundary = bounds.radius - enemy.radius;
    reach = Math.min(range, Math.max(0, -dot + Math.sqrt(Math.max(0, dot * dot + boundary ** 2 - dx * dx - dz * dz))));
  }

  for (const collider of state.colliders) {
    const cx = collider.x - x;
    const cz = collider.z - z;
    const along = cx * vx + cz * vz;
    if (along <= 0) continue;
    const discriminant = (collider.radius + enemy.radius) ** 2 - (cx * cx + cz * cz - along * along);
    if (discriminant > 0) reach = Math.min(reach, Math.max(0, along - Math.sqrt(discriminant)));
  }
  return reach;
}

export function resetEnemyCombat(enemy: EnemyState): void {
  enterPhase(enemy, 'idle');
  enemy.aggro = false;
  enemy.attackCooldown = 0;
  enemy.attackId = null;
  enemy.lungeRemaining = 0;
  enemy.lungeHit = false;
  enemy.chillTime = 0;
  enemy.velocity.x = 0;
  enemy.velocity.z = 0;
  enemy.previousPosition.x = enemy.position.x;
  enemy.previousPosition.z = enemy.position.z;
}

function canStartAttack(enemy: EnemyState, def: EnemyDef, attack: AttackDef, dist: number): boolean {
  if (enemy.attackCooldown > 0) return false;
  switch (def.behavior) {
    case 'bruiser':
      return dist <= attack.range * 0.85;
    case 'kiter': {
      const band = def.preferredRange ?? 10;
      return dist <= band + 2.5;
    }
    case 'swarmer':
      return dist <= attack.range;
  }
}

/** Resolve the strike once, at active-window entry, against the locked shape. */
function resolveStrike(state: GameState, enemy: EnemyState, def: EnemyDef, events: SimEvent[]): void {
  const p = state.player;
  const attack = activeAttack(enemy, def);
  const dx = p.position.x - enemy.position.x;
  const dz = p.position.z - enemy.position.z;
  const dist = Math.hypot(dx, dz);

  events.push({ kind: 'attack', sourceId: enemy.id, skillId: 'enemy-strike', x: enemy.position.x, z: enemy.position.z, facing: enemy.facing });

  if (attack.shape === 'bolt') {
    spawnEnemyBolt(state, enemy, attack);
    return;
  }

  if (attack.shape === 'pounce') return; // resolved along the dash, not at takeoff

  const hit = (raw: number) => damagePlayer(state, raw * enemy.damageMult * phaseDamageMult(def, enemy), events, {
    ...(enemy.attackId ? { attackId: enemy.attackId } : {}),
    sourceName: def.name,
    damageClass: attack.damageClass ?? 'attack',
  });

  if (attack.shape === 'slam') {
    // Ground slam: everything standing in the locked landing circle.
    const sx = p.position.x - enemy.strikeTarget.x;
    const sz = p.position.z - enemy.strikeTarget.z;
    if (Math.hypot(sx, sz) <= attack.range + p.radius) {
      hit(rollDamage(state, attack.damage.min, attack.damage.max));
    }
    // The Warden's slam leaves a burning crater behind.
    if (enemy.defId === 'ashen-warden') {
      spawnHazard(state, {
        kind: 'cinder',
        x: enemy.strikeTarget.x,
        z: enemy.strikeTarget.z,
        radius: attack.range * 0.82,
        fuse: 0.55,
        duration: 2.6,
        tickInterval: 0.5,
        damage: 5,
        sourceName: def.name,
        color: 0xff5a33,
      }, events);
    }
    return;
  }

  // Melee arc only hits what is inside the locked sweep.
  const halfArc = ((attack.arcDeg ?? 360) / 2) * (Math.PI / 180);
  const inArc = Math.abs(angleDiff(enemy.windupFacing, Math.atan2(dx, dz))) <= halfArc;
  if (dist <= attack.range + p.radius && inArc) {
    hit(attack.damage.min + state.rng() * (attack.damage.max - attack.damage.min));
  }
}

function stepChase(state: GameState, enemy: EnemyState, def: EnemyDef, dt: number): void {
  const p = state.player;
  const attack = activeAttack(enemy, def);
  const chillMult = enemy.chillTime > 0 ? 0.65 : 1;
  const speed = enemy.speed * swiftAura(state, enemy) * phaseSpeedMult(def, enemy) * chillMult;

  // The Warden walks home instead of following the hero out of the encounter.
  // Windup/active never reach this function, so committed attacks always land.
  const returning = Boolean(def.boss) && (heroOutsideBossLeash(state) || bossOutsideLeash(state, enemy));
  const targetX = returning ? state.arena.center.x : p.position.x;
  const targetZ = returning ? state.arena.center.z : p.position.z;
  const dx = targetX - enemy.position.x;
  const dz = targetZ - enemy.position.z;
  const dist = Math.hypot(dx, dz);

  let moveX = 0;
  let moveZ = 0;
  if (returning) {
    if (dist > 0.001) {
      moveX = dx / dist;
      moveZ = dz / dist;
    }
  } else if (def.behavior === 'kiter') {
    // Hold a distance band: approach when far, back off when crowded.
    const band = def.preferredRange ?? 10;
    if (dist > band + 2.5) {
      moveX = dx / dist;
      moveZ = dz / dist;
    } else if (dist < band - 2.5 && dist > 0.001) {
      moveX = -dx / dist;
      moveZ = -dz / dist;
    }
  } else {
    if (dist > attack.range * 0.75 && dist > 0.001) {
      moveX = dx / dist;
      moveZ = dz / dist;
    }
  }

  enemy.velocity.x = moveX * speed;
  enemy.velocity.z = moveZ * speed;
  enemy.position.x += enemy.velocity.x * dt;
  enemy.position.z += enemy.velocity.z * dt;
  resolveCircleCollisions(enemy.position, enemy.velocity, enemy.radius, state.colliders);
  if (state.corridor) {
    clampCircleToCorridor(enemy.position, enemy.velocity, enemy.radius, state.corridor);
  } else {
    clampCircleToBounds(enemy.position, enemy.velocity, enemy.radius, activeBounds(state));
  }

  if (def.boss && !returning) {
    // Normal boss pacing stays inside the ring; the margin already accounts
    // for its body, so clamp the centre rather than a second body radius.
    clampCircleToBounds(enemy.position, enemy.velocity, 0, {
      center: state.arena.center,
      radius: bossLeashRadius(state),
    });
  }

  // Only a boss that had to leave the ring (or chased a hero out of it) resets
  // at home; it keeps its HP, phase and cooldowns besides the normal reset.
  if (returning && Math.hypot(
    enemy.position.x - state.arena.center.x,
    enemy.position.z - state.arena.center.z,
  ) <= BOSS_HOME_EPSILON) {
    resetEnemyCombat(enemy);
    return;
  }

  // Face the objective: the hero while fighting, the arena while walking home.
  const faceX = returning ? state.arena.center.x - enemy.position.x : p.position.x - enemy.position.x;
  const faceZ = returning ? state.arena.center.z - enemy.position.z : p.position.z - enemy.position.z;
  enemy.facing = angleLerp(enemy.facing, Math.atan2(faceX, faceZ), Math.min(1, 8 * dt));
}

export function stepEnemies(state: GameState, dt: number, events: SimEvent[]): void {
  const p = state.player;

  for (const enemy of state.enemies) {
    enemy.previousPosition.x = enemy.position.x;
    enemy.previousPosition.z = enemy.position.z;
    if (enemy.dead) {
      enemy.deadTime += dt;
      continue;
    }

    if (p.hp <= 0) {
      resetEnemyCombat(enemy);
      continue;
    }

    enemy.phaseTime += dt;
    if (enemy.chillTime > 0) enemy.chillTime = Math.max(0, enemy.chillTime - dt);
    if (enemy.attackCooldown > 0) enemy.attackCooldown -= dt;

    const def = getEnemy(enemy.defId);
    if (def.boss) advanceBossPhase(state, enemy, def, events);
    const attack = activeAttack(enemy, def);
    const dx = p.position.x - enemy.position.x;
    const dz = p.position.z - enemy.position.z;
    const dist = Math.hypot(dx, dz);
    // A boss only starts new aggression while the hero is inside its ring, and
    // it returns home if its own position was carried outside the ring.
    const bossReturning = Boolean(def.boss) && (heroOutsideBossLeash(state) || bossOutsideLeash(state, enemy));

    switch (enemy.phase) {
      case 'idle': {
        enemy.velocity.x = 0;
        enemy.velocity.z = 0;
        if (def.boss && bossOutsideLeash(state, enemy)) {
          // Recover an out-of-ring boss even if the hero is nowhere near.
          enemy.aggro = true;
          enterPhase(enemy, 'chase');
          break;
        }
        if (dist <= def.aggroRange && (!def.boss || !heroOutsideBossLeash(state))) {
          enemy.aggro = true;
          enterPhase(enemy, 'chase');
        }
        break;
      }

      case 'chase': {
        if (!bossReturning && canStartAttack(enemy, def, attack, dist)) {
          // The player can read and leave the locked danger area.
          enemy.windupFacing = Math.atan2(dx, dz);
          enemy.attackId = `${enemy.id}:${state.tick}`;
          if (attack.shape === 'slam') {
            enemy.strikeTarget = state.corridor
              ? clampToCorridor(state.corridor, p.position.x, p.position.z, enemy.radius)
              : { x: p.position.x, z: p.position.z };
          }
          enemy.lungeRemaining = attack.shape === 'pounce' ? pounceDistance(state, enemy, attack.range) : 0;
          enemy.lungeHit = false;
          enemy.velocity.x = 0;
          enemy.velocity.z = 0;
          enemy.facing = enemy.windupFacing;
          enterPhase(enemy, 'windup');
          events.push({
            kind: 'telegraph',
            enemyId: enemy.id,
            attackId: enemy.attackId,
            // Bosses and elites keep ground tells; normal enemies (including
            // boss adds for now) rely on the body-language windup cue.
            tier: def.boss ? 'boss' : enemy.elite.length > 0 ? 'elite' : 'normal',
            shape: attack.shape,
            x: attack.shape === 'slam' ? enemy.strikeTarget.x : enemy.position.x,
            z: attack.shape === 'slam' ? enemy.strikeTarget.z : enemy.position.z,
            facing: enemy.windupFacing,
            range: attack.shape === 'pounce'
              ? enemy.lungeRemaining
              : attack.shape === 'slam'
                ? attack.range
                : attack.shape === 'bolt' && attack.projectile
                  ? Math.min(attack.range, attack.projectile.speed * attack.projectile.ttl)
                  : attack.range + p.radius,
            radius: attack.shape === 'slam'
              ? attack.range
              : p.radius + (attack.shape === 'pounce' ? enemy.radius : attack.projectile?.radius ?? 0),
            arcDeg: attack.arcDeg ?? 360,
            duration: attack.windup,
          });
          break;
        }
        stepChase(state, enemy, def, dt);
        break;
      }

      case 'windup': {
        // Stillness is the tell; facing is frozen at the locked angle.
        enemy.velocity.x = 0;
        enemy.velocity.z = 0;
        if (enemy.phaseTime >= attack.windup) {
          enterPhase(enemy, 'active');
          resolveStrike(state, enemy, def, events);
        }
        break;
      }

      case 'active': {
        if (attack.shape === 'pounce') {
          const distance = Math.min(enemy.lungeRemaining, (attack.range / attack.active) * dt);
          enemy.lungeRemaining -= distance;
          const x = enemy.position.x;
          const z = enemy.position.z;
          enemy.velocity.x = Math.sin(enemy.windupFacing) * distance / dt;
          enemy.velocity.z = Math.cos(enemy.windupFacing) * distance / dt;
          enemy.position.x += enemy.velocity.x * dt;
          enemy.position.z += enemy.velocity.z * dt;
          if (state.corridor
            && clampCircleToCorridor(enemy.position, enemy.velocity, enemy.radius, state.corridor)) {
            // The lane left the band mid-dash (a bend could defeat the launch
            // clip); stop at the rim instead of skimming along it.
            enemy.lungeRemaining = 0;
            enemy.velocity.x = 0;
            enemy.velocity.z = 0;
          }
          if (!enemy.lungeHit && segmentDistanceSq(p.position.x, p.position.z, x, z, enemy.position.x, enemy.position.z)
            <= (p.radius + enemy.radius) ** 2) {
            enemy.lungeHit = true;
            damagePlayer(state, rollDamage(state, attack.damage.min, attack.damage.max) * enemy.damageMult * phaseDamageMult(def, enemy), events, {
              ...(enemy.attackId ? { attackId: enemy.attackId } : {}),
              sourceName: def.name,
              damageClass: attack.damageClass ?? 'attack',
            });
          }
        } else {
          enemy.velocity.x = 0;
          enemy.velocity.z = 0;
        }
        if (enemy.phaseTime >= attack.active) {
          enemy.velocity.x = 0;
          enemy.velocity.z = 0;
          enterPhase(enemy, 'recovery');
        }
        break;
      }

      case 'recovery': {
        enemy.velocity.x = 0;
        enemy.velocity.z = 0;
        if (enemy.phaseTime >= attack.recovery) {
          // Cooldown starts here: no recovery-spam chains.
          enemy.attackCooldown = attack.cooldown;
          enterPhase(enemy, 'chase');
        }
        break;
      }
    }
  }

  // Retire corpses after the fade window.
  state.enemies = state.enemies.filter((e) => !e.dead || e.deadTime < 1.4);
}
