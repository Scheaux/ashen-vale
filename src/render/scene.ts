import * as THREE from 'three';
import type { ZoneId } from '../content/types';

export interface WorldScene {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  lights: {
    key: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
  };
  moon: THREE.Mesh;
  halo: THREE.Mesh;
  fog: THREE.FogExp2;
}

const MOOR_SKY = 0x0b1120;
const MOOR_FOG_DENSITY = 0.0105;
const MOON_POSITION = new THREE.Vector3(-72, 48, -96);
const MOON_TARGET = new THREE.Vector3(0, 10, 0);
const HALO_POSITION = MOON_POSITION.clone().lerp(MOON_TARGET, 0.02);

/**
 * Retint/reaim the existing lights, fog and sky for a zone. No lights are
 * created or destroyed, so the shadow pass budget is unchanged by a swap.
 * 5.0a only has the moor preset; the ossuary art pass lands in 5.0c.
 */
export function applyZoneAtmosphere(world: WorldScene, zoneId: ZoneId): void {
  if (zoneId === 'drowned-ossuary') {
    // Placeholder for 5.0c: keep the moor identity until the ossuary palette,
    // candle-gold rim, low teal mist and hidden moon/halo are authored.
    return;
  }

  const { scene, lights, moon, halo, fog } = world;

  const background = scene.background;
  if (background instanceof THREE.Color) background.setHex(MOOR_SKY);
  else scene.background = new THREE.Color(MOOR_SKY);

  fog.color.setHex(MOOR_SKY);
  fog.density = MOOR_FOG_DENSITY;
  scene.fog = fog;

  // Cold moonlight key with shadows over the play area.
  lights.key.color.setHex(0xb9c6ff);
  lights.key.intensity = 2.7;
  lights.key.position.set(28, 40, 20);
  lights.key.target.position.set(0, 0, 0);

  // Warm horizon rim, as if the moor smoulders beyond the ridge.
  lights.rim.color.setHex(0xff8a4c);
  lights.rim.intensity = 0.6;
  lights.rim.position.set(-32, 9, -28);

  lights.hemi.color.setHex(0x2b3a5c);
  lights.hemi.groundColor.setHex(0x140f0a);
  lights.hemi.intensity = 0.85;

  // Moon disc + halo (fog-exempt so it reads at distance).
  moon.visible = true;
  moon.position.copy(MOON_POSITION);
  moon.lookAt(MOON_TARGET);
  const moonMaterial = moon.material as THREE.MeshBasicMaterial;
  moonMaterial.color.setHex(0xdfe8ff);
  moonMaterial.fog = false;

  halo.visible = true;
  halo.position.copy(HALO_POSITION);
  halo.lookAt(MOON_TARGET);
  const haloMaterial = halo.material as THREE.MeshBasicMaterial;
  haloMaterial.color.setHex(0x8fa8e8);
  haloMaterial.opacity = 0.14;
  haloMaterial.fog = false;
  haloMaterial.depthWrite = false;
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
  // Three r187 removed PCFSoftShadowMap for WebGL; it warns and resolves to PCF.
  // Use PCF directly to keep the shadow filter explicit and warning-free.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(MOOR_SKY);
  const fog = new THREE.FogExp2(MOOR_SKY, MOOR_FOG_DENSITY);
  scene.fog = fog;

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
  moon.position.copy(MOON_POSITION);
  moon.lookAt(MOON_TARGET);
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
  halo.position.copy(HALO_POSITION);
  halo.lookAt(MOON_TARGET);
  scene.add(halo);

  const world: WorldScene = { scene, renderer, lights: { key, rim, hemi }, moon, halo, fog };
  applyZoneAtmosphere(world, 'ashen-moor');
  return world;
}
