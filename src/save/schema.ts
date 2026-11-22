import type { ClassId } from '../content/types';
import type { ItemSlot } from '../content/items';
import type { GameState } from '../sim/state';
import type { ItemInstance } from '../sim/items';
import { xpToNext } from '../systems/progression';

/**
 * Versioned save schema. Serialization stays independent of three.js and of
 * live GameState internals so save migrations never break when runtime state
 * evolves. v1 -> v2 migration is exercised by schema.test.ts.
 */
export const SAVE_VERSION = 2;

export interface SaveInventory {
  bags: ItemInstance[];
  equipment: Record<ItemSlot, ItemInstance | null>;
}

export interface SaveGame {
  version: 2;
  classId: ClassId;
  hp: number;
  maxHp: number;
  position: { x: number; z: number };
  zoneSeed: number;
  level: number;
  xp: number;
  inventory: SaveInventory;
  /** Epoch milliseconds; excluded from equality checks. */
  savedAt: number;
}

/** The retired v1 shape, kept for migration. */
interface SaveGameV1 {
  version: 1;
  classId: ClassId;
  hp: number;
  maxHp: number;
  position: { x: number; z: number };
  zoneSeed: number;
  savedAt: number;
}

const EMPTY_EQUIPMENT = (): SaveInventory['equipment'] => ({
  weapon: null,
  helm: null,
  chest: null,
  gloves: null,
  boots: null,
  amulet: null,
});

export function createSave(state: GameState, savedAt = 0): SaveGame {
  return {
    version: SAVE_VERSION,
    classId: state.player.classId,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    position: { x: state.player.position.x, z: state.player.position.z },
    zoneSeed: 0,
    level: state.level,
    xp: state.xp,
    inventory: {
      bags: state.inventory.bags.map((i) => ({ ...i, affixes: i.affixes.map((a) => ({ ...a })) })),
      equipment: Object.fromEntries(
        Object.entries(state.inventory.equipment).map(([slot, item]) => [
          slot,
          item ? { ...item, affixes: item.affixes.map((a) => ({ ...a })) } : null,
        ]),
      ) as SaveInventory['equipment'],
    },
    savedAt,
  };
}

export function serializeSave(save: SaveGame): string {
  return JSON.stringify(save);
}

/** Parse and migrate raw JSON into the current schema. Throws on invalid data. */
export function deserializeSave(raw: string): SaveGame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Save data is not valid JSON');
  }
  return migrateSave(parsed);
}

/**
 * Migration hook: upgrades v1 saves to v2 (progression and inventory default
 * to fresh values), passes validated v2 through, and rejects unknown versions
 * rather than silently misreading them.
 */
export function migrateSave(data: unknown): SaveGame {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Save data is not an object');
  }
  const record = data as Record<string, unknown>;

  if (record.version === 1) {
    const v1 = data as SaveGameV1;
    validateCore(v1);
    return {
      version: 2,
      classId: v1.classId,
      hp: v1.hp,
      maxHp: v1.maxHp,
      position: { ...v1.position },
      zoneSeed: v1.zoneSeed,
      level: 1,
      xp: 0,
      inventory: { bags: [], equipment: EMPTY_EQUIPMENT() },
      savedAt: typeof v1.savedAt === 'number' ? v1.savedAt : 0,
    };
  }

  if (record.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${String(record.version)}`);
  }
  const save = data as SaveGame;
  validateCore(save);
  if (
    typeof save.level !== 'number' ||
    typeof save.xp !== 'number' ||
    !Array.isArray(save.inventory?.bags) ||
    typeof save.inventory?.equipment !== 'object'
  ) {
    throw new Error('Save data is missing required fields');
  }
  return {
    ...save,
    position: { ...save.position },
    inventory: {
      bags: save.inventory.bags.map((i) => ({ ...i })),
      equipment: { ...EMPTY_EQUIPMENT(), ...save.inventory.equipment },
    },
  };
}

function validateCore(data: { classId?: unknown; hp?: unknown; maxHp?: unknown; position?: { x: number; z: number }; zoneSeed?: unknown }): void {
  if (
    typeof data.classId !== 'string' ||
    typeof data.hp !== 'number' ||
    typeof data.maxHp !== 'number' ||
    typeof data.position?.x !== 'number' ||
    typeof data.position?.z !== 'number' ||
    typeof data.zoneSeed !== 'number'
  ) {
    throw new Error('Save data is missing required fields');
  }
}

/** Expected XP-to-next for the current level (used when restoring). */
export function restoredXpToNext(level: number): number {
  return xpToNext(level);
}
