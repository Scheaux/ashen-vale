import { describe, expect, it } from 'vitest';
import { getClass } from '../content/classes';
import type { ZoneLayout } from '../content/types';
import { createGameState } from '../sim/state';
import { createSave } from './schema';
import {
  createMemoryStorage,
  deleteSaveSlot,
  firstEmptySlot,
  isValidSlot,
  latestSaveSlot,
  listSaveSlots,
  readSaveSlot,
  SAVE_SLOT_COUNT,
  saveSlotBackupKey,
  saveSlotKey,
  writeSaveSlot,
  type SaveStorage,
} from './slots';

function layout(seed = 7): ZoneLayout {
  return {
    seed,
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

function makeSave(savedAt = 1000) {
  return createSave(createGameState(getClass('marauder'), layout()), savedAt);
}

describe('save slots', () => {
  it('starts with three empty slots', () => {
    const storage = createMemoryStorage();
    const slots = listSaveSlots(storage);
    expect(slots).toHaveLength(SAVE_SLOT_COUNT);
    expect(slots.every((slot) => slot.status === 'empty')).toBe(true);
    expect(latestSaveSlot(slots)).toBeNull();
    expect(firstEmptySlot(slots)).toBe(0);
    expect(isValidSlot(0)).toBe(true);
    expect(isValidSlot(SAVE_SLOT_COUNT)).toBe(false);
    expect(isValidSlot(-1)).toBe(false);
  });

  it('writes and reads a checkpoint in the chosen slot', () => {
    const storage = createMemoryStorage();
    const save = makeSave(1234);
    expect(writeSaveSlot(storage, 1, save)).toEqual({ ok: true });
    const reloaded = readSaveSlot(storage, 1);
    expect(reloaded).toMatchObject({ ok: true, recovered: false });
    if (reloaded.ok) expect(reloaded.save).toEqual(save);

    const slots = listSaveSlots(storage);
    expect(slots[1].status).toBe('ok');
    expect(slots[1].save?.savedAt).toBe(1234);
    expect(firstEmptySlot(slots)).toBe(0);
    expect(latestSaveSlot(slots)?.slot).toBe(1);
  });

  it('recovers the previous checkpoint when the slot body is corrupted', () => {
    const storage = createMemoryStorage();
    writeSaveSlot(storage, 0, makeSave(1000));
    writeSaveSlot(storage, 0, makeSave(2000));
    // Simulate a torn write: the newest body is unreadable, the backup is intact.
    storage.setItem(saveSlotKey(0), '{"version":3,"classId":');

    const read = readSaveSlot(storage, 0);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.recovered).toBe(true);
      expect(read.save.savedAt).toBe(1000);
    }
    const info = listSaveSlots(storage)[0];
    expect(info.status).toBe('ok');
    expect(info.recovered).toBe(true);
    expect(info.save?.savedAt).toBe(1000);
  });

  it('reports a corrupt slot without throwing and lets it be deleted', () => {
    const storage = createMemoryStorage();
    storage.setItem(saveSlotKey(2), 'not a save');
    storage.setItem(saveSlotBackupKey(2), 'also not a save');

    const slots = listSaveSlots(storage);
    expect(slots[2].status).toBe('corrupt');
    expect(slots[2].error).toBeTruthy();
    expect(readSaveSlot(storage, 2).ok).toBe(false);
    expect(latestSaveSlot(slots)).toBeNull();

    expect(deleteSaveSlot(storage, 2)).toEqual({ ok: true });
    expect(listSaveSlots(storage)[2].status).toBe('empty');
    expect(storage.getItem(saveSlotBackupKey(2))).toBeNull();
  });

  it('picks the most recent readable slot for Continue', () => {
    const storage = createMemoryStorage();
    writeSaveSlot(storage, 0, makeSave(900));
    writeSaveSlot(storage, 2, makeSave(3000));
    writeSaveSlot(storage, 1, makeSave(1500));
    expect(latestSaveSlot(listSaveSlots(storage))?.slot).toBe(2);

    deleteSaveSlot(storage, 2);
    expect(latestSaveSlot(listSaveSlots(storage))?.slot).toBe(1);
  });

  it('rejects unknown slots and storage failures without throwing', () => {
    const storage = createMemoryStorage();
    expect(writeSaveSlot(storage, -1, makeSave())).toMatchObject({ ok: false });
    expect(readSaveSlot(storage, 9)).toMatchObject({ ok: false });
    expect(deleteSaveSlot(storage, 9)).toMatchObject({ ok: false });

    const failingWrite: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const write = writeSaveSlot(failingWrite, 0, makeSave());
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error).toMatch(/quota exceeded/);
    expect(deleteSaveSlot(failingWrite, 0).ok).toBe(false);

    const failingRead: SaveStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(listSaveSlots(failingRead)[0].status).toBe('corrupt');
  });
});
