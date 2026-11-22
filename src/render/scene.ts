import * as THREE from 'three';

export interface WorldScene {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}

/** Dark-fantasy scene: cold moonlight key, warm ember rim, fog, moon disc. */
export function createWorldScene(canvas: HTMLCanvasElement): WorldScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x0b1120);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(skyColor.getHex(), 0.0105);

  // Cold moonlight key with shadows over the play area.
  const key = new THREE.DirectionalLight(0xb9c6ff, 2.7);
  key.position.set(28, 40, 20);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 140;
  const S = 48;
  key.shadow.camera.left = -S;
  key.shadow.camera.right = S;
  key.shadow.camera.top = S;
  key.shadow.camera.bottom = -S;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  // Warm horizon rim, as if the moor smoulders beyond the ridge.
  const rim = new THREE.DirectionalLight(0xff8a4c, 0.6);
  rim.position.set(-32, 9, -28);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight(0x2b3a5c, 0x140f0a, 0.85);
  scene.add(hemi);

  // Moon disc + halo (fog-exempt so it reads at distance).
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(7, 48),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }),
  );
  moon.position.set(-72, 48, -96);
  moon.lookAt(0, 10, 0);
  scene.add(moon);

  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(14, 48),
    new THREE.MeshBasicMaterial({
      color: 0x8fa8e8,
      transparent: true,
      opacity: 0.14,
      fog: false,
      depthWrite: false,
    }),
  );
  halo.position.copy(moon.position).lerp(new THREE.Vector3(0, 10, 0), 0.02);
  halo.lookAt(0, 10, 0);
  scene.add(halo);

  return { scene, renderer };
}
