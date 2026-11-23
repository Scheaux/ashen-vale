import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { disposeMeshTree } from './dispose';

it('detaches an owned subtree and disposes shared-in-tree resources exactly once', () => {
  const parent = new THREE.Group();
  const tree = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const map = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map, roughnessMap: map });
  const disposeGeometry = vi.spyOn(geometry, 'dispose');
  const disposeMaterial = vi.spyOn(material, 'dispose');
  const disposeTexture = vi.spyOn(map, 'dispose');
  parent.add(tree);
  tree.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material]));

  disposeMeshTree(tree);

  expect(parent.children).toHaveLength(0);
  for (const dispose of [disposeGeometry, disposeMaterial, disposeTexture]) {
    expect(dispose).toHaveBeenCalledTimes(1);
  }
});
