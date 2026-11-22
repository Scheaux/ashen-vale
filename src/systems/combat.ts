import { angleDiff, angleLerp } from '../core/math';
import { getEnemy, type AttackDef } from '../content/enemies';
import { basicAttackFor, type SkillDef } from '../content/skills';
import type { EnemyState, GameState, SimEvent } from '../sim/state';
import { onEnemyDeath } from './loot';
import { cancelMove, setMoveTarget } from './movement';
import { reducePlayerDamage, scalePlayerDamage } from './stats';

/**
 * Centralized combat pipeline. All damage flows through damageEnemy/damagePlayer
 * so cooldowns, damage rolls and death cannot be duplicated across call sites.
 * Every outcome is reported through authoritative SimEvents.
 */

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
    events.push({ kind: 'death', targetKind: 'enemy', targetId: enemy.id, x: enemy.position.x, z: enemy.position.z });
    onEnemyDeath(state, enemy, events); // XP + loot from the central pipeline
  }
}

export function damagePlayer(state: GameState, amount: number, events: SimEvent[]): void {
  const p = state.player;
  if (p.hp <= 0) return;
  const dealt = Math.max(1, Math.round(reducePlayerDamage(state, amount)));
  p.hp = Math.max(0, p.hp - dealt);
  events.push({
    kind: 'damage',
    targetKind: 'player',
    targetId: 'player',
    amount: dealt,
    x: p.position.x,
    y: 2.1,
    z: p.position.z,
  });
  if (p.hp === 0) {
    events.push({ kind: 'death', targetKind: 'player', targetId: 'player', x: p.position.x, z: p.position.z });
  }
}

function findEnemy(state: GameState, id: string | null): EnemyState | null {
  if (!id) return null;
  return state.enemies.find((e) => e.id === id && !e.dead) ?? null;
}

/**
 * Player combat verb: pursue the attack target into range, face it, and
 * execute the class's basic attack on cooldown (melee arc or projectile).
 */
export function stepPlayerCombat(state: GameState, dt: number, events: SimEvent[]): void {
  const p = state.player;
  if (p.attackCooldown > 0) p.attackCooldown -= dt;
  if (p.hp <= 0) return;

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
  p.facing = angleLerp(p.facing, Math.atan2(dx, dz), Math.min(1, 14 * dt));

  if (dist > skill.range || p.attackCooldown > 0) return;

  p.attackCooldown = skill.cooldown;
  events.push({ kind: 'attack', sourceId: 'player', skillId: skill.id, x: p.position.x, z: p.position.z });

  if (skill.type === 'melee') {
    const halfArc = ((skill.arcDeg ?? 360) / 2) * (Math.PI / 180);
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      const ex = enemy.position.x - p.position.x;
      const ez = enemy.position.z - p.position.z;
      const d = Math.hypot(ex, ez);
      if (d > skill.range + enemy.radius) continue;
      if (Math.abs(angleDiff(p.facing, Math.atan2(ex, ez))) > halfArc) continue;
      damageEnemy(state, enemy, scalePlayerDamage(state, rollDamage(state, skill.damage.min, skill.damage.max)), events);
    }
  } else {
    spawnProjectile(state, skill, target.position);
  }
}

export function spawnProjectile(state: GameState, skill: SkillDef, aim: { x: number; z: number }): void {
  const p = state.player;
  const spec = skill.projectile;
  if (!spec) return;
  const dx = aim.x - p.position.x;
  const dz = aim.z - p.position.z;
  const dist = Math.max(0.001, Math.hypot(dx, dz));
  state.projectiles.push({
    id: `proj-${state.tick}-${state.projectiles.length}`,
    owner: 'player',
    skillId: skill.id,
    position: { x: p.position.x, z: p.position.z },
    y: 1.25,
    velocity: { x: (dx / dist) * spec.speed, z: (dz / dist) * spec.speed },
    damage: scalePlayerDamage(state, rollDamage(state, skill.damage.min, skill.damage.max)),
    radius: spec.radius,
    ttl: spec.ttl,
    color: skill.color,
  });
}

/** Enemy bolt: aimed at the player's position at strike time (travel = dodge window). */
export function spawnEnemyBolt(
  state: GameState,
  enemy: EnemyState,
  attack: AttackDef,
  aim: { x: number; z: number },
): void {
  const spec = attack.projectile;
  if (!spec) return;
  const dx = aim.x - enemy.position.x;
  const dz = aim.z - enemy.position.z;
  const dist = Math.max(0.001, Math.hypot(dx, dz));
  state.projectiles.push({
    id: `bolt-${state.tick}-${state.projectiles.length}`,
    owner: enemy.id,
    skillId: 'enemy-bolt',
    position: { x: enemy.position.x, z: enemy.position.z },
    y: 1.35,
    velocity: { x: (dx / dist) * spec.speed, z: (dz / dist) * spec.speed },
    damage: rollDamage(state, attack.damage.min, attack.damage.max) * enemy.damageMult,
    radius: spec.radius,
    ttl: spec.ttl,
    color: getEnemy(enemy.defId).eyeColor,
  });
}

/** Move projectiles, resolve contact damage (per owner team), expire on hit or timeout. */
export function stepProjectiles(state: GameState, dt: number, events: SimEvent[]): void {
  if (state.projectiles.length === 0) return;
  const remaining = [];
  for (const proj of state.projectiles) {
    proj.position.x += proj.velocity.x * dt;
    proj.position.z += proj.velocity.z * dt;
    proj.ttl -= dt;

    let consumed = false;
    if (proj.owner === 'player') {
      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        const dist = Math.hypot(enemy.position.x - proj.position.x, enemy.position.z - proj.position.z);
        if (dist > proj.radius + enemy.radius) continue;
        damageEnemy(state, enemy, proj.damage, events);
        consumed = true;
        break;
      }
    } else {
      const p = state.player;
      const dist = Math.hypot(p.position.x - proj.position.x, p.position.z - proj.position.z);
      if (p.hp > 0 && dist <= proj.radius + p.radius) {
        damagePlayer(state, proj.damage, events);
        consumed = true;
      }
    }
    if (!consumed && proj.ttl > 0) remaining.push(proj);
  }
  state.projectiles = remaining;
}
