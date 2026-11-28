import * as THREE from 'three';
import type { Vec2 } from '../content/types';
import { beveledBox } from './geo';
import { disposeMeshTree } from './dispose';
import { stoneMaterial } from './materials';
import type { TerrainSurface } from './terrainSurface';

const ARCH_RADIUS = 3.1;
const ARCH_TUBE = 0.34;
const ARCH_CENTER_Y = 3.25;
const PORTAL_TRIGGER_RADIUS = 3.8;

export interface PortalProbe {
  x: number;
  z: number;
  /** 0 while sealed, 1 when fully open. */
  open: number;
  /** True once the open transition is visually dominant. */
  isOpen: boolean;
  glow: number;
}

export interface PortalView {
  group: THREE.Group;
  /** Animate the seal breaking and the gate coming alive after the boss dies. */
  sync(open: boolean, elapsed: number, dt: number): void;
  /** Point-on-ground test used by clicking the arch. */
  contains(x: number, z: number): boolean;
  probe(): PortalProbe;
  dispose(): void;
}

function portalGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(220, 255, 250, 0.95)');
  gradient.addColorStop(0.32, 'rgba(112, 236, 222, 0.65)');
  gradient.addColorStop(0.72, 'rgba(44, 151, 158, 0.24)');
  gradient.addColorStop(1, 'rgba(12, 55, 64, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The Warden's Gate: a ruined stone ring standing behind the end clearing.
 * It is a sealed, near-opaque black mirror until the Warden falls, then the
 * veil burns teal and two counter-rotating rune rings wake up. Travel is not
 * wired yet; interaction only reports that the ossuary is still sealed.
 */
export function createPortal(portal: Vec2, terrain: TerrainSurface): PortalView {
  const group = new THREE.Group();
  const baseY = terrain.heightAt(portal.x, portal.z);
  group.position.set(portal.x, baseY, portal.z);

  const stone = stoneMaterial(0x5b554b, 2.1, 0.95);
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(ARCH_RADIUS, ARCH_TUBE, 14, 56),
    stone,
  );
  arch.position.y = ARCH_CENTER_Y;
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  // Two squat buttresses and a keystone make the ring read as built, not dropped.
  const buttressGeo = beveledBox(0.95, 1.55, 1.05, 0.06, 2);
  for (const side of [-1, 1]) {
    const buttress = new THREE.Mesh(buttressGeo, stone);
    buttress.position.set(side * (ARCH_RADIUS - 0.1), 0.75, 0);
    buttress.rotation.z = side * 0.08;
    buttress.castShadow = true;
    buttress.receiveShadow = true;
    group.add(buttress);
  }
  const keystone = new THREE.Mesh(beveledBox(1.05, 0.75, 0.8, 0.05, 2), stone);
  keystone.position.set(0, ARCH_CENTER_Y + ARCH_RADIUS + 0.18, 0);
  keystone.castShadow = true;
  keystone.receiveShadow = true;
  group.add(keystone);

  const sealGeo = new THREE.RingGeometry(2.5, 3.65, 56);
  sealGeo.rotateX(-Math.PI / 2);
  const seal = new THREE.Mesh(
    sealGeo,
    new THREE.MeshBasicMaterial({
      color: 0x14181a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  seal.position.y = 0.02;
  group.add(seal);

  const veilClosed = new THREE.Mesh(
    new THREE.CircleGeometry(ARCH_RADIUS - ARCH_TUBE - 0.04, 56),
    new THREE.MeshBasicMaterial({
      color: 0x060b0d,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  veilClosed.position.y = ARCH_CENTER_Y;
  group.add(veilClosed);

  const glowTexture = portalGlowTexture();
  const veilOpen = new THREE.Mesh(
    new THREE.CircleGeometry(ARCH_RADIUS - ARCH_TUBE - 0.04, 56),
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: 0x7ff4e6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  veilOpen.position.y = ARCH_CENTER_Y;
  group.add(veilOpen);

  const rimGlow = new THREE.Mesh(
    new THREE.TorusGeometry(ARCH_RADIUS + 0.06, 0.11, 10, 56),
    new THREE.MeshBasicMaterial({
      color: 0x67e8d7,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  rimGlow.position.y = ARCH_CENTER_Y;
  group.add(rimGlow);

  const runeRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.25, 0.055, 8, 48),
    new THREE.MeshBasicMaterial({
      color: 0xb9fff4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  runeRing.position.y = ARCH_CENTER_Y;
  group.add(runeRing);

  const reelRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.04, 8, 40),
    new THREE.MeshBasicMaterial({
      color: 0x3fc7bd,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  reelRing.position.y = ARCH_CENTER_Y;
  group.add(reelRing);

  const closedMaterial = veilClosed.material as THREE.MeshBasicMaterial;
  const openMaterial = veilOpen.material as THREE.MeshBasicMaterial;
  const rimMaterial = rimGlow.material as THREE.MeshBasicMaterial;
  const runeMaterial = runeRing.material as THREE.MeshBasicMaterial;
  const reelMaterial = reelRing.material as THREE.MeshBasicMaterial;

  let openAmount = 0;
  let glow = 0;

  function sync(open: boolean, elapsed: number, dt: number): void {
    const target = open ? 1 : 0;
    openAmount += (target - openAmount) * (1 - Math.exp(-3.4 * Math.max(0, dt)));
    if (Math.abs(openAmount - target) < 0.002) openAmount = target;
    glow = openAmount;

    closedMaterial.opacity = 0.94 * (1 - openAmount);
    openMaterial.opacity = 0.62 * openAmount;
    rimMaterial.opacity = 0.9 * openAmount;
    runeMaterial.opacity = 0.8 * openAmount;
    reelMaterial.opacity = 0.55 * openAmount;

    runeRing.rotation.z = elapsed * 0.45;
    reelRing.rotation.z = -elapsed * 0.75;
    rimGlow.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.012 * openAmount);
    sealMaterialOpacity(openAmount);
  }

  function sealMaterialOpacity(amount: number): void {
    const material = seal.material as THREE.MeshBasicMaterial;
    material.opacity = 0.55 * (1 - amount * 0.75);
    material.color.setHex(amount > 0.5 ? 0x2a8f8c : 0x14181a);
  }

  function contains(x: number, z: number): boolean {
    return Math.hypot(x - portal.x, z - portal.z) <= PORTAL_TRIGGER_RADIUS;
  }

  function probe(): PortalProbe {
    return { x: portal.x, z: portal.z, open: openAmount, isOpen: openAmount > 0.5, glow };
  }

  return {
    group,
    sync,
    contains,
    probe,
    dispose() {
      glowTexture.dispose();
      disposeMeshTree(group);
    },
  };
}
