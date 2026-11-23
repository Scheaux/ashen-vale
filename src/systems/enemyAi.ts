import { angleDiff, angleLerp, segmentDistanceSq } from '../core/math';
import { getEnemy, type EnemyDef } from '../content/enemies';
import type { EnemyState, GameState, SimEvent } from '../sim/state';
import { damagePlayer, rollDamage, spawnEnemyBolt } from './combat';
import { clampCircleToBounds, resolveCircleCollisions } from './movement';

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
 */

const AURA_RADIUS = 9;
const AURA_SPEED_MULT = 1.2;

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

/** Clip the advertised straight pounce lane to the first solid or zone edge. */
function pounceDistance(state: GameState, enemy: EnemyState, range: number): number {
  const vx = Math.sin(enemy.windupFacing);
  const vz = Math.cos(enemy.windupFacing);
  const { x, z } = enemy.position;
  const dx = x - state.bounds.center.x;
  const dz = z - state.bounds.center.z;
  const dot = dx * vx + dz * vz;
  const boundary = state.bounds.radius - enemy.radius;
  let reach = Math.min(range, Math.max(0, -dot + Math.sqrt(Math.max(0, dot * dot + boundary ** 2 - dx * dx - dz * dz))));
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
  enemy.velocity.x = 0;
  enemy.velocity.z = 0;
  enemy.previousPosition.x = enemy.position.x;
  enemy.previousPosition.z = enemy.position.z;
}

function canStartAttack(enemy: EnemyState, def: EnemyDef, dist: number): boolean {
  if (enemy.attackCooldown > 0) return false;
  switch (def.behavior) {
    case 'bruiser':
      return dist <= def.attack.range * 0.85;
    case 'kiter': {
      const band = def.preferredRange ?? 10;
      return dist <= band + 2.5;
    }
    case 'swarmer':
      return dist <= def.attack.range;
  }
}

/** Resolve the strike once, at active-window entry, against the locked shape. */
function resolveStrike(state: GameState, enemy: EnemyState, def: EnemyDef, events: SimEvent[]): void {
  const p = state.player;
  const attack = def.attack;
  const dx = p.position.x - enemy.position.x;
  const dz = p.position.z - enemy.position.z;
  const dist = Math.hypot(dx, dz);

  events.push({ kind: 'attack', sourceId: enemy.id, skillId: 'enemy-strike', x: enemy.position.x, z: enemy.position.z, facing: enemy.facing });

  if (attack.shape === 'bolt') {
    spawnEnemyBolt(state, enemy, attack);
    return;
  }

  if (attack.shape === 'pounce') return; // resolved along the dash, not at takeoff

  // Melee arc only hits what is inside the locked sweep.
  const halfArc = ((attack.arcDeg ?? 360) / 2) * (Math.PI / 180);
  const inArc = Math.abs(angleDiff(enemy.windupFacing, Math.atan2(dx, dz))) <= halfArc;
  if (dist <= attack.range + p.radius && inArc) {
    const amount = attack.damage.min + state.rng() * (attack.damage.max - attack.damage.min);
    damagePlayer(state, amount * enemy.damageMult, events, {
      ...(enemy.attackId ? { attackId: enemy.attackId } : {}),
      sourceName: def.name,
      damageClass: attack.damageClass ?? 'attack',
    });
  }
}

function stepChase(state: GameState, enemy: EnemyState, def: EnemyDef, dt: number): void {
  const p = state.player;
  const dx = p.position.x - enemy.position.x;
  const dz = p.position.z - enemy.position.z;
  const dist = Math.hypot(dx, dz);
  const speed = enemy.speed * swiftAura(state, enemy);

  let moveX = 0;
  let moveZ = 0;
  if (def.behavior === 'kiter') {
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
    if (dist > def.attack.range * 0.75 && dist > 0.001) {
      moveX = dx / dist;
      moveZ = dz / dist;
    }
  }

  enemy.velocity.x = moveX * speed;
  enemy.velocity.z = moveZ * speed;
  enemy.position.x += enemy.velocity.x * dt;
  enemy.position.z += enemy.velocity.z * dt;
  resolveCircleCollisions(enemy.position, enemy.velocity, enemy.radius, state.colliders);
  clampCircleToBounds(enemy.position, enemy.velocity, enemy.radius, state.bounds);

  // Face the player while closing (chase only; windup locks facing).
  enemy.facing = angleLerp(enemy.facing, Math.atan2(dx, dz), Math.min(1, 8 * dt));
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
    if (enemy.attackCooldown > 0) enemy.attackCooldown -= dt;

    const def = getEnemy(enemy.defId);
    const attack = def.attack;
    const dx = p.position.x - enemy.position.x;
    const dz = p.position.z - enemy.position.z;
    const dist = Math.hypot(dx, dz);

    switch (enemy.phase) {
      case 'idle': {
        enemy.velocity.x = 0;
        enemy.velocity.z = 0;
        if (dist <= def.aggroRange) {
          enemy.aggro = true;
          enterPhase(enemy, 'chase');
        }
        break;
      }

      case 'chase': {
        if (canStartAttack(enemy, def, dist)) {
          // The player can read and leave the locked danger area.
          enemy.windupFacing = Math.atan2(dx, dz);
          enemy.attackId = `${enemy.id}:${state.tick}`;
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
            shape: attack.shape,
            x: enemy.position.x,
            z: enemy.position.z,
            facing: enemy.windupFacing,
            range: attack.shape === 'pounce'
              ? enemy.lungeRemaining
              : attack.shape === 'bolt' && attack.projectile
                ? Math.min(attack.range, attack.projectile.speed * attack.projectile.ttl)
                : attack.range + p.radius,
            radius: p.radius + (attack.shape === 'pounce' ? enemy.radius : attack.projectile?.radius ?? 0),
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
          if (!enemy.lungeHit && segmentDistanceSq(p.position.x, p.position.z, x, z, enemy.position.x, enemy.position.z)
            <= (p.radius + enemy.radius) ** 2) {
            enemy.lungeHit = true;
            damagePlayer(state, rollDamage(state, attack.damage.min, attack.damage.max) * enemy.damageMult, events, {
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
