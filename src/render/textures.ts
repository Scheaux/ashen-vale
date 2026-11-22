import * as THREE from 'three';
import { noise2D } from '../core/noise';

/** Procedural grayscale ground detail texture (tiling). */
export function createGroundTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise2D(x * 0.085, y * 0.085) * 0.55 + noise2D(x * 0.29, y * 0.29) * 0.32;
      const v = Math.max(0, Math.min(255, Math.round(168 + n * 105)));
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v - 5;
      img.data[i + 2] = v - 13;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(34, 34);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
