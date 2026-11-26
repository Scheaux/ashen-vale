import * as THREE from 'three';

type Point = { x: number; z: number };
export const WARNING_CLEARANCE = 0.04;

const cross = (a: Point, b: Point, p: Point): number =>
  (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);

/** Clip a convex polygon against the left side of one terrain triangle edge. */
function clipEdge(polygon: Point[], a: Point, b: Point): Point[] {
  const out: Point[] = [];
  let prev = polygon[polygon.length - 1];
  let prevSide = cross(a, b, prev);
  for (const next of polygon) {
    const side = cross(a, b, next);
    if ((side >= 0) !== (prevSide >= 0)) {
      const t = prevSide / (prevSide - side);
      out.push({ x: prev.x + (next.x - prev.x) * t, z: prev.z + (next.z - prev.z) * t });
    }
    if (side >= 0) out.push(next);
    prev = next;
    prevSide = side;
  }
  return out;
}

/** Render-only height lookup shared by every ground-anchored view. */
export interface GroundSampler {
  heightAt(x: number, z: number): number;
}

/**
 * Projection on the actual triangles of the horizontal PlaneGeometry grid.
 * Split the overlay at every terrain edge instead of bridging rises with long triangles.
 *
 * One instance survives zone rebuilds: setSource() rewrites the heightfield it
 * samples, so every view layer keeps a live reference across a remount.
 */
export class TerrainSurface implements GroundSampler {
  private position: THREE.BufferAttribute;
  private step = 0;
  private min = 0;
  private row = 0;
  private segments = 0;

  constructor(position: THREE.BufferAttribute, size: number, segments: number) {
    this.position = position;
    this.setSource(position, size, segments);
  }

  /** Point this sampler at a rebuilt heightfield without changing identity. */
  setSource(position: THREE.BufferAttribute, size: number, segments: number): void {
    this.position = position;
    this.segments = segments;
    this.step = size / segments;
    this.min = -size / 2;
    this.row = segments + 1;
  }

  /** Normalized surface normal from central differences of the heightfield. */
  normalAt(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
    const e = 0.5;
    const dhdx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dhdz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return target.set(-dhdx, 1, -dhdz).normalize();
  }

  heightAt(x: number, z: number): number {
    const gx = THREE.MathUtils.clamp((x - this.min) / this.step, 0, this.segments);
    const gz = THREE.MathUtils.clamp((z - this.min) / this.step, 0, this.segments);
    const ix = Math.min(this.segments - 1, Math.floor(gx));
    const iz = Math.min(this.segments - 1, Math.floor(gz));
    const u = gx - ix;
    const v = gz - iz;
    const i = iz * this.row + ix;
    if (u + v <= 1) {
      return this.position.getY(i) * (1 - u - v) + this.position.getY(i + 1) * u + this.position.getY(i + this.row) * v;
    }
    return this.position.getY(i + 1) * (1 - v) + this.position.getY(i + this.row) * (1 - u) +
      this.position.getY(i + this.row + 1) * (u + v - 1);
  }

  /** Accepts convex world-space footprints; resulting vertices are in world space. */
  drape(footprints: readonly Point[][], clearance = WARNING_CLEARANCE): THREE.BufferGeometry {
    const vertices: number[] = [];
    const cell = (world: number) => THREE.MathUtils.clamp(Math.floor((world - this.min) / this.step), 0, this.segments - 1);

    for (const polygon of footprints) {
      const xs = polygon.map((p) => p.x);
      const zs = polygon.map((p) => p.z);
      const maxX = cell(Math.max(...xs));
      const maxZ = cell(Math.max(...zs));
      for (let iz = cell(Math.min(...zs)); iz <= maxZ; iz++) {
        for (let ix = cell(Math.min(...xs)); ix <= maxX; ix++) {
          const x = this.min + ix * this.step;
          const z = this.min + iz * this.step;
          const a = { x, z };
          const b = { x: x + this.step, z };
          const c = { x, z: z + this.step };
          const d = { x: b.x, z: c.z };
          for (const tri of [[a, b, c], [b, d, c]]) {
            let clipped = polygon;
            for (let edge = 0; edge < 3 && clipped.length >= 3; edge++) {
              clipped = clipEdge(clipped, tri[edge], tri[(edge + 1) % 3]);
            }
            for (let i = 1; i < clipped.length - 1; i++) {
              if (Math.abs(cross(clipped[0], clipped[i], clipped[i + 1])) < 1e-8) continue;
              for (const p of [clipped[0], clipped[i], clipped[i + 1]]) {
                vertices.push(p.x, this.heightAt(p.x, p.z) + clearance, p.z);
              }
            }
          }
        }
      }
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  }
}
