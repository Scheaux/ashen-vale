import type { ClassId } from '../content/types';
import { CLASSES } from '../content/classes';
import { AFFIXES } from '../content/affixes';
import { ITEM_BASES, ITEM_SLOTS, RARITY_COLORS, UNIQUES, type ItemSlot, type Rarity } from '../content/items';
import { getPassive, PASSIVE_ROOT } from '../content/passives';
import type { GameState, Vec2 } from '../sim/state';
import { FLASK_MAX_CHARGES } from '../sim/state';
import type { ItemInstance } from '../sim/items';
import { xpToNext } from '../systems/progression';
import { BAG_CAP } from '../systems/inventory';

/**
 * Versioned save schema. Serialization stays independent of three.js and of
 * live GameState internals so save migrations never break when runtime state
 * evolves. Saves describe character checkpoints, not exact combat/replay state.
 *
 * v1 -> v2 added progression + inventory.
 * v2 -> v3 added passive allocations, zone objective progress, and flask charges.
 */
export const SAVE_VERSION = 3;

export interface SaveInventory {
  bags: ItemInstance[];
  equipment: Record<ItemSlot, ItemInstance | null>;
}

/** Zone progress at the checkpoint; the live layout supplies camp totals. */
export interface SaveObjectives {
  campsCleared: boolean[];
  bossSpawned: boolean;
  bossDefeated: boolean;
}

export interface SaveGame {
  version: 3;
  classId: ClassId;
  hp: number;
  maxHp: number;
  position: { x: number; z: number };
  zoneSeed: number;
  level: number;
  xp: number;
  inventory: SaveInventory;
  /** Allocated passive node ids, including the permanent root. */
  passives: string[];
  objectives: SaveObjectives;
  flasks: { health: number; mana: number };
  /** Epoch milliseconds; excluded from equality checks. */
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

const FULL_FLASKS = (): SaveGame['flasks'] => ({
  health: FLASK_MAX_CHARGES,
  mana: FLASK_MAX_CHARGES,
});

export function createSave(state: GameState, savedAt = 0): SaveGame {
  return {
    version: SAVE_VERSION,
    classId: state.player.classId,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    position: { x: state.player.position.x, z: state.player.position.z },
    zoneSeed: state.zoneSeed,
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
    passives: [...state.passives.allocated],
    objectives: {
      campsCleared: state.objectives.campCleared.map((cleared) => cleared === true),
      bossSpawned: state.objectives.bossSpawned,
      bossDefeated: state.objectives.bossDefeated,
    },
    flasks: {
      health: state.flasks.health.charges,
      mana: state.flasks.mana.charges,
    },
    savedAt,
  };
}

/**
 * Checkpoint saves never store a dead character: if the player is already
 * down, the checkpoint records a full-health respawn at the zone spawn so
 * "Continue" always resumes play.
 */
export function createCheckpointSave(state: GameState, spawn: Vec2, savedAt = 0): SaveGame {
  const save = createSave(state, savedAt);
  if (state.player.hp <= 0) {
    save.hp = save.maxHp;
    save.position = { x: spawn.x, z: spawn.z };
  }
  return save;
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
 * Migration hook: upgrades v1 and v2 saves to v3 with conservative defaults,
 * passes validated v3 saves through, and rejects unknown versions rather than
 * silently misreading them.
 */
export function migrateSave(data: unknown): SaveGame {
  if (!isRecord(data)) throw new Error('Save data is not an object');
  if (data.version !== 1 && data.version !== 2 && data.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${String(data.version)}`);
  }

  const { hp, maxHp, position, zoneSeed } = data;
  const playerClass = CLASSES.find((def) => def.id === data.classId);
  if (!playerClass || !finite(hp) || !finite(maxHp) || hp < 0 || maxHp <= 0 || hp > maxHp ||
    !isRecord(position) || !finite(position.x) || !finite(position.z) ||
    !integerAtLeast(zoneSeed, 0) || zoneSeed > 0xffffffff) {
    throw new Error('Save data is missing required fields or has invalid character values');
  }
  const core = {
    version: SAVE_VERSION,
    classId: playerClass.id,
    hp,
    maxHp,
    position: { x: position.x, z: position.z },
    zoneSeed,
  } as const;

  if (data.version === 1) {
    return {
      ...core,
      level: 1,
      xp: 0,
      inventory: { bags: [], equipment: EMPTY_EQUIPMENT() },
      passives: [PASSIVE_ROOT],
      objectives: { campsCleared: [], bossSpawned: false, bossDefeated: false },
      flasks: FULL_FLASKS(),
      savedAt: integerAtLeast(data.savedAt, 0) ? data.savedAt : 0,
    };
  }

  const { level, xp, savedAt } = data;
  if (!integerAtLeast(level, 1) || !integerAtLeast(xp, 0) || xp >= xpToNext(level) || !integerAtLeast(savedAt, 0)) {
    throw new Error('Save data has invalid progression or timestamp');
  }
  const progression = {
    level,
    xp,
    inventory: parseInventory(data.inventory),
    savedAt,
  } as const;

  if (data.version === 2) {
    return {
      ...core,
      ...progression,
      passives: [PASSIVE_ROOT],
      objectives: { campsCleared: [], bossSpawned: false, bossDefeated: false },
      flasks: FULL_FLASKS(),
    };
  }

  return {
    ...core,
    ...progression,
    passives: parsePassives(data.passives, level),
    objectives: parseObjectives(data.objectives),
    flasks: parseFlasks(data.flasks),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integerAtLeast(value: unknown, min: number): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= min;
}

function parsePassives(value: unknown, level: number): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Save data has invalid passives');
  const allocated = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !getPassive(id) || allocated.has(id)) {
      throw new Error('Save data has an invalid passive node');
    }
    allocated.add(id);
  }
  if (!allocated.has(PASSIVE_ROOT)) throw new Error('Save data is missing the passive root');
  // One point per level gained; the root is free.
  if (allocated.size - 1 > level - 1) throw new Error('Save data has more passives than levels allow');
  // Every allocated node must still be connected to the allocated path.
  for (const id of allocated) {
    const node = getPassive(id)!;
    if (!node.prereqs.every((prereq) => allocated.has(prereq))) {
      throw new Error('Save data has an orphaned passive node');
    }
  }
  return [...allocated];
}

function parseObjectives(value: unknown): SaveObjectives {
  if (!isRecord(value) || !Array.isArray(value.campsCleared) || value.campsCleared.length > 32 ||
    !value.campsCleared.every((flag) => typeof flag === 'boolean') ||
    typeof value.bossSpawned !== 'boolean' || typeof value.bossDefeated !== 'boolean') {
    throw new Error('Save data has invalid zone objectives');
  }
  const campsCleared = [...value.campsCleared] as boolean[];
  if (value.bossDefeated && !value.bossSpawned) throw new Error('Save data has an impossible boss state');
  if (value.bossSpawned && !campsCleared.every(Boolean)) {
    throw new Error('Save data spawns the boss before the camps are cleared');
  }
  return { campsCleared, bossSpawned: value.bossSpawned, bossDefeated: value.bossDefeated };
}

function parseFlasks(value: unknown): SaveGame['flasks'] {
  if (!isRecord(value) ||
    !integerAtLeast(value.health, 0) || value.health > FLASK_MAX_CHARGES ||
    !integerAtLeast(value.mana, 0) || value.mana > FLASK_MAX_CHARGES) {
    throw new Error('Save data has invalid flask charges');
  }
  return { health: value.health, mana: value.mana };
}

function parseInventory(value: unknown): SaveInventory {
  if (!isRecord(value) || !Array.isArray(value.bags) || value.bags.length > BAG_CAP || !isRecord(value.equipment)) {
    throw new Error('Save data has invalid inventory');
  }
  const equipment = EMPTY_EQUIPMENT();
  const seen = new Set<string>();
  function parseItem(raw: unknown): ItemInstance {
    if (!isRecord(raw)) throw new Error('Save data has an invalid item');
    const { uid, baseId, slot, rarity, name, itemLevel, affixes } = raw;
    if (typeof uid !== 'string' || !uid || seen.has(uid) || typeof rarity !== 'string' ||
      !Object.hasOwn(RARITY_COLORS, rarity) || typeof name !== 'string' || !name ||
      !integerAtLeast(itemLevel, 1) || !Array.isArray(affixes)) {
      throw new Error('Save data has an invalid item');
    }
    const base = (rarity === 'unique' ? UNIQUES : ITEM_BASES).find((entry) => entry.id === baseId);
    if (!base || base.slot !== slot) throw new Error('Save data has an invalid item base or slot');
    seen.add(uid);
    const seenAffixes = new Set<string>();
    const parsedAffixes = affixes.map((affix: unknown) => {
      if (!isRecord(affix) || typeof affix.id !== 'string' || !AFFIXES.some((def) => def.id === affix.id) ||
        seenAffixes.has(affix.id) || !integerAtLeast(affix.value, 0)) {
        throw new Error('Save data has an invalid item affix');
      }
      seenAffixes.add(affix.id);
      return { id: affix.id, value: affix.value };
    });
    return { uid, baseId: base.id, slot: base.slot, rarity: rarity as Rarity, name, itemLevel, affixes: parsedAffixes };
  }

  const bags = value.bags.map(parseItem);
  for (const key of Object.keys(value.equipment)) {
    const slot = ITEM_SLOTS.find((candidate) => candidate === key);
    if (!slot) throw new Error('Save data has an unknown equipment slot');
    const item = value.equipment[slot];
    if (item === null) continue;
    const parsed = parseItem(item);
    if (parsed.slot !== slot) throw new Error('Save data has an item equipped in the wrong slot');
    equipment[slot] = parsed;
  }
  return { bags, equipment };
}

/** Expected XP-to-next for the current level (used when restoring). */
export function restoredXpToNext(level: number): number {
  return xpToNext(level);
}
