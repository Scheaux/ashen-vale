import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createGameState, FLASK_MAX_CHARGES } from '../sim/state';
import { rollItem } from '../sim/items';
import { createRng } from '../core/rng';
import { getPlayerStats } from '../systems/stats';
import { respawnPointFor } from '../systems/movement';
import { createSave, restoredXpToNext } from './schema';
import { restoreGameState } from './restore';

function campLayout(seed = 7): ZoneLayout {
  return {
    seed,
    name: 'test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [], camp: -1 },
    enemySpawns: [
      { enemyId: 'ashen-husk', x: 6, z: 6, elite: [], camp: 0 },
      { enemyId: 'cinder-cultist', x: 8, z: 6, elite: [], camp: 0 },
      { enemyId: 'mire-skitterer', x: -6, z: 2, elite: [], camp: 1 },
      { enemyId: 'ashen-husk', x: 0, z: -8, elite: [], camp: 2 },
    ],
  };
}

describe('restoreGameState', () => {
  it('restores progression, passives, inventory and derived stats', () => {
    const layout = campLayout();
    const state = createGameState(getClass('marauder'), layout);
    state.level = 5;
    state.xp = 10;
    state.passives.allocated.push('d1');
    state.inventory.bags.push(rollItem(createRng(11), 3, 'rare'));
    state.player.hp = 50;
    state.flasks.health.charges = 2;
    const save = createSave(state, 555);

    const restored = restoreGameState(save, layout);
    expect(restored.level).toBe(5);
    expect(restored.xp).toBe(10);
    expect(restored.xpToNext).toBe(restoredXpToNext(5));
    expect(restored.passives.allocated).toEqual(['root', 'd1']);
    expect(restored.inventory.bags).toHaveLength(1);
    expect(restored.inventory.bags[0].uid).toBe(state.inventory.bags[0].uid);
    expect(restored.inventory.bags[0]).not.toBe(save.inventory.bags[0]);
    expect(restored.player.hp).toBe(50);
    expect(restored.player.maxHp).toBe(Math.round(getPlayerStats(restored).maxHp));
    expect(restored.player.mana).toBe(restored.player.maxMana);
    expect(restored.player.energyShield).toBe(restored.player.maxEnergyShield);
    expect(restored.flasks.health.charges).toBe(2);
    expect(restored.flasks.mana.charges).toBe(FLASK_MAX_CHARGES);
    expect(restored.objectives).toBe(restored.progress['ashen-moor']);
  });

  it('keeps cleared camps clear and removes their enemies', () => {
    const layout = campLayout();
    const state = createGameState(getClass('ranger'), layout);
    state.objectives.campCleared = [true, false, false];
    const save = createSave(state);

    const restored = restoreGameState(save, layout);
    expect(restored.objectives.campCleared).toEqual([true, false, false]);
    expect(restored.enemies.map((enemy) => enemy.camp)).toEqual([1, 2]);
    expect(restored.enemies.some((enemy) => enemy.camp === 0)).toBe(false);
  });

  it('slices saved camp slots down to the live layout camp count', () => {
    const layout = campLayout();
    const state = createGameState(getClass('ranger'), layout);
    state.objectives.campCleared = [true, true, false];
    const save = createSave(state);
    expect(save.progress['ashen-moor'].campsCleared).toHaveLength(16);
    const shortLayout = {
      ...campLayout(),
      enemySpawns: layout.enemySpawns.filter((spawn) => spawn.camp !== 2),
    };

    const restored = restoreGameState(save, shortLayout);
    expect(restored.objectives.campsTotal).toBe(2);
    expect(restored.objectives.campCleared).toEqual([true, true]);
    expect(restored.enemies).toHaveLength(0);
  });

  it('ignores v8 padding slots beyond the live three-camp layout', () => {
    const layout = campLayout();
    const state = createGameState(getClass('ranger'), layout);
    state.objectives.campCleared = [true, false, true];
    const save = createSave(state);
    // A future 16-camp save may carry cleared flags past the live camp count.
    save.progress['ashen-moor'].campsCleared[10] = true;

    const restored = restoreGameState(save, layout);
    expect(restored.objectives.campsTotal).toBe(3);
    expect(restored.objectives.campCleared).toEqual([true, false, true]);
  });

  it('restarts a live boss fight without requiring camp progress', () => {
    const layout = campLayout();
    const state = createGameState(getClass('witch'), layout);
    state.objectives.bossSpawned = true;
    const expected = respawnPointFor(state, layout);
    const save = createSave(state);

    const restored = restoreGameState(save, layout);
    const bosses = restored.enemies.filter((enemy) => enemy.defId === 'ashen-warden');
    expect(bosses).toHaveLength(1);
    expect(bosses[0].position).toEqual({ x: layout.bossSpawn.x, z: layout.bossSpawn.z });
    expect(bosses[0].hp).toBe(bosses[0].maxHp);
    expect(restored.objectives.campCleared.filter(Boolean)).toHaveLength(0);
    expect(restored.player.position).toEqual(expected);
    expect(restored.player.previousPosition).toEqual(expected);
    expect(restored.player.position).not.toEqual(layout.spawn);

    const thresholdDistance = Math.hypot(
      restored.player.position.x - layout.arena.center.x,
      restored.player.position.z - layout.arena.center.z,
    );
    expect(thresholdDistance).toBeLessThan(layout.arena.radius);
    expect(thresholdDistance).toBeGreaterThan(layout.arena.radius - 2);
    const zoneDistance = Math.hypot(restored.player.position.x, restored.player.position.z);
    expect(zoneDistance).toBeLessThanOrEqual(layout.bounds.radius - restored.player.radius);
  });

  it('does not respawn a defeated boss', () => {
    const layout = campLayout();
    const state = createGameState(getClass('witch'), layout);
    state.objectives.bossSpawned = true;
    state.objectives.bossDefeated = true;
    const save = createSave(state);

    const restored = restoreGameState(save, layout);
    expect(restored.objectives.bossDefeated).toBe(true);
    expect(restored.enemies.some((enemy) => enemy.defId === 'ashen-warden')).toBe(false);
    // The moor spawn is used again once the fight is over.
    expect(restored.player.position).toEqual(layout.spawn);
  });

  it('clamps an out-of-bounds position and revives a zero-hp save defensively', () => {
    const layout = campLayout();
    const state = createGameState(getClass('marauder'), layout);
    const save = createSave(state);
    save.position = { x: 500, z: -500 };
    save.hp = 0;

    const restored = restoreGameState(save, layout);
    const dist = Math.hypot(
      restored.player.position.x - layout.bounds.center.x,
      restored.player.position.z - layout.bounds.center.z,
    );
    expect(dist).toBeLessThanOrEqual(layout.bounds.radius - 2 + 1e-9);
    expect(restored.player.hp).toBe(restored.player.maxHp);
  });

  it('refuses saves from a different zone seed', () => {
    const save = createSave(createGameState(getClass('marauder'), campLayout(7)));
    expect(() => restoreGameState(save, campLayout(8))).toThrow(/different realm/);
  });

  it('refuses ossuary saves until 5.0d', () => {
    const layout = campLayout();
    const save = createSave(createGameState(getClass('marauder'), layout));
    save.zoneId = 'drowned-ossuary';
    save.progress['ashen-moor'] = {
      campsCleared: Array.from({ length: 16 }, (_, index) => index < 3),
      bossSpawned: true,
      bossDefeated: true,
    };

    expect(() => restoreGameState(save, layout)).toThrow(/Drowned Ossuary is not available yet/);
  });
});
