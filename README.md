# Ashen Vale

A dark-fantasy isometric action RPG prototype in TypeScript + three.js.
Built in vertical slices; this repo currently covers **Slices 0–4**: scaffold,
movement, combat, enemy AI with telegraphs, and rewards/loot — plus jointed
procedural character rigs with full animation sets.
See [MVP.md](./MVP.md) for the full slice-by-slice roadmap to the MVP.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (deterministic sim core)
npm run typecheck  # tsc --noEmit
npm run build      # production build in dist/
npm run qa         # fresh production build + browser playthrough (screenshots in qa/shots/)
```

## Controls

| Input | Action |
| --- | --- |
| Left click (ground) | Move to point |
| Left click (enemy) | Pursue and attack |
| Right drag | Rotate camera |
| Scroll | Zoom |
| I | Open or close inventory |
| Esc | Pause / resume (and back out of menus) |

## Current state

- Title screen -> class select (Marauder / Ranger / Witch) -> playable moor
- Fixed-timestep deterministic simulation (60 Hz) with render interpolation
- Click-to-move steering, arrival slowdown, slide-along-obstacle collision
- Isometric camera follow with damped smoothing, zoom and yaw rotation
- Dark-fantasy procedural scene: moonlit fog, ridged terrain, instanced props,
  hover highlight on props, click destination marker, drifting embers
- Pause / restart run / quit to title
- **Combat:** click an enemy to pursue and attack — melee cleave (Marauder),
  arrow and ember bolt projectiles (Ranger/Witch); one centralized
  damage pipeline; basic attacks resolve on the shared animation contact or
  release frame. Authoritative sim events drive damage numbers and hit flashes
- **Enemies:** three archetypes with an explicit AI state machine — telegraphed
  windups with locked facing (dodge counterplay), strike windows, recovery and
  cooldown gating. Husk melee sweeps, kiting cultist casters with dodgeable
  bolts, leaping skitterers; elite packs (Vital/Savage/Swift) with aura rings
  and nameplates
- **Character rigs:** jointed procedural models (hero, husk, cultist,
  skitterer) with real joint pivots and code-driven animation — locomotion,
  anticipation → contact → follow-through strikes, hit flinches, death
  collapses. Heroes have class-specific gaits, planted support feet, reactive
  capes, and distinct axe, bow, and staff actions. See the
  [animation standard and capture workflow](./docs/character-animation.md).
- **Progression & loot:** XP/levels with toasts and a HUD XP bar; rarity tiers
  with data-driven affix rolls; world drops with beams; auto-pickup;
  inventory/equipment screens with tooltips; derived stats feed combat.
  Transactions are loss-tested (identity conservation)
- Player health bar, death screen and respawn, which preserves progression and
  encounter damage while cancelling unfinished attacks and projectiles
- Validated character checkpoint schema v2 with a tested v1→v2 migration
  (`src/save/schema.ts`); not a mid-combat replay snapshot or a Continue flow

## Architecture

```
src/
  core/      game loop (fixed sim tick + interpolated render), seeded RNG, events, math, noise
  content/   data-only definitions: classes, skills, enemies/attacks, items/affixes, zone layout
  sim/       pure deterministic game state + authoritative combat events (no three.js imports)
  systems/   movement, centralized combat pipeline, enemy AI machine, inventory transactions,
             stats derivation, progression (XP), loot
  render/    three.js scene, terrain, props, character rigs, enemies, projectiles, telegraphs,
             loot drops, camera, cursor, VFX; anim.ts holds the animation curves,
             materials.ts procedural normal/roughness maps, geo.ts bevel/lathe/sweep/rock toolkit
  ui/        DOM-overlay screens (title, class select, HUD, pause, death, inventory),
             floating combat text, nameplates
  save/      versioned save schema + migration (localStorage slots in slice 8)
```

Procedural detail follows the three-scale model: silhouettes get curve
segments (adaptive swept trees, lathed pillars), edges get bevels (weapons,
armor), and microdetail comes from generated normal/roughness maps rather than
extra geometry. Render budget is reported in the QA snapshot
(~135K triangles / ~150 draw calls).

The same seed and tick-by-tick inputs produce the same gameplay outcomes.
Rendering consumes authoritative state and events. The checkpoint export stores
character progression, inventory, and zone seed, not live encounters or RNG state.
