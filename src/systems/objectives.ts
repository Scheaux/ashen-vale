import { createEnemyState, type GameState, type SimEvent } from '../sim/state';

/**
 * Zone objectives: camps are optional side content, and the Warden is an
 * end-of-zone encounter. With the `'end'` trigger the Warden wakes as soon as
 * the hero enters the end arena; the frozen `'camps'` trigger stays available
 * for legacy fixtures and migration-era tests. Camps never gate the boss.
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

  if (!o.bossSpawned) {
    const spawnNow = state.bossTrigger === 'camps'
      ? o.campsTotal > 0 && o.campCleared.every(Boolean)
      : Math.hypot(
        state.player.position.x - state.arena.center.x,
        state.player.position.z - state.arena.center.z,
      ) <= state.arena.radius;
    if (spawnNow) {
      o.bossSpawned = true;
      state.enemies.push(createEnemyState(state.bossSpawn, `boss-${state.tick}`));
      events.push({ kind: 'objective', text: 'The Ashen Warden stirs at the far end' });
    }
  }

  if (o.bossSpawned && !o.bossDefeated && !state.enemies.some((e) => !e.dead && e.defId === BOSS_ID)) {
    o.bossDefeated = true;
    events.push({ kind: 'objective', text: 'The Ashen Warden has fallen' });
    // Only the last campaign zone ends the run; earlier bosses open the gate
    // and continue the campaign. The victory event is emitted before the gate
    // toast so the victory screen's toast clear does not swallow it.
    if (state.zoneId === state.finalZone) events.push({ kind: 'victory' });
    events.push({ kind: 'objective', text: "The Warden's Gate opens" });
  }
}
