import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ZoneLayout } from '../content/types';
import { createProps } from './props';

const materialHooks = vi.hoisted(() => ({ barkBeforeCompile: 0 }));

// Prop materials build procedural canvas textures; keep this contract test
// headless with plain standard materials.
vi.mock('./materials', async () => {
  const three = await import('three');
  return {
    barkMaterial: () => {
      const material = new three.MeshStandardMaterial();
      material.onBeforeCompile = () => {
        materialHooks.barkBeforeCompile += 1;
      };
      return material;
    },
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

type ShaderStub = Parameters<THREE.Material['onBeforeCompile']>[0];

function stubShader(): ShaderStub {
  return {
    vertexShader: '#include <common>\n#include <begin_vertex>\nvoid main() {}\n',
    fragmentShader: '#include <common>\nvoid main() {\n}\n',
  } as unknown as ShaderStub;
}

function runPatch(material: THREE.Material): ShaderStub {
  const shader = stubShader();
  material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return shader;
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
    expect(tree.scale.x).toBeCloseTo(tree.authoredScale.x, 6);
    expect(tree.scale.y).toBeCloseTo(tree.authoredScale.y, 6);
    expect(tree.scale.z).toBeCloseTo(tree.authoredScale.z, 6);
    expect(tree.scale.x).toBeCloseTo(beforeProbe.sample[0].scale.x, 6);

    // The fade lives in the per-instance attribute, not the matrix.
    const fadeAttribute = meshes[0].geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute;
    expect(fadeAttribute).toBeDefined();
    expect(fadeAttribute.getX(0)).toBeGreaterThan(0.9);
    for (let i = 0; i < meshes.length; i++) {
      expect(Array.from(meshes[i].instanceMatrix.array)).toEqual(Array.from(before[i]));
    }

    // The standard material carries the attribute/varying and the Bayer gate,
    // and chains the material's original onBeforeCompile.
    const standard = meshes[0].material as THREE.MeshStandardMaterial;
    const standardShader = runPatch(standard);
    expect(materialHooks.barkBeforeCompile).toBe(1);
    expect(standardShader.vertexShader).toContain('attribute float instanceFade;');
    expect(standardShader.vertexShader).toContain('varying float vInstanceFade;');
    expect(standardShader.vertexShader).toContain('vInstanceFade = instanceFade;');
    expect(standardShader.fragmentShader).toContain('ashenBayer4(gl_FragCoord.xy)');
    expect(standardShader.fragmentShader).toContain('vInstanceFade >');
    expect(standardShader.fragmentShader).toContain('discard;');
    expect(standard.customProgramCacheKey()).toBe('ashen-prop-instance-fade-v1');

    // The matching depth material carries the same patch and cache key.
    const depth = meshes[0].customDepthMaterial as THREE.MeshDepthMaterial;
    expect(depth).toBe(meshes[1].customDepthMaterial);
    const depthShader = runPatch(depth);
    expect(depthShader.vertexShader).toContain('attribute float instanceFade;');
    expect(depthShader.vertexShader).toContain('vInstanceFade = instanceFade;');
    expect(depthShader.fragmentShader).toContain('ashenBayer4(gl_FragCoord.xy)');
    expect(depthShader.fragmentShader).toContain('vInstanceFade >');
    expect(depthShader.fragmentShader).toContain('discard;');
    expect(depth.customProgramCacheKey()).toBe('ashen-prop-instance-fade-depth-v1');

    // A renamed three shader chunk fails loudly instead of silently dropping
    // the dither.
    const broken = {
      vertexShader: '#include <common>\n',
      fragmentShader: '#include <common>\nvoid main() {\n}\n',
    } as unknown as ShaderStub;
    expect(() => standard.onBeforeCompile(broken, null as unknown as THREE.WebGLRenderer))
      .toThrow(/begin_vertex/);

    // Moving away releases the fade; matrices stay frozen.
    for (let i = 0; i < 60; i++) view.update(camera, 20, 20, 1 / 60);
    expect(view.probe().occluded).toBe(0);
    for (let i = 0; i < meshes.length; i++) {
      expect(Array.from(meshes[i].instanceMatrix.array)).toEqual(Array.from(before[i]));
    }

    view.dispose();
  });
});
