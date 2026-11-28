import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ZoneLayout } from '../content/types';
import { createProps } from './props';

// Prop materials build procedural canvas textures; keep this contract test
// headless with plain standard materials.
vi.mock('./materials', async () => {
  const three = await import('three');
  return {
    barkMaterial: () => new three.MeshStandardMaterial(),
    stoneMaterial: () => new three.MeshStandardMaterial(),
  };
});

function layout(): ZoneLayout {
  return {
    props: [
      { kind: 'deadTree', x: 0, z: 0, rotation: 0, scale: 1, tilt: 0 },
      { kind: 'rock', x: 6, z: 6, rotation: 0, scale: 1, tilt: 0 },
    ],
  } as unknown as ZoneLayout;
}

describe('PropsView occlusion fade', () => {
  it('fades through the instance attribute without rewriting instance matrices', () => {
    const view = createProps(layout());
    const meshes = view.group.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    );
    const before = meshes.map((mesh) => Float32Array.from(mesh.instanceMatrix.array));
    const beforeProbe = view.probe();

    // Camera at +x/+z of the tree, hero on the far side: the tree sits
    // between them and must fade.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 6, 10);
    for (let i = 0; i < 60; i++) view.update(camera, -1, -1, 1 / 60);

    const probe = view.probe();
    const tree = probe.sample[0];
    expect(probe.occluded).toBe(1);
    expect(tree.kind).toBe('deadTree');
    expect(tree.fade).toBeGreaterThan(0.9);
    expect(tree.scale.x).toBeCloseTo(tree.authoredScale.x, 7);
    expect(tree.scale.y).toBeCloseTo(tree.authoredScale.y, 7);
    expect(tree.scale.z).toBeCloseTo(tree.authoredScale.z, 7);
    expect(tree.scale.x).toBeCloseTo(beforeProbe.sample[0].scale.x, 7);

    // The fade lives in the per-instance attribute, not the matrix.
    const fadeAttribute = meshes[0].geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute;
    expect(fadeAttribute).toBeDefined();
    expect(fadeAttribute.getX(0)).toBeGreaterThan(0.9);
    for (let i = 0; i < meshes.length; i++) {
      expect(Array.from(meshes[i].instanceMatrix.array)).toEqual(Array.from(before[i]));
    }
    expect(meshes[0].customDepthMaterial).toBe(meshes[1].customDepthMaterial);
    expect(meshes[0].customDepthMaterial?.customProgramCacheKey()).toContain('depth');

    // Moving away releases the fade; matrices stay frozen.
    for (let i = 0; i < 60; i++) view.update(camera, 20, 20, 1 / 60);
    expect(view.probe().occluded).toBe(0);
    for (let i = 0; i < meshes.length; i++) {
      expect(Array.from(meshes[i].instanceMatrix.array)).toEqual(Array.from(before[i]));
    }

    view.dispose();
  });
});
