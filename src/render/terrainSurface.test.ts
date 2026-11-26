import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TerrainSurface } from './terrainSurface';

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
});
