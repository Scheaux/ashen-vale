import * as THREE from 'three';
import { segmentDistanceSq } from '../core/math';

export interface TargetArea {
  feetX: number;
  feetY: number;
  headX: number;
  headY: number;
  radius: number;
  depth: number;
}

const PADDING_PX = 12;

/** Project an upright body capsule into CSS pixels, independently of render DPI. */
export class TargetProjection {
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly edge = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly area: TargetArea = { feetX: 0, feetY: 0, headX: 0, headY: 0, radius: 0, depth: 0 };

  project(camera: THREE.Camera, width: number, height: number, position: THREE.Vector3, bodyHeight: number, radius: number): TargetArea | null {
    this.feet.copy(position).addScaledVector(UP, 0.21).project(camera);
    this.head.copy(position).addScaledVector(UP, bodyHeight - 0.2).project(camera);
    this.center.copy(position).addScaledVector(UP, bodyHeight * 0.5);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.edge.copy(this.center).addScaledVector(this.right, radius).project(camera);
    this.center.project(camera);
    if (this.center.z < -1 || this.center.z >= 1) return null;

    const area = this.area;
    area.feetX = (this.feet.x + 1) * width * 0.5;
    area.feetY = (1 - this.feet.y) * height * 0.5;
    area.headX = (this.head.x + 1) * width * 0.5;
    area.headY = (1 - this.head.y) * height * 0.5;
    area.radius = Math.max(3, Math.abs(this.edge.x - this.center.x) * width * 0.5);
    area.depth = this.center.z;
    if (Math.max(area.feetX, area.headX) + area.radius < 0 || Math.min(area.feetX, area.headX) - area.radius > width ||
      Math.max(area.feetY, area.headY) + area.radius < 0 || Math.min(area.feetY, area.headY) - area.radius > height) return null;
    return area;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** A body hit wins over aim assist. In tight overlaps, prefer the nearer silhouette. */
export function scoreTarget(area: TargetArea, x: number, y: number, hovered: boolean): number {
  const distance = Math.sqrt(segmentDistanceSq(x, y, area.feetX, area.feetY, area.headX, area.headY));
  if (distance > area.radius + PADDING_PX) return Infinity;
  // A tiny bias keeps an existing hover steady without extending its hit area.
  return distance / (area.radius + PADDING_PX) + (distance > area.radius ? 2 : 0) - (hovered ? 0.06 : 0);
}
