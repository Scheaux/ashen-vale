import { createRng, range, chance, pick, type Rng } from '../core/rng';
import type {
  CircleCollider,
  EnemySpawn,
  EliteModifier,
  EnemyId,
  PropKind,
  PropPlacement,
  ZoneLayout,
} from './types';

/**
 * Deterministic zone population: the same seed always yields the same layout.
 * Renderers consume this layout for mesh placement; the sim consumes it for
 * colliders — one source of truth for both.
 */
export const ZONE_SEED = 20261122;

const PROP_MIN_SEPARATION = 3.2;
const CLEAR_RADIUS_AROUND_SPAWN = 7;

const KIND_WEIGHTS: Array<{ kind: PropKind; weight: number; collider: number }> = [
  { kind: 'rock', weight: 0.38, collider: 0.85 },
  { kind: 'deadTree', weight: 0.3, collider: 0.55 },
  { kind: 'pillar', weight: 0.18, collider: 0.75 },
  { kind: 'pillarBroken', weight: 0.14, collider: 0.9 },
];

function pickKind(rng: Rng): PropKind {
  const total = KIND_WEIGHTS.reduce((s, k) => s + k.weight, 0);
  let roll = rng() * total;
  for (const entry of KIND_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.kind;
  }
  return 'rock';
}

function colliderRadiusFor(kind: PropKind, scale: number): number {
  const entry = KIND_WEIGHTS.find((k) => k.kind === kind);
  return (entry?.collider ?? 0.8) * scale;
}

export function generateZoneLayout(seed: number = ZONE_SEED): ZoneLayout {
  const rng = createRng(seed);
  const bounds = { center: { x: 0, z: 0 }, radius: 42 };
  const spawn = { x: 0, z: 18 };
  // The boss arena anchors the far end of the zone, opposite the player spawn.
  const arena = { center: { x: 0, z: -31 }, radius: 8 };
  const props: PropPlacement[] = [];
  const colliders: CircleCollider[] = [];
  const enemySpawns: EnemySpawn[] = [];

  const targetCount = 95;
  let attempts = 0;
  while (props.length < targetCount && attempts < 2400) {
    attempts++;
    // Uniform disc sample.
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * (bounds.radius - 2);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    if (Math.hypot(x - spawn.x, z - spawn.z) < CLEAR_RADIUS_AROUND_SPAWN) continue;
    if (Math.hypot(x - arena.center.x, z - arena.center.z) < arena.radius + 1) continue;

    const kind = pickKind(rng);
    const scale = range(rng, 0.75, 1.9);
    const radius = colliderRadiusFor(kind, scale);

    // Keep props from overlapping each other.
    let blocked = false;
    for (const other of props) {
      const otherRadius = colliderRadiusFor(other.kind, other.scale);
      if (Math.hypot(x - other.x, z - other.z) < radius + otherRadius + PROP_MIN_SEPARATION * 0.35) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    props.push({
      kind,
      x,
      z,
      rotation: rng() * Math.PI * 2,
      scale,
      tilt: kind === 'pillarBroken' ? range(rng, 0.05, 0.18) : chance(rng, 0.1) ? range(rng, 0.02, 0.06) : 0,
    });
    colliders.push({ id: `prop-${props.length}`, x, z, radius });
  }

  // Arena pillar ring: a ruined colonnade marking the boss arena edge.
  const ARENA_PILLARS = 11;
  for (let i = 0; i < ARENA_PILLARS; i++) {
    const angle = (i / ARENA_PILLARS) * Math.PI * 2 + range(rng, -0.08, 0.08);
    const x = arena.center.x + Math.cos(angle) * (arena.radius + 1.8);
    const z = arena.center.z + Math.sin(angle) * (arena.radius + 1.8);
    if (!clearOfPropsRaw(props, x, z, 1.2, colliderRadiusFor)) continue;
    const scale = range(rng, 1.15, 1.7);
    const radius = colliderRadiusFor('pillar', scale);
    props.push({
      kind: 'pillar',
      x,
      z,
      rotation: angle + Math.PI / 2,
      scale,
      tilt: chance(rng, 0.35) ? range(rng, 0.03, 0.1) : 0,
    });
    colliders.push({ id: `arena-pillar-${i}`, x, z, radius });
  }

  // Enemy camps (slice 7 objectives): three seeded camps between the player
  // spawn and the arena. Archetypes mix by weight; ~1 in 6 spawns is an elite
  // with 1-2 modifiers and a small retinue, all inside the same camp.
  const CAMP_COUNT = 3;
  const archetypeWeights: Array<{ id: EnemyId; weight: number }> = [
    { id: 'ashen-husk', weight: 0.45 },
    { id: 'cinder-cultist', weight: 0.3 },
    { id: 'mire-skitterer', weight: 0.25 },
  ];
  const elitePool: EliteModifier[] = ['vital', 'savage', 'swift'];

  const pickArchetype = (): EnemyId => {
    let roll = rng() * archetypeWeights.reduce((s, a) => s + a.weight, 0);
    for (const a of archetypeWeights) {
      roll -= a.weight;
      if (roll <= 0) return a.id;
    }
    return 'ashen-husk';
  };

  const clearOfProps = (x: number, z: number, margin: number): boolean =>
    clearOfPropsRaw(props, x, z, margin, colliderRadiusFor);

  const placeable = (x: number, z: number): boolean => {
    if (Math.hypot(x - spawn.x, z - spawn.z) < 15) return false;
    if (Math.hypot(x - arena.center.x, z - arena.center.z) < arena.radius + 6) return false;
    if (Math.hypot(x - bounds.center.x, z - bounds.center.z) > bounds.radius - 2) return false;
    return clearOfProps(x, z, 1.4);
  };

  const spawnClear = (x: number, z: number): boolean =>
    !enemySpawns.some((other) => Math.hypot(x - other.x, z - other.z) < 2.4);

  for (let camp = 0; camp < CAMP_COUNT; camp++) {
    // Camp centre: seeded, spread around the moor, clear of spawn and arena.
    let cx = 0;
    let cz = 0;
    for (let attempt = 0; attempt < 60; attempt++) {
      const angle = (camp / CAMP_COUNT) * Math.PI * 2 - Math.PI / 2 + (rng() - 0.5) * 0.9;
      const dist = 15 + rng() * 12;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      if (!placeable(x, z)) continue;
      cx = x;
      cz = z;
      break;
    }

    const count = 3 + (chance(rng, 0.5) ? 1 : 0);
    for (let member = 0; member < count; member++) {
      // Members cluster around the camp centre.
      let x = cx;
      let z = cz;
      for (let attempt = 0; attempt < 24; attempt++) {
        const mAngle = rng() * Math.PI * 2;
        const mDist = range(rng, 1.8, 4.4);
        const px = cx + Math.cos(mAngle) * mDist;
        const pz = cz + Math.sin(mAngle) * mDist;
        if (!placeable(px, pz) || !spawnClear(px, pz)) continue;
        x = px;
        z = pz;
        break;
      }

      let elite: EliteModifier[] = [];
      if (member === 0 && chance(rng, 0.6)) {
        elite = [pick(rng, elitePool)];
        if (chance(rng, 0.4)) {
          const second = pick(rng, elitePool.filter((m) => m !== elite[0]));
          elite.push(second);
        }
      }
      enemySpawns.push({ enemyId: pickArchetype(), x, z, elite, camp });

      // Elite retinue: 2-3 nearby minions, same camp.
      if (elite.length > 0) {
        const minions = 2 + (chance(rng, 0.5) ? 1 : 0);
        for (let m = 0; m < minions; m++) {
          for (let attempt = 0; attempt < 12; attempt++) {
            const mAngle = rng() * Math.PI * 2;
            const mDist = range(rng, 2.2, 3.6);
            const mx = x + Math.cos(mAngle) * mDist;
            const mz = z + Math.sin(mAngle) * mDist;
            if (!placeable(mx, mz) || !spawnClear(mx, mz)) continue;
            enemySpawns.push({
              enemyId: pickArchetype(),
              x: mx,
              z: mz,
              elite: [],
              camp,
            });
            break;
          }
        }
      }
    }
  }

  return {
    seed,
    name: 'The Ashen Moor',
    bounds,
    spawn,
    colliders,
    props,
    enemySpawns,
    arena,
    bossSpawn: { enemyId: 'ashen-warden', x: arena.center.x, z: arena.center.z, elite: [], camp: -1 },
  };
}

function clearOfPropsRaw(
  props: PropPlacement[],
  x: number,
  z: number,
  margin: number,
  radiusFor: (kind: PropKind, scale: number) => number,
): boolean {
  for (const other of props) {
    const otherRadius = radiusFor(other.kind, other.scale);
    if (Math.hypot(x - other.x, z - other.z) < otherRadius + margin) return false;
  }
  return true;
}
