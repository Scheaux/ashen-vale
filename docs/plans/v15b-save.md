# v1.5 5.0b — Save v7 and Zone Progress Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development`, task-by-task.

**Goal:** Introduce save schema v7 with per-zone progress and an explicit v1→v6→v7 migration chain, moor-only loading, live-boss checkpoint semantics, and save-slot UI that reads zone progress. No second-zone gameplay or travel yet.

**Baseline:** `dfb136b` on `main` (v1.4.1 + 5.0a). Branch `feat/v15b-save`.

## Global Constraints

- Simulation stays 2D/deterministic; no gameplay balance changes.
- `SAVE_VERSION = 7`; no v7 save is readable by v1.4.x, so document rollback.
- Live `ZoneProgress` uses `campCleared` (singular) and active-camp length; saved `SaveZoneProgress` uses `campsCleared` (plural) and exactly 3 slots per zone.
- `createSave` copies/pads; it never mutates live `state.progress`.
- Migration must be explicit: `migrateV1ToV6` produces a real v6 intermediate; `migrateV6ToV7` maps `objectives` to `progress`.
- 5.0b loads only `ashen-moor`; a v7 save in the ossuary is refused until 5.0d.
- No nullable `arena`/`bossSpawn`, no second-zone generator, no travel.
- Agents do not commit; the director commits and runs the full gates.
- Branch-only until reviewed; no merge/tag without the user's decision.

## Interfaces

```ts
// src/content/zones.ts
export type BossTrigger = 'camps' | 'arena';
export interface ZoneDef {
  id: ZoneId; name: string; chapter: string; seed: number;
  campCount: number;   // save slots: 3 for both
  activeCamps: number; // moor 3; ossuary 1 in 5.0
  bossId: EnemyId | null; bossTrigger: BossTrigger; final: boolean;
}
export const ZONE_DEFS: Record<ZoneId, ZoneDef>;
export const ZONE_IDS: readonly ZoneId[];
export function getZoneDef(id: ZoneId): ZoneDef;
export function campCountForZone(id: ZoneId): number;
export function activeCampsForZone(id: ZoneId): number;
```

```ts
// src/sim/state.ts
export interface ZoneProgress {
  campsTotal: number; campCleared: boolean[]; bossSpawned: boolean; bossDefeated: boolean;
}
export interface GameState {
  zoneId: ZoneId;
  progress: Record<ZoneId, ZoneProgress>;
  /** Same object as progress[zoneId]. */
  objectives: ZoneProgress;
  bossTrigger: BossTrigger;
  finalZone: ZoneId;
  // existing fields...
}
```

```ts
// src/save/schema.ts
export const SAVE_VERSION = 7;
export interface SaveZoneProgress { campsCleared: boolean[]; bossSpawned: boolean; bossDefeated: boolean; }
export interface SaveGame {
  version: 7; classId: ClassId; hp: number; maxHp: number;
  position: { x: number; z: number }; zoneId: ZoneId; zoneSeed: number;
  progress: Record<ZoneId, SaveZoneProgress>;
  level: number; xp: number; inventory: SaveInventory; passives: string[];
  flasks: { health: number; mana: number }; skills: SaveSkills;
  currency: { dust: number; rune: number; quality: number }; savedAt: number;
}
export interface SaveGameV6 { version: 6; /* existing v6 shape with objectives */ }
export function migrateV1ToV6(data: unknown): SaveGameV6;
export function migrateV6ToV7(v6: SaveGameV6): SaveGame;
```

- `ZONE_DEFS`: moor `{ seed: 20261122, campCount: 3, activeCamps: 3, bossId: 'ashen-warden', bossTrigger: 'camps', final: false }`; ossuary `{ seed: 20261123, campCount: 3, activeCamps: 1, bossId: null, bossTrigger: 'arena', final: true }`.
- `createGameState`: `zoneId='ashen-moor'`; current `objectives` alias to `progress['ashen-moor']`; non-current ossuary progress active length 1; `bossTrigger`/`finalZone`.
- `createSave`: pad both zones to 3; `zoneId`/`zoneSeed`; no `objectives`.
- `validateV7`: both keys; exact 3 camp slots; boss flags; `bossDefeated ⇒ bossSpawned ⇒ all 3 cleared`; `zoneId='drowned-ossuary' ⇒ moor bossDefeated`; reject unknown keys/versions.
- `migrateSave`: accept 1–7; 1–6 → `migrateV1ToV6` → `migrateV6ToV7`; 7 → validate.
- `restoreGameState`: 5.0b requires `save.zoneId='ashen-moor'`; check `zoneSeed`; slice saved camps to the live layout camp count; alias `objectives`; live boss restores at full HP and places the player at `respawnPointFor`; defeated boss stays gone.
- `respawnPointFor(state, layout)`: if `bossSpawned && !bossDefeated`, return the arena threshold just inside the boundary; else layout spawn.
- `main.ts`: saveCheckpoint/saveToSlot/exportSave use `respawnPointFor`; respawn uses it; `loadSlot` rejects ossuary saves with a clear toast; `saves()` exposes `zoneId`, `zoneName`, progress counts.
- `ui/saveSlots.ts`: read `save.progress[save.zoneId]`, zone name from `ZONE_DEFS`, `campsTotal` from `campCountForZone`.
- Update `qa/verify-slice-04.mjs` and `qa/verify-v14.mjs` schema assertions/labels to 7.
- New `qa/verify-v15b.mjs`: export v7 shape, v6 completed save → Continue in moor, migration export, forged empty-camp refusal, save/reload.

## Tasks

### Task 1: Save v7 core, zone progress and consumers

**Files:**
- Create: `src/content/zones.ts`
- Modify: `src/sim/state.ts`
- Modify: `src/save/schema.ts`
- Modify: `src/save/restore.ts`
- Modify: `src/systems/movement.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/saveSlots.ts`
- Modify: `src/save/schema.test.ts`, `src/save/restore.test.ts`, `src/save/slots.test.ts` (as needed)

**Steps:**
- [ ] Add `ZONE_DEFS`, `ZoneDef`, `campCountForZone`, `activeCampsForZone`.
- [ ] Add `GameState.zoneId`, `progress`, `objectives` alias, `bossTrigger`, `finalZone`; initialize in `createGameState`.
- [ ] Replace v6 `SaveGame` with v7 `SaveGame` + `SaveGameV6`; `createSave` pads both zones; add `migrateV1ToV6`/`migrateV6ToV7`/`validateV7`; keep v1–v6 fixtures valid.
- [ ] `restoreGameState` uses v7 progress, moor-only, live-boss threshold via `respawnPointFor`.
- [ ] `main.ts` save/load/saves uses `respawnPointFor`, progress and zone fields; `ui/saveSlots.ts` reads progress/zone.
- [ ] Update unit tests: v7 round-trip, v1→v7, v6→v7, forged empty-camp gate, exact counts, live-boss threshold, alias identity.
- [ ] Run `npm run typecheck` and `npm test`. Do not run build/QA.

### Task 2: Browser QA and version assertions

**Files:**
- Create: `qa/verify-v15b.mjs`
- Modify: `qa/verify-slice-04.mjs`, `qa/verify-v14.mjs`, `package.json`

**Steps:**
- [ ] Update schema assertions/labels from 6 to 7.
- [ ] Add a v7 shape/export check, v6 completed save → Continue in moor, migration export, forged empty-camp refusal, and save/reload.
- [ ] Add the suite to `npm run qa` after `verify-v15a`.
- [ ] Run `npm run build && node qa/verify-v15b.mjs`; fix QA only unless a product bug is found.
- [ ] Report. Do not run full QA.

### Task 3: Full gates, review and handoff (director)

- [ ] Review diffs; dispatch reviewer(s).
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, full `npm run qa`.
- [ ] Commit on `feat/v15b-save`; no merge/tag without the user's decision.
- [ ] Update the handoff and note the v1.4.x rollback caveat (v7 is not readable by v1.4.x).

## Review Focus

1. A v6 completed save loads in the moor with 3/3 camps and the Warden defeated, and exports a valid v7.
2. A forged v7 with empty camps + `bossSpawned`/`bossDefeated` is rejected, not normalized into a valid gate.
3. v1→v7 and v6→v7 preserve every character field; no v6 `objectives` leaks into the v7 shape.
4. Live progress is active-length; saves are exactly 3; `createSave` does not mutate state.
5. A live-boss Continue places the hero at the arena threshold, not outside and not at the zone spawn.
6. Save cards show the correct zone and 3-slot camp count for both zones, while loading remains moor-only.

## Out of Scope

- Second-zone layout/generator, waypoints/travel, nullable arena/boss, 5.0c/5.0d.
- Warden chapter-end/run-summary product decisions.
- Tag/release/merge.
