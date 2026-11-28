import { CLASSES } from '../content/classes';
import { AFFIXES } from '../content/affixes';
import { ITEM_BASES, ITEM_SLOTS, RARITY_COLORS, UNIQUES, type ItemSlot, type Rarity } from '../content/items';
import { getPassive, PASSIVE_ROOT } from '../content/passives';
import { getSkill, startingSkillFor } from '../content/skills';
import { getRune, type RuneId } from '../content/runes';
import { campCountForZone, ZONE_IDS } from '../content/zones';
import { LOADOUT_SLOTS, type ClassId, type SkillId, type ZoneId } from '../content/types';
import type { GameState, Vec2 } from '../sim/state';
import { FLASK_MAX_CHARGES } from '../sim/state';
import type { ItemInstance } from '../sim/items';
import { xpToNext } from '../systems/progression';
import { BAG_CAP } from '../systems/inventory';
import { defaultSkillState, MAX_SKILL_RANK } from '../systems/loadout';

/**
 * Versioned save schema. Serialization stays independent of three.js and of
 * live GameState internals so save migrations never break when runtime state
 * evolves. Saves describe character checkpoints, not exact combat/replay state.
 *
 * v1 -> v2 added progression + inventory.
 * v2 -> v3 added passive allocations, zone objective progress, and flask charges.
 * v3 -> v4 added skill ranks, the six-slot loadout, and the skill-point economy.
 * v4 -> v5 added per-skill runes.
 * v5 -> v6 added item implicits/quality and the crafting economy.
 * v6 -> v7 added per-zone progress, zone identity and the zone seed.
 */
export const SAVE_VERSION = 7;

export interface SaveInventory {
  bags: ItemInstance[];
  equipment: Record<ItemSlot, ItemInstance | null>;
}

/** Saved progress for one zone; always exactly `campCount` camp slots. */
export interface SaveZoneProgress {
  campsCleared: boolean[];
  bossSpawned: boolean;
  bossDefeated: boolean;
}

/** Legacy v6 objective shape (the moor was the only zone). */
export interface SaveObjectives {
  campsCleared: boolean[];
  bossSpawned: boolean;
  bossDefeated: boolean;
}

export interface SaveSkills {
  /** Active-skill ranks; rank 1 means unlocked. */
  ranks: Partial<Record<SkillId, number>>;
  /** RMB, Q, W, E, R, F order; null means an empty slot. */
  loadout: Array<SkillId | null>;
  /** One rune per active skill. */
  runes: Partial<Record<SkillId, RuneId>>;
}

export interface SaveGame {
  version: 7;
  classId: ClassId;
  hp: number;
  maxHp: number;
  position: { x: number; z: number };
  zoneId: ZoneId;
  zoneSeed: number;
  progress: Record<ZoneId, SaveZoneProgress>;
  level: number;
  xp: number;
  inventory: SaveInventory;
  /** Allocated passive node ids, including the permanent root. */
  passives: string[];
  flasks: { health: number; mana: number };
  skills: SaveSkills;
  currency: { dust: number; rune: number; quality: number };
  /** Epoch milliseconds; excluded from equality checks. */
  savedAt: number;
}

/** The v1-v6 on-disk shape, reproduced exactly so the migration is explicit. */
export interface SaveGameV6 {
  version: 6;
  classId: ClassId;
  hp: number;
  maxHp: number;
  position: { x: number; z: number };
  zoneSeed: number;
  level: number;
  xp: number;
  inventory: SaveInventory;
  passives: string[];
  objectives: SaveObjectives;
  flasks: { health: number; mana: number };
  skills: SaveSkills;
  currency: { dust: number; rune: number; quality: number };
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

const EMPTY_CURRENCY = (): SaveGame['currency'] => ({ dust: 0, rune: 0, quality: 0 });

/** Copy one live zone into a fixed-width save slot array without mutating it. */
function saveZoneProgress(progress: GameState['progress'][ZoneId], zoneId: ZoneId): SaveZoneProgress {
  return {
    campsCleared: Array.from(
      { length: campCountForZone(zoneId) },
      (_, index) => progress.campCleared[index] === true,
    ),
    bossSpawned: progress.bossSpawned,
    bossDefeated: progress.bossDefeated,
  };
}

export function createSave(state: GameState, savedAt = 0): SaveGame {
  return {
    version: SAVE_VERSION,
    classId: state.player.classId,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    position: { x: state.player.position.x, z: state.player.position.z },
    zoneId: state.zoneId,
    zoneSeed: state.zoneSeed,
    progress: {
      'ashen-moor': saveZoneProgress(state.progress['ashen-moor'], 'ashen-moor'),
      'drowned-ossuary': saveZoneProgress(state.progress['drowned-ossuary'], 'drowned-ossuary'),
    },
    level: state.level,
    xp: state.xp,
    inventory: {
      bags: state.inventory.bags.map((item) => ({
        ...item,
        implicit: item.implicit ? { ...item.implicit } : null,
        affixes: item.affixes.map((a) => ({ ...a })),
      })),
      equipment: Object.fromEntries(
        Object.entries(state.inventory.equipment).map(([slot, item]) => [
          slot,
          item
            ? { ...item, implicit: item.implicit ? { ...item.implicit } : null, affixes: item.affixes.map((a) => ({ ...a })) }
            : null,
        ]),
      ) as SaveInventory['equipment'],
    },
    passives: [...state.passives.allocated],
    flasks: {
      health: state.flasks.health.charges,
      mana: state.flasks.mana.charges,
    },
    skills: {
      ranks: { ...state.skills.ranks },
      loadout: [...state.skills.loadout],
      runes: { ...state.skills.runes },
    },
    currency: { ...state.currency },
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
 * Migration hook: upgrades v1-v6 saves through the explicit v6 intermediate,
 * validates v7 saves, and rejects unknown versions rather than silently
 * misreading them.
 */
export function migrateSave(data: unknown): SaveGame {
  if (!isRecord(data)) throw new Error('Save data is not an object');
  if (data.version === SAVE_VERSION) return validateV7(data);
  if (typeof data.version === 'number' && data.version >= 1 && data.version <= 6) {
    return migrateV6ToV7(migrateV1ToV6(data));
  }
  throw new Error(`Unsupported save version: ${String(data.version)}`);
}

/**
 * Upgrade any v1-v6 save to a real v6 object (moor objectives, no zones).
 * Conservative defaults fill systems that did not exist yet.
 */
export function migrateV1ToV6(data: unknown): SaveGameV6 {
  if (!isRecord(data)) throw new Error('Save data is not an object');
  const version = data.version;
  if (version !== 1 && version !== 2 && version !== 3 &&
    version !== 4 && version !== 5 && version !== 6) {
    throw new Error(`Unsupported save version: ${String(version)}`);
  }

  const { hp, maxHp, position, zoneSeed } = data;
  const playerClass = CLASSES.find((def) => def.id === data.classId);
  if (!playerClass || !finite(hp) || !finite(maxHp) || hp < 0 || maxHp <= 0 || hp > maxHp ||
    !isRecord(position) || !finite(position.x) || !finite(position.z) ||
    !integerAtLeast(zoneSeed, 0) || zoneSeed > 0xffffffff) {
    throw new Error('Save data is missing required fields or has invalid character values');
  }
  const core = {
    version: 6,
    classId: playerClass.id,
    hp,
    maxHp,
    position: { x: position.x, z: position.z },
    zoneSeed,
  } as const;

  if (version === 1) {
    return {
      ...core,
      level: 1,
      xp: 0,
      inventory: { bags: [], equipment: EMPTY_EQUIPMENT() },
      passives: [PASSIVE_ROOT],
      objectives: { campsCleared: [], bossSpawned: false, bossDefeated: false },
      flasks: FULL_FLASKS(),
      skills: defaultSkillState(playerClass.id, 1, true),
      currency: EMPTY_CURRENCY(),
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
    inventory: parseInventory(data.inventory, version < 6),
    savedAt,
  } as const;

  if (version === 2) {
    return {
      ...core,
      ...progression,
      passives: [PASSIVE_ROOT],
      objectives: { campsCleared: [], bossSpawned: false, bossDefeated: false },
      flasks: FULL_FLASKS(),
      skills: defaultSkillState(playerClass.id, level, true),
      currency: EMPTY_CURRENCY(),
    };
  }

  if (version === 3) {
    return {
      ...core,
      ...progression,
      passives: parsePassives(data.passives, level),
      objectives: parseObjectives(data.objectives),
      flasks: parseFlasks(data.flasks),
      skills: defaultSkillState(playerClass.id, level, true),
      currency: EMPTY_CURRENCY(),
    };
  }

  if (version === 4) {
    return {
      ...core,
      ...progression,
      passives: parsePassives(data.passives, level),
      objectives: parseObjectives(data.objectives),
      flasks: parseFlasks(data.flasks),
      skills: parseSkills(data.skills, playerClass.id, level, true),
      currency: EMPTY_CURRENCY(),
    };
  }

  if (version === 5) {
    return {
      ...core,
      ...progression,
      passives: parsePassives(data.passives, level),
      objectives: parseObjectives(data.objectives),
      flasks: parseFlasks(data.flasks),
      skills: parseSkills(data.skills, playerClass.id, level, false),
      currency: EMPTY_CURRENCY(),
    };
  }

  return {
    ...core,
    ...progression,
    passives: parsePassives(data.passives, level),
    objectives: parseObjectives(data.objectives),
    flasks: parseFlasks(data.flasks),
    skills: parseSkills(data.skills, playerClass.id, level, false),
    currency: parseCurrency(data.currency),
  };
}

/**
 * Map a v6 moor-only save onto the v7 zone shape. Camp slots are padded to the
 * authored count; an oversized v6 camp list, or a padded result that would
 * forge a boss gate, is rejected by validateV7 instead of normalized.
 */
export function migrateV6ToV7(v6: SaveGameV6): SaveGame {
  const moorCamps = campCountForZone('ashen-moor');
  if (v6.objectives.campsCleared.length > moorCamps) {
    throw new Error('Save data has more camps than the Ashen Moor supports');
  }
  return validateV7({
    version: 7,
    classId: v6.classId,
    hp: v6.hp,
    maxHp: v6.maxHp,
    position: { x: v6.position.x, z: v6.position.z },
    zoneId: 'ashen-moor',
    zoneSeed: v6.zoneSeed,
    progress: {
      'ashen-moor': {
        campsCleared: Array.from(
          { length: moorCamps },
          (_, index) => v6.objectives.campsCleared[index] === true,
        ),
        bossSpawned: v6.objectives.bossSpawned,
        bossDefeated: v6.objectives.bossDefeated,
      },
      'drowned-ossuary': {
        campsCleared: Array.from({ length: campCountForZone('drowned-ossuary') }, () => false),
        bossSpawned: false,
        bossDefeated: false,
      },
    },
    level: v6.level,
    xp: v6.xp,
    inventory: v6.inventory,
    passives: v6.passives,
    flasks: v6.flasks,
    skills: v6.skills,
    currency: v6.currency,
    savedAt: v6.savedAt,
  });
}

const V7_FIELDS: ReadonlySet<string> = new Set([
  'version', 'classId', 'hp', 'maxHp', 'position', 'zoneId', 'zoneSeed',
  'progress', 'level', 'xp', 'inventory', 'passives', 'flasks', 'skills',
  'currency', 'savedAt',
]);

/**
 * Validate and defensively copy a v7 save. Both zones must carry exactly their
 * authored camp slots; boss flags must form a reachable gate, and entering the
 * ossuary requires the moor boss to be defeated.
 */
export function validateV7(data: unknown): SaveGame {
  if (!isRecord(data)) throw new Error('Save data is not an object');
  if (data.version !== SAVE_VERSION) throw new Error(`Unsupported save version: ${String(data.version)}`);
  for (const key of Object.keys(data)) {
    if (!V7_FIELDS.has(key)) throw new Error(`Save data has an unknown field: ${key}`);
  }

  const { hp, maxHp, position, zoneSeed } = data;
  const playerClass = CLASSES.find((def) => def.id === data.classId);
  const zoneId = data.zoneId;
  if (!playerClass || !finite(hp) || !finite(maxHp) || hp < 0 || maxHp <= 0 || hp > maxHp ||
    !isRecord(position) || !finite(position.x) || !finite(position.z) ||
    !integerAtLeast(zoneSeed, 0) || zoneSeed > 0xffffffff ||
    (zoneId !== 'ashen-moor' && zoneId !== 'drowned-ossuary')) {
    throw new Error('Save data is missing required fields or has invalid character values');
  }

  const { level, xp, savedAt } = data;
  if (!integerAtLeast(level, 1) || !integerAtLeast(xp, 0) || xp >= xpToNext(level) || !integerAtLeast(savedAt, 0)) {
    throw new Error('Save data has invalid progression or timestamp');
  }

  const progress = parseSaveProgress(data.progress);
  if (zoneId === 'drowned-ossuary' && !progress['ashen-moor'].bossDefeated) {
    throw new Error('Save data enters the Drowned Ossuary before the Ashen Warden falls');
  }

  return {
    version: 7,
    classId: playerClass.id,
    hp,
    maxHp,
    position: { x: position.x, z: position.z },
    zoneId,
    zoneSeed,
    progress,
    level,
    xp,
    inventory: parseInventory(data.inventory),
    passives: parsePassives(data.passives, level),
    flasks: parseFlasks(data.flasks),
    skills: parseSkills(data.skills, playerClass.id, level),
    currency: parseCurrency(data.currency),
    savedAt,
  };
}

function parseSaveProgress(value: unknown): Record<ZoneId, SaveZoneProgress> {
  if (!isRecord(value)) throw new Error('Save data has invalid zone progress');
  if (Object.keys(value).length !== ZONE_IDS.length || !ZONE_IDS.every((id) => Object.hasOwn(value, id))) {
    throw new Error('Save data must have progress for exactly every zone');
  }
  const progress = {} as Record<ZoneId, SaveZoneProgress>;
  for (const id of ZONE_IDS) progress[id] = parseSaveZoneProgress(value[id], id);
  return progress;
}

function parseSaveZoneProgress(value: unknown, zoneId: ZoneId): SaveZoneProgress {
  const expectedCamps = campCountForZone(zoneId);
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
    !Array.isArray(value.campsCleared) || value.campsCleared.length !== expectedCamps ||
    !value.campsCleared.every((flag) => typeof flag === 'boolean') ||
    typeof value.bossSpawned !== 'boolean' || typeof value.bossDefeated !== 'boolean') {
    throw new Error('Save data has invalid zone progress');
  }
  const campsCleared = [...value.campsCleared] as boolean[];
  if (value.bossDefeated && !value.bossSpawned) throw new Error('Save data has an impossible boss state');
  if (value.bossSpawned && !campsCleared.every(Boolean)) {
    throw new Error('Save data spawns the boss before the camps are cleared');
  }
  return { campsCleared, bossSpawned: value.bossSpawned, bossDefeated: value.bossDefeated };
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

function parseSkills(value: unknown, classId: ClassId, level: number, legacyNoRunes = false): SaveSkills {
  if (!isRecord(value) || !isRecord(value.ranks) || !Array.isArray(value.loadout)) {
    throw new Error('Save data has invalid skills');
  }
  const ranks: SaveSkills['ranks'] = {};
  const seen = new Set<SkillId>();
  for (const [rawId, rawRank] of Object.entries(value.ranks)) {
    if (!integerAtLeast(rawRank, 1) || rawRank > MAX_SKILL_RANK) {
      throw new Error('Save data has an invalid skill rank');
    }
    let skill;
    try {
      skill = getSkill(rawId as SkillId);
    } catch {
      throw new Error('Save data has an unknown skill');
    }
    if (skill.role !== 'active' || skill.classId !== classId || seen.has(skill.id)) {
      throw new Error('Save data has an invalid active skill');
    }
    seen.add(skill.id);
    ranks[skill.id] = rawRank;
  }
  const starting = startingSkillFor(classId);
  if ((ranks[starting.id] ?? 0) < 1) throw new Error('Save data is missing the starting skill');
  // The signature skill's first rank is free; every other rank costs a point.
  const spent = Object.values(ranks).reduce((sum, rank) => sum + (rank ?? 0), 0) - 1;
  if (spent > Math.max(0, level - 1)) throw new Error('Save data has more skill ranks than levels allow');
  if (value.loadout.length !== LOADOUT_SLOTS.length) throw new Error('Save data has an invalid loadout');
  const equipped = new Set<SkillId>();
  const loadout = value.loadout.map((raw) => {
    if (raw === null) return null;
    if (typeof raw !== 'string') throw new Error('Save data has an invalid loadout skill');
    let skill;
    try {
      skill = getSkill(raw as SkillId);
    } catch {
      throw new Error('Save data has an unknown loadout skill');
    }
    if (skill.role !== 'active' || skill.classId !== classId || !seen.has(skill.id) || equipped.has(skill.id)) {
      throw new Error('Save data has an invalid or duplicate loadout skill');
    }
    equipped.add(skill.id);
    return skill.id;
  });

  const runes: SaveSkills['runes'] = {};
  if (value.runes !== undefined || !legacyNoRunes) {
    if (!isRecord(value.runes)) throw new Error('Save data has invalid runes');
    for (const [rawId, rawRune] of Object.entries(value.runes)) {
      if (typeof rawRune !== 'string') throw new Error('Save data has an invalid rune');
      let skill;
      try {
        skill = getSkill(rawId as SkillId);
      } catch {
        throw new Error('Save data has a rune on an unknown skill');
      }
      if (skill.role !== 'active' || skill.classId !== classId || !seen.has(skill.id)) {
        throw new Error('Save data has a rune on a locked skill');
      }
      const rune = getRune(rawRune);
      if (!rune) throw new Error('Save data has an unknown rune');
      if (rune.unlockLevel > level) throw new Error('Save data has a rune above the character level');
      runes[skill.id] = rune.id;
    }
  }
  return { ranks, loadout, runes };
}

function parseCurrency(value: unknown): SaveGame['currency'] {
  if (!isRecord(value) || !integerAtLeast(value.dust, 0) || !integerAtLeast(value.rune, 0) ||
    !integerAtLeast(value.quality, 0)) {
    throw new Error('Save data has invalid crafting currency');
  }
  return { dust: value.dust, rune: value.rune, quality: value.quality };
}

function parseInventory(value: unknown, legacyItems = false): SaveInventory {
  if (!isRecord(value) || !Array.isArray(value.bags) || value.bags.length > BAG_CAP || !isRecord(value.equipment)) {
    throw new Error('Save data has invalid inventory');
  }
  const equipment = EMPTY_EQUIPMENT();
  const seen = new Set<string>();
  function parseItem(raw: unknown): ItemInstance {
    if (!isRecord(raw)) throw new Error('Save data has an invalid item');
    const { uid, baseId, slot, rarity, name, itemLevel, affixes, quality, implicit } = raw;
    if (typeof uid !== 'string' || !uid || seen.has(uid) || typeof rarity !== 'string' ||
      !Object.hasOwn(RARITY_COLORS, rarity) || typeof name !== 'string' || !name ||
      !integerAtLeast(itemLevel, 1) || !Array.isArray(affixes)) {
      throw new Error('Save data has an invalid item');
    }
    const base = (rarity === 'unique' ? UNIQUES : ITEM_BASES).find((entry) => entry.id === baseId);
    if (!base || base.slot !== slot) throw new Error('Save data has an invalid item base or slot');
    seen.add(uid);

    const parsedQuality = legacyItems ? 0 : quality;
    if (!integerAtLeast(parsedQuality, 0) || parsedQuality > 20) {
      throw new Error('Save data has invalid item quality');
    }
    let parsedImplicit: ItemInstance['implicit'] = null;
    if (!legacyItems && implicit !== null && implicit !== undefined) {
      if (!isRecord(implicit) || typeof implicit.id !== 'string' ||
        !AFFIXES.some((def) => def.id === implicit.id) || !integerAtLeast(implicit.value, 0)) {
        throw new Error('Save data has an invalid item implicit');
      }
      parsedImplicit = { id: implicit.id, value: implicit.value };
    }
    if (rarity === 'unique' && parsedImplicit) throw new Error('Uniques cannot carry implicits');

    const seenAffixes = new Set<string>();
    const parsedAffixes = affixes.map((affix: unknown) => {
      if (!isRecord(affix) || typeof affix.id !== 'string' || !AFFIXES.some((def) => def.id === affix.id) ||
        seenAffixes.has(affix.id) || !integerAtLeast(affix.value, 0)) {
        throw new Error('Save data has an invalid item affix');
      }
      seenAffixes.add(affix.id);
      return { id: affix.id, value: affix.value };
    });
    return {
      uid,
      baseId: base.id,
      slot: base.slot,
      rarity: rarity as Rarity,
      name,
      itemLevel,
      quality: parsedQuality,
      implicit: parsedImplicit,
      affixes: parsedAffixes,
    };
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
