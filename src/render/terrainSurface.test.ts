import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
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
    const { geometry, positions } = build(20, 20, (x) => x * 0.25);
    const surface = new TerrainSurface(positions, 20, 20);
    const oldHeight = surface.heightAt(4, 4);

    const { mesh, surface: rebuilt } = createTerrain('ashen-moor', surface, 30);

    expect(rebuilt).toBe(surface);
    expect(mesh.geometry).not.toBe(geometry);
    // The 30-unit/128-segment moor rewrite is flat at the centre, unlike the
    // old 20-unit/20-segment slope.
    expect(surface.heightAt(4, 4)).not.toBeCloseTo(oldHeight, 6);
    expect(Number.isFinite(surface.heightAt(14.9, 14.9))).toBe(true);
    expect(surface.normalAt(4, 4).length()).toBeCloseTo(1, 6);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    geometry.dispose();
  });
});
