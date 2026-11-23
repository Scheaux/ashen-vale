import * as THREE from 'three';

/** Dispose a subtree whose geometry, materials, and texture instances it owns. */
export function disposeMeshTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.Light) object.dispose();
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of [object.material].flat()) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}
