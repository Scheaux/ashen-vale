import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2D } from '../core/noise';
import type { PropKind, PropPlacement, ZoneLayout } from '../content/types';
import { disposeMeshTree } from './dispose';
import { rockGeometry, sweptBranch, sweptTube, sweptTrunk, latheProfile } from './geo';
import { barkMaterial, stoneMaterial } from './materials';
import type { TerrainSurface } from './terrainSurface';

function deadTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Trunk: adaptive sweep with a flared root and dense base rings.
  const trunk = sweptTrunk(3.6, 0.3, 14);
  parts.push(sweptTube(trunk.centers, trunk.radii, 10));

  // Branches sweep outward with taper; starts are buried inside the trunk.
  const branches: Array<{ origin: THREE.Vector3; dir: THREE.Vector3; length: number }> = [
    { origin: new THREE.Vector3(0.05, 2.55, 0.1), dir: new THREE.Vector3(0.8, 0.75, 0.35), length: 1.85 },
    { origin: new THREE.Vector3(-0.12, 2.85, -0.05), dir: new THREE.Vector3(-0.85, 0.7, -0.2), length: 1.6 },
    { origin: new THREE.Vector3(0.1, 2.15, -0.12), dir: new THREE.Vector3(0.55, 0.65, -0.85), length: 1.45 },
    { origin: new THREE.Vector3(-0.08, 3.25, 0.08), dir: new THREE.Vector3(-0.5, 0.95, 0.5), length: 1.2 },
    { origin: new THREE.Vector3(0.02, 3.5, 0), dir: new THREE.Vector3(0.15, 1, -0.2), length: 0.95 },
  ];
  for (const b of branches) {
    const branch = sweptBranch(b.origin, b.dir, b.length, 0.085, 0.018, 7, 0.22);
    parts.push(sweptTube(branch.centers, branch.radii, 7));
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new THREE.CylinderGeometry(0.14, 0.3, 3.6, 8);
}

function pillarGeometry(): THREE.BufferGeometry {
  // Weathered column: plinth, entasis swell, capital — lathed so curved
  // surfaces stay round and the rim highlights travel.
  const profile: Array<[number, number]> = [
    [0.03, 0],
    [0.78, 0],
    [0.74, 0.05],
    [0.58, 0.11],
    [0.535, 0.3],
    [0.515, 0.52],
    [0.525, 0.72],
    [0.575, 0.885],
    [0.68, 0.945],
    [0.72, 1.0],
    [0.03, 1.0],
  ];
  return latheProfile(profile, 22);
}

function pillarBrokenGeometry(): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.03, 0],
    [0.82, 0],
    [0.78, 0.05],
    [0.62, 0.12],
    [0.565, 0.34],
    [0.55, 0.6],
    [0.565, 0.82],
    [0.03, 0.92],
  ];
  const geo = latheProfile(profile, 22);
  // Chip the top: jagged rim where the shaft snapped.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.62) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const chip = noise2D(x * 5.2 + 11.3, z * 5.2 - 7.7) * 0.14 + noise2D(x * 12, z * 12) * 0.06;
      pos.setY(i, Math.max(0.55, y + chip * (y - 0.6) / 0.32));
    }
  }
  geo.computeVertexNormals();
  return geo;
}

interface KindStyle {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Per-instance nonuniform scale multipliers [min, max] per axis. */
  scaleAxes: { x: [number, number]; y: [number, number]; z: [number, number] };
}

function styles(): Record<PropKind, KindStyle> {
  return {
    rock: {
      geometry: rockGeometry(1, 3.7, 2),
      material: stoneMaterial(0x565862, 1.6, 0.85),
      scaleAxes: { x: [0.7, 1.7], y: [0.55, 1.15], z: [0.7, 1.7] },
    },
    deadTree: {
      geometry: deadTreeGeometry(),
      material: barkMaterial(0x32261a, 2.2, 0.95),
      scaleAxes: { x: [0.85, 1.15], y: [0.85, 1.3], z: [0.85, 1.15] },
    },
    pillar: {
      geometry: pillarGeometry(),
      material: stoneMaterial(0x6b665c, 1.4, 0.85),
      scaleAxes: { x: [0.9, 1.1], y: [2.4, 4.3], z: [0.9, 1.1] },
    },
    pillarBroken: {
      geometry: pillarBrokenGeometry(),
      material: stoneMaterial(0x625d54, 1.4, 0.85),
      scaleAxes: { x: [0.9, 1.1], y: [0.9, 1.8], z: [0.9, 1.1] },
    },
  };
}

/** Derive a stable per-instance scale blend from the placement (no RNG here). */
function axisScale(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

interface PropInstance {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Authored nonuniform scale; the instance matrix is written once from this. */
  scale: THREE.Vector3;
  radius: number;
  tall: boolean;
  fade: number;
}

interface PropMesh {
  mesh: THREE.InstancedMesh;
  kind: PropKind;
  instances: PropInstance[];
  fadeAttribute: THREE.InstancedBufferAttribute;
}

export interface PropProbeSample {
  x: number;
  z: number;
  /** Scale read from the live instance matrix; must match `authoredScale`. */
  scale: { x: number; y: number; z: number };
  /** Scale recorded when the instance matrix was written (never rewritten). */
  authoredScale: { x: number; y: number; z: number };
  fade: number;
  tall: boolean;
  kind: PropKind;
}

export interface PropProbe {
  total: number;
  occluded: number;
  sample: PropProbeSample[];
}

export interface PropsView {
  group: THREE.Group;
  /** Fade tall props that sit between the camera and the hero. */
  update(camera: THREE.Camera, playerX: number, playerZ: number, dt: number): void;
  /** Fade/occlusion state plus live and authored per-instance scales. */
  probe(): PropProbe;
  readonly occludedCount: number;
  /** Detach the scenery group and release its geometries, materials and textures. */
  dispose(): void;
}

const OCCLUSION_PADDING = 1.1;
const FADE_ATTRIBUTE = 'instanceFade';
const STANDARD_FADE_CACHE_KEY = 'ashen-prop-instance-fade-v1';
const DEPTH_FADE_CACHE_KEY = 'ashen-prop-instance-fade-depth-v1';

/**
 * Stable 4x4 Bayer threshold in screen space. Values fall in (0, 1), so
 * fade 0 never discards and fade 1 discards every fragment.
 */
const BAYER_GLSL = /* glsl */`
float ashenBayer2(vec2 p) {
  return p.x < 0.5
    ? (p.y < 0.5 ? 0.0 : 3.0)
    : (p.y < 0.5 ? 2.0 : 1.0);
}

float ashenBayer4(vec2 fragCoord) {
  vec2 cell = floor(mod(fragCoord, 4.0));
  vec2 hi = floor(cell * 0.5);
  vec2 lo = mod(cell, 2.0);
  return (4.0 * ashenBayer2(lo) + ashenBayer2(hi) + 0.5) / 16.0;
}
`;

/** Replace a required shader marker; fail loudly if three renames the chunk. */
function replaceShaderMarker(source: string, marker: string, replacement: string, stage: string): string {
  if (!source.includes(marker)) {
    throw new Error(`PropsView fade patch: ${stage} shader is missing "${marker}" (three shader chunk changed?)`);
  }
  return source.replace(marker, replacement);
}

/**
 * Patch an opaque material so per-instance occlusion fades through a
 * screen-space dither instead of touching the instance matrix. The matching
 * depth material uses the same attribute and threshold, keeping shadows in
 * step with the visible dither without enabling transparency or sorting.
 */
function patchInstanceFade(material: THREE.Material, cacheKey: string): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = replaceShaderMarker(
      shader.vertexShader,
      '#include <common>',
      `#include <common>\nattribute float ${FADE_ATTRIBUTE};\nvarying float vInstanceFade;`,
      'vertex',
    );
    shader.vertexShader = replaceShaderMarker(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>\nvInstanceFade = ${FADE_ATTRIBUTE};`,
      'vertex',
    );
    shader.fragmentShader = replaceShaderMarker(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>\nvarying float vInstanceFade;\n${BAYER_GLSL}`,
      'fragment',
    );
    shader.fragmentShader = replaceShaderMarker(
      shader.fragmentShader,
      'void main() {',
      'void main() {\n\tif (vInstanceFade > ashenBayer4(gl_FragCoord.xy)) discard;',
      'fragment',
    );
  };
  material.customProgramCacheKey = () => cacheKey;
}

const PROP_RADIUS: Record<PropKind, number> = {
  rock: 0.85,
  deadTree: 0.55,
  pillar: 0.75,
  pillarBroken: 0.9,
};

export function createProps(layout: ZoneLayout, terrain?: TerrainSurface): PropsView {
  const style = styles();
  const group = new THREE.Group();
  const meshes: PropMesh[] = [];

  // One shared shadow-depth stand-in: the same instance fade attribute and
  // dither gate keep the shadow coverage in step with the visible fragments.
  // Default packing matches the renderer's internal shadow depth material.
  const depthMaterial = new THREE.MeshDepthMaterial();
  patchInstanceFade(depthMaterial, DEPTH_FADE_CACHE_KEY);

  const byKind = new Map<PropKind, PropPlacement[]>();
  for (const p of layout.props) {
    const list = byKind.get(p.kind) ?? [];
    list.push(p);
    byKind.set(p.kind, list);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();

  for (const [kind, placements] of byKind) {
    const s = style[kind];
    patchInstanceFade(s.material, STANDARD_FADE_CACHE_KEY);
    const mesh = new THREE.InstancedMesh(s.geometry, s.material, placements.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = depthMaterial;
    const instances: PropInstance[] = [];
    const fadeArray = new Float32Array(placements.length);
    const fadeAttribute = new THREE.InstancedBufferAttribute(fadeArray, 1);
    fadeAttribute.setUsage(THREE.DynamicDrawUsage);
    s.geometry.setAttribute(FADE_ATTRIBUTE, fadeAttribute);

    placements.forEach((p, i) => {
      // Deterministic per-instance variation derived from placement values.
      const t1 = (Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1;
      const t2 = (Math.sin(p.x * 39.3468 + p.z * 11.135) * 24634.6345) % 1;
      const a = Math.abs(t1);
      const b = Math.abs(t2);

      position.set(p.x, (terrain?.heightAt(p.x, p.z) ?? 0) - 0.08, p.z);
      euler.set(p.tilt * 0.8, p.rotation, p.tilt);
      quaternion.setFromEuler(euler);
      scale.set(
        axisScale(s.scaleAxes.x[0], s.scaleAxes.x[1], a) * p.scale,
        axisScale(s.scaleAxes.y[0], s.scaleAxes.y[1], b) * p.scale,
        axisScale(s.scaleAxes.z[0], s.scaleAxes.z[1], b) * p.scale,
      );
      // Authored once. update() only writes the fade attribute, never this matrix.
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      instances.push({
        position: position.clone(),
        quaternion: quaternion.clone(),
        scale: scale.clone(),
        radius: PROP_RADIUS[kind] * p.scale,
        tall: kind !== 'rock',
        fade: 0,
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    meshes.push({ mesh, kind, instances, fadeAttribute });
  }

  let occludedCount = 0;
  const cameraPosition = new THREE.Vector3();
  const playerPosition = new THREE.Vector3();

  function update(camera: THREE.Camera, playerX: number, playerZ: number, dt: number): void {
    camera.getWorldPosition(cameraPosition);
    playerPosition.set(playerX, (terrain?.heightAt(playerX, playerZ) ?? 0) + 1, playerZ);
    const dx = playerPosition.x - cameraPosition.x;
    const dz = playerPosition.z - cameraPosition.z;
    const lenSq = dx * dx + dz * dz;
    let occluded = 0;

    for (const { instances, fadeAttribute } of meshes) {
      const fades = fadeAttribute.array as Float32Array;
      let anyChanged = false;
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        let target = 0;
        if (instance.tall && lenSq > 1e-4) {
          const t = ((instance.position.x - cameraPosition.x) * dx +
            (instance.position.z - cameraPosition.z) * dz) / lenSq;
          if (t > 0.08 && t < 0.97) {
            const lineX = cameraPosition.x + dx * t;
            const lineZ = cameraPosition.z + dz * t;
            const dist = Math.hypot(instance.position.x - lineX, instance.position.z - lineZ);
            if (dist < instance.radius + OCCLUSION_PADDING) target = 1;
          }
        }

        const previous = instance.fade;
        instance.fade += (target - instance.fade) * (1 - Math.exp(-14 * dt));
        if (Math.abs(instance.fade - target) < 0.01) instance.fade = target;
        if (instance.fade > 0.5) occluded++;
        if (instance.fade !== previous) {
          fades[i] = instance.fade;
          anyChanged = true;
        }
      }
      if (anyChanged) fadeAttribute.needsUpdate = true;
    }
    occludedCount = occluded;
  }

  function probe(): PropProbe {
    const sample: PropProbeSample[] = [];
    for (const { mesh, kind, instances } of meshes) {
      const matrices = mesh.instanceMatrix.array;
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const offset = i * 16;
        sample.push({
          x: instance.position.x,
          z: instance.position.z,
          // Read the live matrix so a scale regression cannot hide behind the
          // authored copy.
          scale: {
            x: Math.hypot(matrices[offset], matrices[offset + 1], matrices[offset + 2]),
            y: Math.hypot(matrices[offset + 4], matrices[offset + 5], matrices[offset + 6]),
            z: Math.hypot(matrices[offset + 8], matrices[offset + 9], matrices[offset + 10]),
          },
          authoredScale: { x: instance.scale.x, y: instance.scale.y, z: instance.scale.z },
          fade: instance.fade,
          tall: instance.tall,
          kind,
        });
      }
    }
    return { total: sample.length, occluded: occludedCount, sample };
  }

  return {
    group,
    update,
    probe,
    dispose() {
      depthMaterial.dispose();
      disposeMeshTree(group);
    },
    get occludedCount() {
      return occludedCount;
    },
  };
}
