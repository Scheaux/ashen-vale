import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from './camera';
import { scoreTarget, TargetProjection, type TargetArea } from './targeting';

const body: TargetArea = { feetX: 60, feetY: 90, headX: 60, headY: 30, radius: 10, depth: 0.5 };

describe('enemy aim assist', () => {
  it('accepts a near miss around the body, but leaves distant ground free', () => {
    expect(scoreTarget(body, 78, 60, false)).toBeLessThan(Infinity);
    expect(scoreTarget(body, 83, 60, true)).toBe(Infinity);
    expect(scoreTarget(body, 60, 96, false)).toBeLessThan(Infinity);
    expect(scoreTarget(body, 60, 10, false)).toBeLessThan(Infinity);
    expect(scoreTarget(body, 60, 7, false)).toBe(Infinity);
  });

  it('prefers a new body hit over a previous padded hit in an overlap', () => {
    const neighbor = { ...body, feetX: 77, headX: 77 };
    expect(scoreTarget(neighbor, 77, 60, false)).toBeLessThan(scoreTarget(body, 77, 60, true));
    expect(scoreTarget(body, 77, 60, true)).toBeLessThan(scoreTarget(body, 77, 60, false));
  });

  it('keeps 12 CSS pixels of padding across camera zoom and rejects off-screen enemies', () => {
    const width = 1440;
    const height = 900;
    const rig = new CameraRig(width / height);
    const projection = new TargetProjection();
    const point = new THREE.Vector3();
    for (const zoom of [9, 32]) {
      rig.distance = zoom;
      rig.snapTo(0, 0);
      const area = projection.project(rig.camera, width, height, point, 1.7, 0.55)!;
      const y = (area.feetY + area.headY) * 0.5;
      const x = (area.feetX + area.headX) * 0.5 + area.radius;
      expect(scoreTarget(area, x + 10, y, false)).toBeLessThan(Infinity);
      expect(scoreTarget(area, x + 14, y, false)).toBe(Infinity);
      expect(projection.project(rig.camera, width, height, new THREE.Vector3(0, 0, -990), 1.7, 0.55)).toBeNull();
    }
  });
});
