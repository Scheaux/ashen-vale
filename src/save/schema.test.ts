import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createGameState } from '../sim/state';
import { rollItem } from '../sim/items';
import { createRng } from '../core/rng';
import { createSave, deserializeSave, migrateSave, serializeSave, SAVE_VERSION } from './schema';

function emptyLayout(): ZoneLayout {
  return {
    seed: 7,
    name: 'test',
    bounds: { center: { x: 0, z: 0 }, radius: 42 },
    spawn: { x: 0, z: 18 },
    colliders: [],
    props: [],
    arena: { center: { x: 0, z: -30 }, radius: 8 },
    bossSpawn: { enemyId: 'ashen-warden', x: 0, z: -30, elite: [] },
    enemySpawns: [],
  };
}

describe('save schema v2', () => {
  it('round-trips through serialize/deserialize', () => {
    const state = createGameState(getClass('witch'), emptyLayout());
    state.player.hp = 77;
    const save = createSave(state, 123456);
    expect(save.zoneSeed).toBe(7);
    const restored = deserializeSave(serializeSave(save));
    expect(restored).toEqual(save);
  });

  it('captures progression and inventory', () => {
    const state = createGameState(getClass('marauder'), emptyLayout());
    const item = rollItem(createRng(3), 2);
    state.inventory.bags.push(item);
    state.level = 4;
    state.xp = 21;

    const save = createSave(state);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.level).toBe(4);
    expect(save.xp).toBe(21);
    expect(save.inventory.bags).toHaveLength(1);
    expect(save.inventory.bags[0].uid).toBe(item.uid);
    expect(save.inventory.equipment.weapon).toBeNull();
  });

  it('rejects invalid JSON and non-objects', () => {
    expect(() => deserializeSave('not json')).toThrow();
    expect(() => deserializeSave('42')).toThrow();
    expect(() => migrateSave(null)).toThrow();
  });

  it('rejects unknown versions instead of misreading them', () => {
    expect(() => migrateSave({ version: 99 })).toThrow(/Unsupported save version/);
  });

  it('rejects incomplete records', () => {
    expect(() => migrateSave({ version: 2, classId: 'witch' })).toThrow(/missing required fields/);
  });

  it('defensively copies inventory', () => {
    const state = createGameState(getClass('ranger'), emptyLayout());
    state.inventory.bags.push(rollItem(createRng(5), 1, 'magic'));
    const save = createSave(state);
    const restored = migrateSave(save);
    expect(restored.inventory.bags[0].affixes[0]).not.toBe(save.inventory.bags[0].affixes[0]);
    restored.inventory.bags[0].uid = 'tampered';
    restored.inventory.bags.pop();
    expect(save.inventory.bags[0].uid).not.toBe('tampered');
    expect(save.inventory.bags).toHaveLength(1);
  });

  it('rejects unknown classes, invalid numbers, and impossible progression', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    for (const fields of [{ classId: 'unknown' }, { hp: NaN }, { hp: save.maxHp + 1 }, { xp: 60 }, { zoneSeed: -1 }]) {
      expect(() => migrateSave({ ...save, ...fields })).toThrow();
    }
  });

  it('rejects corrupt item records, duplicate identities, and incompatible equipment', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    const item = rollItem(createRng(5), 1, 'magic');
    const badSlot = item.slot === 'helm' ? 'weapon' : 'helm';
    for (const inventory of [
      { ...save.inventory, equipment: null },
      { ...save.inventory, bags: [null] },
      { ...save.inventory, bags: [item, item] },
      { ...save.inventory, bags: [{ ...item, affixes: [{ id: 'unknown', value: 1 }] }] },
      { ...save.inventory, equipment: { [badSlot]: item } },
    ]) {
      expect(() => migrateSave({ ...save, inventory })).toThrow();
    }
  });
});

describe('migration v1 -> v2', () => {
  const v1 = {
    version: 1,
    classId: 'ranger',
    hp: 55,
    maxHp: 120,
    position: { x: 3, z: 9 },
    zoneSeed: 42,
    savedAt: 999,
  };

  it('upgrades v1 with progression and inventory defaults', () => {
    const migrated = migrateSave(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.classId).toBe('ranger');
    expect(migrated.hp).toBe(55);
    expect(migrated.level).toBe(1);
    expect(migrated.xp).toBe(0);
    expect(migrated.inventory.bags).toEqual([]);
    expect(migrated.inventory.equipment.weapon).toBeNull();
    expect(migrated.savedAt).toBe(999);
  });

  it('rejects malformed v1 records', () => {
    expect(() => migrateSave({ ...v1, hp: undefined })).toThrow(/missing required fields/);
    expect(() => migrateSave({ ...v1, position: { x: 'a', z: 2 } })).toThrow(/missing required fields/);
  });

  it('migrated v1 saves pass the v2 validator', () => {
    const migrated = migrateSave(v1);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});
