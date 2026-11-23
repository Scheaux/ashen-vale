# Ashen Vale

A dark-fantasy isometric action RPG prototype in TypeScript + three.js.
Built in vertical slices; this repo currently covers **Slices 0–6**: scaffold,
movement, combat, enemy AI with telegraphs, rewards/loot, the full combat kit
(QWER skill hotbars, mana, flasks and the death → checkpoint retry flow) and a
passive skill tree — plus jointed procedural character rigs with full
animation sets.
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
| Hover near an enemy, then left click | Highlight, pursue and attack |
| Q / W / E / R | Cast hotbar skills (Q = basic attack) |
| 1 / 2 | Drink the health / mana flask |
| P | Open or close the passive skill tree |
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
  enemy-only hover highlight, click destination marker, drifting embers
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
- **Skills & flasks:** a four-skill QWER kit per class (free basic attack +
  three active skills across melee arcs, projectile fans, novas, telegraphed
  ground strikes and a dash), mana costs with regen and refuse feedback,
  per-skill cooldown sweeps, health/mana flasks (1/2) with refill-on-kill
  charges, and distinct VFX per skill — slash arcs, nova rings, shard bursts,
  draped strike telegraphs
- **Passive skill tree:** a 33-node tree (offence / defence / utility
  clusters, five keystones) with one point per level, adjacency-gated
  allocation and no-orphan refunds; passive bonuses feed the shared stat
  derivation (attribute nodes compound through synergies) and the tree
  screen on P shows tooltips, lit connectors and the points budget
- Player health bar, death screen with a death recap (killing blow, damage
  taken, kills, time survived) and respawn at the checkpoint, which preserves
  progression and encounter damage while refilling mana and flasks and
  cancelling unfinished attacks and projectiles
- Validated character checkpoint schema v2 with a tested v1→v2 migration
  (`src/save/schema.ts`); not a mid-combat replay snapshot or a Continue flow

## Architecture

```
src/
  core/      game loop (fixed sim tick + interpolated render), seeded RNG, events, math, noise
  content/   data-only definitions: classes, skills, enemies/attacks, items/affixes, zone layout
  sim/       pure deterministic game state + authoritative combat events (no three.js imports)
  systems/   movement, centralized combat pipeline (skills, cooldowns, mana, area strikes),
             enemy AI machine, flasks, passive tree rules, inventory transactions,
             stats derivation (attributes, armour/evasion/energy shield, attack vs
             spell damage), progression (XP), loot
  render/    three.js scene, terrain, props, character rigs, enemies, projectiles, telegraphs,
             skill VFX, loot drops, camera, cursor; anim.ts holds the animation curves,
             materials.ts procedural normal/roughness maps, geo.ts bevel/lathe/sweep/rock toolkit
  ui/        DOM-overlay screens (title, class select, HUD with hotbar/flasks, passive
             tree, pause, death recap, inventory), floating combat text, nameplates
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
