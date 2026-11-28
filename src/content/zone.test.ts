import { describe, expect, it } from 'vitest';
import { CLASSES, getClass } from './classes';
import { projectToCorridor } from './corridor';
import { createGameState } from '../sim/state';
import { activeCampsForZone } from './zones';
import { generateZoneLayout, MOOR_ARENA, MOOR_CORRIDOR, MOOR_PORTAL } from './zone';

describe('class definitions', () => {
  it('defines three unique playable classes', () => {
    expect(CLASSES).toHaveLength(3);
    const ids = new Set(CLASSES.map((c) => c.id));
    expect(ids.size).toBe(3);
  });

  it('has sane values', () => {
    for (const def of CLASSES) {
      expect(def.speed).toBeGreaterThan(0);
      expect(def.color).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(10);
    }
    expect(getClass('witch').id).toBe('witch');
    expect(() => getClass('nobody' as never)).toThrow();
  });
});

interface CampSummary {
  index: number;
  x: number;
  z: number;
  count: number;
  offset: number;
  side: number;
}

/** Recover each camp's centre/side from its members for layout assertions. */
function campSummaries(enemySpawns: ReturnType<typeof generateZoneLayout>['enemySpawns']): CampSummary[] {
  const summaries: CampSummary[] = [];
  for (let index = 0; index < 16; index++) {
    const members = enemySpawns.filter((spawn) => spawn.camp === index);
    expect(members.length).toBeGreaterThanOrEqual(3);
    expect(members.length).toBeLessThanOrEqual(5);
    const x = members.reduce((sum, spawn) => sum + spawn.x, 0) / members.length;
    const z = members.reduce((sum, spawn) => sum + spawn.z, 0) / members.length;
    const projection = projectToCorridor(MOOR_CORRIDOR, x, z);
    const sample = MOOR_CORRIDOR.points[projection.segment];
    const next = MOOR_CORRIDOR.points[projection.segment + 1];
    const cross = (x - projection.x) * (next.z - sample.z) -
      (z - projection.z) * (next.x - sample.x);
    summaries.push({
      index,
      x,
      z,
      count: members.length,
      offset: projection.distance,
      side: Math.sign(cross),
    });
  }
  return summaries;
}

describe('generateZoneLayout', () => {
  it('is deterministic per seed', () => {
    const a = generateZoneLayout(123);
    const b = generateZoneLayout(123);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateZoneLayout(456);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('defines the linear moor corridor, end clearing and portal', () => {
    const layout = generateZoneLayout();
    expect(layout.corridor).toBeDefined();
    expect(layout.corridor!.points).toEqual([
      { x: 0, z: 74 },
      { x: 12, z: 10 },
      { x: -8, z: -40 },
      { x: 0, z: -72 },
    ]);
    expect(layout.corridor!.radius).toBe(29);
    expect(layout.spawn).toEqual({ x: 0, z: 74 });
    expect(layout.arena).toEqual({ center: { x: 0, z: -72 }, radius: 8 });
    expect(layout.arena).toEqual(MOOR_ARENA);
    expect(layout.portal).toEqual(MOOR_PORTAL);
    expect(layout.portal).toEqual({ x: 0, z: -80 });
    expect(layout.bossSpawn).toMatchObject({ enemyId: 'ashen-warden', x: 0, z: -72, camp: -1 });
    expect(layout.bounds.radius).toBe(90);
  });

  it('places exactly 16 indexed camps on alternating sides of the route', () => {
    const layout = generateZoneLayout();
    const camps = campSummaries(layout.enemySpawns);
    expect(camps.map((camp) => camp.index)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(camps.reduce((sum, camp) => sum + camp.count, 0)).toBe(layout.enemySpawns.length);

    for (let i = 0; i < camps.length; i++) {
      const camp = camps[i];
      // Members cluster around the seeded camp centre, so the recovered
      // offset is slightly inside the authored 10-14 band.
      expect(camp.offset).toBeGreaterThan(8);
      expect(camp.offset).toBeLessThan(16);
      expect(camp.side).toBe(i % 2 === 0 ? 1 : -1);
    }

    // Camp discs never overlap, and every spawn is inside the corridor.
    for (let i = 0; i < camps.length; i++) {
      for (let j = i + 1; j < camps.length; j++) {
        const distance = Math.hypot(camps[i].x - camps[j].x, camps[i].z - camps[j].z);
        expect(distance).toBeGreaterThan(12);
      }
    }
    for (const spawn of layout.enemySpawns) {
      expect(projectToCorridor(layout.corridor!, spawn.x, spawn.z).distance)
        .toBeLessThanOrEqual(layout.corridor!.radius - 1);
    }
  });

  it('spawns 3-5 archetype-mixed enemies per camp with 50% elite odds', () => {
    const layout = generateZoneLayout();
    const archetypes = new Set(layout.enemySpawns.map((spawn) => spawn.enemyId));
    expect(archetypes.size).toBeGreaterThanOrEqual(2);

    const elites = layout.enemySpawns.filter((spawn) => spawn.elite.length > 0);
    expect(elites.length).toBeGreaterThanOrEqual(4);
    expect(elites.length).toBeLessThanOrEqual(12);
    const eliteCamps = new Set<number>();
    for (const elite of elites) {
      expect(elite.camp).toBeGreaterThanOrEqual(0);
      expect(eliteCamps.has(elite.camp!)).toBe(false); // one elite per camp at most
      eliteCamps.add(elite.camp!);
      expect(elite.elite.length).toBeLessThanOrEqual(2);
      expect(new Set(elite.elite).size).toBe(elite.elite.length);
    }
  });

  it('populates the corridor edges and camp pockets with four prop kinds', () => {
    const layout = generateZoneLayout();
    expect(layout.props.length).toBeGreaterThanOrEqual(120);
    expect(layout.colliders.length).toBe(layout.props.length);
    expect(new Set(layout.props.map((prop) => prop.kind))).toEqual(
      new Set(['rock', 'deadTree', 'pillar', 'pillarBroken']),
    );

    const camps = campSummaries(layout.enemySpawns);
    for (const prop of layout.props) {
      const corridorDistance = projectToCorridor(layout.corridor!, prop.x, prop.z).distance;
      expect(corridorDistance).toBeLessThanOrEqual(layout.corridor!.radius - 1);
      // The centerline stays a clear walking lane.
      expect(corridorDistance).toBeGreaterThan(5);
      expect(Math.hypot(prop.x - layout.bounds.center.x, prop.z - layout.bounds.center.z))
        .toBeLessThanOrEqual(layout.bounds.radius);
      expect(Math.hypot(prop.x - layout.spawn.x, prop.z - layout.spawn.z)).toBeGreaterThan(5);
      // Camp discs and the Warden's end clearing stay clear.
      for (const camp of camps) {
        expect(Math.hypot(prop.x - camp.x, prop.z - camp.z)).toBeGreaterThan(6);
      }
      expect(Math.hypot(prop.x - layout.arena.center.x, prop.z - layout.arena.center.z))
        .toBeGreaterThan(layout.arena.radius);
      expect(Math.hypot(prop.x - layout.portal!.x, prop.z - layout.portal!.z)).toBeGreaterThan(4);
    }
  });

  it('spawns enemy camps clear of the player spawn and inside the bounds', () => {
    const layout = generateZoneLayout();
    expect(layout.enemySpawns.length).toBeGreaterThanOrEqual(48);
    for (const e of layout.enemySpawns) {
      const dist = Math.hypot(e.x - layout.bounds.center.x, e.z - layout.bounds.center.z);
      expect(dist).toBeLessThanOrEqual(layout.bounds.radius);
      const spawnDist = Math.hypot(e.x - layout.spawn.x, e.z - layout.spawn.z);
      expect(spawnDist).toBeGreaterThan(10);
    }
  });

  it('does not overlap prop colliders', () => {
    const layout = generateZoneLayout();
    for (let i = 0; i < layout.colliders.length; i++) {
      for (let j = i + 1; j < layout.colliders.length; j++) {
        const a = layout.colliders[i];
        const b = layout.colliders[j];
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        expect(dist).toBeGreaterThan(Math.max(a.radius, b.radius));
      }
    }
  });
});

describe('moor bootstrap', () => {
  it('carries the corridor, portal and 16 active camps into game state', () => {
    const layout = generateZoneLayout();
    const state = createGameState(getClass('marauder'), layout);

    expect(state.corridor).toEqual(layout.corridor);
    expect(state.portal).toEqual({ x: 0, z: -80 });
    expect(state.corridor).not.toBe(layout.corridor);
    expect(state.objectives.campsTotal).toBe(16);
    expect(state.objectives.campCleared).toHaveLength(16);
    expect(state.objectives.campCleared.every((cleared) => !cleared)).toBe(true);
    expect(activeCampsForZone('ashen-moor')).toBe(16);
    expect(state.bossTrigger).toBe('end');
    expect(state.finalZone).toBe('ashen-moor');
  });
});
