# Next Update — Linear Moor, Prop Occlusion, Indicator Policy

Baseline: 5.0b save v7 is green on `feat/v15b-save` (253 unit tests, 426
browser checks; merge pending). Land/merge 5.0b first. The moor rebuild below
ships as save **v8**.

## Goals

1. Rebuild the first zone as a long, linear bog with **16 optional camps**, the
   Warden at the far end, no separate arena/teleport clamp, and a portal that
   opens on the Warden’s death.
2. Keep the victory screen, but bind it to clearing the **last zone** of the
   campaign. With one zone, the Warden is the final boss; with three zones, the
   third zone’s boss is the win.
3. Fix terrain props shrinking when approached, and fix the misaligned warrior
   Cleave arc instead of removing it.
4. Remove ground attack tells for normal enemies; keep elite/boss tells.

## Findings

- **Prop shrink:** `src/render/props.ts:238-241` implements occlusion “fade” by
  scaling the instance matrix; at `fade = 1` the prop is 8% of authored size.
  Materials are opaque, so there is no alpha fade. `main.ts:884` calls it every
  frame. This predates 5.0a.
- **Current moor:** radius-42 disc (`src/content/zone.ts:46`), spawn `(0,18)`,
  arena `(0,-31)` radius 8, 3 camps, ~100 props, ~17 enemies. Camps gate the
  boss (`src/systems/objectives.ts:15-29`).
- **Current save:** v7 stores exactly 3 camp flags per zone. The 16-camp moor
  needs a v8 migration.
- **Warrior arc:** `src/render/skillVfx.ts:104-108` builds a ring whose center
  is at `-Z`, then rotates by `-facing`. At facing 0 the crescent points behind
  the warrior; at +90 it happens to look correct, so it is mirrored. A Node
  probe confirms the centroid is at `180°` for facing 0 instead of `0°`.
  **Two-line fix:** `thetaStart = -Math.PI/2 - arc/2` and
  `rotation.z = facing`. Add a visual/centroid test. This is easy; keep the
  indicator.
- **Indicators:** every enemy emits a ground telegraph. The player has a hover
  ring, destination ring, ground-strike runes and the warrior Cleave arc. Elite
  aura rings, health bars, boss toasts and hazards are separate.

## 1. Linear bog

### Shape

- Replace the disc with a **corridor**. Recommended centerline points:
  `(0,78) -> (12,10) -> (-8,-40) -> (0,-78)`, half-width 28–30. That is ~156
  units long and ~56–60 wide, a bog rather than a bowl.
- Add `ZoneCorridor { points: Vec2[]; radius: number }` to the layout. Keep
  `ZoneBounds` for legacy fixtures/arena math, but movement, AI wander and
  restore clamp to the corridor. Add `isInsideCorridor`/`clampToCorridor`.
- Terrain: flatten a band around the corridor, with bog undulation inside and
  hills outside; bump `TERRAIN_VERSION`. Keep the 170-unit plane if the corridor
  stays within ±78; extend the shadow camera to cover the end clearing.
- Props: line the corridor edges and camp pockets; keep the center and camp
  discs clear. Raise the prop target for the longer corridor, but keep four
  instanced draw calls.

### Camps (16, optional)

- Exactly **16 camps**, indices 0–15, distributed 3–4 per corridor segment,
  alternating sides 10–14 units off the centerline. Each is a small clearing
  (radius ~7) with 3–5 enemies and a 50% elite.
- **Optional for completion.** Clearing grants XP/loot/currency and a toast,
  but never gates the Warden or portal. HUD: `Camps cleared (n/16) — optional`
  and `Reach the Warden at the end`.
- Remove the “clear every camp then the boss spawns” rule. The Warden is an
  end-of-zone encounter/trigger; camps are side content.
- **No legacy camp carry-over.** The v8 migration pads the old 3 flags to 16
  with `false` and does not preserve the old 0–2 flags; the layout and camp
  meanings change. `bossSpawned`/`bossDefeated` are preserved.

### Warden, portal and victory

- Warden at the far end (`(0,-78)` clearing), not in a separate arena. **Remove
  the `activeBounds` arena clamp and any teleport**; the player walks the bog
  and can retreat. The Warden wakes when the hero enters the end clearing, or
  stands dormant there until approached.
- Keep an encounter radius for AI leash/telegraphs only; it must not move or
  hard-clamp the player.
- On Warden death: a chapter banner/toast, activate the portal behind the
  clearing, checkpoint, and **open the portal**. No mandatory victory stop for
  the Warden unless the Warden is the final zone boss.
- **Victory rule:** add `CAMPAIGN_ZONES: readonly ZoneId[]` in `zones.ts`
  (currently `['ashen-moor']`, later append the ossuary). `finalZone` is the
  last entry. `stepObjectives`/`main` emit/show the victory screen only when
  the defeated boss’s zone is `finalZone`. With one zone, the Warden shows the
  victory screen and opens the portal; with more zones, earlier bosses only
  open the portal and show a chapter banner, and the final zone’s boss shows
  victory.
- Portal: inert (`Sealed`) until `bossDefeated`; on death it opens. If a next
  zone exists, interaction travels there. Until 5.0c/d ships, the portal can
  open with a “The Ossuary is not yet available” refusal so the flow is
  testable. On the final zone, the portal can remain open but have no target.
- The victory screen remains as-is for the final zone; it is not bound to the
  Warden specifically.

### Save v8

- `campCountForZone('ashen-moor')` and `activeCamps` become **16**; ossuary
  stays 3. `bossTrigger` gains `'end'`; camps no longer imply the boss gate.
- `SAVE_VERSION = 8`; freeze `SaveGameV7`/`validateV7` with the v7 3-count, add
  `migrateV7ToV8`, and accept 1–8:
  - moor `campsCleared` 3 → 16, all new **and old** slots reset to `false`
    (no legacy camp carry-over);
  - preserve `bossSpawned`/`bossDefeated`; do not set new camps true for a
    defeated boss;
  - ossuary stays 3;
  - v8 validation must **not** require all camps cleared for a boss spawn/defeat.
- `restoreGameState` slices to the live camp count; save cards show 16;
  `finalZone`/victory use `CAMPAIGN_ZONES`; v8 is one-way for v1.4.x/v15b.

### QA / performance

- Clear some camps, skip others, kill the Warden: portal opens with camps
  unfinished; victory screen shows only when the Warden is `finalZone`.
- No arena teleport/clamp: the hero is never moved by boss spawn and can
  retreat down the corridor.
- Portal: inert before the kill, active after, checkpoint/Continue preserves it,
  interaction refuses until the next zone exists.
- Corridor: 16 camps inside, deterministic, no camp/boss/route overlaps.
- Save: v7→v8 3→16 reset, boss/portal preserved, v8 round-trip, ossuary
  unchanged; old v7 save loads into the new moor.
- Performance: 16 camps × ~4 enemies (~64) must hold ≤320 draw calls / ≤260K
  triangles in the densest camp; detail cap 8, far silhouettes one mesh each.
  Record the end-clearing Warden pack separately.
- Update hard-coded 3-camp/radius assumptions in `qa/verify-slice-07`,
  `verify-slice-08`, `verify-release`, `verify-v15a`; add a linear-moor browser
  suite.

## 2. Prop occlusion fix (independent)

- Store the authored instance matrix at creation; never rewrite it in
  `update()`. Keep the per-instance occlusion `fade`, but express it through a
  per-instance alpha/dither attribute (or a per-instance discard threshold) in
  the material shader. Never scale the matrix.
- Add a matching `customDepthMaterial` for shadows, or stop shadow casting
  while `fade > 0.5` if custom depth is too costly.
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
  `phase === 'windup'`; there is no audio system to carry the tell.
- **Warrior Cleave arc:** keep it and fix the mirror with the two-line
  `thetaStart`/`rotation.z` change above. Add a centroid/visual regression test.
  The arc is the player’s attack indicator the user reported as misaligned.
- **Other player indicators:** hover/destination rings and ground-strike aim
  runes are not removed by this change; only the buggy Cleave arc is fixed. If
  the intent was to remove those as well, that is a separate sign-off.
- Keep elite aura rings, health bars, boss phase toasts and hazards. Decide
  whether boss adds show normal tells during the live fight (recommended: yes).
- QA: a normal camp produces 0 visible ground tells; an elite camp ≥1; the
  Warden slam ≥1; hazards still render; Cleave arc centroid matches facing;
  health bars/elite rings unchanged.

## Phases

0. Land/merge 5.0b (v7).
1. Prop occlusion fix + close-range scale QA.
2. Linear bog, 16 optional camps, end Warden, portal, last-zone victory,
   save v8, terrain/props.
3. Indicator tiering + Cleave arc fix.
4. Full QA, performance rebaseline, release notes/rollback (v8 one-way).

## Decisions for the human

1. Confirm the corridor centerline/width (recommended above).
2. Confirm **16 camps** and no legacy camp carry-over.
3. Confirm victory = last campaign zone, and Warden is final while
   `CAMPAIGN_ZONES = ['ashen-moor']`.
4. Accessibility: add a toggle to restore normal-enemy ground tells?
