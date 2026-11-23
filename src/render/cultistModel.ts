import * as THREE from 'three';
import type { EnemyDef } from '../content/enemies';
import {
  deathCurve,
  deg,
  hitFlinch,
  huskSlamArm,
  huskSlamLean,
  idlePose,
  type CreaturePoseInput,
} from './anim';
import { clothMaterial, leatherMaterial } from './materials';

/**
 * Cinder Cultist: a hooded, robe-clad caster that hovers instead of walking.
 * The right arm charges and releases the bolt (same tested strike curve as
 * the husk's slam), and the staff orb brightens through the windup so the
 * telegraph reads even before the ground indicator.
 */
export function createCultistRig(def: EnemyDef): {
  root: THREE.Group;
  pickTarget: THREE.Mesh;
  flashMaterials: THREE.MeshStandardMaterial[];
  pose(input: CreaturePoseInput): void;
} {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const robe = clothMaterial(def.color, 3, 0.85);
  const trim = leatherMaterial(0x1c1216, 3, 0.8);
  const flashMaterials = [robe, trim];
  const glow = new THREE.MeshStandardMaterial({
    color: def.eyeColor,
    emissive: def.eyeColor,
    emissiveIntensity: 1.6,
    roughness: 0.5,
    metalness: 0,
  });

  // Robe body (no legs — the cultist hovers).
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 12), robe);
  skirt.position.y = 0.55;
  skirt.castShadow = true;
  body.add(skirt);

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.26, 5, 12), robe);
  chest.position.y = 1.12;
  chest.castShadow = true;
  body.add(chest);
  const pickTarget = chest;

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.035, 8, 16), trim);
  belt.position.y = 0.95;
  belt.rotation.x = Math.PI / 2;
  body.add(belt);

  // Hood + skull + burning eyes.
  const head = new THREE.Group();
  head.position.y = 1.44;
  body.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.34, 12), robe);
  hood.position.y = 0.16;
  hood.rotation.x = -0.18;
  hood.castShadow = true;
  head.add(hood);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), trim);
  face.position.set(0, 0.1, 0.07);
  head.add(face);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), glow);
    eye.position.set(side * 0.05, 0.13, 0.165);
    head.add(eye);
  }

  // Arms: right casts, left counter-balances.
  function buildArm(side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.21, 1.22, 0);
    body.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 5, 10), robe);
    upper.position.y = -0.12;
    upper.castShadow = true;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.24;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.047, 0.14, 5, 10), robe);
    fore.position.y = -0.11;
    fore.castShadow = true;
    elbow.add(fore);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.055, 9, 7), trim);
    fist.position.y = -0.22;
    elbow.add(fist);
    return { shoulder, elbow };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Staff in the right hand with a charge orb.
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 1.35, 8), trim);
  staff.position.set(0.02, 0.28, 0.02);
  staff.rotation.x = -0.12;
  armR.elbow.add(staff);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), glow);
  orb.position.set(0.02, 0.95, 0.12);
  armR.elbow.add(orb);
  const orbLight = new THREE.PointLight(def.eyeColor, 4, 6, 2);
  orbLight.position.copy(orb.position);
  armR.elbow.add(orbLight);

  function resetPose(): void {
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    armL.shoulder.rotation.set(0, 0, -0.18);
    armR.shoulder.rotation.set(0, 0, 0.12);
    armL.elbow.rotation.set(-deg(16), 0, 0);
    armR.elbow.rotation.set(-deg(12), 0, 0);
    glow.emissiveIntensity = 1.6;
    orbLight.intensity = 4;
  }

  function pose(input: CreaturePoseInput): void {
    resetPose();
    const idle = idlePose(input.time);
    const s = input.speedRatio;

    // Hover drift instead of a walk cycle; slight forward lean when moving.
    body.position.y = Math.sin(input.time * 1.25) * 0.05 + idle.breathe * 0.4;
    body.rotation.x = s * 0.12;
    body.rotation.z = idle.sway * 0.8;
    head.rotation.y = idle.headYaw * 1.1;
    armL.shoulder.rotation.x = -(idle.armSway * 1.4 + s * 0.15);

    if (input.attack !== null) {
      const p = input.attack;
      const arm = huskSlamArm(p);
      armR.shoulder.rotation.x = -arm.raiseRad;
      armR.elbow.rotation.x = -arm.flexRad;
      body.rotation.x += huskSlamLean(p) * 0.6;
      // Orb charge: brighten through the windup, flash at release.
      const charge = Math.min(1, p / 0.42);
      glow.emissiveIntensity = 1.6 + charge * 3.2;
      orbLight.intensity = 4 + charge * 22;
    }

    if (input.hit !== null) {
      const flinch = hitFlinch(input.hit);
      body.rotation.x += flinch.leanRad;
      head.rotation.x += flinch.headRad;
    }

    if (input.death !== null) {
      const d = deathCurve(input.death);
      body.rotation.x = -d.fallRad * 0.85;
      body.position.y = -0.35 * input.death;
      head.rotation.x = d.slumpRad * 0.6;
      glow.emissiveIntensity = 1.6 * (1 - input.death * 0.85);
      orbLight.intensity = 4 * (1 - input.death);
    }
  }

  return { root, pickTarget, flashMaterials, pose };
}
