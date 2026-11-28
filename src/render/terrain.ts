import * as THREE from 'three';
import type { ZoneId } from '../content/types';
import { distanceToCorridor } from '../content/corridor';
import { MOOR_CORRIDOR } from '../content/zone';
import { noise2D, smoothstep } from '../core/noise';
import { detailNormal } from './materials';
import { createGroundTexture } from './textures';
import { TerrainSurface } from './terrainSurface';

/** Bump when the heightfield or vertex-colour recipe changes. */
export const TERRAIN_VERSION = 2;

const SEGMENTS = 128;
/**
 * The corridor's rounded caps reach z≈±103. The old 170-unit plane (±85) cut
 * them off, so the grid grows to 240 while keeping the same 128² triangle
 * budget and four-instance prop draw calls.
 */
const MOOR_TERRAIN_SIZE = 240;

/** Moor height/colour recipe: flat bog band around the corridor, hills outside. */
function shapeMoor(pos: THREE.BufferAttribute, colors: Float32Array): void {
  const cMoss = new THREE.Color('#2c3225');
  const cEarth = new THREE.Color('#362b1d');
  const cDirt = new THREE.Color('#4a4230');
  const tmp = new THREE.Color();
  const corridor = MOOR_CORRIDOR;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Distance to the centerline: the flattened bog follows the whole route.
    const distance = distanceToCorridor(corridor, x, z);

    // Hills only rise beyond the walkable band; the corridor lip blends over
    // a wide apron so camps and the end clearing stay on gentle ground.
    const outside = smoothstep(corridor.radius - 1, corridor.radius + 28, distance);
    const hills = noise2D(x * 0.032, z * 0.032) * 10 + noise2D(x * 0.095, z * 0.095) * 2.6;
    const bog = (noise2D(x * 0.11, z * 0.11) * 0.12 + noise2D(x * 0.23, z * 0.23) * 0.04) *
      (1 - outside) * smoothstep(2, corridor.radius, distance);
    pos.setY(i, bog + hills * outside);

    const n = noise2D(x * 0.05, z * 0.05) * 0.5 + 0.5;
    tmp.copy(cMoss).lerp(cEarth, smoothstep(0.25, 0.62, n)).lerp(cDirt, smoothstep(0.58, 0.95, n));
    tmp.multiplyScalar(1 - outside * 0.3);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
}

function shapeZone(zoneId: ZoneId, pos: THREE.BufferAttribute, colors: Float32Array): void {
  switch (zoneId) {
    case 'drowned-ossuary':
      // 5.0c replaces this stub with the analytic rim/terrace/crypt profile.
      // 5.0a has no second-zone gameplay, so the moor shape is the safe fallback.
      shapeMoor(pos, colors);
      break;
    case 'ashen-moor':
      shapeMoor(pos, colors);
      break;
  }
}

function createMoorMaterial(): THREE.MeshStandardMaterial {
  const detail = detailNormal('stone', 46, 0.55);
  return new THREE.MeshStandardMaterial({
    map: createGroundTexture(),
    normalMap: detail.map,
    normalScale: detail.scale,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
}

/**
 * Dark-fantasy ground: a flat, gently undulating bog corridor with hills rising
 * outside the walkable band, so the route reads as a natural hollow.
 *
 * Passing `reuse` rebuilds the mesh/material/vertex colours while rewriting the
 * same TerrainSurface source, so existing view layers keep a live sampler.
 */
export function createTerrain(
  zoneId: ZoneId = 'ashen-moor',
  reuse?: TerrainSurface,
  size = MOOR_TERRAIN_SIZE,
): { mesh: THREE.Mesh; surface: TerrainSurface } {
  const geo = new THREE.PlaneGeometry(size, size, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  shapeZone(zoneId, pos, colors);

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = createMoorMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  const surface = reuse ?? new TerrainSurface(pos, size, SEGMENTS);
  if (reuse) reuse.setSource(pos, size, SEGMENTS);
  return { mesh, surface };
}
