import * as THREE from 'three';
import { createRng, range } from '../core/rng';
import type { ZoneBounds } from '../content/types';

export interface EmberField {
  points: THREE.Points;
  update(dt: number): void;
}

/**
 * Slow rising embers and drifting motes — cheap atmosphere that sells the
 * smouldering dark-fantasy mood without post-processing.
 */
export function createEmbers(bounds: ZoneBounds, seed = 7717): EmberField {
  const count = 340;
  const rng = createRng(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const sways = new Float32Array(count);
  const phases = new Float32Array(count);

  const warm = new THREE.Color(0xff9a4d);
  const pale = new THREE.Color(0xffd9a0);
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * bounds.radius * 1.05;
    positions[i * 3] = Math.cos(angle) * dist + bounds.center.x;
    positions[i * 3 + 1] = range(rng, 0.1, 9);
    positions[i * 3 + 2] = Math.sin(angle) * dist + bounds.center.z;
    speeds[i] = range(rng, 0.18, 0.75);
    sways[i] = range(rng, 0.15, 0.5);
    phases[i] = rng() * Math.PI * 2;
    tmp.copy(warm).lerp(pale, rng());
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.11,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  let time = 0;

  function update(dt: number): void {
    time += dt;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + speeds[i] * dt;
      if (y > 9.5) y = 0.05;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.7 + phases[i]) * sways[i] * dt);
    }
    pos.needsUpdate = true;
  }

  return { points, update };
}
