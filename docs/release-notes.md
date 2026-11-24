# Ashen Vale — Release Notes

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
