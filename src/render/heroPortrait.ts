import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ClassId } from '../content/types';
import { latheProfile, sweptTube } from './geo';

interface PortraitMaterials {
  skin: THREE.Material;
  cloth: THREE.Material;
  accent: THREE.Material;
  metal: THREE.Material;
  trim: THREE.Material;
  leather: THREE.Material;
}

/** Combine static trim on one joint without combining any animated rig parts. */
export function addHeroDetail(parent: THREE.Group, material: THREE.Material, parts: THREE.BufferGeometry[], name?: string): void {
  const flat = parts.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry);
  const combined = mergeGeometries(flat, false);
  for (let i = 0; i < parts.length; i++) {
    if (flat[i] !== parts[i]) flat[i].dispose();
    parts[i].dispose();
  }
  if (!combined) throw new Error('Incompatible hero trim geometry');
  const mesh = new THREE.Mesh(combined, material);
  if (name) mesh.name = name;
  parent.add(mesh);
}

/** Surface with evenly spaced rings and a controllable opening/deformation per ring. */
function skinSurface(rows: number, columns: number, vertex: (u: number, v: number) => THREE.Vector3): THREE.BufferGeometry {
  const points: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      points.push(...vertex(u, v).toArray());
      uv.push(u, v);
      if (row < rows && col < columns) {
        const a = row * (columns + 1) + col;
        const c = a + columns + 1;
        index.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function tubing(points: number[][], radius: number, segments = 8): THREE.BufferGeometry {
  return sweptTube(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), points.map(() => radius), segments);
}

function eyeShape(side: number, y: number, z: number, width: number, height: number): THREE.ShapeGeometry {
  const x = side * 0.049;
  const shape = new THREE.Shape();
  shape.moveTo(x - width, y);
  shape.quadraticCurveTo(x, y + height + side * 0.003, x + width, y + side * 0.004);
  shape.quadraticCurveTo(x, y - height, x - width, y);
  return new THREE.ShapeGeometry(shape, 10).translate(0, 0, z);
}

function rangerFace(): THREE.BufferGeometry {
  const rings = [
    [0.061, 0.024, 0.063, 0.06], [0.080, 0.052, 0.089, 0.083],
    [0.111, 0.083, 0.113, 0.097], [0.143, 0.103, 0.121, 0.107],
    [0.179, 0.113, 0.120, 0.111], [0.220, 0.109, 0.115, 0.108],
    [0.255, 0.100, 0.106, 0.105], [0.290, 0.071, 0.080, 0.082],
    [0.313, 0.004, 0.009, 0.009],
  ];
  const bell = (x: number, width: number) => Math.exp(-((x / width) ** 2));
  return skinSurface(48, 56, (u, v) => {
    const q = v * (rings.length - 1);
    const a = rings[Math.min(Math.floor(q), rings.length - 2)];
    const b = rings[Math.min(Math.floor(q) + 1, rings.length - 1)];
    const t = q - Math.min(Math.floor(q), rings.length - 2);
    const lerp = (i: number) => THREE.MathUtils.lerp(a[i], b[i], t);
    const angle = u * Math.PI * 2 - Math.PI;
    const facing = Math.cos(angle);
    const x = Math.sin(angle) * lerp(1);
    const y = lerp(0);
    const eye = Math.abs(x) - 0.048;
    const z = facing * lerp(facing > 0 ? 2 : 3) + Math.max(0, facing) ** 2 * (
      0.049 * bell(x, 0.023) * bell(y - 0.161, 0.030)
      + 0.014 * bell(x, 0.025) * bell(y - 0.202, 0.041)
      + 0.022 * bell(eye, 0.038) * bell(y - 0.223, 0.014)
      - 0.011 * bell(eye, 0.023) * bell(y - 0.200, 0.013)
      + 0.018 * bell(Math.abs(x) - 0.068, 0.041) * bell(y - 0.164, 0.024)
    );
    return new THREE.Vector3(x, y, z);
  });
}

function hoodPoint(witch: boolean, u: number, v: number): THREE.Vector3 {
  const bulge = Math.sin(Math.PI * (0.18 + v * 0.81));
  const radius = (0.147 + (witch ? 0.014 : 0)) * bulge + 0.003;
  const open = (witch ? 0.86 : 0.99) * (1 - THREE.MathUtils.smoothstep(v, 0.70, 0.95));
  const a = open + u * (Math.PI * 2 - 2 * open);
  const folds = 1 + 0.05 * Math.cos(5 * a + v * 5) * Math.sin(v * Math.PI);
  return new THREE.Vector3(
    Math.sin(a) * radius * folds,
    0.063 + v * (witch ? 0.347 : 0.270),
    Math.cos(a) * radius * folds - 0.024 - v ** 5 * (witch ? 0.075 : 0.055),
  );
}

function visorShape(points: number[][], z: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.008, bevelSize: bevel, bevelThickness: bevel * 0.65, bevelSegments: 3, curveSegments: 8,
  }).translate(0, 0, z);
}

export function buildHeroPortrait(head: THREE.Group, id: ClassId, mat: PortraitMaterials): void {
  const neck = new THREE.Mesh(latheProfile([[0.071, 0], [0.063, 0.037], [0.067, 0.090]], 24), id === 'ranger' ? mat.skin : mat.cloth);
  head.add(neck);
  if (id === 'marauder') {
    const helmet = new THREE.Mesh(latheProfile([
      [0.080, 0.055], [0.101, 0.070], [0.116, 0.107], [0.126, 0.157], [0.136, 0.205],
      [0.144, 0.238], [0.141, 0.273], [0.126, 0.301], [0.098, 0.322], [0.058, 0.337], [0.001, 0.343],
    ], 48), mat.metal);
    helmet.scale.z = 0.98;
    helmet.castShadow = true;
    helmet.name = 'marauder-riveted-helm';
    head.add(helmet);
    const slit = new THREE.Mesh(visorShape([[-0.109, 0.229], [-0.074, 0.241], [0, 0.228], [0.074, 0.241],
      [0.109, 0.229], [0.078, 0.207], [0, 0.202], [-0.078, 0.207]], 0.127, 0.003), mat.cloth);
    head.add(slit);
    const bands = [
      tubing([[-0.115, 0.245, 0.095], [-0.081, 0.256, 0.129], [0, 0.248, 0.155],
        [0.081, 0.256, 0.129], [0.115, 0.245, 0.095]], 0.014, 12),
      tubing([[0, 0.247, 0.159], [0, 0.290, 0.138], [0, 0.333, 0.087], [0, 0.354, 0.006], [0, 0.336, -0.070]], 0.017, 12),
      visorShape([[-0.016, 0.242], [0.016, 0.242], [0.021, 0.142], [0, 0.116], [-0.020, 0.142]], 0.153, 0.005),
    ];
    for (const side of [-1, 1]) {
      bands.push(tubing([[side * 0.106, 0.213, 0.100], [side * 0.096, 0.173, 0.112], [side * 0.057, 0.106, 0.112]], 0.011, 10));
      for (let i = 0; i < 4; i++) {
        const x = 0.025 + i * 0.023;
        bands.push(new THREE.SphereGeometry(0.0085, 10, 6).translate(side * x, 0.159 + i * 0.007, 0.131 - i * 0.006));
      }
    }
    addHeroDetail(head, mat.trim, bands, 'marauder-helm-rivets');
    const wrap = new THREE.Mesh(latheProfile([[0.069, 0.012], [0.091, 0.063], [0.092, 0.087]], 28), mat.accent);
    head.add(wrap);
    return;
  }

  const witch = id === 'witch';
  const hood = new THREE.Mesh(skinSurface(28, 44, (u, v) => hoodPoint(witch, u, v)), mat.accent);
  hood.castShadow = true;
  hood.name = witch ? 'witch-tailored-cowl' : 'ranger-tailored-hood';
  head.add(hood);
  const rim = [
    ...Array.from({ length: 19 }, (_, i) => hoodPoint(witch, 0, THREE.MathUtils.lerp(0.04, 0.95, i / 18))),
    ...Array.from({ length: 18 }, (_, i) => hoodPoint(witch, 1, THREE.MathUtils.lerp(0.932, 0.04, i / 17))),
  ];
  const trim = sweptTube(rim, rim.map(() => witch ? 0.008 : 0.007), 10);
  head.add(new THREE.Mesh(trim, witch ? mat.trim : mat.leather));
  const cowl = new THREE.Mesh(latheProfile([
    [0.064, 0.016], [0.089, 0.025], [0.094, 0.045], [0.089, 0.056],
    [0.101, 0.073], [0.098, 0.088], [0.093, 0.105], [0.080, 0.118],
  ], 32), mat.cloth);
  head.add(cowl);

  if (witch) {
    const lining = new THREE.Mesh(new THREE.SphereGeometry(0.113, 24, 16), mat.cloth);
    lining.scale.set(0.99, 1.11, 0.98);
    lining.position.set(0, 0.181, 0.012);
    head.add(lining);
    const mask = new THREE.Mesh(skinSurface(28, 36, (u, v) => {
      const across = 2 * u - 1;
      const taper = Math.sin(Math.PI * (0.13 + 0.86 * v)) ** 0.53;
      const x = across * 0.112 * taper;
      const y = 0.074 + v * 0.223 + across * across * (0.052 * (1 - v) - 0.012 * v);
      return new THREE.Vector3(x, y, 0.081 + 0.059 * (1 - across * across)
        + 0.021 * (1 - Math.abs(across)) ** 4 * Math.sin(Math.PI * v));
    }), mat.metal);
    mask.name = 'witch-porcelain-mask';
    mask.castShadow = true;
    head.add(mask);
    addHeroDetail(head, mat.cloth, [-1, 1].map((side) => eyeShape(side, 0.210, 0.154, 0.030, 0.010)), 'witch-mask-eye-slits');
    addHeroDetail(head, mat.trim, [
      visorShape([[0, 0.288], [0.019, 0.263], [0, 0.242], [-0.019, 0.263]], 0.147, 0.004),
      ...[-1, 1].map((side) => tubing([[side * 0.082, 0.233, 0.129], [side * 0.068, 0.190, 0.145],
        [side * 0.036, 0.147, 0.155], [side * 0.016, 0.113, 0.150]], 0.0045)),
    ]);
    return;
  }

  const face = new THREE.Mesh(rangerFace(), mat.skin);
  face.name = 'ranger-sculpted-face';
  face.castShadow = true;
  head.add(face);
  const eyes = new THREE.MeshBasicMaterial({ color: 0x141219 });
  addHeroDetail(head, eyes, [-1, 1].map((side) => eyeShape(side, 0.199, 0.117, 0.020, 0.012)), 'ranger-stitched-eye-line');
  addHeroDetail(head, mat.trim, [-1, 1].map((side) =>
    new THREE.SphereGeometry(0.006, 12, 8).scale(0.84, 1, 0.45).translate(side * 0.049, 0.199, 0.121)));
  const scarf = new THREE.Mesh(skinSurface(15, 36, (u, v) => {
    const a = (u - 0.5) * Math.PI * 1.44;
    return new THREE.Vector3(Math.sin(a) * (0.092 + v * 0.028),
      0.058 + v * (0.103 - 0.025 * Math.abs(u - 0.5) * 2),
      Math.cos(a) * (0.093 + v * 0.048) + 0.009 * Math.sin(v * 5.4 * Math.PI + a * 1.6));
  }), mat.cloth);
  scarf.castShadow = true;
  head.add(scarf);
}
