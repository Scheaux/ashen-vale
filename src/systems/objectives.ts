import { createEnemyState, type GameState, type SimEvent } from '../sim/state';

/**
 * Zone objectives (slice 7): "clear the camps" then "slay the Ashen Warden".
 * Camps are spawn groups; a camp is cleared when its last member falls. The
 * Warden waits in the arena and only spawns once every camp is cleared, and
 * its death fires the victory event that closes the loop.
 */

const BOSS_ID = 'ashen-warden';

export function stepObjectives(state: GameState, events: SimEvent[]): void {
  const o = state.objectives;

  for (let camp = 0; camp < o.campCleared.length; camp++) {
    if (o.campCleared[camp]) continue;
    const alive = state.enemies.some((e) => !e.dead && e.camp === camp);
    if (!alive) {
      o.campCleared[camp] = true;
      const cleared = o.campCleared.filter(Boolean).length;
      events.push({ kind: 'objective', text: `Camp cleared — ${cleared}/${o.campCleared.length}` });
    }
  }

  if (o.campsTotal > 0 && !o.bossSpawned && o.campCleared.every(Boolean)) {
    o.bossSpawned = true;
    state.enemies.push(createEnemyState(state.bossSpawn, `boss-${state.tick}`));
    events.push({ kind: 'objective', text: 'The Ashen Warden stirs in its arena' });
  }

  if (o.bossSpawned && !o.bossDefeated && !state.enemies.some((e) => !e.dead && e.defId === BOSS_ID)) {
    o.bossDefeated = true;
    events.push({ kind: 'objective', text: 'The Ashen Warden has fallen' });
    events.push({ kind: 'victory' });
  }
}
