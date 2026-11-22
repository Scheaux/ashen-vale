import * as THREE from 'three';
import type { ClassDef } from '../content/types';
import {
  deathCurve,
  deg,
  HERO_ARM,
  heroMeleeArm,
  heroMeleeTorso,
  heroRangedArm,
  heroRangedTorso,
  hitFlinch,
  idlePose,
  walkPose,
  walkPhaseAdvance,
} from './anim';

export interface HeroPoseInput {
  time: number;
  /** Distance traveled this frame, for the walk phase (feet stay glued). */
  distance: number;
  speedRatio: number;
  attack: number | null;
  attackKind: 'melee' | 'projectile';
  hit: number | null;
  death: number | null;
}

export interface HeroRig {
  root: THREE.Group;
  pose(input: HeroPoseInput): void;
  /** Materials that take the hit flash. */
  flashMaterials: THREE.MeshStandardMaterial[];
}

const HIP_Y = 0.88;

function capsule(radius: number, length: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 12), mat);
  return mesh;
}

/** Limb segment hanging from its joint pivot (down -Y). */
function hangingSegment(radius: number, length: number, mat: THREE.Material): THREE.Mesh {
  const mesh = capsule(radius, length, mat);
  mesh.position.y = -(length / 2 + radius * 0.2);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Jointed hero: hips -> torso -> head/arms, hips -> legs. Every rotation in
 * pose() happens at a real joint pivot, so limbs never stretch or shear.
 * Class variant: build proportions, cloak color and the weapon in handR.
 */
export function createHeroRig(def: ClassDef): HeroRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = new THREE.MeshStandardMaterial({ color: 0x8a7461, roughness: 0.75, metalness: 0 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x241f2b, roughness: 0.85, metalness: 0 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.8, metalness: 0 });
  const accent = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.72, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x55525c, roughness: 0.5, metalness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({
    color: def.color,
    emissive: def.color,
    emissiveIntensity: 1.7,
    roughness: 0.5,
    metalness: 0,
  });
  const flashMaterials = [skin, cloth, leather, accent];

  // Class build: broad (marauder), lean (ranger), average (witch).
  const build = def.id === 'marauder' ? 1.14 : def.id === 'ranger' ? 0.94 : 1;

  // ---- Hips & pelvis ----
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  body.add(hips);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), leather);
  pelvis.scale.set(build, 0.78, 0.88);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // ---- Torso ----
  const torso = new THREE.Group();
  torso.position.y = 0.06;
  hips.add(torso);

  const chest = capsule(0.19 * build, 0.3, cloth);
  chest.position.y = 0.3;
  chest.scale.set(1, 1, 0.82);
  chest.castShadow = true;
  torso.add(chest);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.185 * build, 0.185 * build, 0.09, 14), leather);
  belt.position.y = 0.09;
  torso.add(belt);

  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.105 * build, 12, 9), accent);
    pauldron.position.set(side * 0.235 * build, 0.44, 0);
    pauldron.scale.set(1, 0.72, 1);
    pauldron.castShadow = true;
    torso.add(pauldron);
  }

  // ---- Head & hood ----
  const head = new THREE.Group();
  head.position.y = 0.56;
  torso.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.11, 10), skin);
  neck.position.y = 0.04;
  head.add(neck);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.142, 16, 12), skin);
  skull.position.y = 0.185;
  skull.scale.set(0.92, 1.05, 1);
  skull.castShadow = true;
  head.add(skull);

  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.3, 14), accent);
  hood.position.set(0, 0.245, -0.035);
  hood.rotation.x = -0.22;
  hood.castShadow = true;
  head.add(hood);

  const hoodRim = new THREE.Mesh(new THREE.TorusGeometry(0.148, 0.032, 8, 16), accent);
  hoodRim.position.set(0, 0.155, -0.01);
  hoodRim.rotation.x = Math.PI / 2 - 0.25;
  head.add(hoodRim);

  // Dark eye shadow so the face reads at a distance.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.021, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x120c14 }),
    );
    eye.position.set(side * 0.052, 0.19, 0.125);
    head.add(eye);
  }

  // ---- Arms (shoulder pivot -> elbow pivot -> hand) ----
  function buildArm(side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.245 * build, 0.42, 0);
    torso.add(shoulder);

    const upper = hangingSegment(0.062 * build, HERO_ARM.upper - 0.1, cloth);
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -HERO_ARM.upper;
    shoulder.add(elbow);

    const fore = hangingSegment(0.052, HERO_ARM.fore - 0.1, skin);
    elbow.add(fore);

    const hand = new THREE.Group();
    hand.position.y = -HERO_ARM.fore;
    elbow.add(hand);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), leather);
    fist.castShadow = true;
    hand.add(fist);

    return { shoulder, elbow, hand };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  // ---- Legs (hip pivot -> knee pivot -> foot) ----
  function buildLeg(side: -1 | 1): { hip: THREE.Group; knee: THREE.Group } {
    const hip = new THREE.Group();
    hip.position.set(side * 0.115, -0.02, 0);
    hips.add(hip);

    const thigh = hangingSegment(0.088, 0.32, cloth);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.4;
    hip.add(knee);

    const shin = hangingSegment(0.07, 0.3, leather);
    knee.add(shin);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.08, 0.23), leather);
    foot.position.set(0, -0.42, 0.05);
    foot.castShadow = true;
    knee.add(foot);

    return { hip, knee };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // ---- Cape (rides the torso, sways with motion) ----
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.95, 4, 6), accent);
  cape.position.set(0, 0.3, -0.235);
  cape.rotation.x = 0.16;
  cape.castShadow = true;
  torso.add(cape);

  // ---- Weapon in the right hand ----
  const weapon = new THREE.Group();
  armR.hand.add(weapon);
  if (def.id === 'marauder') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.95, 8), leather);
    handle.position.y = 0.28;
    weapon.add(handle);
    const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.055), metal);
    axeHead.position.set(0.11, 0.68, 0);
    weapon.add(axeHead);
    const axeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.03), glow);
    axeEdge.position.set(0.26, 0.68, 0);
    weapon.add(axeEdge);
  } else if (def.id === 'ranger') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.026, 8, 24, Math.PI), leather);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    bow.position.set(0, 0.1, 0.3);
    weapon.add(bow);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.86, 5), glow);
    string.position.set(0, 0.1, 0.3);
    weapon.add(string);
  } else {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, 1.5, 8), leather);
    staff.position.y = 0.42;
    weapon.add(staff);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), glow);
    orb.position.y = 1.16;
    weapon.add(orb);
    const orbLight = new THREE.PointLight(def.color, 5, 6, 2);
    orbLight.position.copy(orb.position);
    weapon.add(orbLight);
  }

  // Travelling light so the hero lights the moor around them (kept gentle so
  // nearby models keep their color instead of blowing out at close range).
  const light = new THREE.PointLight(0xffb27a, 11, 15, 2);
  light.position.set(0, 2.1, 0.4);
  body.add(light);

  // ---- Animation state ----
  let walkPhase = 0;

  function resetPose(): void {
    hips.position.y = HIP_Y;
    hips.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    armL.shoulder.rotation.set(0, 0, -0.1);
    armR.shoulder.rotation.set(0, 0, 0.1);
    armL.elbow.rotation.set(-deg(12), 0, 0);
    armR.elbow.rotation.set(-deg(12), 0, 0);
    legL.hip.rotation.set(0, 0, 0);
    legR.hip.rotation.set(0, 0, 0);
    legL.knee.rotation.set(0, 0, 0);
    legR.knee.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
  }

  function pose(input: HeroPoseInput): void {
    resetPose();
    walkPhase = walkPhaseAdvance(walkPhase, input.distance);
    const s = input.speedRatio;

    if (input.death !== null) {
      // Death: crumple backward with folded legs and slack arms.
      const d = deathCurve(input.death);
      body.rotation.x = -d.fallRad;
      body.position.y = -0.1 * input.death;
      torso.rotation.x = d.slumpRad * 0.5;
      legL.knee.rotation.x = d.legFoldRad;
      legR.knee.rotation.x = d.legFoldRad * 0.75;
      legL.hip.rotation.x = -deg(18) * input.death;
      armL.shoulder.rotation.x = deg(26) * input.death;
      armR.shoulder.rotation.x = deg(22) * input.death;
      head.rotation.x = -d.slumpRad * 0.4;
      cape.rotation.x = 0.16 + 0.5 * input.death;
      return;
    }

    // Locomotion layer (walk blended by speed, idle breathing underneath).
    const w = walkPose(walkPhase, s);
    const idle = idlePose(input.time);
    const still = 1 - s;

    legL.hip.rotation.x = -w.legForwardL;
    legR.hip.rotation.x = -w.legForwardR;
    legL.knee.rotation.x = w.kneeL;
    legR.knee.rotation.x = w.kneeR;

    hips.position.y = HIP_Y + w.bob + idle.breathe * 0.35 * still;
    hips.rotation.y = w.hipsTwist + idle.sway * 0.5 * still;
    torso.rotation.y = w.torsoTwist;
    torso.rotation.x = idle.breathe * still;
    head.rotation.y = idle.headYaw * still;
    armL.shoulder.rotation.x = -(w.armForwardL + idle.armSway * still);
    armR.shoulder.rotation.x = -(w.armForwardR - idle.armSway * still);

    // Strike layer overrides the right arm and drives the kinetic chain.
    if (input.attack !== null) {
      const p = input.attack;
      const arm = input.attackKind === 'melee' ? heroMeleeArm(p) : heroRangedArm(p);
      const torsoTwist = input.attackKind === 'melee' ? heroMeleeTorso(p) : heroRangedTorso(p);
      armR.shoulder.rotation.x = -arm.raiseRad;
      armR.elbow.rotation.x = -arm.flexRad;
      torso.rotation.y += torsoTwist.twistRad;
      torso.rotation.x += torsoTwist.leanRad;
      // Counterbalance: off arm flares through the swing.
      armL.shoulder.rotation.x += deg(20) * Math.sin(Math.min(1, p) * Math.PI);
    }

    // Hit flinch (additive).
    if (input.hit !== null) {
      const flinch = hitFlinch(input.hit);
      torso.rotation.x += flinch.leanRad;
      head.rotation.x += flinch.headRad;
      armL.shoulder.rotation.x += flinch.armFlareRad;
      armR.shoulder.rotation.x += flinch.armFlareRad * 0.6;
    }

    cape.rotation.x = 0.16 + s * 0.22 + (input.attack !== null ? 0.18 * Math.sin(input.attack * Math.PI) : 0);
  }

  return { root, pose, flashMaterials };
}
