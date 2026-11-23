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
| 6 | Passive skill tree | ⬜ Next | Meaningful build choice |
| 7 | Zone objective & boss | ⬜ Planned | Complete the loop |
| 8 | Save slots | ⬜ Planned | Survive reload; migration tested |
| 9 | Polish & release | ⬜ Planned | Ship-ready build |

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

### Slice 6 — Passive skill tree
A ~30-node PoE-flavored tree with clusters (offense/defense/utility), one point per
level, allocation UI with node tooltips and refund rules; stat effects visible in the
character sheet; build choices meaningfully change combat numbers (verified by tests).

### Slice 7 — Zone objective & boss
Zone objective tracking ("clear the camps", "slay the Ashen Warden") with HUD tracker;
boss encounter with 2–3 phases, distinct telegraphs, arena boundary and minion adds;
victory and defeat screens that close the loop back to title/continue.

### Slice 8 — Save slots
localStorage save slots (3+) with save/load UI from the title and pause menus;
checkpoint saves on zone milestones; versioned schema migrations proven by tests
(v1 → vN), corrupted-save recovery, and "Continue" from the title screen.

### Slice 9 — Polish & release
Combat readability pass (telegraph contrast, damage numbers, hit feedback); VFX polish
(skill trails, impact frames, ambient effects); performance pass (draw calls, instancing,
adaptive quality, mobile-no-longer-required desktop budget); production build; full
browser playthrough checklist (fresh start → boss → save → reload → continue); release
notes and rollback readiness.

---

## Content scope (deliberately thin — depth from data, not breadth)

- **Classes (3):** Marauder (melee, strength), Ranger (projectile, dexterity),
  Witch (projectile, intelligence) — 4-skill QWER kits each (basic + 3 actives) since slice 5.
- **Enemies (3 + elites):** Ashen Husk (melee charger), ranged caster, fast swarm —
  elite modifiers from slice 3.
- **Loot:** 4 rarity tiers, 6 equipment slots, ~17 affixes (attributes, life/mana,
  attack/spell damage, armour, evasion, energy shield, move speed).
- **Zone (1):** fixed handcrafted layout with seeded prop/enemy population,
  boss arena at the end.
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

## Validation bar (every slice)

1. `npm run typecheck` — clean.
2. `npm test` — deterministic sim core covered (combat math, loot rolls, AI fixtures,
   save serialization/migration).
3. `npm run build` — production build passes.
4. `npm run qa` — headless-Chromium playthrough of the slice's gate with screenshots
   (`qa/shots/`) and zero console errors; earlier slices' suites must stay green.

Simulation is deterministic for the same seed and tick-by-tick inputs. Rendering
consumes authoritative sim events. The current save format is a character
checkpoint, not a snapshot of the simulation or its RNG state.
