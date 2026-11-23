import * as THREE from 'three';
import { basicAttackFor } from '../content/skills';
import type { ClassDef } from '../content/types';
import type { GameState, SimEvent } from '../sim/state';
import { clamp } from '../core/math';
import { HitClock } from './anim';
import { createHeroRig, type HeroRig } from './heroModel';

export interface PlayerView {
  group: THREE.Group;
  /** Position/rotation follow the sim state with interpolation; the rig is posed per frame. */
  update(state: GameState, dt: number, alpha: number, elapsed: number): void;
  handleEvents(events: readonly SimEvent[]): void;
}

const DEATH_DURATION = 1.4;

/**
 * Player view: a jointed hero rig posed from the sim state (locomotion,
 * strikes, flinches, death). Rendering consumes authoritative sim events and
 * never invents gameplay outcomes.
 */
export function createPlayerView(def: ClassDef): PlayerView {
  const skill = basicAttackFor(def.id);
  const rig: HeroRig = createHeroRig(def);
  const clock = new HitClock();
  let facing = Math.PI;
  let speedRatio = 0;
  let turn = 0;
  let effort = 0;
  let previous: { x: number; z: number } | null = null;
  let deathTime = 0;

  function handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'damage' && ev.targetKind === 'player') clock.triggerHit();
    }
  }

  function update(state: GameState, dt: number, alpha: number, elapsed: number): void {
    clock.advance(dt);
    const p = state.player;
    const x = p.previousPosition.x + (p.position.x - p.previousPosition.x) * alpha;
    const z = p.previousPosition.z + (p.position.z - p.previousPosition.z) * alpha;

    const travel = previous ? Math.hypot(x - previous.x, z - previous.z) : 0;
    const relocated = travel > p.speed * Math.max(dt, 1 / 60) + 0.25;
    const distance = relocated ? 0 : travel;
    if (previous) { previous.x = x; previous.z = z; }
    else previous = { x, z };
    const targetSpeed = p.attack ? 0 : clamp(distance / Math.max(0.001, dt * p.speed), 0, 1);
    const leanIntent = p.attack || relocated ? 0 : clamp((targetSpeed - speedRatio) * 2.2, -1, 1);
    effort += (leanIntent - effort) * (1 - Math.exp(-9 * dt));
    speedRatio += (targetSpeed - speedRatio) * (1 - Math.exp(-dt * (p.attack ? 29 : 16)));

    rig.root.position.set(x, 0, z);

    const diff = Math.atan2(Math.sin(p.facing - facing), Math.cos(p.facing - facing));
    const delta = diff * (1 - Math.exp(-16 * dt));
    facing = relocated ? p.facing : facing + delta;
    turn += (clamp(delta / Math.max(dt * 6, 0.001), -1, 1) - turn) * (1 - Math.exp(-12 * dt));
    rig.root.rotation.y = facing;

    const dead = p.hp <= 0;
    deathTime = dead ? deathTime + dt : 0;

    const hit = clock.hitProgress;
    const flash = hit === null ? 0 : (1 - hit) ** 3;
    for (const mat of rig.flashMaterials) mat.emissive.setRGB(0.46 * flash, 0.09 * flash, 0.05 * flash);
    rig.pose({
      time: elapsed,
      distance,
      speedRatio: dead ? 0 : speedRatio,
      attack: !dead && p.attack ? p.attack.elapsed / skill.duration : null,
      turn,
      effort,
      hit: dead ? null : hit,
      death: dead ? Math.min(1, deathTime / DEATH_DURATION) : null,
    });
  }

  return { group: rig.root, update, handleEvents };
}
