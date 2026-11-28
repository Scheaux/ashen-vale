# Next Update — Linear Moor, Prop Occlusion, Indicator Policy

Baseline: 5.0b save v7 on `feat/v15b-save` (core green; browser gate/review
pending). Land and merge 5.0b first. The moor rebuild below ships as save **v8**.

## Goals

1. Rebuild the first zone as a long, linear bog: **12–15 optional camps**, the
   Warden at the far end, no separate arena or teleport clamp, and a portal to
   the next zone that opens when the Warden dies.
2. Fix terrain props shrinking when the player approaches.
3. Remove ground indicators for normal enemies while keeping them for elites
   and bosses; resolve the player-indicator ambiguity.

## Findings

- **Prop shrink:** `src/render/props.ts:238-241` implements the occlusion
  “fade” by scaling the instance matrix: at `fade = 1` the prop is 8% of its
  authored size. Materials are opaque, so there is no alpha fade. `main.ts:884`
  calls `PropsView.update` every frame. This predates 5.0a.
- **Current moor:** a radius-42 disc (`src/content/zone.ts:46`), spawn `(0,18)`,
  arena `(0,-31)` radius 8, 3 camps, ~100 props, ~17 enemies. Camps are
  mandatory for the boss (`src/systems/objectives.ts:15-29`).
- **Current save:** v7 stores exactly 3 camp flags per zone
  (`src/content/zones.ts`, `src/save/schema.ts`). A 13-camp moor needs a v8
  migration, not only a generator change.
- **Indicators:** every enemy emits a ground telegraph; the player has a hover
  ring, a destination ring and ground-strike runes. Elite rings, health bars,
  boss phase toasts and hazards are separate.

## 1. Linear bog

### Shape

- Replace the disc with a **long corridor**. Recommended: a 3–4 point
  centerline from spawn `(0, 78)` through `(12, 10)` and `(-8, -40)` to the
  Warden clearing `(0, -78)`, with a 28–30 unit half-width. That is ~156 units
  long and 56–60 wide, a bog rather than a bowl.
- Add `ZoneCorridor { points: Vec2[]; radius: number }` to the layout (or a
  capsule `{ a, b, radius }` if the winding version is rejected). Keep
  `ZoneBounds` for legacy fixtures/arena math, but movement, AI wander and
  restore clamp to the corridor. Add `isInsideCorridor`/`clampToCorridor`
  helpers in `src/content/zone.ts` or `src/systems/movement.ts`.
- Terrain: flatten a band around the corridor, with boggy undulation inside and
  hills outside; bump `TERRAIN_VERSION`. Keep the 170-unit plane if the
  corridor stays within ±78; otherwise enlarge the plane and segments and
  re-check the triangle budget. Extend the shadow camera to cover the end
  clearing.
- Props: line the corridor edges and camp pockets; keep the center and camp
  discs clear. Raise the prop target for a 156-unit corridor but keep four
  instanced draw calls.

### Camps

- **13 camps** (inside the requested 12–15), indices 0–12, distributed 2–3 per
  corridor segment, alternating sides 10–14 units off the centerline. Each is a
  small clearing (radius ~7) with 3–5 enemies and a 50% elite.
- **Optional for completion.** Clearing a camp grants XP/loot/currency and a
  toast, but never gates the Warden or the portal. The HUD reads
  `Camps cleared (n/13) — optional` and `Reach the Warden at the end`.
- Legacy camp flags 0–2 from a v7 save are preserved by index during migration;
  their old disc positions are not preserved because the layout changes. Camp
  progress is optional, so this only affects completeness/rewards.
- Remove the “clear every camp then the boss spawns” rule. `stepObjectives`
  tracks optional camps, while the Warden/portal are end-of-zone triggers.

### Warden and portal

- Warden at the far end (`(0,-78)` clearing), not in a separate arena. **Remove
  the `activeBounds` arena clamp and any teleport**; the player walks the bog,
  and the fight uses the normal corridor bounds. The Warden wakes when the hero
  enters the end clearing, or stands dormant there until approached.
- Keep an encounter radius for AI leash/telegraphs only; it must not move the
  player or hard-clamp movement.
- On Warden death: no final-victory stop. Show a chapter banner/toast
  (“The Warden falls — the Warden’s Gate opens”), activate a portal behind the
  clearing, and checkpoint. The portal is the travel object to the next zone;
  the Pale Cantor remains the campaign finale.
- The portal is inert (`Sealed`) until `bossDefeated`; interaction then travels
  to the Drowned Ossuary. Until 5.0c/d ships, the portal can open with a
  “The Ossuary is not yet available” refusal so the visual/flow is testable.

### Save v8

- `campCountForZone('ashen-moor')` and `activeCamps` become **13**; ossuary
  stays 3. `bossTrigger` gains/changes to an end trigger (`'end'` or
  `'always'`); camps no longer imply the boss gate.
- `SAVE_VERSION = 8`; freeze `SaveGameV7`/`validateV7` with the v7 3-count,
  add `migrateV7ToV8`, and accept 1–8:
  - pad moor `campsCleared` 3 → 13 with `false`;
  - preserve flags 0–2;
  - do **not** set the new camps true just because the old boss was defeated;
    the boss/portal is driven by `bossDefeated`, not camp completeness;
  - ossuary stays 3.
- `restoreGameState` slices to the live camp count; save cards show the
  13-slot total; v8 is not readable by v1.4.x/v15b.

### QA / performance

- **Optional camps:** clear some, skip others, kill the Warden, assert the
  portal opens with camps unfinished.
- **No arena teleport:** assert the hero is never moved by boss spawn, can
  retreat down the corridor, and the fight is not fenced.
- **Portal:** inert before the kill, active after, checkpoint/Continue keeps it,
  and interaction refuses until the next zone exists.
- **Linear layout:** corridor determinism, camps inside the corridor, boss at
  the end, no camp/boss overlaps, route clearance.
- **Save:** v7→v8, 3→13 padding, legacy flags 0–2, boss-defeated portal, v8
  round-trip, ossuary unchanged.
- **Performance:** 13 camps × ~4 enemies (~45–55) must hold ≤320 draw calls /
  ≤260K triangles in the densest camp; detail cap stays 8, far silhouettes one
  mesh each. Record the end-clearing Warden pack separately.
- Update hard-coded 3-camp/radius assumptions in `qa/verify-slice-07`,
  `verify-slice-08`, `verify-release`, `verify-v15a`; add a first-zone linear
  browser suite.

## 2. Prop occlusion fix (independent)

- Store the authored instance matrix at creation; never rewrite it in
  `update()`. Keep the per-instance occlusion `fade`, but express it through a
  per-instance alpha/dither attribute (or a per-instance discard threshold) in
  the material shader. Never scale the matrix.
- Add a matching `customDepthMaterial` for shadows, or stop shadow casting
  while `fade > 0.5` if the custom depth path is too costly.
- Keep the camera-to-player occlusion test, add hysteresis, and expose
  `__ashen.propProbe()` with `{ total, occluded, sample: [{ x, z, scale, fade }] }`.
- QA: approach three tall props at zoom 12/18/21; assert `occluded > 0`,
  `fade > 0.9`, and authored scale is unchanged within 1e-6. Update
  `verify-v13` to assert scale stability, not just the fade count.

## 3. Indicators

- **Enemy ground tells:** add a `tier: 'normal' | 'elite' | 'boss'` to the
  telegraph event, computed from `enemy.elite.length` and the boss def. Skip
  rendering normal-tier tells; keep elite and boss tells. Keep the sim event so
  fairness tests still see it.
- **Normal-enemy windup cue:** ramp the existing emissive/flash material during
  `phase === 'windup'`; there is no audio system to carry the tell. Keep the
  animation committed and readable.
- **Player indicators:** the literal request removes the hover ring, move
  destination ring and player ground-strike runes. Removing the strike runes
  makes Sunder/Rain of Arrows/Meteor Strike hard to aim under the fixed camera.
  Recommended compromise: remove the free hover ring, reduce the destination
  to a thin non-pulsing ring (or remove it), and keep a **rim-only** ground
  strike aim confirmation. Flag for human sign-off.
- Keep elite aura rings, health bars, boss phase toasts and hazards. Decide
  whether boss adds show normal tells during the live fight (recommended: yes).
- QA: a normal camp produces 0 visible ground tells; an elite camp ≥1; the
  Warden slam ≥1; hazards still render; health bars/elite rings unchanged.

## Phases

0. Land/merge 5.0b (v7) and freeze its 3-camp shape.
1. Prop occlusion fix + close-range scale QA.
2. Linear bog, 13 optional camps, end Warden, portal, save v8, terrain/props.
3. Indicator tiering and the player-aim decision.
4. Full QA, performance rebaseline, release notes/rollback (v8 one-way).

## Decisions for the human

1. Confirm **13 camps** (12–15) and the corridor/capsule shape.
2. Preserve legacy camp flags 0–2 during v7→v8, or reset camp completeness?
3. Warden death: portal + chapter banner only (recommended), or keep the
   existing victory screen as well?
4. Player indicators: literal removal, or the reduced hover/destination +
   rim-only ground-strike aim?
5. Accessibility: add a toggle to restore normal-enemy ground tells?
