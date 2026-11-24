import { deserializeSave, serializeSave, type SaveGame } from './schema';

/**
 * localStorage save slots (slice 8). Three named slots, each write keeps the
 * previous contents as a backup, and reads fall back to that backup so a
 * partially written or corrupted slot can still be recovered. Storage access
 * is injected so unit tests never touch a real browser localStorage.
 */
export const SAVE_SLOT_COUNT = 3;
const KEY_PREFIX = 'ashen-vale:save:';
const BACKUP_SUFFIX = ':backup';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveSlotInfo {
  slot: number;
  status: 'empty' | 'ok' | 'corrupt';
  save: SaveGame | null;
  /** True when the slot body was unreadable and the backup was used. */
  recovered: boolean;
  error?: string;
}

export type SlotRead =
  | { ok: true; save: SaveGame; recovered: boolean }
  | { ok: false; error: string };

export type SlotWrite = { ok: true } | { ok: false; error: string };

export function saveSlotKey(slot: number): string {
  return `${KEY_PREFIX}${slot}`;
}

export function saveSlotBackupKey(slot: number): string {
  return `${KEY_PREFIX}${slot}${BACKUP_SUFFIX}`;
}

export function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < SAVE_SLOT_COUNT;
}

/** In-memory storage: the fallback for private modes and unit tests. */
export function createMemoryStorage(): SaveStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

/**
 * Browser localStorage when it is usable. A failed probe (private mode,
 * blocked storage) returns null so the caller can fall back to memory.
 */
export function browserSaveStorage(): SaveStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    const probe = 'ashen-vale:storage-probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function tryParse(raw: string | null): { ok: true; save: SaveGame } | { ok: false; error: string } {
  if (raw === null) return { ok: false, error: 'Save slot is empty' };
  try {
    return { ok: true, save: deserializeSave(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Read one slot, preferring the primary body and falling back to its backup. */
export function readSaveSlot(storage: SaveStorage, slot: number): SlotRead {
  if (!isValidSlot(slot)) return { ok: false, error: 'Unknown save slot' };
  let primary: string | null;
  let backup: string | null;
  try {
    primary = storage.getItem(saveSlotKey(slot));
    backup = storage.getItem(saveSlotBackupKey(slot));
  } catch (err) {
    return { ok: false, error: `Save storage is unavailable: ${errorText(err)}` };
  }
  const parsedPrimary = tryParse(primary);
  if (parsedPrimary.ok) return { ok: true, save: parsedPrimary.save, recovered: false };
  const parsedBackup = tryParse(backup);
  if (parsedBackup.ok) return { ok: true, save: parsedBackup.save, recovered: true };
  if (primary === null && backup === null) return { ok: false, error: 'Save slot is empty' };
  return { ok: false, error: parsedPrimary.error };
}

export function writeSaveSlot(storage: SaveStorage, slot: number, save: SaveGame): SlotWrite {
  if (!isValidSlot(slot)) return { ok: false, error: 'Unknown save slot' };
  try {
    const existing = storage.getItem(saveSlotKey(slot));
    if (existing !== null) storage.setItem(saveSlotBackupKey(slot), existing);
    storage.setItem(saveSlotKey(slot), serializeSave(save));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not write the save: ${errorText(err)}` };
  }
}

export function deleteSaveSlot(storage: SaveStorage, slot: number): SlotWrite {
  if (!isValidSlot(slot)) return { ok: false, error: 'Unknown save slot' };
  try {
    storage.removeItem(saveSlotKey(slot));
    storage.removeItem(saveSlotBackupKey(slot));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not delete the save: ${errorText(err)}` };
  }
}

/** Describe all slots for the save/load UI; corrupt saves never throw. */
export function listSaveSlots(storage: SaveStorage): SaveSlotInfo[] {
  const slots: SaveSlotInfo[] = [];
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
    let primary: string | null = null;
    let backup: string | null = null;
    try {
      primary = storage.getItem(saveSlotKey(slot));
      backup = storage.getItem(saveSlotBackupKey(slot));
    } catch (err) {
      slots.push({ slot, status: 'corrupt', save: null, recovered: false, error: errorText(err) });
      continue;
    }
    if (primary === null && backup === null) {
      slots.push({ slot, status: 'empty', save: null, recovered: false });
      continue;
    }
    const read = readSaveSlot(storage, slot);
    if (read.ok) {
      slots.push({ slot, status: 'ok', save: read.save, recovered: read.recovered });
    } else {
      slots.push({ slot, status: 'corrupt', save: null, recovered: false, error: read.error });
    }
  }
  return slots;
}

/** Most recently written readable slot, for the title screen's Continue. */
export function latestSaveSlot(slots: readonly SaveSlotInfo[]): SaveSlotInfo | null {
  let latest: SaveSlotInfo | null = null;
  for (const info of slots) {
    if (info.status !== 'ok' || !info.save) continue;
    if (!latest || !latest.save || info.save.savedAt > latest.save.savedAt) latest = info;
  }
  return latest;
}

export function firstEmptySlot(slots: readonly SaveSlotInfo[]): number | null {
  return slots.find((info) => info.status === 'empty')?.slot ?? null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
