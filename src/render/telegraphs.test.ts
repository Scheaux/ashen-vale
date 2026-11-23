import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/state';
import { TerrainSurface, WARNING_CLEARANCE } from './terrainSurface';
import { warningFootprints } from './telegraphs';

function unevenGround() {
  const geometry = new THREE.PlaneGeometry(42, 42, 42, 42);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, Math.sin(positions.getX(i) * 1.1) * Math.cos(positions.getZ(i) * 0.8) * 0.9);
  }
  const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  ground.updateMatrixWorld();
  return { ground, surface: new TerrainSurface(positions, 42, 42) };
}

describe('terrain-following enemy warnings', () => {
  it.each(['melee-arc', 'pounce', 'bolt'] as const)('keeps the entire %s warning just above the rendered triangles', (shape) => {
    const { ground, surface } = unevenGround();
    const ev: Extract<SimEvent, { kind: 'telegraph' }> = {
      kind: 'telegraph', enemyId: 'fixture', attackId: 'fixture-0', shape,
      x: -4, z: -8, facing: 0.67, range: shape === 'bolt' ? 24 : 5.5, radius: 0.95, arcDeg: 110, duration: 0.8,
    };
    const footprints = warningFootprints(ev);
    const geometry = surface.drape(footprints);
    const positions = geometry.attributes.position;
    const ray = new THREE.Raycaster();
    expect(positions.count).toBeGreaterThan(60);
    let highest = -Infinity;
    let coveredArea = 0;
    for (let i = 0; i < positions.count; i += 3) {
      // A vertex-only test would pass even if an overlay triangle cut through
      // a ridge in its middle. Raycast its centroid against the real mesh.
      const center = (read: (j: number) => number) => (read(i) + read(i + 1) + read(i + 2)) / 3;
      const x = center((j) => positions.getX(j));
      const y = center((j) => positions.getY(j));
      const z = center((j) => positions.getZ(j));
      coveredArea += Math.abs(
        (positions.getX(i + 1) - positions.getX(i)) * (positions.getZ(i + 2) - positions.getZ(i)) -
        (positions.getZ(i + 1) - positions.getZ(i)) * (positions.getX(i + 2) - positions.getX(i)),
      ) / 2;
      ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
      const floor = ray.intersectObject(ground)[0].point.y;
      expect(y - floor).toBeCloseTo(WARNING_CLEARANCE, 4);
      highest = Math.max(highest, floor);
    }
    const area = footprints.reduce((sum, polygon) => sum + Math.abs(polygon.reduce((acc, point, i) => {
      const next = polygon[(i + 1) % polygon.length];
      return acc + point.x * next.z - next.x * point.z;
    }, 0)) / 2, 0);
    expect(coveredArea).toBeCloseTo(area, 4);
    expect(highest).toBeGreaterThan(0.045); // the old fixed plane would disappear here
    geometry.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
  });
});
