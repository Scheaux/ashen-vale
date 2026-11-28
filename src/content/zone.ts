import { chance, createRng, pick, range, type Rng } from '../core/rng';
import {
  corridorSample,
  corridorSegmentLength,
  distanceToCorridor,
  type CorridorSample,
} from './corridor';
import type {
  CircleCollider,
  EnemySpawn,
  EliteModifier,
  EnemyId,
  PropKind,
  PropPlacement,
  Vec2,
  ZoneCorridor,
  ZoneLayout,
} from './types';

/**
 * Deterministic zone population: the same seed always yields the same layout.
 * Renderers consume this layout for mesh placement; the sim consumes it for
 * colliders — one source of truth for both.
 *
 * The moor is one long bog corridor rather than a disc. Camps line the route,
 * the Warden waits in the end clearing, and the sealed portal sits behind him.
 */
export const ZONE_SEED = 20261122;

export const MOOR_CORRIDOR: ZoneCorridor = {
  points: [
    { x: 0, z: 74 },
    { x: 12, z: 10 },
    { x: -8, z: -40 },
    { x: 0, z: -72 },
  ],
  radius: 29,
};

export const MOOR_ARENA = { center: { x: 0, z: -72 }, radius: 8 };
export const MOOR_PORTAL: Vec2 = { x: 0, z: -80 };

const PROP_MIN_SEPARATION = 0.8;
const CLEAR_RADIUS_AROUND_SPAWN = 10;
const CAMP_RADIUS = 6;
/** The last leg is half the length of the first two, so it holds five camps. */
const CAMP_SEGMENT_COUNTS: readonly number[] = [6, 5, 5];
const PROP_TARGET = 150;

const KIND_WEIGHTS: Array<{ kind: PropKind; weight: number; collider: number }> = [
  { kind: 'rock', weight: 0.38, collider: 0.85 },
  { kind: 'deadTree', weight: 0.3, collider: 0.55 },
  { kind: 'pillar', weight: 0.18, collider: 0.75 },
  { kind: 'pillarBroken', weight: 0.14, collider: 0.9 },
];

const ARCHETYPE_WEIGHTS: Array<{ id: EnemyId; weight: number }> = [
  { id: 'ashen-husk', weight: 0.45 },
  { id: 'cinder-cultist', weight: 0.3 },
  { id: 'mire-skitterer', weight: 0.25 },
];

const ELITE_POOL: EliteModifier[] = ['vital', 'savage', 'swift', 'volatile'];

interface CampDef extends Vec2 {
  index: number;
  radius: number;
  segment: number;
  side: number;
  offset: number;
}

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

function pickArchetype(rng: Rng): EnemyId {
  let roll = rng() * ARCHETYPE_WEIGHTS.reduce((s, a) => s + a.weight, 0);
  for (const a of ARCHETYPE_WEIGHTS) {
    roll -= a.weight;
    if (roll <= 0) return a.id;
  }
  return 'ashen-husk';
}

/**
 * Place 16 camp centres on alternating sides of the corridor. Camps use their
 * own seeded stream, so changing camp content never reshuffles scenery.
 */
function placeCamps(corridor: ZoneCorridor, rng: Rng): CampDef[] {
  const camps: CampDef[] = [];
  const lengths = corridor.points.slice(0, -1).map((_, segment) => corridorSegmentLength(corridor, segment));
  const lastSegment = corridor.points.length - 2;
  let index = 0;

  for (let segment = 0; segment < CAMP_SEGMENT_COUNTS.length; segment++) {
    const count = CAMP_SEGMENT_COUNTS[segment];
    const length = lengths[segment] ?? 1;
    const last = segment === lastSegment;
    // The first camp stays a full clearing away from the spawn; the middle
    // stretch backs off the junction with the shorter final leg.
    const start = segment === 0
      ? Math.min(0.42, 20 / Math.max(1, length))
      : last ? 0.1 : 0.12;
    let end = segment === 1 ? 0.88 : 0.94;
    if (last) {
      // Keep the final camp disc out of the Warden's end clearing. The last
      // camp sits at the widest allowed offset, so it can approach the end.
      const clearance = CAMP_RADIUS + MOOR_ARENA.radius + 0.5;
      const lastOffset = 14;
      const along = Math.sqrt(Math.max(0, clearance * clearance - lastOffset * lastOffset));
      end = 1 - along / Math.max(1, length);
    }
    end = Math.max(start + 0.02, Math.min(0.98, end));
    const spacing = count > 1 ? (end - start) / (count - 1) : 0;

    for (let member = 0; member < count; member++) {
      const baseT = count > 1 ? start + spacing * member : (start + end) / 2;
      const t = Math.max(0, Math.min(1, baseT + (rng() - 0.5) * spacing * 0.1));
      const offset = last
        ? (member === count - 1 ? 14 : range(rng, 12.5, 14))
        : range(rng, 10, 14);
      const sample: CorridorSample = corridorSample(corridor, segment, t);
      const side = index % 2 === 0 ? 1 : -1;
      camps.push({
        index,
        x: sample.x + sample.normalX * offset * side,
        z: sample.z + sample.normalZ * offset * side,
        radius: CAMP_RADIUS,
        segment,
        side,
        offset,
      });
      index++;
    }
  }

  return camps;
}

export function generateZoneLayout(seed: number = ZONE_SEED): ZoneLayout {
  const campRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const enemyRng = createRng((seed ^ 0x7f4a7c15) >>> 0);
  const propRng = createRng((seed ^ 0x85ebca6b) >>> 0);

  const bounds = { center: { x: 0, z: 0 }, radius: 90 };
  const spawn = { x: 0, z: 74 };
  const arena = { center: { ...MOOR_ARENA.center }, radius: MOOR_ARENA.radius };
  const portal = { ...MOOR_PORTAL };
  const corridor: ZoneCorridor = {
    points: MOOR_CORRIDOR.points.map((point) => ({ ...point })),
    radius: MOOR_CORRIDOR.radius,
  };

  const camps = placeCamps(corridor, campRng);
  const props: PropPlacement[] = [];
  const colliders: CircleCollider[] = [];
  const enemySpawns: EnemySpawn[] = [];

  const spawnClear = (x: number, z: number, margin = 1.8): boolean =>
    !enemySpawns.some((other) => Math.hypot(x - other.x, z - other.z) < margin);

  const pointClearOfCamps = (x: number, z: number, margin: number): boolean =>
    camps.every((camp) => Math.hypot(x - camp.x, z - camp.z) >= camp.radius + margin);

  // Enemies cluster inside each camp disc. A camp has 3-5 members and a coin
  // flip decides whether its leader is an elite; the count includes the elite.
  for (const camp of camps) {
    const count = 3 + Math.floor(enemyRng() * 3);
    const hasElite = chance(enemyRng, 0.5);
    let elite: EliteModifier[] = [];
    if (hasElite) {
      elite = [pick(enemyRng, ELITE_POOL)];
      if (chance(enemyRng, 0.4)) {
        const second = pick(enemyRng, ELITE_POOL.filter((modifier) => modifier !== elite[0]));
        elite.push(second);
      }
    }

    for (let member = 0; member < count; member++) {
      let x = camp.x;
      let z = camp.z;
      for (let attempt = 0; attempt < 40; attempt++) {
        const angle = enemyRng() * Math.PI * 2;
        const dist = range(enemyRng, 1.2, 4.4);
        const px = camp.x + Math.cos(angle) * dist;
        const pz = camp.z + Math.sin(angle) * dist;
        if (!spawnClear(px, pz)) continue;
        if (distanceToCorridor(corridor, px, pz) > corridor.radius - 1.2) continue;
        if (Math.hypot(px - spawn.x, pz - spawn.z) < CLEAR_RADIUS_AROUND_SPAWN + 2) continue;
        if (Math.hypot(px - arena.center.x, pz - arena.center.z) < arena.radius + 1.5) continue;
        x = px;
        z = pz;
        break;
      }
      enemySpawns.push({
        enemyId: pickArchetype(enemyRng),
        x,
        z,
        elite: member === 0 ? elite : [],
        camp: camp.index,
      });
    }
  }

  // Props own an independent stream. Most line the corridor edges; a quarter
  // ring the camp pockets just outside each clearing. The centerline, spawn,
  // camp discs, end clearing and portal stay clear.
  const segmentLengths = corridor.points.slice(0, -1).map((_, segment) => corridorSegmentLength(corridor, segment));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const pickSegment = (rng: Rng): number => {
    let roll = rng() * totalLength;
    for (let segment = 0; segment < segmentLengths.length; segment++) {
      roll -= segmentLengths[segment];
      if (roll <= 0) return segment;
    }
    return Math.max(0, segmentLengths.length - 1);
  };

  const propBlocked = (x: number, z: number, radius: number): boolean => {
    const corridorDistance = distanceToCorridor(corridor, x, z);
    if (corridorDistance > corridor.radius - 1.2) return true;
    if (corridorDistance < 5.5) return true;
    if (Math.hypot(x, z) > bounds.radius - 2) return true;
    if (Math.hypot(x - spawn.x, z - spawn.z) < CLEAR_RADIUS_AROUND_SPAWN) return true;
    if (Math.hypot(x - arena.center.x, z - arena.center.z) < arena.radius + 3) return true;
    if (Math.hypot(x - portal.x, z - portal.z) < 5) return true;
    if (!pointClearOfCamps(x, z, 2)) return true;
    for (const other of props) {
      const otherRadius = colliderRadiusFor(other.kind, other.scale);
      if (Math.hypot(x - other.x, z - other.z) < radius + otherRadius + PROP_MIN_SEPARATION) return true;
    }
    return false;
  };

  let attempts = 0;
  while (props.length < PROP_TARGET && attempts < 9000) {
    attempts++;
    let x = 0;
    let z = 0;
    if (propRng() < 0.25 && camps.length > 0) {
      const camp = pick(propRng, camps);
      const angle = propRng() * Math.PI * 2;
      const dist = range(propRng, camp.radius + 2, camp.radius + 5);
      x = camp.x + Math.cos(angle) * dist;
      z = camp.z + Math.sin(angle) * dist;
    } else {
      const segment = pickSegment(propRng);
      const sample = corridorSample(corridor, segment, propRng());
      const side = propRng() < 0.5 ? -1 : 1;
      const lateral = propRng() < 0.72
        ? range(propRng, corridor.radius * 0.72, corridor.radius - 1.5)
        : range(propRng, 6.5, corridor.radius * 0.6);
      x = sample.x + sample.normalX * lateral * side;
      z = sample.z + sample.normalZ * lateral * side;
    }

    const kind = pickKind(propRng);
    const scale = range(propRng, 0.75, 1.9);
    const radius = colliderRadiusFor(kind, scale);
    if (propBlocked(x, z, radius)) continue;

    props.push({
      kind,
      x,
      z,
      rotation: propRng() * Math.PI * 2,
      scale,
      tilt: kind === 'pillarBroken' ? range(propRng, 0.05, 0.18) : chance(propRng, 0.1) ? range(propRng, 0.02, 0.06) : 0,
    });
    colliders.push({ id: `prop-${props.length}`, x, z, radius });
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
    corridor,
    portal,
  };
}
