import * as THREE from 'three';
import { basicAttackFor } from '../content/skills';
import type { ClassDef } from '../content/types';
import type { GameState, SimEvent } from '../sim/state';
import { AnimClock } from './anim';
import { createHeroRig, type HeroRig } from './heroModel';

export interface PlayerView {
  group: THREE.Group;
  /** Position/rotation follow the sim state with interpolation; the rig is posed per frame. */
  update(state: GameState, dt: number, alpha: number, elapsed: number): void;
  triggerAttack(): void;
  handleEvents(events: readonly SimEvent[]): void;
}

const DEATH_DURATION = 1.4;

/**
 * Player view: a jointed hero rig posed from the sim state (locomotion,
 * strikes, flinches, death). Rendering consumes authoritative sim events and
 * never invents gameplay outcomes.
 */
export function createPlayerView(def: ClassDef): PlayerView {
  const attackKind = basicAttackFor(def.id).type;
  const rig: HeroRig = createHeroRig(def);
  const clock = new AnimClock();
  const smoothFacing = { value: Math.PI };
  let deathTime = 0;

  function triggerAttack(): void {
    clock.triggerAttack();
  }

  function handleEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'attack' && ev.sourceId === 'player') clock.triggerAttack();
      if (ev.kind === 'damage' && ev.targetKind === 'player') clock.triggerHit();
    }
  }

  function update(state: GameState, dt: number, alpha: number, elapsed: number): void {
    clock.advance(dt);
    const p = state.player;
    const x = p.previousPosition.x + (p.position.x - p.previousPosition.x) * alpha;
    const z = p.previousPosition.z + (p.position.z - p.previousPosition.z) * alpha;

    const speedNow = Math.hypot(p.velocity.x, p.velocity.z);
    const speedRatio = Math.min(1, speedNow / p.speed);

    rig.root.position.set(x, 0, z);

    const blend = Math.min(1, 14 * dt);
    const diff = Math.atan2(Math.sin(p.facing - smoothFacing.value), Math.cos(p.facing - smoothFacing.value));
    smoothFacing.value += diff * blend;
    rig.root.rotation.y = smoothFacing.value;

    const dead = p.hp <= 0;
    if (dead) deathTime += dt;

    rig.pose({
      time: elapsed,
      distance: speedNow * dt,
      speedRatio: dead ? 0 : speedRatio,
      attack: dead ? null : clock.attackProgress,
      attackKind,
      hit: dead ? null : clock.hitProgress,
      death: dead ? Math.min(1, deathTime / DEATH_DURATION) : null,
    });
  }

  return { group: rig.root, update, triggerAttack, handleEvents };
}
