import * as THREE from 'three';
import type { ZoneId } from '../content/types';
import { noise2D, smoothstep } from '../core/noise';
import { detailNormal } from './materials';
import { createGroundTexture } from './textures';
import { TerrainSurface } from './terrainSurface';

/** Bump when the heightfield or vertex-colour recipe changes. */
export const TERRAIN_VERSION = 1;

const SEGMENTS = 128;

/** Moor height/colour recipe; must stay byte-for-byte the shipped look. */
function shapeMoor(pos: THREE.BufferAttribute, colors: Float32Array): void {
  const cMoss = new THREE.Color('#2c3225');
  const cEarth = new THREE.Color('#362b1d');
  const cDirt = new THREE.Color('#4a4230');
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);

    // Play area stays flat; hills only rise beyond the walkable bounds (r=42).
    const hills = noise2D(x * 0.032, z * 0.032) * 10 + noise2D(x * 0.095, z * 0.095) * 2.6;
    const edge = smoothstep(44, 66, r);
    const undulation = noise2D(x * 0.13, z * 0.13) * 0.16 * smoothstep(18, 38, r);
    pos.setY(i, undulation + hills * edge);

    const n = noise2D(x * 0.05, z * 0.05) * 0.5 + 0.5;
    tmp.copy(cMoss).lerp(cEarth, smoothstep(0.25, 0.62, n)).lerp(cDirt, smoothstep(0.58, 0.95, n));
    tmp.multiplyScalar(1 - edge * 0.3);
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
 * Dark-fantasy ground: flat in the walkable area, rising into ridged hills
 * outside the play bounds so the zone edge reads as a natural wall.
 *
 * Passing `reuse` rebuilds the mesh/material/vertex colours while rewriting the
 * same TerrainSurface source, so existing view layers keep a live sampler.
 */
export function createTerrain(
  zoneId: ZoneId = 'ashen-moor',
  reuse?: TerrainSurface,
  size = 170,
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
