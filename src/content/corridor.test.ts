import { describe, expect, it } from 'vitest';
import {
  clampCircleToCorridor,
  clampToCorridor,
  corridorSample,
  corridorSegmentLength,
  distanceToCorridor,
  isInsideCorridor,
  projectToCorridor,
} from './corridor';
import type { ZoneCorridor } from './types';

const CORRIDOR: ZoneCorridor = {
  points: [
    { x: 0, z: 30 },
    { x: 10, z: 0 },
    { x: 0, z: -30 },
  ],
  radius: 12,
};

describe('corridor geometry', () => {
  it('projects to the nearest segment including bends', () => {
    const middle = projectToCorridor(CORRIDOR, 10, 0);
    expect(middle.distance).toBeCloseTo(0, 6);
    expect(middle.segment).toBe(0);
    expect(middle.t).toBeCloseTo(1, 6);

    const rightOfBend = projectToCorridor(CORRIDOR, 22, 0);
    expect(rightOfBend.distance).toBeCloseTo(12, 6);
    expect(rightOfBend.x).toBeCloseTo(10, 6);
    expect(rightOfBend.z).toBeCloseTo(0, 6);
  });

  it('measures the rounded end caps as part of the band', () => {
    expect(distanceToCorridor(CORRIDOR, 0, 48)).toBeCloseTo(18, 6);
    expect(isInsideCorridor(CORRIDOR, 0, 40)).toBe(true);
    expect(isInsideCorridor(CORRIDOR, 0, 48)).toBe(false);
    expect(isInsideCorridor(CORRIDOR, 0, 42, 1)).toBe(false);
  });

  it('clamps points to the nearest edge and keeps the inside untouched', () => {
    const inside = clampToCorridor(CORRIDOR, 2, 2);
    expect(inside).toEqual({ x: 2, z: 2 });

    const clamped = clampToCorridor(CORRIDOR, 100, 0);
    expect(clamped.x).toBeCloseTo(22, 6);
    expect(clamped.z).toBeCloseTo(0, 6);
    expect(distanceToCorridor(CORRIDOR, clamped.x, clamped.z)).toBeCloseTo(12, 6);

    const end = clampToCorridor(CORRIDOR, 0, -100, 2);
    const endDistance = Math.hypot(end.x, end.z + 30);
    expect(endDistance).toBeCloseTo(10, 6);
  });

  it('cancels outward velocity when a circle hits the rim', () => {
    const position = { x: 100, z: 0 };
    const velocity = { x: 6, z: 2 };
    const moved = clampCircleToCorridor(position, velocity, 1, CORRIDOR);
    expect(moved).toBe(true);
    expect(distanceToCorridor(CORRIDOR, position.x, position.z)).toBeCloseTo(11, 6);
    expect(velocity.x).toBeCloseTo(0, 6);
    expect(velocity.z).toBeCloseTo(2, 6);
  });

  it('samples points, tangents and right-hand normals along a segment', () => {
    const start = corridorSample(CORRIDOR, 1, 0);
    expect(start).toMatchObject({ x: 10, z: 0, segment: 1, t: 0 });
    expect(Math.hypot(start.tangentX, start.tangentZ)).toBeCloseTo(1, 6);
    expect(Math.hypot(start.normalX, start.normalZ)).toBeCloseTo(1, 6);
    expect(start.tangentX * start.normalX + start.tangentZ * start.normalZ).toBeCloseTo(0, 6);
    expect(corridorSegmentLength(CORRIDOR, 1)).toBeCloseTo(Math.hypot(10, 30), 6);
  });
});
