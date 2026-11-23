import * as THREE from 'three';
import { BASIC_ATTACK_CONTACT } from '../content/skills';
import { clamp } from '../core/math';
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
  keyLerp,
} from './anim';
import { beveledBox, latheProfile, sweptTube } from './geo';
import { advanceHeroStride, attackStance, bowPose, HERO_GAIT, HERO_LEG, solveHeroLeg, strideFoot } from './heroMotion';
import { clothMaterial, fleshMaterial, leatherMaterial, metalMaterial } from './materials';

export interface HeroPoseInput {
  time: number;
  /** Distance traveled this frame, for the walk phase (feet stay glued). */
  distance: number;
  speedRatio: number;
  attack: number | null;
  turn?: number;
  hit: number | null;
  death: number | null;
}

export interface HeroRig {
  root: THREE.Group;
  pose(input: HeroPoseInput): void;
  /** Materials that take the hit flash. */
  flashMaterials: THREE.MeshStandardMaterial[];
}

const HIP_Y = 0.85;

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

  const skin = fleshMaterial(0x8a7461, 2.5, 0.55);
  const cloth = clothMaterial(0x241f2b, 3, 0.8);
  const leather = leatherMaterial(0x4a3826, 3, 0.85);
  const accent = clothMaterial(def.color, 3, 0.8);
  accent.side = THREE.DoubleSide;
  const metal = metalMaterial(0x888797, 2.5, 0.7);
  metal.metalness = 0.49; // The moor has no environment probe.
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
  const gait = HERO_GAIT[def.id];

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
  const buckle = new THREE.Mesh(beveledBox(0.089, 0.066, 0.03, 0.009, 2), metal);
  buckle.position.set(0, 0.09, 0.173 * build);
  torso.add(buckle);
  const sash = new THREE.Mesh(beveledBox(0.074, 0.41, 0.034, 0.009, 2), def.id === 'marauder' ? metal : leather);
  sash.position.set(0.012, 0.29, 0.148 * build);
  sash.rotation.z = -0.55;
  torso.add(sash);

  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.105 * build, 12, 9), accent);
    pauldron.position.set(side * 0.235 * build, 0.44, 0);
    pauldron.scale.set(1, 0.72, 1);
    pauldron.castShadow = true;
    torso.add(pauldron);
  }

  // ---- Head & hood ----
  const head = new THREE.Group();
  head.name = 'hero-head';
  head.position.y = 0.56;
  torso.add(head);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.11, 10), skin);
  neck.position.y = 0.04;
  head.add(neck);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.136, 16, 12), skin);
  skull.position.y = 0.185;
  skull.scale.set(0.92, 1.05, 1);
  skull.castShadow = true;
  head.add(skull);

  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.166, 18, 12, Math.PI - 0.31, Math.PI + 0.62, 0, 2.42), accent);
  hood.position.set(0, 0.192, -0.013);
  hood.scale.set(1.05, def.id === 'witch' ? 1.48 : 1.18, 1.05);
  hood.castShadow = true;
  head.add(hood);

  const scarf = new THREE.Mesh(new THREE.SphereGeometry(0.132, 16, 8), def.id === 'marauder' ? leather : cloth);
  scarf.scale.set(1.06, 0.47, 1.03);
  scarf.position.set(0, 0.126, 0.019);
  head.add(scarf);
  const browPoints = Array.from({ length: 17 }, (_, i) => {
    const angle = Math.PI * i / 16;
    const fore = Math.sin(angle);
    return new THREE.Vector3(0.145 * Math.cos(angle), 0.183 + fore * (def.id === 'witch' ? 0.134 : 0.121), 0.038 + fore * 0.064);
  });
  const brow = new THREE.Mesh(sweptTube(browPoints, browPoints.map(() => 0.014), 6), def.id === 'marauder' ? metal : accent);
  head.add(brow);

  // Dark eye shadow so the face reads at a distance.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x120c14 }),
    );
    eye.position.set(side * 0.052, 0.198, 0.125);
    head.add(eye);
  }

  // ---- Arms (shoulder pivot -> elbow pivot -> hand) ----
  function buildArm(side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.name = side < 0 ? 'hero-shoulder-left' : 'hero-shoulder-right';
    shoulder.position.set(side * 0.245 * build, 0.42, 0);
    torso.add(shoulder);

    const upper = hangingSegment(0.062 * build, HERO_ARM.upper - 0.1, cloth);
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.name = side < 0 ? 'hero-elbow-left' : 'hero-elbow-right';
    elbow.position.y = -HERO_ARM.upper;
    shoulder.add(elbow);

    const fore = hangingSegment(0.052, HERO_ARM.fore - 0.1, skin);
    elbow.add(fore);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.055, 0.13, 10), def.id === 'marauder' ? metal : leather);
    cuff.position.y = -0.17;
    elbow.add(cuff);

    const hand = new THREE.Group();
    hand.name = side < 0 ? 'hero-hand-left' : 'hero-hand-right';
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
  const legRoot = new THREE.Group();
  body.add(legRoot);
  function buildLeg(side: -1 | 1): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group } {
    const hip = new THREE.Group();
    hip.position.set(side * 0.115, -HERO_LEG.hipOffset, 0);
    legRoot.add(hip);

    const thigh = hangingSegment(0.088, 0.32, cloth);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -HERO_LEG.upper;
    hip.add(knee);

    const shin = hangingSegment(0.07, 0.3, leather);
    knee.add(shin);

    const ankle = new THREE.Group();
    ankle.name = side < 0 ? 'hero-ankle-left' : 'hero-ankle-right';
    ankle.position.y = -HERO_LEG.lower;
    knee.add(ankle);
    const foot = new THREE.Mesh(beveledBox(0.138, 0.096, 0.25, 0.025, 2), leather);
    foot.position.z = 0.053;
    foot.castShadow = true;
    ankle.add(foot);

    return { hip, knee, ankle };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // ---- Cape (rides the torso, sways with motion) ----
  const capeColumns = 10;
  const capeRows = 12;
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, capeColumns, capeRows), accent);
  cape.position.set(0, 0.45, -0.178);
  cape.frustumCulled = false;
  cape.castShadow = true;
  torso.add(cape);

  // ---- Weapon attached to its grip hand ----
  const weapon = new THREE.Group();
  weapon.name = 'hero-weapon';
  (def.id === 'ranger' ? armL.hand : armR.hand).add(weapon);
  let bowstring: ((tension: number, showArrow?: boolean) => void) | null = null;
  let staffLight: THREE.PointLight | null = null;
  if (def.id === 'marauder') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.95, 10), leather);
    handle.position.y = 0.28;
    weapon.add(handle);
    // Bevelled axe head so the edge catches highlights.
    const axeHead = new THREE.Mesh(beveledBox(0.3, 0.2, 0.055, 0.012, 2), metal);
    axeHead.position.set(0.11, 0.68, 0);
    weapon.add(axeHead);
    const axeEdge = new THREE.Mesh(beveledBox(0.055, 0.22, 0.03, 0.008, 1), glow);
    axeEdge.position.set(0.26, 0.68, 0);
    weapon.add(axeEdge);
  } else if (def.id === 'ranger') {
    // Swept bow: tapered limbs along a curved path, thickest at the grip.
    const centers: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const a = (t - 0.5) * 2.4;
      centers.push(new THREE.Vector3(0, Math.sin(a) * 0.53, -(1 - Math.cos(a)) * 0.32));
      radii.push(0.035 - 0.022 * Math.pow(Math.abs(2 * t - 1), 1.1));
    }
    const bow = new THREE.Mesh(sweptTube(centers, radii, 8), leather);
    bow.castShadow = true;
    weapon.add(bow);
    const stringMaterial = new THREE.MeshBasicMaterial({ color: 0xc7ba98 });
    const stringGeometry = new THREE.CylinderGeometry(0.005, 0.005, 1, 5);
    const strings = [new THREE.Mesh(stringGeometry, stringMaterial), new THREE.Mesh(stringGeometry, stringMaterial)];
    const ends = [centers[0], centers[centers.length - 1]];
    const knot = new THREE.Vector3();
    const nock = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.53, 6), metal);
    const arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.072, 5), metal);
    const arrow = new THREE.Group();
    arrow.name = 'hero-nocked-arrow';
    shaft.position.y = 0.265;
    arrowTip.position.y = 0.55;
    arrow.add(shaft, arrowTip);
    weapon.add(...strings, arrow);
    bowstring = (tension, showArrow = false) => {
      knot.addVectors(ends[0], ends[1]).multiplyScalar(0.5);
      if (tension > 0) knot.lerp(weapon.worldToLocal(armR.hand.getWorldPosition(nock)), tension);
      for (let i = 0; i < 2; i++) {
        axis.subVectors(knot, ends[i]);
        strings[i].position.addVectors(knot, ends[i]).multiplyScalar(0.5);
        strings[i].scale.y = axis.length();
        strings[i].quaternion.setFromUnitVectors(up, axis.normalize());
      }
      arrow.visible = showArrow;
      if (showArrow) {
        arrow.position.copy(knot);
        arrow.quaternion.setFromUnitVectors(up, axis.set(0, 0.04, 0.12).sub(knot).normalize());
      }
    };
  } else {
    // Lathed staff with a knopped head under the orb.
    const staff = new THREE.Mesh(
      latheProfile(
        [
          [0.032, 0],
          [0.046, 0.07],
          [0.033, 0.5],
          [0.028, 1.0],
          [0.042, 1.32],
          [0.026, 1.42],
          [0.018, 1.46],
        ],
        14,
      ),
      leather,
    );
    staff.position.set(0.02, -0.35, 0.02);
    weapon.add(staff);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.035, 0.08, 10), metal);
    collar.position.set(0.02, 1.075, 0.02);
    weapon.add(collar);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), glow);
    orb.position.set(0.02, 1.16, 0.02);
    weapon.add(orb);
    const orbLight = new THREE.PointLight(def.color, 5, 6, 2);
    orbLight.position.copy(orb.position);
    weapon.add(orbLight);
    staffLight = orbLight;
  }

  // Travelling light so the hero lights the moor around them (kept gentle so
  // nearby models keep their color instead of blowing out at close range).
  const light = new THREE.PointLight(0xffb27a, 11, 15, 2);
  light.position.set(0, 2.1, 0.56);
  light.intensity = 7;
  body.add(light);

  // ---- Animation state ----
  let walkPhase = 0;
  const weaponGrip = def.id === 'ranger' ? armL : armR;
  const wristSpace = new THREE.Quaternion();
  const weaponAim = new THREE.Quaternion();
  const weaponAngles = new THREE.Euler();

  function aimWeapon(x: number, y: number, z: number): void {
    wristSpace.copy(weaponGrip.shoulder.quaternion).multiply(weaponGrip.elbow.quaternion).invert();
    weaponAim.setFromEuler(weaponAngles.set(x, y, z));
    weapon.quaternion.copy(wristSpace).multiply(weaponAim);
  }

  function drapeCape(time: number, speed: number, turn: number, strike: number, fallen = 0): void {
    const vertices = cape.geometry.attributes.position;
    for (let col = 0; col <= capeColumns; col++) {
      const across = 2 * col / capeColumns - 1;
      let y = 0;
      let z = 0;
      for (let row = 0; row <= capeRows; row++) {
        const down = row / capeRows;
        if (row > 0) {
          const spread = 0.14 + speed * 0.9 + fallen * 0.72 + strike * 0.26;
          const angle = spread * (0.45 + 0.55 * down)
            + Math.sin(time * (3 + 3 * speed) - down * 6 + across * 2.8) * down * (0.08 + 0.17 * speed);
          const segment = gait.cape * 0.88 / capeRows;
          y -= Math.cos(angle) * segment;
          z -= Math.sin(angle) * segment;
        }
        const x = across * (0.193 + down * 0.108) + turn * down * down * 0.19;
        vertices.setXYZ(row * (capeColumns + 1) + col, x, y + across * across * down * 0.038, z);
      }
    }
    vertices.needsUpdate = true;
    cape.geometry.computeVertexNormals();
  }

  function resetPose(): void {
    hips.position.y = HIP_Y;
    hips.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    armL.shoulder.rotation.set(0, 0, -0.1);
    armR.shoulder.rotation.set(0, 0, 0.1);
    armL.elbow.rotation.set(-deg(12), 0, 0);
    armR.elbow.rotation.set(-deg(12), 0, 0);
    legRoot.position.set(0, HIP_Y, 0);
    for (const leg of [legL, legR]) {
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
      leg.ankle.rotation.set(0, 0, 0);
    }
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
  }

  function pose(input: HeroPoseInput): void {
    resetPose();
    walkPhase = advanceHeroStride(walkPhase, input.distance, gait.stride);
    const s = clamp(input.speedRatio, 0, 1);
    const turn = clamp(input.turn ?? 0, -1, 1);
    const contact = input.attack;
    const stance = contact === null ? null : attackStance(def.id, contact);

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
      aimWeapon(0, 0, -0.24);
      bowstring?.(0);
      if (staffLight) staffLight.intensity = 3;
      drapeCape(input.time, 0, 0, 0, input.death);
      return;
    }

    const cycle = walkPhase * 2 * Math.PI;
    const swing = Math.sin(cycle);
    const idle = idlePose(input.time);
    const still = 1 - s;
    const hipBob = -Math.cos(2 * cycle) * gait.bob * 0.45;
    hips.position.y = HIP_Y - s * 0.14 + hipBob * s + idle.breathe * 0.24 * still - (stance?.drop ?? 0);
    hips.position.z = stance?.shift ?? 0;
    legRoot.position.copy(hips.position);
    for (const [leg, side] of [[legL, -1], [legR, 1]] as const) {
      const path = strideFoot(walkPhase + (side < 0 ? 0 : 0.5), gait.stride, gait.lift);
      const lead = -side * (stance?.spread ?? 0) - (stance?.shift ?? 0);
      const foot = solveHeroLeg(hips.position.y - HERO_LEG.hipOffset - HERO_LEG.ankle - path.lift * s,
        path.z * s + lead, path.pitch * s);
      leg.hip.rotation.x = foot.hip;
      leg.knee.rotation.x = foot.knee;
      leg.ankle.rotation.x = foot.ankle;
    }

    hips.rotation.y = swing * 0.11 * s + idle.sway * 0.35 * still + (stance?.hips ?? 0);
    torso.rotation.y = -swing * 0.19 * s;
    torso.rotation.x = gait.lean * s + idle.breathe * still;
    torso.rotation.z = swing * 0.035 * s - turn * 0.16 * s;
    head.rotation.x = -torso.rotation.x * 0.55;
    head.rotation.y = idle.headYaw * still - turn * 0.25 * s;
    armL.shoulder.rotation.x = -swing * gait.arm * s - idle.armSway * still - 0.12;
    armR.shoulder.rotation.x = swing * gait.arm * s + idle.armSway * still - 0.10;
    armL.elbow.rotation.x = -0.23 - 0.65 * s;
    armR.elbow.rotation.x = -0.23 - 0.65 * s;

    let pitch = def.id === 'marauder' ? 0.26 : -0.08;
    let roll = def.id === 'ranger' ? 0.5 : -0.24;
    let tension = 0;
    if (def.id === 'ranger' && contact === null) {
      armL.shoulder.rotation.x = -0.40 - swing * 0.19 * s;
      armL.elbow.rotation.x = -0.43 - 0.23 * s;
    }
    if (def.id === 'witch') {
      armR.shoulder.rotation.x -= 0.18;
      armR.elbow.rotation.x = -0.5 - 0.12 * s;
    }
    if (contact !== null && stance) {
      const p = contact;
      if (def.id === 'ranger') {
        const draw = bowPose(p);
        armL.shoulder.rotation.x = -draw.bowRaise;
        armL.elbow.rotation.x = -draw.bowFlex;
        armR.shoulder.rotation.x = -draw.drawRaise;
        armR.shoulder.rotation.y = draw.drawYaw;
        armR.elbow.rotation.x = -draw.drawFlex;
        head.rotation.y -= stance.hips * 0.8;
        roll = 0.5 - 0.45 * stance.weight;
        tension = draw.tension;
      } else {
        const axe = def.id === 'marauder';
        const arm = axe ? heroMeleeArm(p) : heroRangedArm(p);
        const upperBody = axe ? heroMeleeTorso(p) : heroRangedTorso(p);
        armR.shoulder.rotation.x = -arm.raiseRad;
        armR.elbow.rotation.x = -arm.flexRad;
        torso.rotation.y += upperBody.twistRad * 0.58;
        torso.rotation.x += upperBody.leanRad;
        if (axe) {
          armR.shoulder.rotation.y = keyLerp(p, [[0, 0], [0.26, 0.65], [0.45, -0.13], [0.72, -0.66], [1, 0]]);
          armL.shoulder.rotation.x += 0.34 * stance.weight;
          pitch = keyLerp(p, [[0, 0.26], [0.27, -0.37], [0.45, 0.64], [0.72, 1.17], [1, 0.26]]);
          roll -= 0.9 * Math.sin(p * Math.PI);
        } else {
          armL.shoulder.rotation.x -= 0.87 * stance.weight;
          armL.elbow.rotation.x -= 0.62 * stance.weight;
          pitch = keyLerp(p, [[0, -0.08], [0.33, -0.32], [0.6, 0.7], [0.84, 0.19], [1, -0.08]]);
        }
      }
    }
    if (staffLight) {
      const energy = contact === null ? 0 : keyLerp(contact, [[0, 0], [0.44, 0.6], [0.6, 1], [0.79, 0.22], [1, 0]]);
      staffLight.intensity = 4 + energy * 13;
      glow.emissiveIntensity = 1.7 + energy * 2.8;
    }
    // Hit flinch (additive).
    if (input.hit !== null) {
      const flinch = hitFlinch(input.hit);
      torso.rotation.x += flinch.leanRad;
      head.rotation.x += flinch.headRad;
      armL.shoulder.rotation.x += flinch.armFlareRad;
      armR.shoulder.rotation.x += flinch.armFlareRad * 0.6;
    }

    aimWeapon(pitch, def.id === 'ranger' ? -hips.rotation.y * 0.72 : armR.shoulder.rotation.y * 0.9, roll);
    bowstring?.(tension, contact !== null && contact >= 0.27 && contact < BASIC_ATTACK_CONTACT.projectile);
    drapeCape(input.time, s, turn, stance?.weight ?? 0);
  }

  return { root, pose, flashMaterials };
}
