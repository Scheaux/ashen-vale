# Ashen Vale — Release Notes

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
