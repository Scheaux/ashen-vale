import * as THREE from 'three';
import type { ClassId } from '../content/types';
import { beveledBox, latheProfile, sweptTube } from './geo';
import { addHeroDetail } from './heroPortrait';

interface Materials {
  leather: THREE.Material;
  accent: THREE.MeshStandardMaterial;
  metal: THREE.Material;
  trim: THREE.Material;
}

export interface RobePanel {
  root: THREE.Group;
  geometry: THREE.PlaneGeometry;
  restDepth: Float32Array;
}

function seam(points: number[][], radius: number): THREE.BufferGeometry {
  return sweptTube(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), points.map(() => radius), 9);
}

/** Distinguish the cast by silhouette first, then by color and trim. */
export function dressHero(id: ClassId, torso: THREE.Group, hips: THREE.Group, head: THREE.Group, mat: Materials): RobePanel[] {
  if (id === 'marauder') {
    const plate = new THREE.Mesh(new THREE.SphereGeometry(0.17, 36, 22, 0, Math.PI, 0.42, 2.28), mat.metal);
    plate.position.set(0, 0.318, 0.14);
    plate.scale.set(1.18, 0.86, 0.58);
    plate.rotation.x = 0.14;
    plate.castShadow = true;
    torso.add(plate);
    const chestTrim = [
      seam([[-0.153, 0.365, 0.211], [-0.115, 0.337, 0.229], [0, 0.306, 0.254],
        [0.115, 0.337, 0.229], [0.153, 0.365, 0.211]], 0.0065),
      seam([[-0.139, 0.423, 0.177], [-0.072, 0.442, 0.202], [0, 0.448, 0.222],
        [0.072, 0.442, 0.202], [0.139, 0.423, 0.177]], 0.006),
    ];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) chestTrim.push(new THREE.SphereGeometry(0.009, 10, 6)
        .translate(side * (0.152 - i * 0.010), 0.398 - i * 0.048, 0.183 + i * 0.012));
    }
    const badge = new THREE.OctahedronGeometry(0.030, 1).scale(0.72, 1, 0.35).translate(0, 0.383, 0.249);
    addHeroDetail(torso, mat.trim, [...chestTrim, badge], 'marauder-cuirass-inlay');
    const shoulder = new THREE.Group();
    shoulder.position.set(-0.282, 0.457, 0.012);
    shoulder.rotation.z = 0.21;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.151, 34, 20, 0, Math.PI * 2, 0, Math.PI * 0.68), mat.metal);
    dome.scale.set(1.14, 0.82, 1.1);
    dome.castShadow = true;
    shoulder.add(dome);
    for (let i = 0; i < 3; i++) {
      const lame = new THREE.Mesh(beveledBox(0.09, 0.080, 0.25 - i * 0.032, 0.021, 3), i === 1 ? mat.accent : mat.metal);
      lame.position.set(-0.112 - i * 0.005, -0.047 - i * 0.046, 0.003);
      lame.rotation.z = -0.25;
      shoulder.add(lame);
    }
    addHeroDetail(shoulder, mat.trim, Array.from({ length: 6 }, (_, i) => {
      const a = (i - 2.5) * 0.40;
      return new THREE.SphereGeometry(0.010, 12, 7).translate(-Math.cos(a) * 0.165, 0.025, Math.sin(a) * 0.159);
    }));
    torso.add(shoulder);
    return [];
  }

  if (id === 'ranger') {
    const quiver = new THREE.Group();
    quiver.position.set(0.20, 0.35, -0.235);
    quiver.rotation.z = -0.35;
    const caseMesh = new THREE.Mesh(latheProfile([[0.033, -0.24], [0.052, -0.233], [0.065, -0.211],
      [0.064, -0.165], [0.071, 0.05], [0.078, 0.196], [0.083, 0.211], [0.071, 0.225], [0.062, 0.207]], 30), mat.leather);
    caseMesh.castShadow = true;
    quiver.add(caseMesh);
    addHeroDetail(quiver, mat.trim, [
      new THREE.TorusGeometry(0.077, 0.008, 8, 28).rotateX(Math.PI / 2).translate(0, 0.211, 0),
      new THREE.TorusGeometry(0.066, 0.009, 8, 26).rotateX(Math.PI / 2).translate(0, -0.18, 0),
    ]);
    addHeroDetail(quiver, mat.leather, Array.from({ length: 4 }, (_, i) =>
      new THREE.CylinderGeometry(0.007, 0.008, 0.24, 9).translate((i - 1.5) * 0.028, 0.286 + i % 2 * 0.037, 0)));
    addHeroDetail(quiver, mat.accent, Array.from({ length: 4 }, (_, i) =>
      beveledBox(0.029, 0.076, 0.021, 0.005, 2).rotateY(i * 0.8)
        .translate((i - 1.5) * 0.028, 0.389 + i % 2 * 0.037, 0)));
    torso.add(quiver);
    addHeroDetail(torso, mat.accent, [
      seam([[-0.145, 0.437, 0.085], [-0.104, 0.401, 0.151], [-0.061, 0.356, 0.175],
        [-0.078, 0.236, 0.135], [-0.085, 0.111, 0.125]], 0.010),
      seam([[0.130, 0.442, 0.091], [0.106, 0.383, 0.151], [0.111, 0.284, 0.146],
        [0.099, 0.213, 0.132], [0.075, 0.108, 0.122]], 0.010),
    ], 'ranger-tailored-seams');
    const pouch = new THREE.Mesh(beveledBox(0.151, 0.112, 0.090, 0.026, 3), mat.leather);
    pouch.rotation.y = -0.41;
    pouch.position.set(-0.174, 0.014, 0.095);
    hips.add(pouch);
    addHeroDetail(hips, mat.trim, [beveledBox(0.035, 0.022, 0.015, 0.004, 2).translate(-0.174, 0.027, 0.145)]);
    return [];
  }

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.175, 0.125, 0.19, 30, 5, true, Math.PI * 0.53, Math.PI * 0.94),
    mat.accent,
  );
  collar.position.set(0, 0.052, -0.014);
  collar.rotation.x = -0.18;
  collar.castShadow = true;
  head.add(collar);
  const pendant = new THREE.Mesh(new THREE.OctahedronGeometry(0.037, 1), mat.trim);
  pendant.scale.set(0.61, 1.16, 0.45);
  pendant.position.set(0, 0.307, 0.171);
  torso.add(pendant);
  addHeroDetail(torso, mat.trim, [
    seam([[-0.101, 0.471, 0.086], [-0.076, 0.407, 0.154], [0, 0.329, 0.173],
      [0.076, 0.407, 0.154], [0.101, 0.471, 0.086]], 0.0055),
  ]);

  // Separate coat fronts keep the boots readable and can follow each thigh.
  const robeMaterial = mat.accent.clone();
  robeMaterial.vertexColors = true;
  return [-1, 1].map((side) => {
    const panel = new THREE.Group();
    panel.position.set(side * 0.129, 0.026, 0.154);
    panel.rotation.y = side * 0.37;
    const geometry = new THREE.PlaneGeometry(0.21, 0.50, 16, 22);
    const attr = geometry.attributes.position;
    const restDepth = new Float32Array(attr.count);
    const colors: number[] = [];
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const t = 0.5 - attr.getY(i) / 0.50;
      restDepth[i] = 0.015 + Math.cos(x * 54 + t * 2) * 0.024 * t;
      attr.setXYZ(i, x * (1 + 0.29 * t) + side * t * 0.028, -t * 0.50 + t * Math.abs(x) * 0.22,
        restDepth[i]);
      const edge = Math.abs(x) >= 0.091 || t > 0.9;
      if (edge) colors.push(0.87, 0.77, 1);
      else colors.push(0.44, 0.38, 0.62);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const cloth = new THREE.Mesh(geometry, robeMaterial);
    cloth.castShadow = true;
    cloth.frustumCulled = false;
    panel.add(cloth);
    hips.add(panel);
    return { root: panel, geometry, restDepth };
  });
}
