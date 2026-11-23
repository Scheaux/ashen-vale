import * as THREE from 'three';
import type { EnemyDef } from '../content/enemies';
import {
  deathCurve,
  deg,
  HUSK_ARM,
  hitFlinch,
  huskSlamArm,
  huskSlamLean,
  idlePose,
  walkPose,
  walkPhaseAdvance,
  type CreaturePoseInput,
} from './anim';
import { clothMaterial, fleshMaterial } from './materials';

interface HuskJoints {
  body: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  elbowL: THREE.Group;
  armR: THREE.Group;
  elbowR: THREE.Group;
  legL: THREE.Group;
  kneeL: THREE.Group;
  legR: THREE.Group;
  kneeR: THREE.Group;
}

export interface HuskRig {
  root: THREE.Group;
  /** Torso mesh doubles as the pointer-pick target. */
  pickTarget: THREE.Mesh;
  pose(input: CreaturePoseInput): void;
  flashMaterials: THREE.MeshStandardMaterial[];
  /** Joint angles are exposed for measurement tests. */
  joints: HuskJoints;
}

const HIP_Y = 0.72;
const TORSO_LEAN = deg(38); // permanent hunch

function hangingSegment(radius: number, length: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 10), mat);
  mesh.position.y = -(length / 2 + radius * 0.2);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Ashen Husk: a hunched, long-armed ghoul rig with joint pivots at the
 * shoulders/elbows/hips/knees. The two-arm slam has a high chamber
 * (anticipation) so the same pose becomes the slice-3 telegraph.
 */
export function createHuskRig(def: EnemyDef): HuskRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const flesh = fleshMaterial(def.color, 2.5, 0.95);
  const rags = clothMaterial(0x1c161f, 3, 0.85);
  const flashMaterials = [flesh, rags];

  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  body.add(hips);

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 9), flesh);
  pelvis.scale.set(1, 0.8, 0.9);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // Tattered skirt.
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 10, 1, true), rags);
  skirt.position.y = -0.18;
  skirt.rotation.x = Math.PI;
  hips.add(skirt);

  // ---- Hunched torso ----
  const torso = new THREE.Group();
  torso.position.y = 0.05;
  torso.rotation.x = TORSO_LEAN;
  hips.add(torso);

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.3, 5, 12), flesh);
  chest.position.y = 0.27;
  chest.scale.set(1.05, 1, 0.85);
  chest.castShadow = true;
  torso.add(chest);

  // ---- Head jutting forward off the hunch ----
  const head = new THREE.Group();
  head.position.y = 0.5;
  head.rotation.x = -TORSO_LEAN + deg(8); // look forward despite the hunch
  torso.add(head);

  const skull = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.1, 5, 12), flesh);
  skull.position.y = 0.12;
  skull.rotation.x = Math.PI / 2;
  skull.castShadow = true;
  head.add(skull);

  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.12), flesh);
  jaw.position.set(0, 0.055, 0.12);
  head.add(jaw);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: def.eyeColor,
    emissive: def.eyeColor,
    emissiveIntensity: 2.6,
    roughness: 0.4,
  });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 9, 7), eyeMat);
    eye.position.set(side * 0.068, 0.155, 0.105);
    head.add(eye);
  }

  // ---- Long arms with clawed hands ----
  function buildArm(side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.21, 0.42, 0.04);
    torso.add(shoulder);

    shoulder.add(hangingSegment(0.058, HUSK_ARM.upper - 0.1, flesh));

    const elbow = new THREE.Group();
    elbow.position.y = -HUSK_ARM.upper;
    shoulder.add(elbow);

    elbow.add(hangingSegment(0.048, HUSK_ARM.fore - 0.1, flesh));

    const hand = new THREE.Group();
    hand.position.y = -HUSK_ARM.fore;
    elbow.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.055, 9, 7), flesh);
    palm.castShadow = true;
    hand.add(palm);
    for (const c of [-1, 0, 1]) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.11, 6), eyeMat);
      claw.position.set(c * 0.035, -0.07, 0.02);
      claw.rotation.x = Math.PI;
      hand.add(claw);
    }
    return { shoulder, elbow, hand };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  // ---- Legs ----
  function buildLeg(side: -1 | 1): { hip: THREE.Group; knee: THREE.Group } {
    const hip = new THREE.Group();
    hip.position.set(side * 0.105, -0.02, 0);
    hips.add(hip);

    hip.add(hangingSegment(0.078, 0.28, flesh));

    const knee = new THREE.Group();
    knee.position.y = -0.36;
    hip.add(knee);

    knee.add(hangingSegment(0.06, 0.26, flesh));

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.21), flesh);
    foot.position.set(0, -0.34, 0.045);
    foot.castShadow = true;
    knee.add(foot);

    return { hip, knee };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  const joints: HuskJoints = {
    body,
    hips,
    torso,
    head,
    armL: armL.shoulder,
    elbowL: armL.elbow,
    armR: armR.shoulder,
    elbowR: armR.elbow,
    legL: legL.hip,
    kneeL: legL.knee,
    legR: legR.hip,
    kneeR: legR.knee,
  };

  let walkPhase = Math.PI * 0.35; // desync husks from each other

  function resetPose(): void {
    hips.position.y = HIP_Y;
    hips.rotation.set(0, 0, 0);
    torso.rotation.set(TORSO_LEAN, 0, 0);
    head.rotation.set(-TORSO_LEAN + deg(8), 0, 0);
    armL.shoulder.rotation.set(0, 0, -0.16);
    armR.shoulder.rotation.set(0, 0, 0.16);
    armL.elbow.rotation.set(-deg(14), 0, 0);
    armR.elbow.rotation.set(-deg(14), 0, 0);
    legL.hip.rotation.set(0, 0, 0);
    legR.hip.rotation.set(0, 0, 0);
    legL.knee.rotation.set(0, 0, 0);
    legR.knee.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
  }

  function pose(input: CreaturePoseInput): void {
    resetPose();
    walkPhase = walkPhaseAdvance(walkPhase, input.distance, 1.9);
    const s = input.speedRatio;

    if (input.death !== null) {
      // Collapse forward out of the hunch.
      const d = deathCurve(input.death);
      body.rotation.x = d.fallRad * 0.92;
      body.position.y = -0.08 * input.death;
      torso.rotation.x = TORSO_LEAN - d.slumpRad * 0.3;
      legL.knee.rotation.x = d.legFoldRad * 0.9;
      legR.knee.rotation.x = d.legFoldRad;
      armL.shoulder.rotation.x = -deg(30) * input.death;
      armR.shoulder.rotation.x = -deg(24) * input.death;
      head.rotation.x = -TORSO_LEAN + deg(8) + d.slumpRad * 0.5;
      return;
    }

    const w = walkPose(walkPhase, s);
    const idle = idlePose(input.time);
    const still = 1 - s;

    // Shamble: legs swing, hips lurch side to side, shoulders roll.
    legL.hip.rotation.x = -w.legForwardL * 0.85;
    legR.hip.rotation.x = -w.legForwardR * 0.85;
    legL.knee.rotation.x = w.kneeL * 0.9;
    legR.knee.rotation.x = w.kneeR * 0.9;

    hips.position.y = HIP_Y + w.bob * 1.25 + idle.breathe * 0.3 * still;
    hips.rotation.y = w.hipsTwist * 1.3;
    hips.rotation.z = Math.sin(walkPhase * 2) * 0.055 * s + idle.sway * 0.6 * still;

    torso.rotation.x = TORSO_LEAN + idle.breathe * 1.6 * still;
    torso.rotation.y = w.torsoTwist * 1.2;
    head.rotation.x = -TORSO_LEAN + deg(8) + idle.breathe * 1.2 * still;
    head.rotation.y = idle.headYaw * 1.3 * still;

    // Long arms counter-swing, hanging low and loose.
    armL.shoulder.rotation.x = -(w.armForwardL * 0.75 + idle.armSway * 1.2 * still) - deg(8) * s;
    armR.shoulder.rotation.x = -(w.armForwardR * 0.75 - idle.armSway * 1.2 * still) - deg(8) * s;

    // Two-arm slam: high chamber, snap down, dig out.
    if (input.attack !== null) {
      const p = input.attack;
      const arm = huskSlamArm(p);
      const lean = huskSlamLean(p);
      armL.shoulder.rotation.x = -arm.raiseRad;
      armR.shoulder.rotation.x = -arm.raiseRad;
      armL.elbow.rotation.x = -arm.flexRad;
      armR.elbow.rotation.x = -arm.flexRad;
      torso.rotation.x += lean;
    }

    if (input.hit !== null) {
      const flinch = hitFlinch(input.hit);
      torso.rotation.x += flinch.leanRad;
      head.rotation.x += flinch.headRad;
      armL.shoulder.rotation.x += flinch.armFlareRad;
      armR.shoulder.rotation.x += flinch.armFlareRad;
    }
  }

  return { root, pickTarget: chest, pose, flashMaterials, joints };
}
