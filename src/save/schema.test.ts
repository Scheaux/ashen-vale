import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { activeSkillsFor } from '../content/skills';
import { LOADOUT_SLOTS, type ZoneLayout } from '../content/types';
import { createGameState, FLASK_MAX_CHARGES } from '../sim/state';
import { rollItem } from '../sim/items';
import { createRng } from '../core/rng';
import {
  createCheckpointSave,
  createSave,
  deserializeSave,
  migrateSave,
  serializeSave,
  SAVE_VERSION,
} from './schema';

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

const emptyEquipment = () => ({
  weapon: null,
  helm: null,
  chest: null,
  gloves: null,
  boots: null,
  amulet: null,
});

function signatureId(classId: 'marauder' | 'ranger' | 'witch') {
  return activeSkillsFor(classId)[0].id;
}

function validSkills(classId: 'marauder' | 'ranger' | 'witch', level = 1) {
  const actives = activeSkillsFor(classId);
  const ranks: Record<string, number> = { [actives[0].id]: 1 };
  const loadout: Array<string | null> = LOADOUT_SLOTS.map(() => null);
  loadout[LOADOUT_SLOTS.indexOf('q')] = actives[0].id;
  if (level >= 2) {
    ranks[actives[1].id] = 1;
    loadout[LOADOUT_SLOTS.indexOf('w')] = actives[1].id;
  }
  if (level >= 4) {
    ranks[actives[2].id] = 1;
    loadout[LOADOUT_SLOTS.indexOf('e')] = actives[2].id;
  }
  return { ranks, loadout, runes: {} };
}

describe('save schema v5', () => {
  it('round-trips through serialize/deserialize', () => {
    const state = createGameState(getClass('witch'), emptyLayout());
    state.player.hp = 77;
    const save = createSave(state, 123456);
    expect(save.zoneSeed).toBe(7);
    expect(save.version).toBe(5);
    const restored = deserializeSave(serializeSave(save));
    expect(restored).toEqual(save);
  });

  it('captures progression, inventory, passives, objectives, flasks and skills', () => {
    const state = createGameState(getClass('marauder'), emptyLayout());
    const item = rollItem(createRng(3), 2);
    state.inventory.bags.push(item);
    state.level = 4;
    state.xp = 21;
    state.passives.allocated.push('o1', 'd1');
    state.objectives.campCleared = [true, false, true];
    state.flasks.health.charges = 2;
    const actives = activeSkillsFor('marauder');
    state.skills.ranks[actives[1].id] = 1;
    state.skills.loadout[LOADOUT_SLOTS.indexOf('w')] = actives[1].id;

    const save = createSave(state);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.level).toBe(4);
    expect(save.xp).toBe(21);
    expect(save.inventory.bags).toHaveLength(1);
    expect(save.passives).toEqual(['root', 'o1', 'd1']);
    expect(save.objectives.campsCleared).toEqual([true, false, true]);
    expect(save.flasks.health).toBe(2);
    expect(save.skills.ranks).toEqual({ [actives[0].id]: 1, [actives[1].id]: 1 });
    expect(save.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(actives[0].id);
    expect(save.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
    expect(save.skills.runes).toEqual({});
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
    expect(() => migrateSave({ version: 5, classId: 'witch' })).toThrow(/missing required fields/);
  });

  it('defensively copies nested save data', () => {
    const state = createGameState(getClass('ranger'), emptyLayout());
    state.inventory.bags.push(rollItem(createRng(5), 1, 'magic'));
    state.level = 3;
    state.passives.allocated.push('u1');
    state.objectives.campCleared = [true];
    const actives = activeSkillsFor('ranger');
    state.skills.ranks[actives[1].id] = 1;
    state.skills.loadout[LOADOUT_SLOTS.indexOf('w')] = actives[1].id;
    state.skills.runes[actives[0].id] = 'cruel';
    const save = createSave(state);
    const restored = migrateSave(save);
    expect(restored.inventory.bags[0].affixes[0]).not.toBe(save.inventory.bags[0].affixes[0]);
    expect(restored.passives).not.toBe(save.passives);
    expect(restored.objectives.campsCleared).not.toBe(save.objectives.campsCleared);
    expect(restored.skills.loadout).not.toBe(save.skills.loadout);
    restored.inventory.bags[0].uid = 'tampered';
    restored.inventory.bags.pop();
    restored.passives.push('u2');
    restored.objectives.campsCleared[0] = false;
    restored.skills.loadout[LOADOUT_SLOTS.indexOf('w')] = null;
    restored.skills.ranks[actives[1].id] = 3;
    restored.skills.runes[actives[0].id] = 'swift';
    expect(save.inventory.bags[0].uid).not.toBe('tampered');
    expect(save.inventory.bags).toHaveLength(1);
    expect(save.passives).toEqual(['root', 'u1']);
    expect(save.objectives.campsCleared).toEqual([true]);
    expect(save.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
    expect(save.skills.ranks[actives[1].id]).toBe(1);
    expect(save.skills.runes[actives[0].id]).toBe('cruel');
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

  it('rejects invalid passive allocations', () => {
    const save = createSave(createGameState(getClass('marauder'), emptyLayout()));
    for (const passives of [
      null,
      [],
      ['o1'],
      ['root', 'root'],
      ['root', 'nope'],
      ['root', 'o1'], // level 1 has no points
    ]) {
      expect(() => migrateSave({ ...save, passives })).toThrow();
    }
    expect(() => migrateSave({ ...save, level: 3, passives: ['root', 'o4'] })).toThrow(/orphaned/);
    expect(() => migrateSave({ ...save, level: 3, passives: ['root', 'o1', 'o4'] })).not.toThrow();
  });

  it('rejects malformed or impossible zone objectives', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    for (const objectives of [
      null,
      { campsCleared: [true, false], bossSpawned: true, bossDefeated: false },
      { campsCleared: [false], bossSpawned: true, bossDefeated: false },
      { campsCleared: [], bossSpawned: false, bossDefeated: true },
      { campsCleared: [1], bossSpawned: false, bossDefeated: false },
      { campsCleared: [], bossSpawned: 'yes', bossDefeated: false },
    ]) {
      expect(() => migrateSave({ ...save, objectives })).toThrow();
    }
    expect(() => migrateSave({
      ...save,
      objectives: { campsCleared: [true, true], bossSpawned: true, bossDefeated: true },
    })).not.toThrow();
  });

  it('rejects invalid flask charges', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    for (const flasks of [null, { health: -1, mana: 0 }, { health: 0, mana: FLASK_MAX_CHARGES + 1 }, { health: 1.5, mana: 0 }]) {
      expect(() => migrateSave({ ...save, flasks })).toThrow();
    }
  });

  it('rejects invalid skill ranks and loadouts', () => {
    const save = createSave(createGameState(getClass('marauder'), emptyLayout()));
    const signature = signatureId('marauder');
    const acts = activeSkillsFor('marauder');
    for (const skills of [
      null,
      { ranks: null, loadout: save.skills.loadout },
      { ranks: { nope: 1 }, loadout: save.skills.loadout },
      { ranks: { [signature]: 6 }, loadout: save.skills.loadout },
      { ranks: { [signature]: 0 }, loadout: save.skills.loadout },
      { ranks: {}, loadout: save.skills.loadout },
      { ranks: { [signature]: 1 }, loadout: [] },
      { ranks: { [signature]: 1 }, loadout: ['cleave', null, null, null, null, null] },
      { ranks: { [signature]: 1 }, loadout: [acts[1].id, null, null, null, null, null] },
      { ranks: { [signature]: 2 }, loadout: save.skills.loadout }, // level 1 cannot afford rank 2
    ]) {
      expect(() => migrateSave({ ...save, level: 1, skills })).toThrow();
    }
    expect(() => migrateSave({
      ...save,
      level: 4,
      skills: validSkills('marauder', 4),
    })).not.toThrow();
    const duplicate = validSkills('marauder', 4);
    duplicate.loadout[LOADOUT_SLOTS.indexOf('rmb')] = acts[0].id;
    expect(() => migrateSave({ ...save, level: 4, skills: duplicate })).toThrow(/duplicate/);
    expect(() => migrateSave({
      ...save,
      level: 4,
      skills: { ...validSkills('marauder', 4), runes: { [acts[0].id]: 'nope' } },
    })).toThrow(/rune/);
    expect(() => migrateSave({
      ...save,
      level: 4,
      skills: { ...validSkills('marauder', 4), runes: { [acts[0].id]: 'cruel' } },
    })).not.toThrow();
    expect(() => migrateSave({
      ...save,
      level: 4,
      skills: { ...validSkills('marauder', 4), runes: { [acts[0].id]: 'swift' } },
    })).toThrow(/rune/);
  });

  it('checkpoints a dead character at full life on the spawn point', () => {
    const state = createGameState(getClass('marauder'), emptyLayout());
    state.player.hp = 0;
    state.player.position = { x: 12, z: -4 };
    const save = createCheckpointSave(state, { x: 0, z: 18 }, 99);
    expect(save.hp).toBe(save.maxHp);
    expect(save.position).toEqual({ x: 0, z: 18 });
    expect(save.savedAt).toBe(99);
  });
});

describe('migration v1 -> v5', () => {
  const v1 = {
    version: 1,
    classId: 'ranger',
    hp: 55,
    maxHp: 120,
    position: { x: 3, z: 9 },
    zoneSeed: 42,
    savedAt: 999,
  };

  it('upgrades v1 with progression, inventory and skill defaults', () => {
    const migrated = migrateSave(v1);
    expect(migrated.version).toBe(5);
    expect(migrated.classId).toBe('ranger');
    expect(migrated.hp).toBe(55);
    expect(migrated.level).toBe(1);
    expect(migrated.xp).toBe(0);
    expect(migrated.inventory.bags).toEqual([]);
    expect(migrated.passives).toEqual(['root']);
    expect(migrated.objectives).toEqual({ campsCleared: [], bossSpawned: false, bossDefeated: false });
    expect(migrated.flasks).toEqual({ health: FLASK_MAX_CHARGES, mana: FLASK_MAX_CHARGES });
    expect(migrated.skills.ranks).toEqual({ [signatureId('ranger')]: 1 });
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(signatureId('ranger'));
    expect(migrated.savedAt).toBe(999);
  });

  it('rejects malformed v1 records', () => {
    expect(() => migrateSave({ ...v1, hp: undefined })).toThrow(/missing required fields/);
    expect(() => migrateSave({ ...v1, position: { x: 'a', z: 2 } })).toThrow(/missing required fields/);
  });

  it('migrated v1 saves pass the v5 validator', () => {
    const migrated = migrateSave(v1);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v2 -> v5', () => {
  const v2 = {
    version: 2,
    classId: 'witch',
    hp: 70,
    maxHp: 120,
    position: { x: -2, z: 4 },
    zoneSeed: 7,
    level: 3,
    xp: 12,
    inventory: { bags: [], equipment: emptyEquipment() },
    savedAt: 1234,
  };

  it('preserves progression and inventory while adding skill defaults', () => {
    const migrated = migrateSave(v2);
    expect(migrated.version).toBe(5);
    expect(migrated.level).toBe(3);
    expect(migrated.xp).toBe(12);
    expect(migrated.passives).toEqual(['root']);
    expect(migrated.objectives.campsCleared).toEqual([]);
    expect(migrated.flasks.health).toBe(FLASK_MAX_CHARGES);
    const actives = activeSkillsFor('witch');
    expect(migrated.skills.ranks).toEqual({ [actives[0].id]: 1, [actives[1].id]: 1 });
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(actives[0].id);
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
  });

  it('rejects v2 records missing an inventory', () => {
    expect(() => migrateSave({ ...v2, inventory: undefined })).toThrow(/invalid inventory/);
  });

  it('migrated v2 saves pass the v5 validator', () => {
    const migrated = migrateSave(v2);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v4 -> v5', () => {
  const skills = validSkills('marauder', 4);
  const { runes: _runes, ...v4Skills } = skills;
  const v4 = {
    version: 4,
    classId: 'marauder',
    hp: 90,
    maxHp: 120,
    position: { x: 1, z: 5 },
    zoneSeed: 7,
    level: 4,
    xp: 12,
    inventory: { bags: [], equipment: emptyEquipment() },
    passives: ['root', 'o1'],
    objectives: { campsCleared: [true, false, false], bossSpawned: false, bossDefeated: false },
    flasks: { health: 2, mana: 3 },
    skills: v4Skills,
    savedAt: 555,
  };

  it('preserves the v4 ranks and loadout and adds empty runes', () => {
    const migrated = migrateSave(v4);
    expect(migrated.version).toBe(5);
    expect(migrated.skills.ranks).toEqual(skills.ranks);
    expect(migrated.skills.loadout).toEqual(skills.loadout);
    expect(migrated.skills.runes).toEqual({});
  });

  it('migrated v4 saves pass the v5 validator', () => {
    const migrated = migrateSave(v4);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v3 -> v5', () => {
  const v3 = {
    version: 3,
    classId: 'marauder',
    hp: 90,
    maxHp: 120,
    position: { x: 1, z: 5 },
    zoneSeed: 7,
    level: 4,
    xp: 12,
    inventory: { bags: [], equipment: emptyEquipment() },
    passives: ['root', 'o1'],
    objectives: { campsCleared: [true, false, false], bossSpawned: false, bossDefeated: false },
    flasks: { health: 2, mana: 3 },
    savedAt: 555,
  };

  it('preserves v3 progress and pre-spends the legacy active kit', () => {
    const migrated = migrateSave(v3);
    expect(migrated.version).toBe(5);
    expect(migrated.level).toBe(4);
    expect(migrated.passives).toEqual(['root', 'o1']);
    expect(migrated.objectives.campsCleared).toEqual([true, false, false]);
    expect(migrated.flasks).toEqual({ health: 2, mana: 3 });
    const actives = activeSkillsFor('marauder');
    expect(migrated.skills.ranks).toEqual({
      [actives[0].id]: 1,
      [actives[1].id]: 1,
      [actives[2].id]: 1,
    });
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(actives[0].id);
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('e')]).toBe(actives[2].id);
  });

  it('migrated v3 saves pass the v5 validator', () => {
    const migrated = migrateSave(v3);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});
