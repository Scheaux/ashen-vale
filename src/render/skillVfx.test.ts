import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { slashArcGeometry, slashArcRotation } from './skillVfx';

/** World-space angle of the crescent's centroid, using the game's atan2(x,z) convention. */
function slashCentroidAngle(facing: number, arcDeg = 120): number {
  const geometry = slashArcGeometry(arcDeg);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = slashArcRotation(facing);
  mesh.updateMatrixWorld(true);

  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const count = position.count;
  const vertex = new THREE.Vector3();
  let x = 0;
  let z = 0;
  for (let i = 0; i < count; i++) {
    vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    x += vertex.x;
    z += vertex.z;
  }

  const angle = Math.atan2(x / count, z / count);
  geometry.dispose();
  material.dispose();
  return angle;
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

describe('Cleave slash arc', () => {
  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI])(
    'centres the crescent on facing %f',
    (facing) => {
      const angle = slashCentroidAngle(facing);
      expect(Math.abs(angleDelta(angle, facing))).toBeLessThan(1e-6);
    },
  );

  it('also centres the narrower dash arc', () => {
    const facing = Math.PI / 3;
    const angle = slashCentroidAngle(facing, 40);
    expect(Math.abs(angleDelta(angle, facing))).toBeLessThan(1e-6);
  });
});
