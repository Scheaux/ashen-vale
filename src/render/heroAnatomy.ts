import * as THREE from 'three';
import { latheProfile } from './geo';
import { HERO_BOOT, HERO_LEG } from './heroMotion';

/** Tailored body profile instead of a single round capsule. */
export function heroTorso(build: number): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.060, 0.023], [0.132, 0.042], [0.150, 0.092], [0.147, 0.140], [0.159, 0.189],
    [0.174, 0.227], [0.190, 0.278], [0.208, 0.344], [0.210, 0.394], [0.201, 0.427],
    [0.171, 0.457], [0.117, 0.484], [0.085, 0.510], [0.070, 0.532],
  ];
  return latheProfile(profile.map(([r, y]) => [r * build, y]), 40);
}

export function fittedLimb(radius: number, length: number, taper: number): THREE.BufferGeometry {
  return latheProfile([
    [0.16, -1.08], [0.48, -1.027], [taper * 0.74, -0.98], [taper, -0.87],
    [(0.92 + taper) * 0.5, -0.73], [0.88, -0.57], [0.99, -0.43], [1.06, -0.29],
    [1.04, -0.16], [0.92, -0.03], [0.66, 0.09], [0.16, 0.16],
  ].map(([r, y]) => [r * radius, y * length]), 28);
}

/** Rounded toe box and a shaped instep in the same ankle envelope as the rig. */
export function heroBoot(width: number): THREE.BufferGeometry {
  const profile = [
    [-0.5, 0.55, 0.022], [-0.46, 0.82, 0.048], [-0.31, 0.91, 0.061],
    [-0.10, 0.94, 0.059], [0.12, 1, 0.042], [0.31, 1, 0.021],
    [0.43, 0.89, 0.014], [0.48, 0.65, 0.005], [0.5, 0.20, -0.008],
  ];
  const segments = 32;
  const verts: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j < profile.length; j++) {
    const [depth, span, instep] = profile[j];
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * 2 * Math.PI;
      const cross = Math.sin(a);
      const crown = Math.cos(a);
      const y = crown > 0
        ? instep * Math.pow(crown, 0.65)
        : -HERO_LEG.ankle * Math.pow(-crown, 0.34);
      verts.push(Math.sign(cross) * Math.pow(Math.abs(cross), 0.72) * width * span * 0.5, y,
        depth * HERO_BOOT.length + HERO_BOOT.center);
      uv.push(i / segments, j / (profile.length - 1));
      if (j < profile.length - 1 && i < segments) {
        const k = j * (segments + 1) + i;
        const m = k + segments + 1;
        index.push(k, m, k + 1, k + 1, m, m + 1);
      }
    }
  }
  // Cap the toe/heel. Small boundary rings round the visible ends.
  verts.push(0, -0.016, HERO_BOOT.center - HERO_BOOT.length / 2, 0, -0.025, HERO_BOOT.center + HERO_BOOT.length / 2);
  uv.push(0.5, 0, 0.5, 1);
  const back = profile.length * (segments + 1);
  const frontRing = (profile.length - 1) * (segments + 1);
  for (let i = 0; i < segments; i++) index.push(back, i, i + 1, back + 1, frontRing + i + 1, frontRing + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
