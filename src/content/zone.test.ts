import { describe, expect, it } from 'vitest';
import { CLASSES, getClass } from './classes';
import { generateZoneLayout } from './zone';

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

describe('generateZoneLayout', () => {
  it('is deterministic per seed', () => {
    const a = generateZoneLayout(123);
    const b = generateZoneLayout(123);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateZoneLayout(456);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('populates the zone with props and colliders', () => {
    const layout = generateZoneLayout();
    expect(layout.props.length).toBeGreaterThan(40);
    expect(layout.colliders.length).toBe(layout.props.length);
  });

  it('keeps props inside the bounds and clear of the spawn', () => {
    const layout = generateZoneLayout();
    for (const p of layout.props) {
      const dist = Math.hypot(p.x - layout.bounds.center.x, p.z - layout.bounds.center.z);
      expect(dist).toBeLessThanOrEqual(layout.bounds.radius);
      const spawnDist = Math.hypot(p.x - layout.spawn.x, p.z - layout.spawn.z);
      expect(spawnDist).toBeGreaterThan(5);
    }
  });

  it('spawns enemy camps clear of the player spawn and inside the bounds', () => {
    const layout = generateZoneLayout();
    expect(layout.enemySpawns.length).toBeGreaterThanOrEqual(10);
    for (const e of layout.enemySpawns) {
      const dist = Math.hypot(e.x - layout.bounds.center.x, e.z - layout.bounds.center.z);
      expect(dist).toBeLessThanOrEqual(layout.bounds.radius);
      const spawnDist = Math.hypot(e.x - layout.spawn.x, e.z - layout.spawn.z);
      expect(spawnDist).toBeGreaterThan(10);
    }
  });

  it('mixes archetypes and creates elite packs with retinues', () => {
    const layout = generateZoneLayout();
    const archetypes = new Set(layout.enemySpawns.map((e) => e.enemyId));
    expect(archetypes.size).toBeGreaterThanOrEqual(2);

    const elites = layout.enemySpawns.filter((e) => e.elite.length > 0);
    expect(elites.length).toBeGreaterThanOrEqual(1);
    for (const elite of elites) {
      expect(elite.elite.length).toBeLessThanOrEqual(2);
      expect(new Set(elite.elite).size).toBe(elite.elite.length); // no duplicate modifiers
      // Retinue: at least two other spawns near the elite.
      const nearby = layout.enemySpawns.filter(
        (o) => o !== elite && Math.hypot(o.x - elite.x, o.z - elite.z) < 4.5,
      );
      expect(nearby.length).toBeGreaterThanOrEqual(2);
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
