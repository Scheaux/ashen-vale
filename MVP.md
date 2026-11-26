# Ashen Vale — MVP Plan

A dark-fantasy isometric action RPG (Path of Exile-inspired) in TypeScript + Vite + three.js.
This document is the slice-by-slice roadmap to the MVP: one complete, coherent ARPG loop
(title → class → fight → loot → grow → boss → save), built in vertical slices where each
slice is playable, tested, and validated in a real browser before the next begins.

**Decisions:** PoE-style click-to-move isometric camera · procedural placeholder art
(dark-fantasy tone) · 3 classes · 1 zone + boss objective · single-player · desktop web ·
localStorage saves · Vitest unit tests + headless-browser QA playthroughs per slice.

---

## Slice status

| # | Slice | Status | Gate |
|---|-------|--------|------|
| 0 | Scaffold & shell | ✅ Done | Boots in browser, tests run |
| 1 | Movement & camera | ✅ Done | Walk around reliably |
| 2 | Combat verb | ✅ Done | Kill an enemy |
| 3 | Enemy AI & telegraphs | ✅ Done | Fair, readable fights |
| 4 | Rewards & loot | ✅ Done | Kill → loot → equip → stronger |
| 5 | Skills & flasks | ✅ Done | Full combat kit |
| 6 | Passive skill tree | ✅ Done | Meaningful build choice |
| 7 | Zone objective & boss | ✅ Done | Complete the loop |
| 8 | Save slots | ✅ Done | Survive reload; migration tested |
| 9 | Polish & release | ✅ Done | Ship-ready build |

---

## Slices

### Slice 0 — Scaffold & shell ✅
Vite + TypeScript + three.js project; fixed-timestep deterministic game loop (60 Hz sim
ticks + render interpolation); seeded RNG, event bus, noise; dark-fantasy scene (moonlit
fog, ridged terrain, instanced props, drifting embers); title menu → class select
(Marauder / Ranger / Witch) → in-game HUD; pause / restart / quit to title.

### Slice 1 — Movement & camera ✅
Click-to-move steering with arrival slowdown; circle-collider obstacle resolution
(slide, no tunneling); soft zone boundary; isometric camera with damped follow,
right-drag yaw rotation and clamped scroll zoom; ground hover ring, pulsing destination
marker, prop hover highlight.

### Slice 2 — Combat verb ✅
One attack per class (melee cleave arc, arrow and ember-bolt projectiles) driven by
data-only `SkillDef`s; centralized damage pipeline (single cooldown/damage/death path);
authoritative sim events consumed by rendering — floating damage numbers, hit flashes,
health bars, weapon swing animations; minimal enemy brain (aggro → chase → strike) to
provide the kill target; enemy death with corpse fade; player health bar, death screen
and respawn; versioned save schema v1 stub with migration guard.

### Slice 3 — Enemy AI & telegraphs ✅
Explicit AI state machine (idle → chase → windup → active → recovery) with
locked facing during windups so every strike is dodgeable. Three archetypes —
Ashen Husk (melee sweep), Cinder Cultist (kites at range, dodgeable bolts),
Mire Skitterer (crouch-and-leap pounce) — each with its own telegraph visuals
(ground sweep sectors, directional bolt strips). Elite packs with Vital/Savage/
Swift modifiers, glowing aura rings and nameplates. Deterministic AI fixtures
cover acquisition, commitment, dodge counterplay, spacing, cooldown gating,
auras and reset. New rigs: cultist (hovering robe caster) and skitterer
(quadruped with trot gait).

### Slice 4 — Rewards & loot ✅
XP on kills with level-ups (stat growth, toasts, HUD XP bar); rarity tiers
(normal/magic/rare/unique) with affix rolls from data-driven pools; world drops
with rarity-colored crystals and light beams; walk-over auto-pickup;
inventory + equipment screens (6 slots) with tooltips and click-to-equip.
All transfers are validated transactions with identity conservation (tested:
pickup, atomic equip-swap, unequip, full-bag rejection, repeated dispatch).
Derived stats (HP/damage/speed/armor) recompute from equipment and feed combat.
Save schema bumped to v2 with a tested v1→v2 migration.

### Slice 5 — Skills & flasks ✅
Each class plays a four-skill QWER kit: the free basic attack on Q (Cleave,
Piercing Shot, Ember Bolt) plus three mana-priced active skills — Marauder:
Sunder (telegraphed ground strike), Whirlwind (nova), Reckless Charge (dash
that carves through a line); Ranger: Split Shot (arrow fan), Snipe (fast
heavy shot), Rain of Arrows (large delayed strike); Witch: Ember Nova, Cinder
Barrage (bolt fan), Meteor Strike. Data-only `SkillDef`s drive six delivery
kinds (melee arc, projectile, spread, nova, ground, dash) with distinct VFX
per skill (slash arcs, cast flares, expanding nova rings, shard bursts,
draped ground-strike telegraph runes). Mana pool regenerates from
intelligence; casts refuse with feedback when the pool or the cooldown says
no. Health and mana flasks on 1/2 refill one charge per kill and top up fully
on the death retry. Death shows a recap (killing blow, damage taken, kills,
time survived) and rising again keeps progression while restoring the kit.
The HUD reads at a glance: cooldown sweeps, mana costs, unaffordable dimming,
flask charge pips.

### Slice 6 — Passive skill tree ✅
A 33-node tree radiating from "The Exile's Path" into offence, defence and
utility clusters, with five keystones at the branch ends (Annihilation,
Archmage, Unbreakable, Shimmering Veil, Pathfinder). One point per level;
nodes unlock only when every prerequisite is allocated, and refunds are
blocked only when they would orphan an allocated node (the root is
permanent). Passive bonuses feed the shared stat derivation before attribute
synergies, so attribute nodes compound — the tree visibly moves attack/spell
damage, armour, evasion, energy shield, life and mana in the character sheet
and in combat numbers. The tree screen (P) renders the graph with lit
connectors, cluster-coloured nodes, hover tooltips and allocate/refund
clicks; unspent points nag from the HUD.

### Slice 7 — Zone objective & boss ✅
The moor now has a spine: three seeded camps (the HUD tracker reads "Clear
the camps (n/3)") guard the way to a pillar-ringed boss arena at the far end.
When the last camp falls, **the Ashen Warden** wakes — a 720-hp boss with
three hp-gated phases, each with its own telegraphed pattern and pace:
measured sweeps (arc), telegraphed ground slams at where you stand (disc),
and enraged charges (pounce lane), with speed/damage multipliers per phase
and minion adds called on each transition. The arena boundary holds hero and
boss alike while the fight is live and reopens on victory. The victory screen
(run summary: kills, damage, time, level) closes the loop back to play or
title; the defeat screen's retry/title flow stands. Zone population is now
camp-grouped (with elite retinues inside their camp), and a birth-tick
projectile grace keeps point-blank fans visible and honest.

### Slice 8 — Save slots ✅
Three localStorage save slots with a shared save/load screen on the title and
pause menus. A new run binds to the first empty slot; from then on it
checkpoints automatically when a camp falls, when the Warden wakes or dies,
on level-ups, on death, on quitting to title and whenever the build or
equipment changes. The title's **Continue**
loads the newest readable checkpoint and rebuilds the zone from it: level,
XP, passive allocations, inventory, flask charges, position and camp/boss
objective flags are restored, cleared camps leave no enemies behind, and a
live boss fight restarts from its arena spawn. Every write keeps the previous
slot body as a backup, so a torn write recovers instead of losing the run;
unreadable slots are listed as corrupted and can be deleted without crashing
the game. Schema v3 adds passives, objectives and flasks, with tested
v1 → v3 and v2 → v3 migrations.

### Slice 9 — Polish & release ✅
Combat readability now reads at a glance: telegraphs layer a dark ground stain,
a rising warning fill and a bright rim; enemy health bars are instanced and
always legible; big hits use a heavy damage treatment with shield markers; player
damage pulses a red or blue edge vignette and punches the camera; hits and deaths
emit capped impact/death VFX. Spell bolts carry additive wakes and the scene
gains a cinematic edge vignette.

The performance pass cut the representative camp fight from ~500 draw calls to
121–280 (165–193K triangles): distant enemies use one-draw silhouettes (full
jointed rigs are capped at the eight closest on-screen enemies), contact shadows
are one instanced blob pass, health bars are two instanced passes, and detail
selection is frustum-culled. Resolution adapts between 1x and the device cap on a
1.5s frame-time window. Release QA gates the budget at ≤320 draw calls and
≤260K triangles.

The v1.0.0 release adds a full-loop browser suite (fresh start → combat feedback
→ camps → Warden phases → victory → save → reload → Continue), a high-DPI
adaptive-quality pass and a reduced-motion boot. Verification evidence, known
limitations, deploy steps and rollback to `af7b052` are in
[docs/release-notes.md](./docs/release-notes.md).

---

## Content scope (deliberately thin — depth from data, not breadth)

- **Classes (3):** Marauder (melee, strength), Ranger (projectile, dexterity),
  Witch (projectile, intelligence) — one free left-click basic plus four
  skill-point actives per class, loaded into a six-slot RMB + Q/W/E/R/F bar,
  with one level-gated rune per active (post-release 1.3).
- **Enemies (3 + elites):** Ashen Husk (melee charger), ranged caster, fast swarm —
  elite modifiers from slice 3.
- **Loot:** 4 rarity tiers, 6 equipment slots, 20 bases with implicit stats,
  29 affixes in plain stat language — flat `+X to Stat` and `X% increased Stat`
  forms across life/mana, armour, evasion, energy shield, attack/spell damage,
  movement and attributes — five uniques, 0–20% item quality, and a crafting
  bench with three currency actions.
- **Zone (1):** fixed handcrafted layout with seeded prop/enemy population,
  three camps guarding a pillar-ringed boss arena at the far end.
- **Passive tree:** ~30 nodes with clusters.

## Combat stats model

Three primary attributes — **strength, dexterity, intelligence** — are the
class identity (Warrior/STR, Archer/DEX, Witch/INT) and feed both offence and
defence. Defence is three distinct layers: **armour** (PoE-style diminishing
mitigation of attack hits), **evasion** (chance to avoid an attack hit
entirely, capped at 75%) and **energy shield** (a pool that absorbs before
life and recharges after 2s without damage). Offence splits into **Attack
Damage** and **Spell Damage**, matched against each skill's `damageClass`;
spells bypass armour and evasion. Attribute synergies live in one place
(`SYNERGY` in `sim/state.ts`) shared by state creation and stat derivation.

Item and passive bonuses speak one plain language: flat `+X to Stat` and
percentage `X% increased Stat` — e.g. `+45 to Armour`, `+3 to Attack Damage`,
`50% increased Armour`. Flat attack/spell damage lands on the skill roll
before the increased multiplier; "increased" defences multiply every source
of the pool.

## Validation bar (every slice)

1. `npm run typecheck` — clean.
2. `npm test` — deterministic sim core covered (combat math, loot rolls, AI fixtures,
   save serialization/migration).
3. `npm run build` — production build passes.
4. `npm run qa` — headless-Chromium playthrough of the slice's gate with screenshots
   (`qa/shots/`) and zero console errors; earlier slices' suites must stay green.
5. `npm run qa:release` — the full loop plus the release gates: camp-fight render
   budget, high-DPI adaptive resolution and reduced-motion boot.

Simulation is deterministic for the same seed and tick-by-tick inputs. Rendering
consumes authoritative sim events. The current save format is a character
checkpoint, not a snapshot of the simulation or its RNG state.

## Post-release 1.2.0

The first post-release patch fixes the launch feedback and adds the skill
progression the MVP bar left out:

- **Terrain grounding:** hero, enemies, props, cursor/hover/destination rings,
  elite auras, loot, nameplates, projectiles, floating text, camera target and
  pointer picks now sample the heightfield. The destination marker's fade race
  is fixed.
- **Camera:** fixed 45° isometric yaw; scroll zoom narrowed to 12–21 units; no
  rotation.
- **HUD:** the persistent bottom key guide is gone; controls live in the pause
  menu; the autosave badge moves into the pause line.
- **Skills:** left-click basic attack stays; the hotbar is a six-slot RMB +
  Q/W/E/R/F loadout. A fresh character has one signature active. Each level
  grants 1 skill point; actives unlock at levels 1/2/4; unlocking and ranks 2–5
  cost 1 point each (+15% damage, −4% cooldown per rank). Skills stay in the
  library until the player clicks a slot and assigns them. Save schema **v4**
  persists ranks/loadout and migrates v1–v3 with the legacy active kit.
- **QA:** post-release suite covers grounding, fixed camera/zoom, HUD declutter,
  skill unlock/upgrade/equip, RMB/QWERF casts and save/reload.

## Post-release 1.3.0

The combat-depth slice:

- Fourth active per class at level 6: **Leap Slam** (dash + landing shockwave),
  **Blast Shot** (exploding projectile), **Frost Nova** (chill/slow).
- **Runes**: one per active skill, level-gated at 3/5/7 and free to swap —
  Cruel (+damage/mana), Wide (+area/−damage), Swift (−cooldown/−damage).
- **Volatile** elite modifier: a telegraphed death blast.
- **Warden cinder pools**: phase-2 slams leave a lingering damage pool.
- **Camera occlusion**: tall props fade between the camera and hero; far elite
  silhouettes keep their modifier aura.
- Save schema **v5** adds runes (v4→v5 preserves ranks/loadout).

## Post-release 1.4.1

The itemization/economy slice, hardened:

- 20 item bases with item-level **implicit** stats and 29 affixes; five uniques
  including Cinderbrand, Warden's Bulwark and Windstep.
- **Item quality** 0–20% (5% steps) scaling implicits and affixes.
- **Crafting Bench** (C): reforge one affix (Ember Dust), add an affix (Ashen
  Rune), or raise quality (Quality Ember), via atomic validated transactions.
- Currency from kills/elites/boss; the victory screen reports crafting stock.
- **Salvage** bag items for Ember Dust; equipped gear must be unequipped first.
  The two-step confirmation resists double-clicks and the bench keeps focus.
- Save schema **v6** persists quality/implicits/currency with v1–v5 migrations.

## Release

**v1.4.1** is the current release; **v1.0.0** is the completed MVP baseline. The
deployable artifact is the static `dist/` bundle. Rollback target: tag `v1.4.0`.
Save schema v6 is unchanged in v1.4.1; v1.3.0 cannot read v6, so export/remove
v6 slot data before rolling back further. Full verification evidence, known
limitations and the release checklist live in
[docs/release-notes.md](./docs/release-notes.md).
