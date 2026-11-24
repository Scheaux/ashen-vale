# Ashen Vale — Post-Release Polish & Expansion Plan

Baseline: **v1.0.0** (`b3091c1`, tag `v1.0.0`).
This plan starts with correctness and UX debt found in the shipped build, then
expands the game in vertical slices. Every release keeps the same gates:
deterministic tests, production build, full browser QA, screenshots, no console
errors, and the release render budget (≤320 draw calls / ≤260K triangles).

---

## 1. Executive summary

The v1.0.0 loop is complete, but the camera and skill-bar model now conflict with
the intended PoE-like feel, and the terrain is only visually consistent for
telegraphs. The next work is split into two small releases before content
expansion:

1. **v1.1 — Grounding, camera and HUD hotfix** (P0)
   Fix every ground-anchored marker/ring, remove camera rotation, remove the
   persistent bottom guide, and fix the destination-marker fade race.
2. **v1.2 — Skill progression and loadout** (P0)
   Separate the basic attack from the hotbar, start with one active skill,
   unlock more with levels, and make clicking a slot open a skill picker.
3. **v1.3+ — Expansion** (P1/P2)
   Combat depth, itemization/economy, a second zone and boss, endgame runs, then
   platform/accessibility work.

The P0 releases are intentionally independent of new content. They should ship
before the next zone so new terrain does not multiply the grounding debt.

---

## 2. Audit — confirmed bugs and inconsistencies

Severity: **H**igh = visible/blocking; **M**edium = noticeable or limits future
work; **L**ow = polish.

| ID | Issue | Sev | Evidence | Fix |
| --- | --- | --- | --- | --- |
| G1 | Move destination marker and hover ring sit at a fixed world height and go underground on raised ground | H | `render/cursor.ts`: ring y = `0.025` / `0.035`; `render/terrain.ts`: play-area undulation reaches ±0.16 and hills rise beyond r=44 | Give `CursorMarker` the terrain surface; set y = `heightAt(x,z) + clearance` on every hover/destination update |
| G2 | Enemy feet, elite aura rings and player feet are not terrain-grounded, while their blob shadows are | H | `render/player.ts` root y = 0; `render/enemies.ts` root y = 0, elite ring y = `0.035`, blob shadow uses `heightAt` | One shared `groundAt(x,z)` render helper; apply to hero/enemy roots, far silhouettes, elite rings, blob shadows and health bars |
| G3 | Loot crystals and beams use fixed heights | M | `render/loot.ts`: crystal y ≈ `0.4`, beam y = `1.2` | Offset both by `heightAt(drop.x, drop.z)`; keep the bob relative |
| G4 | Elite nameplates and floating combat text use fixed world heights | M | `ui/nameplates.ts`: y = `2.55`; sim damage events carry fixed y (`1.6`, `2.1`, `1.35`) rendered as absolute | Add the ground height in the render/UI layers; keep sim events 2D + height-above-ground |
| G5 | Projectiles and ground-pick ray use flat-world heights | M | `sim` projectile y is fixed; `main.ts` raycasts a `Plane(0,1,0)` | Render projectiles at `groundHeight + altitude`; raycast the terrain mesh or sample `heightAt` for pointer picks |
| G6 | Camera target and camera height ignore terrain | M | `render/camera.ts` `lookAt(..., 1.1, ...)` and camera y = `sin(pitch) * distance` | Pass a ground Y into `follow`/`snapTo`; target `groundY + 1.1`, offset camera by the same amount |
| U1 | Destination marker can vanish after a quick re-click | M | `render/cursor.ts`: `setDestination(point)` does not reset `destFade`, so an old fade keeps lowering opacity and can hide the new marker | Reset `destFade = 0` on a new destination; only run the fade branch while `!destVisible` |
| U2 | Camera rotation conflicts with the PoE-like fixed isometric camera | H | `main.ts` right-drag calls `rig.rotate`; `ui.ts` title hint says “Right drag to rotate”; `qa/verify-slice-01.mjs` tests rotation | Remove right-drag rotation and the `rotating` state; lock the camera yaw; keep zoom for now; update hints and QA |
| U3 | Persistent bottom guide clutters the play area | H | `ui/ui.ts` `.hud__hints` with move/attack/QWER/flask/passive/inventory/pause text | Remove the strip; add a compact **Controls** section to the pause menu and a one-time first-run toast |
| S1 | Every class starts with all four skills; level-ups do not unlock kit depth | H | `content/skills.ts` `skillsFor` returns all QWER skills; `createGameState` has no loadout | Add `unlockLevel`/`role` to skills and a 4-slot loadout; start with one active skill |
| S2 | Q is both the basic attack and a hotbar skill, duplicating left-click | H | `stepPlayerCombat` auto-repeats `basicAttackFor`; `skillsFor` includes Q; UI labels it “free” | Keep the basic attack on left-click only; the hotbar is for active skills |
| S3 | Clicking a hotbar slot casts the skill; there is no way to change skills | H | `ui.ts` `buildHotbar` attaches `onCastSlot` to every slot button | Clicking a slot opens a skill picker; QWER on the keyboard casts; empty slots are selectable |
| S4 | No skill library, empty-slot state, lock state or unlock feedback | H | No UI/model for a skill library | Add a DOM skill picker with locked/unlocked states, descriptions, mana/cooldown and a clear option |
| S5 | Saves do not persist a loadout | H | `save/schema.ts` v3 stores passives/objectives/flasks only | Schema v4 adds a validated loadout; v3→v4 migration builds a sensible default from class/level |
| C1 | Props and arena pillars can hide the player or boss | M | Boss-fight screenshots show a pillar covering the hero; no occlusion handling | Add a camera-to-player occlusion fade for props (instanced shader or per-instance depth-aware fade); test in the arena |
| C2 | The save/autosave badge is always visible | L | `ui.ts` `.hud__badge` permanent | Move save status to the pause menu, or fade the badge shortly after a save |
| C3 | LOD removes elite aura rings and attack animations at distance | L | `render/enemies.ts` far silhouettes are unlit and have no elite ring | Add a small elite marker to far silhouettes; keep ground telegraphs for attacks |
| C4 | Health bars are drawn through all geometry | L (by design) | Instanced bars use `depthTest: false` | Keep for readability; document the choice and test that it does not obscure UI |

### Intentional choices to keep

- Health bars through walls/props (combat readability).
- Milestone checkpoints, not mid-combat replay snapshots.
- Procedural placeholder art and desktop-first controls.
- Simulation stays 2D and deterministic; all terrain grounding is render-only.

---

## 3. Requested design changes — specification

### 3.1 Camera: fixed PoE-like isometric

**Decision:** remove yaw rotation. Keep a fixed isometric yaw (proposed π/4;
current 0.22π is close but arbitrary) and a fixed pitch. Keep scroll zoom for
now as an accessibility/QoL option; lock it behind a setting only if playtests
show it hurts readability.

Acceptance:
- Right-drag does not change camera yaw or player aiming.
- Scroll zoom still works and is clamped.
- The title hint, README controls, HUD help and `qa/verify-slice-01.mjs` no
  longer mention rotation.
- A fixed-yaw screenshot of the arena, a camp and the title passes art review.

Files: `render/camera.ts`, `main.ts` input/hover, `ui/ui.ts`, `qa/verify-slice-01.mjs`,
`README.md`.

### 3.2 HUD: remove the bottom guide

**Decision:** delete the persistent `.hud__hints` strip. Replace it with:
- a **Controls** section in the pause menu (move, attack, QWER, flasks, passives,
  inventory, pause, picker);
- one short first-run toast (e.g. “Left click to move and attack · QWER cast ·
  Esc for controls”) that disappears;
- the same controls list on the title screen or its own small help overlay.

Acceptance:
- No persistent keybind strip during play.
- Controls remain discoverable within two clicks (Esc → Controls).
- HUD screenshots at 1440×900 and a 1280×800 window are not crowded.
- The save/autosave status either moves into the pause menu or fades after a
  checkpoint.

### 3.3 Skills: progression, one starting active, click-to-swap

**Decision:** the left-click basic attack stays but leaves the hotbar. The
hotbar has four loadout slots (Q/W/E/R); a fresh character starts with **one
active skill** and unlocks the rest with levels. Clicking a slot opens a picker;
keyboard QWER casts.

Proposed content model:

```ts
type SkillRole = 'basic' | 'active';

interface SkillDef {
  role: SkillRole;
  /** Active skills: character level required. Basic = 0. */
  unlockLevel: number;
  // slot is no longer a property of the skill
}

interface PlayerState {
  loadout: Array<SkillId | null>; // length 4, Q/W/E/R
}
```

Recommended starting skill and unlock schedule:

| Class | Left-click basic | Starts with (Q) | Level 2/3 | Level 4/5 | Level 6+ |
| --- | --- | --- | --- | --- | --- |
| Marauder | Cleave | Sunder | Whirlwind | Reckless Charge | 4th active (expansion) |
| Ranger | Piercing Shot | Split Shot | Snipe | Rain of Arrows | 4th active (expansion) |
| Witch | Ember Bolt | Ember Nova | Cinder Barrage | Meteor Strike | 4th active (expansion) |

Exact thresholds are a balance decision; the plan is one active at level 1 and
three by the time the camps are being cleared. Newly unlocked skills auto-equip
into the first empty slot (and show a toast); the player can click any slot to
change it. If every slot is full, the new skill appears in the library with an
“Unlocked” badge.

Loadout rules:
- One skill per slot, no duplicates.
- A skill must belong to the class and be unlocked at the current level.
- Empty slots are valid; casting one shows “No skill assigned — click the slot”.
- Cooldowns remain keyed by skill id, so moving a skill keeps its cooldown.
- The basic attack is never assignable to a slot; it is the left-click verb.
- Save schema v4 stores the loadout; v1–v3 saves migrate to the default loadout
  for their class and level.

UI:
- Hotbar always shows four slots, with empty slots visibly empty (`+`/“Assign”).
- Hover tooltips show name, damage, mana, cooldown and description.
- Clicking a slot opens a panel listing every class skill: unlocked ones are
  selectable, locked ones show “Unlocks at level N”.
- The panel supports clearing a slot; Escape/click-away closes.
- A level-up toast announces new unlocks; the passive-points badge and skill
  unlock badge must not overlap.
- The basic attack gets a one-line mention in the Controls panel, not a hotbar
  slot.

Acceptance:
- Fresh character has exactly one active skill in Q and three empty slots.
- Left-click attacks still repeat the class basic attack for free.
- No locked skill can be equipped or cast through any path.
- Clicking a slot never casts the skill.
- QWER casts the equipped skills and refuses visibly for empty/mana/cooldown.
- Save/reload preserves the loadout; a v3 save loads with a sensible default.
- Unit tests cover unlock levels, loadout validation, casting, and migration;
  browser QA covers the picker and reload.

Files: `content/skills.ts`, `content/types.ts`, `sim/state.ts`,
`systems/combat.ts`, `systems/progression.ts`, a new `systems/loadout.ts`,
`ui/ui.ts`, a new `ui/skillPicker.ts`, `main.ts`, `save/schema.ts`,
`save/restore.ts`, tests and QA.

### 3.4 Grounding as a shared render contract

**Decision:** introduce one render-side ground helper rather than patching each
marker:

```ts
// Render-only; the sim remains 2D.
const groundY = terrain.surface.heightAt(x, z);
```

Apply it to:
- move destination ring and hover ring;
- player/enemy roots, far silhouettes, elite rings;
- loot crystals/beams;
- nameplates, health bars, floating combat text;
- projectile render height;
- camera target and camera height;
- pointer ground picks (raycast the terrain mesh or sample heightAt);
- any future props with contact decals.

Acceptance:
- A probe at three terrain heights (flat, ~+0.1, and the outer rise) shows every
  ring, foot and shadow touching the surface in screenshots.
- No double offsets: the sim's x/z is the source of truth; only the render layer
  adds Y.
- Ground picking on a slope lands under the cursor, not on a flat plane behind
  the hill.
- QA exposes a `groundProbe`/debug value for the destination marker's world Y.

---

## 4. v1.1 — Grounding, camera and HUD hotfix

**Goal:** remove the visible inconsistencies without adding content or changing
the save schema.

Scope (one vertical slice):
1. Add the shared ground helper; fix G1–G6.
2. Fix the destination marker fade race (U1).
3. Remove camera rotation (U2) and update input, hints and tests.
4. Remove the bottom guide (U3); add a pause Controls section and first-run toast.
5. Move/fade the autosave badge (C2) if it fits without layout churn.
6. Add a regression QA for elevated-ground markers and the new HUD.

Out of scope: skill unlocks/loadout (v1.2), new zones, new skills, balance
passes, mobile/touch, full settings.

Acceptance gates:
- `npm run typecheck`, `npm test`, `npm run build`, `npm run qa` all green.
- New QA: terrain probe, no-right-drag-rotation, bottom guide absent, pause
  controls visible.
- No draw-call/triangle regression against the release budget.
- Screenshots: elevated-ground cursor/ring, fixed camera, HUD without the guide.

Risks: terrain grounding touches overlays that were tuned against y=0; add one
helper and convert call sites in small batches, checking the arena and camps at
both zoom limits. Removing rotation changes the camera framing at the fixed
yaw; verify the boss arena and the spawn view before merging.

Effort: **S–M** (one focused slice).

---

## 5. v1.2 — Skill progression and loadout

**Goal:** make skill choice a progression system and the hotbar an editable
loadout, without changing the core combat math.

Scope:
1. Add `role` and `unlockLevel` to every skill; remove fixed hotbar slots from
   content.
2. Add `PlayerState.loadout` and the loadout transaction helpers.
3. Start with one active skill; auto-equip unlocks into empty slots; toast
   unlocked skills.
4. Build the skill picker; change hotbar slot clicks to open it; keyboard QWER
   casts.
5. Keep the basic attack on left-click and remove it from the hotbar.
6. Save schema v4 with a tested v3→v4 migration and loadout validation.
7. Update the HUD tooltips, empty-slot visuals, cooldown mapping, snapshot/debug
   fixtures and all skill QA.
8. Balance pass on starting mana/cooldowns so one active + basic attack feels
   viable at level 1.

Out of scope: new skills, support gems, skill trees per skill, respec costs,
weapon swaps.

Acceptance gates:
- Fresh character: one active skill, three empty slots, left-click basic works.
- Level unlocks and auto-equip are deterministic; the picker refuses locked
  skills and duplicates.
- Clicking slots never casts; QWER casts the equipped set.
- Save/reload and v3 migration preserve a legal loadout.
- Browser QA: start → level → picker → equip → cast → boss → save → reload.

Risks: save/QA churn; early-game power drop if the starting active is expensive.
Mitigate with a lower starting-skill mana cost or a level-1 refund/tuning pass.

Effort: **M** (one larger slice).

---

## 6. Expansion roadmap (after v1.2)

Sizes are relative slices, not calendar estimates.

### v1.3 — Combat depth (M)
- Add a **fourth active skill** per class and fill the R slot.
- Add one **skill modifier** layer (e.g. runes/supports that change count,
  area, cooldown or damage type) with a small, readable pool.
- Give elites and the Warden one new mechanic each (e.g. a curse, a ground
  hazard, a summoner add).
- Improve camera occlusion (C1) and far-elite readability (C3).
- Acceptance: every class has four meaningful actives; modifiers are data-only
  and testable; boss phases remain dodgeable.

### v1.4 — Itemization & economy (L)
- Expand bases/affixes and add a few build-defining uniques.
- Add a simple currency/crafting loop (re-roll one affix, add one affix, quality)
  with loss-tested inventory transactions.
- Add a vendor/stash or a post-run reward screen.
- Acceptance: no item duplication/loss; save migration; UI for every transaction.

### v1.5 — World expansion (L)
- Second zone with a new camp/arena layout, new enemy archetypes and a new boss.
- Waypoints/zone transitions and a quest/objective spine.
- Real terrain elevation (now safe because grounding is a render contract).
- Acceptance: two-zone run start→finish; save/Continue across zones; performance
  budget holds with the second zone's population.

### v1.6 — Endgame/replayability (L)
- Procedural "Ashen Rift" runs with modifiers, escalating rewards and a local
  best-run record.
- A simple death/retry economy and build experimentation loop.
- Acceptance: deterministic seeds, reward accounting, no unbounded power creep.

### v1.7 — Platform & accessibility (M)
- Settings: keybinds, camera distance/yaw lock, damage-number size, colorblind
  palettes, reduced motion, mute.
- Controller/gamepad and optional touch layout.
- Localization-ready strings, telemetry/error reporting, deployment pipeline and
  rollback artifacts.
- Acceptance: verified on the release browser matrix; settings persist; no
  gameplay divergence.

---

## 7. Cross-cutting quality bars

- **Simulation:** 2D, deterministic, no three.js imports; render-only grounding.
- **Save:** versioned migrations for every schema change; corrupt/backup recovery
  stays tested.
- **Performance:** release budget ≤320 draw calls / ≤260K triangles in a camp
  fight; new UI is DOM-only; new VFX obey the transient cap.
- **Accessibility:** reduced-motion path stays green; new animations get a
  reduced-motion equivalent; controls remain discoverable without the HUD strip.
- **Evidence:** every slice ships with typecheck, unit tests, build, full QA,
  screenshots and updated release notes.

---

## 8. Open decisions

1. **Starting skills and unlock levels:** is the proposed table (Sunder/Split
   Shot/Ember Nova at level 1; third active by level 4–5) the right pace?
2. **Auto-equip policy:** auto-equip a newly unlocked skill into the first empty
   slot, or leave it in the library for the player to assign?
3. **Zoom:** keep scroll zoom with a fixed camera yaw, or lock zoom too for a
   strict PoE-style view?
4. **Right click:** leave it inert (context menu suppressed) or bind a second
   action later?
5. **Slots:** keep four (Q/W/E/R) with a 4th skill in v1.3, or ship three active
   slots in v1.2?
6. **HUD clutter:** should the autosave badge disappear after saving, or move
   entirely into the pause menu?
7. **Fixed yaw:** use a true 45° isometric angle, or preserve the current 0.22π
   framing?
8. **Terrain elevation:** is a second zone with real elevation in scope for
   v1.5, or should the world stay mostly flat?

---

## 9. Suggested next action

Start with **v1.1 only** (grounding, camera, HUD, destination fade). It is a
small, low-risk slice that fixes everything reported here except the skill
system, and it creates the render contract that the expansion needs. Then ship
**v1.2** (skill progression/loadout) before adding new content.
