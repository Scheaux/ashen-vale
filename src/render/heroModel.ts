import * as THREE from 'three';
import { BASIC_ATTACK_CONTACT } from '../content/skills';
import { clamp } from '../core/math';
import { smoothstep } from '../core/noise';
import type { ClassDef } from '../content/types';
import {
  deathCurve,
  deg,
  HERO_ARM,
  heroMeleeArm,
  hitFlinch,
  idlePose,
  keyLerp,
} from './anim';
import { beveledBox, latheProfile, sweptTube } from './geo';
import { fittedLimb, heroBoot, heroTorso } from './heroAnatomy';
import { advanceHeroStride, attackStance, axeHaft, bowPose, HERO_GAIT, HERO_LEG, HeroLegSolver, heroStep, staffPose, strideFoot, travelPose } from './heroMotion';
import { clothMaterial, fleshMaterial, leatherMaterial, metalMaterial } from './materials';
import { dressHero } from './heroWardrobe';
import { addHeroDetail, buildHeroPortrait } from './heroPortrait';

export interface HeroPoseInput {
  time: number;
  /** Distance traveled this frame, for the walk phase (feet stay glued). */
  distance: number;
  speedRatio: number;
  attack: number | null;
  turn?: number;
  effort?: number;
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

/**
 * Jointed hero: hips -> torso -> head/arms, hips -> legs. Every rotation in
 * pose() happens at a real joint pivot, so limbs never stretch or shear.
 * Class variants change proportions, silhouette, grip hand, and body motion.
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
  const metal = metalMaterial(def.id === 'witch' ? 0xa3a8bd : 0x7e8493, 2.5, 0.36);
  metal.metalness = 0.42; // The moor has no environment probe.
  metal.roughness = 0.62;
  const trim = metal.clone();
  trim.color.setHex(def.id === 'witch' ? 0xb6abd7 : def.id === 'ranger' ? 0xa38a5d : 0xbea28b);
  trim.metalness = 0.34;
  trim.normalScale.setScalar(0.22);
  const glow = new THREE.MeshStandardMaterial({
    color: def.color,
    emissive: def.color,
    emissiveIntensity: 1.7,
    roughness: 0.5,
    metalness: 0,
  });
  const flashMaterials = [skin, cloth, leather, accent];

  // Class build: broad (marauder), lean (ranger), average (witch).
  const build = def.id === 'marauder' ? 1.23 : def.id === 'ranger' ? 0.94 : 1;
  const gait = HERO_GAIT[def.id];

  // ---- Hips & pelvis ----
  const hips = new THREE.Group();
  hips.name = 'hero-pelvis';
  hips.position.y = HIP_Y;
  body.add(hips);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 18), leather);
  pelvis.scale.set(build, 0.78, 0.88);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // ---- Torso ----
  const torso = new THREE.Group();
  torso.name = 'hero-chest';
  torso.position.y = 0.06;
  hips.add(torso);

  const chest = new THREE.Mesh(heroTorso(build), cloth);
  chest.scale.set(1, 1, 0.82);
  chest.castShadow = true;
  torso.add(chest);

  const belt = new THREE.Mesh(latheProfile([
    [0.173 * build, -0.039], [0.184 * build, -0.034], [0.185 * build, 0.035], [0.172 * build, 0.044],
  ], 32), leather);
  belt.scale.z = 0.89;
  belt.position.y = 0.09;
  torso.add(belt);
  const buckle = new THREE.Mesh(beveledBox(0.089, 0.066, 0.03, 0.009, 3), trim);
  buckle.position.set(0, 0.09, 0.173 * build);
  torso.add(buckle);
  if (def.id !== 'marauder') {
    const sash = new THREE.Mesh(beveledBox(0.066, 0.41, 0.034, 0.009, 3), leather);
    sash.position.set(0.012, 0.29, 0.158 * build);
    sash.rotation.z = -0.55;
    torso.add(sash);
  }

  for (const side of [-1, 1]) {
    if (def.id === 'marauder' && side < 0) continue;
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.105 * build, 24, 14), accent);
    pauldron.position.set(side * 0.235 * build, 0.44, 0);
    pauldron.scale.set(1, def.id === 'witch' ? 0.47 : 0.72, 1);
    pauldron.castShadow = true;
    torso.add(pauldron);
  }

  // ---- Head & hood ----
  const head = new THREE.Group();
  head.name = 'hero-head';
  head.position.y = 0.56;
  torso.add(head);

  buildHeroPortrait(head, def.id, { skin, cloth, accent, metal, leather, trim });
  const robePanels = dressHero(def.id, torso, hips, head, { leather, accent, metal, trim });

  // ---- Arms (shoulder pivot -> elbow pivot -> hand) ----
  function buildArm(side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.name = side < 0 ? 'hero-shoulder-left' : 'hero-shoulder-right';
    shoulder.position.set(side * 0.245 * build, 0.42, 0);
    torso.add(shoulder);

    const upper = new THREE.Mesh(fittedLimb(0.061 * build, HERO_ARM.upper, 0.81), cloth);
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.name = side < 0 ? 'hero-elbow-left' : 'hero-elbow-right';
    elbow.position.y = -HERO_ARM.upper;
    shoulder.add(elbow);

    const fore = new THREE.Mesh(fittedLimb(def.id === 'witch' ? 0.066 : 0.054, HERO_ARM.fore, 0.68), def.id === 'ranger' ? skin : cloth);
    fore.castShadow = true;
    elbow.add(fore);
    const cuff = new THREE.Mesh(latheProfile([
      [0.044, -0.232], [0.048, -0.218], [0.050, -0.196], [0.058, -0.161], [0.066, -0.125], [0.068, -0.108], [0.059, -0.099],
    ], 26), def.id === 'marauder' ? metal : leather);
    elbow.add(cuff);
    addHeroDetail(elbow, trim, [
      new THREE.TorusGeometry(0.046, 0.0047, 7, 22).rotateX(Math.PI / 2).translate(0, -0.220, 0),
      new THREE.TorusGeometry(0.061, 0.0057, 7, 22).rotateX(Math.PI / 2).translate(0, -0.120, 0),
    ]);

    const hand = new THREE.Group();
    hand.name = side < 0 ? 'hero-hand-left' : 'hero-hand-right';
    hand.position.y = -HERO_ARM.fore;
    elbow.add(hand);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.055, 22, 14), leather);
    fist.scale.set(1.03, 0.93, 1.08);
    fist.castShadow = true;
    hand.add(fist);
    addHeroDetail(hand, leather, [
      new THREE.SphereGeometry(0.033, 14, 10).scale(0.67, 1, 0.80).translate(-side * 0.038, 0.011, 0.021),
      ...Array.from({ length: 3 }, (_, i) => new THREE.SphereGeometry(0.017, 12, 7).scale(0.90, 0.75, 0.8)
        .translate((i - 1) * 0.023, -0.018, 0.043)),
    ]);

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

    const thigh = new THREE.Mesh(fittedLimb(def.id === 'marauder' ? 0.094 : 0.081, HERO_LEG.upper, 0.69), cloth);
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -HERO_LEG.upper;
    hip.add(knee);

    const shin = new THREE.Mesh(fittedLimb(0.072, HERO_LEG.lower, 0.69), leather);
    shin.castShadow = true;
    knee.add(shin);
    const guard = new THREE.Mesh(new THREE.SphereGeometry(0.088, 24, 16, 0, Math.PI), def.id === 'marauder' ? metal : leather);
    guard.position.set(0, -0.054, 0.051);
    guard.scale.set(0.88, 1.3, 0.44);
    knee.add(guard);

    const ankle = new THREE.Group();
    ankle.name = side < 0 ? 'hero-ankle-left' : 'hero-ankle-right';
    ankle.position.y = -HERO_LEG.lower;
    knee.add(ankle);
    const foot = new THREE.Mesh(heroBoot(def.id === 'marauder' ? 0.153 : 0.135), leather);
    foot.castShadow = true;
    ankle.add(foot);

    return { hip, knee, ankle };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // ---- Cape (rides the torso, sways with motion) ----
  const capeColumns = 22;
  const capeRows = 22;
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, capeColumns, capeRows), accent);
  cape.position.set(def.id === 'ranger' ? -0.064 : 0, 0.45, -0.178);
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
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.033, 0.81, 24), leather);
    handle.position.y = 0.19;
    handle.castShadow = true;
    weapon.add(handle);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.047, 0.13, 24), metal);
    socket.position.y = 0.53;
    weapon.add(socket);
    // Narrow beard at the haft, flared convex cutting edge. Give the edge
    // width with a real bevel rather than a second glowing rectangle.
    const blade = new THREE.Shape();
    blade.moveTo(-0.028, 0.047);
    blade.lineTo(0.08, 0.052);
    blade.quadraticCurveTo(0.19, 0.057, 0.248, 0.112);
    blade.quadraticCurveTo(0.31, -0.031, 0.229, -0.149);
    blade.quadraticCurveTo(0.17, -0.093, 0.08, -0.051);
    blade.lineTo(-0.028, -0.043);
    blade.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(blade, {
      depth: 0.041, bevelSize: 0.009, bevelThickness: 0.008, bevelSegments: 4, curveSegments: 18,
    });
    bladeGeo.translate(0, 0, -0.0205);
    const axeHead = new THREE.Mesh(bladeGeo, metal);
    axeHead.name = 'hero-axe-head';
    axeHead.position.y = 0.535;
    axeHead.castShadow = true;
    weapon.add(axeHead);
    addHeroDetail(weapon, trim, [
      new THREE.TorusGeometry(0.050, 0.006, 8, 24).rotateX(Math.PI / 2).translate(0, 0.491, 0),
      new THREE.TorusGeometry(0.050, 0.006, 8, 24).rotateX(Math.PI / 2).translate(0, 0.570, 0),
      ...[-1, 1].map((side) => new THREE.OctahedronGeometry(0.022, 1).scale(1, 0.80, 0.48)
        .translate(0.133, 0.547, side * 0.024)),
    ], 'marauder-axe-hardware');
  } else if (def.id === 'ranger') {
    // Swept bow: tapered limbs along a curved path, thickest at the grip.
    const centers: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 34; i++) {
      const t = i / 34;
      const a = (t - 0.5) * 2.4;
      const bend = Math.abs(t * 2 - 1);
      centers.push(new THREE.Vector3(0, Math.sin(a) * 0.53, -(1 - Math.cos(a)) * 0.41 + 0.054 * bend ** 9));
      radii.push(0.035 - 0.022 * Math.pow(Math.abs(2 * t - 1), 1.1));
    }
    const bow = new THREE.Mesh(sweptTube(centers, radii, 16), leather);
    bow.castShadow = true;
    weapon.add(bow);
    for (const [i, j] of [[0, 9], [25, 34]]) {
      const grain = centers.slice(i, j + 1).map((p, k) => p.clone().add(new THREE.Vector3(radii[i + k] * 0.84, 0, 0)));
      const spine = new THREE.Mesh(sweptTube(grain, grain.map(() => 0.006), 8), trim);
      weapon.add(spine);
    }
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
        30,
      ),
      leather,
    );
    staff.position.set(0.02, -0.35, 0.02);
    weapon.add(staff);
    const collar = new THREE.Mesh(latheProfile([[0.034, -0.047], [0.041, -0.033], [0.046, -0.012], [0.066, 0.012],
      [0.067, 0.025], [0.056, 0.039]], 32), metal);
    collar.position.set(0.02, 1.075, 0.02);
    weapon.add(collar);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.087, 1), glow);
    orb.scale.set(0.78, 1.36, 0.78);
    glow.flatShading = true;
    glow.color.setHex(0xbc9bfd);
    orb.position.set(0.02, 1.16, 0.02);
    weapon.add(orb);
    const cage: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const fork = [[0.037, 1.082], [0.073, 1.104], [0.109, 1.151], [0.112, 1.208], [0.093, 1.254], [0.051, 1.292]]
        .map(([r, y]) => new THREE.Vector3(0.02 + Math.cos(a + y - 1.1) * r, y, 0.02 + Math.sin(a + y - 1.1) * r));
      cage.push(sweptTube(fork, [0.014, 0.013, 0.011, 0.010, 0.008, 0.004], 12));
    }
    cage.push(new THREE.TorusGeometry(0.049, 0.010, 10, 32).rotateX(Math.PI / 2).translate(0.02, 1.09, 0.02));
    addHeroDetail(weapon, trim, cage, 'witch-crystal-cage');
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
  const haftAxis = new THREE.Vector3();
  const haftPitchAxis = new THREE.Vector3(1, 0, 0);
  const edgeAxis = new THREE.Vector3();
  const bladeNormal = new THREE.Vector3();
  const axeBasis = new THREE.Matrix4();
  const legSolver = new HeroLegSolver();
  const clothHip = new THREE.Vector3();
  const clothKnee = new THREE.Vector3();
  const clothAnkle = new THREE.Vector3();

  function drapeRobe(time: number, speed: number, turn: number, strike: number): void {
    for (let i = 0; i < robePanels.length; i++) {
      const { root: panel, geometry, restDepth } = robePanels[i];
      const leg = i === 0 ? legL : legR;
      panel.rotation.x = -0.16 - strike * (i === 0 ? 0.16 : 0.06);
      panel.rotation.z = turn * 0.12 - hips.rotation.z + Math.sin(time * 5 - i) * 0.026 * speed;
      panel.worldToLocal(leg.hip.getWorldPosition(clothHip));
      panel.worldToLocal(leg.knee.getWorldPosition(clothKnee));
      panel.worldToLocal(leg.ankle.getWorldPosition(clothAnkle));
      const attr = geometry.attributes.position;
      for (let j = 0; j < attr.count; j++) {
        const y = attr.getY(j);
        const aboveKnee = y > clothKnee.y;
        const a = aboveKnee ? clothHip : clothKnee;
        const b = aboveKnee ? clothKnee : clothAnkle;
        const t = clamp((y - a.y) / Math.min(-0.01, b.y - a.y), 0, 1);
        const margin = aboveKnee ? THREE.MathUtils.lerp(0.11, 0.115, t) : THREE.MathUtils.lerp(0.115, 0.087, t);
        const guide = THREE.MathUtils.lerp(a.z, b.z, t) + margin;
        // Pin the waist and let the knee push the hem forward without clipping.
        attr.setZ(j, restDepth[j] + Math.max(0, guide - restDepth[j]) * smoothstep(0, 0.13, -y));
      }
      attr.needsUpdate = true;
      geometry.computeVertexNormals();
    }
  }

  function orientGrip(orientation: THREE.Quaternion): void {
    wristSpace.copy(weaponGrip.shoulder.quaternion).multiply(weaponGrip.elbow.quaternion).invert();
    weapon.quaternion.copy(wristSpace).multiply(orientation);
  }

  function aimWeapon(x: number, y: number, z: number): void {
    orientGrip(weaponAim.setFromEuler(weaponAngles.set(x, y, z)));
  }

  function aimAxe(attack: number | null, speed: number, drag = 0): void {
    const haft = axeHaft(attack, speed);
    haftAxis.set(haft.x + (attack === null ? drag * 0.24 : 0), haft.y, haft.z).normalize();
    // The chest lunges forward at a run, but the axe still hangs low.
    if (attack === null) haftAxis.applyAxisAngle(haftPitchAxis, -torso.rotation.x * speed * 0.55);
    const cutting = attack === null ? 0 : Math.sin(Math.PI * attack);
    edgeAxis.set(0.4, -0.78, 0.23 + cutting * 0.61).projectOnPlane(haftAxis).normalize();
    bladeNormal.crossVectors(edgeAxis, haftAxis);
    orientGrip(weaponAim.setFromRotationMatrix(axeBasis.makeBasis(edgeAxis, haftAxis, bladeNormal)));
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
          const spread = 0.14 + speed * (def.id === 'witch' ? 0.49 : 0.9) + fallen * 0.72 + strike * 0.26;
          const angle = spread * (0.45 + 0.55 * down)
            + Math.sin(time * (3 + 3 * speed) - down * 6 + across * 2.8) * down * (0.08 + 0.17 * speed);
          const segment = gait.cape * 0.88 / capeRows;
          y -= Math.cos(angle) * segment;
          z -= Math.sin(angle) * segment;
        }
        const x = across * (0.193 + down * 0.108) + turn * down * down * 0.19;
        const split = (def.id === 'ranger' ? 0.02 : 0.16) * Math.max(0, 1 - Math.abs(across) * 2.9) * down ** 5;
        vertices.setXYZ(row * (capeColumns + 1) + col, x, y + split + across * across * down * 0.038, z);
      }
    }
    vertices.needsUpdate = true;
    cape.geometry.computeVertexNormals();
  }

  function resetPose(): void {
    hips.position.set(0, HIP_Y, 0);
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
    const s = clamp(input.speedRatio, 0, 1);
    const step = heroStep(def.id, s);
    const strideBlend = smoothstep(0.025, 0.25, s);
    walkPhase = advanceHeroStride(walkPhase, input.distance, step.stride);
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
      if (def.id === 'marauder') aimAxe(null, 0);
      else aimWeapon(0, 0, -0.24);
      bowstring?.(0);
      if (staffLight) staffLight.intensity = 3;
      drapeRobe(input.time, 0, 0, 0);
      drapeCape(input.time, 0, 0, 0, input.death);
      return;
    }

    const idle = idlePose(input.time);
    const still = 1 - s;
    const effort = clamp(input.effort ?? 0, -1, 1);
    const motion = travelPose(def.id, walkPhase, s, turn, effort);
    const maxReach = Math.hypot(
      step.stride * step.stance * strideBlend / 2 + Math.abs(motion.surge) + 0.038,
      Math.abs(motion.side),
    );
    const standingLimit = Math.sqrt((HERO_LEG.upper + HERO_LEG.lower - 0.015) ** 2 - maxReach ** 2)
      + HERO_LEG.hipOffset + HERO_LEG.ankle;
    hips.position.x = motion.side + (stance?.side ?? 0);
    hips.position.y = Math.min(standingLimit, HIP_Y - s * 0.11 + motion.bob + idle.breathe * 0.24 * still)
      - (stance?.drop ?? 0);
    hips.position.z = motion.surge + (stance?.shift ?? 0);
    const soles = ([-1, 1] as const).map((side) => {
      const path = strideFoot(walkPhase + (side < 0 ? 0 : 0.5), step, strideBlend);
      return {
        x: side * (stance?.width ?? 0) - hips.position.x,
        z: path.z - side * (stance?.spread ?? 0) - hips.position.z,
        lift: path.lift + (side < 0 ? stance?.leftLift ?? 0 : 0),
        pitch: path.pitch,
      };
    });
    // Give in at the pelvis if a wide attack stance would overextend either
    // leg. Clamping at the ankle would tug the planted boot off its mark.
    const legLength = HERO_LEG.upper + HERO_LEG.lower - 0.008;
    for (const sole of soles) {
      const uprightReach = Math.sqrt(Math.max(0, legLength ** 2 - sole.x ** 2 - sole.z ** 2));
      hips.position.y = Math.min(hips.position.y, uprightReach + HERO_LEG.hipOffset + HERO_LEG.ankle + sole.lift);
    }
    legRoot.position.copy(hips.position);
    for (const [i, leg] of [legL, legR].entries()) {
      const sole = soles[i];
      legSolver.solve(sole.x, hips.position.y - HERO_LEG.hipOffset - HERO_LEG.ankle - sole.lift,
        sole.z, sole.pitch, leg.hip.quaternion, leg.knee.quaternion, leg.ankle.quaternion);
    }

    hips.rotation.y = motion.hipsYaw + idle.sway * 0.35 * still + (stance?.hips ?? 0);
    hips.rotation.z = motion.hipsRoll;
    torso.rotation.y = motion.chestYaw + (stance?.chestYaw ?? 0);
    torso.rotation.x = motion.chestPitch + idle.breathe * still + (stance?.chestPitch ?? 0);
    torso.rotation.z = motion.chestRoll + (stance?.chestRoll ?? 0);
    head.rotation.x = -torso.rotation.x * 0.66;
    head.rotation.y = idle.headYaw * still * (1 - (stance?.weight ?? 0)) + motion.headYaw
      - (torso.rotation.y + hips.rotation.y) * (def.id === 'ranger' ? 0.78 : 0.47);
    head.rotation.z = -torso.rotation.z * 0.72;
    armL.shoulder.rotation.x = motion.armL - idle.armSway * still - 0.12;
    armR.shoulder.rotation.x = motion.armR + idle.armSway * still - 0.10;
    armL.elbow.rotation.x = -0.23 - (def.id === 'witch' ? 0.29 : 0.65) * s;
    armR.elbow.rotation.x = -0.23 - 0.65 * s;

    let pitch = -0.08;
    let roll = def.id === 'ranger' ? 0.5 : -0.24;
    let tension = 0;
    if (def.id === 'ranger' && contact === null) {
      armL.shoulder.rotation.x = -0.40 + motion.armL;
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
        roll = 0.5 - 0.45 * stance.weight;
        tension = draw.tension;
      } else if (def.id === 'marauder') {
        const arm = heroMeleeArm(p);
        armR.shoulder.rotation.x = -arm.raiseRad;
        armR.elbow.rotation.x = -arm.flexRad;
        armR.shoulder.rotation.y = keyLerp(p, [[0, 0], [0.26, 0.65], [0.45, -0.13], [0.72, -0.66], [1, 0]]);
        armL.shoulder.rotation.x += 0.42 * stance.weight;
      } else {
        const cast = staffPose(p);
        armR.shoulder.rotation.x = -cast.raise;
        armR.elbow.rotation.x = -cast.flex;
        armL.shoulder.rotation.x = -cast.freeRaise;
        armL.elbow.rotation.x = -cast.freeFlex;
        pitch = cast.pitch;
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

    if (def.id === 'marauder') aimAxe(contact, s, (turn + motion.hipsYaw) * s);
    else aimWeapon(pitch, def.id === 'ranger' ? -hips.rotation.y * 0.72 : armR.shoulder.rotation.y * 0.9, roll);
    bowstring?.(tension, contact !== null && contact >= 0.27 && contact < BASIC_ATTACK_CONTACT.projectile);
    drapeRobe(input.time, s, turn, stance?.weight ?? 0);
    drapeCape(input.time, s, turn, stance?.weight ?? 0);
  }

  return { root, pose, flashMaterials };
}
