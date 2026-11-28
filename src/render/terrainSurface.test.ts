import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { distanceToCorridor } from '../content/corridor';
import { MOOR_CORRIDOR } from '../content/zone';
import { createTerrain } from './terrain';
import { TerrainSurface } from './terrainSurface';

// createTerrain builds procedural canvas textures; keep this contract test
// headless with cheap texture stand-ins.
vi.mock('./materials', async () => {
  const three = await import('three');
  return {
    detailNormal: () => ({ map: new three.Texture(), scale: new three.Vector2(0.55, 0.55) }),
  };
});
vi.mock('./textures', async () => {
  const three = await import('three');
  return { createGroundTexture: () => new three.Texture() };
});

function build(size: number, segments: number, height: (x: number, z: number) => number) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, height(positions.getX(i), positions.getZ(i)));
  }
  return { geometry, positions };
}

describe('TerrainSurface', () => {
  it('returns a normalized up normal on flat ground', () => {
    const { geometry, positions } = build(20, 20, () => 0);
    const surface = new TerrainSurface(positions, 20, 20);

    const normal = surface.normalAt(3, -4);

    expect(normal.length()).toBeCloseTo(1, 6);
    expect(normal.x).toBeCloseTo(0, 6);
    expect(normal.y).toBeCloseTo(1, 6);
    expect(normal.z).toBeCloseTo(0, 6);
    geometry.dispose();
  });

  it('derives a tilted normal and accepts a target vector', () => {
    const { geometry, positions } = build(20, 20, (x) => x * 0.5);
    const surface = new TerrainSurface(positions, 20, 20);
    const target = new THREE.Vector3();

    const normal = surface.normalAt(1.25, 2.5, target);

    expect(normal).toBe(target);
    expect(normal.length()).toBeCloseTo(1, 6);
    // Surface y = 0.5x: normal = normalize(-0.5, 1, 0).
    expect(normal.x).toBeCloseTo(-0.5 / Math.sqrt(1.25), 5);
    expect(normal.y).toBeCloseTo(1 / Math.sqrt(1.25), 5);
    expect(normal.z).toBeCloseTo(0, 6);
    geometry.dispose();
  });

  it('rewrites its source in place for a remount', () => {
    const flat = build(20, 20, () => 0);
    const surface = new TerrainSurface(flat.positions, 20, 20);
    expect(surface.heightAt(2, 2)).toBeCloseTo(0, 6);

    const slope = build(20, 20, (x) => x * 0.25);
    surface.setSource(slope.positions, 20, 20);

    expect(surface.heightAt(2, 2)).toBeCloseTo(0.5, 6);
    expect(surface.normalAt(2, 2).x).toBeLessThan(0);
    flat.geometry.dispose();
    slope.geometry.dispose();
  });

  it('reuses the surface when createTerrain rebuilds with a different grid size', () => {
    // Start from a flat 20-unit/20-segment grid. If setSource only replaced
    // `position` and left step/min/row/segments stale, the new grid would still
    // be sampled with the old 20x20 indexing and clamp to a zero-height vertex.
    const { geometry, positions } = build(20, 20, () => 0);
    const surface = new TerrainSurface(positions, 20, 20);
    expect(surface.heightAt(14.9, 14.9)).toBeCloseTo(0, 6);

    const { mesh, surface: rebuilt } = createTerrain('ashen-moor', surface, 30);

    expect(rebuilt).toBe(surface);
    expect(mesh.geometry).not.toBe(geometry);
    // Known values from the rebuilt 30-unit/128-segment moor grid. These are
    // non-zero near the boundary and would be 0 under stale 20x20 indexing.
    expect(surface.heightAt(14.9, 14.9)).toBeCloseTo(0.00046036, 5);
    expect(surface.heightAt(-14.9, 14.9)).toBeCloseTo(0.01503875, 5);

    // A non-up normal at the first sample also proves the rewritten step/min/
    // row/segments are being used, not just the new position attribute.
    const normal = surface.normalAt(14.9, 14.9);
    expect(normal.length()).toBeCloseTo(1, 6);
    expect(normal.y).toBeLessThan(0.9999999);
    expect(Math.abs(normal.x)).toBeGreaterThan(1e-4);
    expect(Math.abs(normal.z)).toBeGreaterThan(1e-6);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    geometry.dispose();
  });

  it('holds the bog corridor flat and starts hills outside the band', () => {
    const { mesh, surface } = createTerrain('ashen-moor');
    const corridor = MOOR_CORRIDOR;

    // The centerline stays effectively flat, and the bog undulation inside
    // the band stays gentle enough for camps and the portal to sit on it.
    for (const point of corridor.points) {
      expect(Math.abs(surface.heightAt(point.x, point.z))).toBeLessThan(0.02);
    }
    for (const t of [0.15, 0.5, 0.85]) {
      const point = corridor.points[0];
      const next = corridor.points[1];
      const x = point.x + (next.x - point.x) * t;
      const z = point.z + (next.z - point.z) * t;
      const dx = next.x - point.x;
      const dz = next.z - point.z;
      const length = Math.hypot(dx, dz);
      const nx = dz / length;
      const nz = -dx / length;
      for (const offset of [10, 20, 26]) {
        expect(Math.abs(surface.heightAt(x + nx * offset, z + nz * offset))).toBeLessThan(0.35);
      }
    }

    // Hills only exist well outside the corridor; find a clear high sample.
    let maxOutside = -Infinity;
    for (let x = -110; x <= 110; x += 10) {
      for (let z = -110; z <= 110; z += 10) {
        if (distanceToCorridor(corridor, x, z) <= corridor.radius + 28) continue;
        maxOutside = Math.max(maxOutside, surface.heightAt(x, z));
      }
    }
    expect(maxOutside).toBeGreaterThan(2);

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
