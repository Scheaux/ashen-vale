# Ashen Vale — Release Notes

## v1.4.1 — 2026-11-27

The salvage hardening release: the Ember Dust item sink is now gesture-safe,
keyboard-focused, and covered end to end.

### What ships

- **Gesture safety:** the confirmation prompt takes the old Salvage button's
  position, so a double-click at that point cannot confirm. The arm handler
  ignores the tail of a multi-click; Confirm deliberately has no click-count
  guard, so a fast legitimate confirm still sells exactly once.
- **Focus and scrolling:** pointer focus uses `preventScroll`, so a short or
  scrolled bench cannot shift Confirm under the old pointer. Keyboard focus
  still scrolls the control into view. Focus moves to Confirm after arming,
  to Salvage after Cancel, and to the next Salvage or Close after confirming.
- **Transaction defense:** `salvageItem` checks equipment before bags. Any
  equipped uid is refused with `Unequip the item before salvaging`, even in a
  duplicate-uid state; an unknown uid still returns `Item is no longer owned`.
- **Browser coverage:** `qa/verify-v141.mjs` now has 50 checks, including a
  real double-click, a 900×600 scrolled-panel regression, fast Confirm,
  pending invalidation on selection/close/inventory, fallback selection, and
  save/reload after salvage. The volatile-blast fixture also stands on the
  live hazard center, removing a pre-existing QA flake.
- **Version:** 1.4.1. README controls and the itemization section mention
  salvage.

### Verification evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | **234 tests** across 27 files |
| `npm run build` | production build in `dist/` |
| `npm run qa` | **328 browser checks** across the full chain; `verify-v141` **50/50** |
| Render budget | unchanged; the change is DOM/UI and transaction logic only |

### Rollback

Rollback target: tag **v1.4.0**. Save schema v6 is unchanged, so v1.4.0 can read
v1.4.1 saves. `v1.3.0` cannot read v6.

```bash
git checkout v1.4.0
npm ci
npm run build
```

## v1.4.0 — 2026-11-26

The itemization and economy slice: base implicits, item quality, more bases and
affixes, build-defining uniques, and a crafting bench.

### What ships

- **Item bases with implicits:** 20 bases across six slots now carry innate
  stats (weapon damage, armour, evasion, energy shield, life/mana, movement or
  attributes) rolled with item level. Implicits show separately in tooltips.
- **29 affixes** (including greater attribute/mana/movement variants) and five
  uniques: Ashen Visage, Embergrasp, **Cinderbrand**, **Warden's Bulwark** and
  **Windstep**.
- **Item quality:** 0–20% in 5% steps. Quality scales both the base implicit and
  every affix value, so it is useful on every slot.
- **Crafting bench (C):** select any bag or equipped item and spend materials:
  - **Reforge affix** — 1 Ember Dust, rerolls one affix value.
  - **Add affix** — 1 Ashen Rune; normal items become magic, up to the rarity cap.
  - **Quality +5%** — 1 Quality Ember, capped at 20%.
- **Currency economy:** every kill grants Ember Dust; elites grant an Ashen
  Rune; the Warden grants two Runes and a Quality Ember. The victory screen
  shows the current crafting stock.
- **Save schema v6:** persists item quality/implicits and currency; v1–v5 saves
  migrate (old items gain 0% quality and no implicit).
- All crafting actions are validated transactions with identity conservation.

### Verification evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | **229 tests** across 26 files |
| `npm run build` | production build in `dist/` |
| `npm run qa` | **279 browser checks** across all suites, no console errors |
| `qa/verify-v14.mjs` | **16/16** item implicit, craft, quality, currency and save v6 checks |
| `qa/verify-release.mjs` | **33/33** full-loop, budget, high-DPI and reduced-motion checks |
| Render budget | camp fights stay under 320 calls / 260K triangles |

### Rollback

Rollback target: **tag `v1.3.0`**.

```bash
git checkout v1.3.0
npm ci
npm run build
```

**Save compatibility caveat:** v1.4 writes schema v6. v1.3.0 only understands
schema v5 and will reject v6 slot data. Export or remove v6 slots before a
rollback, or keep a v1.3-era save backup.

---

## v1.3.0 — 2026-11-25

The combat-depth slice: a fourth active for every class, a rune modifier layer,
volatile elites, Warden cinder pools and camera occlusion.

### What ships

- **Fourth actives (unlock level 6):**
  - **Marauder — Leap Slam:** travels to the target and fires one landing
    shockwave instead of path damage.
  - **Ranger — Blast Shot:** a heavy arrow that explodes on impact, hitting
    every enemy inside its radius.
  - **Witch — Frost Nova:** a frost ring that chills enemies for 2.4s, slowing
    their chase speed by 35% and tinting them cold.
- **Rune layer:** one rune per active skill, free to swap once its level gate is
  met. **Cruel** (+25% damage, +15% mana), **Wide** (+30% area/arc, −10% damage)
  and **Swift** (−20% cooldown, −10% damage). Runes are chosen in the skill
  picker; the hotbar shows a rune glyph and the tooltip shows effective numbers.
- **Elite Volatile:** a new elite modifier that leaves a telegraphed death blast
  after the elite falls. The warning uses the same ground-hazard language as the
  boss.
- **Warden cinder pools:** the phase-2 slam now leaves a burning crater for 2.6s
  that ticks spell damage, so dodging the slam is not the end of the pattern.
- **Camera occlusion:** tall props between the camera and the hero fade out
  smoothly, and far elite silhouettes keep a modifier-colored aura ring.
- **Save schema v5:** persists ranks, loadout and runes; v1–v4 saves migrate
  (v4 keeps its ranks/loadout and gains empty runes).

### Verification evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | **221 tests** across 25 files |
| `npm run build` | production build in `dist/` |
| `npm run qa` | **263 browser checks** across targeting, slices, post-release, v1.3, stats, passives and release; no console errors |
| `qa/verify-v13.mjs` | **14/14** fourth-skill, rune, hazard and occlusion checks |
| `qa/verify-release.mjs` | **33/33** full-loop, budget, high-DPI and reduced-motion checks |
| Render budget | camp fights stay under 320 calls / 260K triangles |
| Save migration | v1→v5, v2→v5, v3→v5 and v4→v5 covered |

### Rollback

Rollback target: **tag `v1.2.0`**.

```bash
git checkout v1.2.0
npm ci
npm run build
```

**Save compatibility caveat:** v1.3 writes schema v5. v1.2.0 only understands
schema v4 and will reject v5 slot data. Export or remove v5 slots before a
rollback, or keep a v1.2-era save backup.

---

## v1.2.0 — 2026-11-25

The first post-release patch fixes the launch feedback and adds skill-point
progression and a six-slot loadout.

### What ships

- **Fixed 45° isometric camera.** Right-drag rotation is removed; scroll zoom is
  narrowed to 12–21 units (close range only). The pause menu lists controls.
- **Terrain grounding.** The hero, enemies, props, cursor/hover/destination
  rings, elite auras, loot, nameplates, projectiles, floating text, camera target
  and pointer ground-picks all sample the heightfield. The destination marker's
  old fade is cancelled on a new click.
- **HUD declutter.** The persistent bottom key guide is gone; controls live in
  the pause menu. The autosave badge moves into the pause line.
- **Skill points and six slots.** Left click remains the free basic attack. The
  hotbar is `RMB + Q/W/E/R/F`; a fresh character has one signature active in Q.
  Each level grants 1 skill point. Actives unlock at levels 1, 2 and 4; unlocking
  and ranks 2–5 cost 1 point each. Rank scaling is +15% damage and −4% cooldown
  per rank. Skills stay in the library with no auto-equip; click a slot or press
  K, unlock/upgrade, and assign to the selected slot.
- **Save schema v4.** Ranks and loadout persist; v1–v3 saves migrate with the
  legacy active kit pre-spent and loaded into Q/W/E.
- **QA:** a new post-release suite covers raised-ground markers, fixed camera,
  zoom clamps, guide removal, picker unlock/equip/upgrade, RMB/QWERF casts, and
  save/reload of the loadout.

### Verification evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 209 tests across 24 files |
| `npm run build` | production build in `dist/` |
| `npm run qa` | **249 browser checks** across targeting, slices, post-release, stats, passives and release; no console errors |
| `qa/verify-postrelease.mjs` | **26/26** grounding, camera, HUD and loadout checks |
| `qa/verify-release.mjs` | **33/33** full-loop, budget, high-DPI and reduced-motion checks |
| Render budget | camp fights stay under the 320-call / 260K-triangle release gate (121–280 calls observed) |
| Save migration | v1→v4, v2→v4 and v3→v4 covered |

### Rollback

Rollback target: **tag `v1.0.0` (`b3091c1`)**.

```bash
git checkout v1.0.0
npm ci
npm run build
```

**Save compatibility caveat:** v1.2 writes schema v4. v1.0.0 only understands
schema v3 and will reject v4 slot data. Export or remove v4 slots before a
rollback, or keep a v1.0-era save backup.

---

## v1.0.0 — 2026-11-24

The MVP is complete: one coherent dark-fantasy ARPG loop from title screen to the
Ashen Warden and back through a saved checkpoint.

### What ships

- **Full loop:** title → class select (Marauder / Ranger / Witch) → click-to-move
  combat → loot and equipment → levels and a 33-node passive tree → three seeded
  camps → the three-phase Ashen Warden → victory or defeat → save and Continue.
- **Combat readability:** layered ground telegraphs (dark stain, rising fill,
  bright rim), instanced enemy health bars, heavy-hit damage numbers, shield
  markers, a red/blue damage vignette, decaying camera punch on hits and boss
  phases, and contact/death VFX with capped transients.
- **VFX and atmosphere:** projectile wakes on spell bolts, impact rings, ember
  death bursts, drifting embers, a cinematic edge vignette, and reduced-motion
  fallbacks for floating text, toasts and camera shake.
- **Performance:** distance-based enemy LOD (full jointed rigs up close, one-draw
  silhouettes beyond 16 units, at most 8 full rigs), one instanced draw call for
  contact shadows, two instanced draw calls for every health bar, frustum-culled
  detail selection, and adaptive resolution between 1x and the device cap.
- **Saves:** three localStorage checkpoints with autosaves at camps, Warden
  awaken/defeat, level-ups, death, quit and build changes; Continue; backup
  recovery from torn writes; corrupt-slot reporting and deletion. Schema v3 with
  v1→v3 and v2→v3 migrations.
- **Release QA:** the full journey is replayed in headless Chromium, including
  fresh start, combat feedback, boss phases, victory, save → reload → Continue,
  a high-DPI adaptive-resolution pass and reduced-motion boot.

### Verification evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 196 tests across 23 files |
| `npm run build` | production build in `dist/` |
| `npm run qa` | every slice suite plus release suite, no console errors |
| `qa/verify-release.mjs` | 30/30 checks |
| Camp-fight budget | 121–280 draw calls · 165K–193K triangles (budget 320 / 260K) |
| Adaptive resolution | 2x cap on a high-DPI context stepped down under a slow frame budget |
| Reduced motion | preference detected; combat still runs without page errors |

Headless Chromium uses software rendering, so its frame times are recorded as
diagnostics and are not a GPU benchmark. Draw calls and triangles are the
portable budget gate.

### Known limitations

- Procedural placeholder art and one moor zone with one boss.
- Desktop keyboard/mouse is the supported baseline; no touch layout or settings
  menu in this release.
- Saves are milestone character checkpoints, not mid-combat replay snapshots.
  Reloading a live boss fight restarts the Warden at its arena spawn.
- The renderer budget is measured at 1440×900 with a 2x pixel-ratio cap; lower-end
  devices rely on adaptive resolution.

### Deploy

The build is a static `dist/` bundle:

```bash
npm ci
npm run build
# serve dist/ with any static host
```

`npm run preview` serves the production bundle locally on port 4173.

### Rollback

The previous release checkpoint is commit `af7b052` (Slice 8: save slots).
Rollback options:

```bash
# Rebuild the previous release from its exact checkpoint
git checkout af7b052
npm ci
npm run build

# Or revert the v1.0.0 release commit on main
git revert <v1.0.0-commit>
```

The save format did not change in Slice 9 (schema v3), so checkpoints written by
v1.0.0 load in the Slice 8 build.

### Release checklist

```bash
npm run typecheck
npm test
npm run build
npm run qa
```

Then verify in the browser: fresh title → New Game → move and fight → take a hit →
clear a camp → defeat the Warden → quit to title → reload → Continue.
