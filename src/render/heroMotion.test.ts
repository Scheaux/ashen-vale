import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClass } from '../content/classes';
import { BASIC_ATTACK_CONTACT } from '../content/skills';
import { HERO_ARM, deg } from './anim';
import { disposeMeshTree } from './dispose';
import { bootPivot, bowPose, HERO_LEG, heroStep, strideFoot } from './heroMotion';
import { createHeroRig, type HeroPoseInput } from './heroModel';

const classes = ['marauder', 'ranger', 'witch'] as const;
const frame: HeroPoseInput = { time: 0, distance: 0, speedRatio: 0, attack: null, hit: null, death: null };
const world = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3());

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {},
      }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe.each(classes)('%s motion on the live rig', (id) => {
  it('has its own modeled silhouette and stays inside the one-hero geometry budget', () => {
    const rig = createHeroRig(getClass(id));
    const signature = {
      marauder: ['marauder-riveted-helm', 'marauder-cuirass-inlay', 'marauder-axe-hardware'],
      ranger: ['ranger-sculpted-face', 'ranger-tailored-hood', 'ranger-tailored-seams'],
      witch: ['witch-porcelain-mask', 'witch-tailored-cowl', 'witch-crystal-cage'],
    }[id];
    for (const part of signature) expect(rig.root.getObjectByName(part)).toBeDefined();
    let triangles = 0;
    let meshes = 0;
    rig.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      object.geometry.computeBoundingSphere();
      expect(Number.isFinite(object.geometry.boundingSphere?.radius)).toBe(true);
    });
    expect(triangles).toBeGreaterThan(24000);
    expect(triangles).toBeLessThan(33000);
    expect(meshes).toBeLessThanOrEqual(53);
    disposeMeshTree(rig.root);
  });

  it.each([0.4, 1])('keeps the supporting heel or toe planted at speed ratio %s', (speedRatio) => {
    const rig = createHeroRig(getClass(id));
    const step = heroStep(id, speedRatio);
    const { stride, stance } = step;
    const ankle = rig.root.getObjectByName('hero-ankle-left')!;
    const other = rig.root.getObjectByName('hero-ankle-right')!;
    let planted: THREE.Vector3 | undefined;
    for (let i = 0; i <= 60; i++) {
      const phase = i / 60;
      rig.root.position.z = stride * phase;
      rig.pose({ ...frame, distance: i === 0 ? 0 : stride / 60, speedRatio, turn: 0.52, effort: 0.58 });
      const anklePos = world(ankle);
      const { lift, pitch } = strideFoot(phase, step);
      if (phase < stance) {
        const pivot = bootPivot(pitch);
        const support = ankle.localToWorld(new THREE.Vector3(0, -HERO_LEG.ankle, pivot));
        support.z -= pivot;
        planted ??= support;
        expect(support.distanceTo(planted)).toBeLessThan(0.009);
        expect(support.y).toBeCloseTo(0, 2);
      }
      expect(Math.min(anklePos.y, world(other).y)).toBeGreaterThan(HERO_LEG.ankle - 0.006);
      expect(anklePos.y).toBeCloseTo(HERO_LEG.ankle + lift, 2);
    }
    disposeMeshTree(rig.root);
  });

  it('moves the pelvis without dragging either planted boot through the strike', () => {
    const rig = createHeroRig(getClass(id));
    const left = rig.root.getObjectByName('hero-ankle-left')!;
    const right = rig.root.getObjectByName('hero-ankle-right')!;
    const pelvis = rig.root.getObjectByName('hero-pelvis')!;
    rig.pose({ ...frame, attack: 0.27 });
    const pins = [world(left), world(right)];
    const loaded = world(pelvis);
    for (const attack of [0.4, id === 'marauder' ? BASIC_ATTACK_CONTACT.melee : BASIC_ATTACK_CONTACT.projectile, 0.72]) {
      rig.pose({ ...frame, attack });
      expect(world(left).distanceTo(pins[0])).toBeLessThan(0.012);
      expect(world(right).distanceTo(pins[1])).toBeLessThan(0.012);
    }
    const recovered = world(pelvis);
    expect(recovered.x).toBeLessThanOrEqual(loaded.x);
    expect(rig.root.position.length()).toBe(0);
    disposeMeshTree(rig.root);
  });

  it('uses a slower full-speed cadence, with longer ground contact while walking', () => {
    const walk = heroStep(id, 0.4);
    const run = heroStep(id, 1);
    expect(2 * getClass(id).speed / run.stride).toBeLessThan(4.6);
    expect(walk.stance).toBeGreaterThan(0.5);
    expect(run.stance).toBeLessThan(0.5);
    expect(strideFoot(0, walk).pitch).toBeLessThan(0); // heel first
    expect(strideFoot(walk.stance * 0.5, walk).pitch).toBe(0); // foot flat
    expect(strideFoot(walk.stance * 0.99, walk).pitch).toBeGreaterThan(0); // toe-off
  });

  it('leans the chest farther forward at full speed while keeping its class posture', () => {
    const rig = createHeroRig(getClass(id));
    const chest = rig.root.getObjectByName('hero-chest')!;
    rig.pose({ ...frame, distance: 0.36, speedRatio: 0.4 });
    const walkPitch = chest.rotation.x;
    rig.pose({ ...frame, distance: 0.31, speedRatio: 1 });
    const expected = { marauder: 21, ranger: 15, witch: 9 }[id];
    expect(chest.rotation.x).toBeGreaterThan(deg(expected));
    expect(chest.rotation.x - walkPitch).toBeGreaterThan(deg(7));
    disposeMeshTree(rig.root);
  });

  it('keeps both arms rigid and the weapon attached throughout the action', () => {
    const rig = createHeroRig(getClass(id));
    const weapon = rig.root.getObjectByName('hero-weapon')!;
    const grip = id === 'ranger' ? 'left' : 'right';
    expect(weapon.parent?.name).toBe(`hero-hand-${grip}`);
    for (let i = 0; i <= 100; i++) {
      rig.pose({ ...frame, attack: i / 100 });
      for (const side of ['left', 'right'] as const) {
        const s = rig.root.getObjectByName(`hero-shoulder-${side}`)!;
        const e = rig.root.getObjectByName(`hero-elbow-${side}`)!;
        const h = rig.root.getObjectByName(`hero-hand-${side}`)!;
        const upper = world(e).sub(world(s));
        const lower = world(h).sub(world(e));
        expect(upper.length()).toBeCloseTo(HERO_ARM.upper, 6);
        expect(lower.length()).toBeCloseTo(HERO_ARM.fore, 6);
        expect(upper.angleTo(lower)).toBeGreaterThanOrEqual(deg(10) - 1e-6);
        expect(upper.angleTo(lower)).toBeLessThanOrEqual(deg(152));
        const torsoDown = new THREE.Vector3(0, -1, 0).applyQuaternion(s.parent!.getWorldQuaternion(new THREE.Quaternion()));
        expect(upper.angleTo(torsoDown)).toBeLessThanOrEqual(deg(105));
      }
    }
    disposeMeshTree(rig.root);
  });
});

it('gives the Marauder substantially more body commitment than the Witch', () => {
  const warrior = createHeroRig(getClass('marauder'));
  const caster = createHeroRig(getClass('witch'));
  const chest = (rig: typeof warrior) => rig.root.getObjectByName('hero-chest')!;
  const pelvis = (rig: typeof warrior) => rig.root.getObjectByName('hero-pelvis')!;
  for (const rig of [warrior, caster]) rig.pose({ ...frame, distance: 0.42, speedRatio: 1, turn: 0.4, effort: 0.5 });
  expect(chest(warrior).rotation.x).toBeGreaterThan(chest(caster).rotation.x * 2);
  expect(Math.abs(pelvis(warrior).position.x)).toBeGreaterThan(Math.abs(pelvis(caster).position.x) * 2);

  warrior.pose({ ...frame, attack: 0.24 });
  caster.pose({ ...frame, attack: 0.38 });
  const braced = [world(pelvis(warrior)), world(pelvis(caster))];
  warrior.pose({ ...frame, attack: BASIC_ATTACK_CONTACT.melee });
  caster.pose({ ...frame, attack: BASIC_ATTACK_CONTACT.projectile });
  expect(world(pelvis(warrior)).distanceTo(braced[0])).toBeGreaterThan(0.28);
  expect(world(pelvis(caster)).distanceTo(braced[1])).toBeLessThan(0.1);
  disposeMeshTree(warrior.root);
  disposeMeshTree(caster.root);
});

it('holds the bow draw through the authoritative release and then relaxes it', () => {
  const release = BASIC_ATTACK_CONTACT.projectile;
  expect(bowPose(0.17).tension).toBe(0);
  expect(bowPose(release).tension).toBe(1);
  expect(bowPose(release + 0.05).tension).toBe(0);
  const ranger = createHeroRig(getClass('ranger'));
  const head = ranger.root.getObjectByName('hero-head')!;
  const drawHand = ranger.root.getObjectByName('hero-hand-right')!;
  const arrow = ranger.root.getObjectByName('hero-nocked-arrow')!;
  ranger.pose({ ...frame, attack: release - 0.03 });
  expect(arrow.visible).toBe(true);
  const cheek = head.localToWorld(new THREE.Vector3(0.10, 0.14, 0.09));
  expect(world(drawHand).distanceTo(cheek)).toBeLessThan(0.21);
  ranger.pose({ ...frame, attack: release });
  expect(arrow.visible).toBe(false);
  disposeMeshTree(ranger.root);
});

it('carries the axe below and behind the fist, then leads with it on the contact frame', () => {
  const marauder = createHeroRig(getClass('marauder'));
  const head = marauder.root.getObjectByName('hero-axe-head')!;
  const fist = marauder.root.getObjectByName('hero-hand-right')!;
  const shoulder = marauder.root.getObjectByName('hero-shoulder-right')!;
  for (const speedRatio of [0, 0.5, 1]) {
    marauder.pose({ ...frame, distance: 0.22, speedRatio });
    const blade = world(head);
    const grip = world(fist);
    expect(blade.z).toBeLessThan(grip.z - 0.35);
    expect(blade.y).toBeLessThan(grip.y - 0.06);
    expect(blade.y).toBeLessThan(world(shoulder).y);
    expect(blade.distanceTo(grip)).toBeCloseTo(0.535, 6);
  }
  marauder.pose({ ...frame, attack: 0.28 });
  expect(world(head).y).toBeGreaterThan(world(shoulder).y);
  marauder.pose({ ...frame, attack: BASIC_ATTACK_CONTACT.melee });
  expect(world(head).z).toBeGreaterThan(world(fist).z + 0.3);
  marauder.pose({ ...frame, attack: 0.72 });
  expect(world(head).y).toBeLessThan(world(fist).y - 0.12);
  disposeMeshTree(marauder.root);
});
