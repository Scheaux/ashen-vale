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

  // Enemy camps: seeded positions well clear of the player spawn and props.
  // Archetypes mix by weight; ~1 in 6 spawns is an elite with 1-2 modifiers
  // and a small retinue.
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

  const clearOfProps = (x: number, z: number, margin: number): boolean => {
    for (const other of props) {
      const otherRadius = colliderRadiusFor(other.kind, other.scale);
      if (Math.hypot(x - other.x, z - other.z) < otherRadius + margin) return false;
    }
    return true;
  };

  let enemyAttempts = 0;
  while (enemySpawns.length < 12 && enemyAttempts < 900) {
    enemyAttempts++;
    const angle = rng() * Math.PI * 2;
    const dist = 16 + rng() * (bounds.radius - 20);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 15) continue;
    if (!clearOfProps(x, z, 1.4)) continue;

    let blocked = false;
    for (const other of enemySpawns) {
      if (Math.hypot(x - other.x, z - other.z) < 2.4) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    let elite: EliteModifier[] = [];
    if (chance(rng, 0.16)) {
      elite = [pick(rng, elitePool)];
      if (chance(rng, 0.4)) {
        const second = pick(rng, elitePool.filter((m) => m !== elite[0]));
        elite.push(second);
      }
    }
    enemySpawns.push({ enemyId: pickArchetype(), x, z, elite });

    // Elite retinue: 2-3 nearby minions.
    if (elite.length > 0) {
      const minions = 2 + (chance(rng, 0.5) ? 1 : 0);
      for (let m = 0; m < minions; m++) {
        const mAngle = rng() * Math.PI * 2;
        const mDist = range(rng, 2.2, 3.6);
        enemySpawns.push({
          enemyId: pickArchetype(),
          x: x + Math.cos(mAngle) * mDist,
          z: z + Math.sin(mAngle) * mDist,
          elite: [],
        });
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
  };
}
