import * as THREE from 'three';
import { getClass } from '../src/content/classes';
import type { ClassId } from '../src/content/types';
import { CameraRig } from '../src/render/camera';
import { createHeroRig } from '../src/render/heroModel';
import { createWorldScene } from '../src/render/scene';
import { disposeMeshTree } from '../src/render/dispose';

const canvas = document.createElement('canvas');
document.body.replaceChildren(canvas);
document.body.style.margin = '0';
const { scene, renderer } = createWorldScene(canvas);
renderer.setSize(innerWidth, innerHeight);
const camera = new CameraRig(innerWidth / innerHeight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ color: 0x333529 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

let hero: ReturnType<typeof createHeroRig> | null = null;
let currentId: ClassId | null = null;

export function renderPose(id: ClassId, view: 'game' | 'close' | 'portrait', pose: 'idle' | 'run' | number): void {
  if (!hero || currentId !== id) {
    if (hero) disposeMeshTree(hero.root);
    hero = createHeroRig(getClass(id));
    currentId = id;
    scene.add(hero.root);
  }
  camera.yaw = view === 'game' ? Math.PI * 0.22 : -0.67;
  camera.pitch = view === 'game' ? 0.78 : 0.33;
  camera.distance = view === 'game' ? 18 : 4.2;
  camera.snapTo(0, 0);
  if (view === 'portrait') {
    camera.camera.position.set(-0.78, 1.77, 1.68);
    camera.camera.lookAt(0, 1.43, 0);
    camera.camera.updateMatrixWorld();
  }
  hero.pose({
    time: 1.5, distance: pose === 'run' ? 0.31 : 0, speedRatio: pose === 'run' ? 1 : 0,
    attack: typeof pose === 'number' ? pose : null, hit: null, death: null,
  });
  renderer.render(scene, camera.camera);
}

export function modelStats() {
  let meshes = 0;
  let triangles = 0;
  hero?.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  return { meshes, triangles, frameCalls: renderer.info.render.calls, frameTriangles: renderer.info.render.triangles };
}
