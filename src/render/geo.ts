import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2D } from '../core/noise';

/**
 * Geometry toolkit for the detail scales the camera actually resolves:
 * silhouettes get curve segments, edges get bevels, surface form gets swept
 * and lathed profiles. Microdetail stays in material maps (materials.ts).
 */

/** Extruded box with rounded bevels so edges catch highlights. */
export function beveledBox(
  width: number,
  height: number,
  depth: number,
  bevel = 0.018,
  bevelSegments = 2,
): THREE.BufferGeometry {
  const w = width / 2 - bevel;
  const h = height / 2 - bevel;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -h);
  shape.lineTo(w, -h);
  shape.lineTo(w, h);
  shape.lineTo(w, h);
  shape.lineTo(-w, h);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments: 2,
  });
  geo.center();
  return geo;
}

/** Lathe from a [radius, y] profile (weapons, pillars, bottles). */
export function latheProfile(points: Array<[number, number]>, segments = 24): THREE.BufferGeometry {
  const vectors = points.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  return new THREE.LatheGeometry(vectors, segments);
}

/**
 * Sweep rings along a curve with parallel-transport frames and per-ring
 * radii — tapered branches, bow limbs, ropes. Child starts should be buried
 * inside the parent surface (skill guidance) so seams never show.
 */
export function sweptTube(
  centers: readonly THREE.Vector3[],
  radii: readonly number[],
  radialSegments = 10,
): THREE.BufferGeometry {
  const n = centers.length;
  if (n < 2) throw new Error('sweptTube: need at least 2 rings');

  // Parallel-transport frame: carry the previous normal along the curve so
  // the sweep never snaps or twists.
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(n - 1, i + 1)];
    tangents.push(new THREE.Vector3().subVectors(next, prev).normalize());
  }
  const normals: THREE.Vector3[] = [];
  let normal = new THREE.Vector3(0, 1, 0);
  if (Math.abs(tangents[0].dot(normal)) > 0.9) normal = new THREE.Vector3(1, 0, 0);
  normal.projectOnPlane(tangents[0]).normalize();
  normals.push(normal.clone());
  for (let i = 1; i < n; i++) {
    const t = tangents[i];
    const carried = normal.clone().projectOnPlane(t);
    if (carried.lengthSq() < 1e-8) carried.set(1, 0, 0).projectOnPlane(t);
    normal = carried.normalize();
    normals.push(normal.clone());
  }

  const positions = new Float32Array(n * radialSegments * 3);
  const uvs = new Float32Array(n * radialSegments * 2);
  const binormal = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    binormal.crossVectors(tangents[i], normals[i]);
    for (let j = 0; j < radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const idx = (i * radialSegments + j) * 3;
      positions[idx] = centers[i].x + (normals[i].x * cos + binormal.x * sin) * radii[i];
      positions[idx + 1] = centers[i].y + (normals[i].y * cos + binormal.y * sin) * radii[i];
      positions[idx + 2] = centers[i].z + (normals[i].z * cos + binormal.z * sin) * radii[i];
      const u = (i * radialSegments + j) * 2;
      uvs[u] = j / radialSegments;
      uvs[u + 1] = i / (n - 1);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = (i + 1) * radialSegments + j;
      const d = (i + 1) * radialSegments + ((j + 1) % radialSegments);
      indices.push(a, c, b, b, c, d);
    }
  }
  // Fan caps on both ends (vertices padded into the same buffers so all
  // attributes share one count).
  const capStart = n * radialSegments;
  const capEnd = capStart + 1;
  {
    const positionsFull = new Float32Array((capStart + 2) * 3);
    positionsFull.set(positions);
    positionsFull[capStart * 3] = centers[0].x;
    positionsFull[capStart * 3 + 1] = centers[0].y;
    positionsFull[capStart * 3 + 2] = centers[0].z;
    positionsFull[capEnd * 3] = centers[n - 1].x;
    positionsFull[capEnd * 3 + 1] = centers[n - 1].y;
    positionsFull[capEnd * 3 + 2] = centers[n - 1].z;

    const uvsFull = new Float32Array((capStart + 2) * 2);
    uvsFull.set(uvs);

    for (let j = 0; j < radialSegments; j++) {
      indices.push(capStart, ((j + 1) % radialSegments), j);
      const last = (n - 1) * radialSegments;
      indices.push(capEnd, last + j, last + ((j + 1) % radialSegments));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positionsFull, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvsFull, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
}

/**
 * Adaptive swept trunk: flared root with dense rings where curvature and
 * flare show, tapering upward (Seijaku-style tree geometry).
 */
export function sweptTrunk(
  height: number,
  baseRadius: number,
  segments = 12,
): { centers: THREE.Vector3[]; radii: number[] } {
  const centers: THREE.Vector3[] = [];
  const radii: number[] = [];
  const lean = 0.06 * height;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Dense rings at the root (t^1.7 spends resolution near the base).
    const y = height * Math.pow(t, 1.7);
    const flare = Math.exp(-t * 7) * 0.6; // root flare bulge
    const taper = 1 - t * 0.62;
    centers.push(new THREE.Vector3(Math.sin(t * 2.2) * lean * 0.25, y, Math.cos(t * 1.7) * lean * 0.2));
    radii.push(baseRadius * (taper + flare));
  }
  return { centers, radii };
}

/** Branch sweep from an origin point toward a direction with taper. */
export function sweptBranch(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  startRadius: number,
  endRadius: number,
  segments = 6,
  droop = 0.25,
): { centers: THREE.Vector3[]; radii: number[] } {
  const centers: THREE.Vector3[] = [];
  const radii: number[] = [];
  const dir = direction.clone().normalize();
  const bend = new THREE.Vector3(0, -droop * length, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = origin.clone().addScaledVector(dir, length * t).addScaledVector(bend, t * t);
    centers.push(point);
    radii.push(startRadius + (endRadius - startRadius) * t);
  }
  return { centers, radii };
}

/** Weathered rock: displaced icosahedron with smooth normals (no cracks). */
export function rockGeometry(radius: number, seed: number, detail = 2, roughness = 0.32): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      noise2D(x * 1.3 + seed * 7.1, z * 1.3 - seed * 3.7) * 0.5 +
      noise2D(x * 3.1 - seed * 2.3, y * 3.1 + seed * 5.9) * 0.28 +
      noise2D(y * 6.2 + seed * 1.7, z * 6.2 - seed * 9.1) * 0.14;
    const scale = 1 + n * roughness;
    pos.setXYZ(i, x * scale, y * scale * 0.82, z * scale);
  }
  // Merge duplicated vertices so normals smooth instead of faceting.
  const merged = mergeVertices(geo, 1e-4);
  merged.computeVertexNormals();
  geo.dispose();
  return merged;
}
