import * as THREE from 'three';
import { fbm2D, noise2D } from '../core/noise';

/**
 * Procedural material toolkit: microdetail comes from generated normal and
 * roughness maps (height fields converted via finite differences), not from
 * extra geometry. Textures are cached and shared across materials.
 */

interface HeightField {
  size: number;
  data: Float32Array;
}

function heightField(size: number, fn: (x: number, y: number) => number): HeightField {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[y * size + x] = fn(x, y);
    }
  }
  return { size, data };
}

function sample(field: HeightField, x: number, y: number): number {
  const s = field.size;
  return field.data[((y + s) % s) * s + ((x + s) % s)];
}

/** Convert a tiling height field into a tangent-space normal map texture. */
function heightToNormal(field: HeightField, strength: number): THREE.CanvasTexture {
  const s = field.size;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const img = ctx.createImageData(s, s);

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (sample(field, x + 1, y) - sample(field, x - 1, y)) * strength;
      const dy = (sample(field, x, y + 1) - sample(field, x, y - 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * s + x) * 4;
      img.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace; // data map, not color
  return tex;
}

/** Convert a height field into a roughness map between lo and hi. */
function heightToRoughness(field: HeightField, lo: number, hi: number): THREE.CanvasTexture {
  const s = field.size;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const img = ctx.createImageData(s, s);

  let min = Infinity;
  let max = -Infinity;
  for (const v of field.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1e-5, max - min);
  for (let i = 0; i < field.data.length; i++) {
    const t = (field.data[i] - min) / span;
    const v = Math.round((lo + (hi - lo) * t) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Height-field recipes (all tile seamlessly via wrap-around sampling)
// ---------------------------------------------------------------------------

function leatherField(size = 256): HeightField {
  return heightField(size, (x, y) => {
    const grain = fbm2D(x * 0.14, y * 0.14, 3);
    const pores = Math.abs(noise2D(x * 0.55, y * 0.55)) * 0.35;
    const creases = Math.abs(noise2D(x * 0.045, y * 0.045)) * 0.9;
    return grain * 0.6 - pores + creases;
  });
}

function metalField(size = 256): HeightField {
  return heightField(size, (x, y) => {
    // Directional scratches: stretched noise + fine denting.
    const scratches = noise2D(x * 1.6, y * 0.06) * 0.5 + noise2D(x * 0.9, y * 0.035) * 0.35;
    const dents = fbm2D(x * 0.22, y * 0.22, 2) * 0.3;
    return scratches + dents;
  });
}

function clothField(size = 256): HeightField {
  return heightField(size, (x, y) => {
    const weave = Math.sin(x * 0.78) * Math.sin(y * 0.78) * 0.45;
    const fuzz = fbm2D(x * 0.5, y * 0.5, 3) * 0.55;
    return weave + fuzz;
  });
}

function fleshField(size = 256): HeightField {
  return heightField(size, (x, y) => {
    const warp = noise2D(x * 0.05, y * 0.05) * 2.2;
    const bumps = fbm2D(x * 0.16 + warp, y * 0.16 + warp, 3);
    const pores = Math.abs(noise2D(x * 0.75, y * 0.75)) * 0.22;
    return bumps * 0.8 - pores;
  });
}

function stoneField(size = 256): HeightField {
  return heightField(size, (x, y) => {
    const pits = Math.abs(noise2D(x * 0.32, y * 0.32)) * 0.7;
    const grain = fbm2D(x * 0.11, y * 0.11, 3) * 0.8;
    return grain - pits;
  });
}

function barkField(size = 256): HeightField {
  return heightField(size, (x, y) => {
    // Vertical grooves: noise stretched along Y.
    const grooves = noise2D(x * 0.7, y * 0.07) * 0.85;
    const ridges = Math.abs(noise2D(x * 0.24, y * 0.05)) * 0.5;
    const grain = fbm2D(x * 0.4, y * 0.4, 2) * 0.25;
    return grooves + ridges + grain;
  });
}

// ---------------------------------------------------------------------------
// Cached maps + material factories
// ---------------------------------------------------------------------------

const cache = new Map<string, { normal: THREE.CanvasTexture; roughness: THREE.CanvasTexture }>();

function mapsFor(kind: 'leather' | 'metal' | 'cloth' | 'flesh' | 'stone' | 'bark') {
  let entry = cache.get(kind);
  if (!entry) {
    const field =
      kind === 'leather'
        ? leatherField()
        : kind === 'metal'
          ? metalField()
          : kind === 'cloth'
            ? clothField()
            : kind === 'flesh'
              ? fleshField()
              : kind === 'bark'
                ? barkField()
                : stoneField();
    const rough: [number, number] =
      kind === 'metal' ? [0.28, 0.62] : kind === 'flesh' ? [0.68, 0.92] : [0.62, 0.95];
    const strength = kind === 'cloth' ? 1.4 : kind === 'stone' ? 1.5 : kind === 'bark' ? 1.7 : 2.2;
    entry = {
      normal: heightToNormal(field, strength),
      roughness: heightToRoughness(field, rough[0], rough[1]),
    };
    cache.set(kind, entry);
  }
  return entry;
}

function textured(
  kind: 'leather' | 'metal' | 'cloth' | 'flesh' | 'stone' | 'bark',
  params: THREE.MeshStandardMaterialParameters,
  repeat: number,
  normalScale = 0.85,
): THREE.MeshStandardMaterial {
  const maps = mapsFor(kind);
  const material = new THREE.MeshStandardMaterial(params);
  // Clone per use: repeat is a texture-level setting.
  material.normalMap = maps.normal.clone();
  material.normalScale = new THREE.Vector2(normalScale, normalScale);
  material.roughnessMap = maps.roughness.clone();
  material.normalMap.repeat.set(repeat, repeat);
  material.roughnessMap.repeat.set(repeat, repeat);
  material.normalMap.needsUpdate = true;
  material.roughnessMap.needsUpdate = true;
  return material;
}

export function leatherMaterial(color: number, repeat = 3, normalScale = 0.85): THREE.MeshStandardMaterial {
  return textured('leather', { color, roughness: 0.82, metalness: 0 }, repeat, normalScale);
}

export function metalMaterial(color: number, repeat = 3, normalScale = 0.7): THREE.MeshStandardMaterial {
  return textured('metal', { color, roughness: 0.42, metalness: 0.72 }, repeat, normalScale);
}

export function clothMaterial(color: number, repeat = 3, normalScale = 0.8): THREE.MeshStandardMaterial {
  return textured('cloth', { color, roughness: 0.88, metalness: 0 }, repeat, normalScale);
}

export function fleshMaterial(color: number, repeat = 2.5, normalScale = 0.8): THREE.MeshStandardMaterial {
  return textured('flesh', { color, roughness: 0.86, metalness: 0 }, repeat, normalScale);
}

export function stoneMaterial(color: number, repeat = 2, normalScale = 1.0): THREE.MeshStandardMaterial {
  return textured('stone', { color, roughness: 0.94, metalness: 0 }, repeat, normalScale);
}

export function barkMaterial(color: number, repeat = 2, normalScale = 1.1): THREE.MeshStandardMaterial {
  return textured('bark', { color, roughness: 0.92, metalness: 0 }, repeat, normalScale);
}

/** Standalone normal map for materials that manage their own composition. */
export function detailNormal(
  kind: 'leather' | 'metal' | 'cloth' | 'flesh' | 'stone' | 'bark',
  repeat: number,
  normalScale = 0.8,
): { map: THREE.CanvasTexture; scale: THREE.Vector2 } {
  const map = mapsFor(kind).normal.clone();
  map.repeat.set(repeat, repeat);
  map.needsUpdate = true;
  return { map, scale: new THREE.Vector2(normalScale, normalScale) };
}
