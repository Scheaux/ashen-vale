# Ashen Vale

A dark-fantasy isometric action RPG in TypeScript + three.js, released as
**v1.2.0**. Built in vertical slices; the completed MVP covers scaffold,
movement, combat, enemy AI with telegraphs, rewards/loot, the full combat kit
(mana, flasks and the death → checkpoint retry flow), a passive skill tree, the
zone objective loop — clear the camps, then end the Ashen Warden in its arena —
local save slots with Continue, jointed procedural character rigs, and the
post-release polish pass (fixed 45° camera, terrain grounding, HUD declutter,
combat readability, VFX, performance LOD and adaptive resolution).

v1.2 adds a **skill-point progression and six-slot loadout system** (RMB +
Q/W/E/R/F), a skill library with unlock/upgrade ranks, and click-to-swap hotbar
slots. See [MVP.md](./MVP.md) for the roadmap,
[the post-release plan](./docs/post-release-plan.md) for the next phases, and
[release notes](./docs/release-notes.md) for verification evidence, known
limitations and rollback steps.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (deterministic sim core)
npm run typecheck  # tsc --noEmit
npm run build      # production build in dist/
npm run qa         # fresh production build + every browser suite (screenshots in qa/shots/)
npm run qa:release # production build + the full-loop release suite only
```

## Controls

| Input | Action |
| --- | --- |
| Left click (ground) | Move to point |
| Hover near an enemy, then left click | Highlight, pursue and attack |
| Right click | Cast the RMB loadout skill |
| Q / W / E / R / F | Cast the five keyboard loadout skills |
| Click a hotbar slot | Open the skill picker for that slot (never casts) |
| 1 / 2 | Drink the health / mana flask |
| P | Open or close the passive skill tree |
| K | Open or close the skill library/loadout picker |
| Scroll | Zoom (close range, 12–21 units) |
| I | Open or close inventory |
| Esc | Pause / resume (and back out of menus) |
| Title: Continue / Load Game | Resume the newest checkpoint or pick a slot |
| Pause: Skills / Save / Load | Edit the loadout, write or restore a checkpoint |

## Current state

- Title screen -> class select (Marauder / Ranger / Witch) -> playable moor
- Fixed-timestep deterministic simulation (60 Hz) with render interpolation
- Click-to-move steering, arrival slowdown, slide-along-obstacle collision
- **Fixed 45° isometric camera** with damped follow and close scroll zoom
  (12–21 units); no yaw rotation
- Dark-fantasy procedural scene: moonlit fog, ridged terrain, instanced props,
  enemy-only hover highlight, click destination marker, drifting embers
- **Terrain grounding:** hero, enemies, props, cursor/hover/destination rings,
  elite auras, loot, nameplates, projectiles, floating text, the camera target
  and pointer picks all sample the heightfield; the destination marker also
  cancels its old fade when a new point is clicked
- Pause / restart run / quit to title; the pause menu holds the controls list
  (the old persistent bottom hint strip is gone)
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
  Item lines read as plain stat modifiers — `+45 to Armour`,
  `+3 to Attack Damage`, `50% increased Armour` — in flat and increased
  forms, with no flavour naming. Transactions are loss-tested
  (identity conservation)
- **Combat stats:** three primary attributes (strength / dexterity /
  intelligence) each drive offence and defence — STR → life, armour and
  attack damage; DEX → evasion, move speed and attack damage; INT → mana,
  energy shield and spell damage. Defence is layered: armour mitigates attack
  hits (diminishing returns, never a full negate), evasion turns attack hits
  into misses (capped at 75%), and energy shield absorbs before life and
  recharges after 2s out of combat. Offence splits into Attack Damage and
  Spell Damage, matched against each skill's `damageClass` — spells bypass
  armour and evasion entirely. The character sheet in the inventory shows the
  full breakdown
- **Skills & flasks:** a PoE-style **RMB + Q/W/E/R/F** loadout with six slots.
  Left click is the free basic attack (Cleave / Piercing Shot / Ember Bolt);
  it is not a hotbar skill. A fresh exile starts with one signature active in Q;
  each level grants **1 skill point**, and the class library has actives at levels
  1, 2 and 4. Unlocking costs 1 point and upgrading ranks 2–5 costs 1 point each
  (+15% damage and −4% cooldown per rank). Skills are **never auto-equipped**:
  click a hotbar slot or press K to open the picker, unlock/upgrade from the
  library, and assign a skill to the selected slot. Empty slots are visibly
  assignable. Mana costs, regen, refuse feedback, cooldown sweeps, health/mana
  flasks (1/2) with refill-on-kill charges, and per-skill VFX (slash arcs, nova
  rings, shard bursts, draped strike telegraphs) remain
- **Passive skill tree:** a 33-node tree (offence / defence / utility
  clusters, five keystones) with one point per level, adjacency-gated
  allocation and no-orphan refunds; passive bonuses feed the shared stat
  derivation (attribute nodes compound through synergies) and the tree
  screen on P shows tooltips, lit connectors and the points budget
- **Zone objectives & boss:** three camps tracked on the HUD ("Clear the
  camps (n/3)") gate the Ashen Warden — a three-phase boss (sweeps → ground
  slams at where you stand → enraged charges) with phase multipliers, minion
  adds and its own telegraph shapes, locked in a pillar-ringed arena while
  the fight is live; the victory screen closes the loop back to play or title
- Player health bar, death screen with a death recap (killing blow, damage
  taken, kills, time survived) and respawn at the checkpoint, which preserves
  progression and encounter damage while refilling mana and flasks and
  cancelling unfinished attacks and projectiles
- **Save slots:** three localStorage checkpoints with a shared slot screen on
  the title and pause menus. A new run binds to the first empty slot and
  autosaves at zone milestones (camp cleared, Warden wakes or dies), on
  level-ups, death, quit, and whenever a passive or equipment choice changes;
  **Continue** on the title restores the newest readable checkpoint. Loading
  rebuilds the zone from the checkpoint — level, XP, passives, inventory,
  flasks, **skill ranks and six-slot loadout**, position and camp/boss flags —
  with cleared camps left empty and a live boss fight restarting at its arena
  spawn. Every write keeps the previous body as a backup; torn writes recover,
  and corrupt slots are reported and deletable. Schema **v4** with tested
  v1→v4, v2→v4 and v3→v4 migrations; legacy saves pre-spend the active kit
  available at their level (`src/save/schema.ts`, `slots.ts`, `restore.ts`)
- **Combat readability:** layered ground telegraphs (dark stain, rising fill,
  bright rim), one instanced health-bar draw call pair for all enemies, heavy-hit
  damage numbers, shield markers, a red/blue damage vignette, decaying camera
  punch on hits and boss phases, and impact/death VFX with capped transients
- **Performance:** distance-based enemy LOD (full jointed rigs up close, one-draw
  silhouettes beyond 16 units, at most eight full rigs), instanced contact
  shadows, frustum-culled detail selection, and adaptive resolution between 1x
  and the device cap. Release QA gates camp fights at **≤320 draw calls /
  ≤260K triangles** (measured 121–280 calls and 165–193K triangles in headless
  Chromium)
- **Release:** v1.2.0 with a full-loop browser suite (fresh start → feedback →
  camps → boss phases → victory → save → reload → Continue), high-DPI adaptive
  quality and reduced-motion checks, plus post-release QA for grounding, the
  fixed camera, HUD declutter and the skill-point/loadout flow; see
  [release notes](./docs/release-notes.md) for evidence and rollback

## Architecture

```
src/
  core/      game loop (fixed sim tick + interpolated render), seeded RNG, events, math, noise
  content/   data-only definitions: classes, skills, enemies/attacks, items/affixes, zone layout
  sim/       pure deterministic game state + authoritative combat events (no three.js imports)
  systems/   movement, centralized combat pipeline (skills, cooldowns, mana, area strikes),
             enemy AI machine, flasks, passive tree rules, skill-point/loadout rules,
             inventory transactions, stats derivation (attributes, armour/evasion/energy
             shield, attack vs spell damage), progression (XP), loot
  render/    three.js scene, terrain, props, character rigs, enemies, projectiles, telegraphs,
             skill VFX, loot drops, camera, cursor; anim.ts holds the animation curves,
             materials.ts procedural normal/roughness maps, geo.ts bevel/lathe/sweep/rock toolkit
  ui/        DOM-overlay screens (title, class select, HUD with six-slot loadout/flasks,
             passive tree, skill library/loadout picker, pause with controls, death
             recap, inventory), floating combat text, nameplates
  save/      versioned schema (v4) + migrations, localStorage slots with backups,
             checkpoint restore (rebuilds zone progress, ranks and loadout)
```

Procedural detail follows the three-scale model: silhouettes get curve
segments (adaptive swept trees, lathed pillars), edges get bevels (weapons,
armor), and microdetail comes from generated normal/roughness maps rather than
extra geometry. Release QA gates the render budget at **≤320 draw calls** and
**≤260K triangles** in a live camp fight; the same snapshot reports detailed
rigs, health bars, pixel ratio, shadow state and quality-window samples.

Enemy rendering uses a detail budget: the closest eight on-screen rigs get full
jointed animation, while distant enemies use a merged, vertex-colored
silhouette with glowing eyes. Contact shadows are one instanced blob pass, and
all health bars are two instanced passes. The pixel ratio steps between 1x and
the device cap (up to 2x) based on a 1.5s frame-time window.

The same seed and tick-by-tick inputs produce the same gameplay outcomes.
Rendering consumes authoritative state and events. Checkpoints store character
progression, passives, inventory, flask charges, position and zone objective
flags — not live encounters or RNG state. Loading rebuilds the zone from those
flags and the deterministic layout.

## Release

- **Version:** 1.2.0
- **Build:** static `dist/` bundle; `npm run build`, then serve `dist/`
- **Rollback target:** tag `v1.0.0` (`b3091c1`). Save schema v4 is not readable
  by v1.0.0; export/remove v4 slots before rolling back.
- **Evidence:** see [docs/release-notes.md](./docs/release-notes.md)
