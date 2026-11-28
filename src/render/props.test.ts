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
      material.onBeforeCompile = (shader) => {
        materialHooks.barkBeforeCompile += 1;
        shader.vertexShader += '\n// bark-previous-hook';
        shader.fragmentShader += '\n// bark-previous-hook';
      };
      material.customProgramCacheKey = () => 'bark-base-cache';
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
    expect(standardShader.vertexShader).toContain('// bark-previous-hook');
    expect(standardShader.fragmentShader).toContain('// bark-previous-hook');
    expect(standardShader.vertexShader).toContain('attribute float instanceFade;');
    expect(standardShader.vertexShader).toContain('varying float vInstanceFade;');
    expect(standardShader.vertexShader).toContain('vInstanceFade = instanceFade;');
    expect(standardShader.fragmentShader).toContain('ashenBayer4(gl_FragCoord.xy)');
    expect(standardShader.fragmentShader).toContain('vInstanceFade >');
    expect(standardShader.fragmentShader).toContain('discard;');
    expect(standard.customProgramCacheKey()).toContain('bark-base-cache');
    expect(standard.customProgramCacheKey()).toContain('ashen-prop-instance-fade-v1');

    // The matching depth material carries the same patch and cache key.
    const depth = meshes[0].customDepthMaterial as THREE.MeshDepthMaterial;
    expect(depth).toBe(meshes[1].customDepthMaterial);
    const depthShader = runPatch(depth);
    expect(depthShader.vertexShader).toContain('attribute float instanceFade;');
    expect(depthShader.vertexShader).toContain('vInstanceFade = instanceFade;');
    expect(depthShader.fragmentShader).toContain('ashenBayer4(gl_FragCoord.xy)');
    expect(depthShader.fragmentShader).toContain('vInstanceFade >');
    expect(depthShader.fragmentShader).toContain('discard;');
    expect(depth.customProgramCacheKey()).toContain('ashen-prop-instance-fade-depth-v1');

    // A renamed three shader chunk fails loudly instead of silently dropping
    // the dither.
    const broken = {
      vertexShader: '#include <common>\n',
      fragmentShader: '#include <common>\nvoid main() {\n}\n',
    } as unknown as ShaderStub;
    expect(() => standard.onBeforeCompile(broken, null as unknown as THREE.WebGLRenderer))
      .toThrow(/begin_vertex/);

    // QA fade hook: a forced instance ignores update until released.
    expect(view.forceFadeAt(0, 0, 0)).toBe(true);
    for (let i = 0; i < 10; i++) view.update(camera, -1, -1, 1 / 60);
    expect(view.probe().sample[0].fade).toBe(0);
    expect(view.forceFadeAt(1234, 5678, 0.5)).toBe(false);
    expect(view.forceFadeAt(0, 0, null)).toBe(true);
    for (let i = 0; i < 60; i++) view.update(camera, -1, -1, 1 / 60);
    expect(view.probe().sample[0].fade).toBeGreaterThan(0.9);

    // Moving away releases the fade; matrices stay frozen.
    for (let i = 0; i < 60; i++) view.update(camera, 20, 20, 1 / 60);
    expect(view.probe().occluded).toBe(0);
    for (let i = 0; i < meshes.length; i++) {
      expect(Array.from(meshes[i].instanceMatrix.array)).toEqual(Array.from(before[i]));
    }

    view.dispose();
  });

  it('holds a prop faded across the radial and t-band deadbands', () => {
    const view = createProps(layout());
    const camera = new THREE.PerspectiveCamera();
    const step = (playerX: number, playerZ: number, frames = 30) => {
      for (let i = 0; i < frames; i++) view.update(camera, playerX, playerZ, 1 / 60);
    };
    const fade = () => view.probe().sample[0].fade;
    expect(view.probe().sample[0].kind).toBe('deadTree');

    // Start inside the enter band.
    camera.position.set(10, 6, 0);
    step(-10, 0, 60);
    expect(fade()).toBeGreaterThan(0.99);

    // Radial deadband: 1.7..2.05 is outside enter 1.65 but inside release 2.1.
    for (const z of [1.7, 2.05, 1.8, 2.0, 1.9]) {
      camera.position.set(10, 6, z);
      step(-10, z, 6);
      expect(fade()).toBeGreaterThan(0.99);
    }

    // Past the release radius the prop may fade, and jittering back into the
    // enter-but-not-release gap must not re-trigger it.
    camera.position.set(10, 6, 2.2);
    step(-10, 2.2, 60);
    expect(fade()).toBeLessThan(0.01);
    expect(view.probe().occluded).toBe(0);
    for (const z of [1.9, 1.7, 2.0]) {
      camera.position.set(10, 6, z);
      step(-10, z, 10);
      expect(fade()).toBeLessThan(0.01);
    }

    // Re-enter, then jitter across the t-band release edge (0.99): t stays in
    // (0.97, 0.99) so an already-faded instance must stay faded.
    camera.position.set(10, 6, 0);
    step(-10, 0, 60);
    expect(fade()).toBeGreaterThan(0.99);
    for (const playerX of [-0.26, -0.14, -0.2]) {
      step(playerX, 0, 6);
      expect(fade()).toBeGreaterThan(0.99);
    }

    // t > 0.99 releases, and re-entering the (0.97, 0.99) gap must not re-trigger.
    step(-0.05, 0, 60);
    expect(fade()).toBeLessThan(0.01);
    for (const playerX of [-0.2, -0.26, -0.14]) {
      step(playerX, 0, 10);
      expect(fade()).toBeLessThan(0.01);
    }

    // Lower t-band: camera (1) / player (-15.7) gives t ≈ 0.060, inside the
    // release band (0.05) but below enter (0.08); a faded prop must hold.
    camera.position.set(10, 6, 0);
    step(-10, 0, 60);
    expect(fade()).toBeGreaterThan(0.99);
    camera.position.set(1, 6, 0);
    step(-15.7, 0, 30);
    expect(fade()).toBeGreaterThan(0.99);

    // t ≈ 0.031 releases, and returning to t ≈ 0.060 must not re-trigger.
    camera.position.set(0.5, 6, 0);
    step(-15.7, 0, 60);
    expect(fade()).toBeLessThan(0.01);
    camera.position.set(1, 6, 0);
    step(-15.7, 0, 10);
    expect(fade()).toBeLessThan(0.01);

    view.dispose();
  });
});
