import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import { activeSkillsFor } from '../content/skills';
import { LOADOUT_SLOTS, type SkillId, type ZoneLayout } from '../content/types';
import { createGameState, FLASK_MAX_CHARGES } from '../sim/state';
import { rollItem } from '../sim/items';
import { createRng } from '../core/rng';
import {
  createCheckpointSave,
  createSave,
  deserializeSave,
  migrateSave,
  migrateV1ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  serializeSave,
  SAVE_VERSION,
  validateV7,
  validateV8,
  type SaveGameV6,
  type SaveGameV7,
  type SaveSkills,
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

/** Three authored camps, matching what a real moor layout always has. */
function campLayout(): ZoneLayout {
  return {
    ...emptyLayout(),
    enemySpawns: [
      { enemyId: 'ashen-husk', x: 6, z: 6, elite: [], camp: 0 },
      { enemyId: 'cinder-cultist', x: -6, z: 2, elite: [], camp: 1 },
      { enemyId: 'mire-skitterer', x: 0, z: -8, elite: [], camp: 2 },
    ],
  };
}

function twoCampLayout(): ZoneLayout {
  return {
    ...emptyLayout(),
    enemySpawns: [
      { enemyId: 'ashen-husk', x: 6, z: 6, elite: [], camp: 0 },
      { enemyId: 'mire-skitterer', x: -6, z: 2, elite: [], camp: 1 },
    ],
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

function validSkills(classId: 'marauder' | 'ranger' | 'witch', level = 1): SaveSkills {
  const actives = activeSkillsFor(classId);
  const ranks: SaveSkills['ranks'] = { [actives[0].id]: 1 };
  const loadout: Array<SkillId | null> = LOADOUT_SLOTS.map(() => null);
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

const emptyMoorProgress = () => ({
  campsCleared: Array.from({ length: 16 }, () => false),
  bossSpawned: false,
  bossDefeated: false,
});

const emptyOssuaryProgress = () => ({
  campsCleared: [false, false, false],
  bossSpawned: false,
  bossDefeated: false,
});

/** Frozen v7 progress shape: three boolean slots for both zones. */
const emptyV7Progress = () => ({
  campsCleared: [false, false, false],
  bossSpawned: false,
  bossDefeated: false,
});

const moorSlots = (...cleared: number[]) =>
  Array.from({ length: 16 }, (_, index) => cleared.includes(index));

describe('zone progress', () => {
  it('aliases objectives to the current zone and seeds both zones', () => {
    const state = createGameState(getClass('marauder'), campLayout());

    expect(state.zoneId).toBe('ashen-moor');
    expect(state.objectives).toBe(state.progress['ashen-moor']);
    expect(state.progress['ashen-moor'].campsTotal).toBe(3);
    expect(state.progress['ashen-moor'].campCleared).toEqual([false, false, false]);
    expect(state.progress['drowned-ossuary'].campsTotal).toBe(1);
    expect(state.progress['drowned-ossuary'].campCleared).toEqual([false]);
    expect(state.bossTrigger).toBe('camps');
    expect(state.finalZone).toBe('drowned-ossuary');

    state.objectives.campCleared[0] = true;
    expect(state.progress['ashen-moor'].campCleared[0]).toBe(true);
  });

  it('takes the current camp count from the live layout', () => {
    const state = createGameState(getClass('ranger'), twoCampLayout());
    expect(state.progress['ashen-moor'].campsTotal).toBe(2);
    expect(state.progress['ashen-moor'].campCleared).toEqual([false, false]);
    expect(state.progress['drowned-ossuary'].campCleared).toHaveLength(1);
  });
});

describe('save schema v8', () => {
  it('round-trips through serialize/deserialize', () => {
    const state = createGameState(getClass('witch'), emptyLayout());
    state.player.hp = 77;
    const save = createSave(state, 123456);
    expect(save.zoneId).toBe('ashen-moor');
    expect(save.zoneSeed).toBe(7);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.version).toBe(8);
    expect(save.progress['ashen-moor']).toEqual(emptyMoorProgress());
    expect(save.progress['drowned-ossuary']).toEqual(emptyOssuaryProgress());
    const restored = deserializeSave(serializeSave(save));
    expect(restored).toEqual(save);
  });

  it('captures progression, inventory, passives, zone progress, flasks and skills', () => {
    const state = createGameState(getClass('marauder'), campLayout());
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
    state.currency.dust = 4;
    item.quality = 10;

    const save = createSave(state);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.level).toBe(4);
    expect(save.xp).toBe(21);
    expect(save.inventory.bags).toHaveLength(1);
    expect(save.passives).toEqual(['root', 'o1', 'd1']);
    expect(save.progress['ashen-moor']).toEqual({
      campsCleared: moorSlots(0, 2),
      bossSpawned: false,
      bossDefeated: false,
    });
    expect(save.progress['drowned-ossuary']).toEqual(emptyOssuaryProgress());
    expect('objectives' in save).toBe(false);
    expect(save.flasks.health).toBe(2);
    expect(save.skills.ranks).toEqual({ [actives[0].id]: 1, [actives[1].id]: 1 });
    expect(save.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(actives[0].id);
    expect(save.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
    expect(save.skills.runes).toEqual({});
    expect(save.currency).toEqual({ dust: 4, rune: 0, quality: 0 });
    expect(save.inventory.bags[0].quality).toBe(10);
  });

  it('pads both zones to their authored slot counts without mutating live progress', () => {
    const state = createGameState(getClass('witch'), twoCampLayout());
    state.objectives.campCleared = [true, false];
    const live = state.objectives.campCleared;

    const save = createSave(state);
    expect(save.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0));
    expect(save.progress['ashen-moor'].campsCleared).toHaveLength(16);
    expect(save.progress['drowned-ossuary'].campsCleared).toEqual([false, false, false]);
    expect(save.progress['ashen-moor'].campsCleared).not.toBe(live);

    save.progress['ashen-moor'].campsCleared[1] = true;
    expect(state.objectives.campCleared).toEqual([true, false]);
    expect(state.objectives.campCleared).toHaveLength(2);
  });

  it('rejects invalid JSON and non-objects', () => {
    expect(() => deserializeSave('not json')).toThrow();
    expect(() => deserializeSave('42')).toThrow();
    expect(() => migrateSave(null)).toThrow();
  });

  it('rejects unknown versions instead of misreading them', () => {
    expect(() => migrateSave({ version: 99 })).toThrow(/Unsupported save version/);
    expect(() => migrateSave({ version: 9 })).toThrow(/Unsupported save version/);
    expect(() => migrateSave({ version: 8 })).toThrow(/missing required fields/);
  });

  it('rejects incomplete records', () => {
    expect(() => migrateSave({ version: 8, classId: 'witch' })).toThrow(/missing required fields/);
    expect(() => migrateSave({ version: 7, classId: 'witch' })).toThrow(/missing required fields/);
    expect(() => migrateSave({ version: 6, classId: 'witch' })).toThrow(/missing required fields/);
  });

  it('rejects unknown fields, including a leaked v6 objectives block', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    expect(() => migrateSave({ ...save, objectives: emptyOssuaryProgress() })).toThrow(/unknown field/);
  });

  it('defensively copies nested save data', () => {
    const state = createGameState(getClass('ranger'), campLayout());
    state.inventory.bags.push(rollItem(createRng(5), 1, 'magic'));
    state.level = 3;
    state.passives.allocated.push('u1');
    state.objectives.campCleared = [true, false, false];
    const actives = activeSkillsFor('ranger');
    state.skills.ranks[actives[1].id] = 1;
    state.skills.loadout[LOADOUT_SLOTS.indexOf('w')] = actives[1].id;
    state.skills.runes[actives[0].id] = 'cruel';
    const save = createSave(state);
    const restored = migrateSave(save);
    expect(restored.inventory.bags[0].affixes[0]).not.toBe(save.inventory.bags[0].affixes[0]);
    expect(restored.passives).not.toBe(save.passives);
    expect(restored.progress['ashen-moor'].campsCleared).not.toBe(save.progress['ashen-moor'].campsCleared);
    expect(restored.skills.loadout).not.toBe(save.skills.loadout);
    restored.inventory.bags[0].uid = 'tampered';
    restored.inventory.bags[0].quality = 20;
    restored.inventory.bags.pop();
    restored.passives.push('u2');
    restored.progress['ashen-moor'].campsCleared[0] = false;
    restored.skills.loadout[LOADOUT_SLOTS.indexOf('w')] = null;
    restored.skills.ranks[actives[1].id] = 3;
    restored.skills.runes[actives[0].id] = 'swift';
    expect(save.inventory.bags[0].uid).not.toBe('tampered');
    expect(save.inventory.bags).toHaveLength(1);
    expect(save.passives).toEqual(['root', 'u1']);
    expect(save.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0));
    expect(save.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
    expect(save.skills.ranks[actives[1].id]).toBe(1);
    expect(save.skills.runes[actives[0].id]).toBe('cruel');
    expect(save.inventory.bags[0].quality).toBe(0);
  });

  it('rejects unknown classes, invalid numbers, invalid zones and impossible progression', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    for (const fields of [
      { classId: 'unknown' },
      { hp: NaN },
      { hp: save.maxHp + 1 },
      { xp: 60 },
      { zoneSeed: -1 },
      { zoneId: 'unknown-zone' },
      { progress: null },
    ]) {
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

  it('rejects malformed or impossible v8 zone progress', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    const moor = save.progress['ashen-moor'];
    const ossuary = save.progress['drowned-ossuary'];
    for (const progress of [
      { 'ashen-moor': moor },
      { ...save.progress, 'drowned-crypt': ossuary },
      { ...save.progress, 'ashen-moor': { ...moor, campsCleared: [true, false] } },
      { ...save.progress, 'ashen-moor': { ...moor, campsCleared: [true, false, true] } },
      { ...save.progress, 'ashen-moor': { ...moor, campsCleared: [...moorSlots(), false] } },
      { ...save.progress, 'ashen-moor': { ...moor, campsCleared: Array.from({ length: 16 }, () => 0) } },
      { ...save.progress, 'ashen-moor': { ...moor, bossSpawned: 'yes' } },
      { ...save.progress, 'ashen-moor': { ...moor, bossDefeated: true } },
      { ...save.progress, 'ashen-moor': { ...moor, bossSpawned: true } },
      { ...save.progress, 'ashen-moor': { ...moor, campsCleared: moorSlots(0, 1), bossSpawned: true } },
      { ...save.progress, 'drowned-ossuary': { ...ossuary, campsCleared: [false, false] } },
    ]) {
      expect(() => migrateSave({ ...save, progress })).toThrow();
    }
    expect(() => migrateSave({
      ...save,
      progress: {
        ...save.progress,
        'ashen-moor': { campsCleared: moorSlots(0, 1, 2), bossSpawned: true, bossDefeated: true },
      },
    })).not.toThrow();
    expect(() => migrateSave({
      ...save,
      progress: {
        ...save.progress,
        'ashen-moor': {
          campsCleared: moorSlots(0, 1, 2, 15),
          bossSpawned: true,
          bossDefeated: false,
        },
      },
    })).not.toThrow();
  });

  it('rejects a forged v8 save with empty camps behind a boss gate', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    const forged = {
      ...save,
      progress: {
        ...save.progress,
        'ashen-moor': { campsCleared: moorSlots(), bossSpawned: true, bossDefeated: true },
      },
    };
    expect(() => migrateSave(forged)).toThrow(/before the camps are cleared/);
  });

  it('only permits an ossuary v8 save after the moor boss is defeated', () => {
    const save = createSave(createGameState(getClass('witch'), emptyLayout()));
    const ossuary = { ...save, zoneId: 'drowned-ossuary' as const };
    expect(() => migrateSave(ossuary)).toThrow(/before the Ashen Warden falls/);
    expect(() => migrateSave({
      ...ossuary,
      progress: {
        ...save.progress,
        'ashen-moor': { campsCleared: moorSlots(0, 1, 2), bossSpawned: true, bossDefeated: true },
      },
    })).not.toThrow();
  });

  it('accepts a directly validated v8 save', () => {
    const save = createSave(createGameState(getClass('marauder'), campLayout()));
    expect(validateV8(JSON.parse(JSON.stringify(save)))).toEqual(save);
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

  it('saves completed and live boss gates as valid v8 data', () => {
    const state = createGameState(getClass('marauder'), campLayout());
    state.objectives.campCleared = [true, true, true];

    state.objectives.bossSpawned = true;
    expect(() => migrateSave(createSave(state))).not.toThrow();

    state.objectives.bossDefeated = true;
    expect(() => migrateSave(createSave(state))).not.toThrow();
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

describe('migration v1 -> v6 -> v7 -> v8', () => {
  const v1 = {
    version: 1,
    classId: 'ranger',
    hp: 55,
    maxHp: 120,
    position: { x: 3, z: 9 },
    zoneSeed: 42,
    savedAt: 999,
  };

  it('produces a real v6 intermediate with objectives', () => {
    const v6 = migrateV1ToV6(v1);
    expect(v6.version).toBe(6);
    expect(v6.objectives).toEqual({ campsCleared: [], bossSpawned: false, bossDefeated: false });
    expect('progress' in v6).toBe(false);
  });

  it('upgrades v1 with progression, inventory and skill defaults', () => {
    const migrated = migrateSave(v1);
    expect(migrated.version).toBe(8);
    expect(migrated.classId).toBe('ranger');
    expect(migrated.hp).toBe(55);
    expect(migrated.zoneId).toBe('ashen-moor');
    expect(migrated.zoneSeed).toBe(42);
    expect(migrated.level).toBe(1);
    expect(migrated.xp).toBe(0);
    expect(migrated.inventory.bags).toEqual([]);
    expect(migrated.passives).toEqual(['root']);
    expect(migrated.progress['ashen-moor']).toEqual(emptyMoorProgress());
    expect(migrated.progress['drowned-ossuary']).toEqual(emptyOssuaryProgress());
    expect('objectives' in migrated).toBe(false);
    expect(migrated.flasks).toEqual({ health: FLASK_MAX_CHARGES, mana: FLASK_MAX_CHARGES });
    expect(migrated.currency).toEqual({ dust: 0, rune: 0, quality: 0 });
    expect(migrated.skills.ranks).toEqual({ [signatureId('ranger')]: 1 });
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(signatureId('ranger'));
    expect(migrated.savedAt).toBe(999);
  });

  it('rejects malformed v1 records', () => {
    expect(() => migrateSave({ ...v1, hp: undefined })).toThrow(/missing required fields/);
    expect(() => migrateSave({ ...v1, position: { x: 'a', z: 2 } })).toThrow(/missing required fields/);
  });

  it('migrated v1 saves pass the v8 validator', () => {
    const migrated = migrateSave(v1);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v2 -> v8', () => {
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
    expect(migrated.version).toBe(8);
    expect(migrated.level).toBe(3);
    expect(migrated.xp).toBe(12);
    expect(migrated.passives).toEqual(['root']);
    expect(migrated.progress['ashen-moor'].campsCleared).toEqual(moorSlots());
    expect(migrated.flasks.health).toBe(FLASK_MAX_CHARGES);
    const actives = activeSkillsFor('witch');
    expect(migrated.skills.ranks).toEqual({ [actives[0].id]: 1, [actives[1].id]: 1 });
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('q')]).toBe(actives[0].id);
    expect(migrated.skills.loadout[LOADOUT_SLOTS.indexOf('w')]).toBe(actives[1].id);
  });

  it('rejects v2 records missing an inventory', () => {
    expect(() => migrateSave({ ...v2, inventory: undefined })).toThrow(/invalid inventory/);
  });

  it('migrated v2 saves pass the v8 validator', () => {
    const migrated = migrateSave(v2);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v4 -> v8', () => {
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

  it('preserves the v4 ranks and loadout and adds empty runes and currency', () => {
    const migrated = migrateSave(v4);
    expect(migrated.version).toBe(8);
    expect(migrated.skills.ranks).toEqual(skills.ranks);
    expect(migrated.skills.loadout).toEqual(skills.loadout);
    expect(migrated.skills.runes).toEqual({});
    expect(migrated.currency).toEqual({ dust: 0, rune: 0, quality: 0 });
    expect(migrated.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0));
    expect(migrated.progress['ashen-moor'].campsCleared).toHaveLength(16);
  });

  it('migrated v4 saves pass the v8 validator', () => {
    const migrated = migrateSave(v4);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v5 -> v8', () => {
  const skills = validSkills('marauder', 4);
  const item = rollItem(createRng(9), 3, 'rare');
  const { quality: _quality, implicit: _implicit, ...legacyItem } = item;
  const v5 = {
    version: 5,
    classId: 'marauder',
    hp: 90,
    maxHp: 120,
    position: { x: 1, z: 5 },
    zoneSeed: 7,
    level: 4,
    xp: 12,
    inventory: { bags: [legacyItem], equipment: emptyEquipment() },
    passives: ['root', 'o1'],
    objectives: { campsCleared: [true, false, false], bossSpawned: false, bossDefeated: false },
    flasks: { health: 2, mana: 3 },
    skills: { ...skills, runes: { [activeSkillsFor('marauder')[0].id]: 'cruel' } },
    savedAt: 555,
  };

  it('defaults legacy item quality/implicit and currency', () => {
    const migrated = migrateSave(v5);
    expect(migrated.version).toBe(8);
    expect(migrated.inventory.bags[0].quality).toBe(0);
    expect(migrated.inventory.bags[0].implicit).toBeNull();
    expect(migrated.currency).toEqual({ dust: 0, rune: 0, quality: 0 });
    expect(migrated.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0));
    expect(Object.values(migrated.skills.runes)).toEqual(['cruel']);
  });

  it('migrated v5 saves pass the v8 validator', () => {
    const migrated = migrateSave(v5);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v3 -> v8', () => {
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
    expect(migrated.version).toBe(8);
    expect(migrated.level).toBe(4);
    expect(migrated.passives).toEqual(['root', 'o1']);
    expect(migrated.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0));
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

  it('migrated v3 saves pass the v8 validator', () => {
    const migrated = migrateSave(v3);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v6 -> v7', () => {
  const v6: SaveGameV6 = {
    version: 6,
    classId: 'marauder',
    hp: 80,
    maxHp: 120,
    position: { x: 1, z: 5 },
    zoneSeed: 7,
    level: 4,
    xp: 12,
    inventory: { bags: [], equipment: emptyEquipment() },
    passives: ['root', 'o1'],
    objectives: { campsCleared: [true, true, true], bossSpawned: true, bossDefeated: true },
    flasks: { health: 2, mana: 3 },
    skills: validSkills('marauder', 4),
    currency: { dust: 5, rune: 1, quality: 2 },
    savedAt: 777,
  };

  it('preserves every character field and maps the completed moor into v7', () => {
    const v7 = migrateV6ToV7(v6);
    expect(v7.version).toBe(7);
    expect(v7.classId).toBe('marauder');
    expect(v7.hp).toBe(80);
    expect(v7.maxHp).toBe(120);
    expect(v7.position).toEqual({ x: 1, z: 5 });
    expect(v7.zoneId).toBe('ashen-moor');
    expect(v7.zoneSeed).toBe(7);
    expect(v7.progress['ashen-moor']).toEqual({
      campsCleared: [true, true, true],
      bossSpawned: true,
      bossDefeated: true,
    });
    expect(v7.progress['drowned-ossuary']).toEqual(emptyV7Progress());
    expect(v7.level).toBe(4);
    expect(v7.xp).toBe(12);
    expect(v7.inventory).toEqual(v6.inventory);
    expect(v7.passives).toEqual(v6.passives);
    expect(v7.flasks).toEqual(v6.flasks);
    expect(v7.skills).toEqual(v6.skills);
    expect(v7.currency).toEqual(v6.currency);
    expect(v7.savedAt).toBe(777);
    expect('objectives' in v7).toBe(false);
  });

  it('pads short camp lists and rejects oversized ones', () => {
    const padded = migrateV6ToV7({
      ...v6,
      objectives: { campsCleared: [true, false], bossSpawned: false, bossDefeated: false },
    });
    expect(padded.progress['ashen-moor'].campsCleared).toEqual([true, false, false]);

    expect(() => migrateV6ToV7({
      ...v6,
      objectives: { campsCleared: [true, true, true, false], bossSpawned: false, bossDefeated: false },
    })).toThrow(/more camps/);
  });

  it('rejects a padded v6 save that would forge a boss gate', () => {
    expect(() => migrateV6ToV7({
      ...v6,
      objectives: { campsCleared: [true, true], bossSpawned: true, bossDefeated: false },
    })).toThrow(/before the camps are cleared/);
  });

  it('migrates a raw v6 save through migrateSave to v8', () => {
    const migrated = migrateSave(v6);
    expect(migrated.version).toBe(8);
    expect(migrated.progress['ashen-moor'].bossDefeated).toBe(true);
    expect(migrated.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0, 1, 2));
    expect(migrated.progress['ashen-moor'].campsCleared).toHaveLength(16);
    expect(() => migrateSave(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
  });
});

describe('migration v7 -> v8', () => {
  const v6: SaveGameV6 = {
    version: 6,
    classId: 'marauder',
    hp: 80,
    maxHp: 120,
    position: { x: 1, z: 5 },
    zoneSeed: 7,
    level: 4,
    xp: 12,
    inventory: { bags: [], equipment: emptyEquipment() },
    passives: ['root', 'o1'],
    objectives: { campsCleared: [true, true, true], bossSpawned: true, bossDefeated: true },
    flasks: { health: 2, mana: 3 },
    skills: validSkills('marauder', 4),
    currency: { dust: 5, rune: 1, quality: 2 },
    savedAt: 777,
  };

  function completedV7(): SaveGameV7 {
    return migrateV6ToV7(v6);
  }

  it('preserves the first three moor flags and pads slots 3-15 with false', () => {
    const v7 = completedV7();
    const v8 = migrateV7ToV8(v7);
    expect(v8.version).toBe(8);
    expect(v8.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0, 1, 2));
    expect(v8.progress['ashen-moor'].campsCleared).toHaveLength(16);
    expect(v8.progress['ashen-moor'].bossSpawned).toBe(true);
    expect(v8.progress['ashen-moor'].bossDefeated).toBe(true);
    expect(v8.progress['drowned-ossuary']).toEqual(emptyOssuaryProgress());
    expect(v8.classId).toBe(v7.classId);
    expect(v8.hp).toBe(v7.hp);
    expect(v8.inventory).toEqual(v7.inventory);
    expect(v8.savedAt).toBe(v7.savedAt);
  });

  it('preserves a partial three-slot v7 pattern and pads the rest', () => {
    const v8 = migrateV7ToV8({
      ...completedV7(),
      progress: {
        'ashen-moor': { campsCleared: [true, false, true], bossSpawned: false, bossDefeated: false },
        'drowned-ossuary': { campsCleared: [false, false, false], bossSpawned: false, bossDefeated: false },
      },
    });
    expect(v8.progress['ashen-moor'].campsCleared).toEqual(moorSlots(0, 2));
  });

  it('keeps the v7 validator strict about three slots', () => {
    const v7 = completedV7();
    expect(validateV7(JSON.parse(JSON.stringify(v7)))).toEqual(v7);
    expect(() => validateV7({
      ...v7,
      progress: {
        ...v7.progress,
        'ashen-moor': { campsCleared: moorSlots(0, 1, 2), bossSpawned: true, bossDefeated: true },
      },
    })).toThrow(/invalid zone progress/);
  });

  it('still rejects a v7 boss gate with only two cleared camps', () => {
    const v7 = completedV7();
    expect(() => migrateV7ToV8({
      ...v7,
      progress: {
        ...v7.progress,
        'ashen-moor': { campsCleared: [true, true, false], bossSpawned: true, bossDefeated: false },
      },
    })).toThrow(/before the camps are cleared/);
  });

  it('validates a completed 3-of-16 v8 save under the active-camp gate', () => {
    const v8 = migrateV7ToV8(completedV7());
    expect(validateV8(v8)).toEqual(v8);
    expect(v8.progress['ashen-moor'].campsCleared.filter(Boolean)).toHaveLength(3);
  });
});
