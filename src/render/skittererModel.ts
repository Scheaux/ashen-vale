import * as THREE from 'three';
import type { EnemyDef } from '../content/enemies';
import {
  deathCurve,
  hitFlinch,
  idlePose,
  keyLerp,
  walkPose,
  walkPhaseAdvance,
  type CreaturePoseInput,
} from './anim';

/**
 * Mire Skitterer: a low quadruped with a trot gait and a crouch-and-leap
 * pounce. The strike curve drives the body pitch and height instead of arms:
 * chamber crouches (0 -> 0.42), the leap extends through contact, the
 * landing settles out of the follow-through.
 */
export function createSkittererRig(def: EnemyDef): {
  root: THREE.Group;
  pickTarget: THREE.Mesh;
  flashMaterials: THREE.MeshStandardMaterial[];
  pose(input: CreaturePoseInput): void;
} {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.52;
  root.add(body);

  const hide = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85, metalness: 0 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x1a2118, roughness: 0.9, metalness: 0 });
  const flashMaterials = [hide, belly];
  const glow = new THREE.MeshStandardMaterial({
    color: def.eyeColor,
    emissive: def.eyeColor,
    emissiveIntensity: 2.2,
    roughness: 0.5,
    metalness: 0,
  });

  // Horizontal body.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 5, 12), hide);
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(1, 1, 0.85);
  torso.castShadow = true;
  body.add(torso);
  const pickTarget = torso;

  // Head with eyes and mandibles.
  const head = new THREE.Group();
  head.position.set(0, 0.06, 0.52);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.12, 5, 10), hide);
  skull.rotation.x = Math.PI / 2;
  skull.castShadow = true;
  head.add(skull);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), glow);
    eye.position.set(side * 0.075, 0.075, 0.12);
    head.add(eye);
    const mandible = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16, 6), belly);
    mandible.position.set(side * 0.075, -0.055, 0.16);
    mandible.rotation.x = Math.PI / 2 - 0.5;
    head.add(mandible);
  }

  // Four legs: hip -> knee -> foot.
  const legs: Array<{ hip: THREE.Group; knee: THREE.Group; phase: number }> = [];
  for (const [x, z, phase] of [
    [-0.17, 0.3, 0],
    [0.17, 0.3, Math.PI],
    [-0.17, -0.28, Math.PI],
    [0.17, -0.28, 0],
  ] as Array<[number, number, number]>) {
    const hip = new THREE.Group();
    hip.position.set(x, -0.05, z);
    body.add(hip);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), hide);
    thigh.position.y = -0.13;
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.26;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.14, 4, 8), hide);
    shin.position.y = -0.11;
    shin.castShadow = true;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.13), belly);
    foot.position.set(0, -0.21, 0.03);
    knee.add(foot);
    legs.push({ hip, knee, phase });
  }

  // Tail for silhouette.
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 8), hide);
  tail.position.set(0, 0.04, -0.55);
  tail.rotation.x = -Math.PI / 2 - 0.35;
  tail.castShadow = true;
  body.add(tail);

  let walkPhase = Math.PI * 0.6;

  function resetPose(): void {
    body.position.y = 0.52;
    body.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    for (const leg of legs) {
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
    }
  }

  function pose(input: CreaturePoseInput): void {
    resetPose();
    walkPhase = walkPhaseAdvance(walkPhase, input.distance, 2.6);
    const idle = idlePose(input.time);
    const s = input.speedRatio;

    // Trot: diagonal pairs swing together (phase offset per leg).
    const w = walkPose(walkPhase, s);
    for (const leg of legs) {
      const swing = leg.phase === 0 ? w.legForwardL : w.legForwardR;
      const bend = leg.phase === 0 ? w.kneeL : w.kneeR;
      leg.hip.rotation.x = -swing * 0.8;
      leg.knee.rotation.x = bend * 0.85;
    }
    body.position.y = 0.52 + w.bob * 0.8 + idle.breathe * 0.25 * (1 - s);
    body.rotation.z = Math.sin(walkPhase * 2) * 0.05 * s;

    // Pounce: crouch through the chamber (0 -> 0.42), leap through contact,
    // land out of the follow-through. Same clock as the strike curve.
    if (input.attack !== null) {
      const p = input.attack;
      body.position.y += keyLerp(p, [
        [0, 0],
        [0.42, -0.1],
        [0.52, 0.32],
        [0.72, 0.02],
        [1, 0],
      ]);
      body.rotation.x += keyLerp(p, [
        [0, 0],
        [0.42, 0.12],
        [0.52, -0.22],
        [0.72, -0.04],
        [1, 0],
      ]);
    }

    if (input.hit !== null) {
      const flinch = hitFlinch(input.hit);
      body.rotation.x += flinch.leanRad * 0.8;
      body.position.y += -Math.abs(hitShudder(input.hit)) * 0.03;
    }

    if (input.death !== null) {
      const d = deathCurve(input.death);
      body.rotation.z = d.fallRad * 1.1; // roll onto its side
      body.position.y = 0.52 - 0.3 * input.death;
      for (const leg of legs) leg.hip.rotation.x = -d.legFoldRad * 0.5;
    }
  }

  return { root, pickTarget, flashMaterials, pose };
}

/** Small hit shudder magnitude for the skitterer. */
function hitShudder(p: number): number {
  return Math.sin(p * Math.PI * 6) * (1 - p);
}
