import type { GameState, HazardState, SimEvent } from './state';

export interface HazardSpec {
  kind: HazardState['kind'];
  x: number;
  z: number;
  radius: number;
  /** Seconds before the first detonation. */
  fuse: number;
  /** Lingering pool seconds after detonation; 0 = one-shot. */
  duration?: number;
  tickInterval?: number;
  damage: number;
  sourceName: string;
  color: number;
}

/**
 * Create a telegraphed ground hazard and advertise it as a sim event. The
 * event is the warning the render/tell-order layer consumes; the state is what
 * the hazard layer draws and the hazard tick resolves.
 */
export function spawnHazard(state: GameState, spec: HazardSpec, events: SimEvent[]): HazardState {
  const hazard: HazardState = {
    id: `hazard-${state.tick}-${state.hazards.length}`,
    kind: spec.kind,
    x: spec.x,
    z: spec.z,
    radius: spec.radius,
    fuse: spec.fuse,
    duration: spec.duration ?? 0,
    tickInterval: spec.tickInterval ?? 0.5,
    damage: spec.damage,
    sourceName: spec.sourceName,
    color: spec.color,
    age: 0,
    detonated: false,
    tickTimer: 0,
  };
  state.hazards.push(hazard);
  events.push({
    kind: 'hazard',
    id: hazard.id,
    x: hazard.x,
    z: hazard.z,
    radius: hazard.radius,
    color: hazard.color,
    duration: hazard.fuse,
  });
  return hazard;
}
