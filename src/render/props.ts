import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropKind, PropPlacement, ZoneLayout } from '../content/types';

export interface PropsRenderer {
  group: THREE.Group;
  /** Instanced meshes with their kind, for pointer picking. */
  pickTargets: PropPickTarget[];
  setHighlight(kind: PropKind, instanceId: number): void;
  clearHighlight(): void;
}

export interface PropPickTarget {
  mesh: THREE.InstancedMesh;
  kind: PropKind;
}

const WHITE = new THREE.Color(1, 1, 1);
const HOVER_TINT = new THREE.Color(2.15, 1.95, 1.45);

function deadTreeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 3.6, 7);
  trunk.translate(0, 1.8, 0);
  parts.push(trunk);

  const branches: Array<[number, number, number, number, number]> = [
    // [rotZ, rotY, y, length, tiltX]
    [0.9, 0.3, 2.7, 1.7, 0.35],
    [-0.8, 1.9, 2.9, 1.5, -0.3],
    [1.15, 3.6, 2.2, 1.35, 0.2],
    [-1.05, 5.1, 3.15, 1.2, -0.15],
    [0.35, 2.6, 3.45, 1.0, 0.55],
  ];
  for (const [rotZ, rotY, y, length, tiltX] of branches) {
    const branch = new THREE.CylinderGeometry(0.045, 0.11, length, 5);
    branch.translate(0, length / 2, 0);
    branch.rotateX(tiltX);
    branch.rotateZ(rotZ);
    branch.rotateY(rotY);
    branch.translate(0, y, 0);
    parts.push(branch);
  }
  return mergeGeometries(parts, false) ?? trunk;
}

function rockGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 1);
}

function pillarGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.5, 0.64, 1, 12);
  geo.translate(0, 0.5, 0);
  return geo;
}

function pillarBrokenGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.52, 0.72, 1, 12);
  geo.translate(0, 0.5, 0);
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
      geometry: rockGeometry(),
      material: new THREE.MeshStandardMaterial({ color: 0x4e505a, roughness: 0.92, metalness: 0 }),
      scaleAxes: { x: [0.7, 1.7], y: [0.55, 1.15], z: [0.7, 1.7] },
    },
    deadTree: {
      geometry: deadTreeGeometry(),
      material: new THREE.MeshStandardMaterial({ color: 0x32261a, roughness: 0.95, metalness: 0 }),
      scaleAxes: { x: [0.85, 1.15], y: [0.85, 1.3], z: [0.85, 1.15] },
    },
    pillar: {
      geometry: pillarGeometry(),
      material: new THREE.MeshStandardMaterial({ color: 0x6b665c, roughness: 0.9, metalness: 0 }),
      scaleAxes: { x: [0.9, 1.1], y: [2.4, 4.3], z: [0.9, 1.1] },
    },
    pillarBroken: {
      geometry: pillarBrokenGeometry(),
      material: new THREE.MeshStandardMaterial({ color: 0x625d54, roughness: 0.9, metalness: 0 }),
      scaleAxes: { x: [0.9, 1.1], y: [0.9, 1.8], z: [0.9, 1.1] },
    },
  };
}

/** Derive a stable per-instance scale blend from the placement (no RNG here). */
function axisScale(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

export function createProps(layout: ZoneLayout): PropsRenderer {
  const style = styles();
  const group = new THREE.Group();
  const pickTargets: PropPickTarget[] = [];
  const meshes = new Map<PropKind, THREE.InstancedMesh>();

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
    const mesh = new THREE.InstancedMesh(s.geometry, s.material, placements.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    placements.forEach((p, i) => {
      // Deterministic per-instance variation derived from placement values.
      const t1 = (Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1;
      const t2 = (Math.sin(p.x * 39.3468 + p.z * 11.135) * 24634.6345) % 1;
      const a = Math.abs(t1);
      const b = Math.abs(t2);

      position.set(p.x, -0.08, p.z);
      euler.set(p.tilt * 0.8, p.rotation, p.tilt);
      quaternion.setFromEuler(euler);
      scale.set(
        axisScale(s.scaleAxes.x[0], s.scaleAxes.x[1], a) * p.scale,
        axisScale(s.scaleAxes.y[0], s.scaleAxes.y[1], b) * p.scale,
        axisScale(s.scaleAxes.z[0], s.scaleAxes.z[1], b) * p.scale,
      );
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, WHITE);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    meshes.set(kind, mesh);
    pickTargets.push({ mesh, kind });
    group.add(mesh);
  }

  let highlighted: { mesh: THREE.InstancedMesh; id: number } | null = null;

  function clearHighlight(): void {
    if (!highlighted) return;
    highlighted.mesh.setColorAt(highlighted.id, WHITE);
    if (highlighted.mesh.instanceColor) highlighted.mesh.instanceColor.needsUpdate = true;
    highlighted = null;
  }

  function setHighlight(kind: PropKind, instanceId: number): void {
    const mesh = meshes.get(kind);
    if (!mesh) return;
    if (highlighted && highlighted.mesh === mesh && highlighted.id === instanceId) return;
    clearHighlight();
    mesh.setColorAt(instanceId, HOVER_TINT);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    highlighted = { mesh, id: instanceId };
  }

  return { group, pickTargets, setHighlight, clearHighlight };
}
