# Next Update Investigation — Ashen Vale

Scope: first-zone expansion, prop close-range shrink, ground-indicator policy. Read-only investigation; no game code changed.

## Baseline

5.0b save v7 is implemented on `feat/v15b-save` and green at 253 unit tests;
the browser v15b gate and full QA are still pending. Land/merge 5.0b before
starting this expansion. The v8 migration below builds on the accepted v7
`progress` shape.

## Findings

### 1. First zone is a small uniform disc

- Bounds are a circle centred at origin, radius 42 (`src/content/zone.ts:46`); spawn `(0,18)`, arena `(0,-31)`, radius 8 (`zone.ts:47-49`).
- Props: target 95 (`zone.ts:54`) sampled uniformly over the disc plus 11 arena pillars (`zone.ts:94`), minimum separation 3.2 (`zone.ts:19`). With `ZONE_SEED`, that produces ~100 props and ~17 enemies.
- Camps: exactly 3 (`zone.ts:116`), placed on a ring at `15 + rng*12` (`zone.ts:151-152`) and 3-4 members (`zone.ts:161`), 60% chance of an elite on member 0 plus 2-3 retinue (`zone.ts:177-207`). The default seed currently yields anchors near `(-8.85,-18.66)`, `(15.06,9.65)`, `(-17.38,12.83)`.
- All three camp indices are persisted. `campsTotal` is derived from the live spawn set (`src/sim/state.ts:410,435-438`) and the boss gate requires every camp (`src/systems/objectives.ts:15-29`).
- `src/content/zones.ts:28-34` persists exactly `campCount: 3`; `saveZoneProgress` pads to that count (`src/save/schema.ts:115-124`), and `parseSaveZoneProgress` rejects any other length (`schema.ts:429-453`). A 7-camp expansion therefore needs a v8 save migration, not just a generator change.
- The terrain play area is flat to r=42 and hills begin at r=44-66 (`src/render/terrain.ts:25-29`), so bounds expansion must move the flat/edge bands too. `TERRAIN_VERSION` (`terrain.ts:9`) must bump.
- The QA suites hard-code 3 camps (`qa/verify-slice-07.mjs:68,78`, `qa/verify-slice-08.mjs:99,133`, `qa/verify-release.mjs:185`, `qa/verify-v15a.mjs:552`) and a 41-unit play radius (`verify-v15a.mjs:358-360,498,692`).

### 2. Prop shrink: occlusion "fade" is implemented as a matrix scale

Root cause is `src/render/props.ts:238-241`:

```ts
const shrink = 1 - 0.92 * instance.fade;
fadeScale.copy(instance.scale).multiplyScalar(shrink);
matrix.compose(instance.position, instance.quaternion, fadeScale);
mesh.setMatrixAt(i, matrix);
```

The occlusion test (`props.ts:210-235`) targets tall props whose footprint lies near the 2D camera-to-player segment. `update()` is called every render frame from `src/main.ts:884`. When `fade` reaches 1, the instance is scaled to 8% of its authored size; when the player moves away it grows back. There is no opacity implementation: prop materials are opaque `MeshStandardMaterial` (`props.ts:88-111`, `src/render/materials.ts:220-226`), and no other system scales props. The camera rig only follows/lifts (`src/render/camera.ts:119-120,131-147`), so the 5.0a camera is not the cause; the shrink predates it (commit `e7a5810`). The broad trigger is `OCCLUSION_PADDING = 1.1` (`props.ts:141`) and the `t > 0.08 && t < 0.97` window (`props.ts:226`), so approaching almost any tree/pillar makes it collapse. `qa/verify-v13.mjs:55-64` only asserts `occludedProps > 0` ("fade"), so it never caught the scale change.

### 3. Ground-indicator inventory and policy

| Indicator | Evidence | Gate today | Recommended policy |
|---|---|---|---|
| Enemy attack ground tell | `src/render/telegraphs.ts:96-190`; event emitted `src/systems/enemyAi.ts:287-307`; event type `src/sim/state.ts:250-262` | every enemy | remove for normal enemies; keep for elite/boss |
| Elite aura ring | `src/render/enemies.ts:400-417` (detailed), `381-398` (far LOD), pulse `484-487` | `enemy.elite.length > 0` | keep |
| Health bars | `src/render/enemies.ts:490-530` | damaged, on screen, within 19 | keep (non-ground, needed feedback) |
| Boss phase toast | `src/main.ts:839-841` | `boss-phase` event | keep |
| Boss ground tells | same `TelegraphLayer`; phases `src/content/enemies.ts:167-222` | no boss-specific gate today | keep |
| Hover ring | `src/render/cursor.ts:21-77`; wiring `src/main.ts:947-960` | pointer over ground/enemy | remove free hover ring; keep enemy emissive highlight |
| Move destination ring | `src/render/cursor.ts:79-98,121-133`; wiring `src/main.ts:423-429` | move order | decision: remove or reduce to a thin non-pulsing ring |
| Player ground-strike runes | `src/render/skillVfx.ts:67-88,301-324`; created from `state.strikes` (`src/systems/combat.ts:389-401`) | player `delivery:'ground'` (`sunder`, `rain-of-arrows`, `meteor-strike`; `src/content/skills.ts:105,237,326`) | decision: keep a rim-only aim confirmation (recommended) or remove entirely |
| Player impact/nova rings | `src/render/skillVfx.ts:161-214,216-230,249-289` | post-hit VFX | keep; these are feedback, not tells |
| Hazard rings | `src/render/hazards.ts:33-113`; volatile `src/systems/combat.ts:65-76`; Warden cinder `src/systems/enemyAi.ts:173-186` | elite volatile / Warden | keep |

Concrete gate: add `tier: 'normal' | 'elite' | 'boss'` to the telegraph event, computed in `enemyAi.ts` from `enemy.elite.length > 0` and `getEnemy(enemy.defId).boss`. `TelegraphLayer.handleEvents` skips `tier === 'normal'`. This keeps the sim tell/fairness stream intact and only suppresses the mesh. Boss adds (`mire-skitterer`, `ashen-husk`, `camp: -1`, no elite) are ordinary enemies; decide whether the live boss fight promotes them to `boss` for readability.

The ambiguity: "player ground indicators" can mean (a) the hover/destination UI rings, (b) the player's own ground-target skill runes, or (c) both. The literal reading removes (c), which also removes all aim confirmation for three ground-target skills. Recommendation: remove the hover ring, reduce the destination marker, and keep a rim-only ground-strike rune; flag for human sign-off.

## Implementation plan

### Phase 0 — Land v15b cleanly

The v7 core is green (253 unit tests); finish the browser v15b gate, full QA,
review and merge. Freeze legacy camp counts inside the v7→v8 migration
(`V7_CAMP_COUNTS = { 'ashen-moor': 3, 'drowned-ossuary': 3 }`) before changing
live `zones.ts`. Gate: `npm test`, `npm run typecheck`, `npm run build`, full
`npm run qa` green.

### Phase 1 — Fix prop occlusion without scale changes

- Store the authored `baseMatrix` at creation. Never recompute it in `update()`.
- Keep `fade` per instance, but render it through a per-instance fade attribute that multiplies alpha in a dither/`alphaHash` material patch (`material.alphaHash`). If dithering is visually rejected, use a per-instance discard threshold in the same shader. Never write a scaled matrix; the authored matrix stays immutable.
- Apply the same per-instance alpha to a `customDepthMaterial` so shadows do not pop; if that is not feasible, only cast shadows while `fade < 0.5`.
- Keep the existing camera-to-player segment test but add hysteresis and expose `PropsView.probe()`: `{ total, occluded, sample: [{ x, z, scale, fade }] }`. Add `__ashen.propProbe()` for browser QA.
- Files: `src/render/props.ts`, `src/main.ts`; no change to prop placement or colliders.
- QA: teleport behind 3 tall props, assert `occludedProps > 0`, `fade > 0.9`, and the probed scale equals the authored scale on every axis within 1e-6. Repeat at camera distances 12, 18 and 21. Update `qa/verify-v13.mjs` to assert scale stability, not just fade count. Add a pure unit test for the occlusion target helper (node env cannot build canvas textures).

### Phase 2 — Expand the moor

**Bounds/terrain.** Keep the circle bounds type (`ZoneBounds` is centre+radius and is used by movement, AI, restore and arena logic), but raise radius 42 -> 56. That is 9,852 units² vs 5,541 (+78%). Keep spawn `(0,18)`. Flatten to r=56 with only gentle undulation from r=28-52 and hills from r=58-78; bump `TERRAIN_VERSION` to 2. Keep the 170-unit terrain plane and 128 segments (32,768 tris), so terrain draw/triangle cost does not change. Raise the key-light shadow camera `S` from 48 to 60 (`src/render/scene.ts:104-114`); 2048 map texel density drops ~20%, verify screenshots before considering 3072.

**Camps.** Seven camps, indices 0-6. Freeze the three legacy anchors exactly (above) so old `campsCleared[0..2]` keeps its meaning. Add four outer anchors: `(34,2)`, `(-36,2)`, `(22,32)`, `(-22,32)`. Use 3-4 members, first-member elite 60% with 1-2 modifiers, 2-3 retinue, same archetype weights; optionally bias each camp's dominant archetype (husk warband, cultist circle, skitterer nest). Expected 32-36 enemies vs ~17. Detail cap stays 8; far silhouettes remain one mesh each.

**Routes/sub-areas.** Add optional `ZoneRoute { id; points; width }` to `src/content/types.ts` (`routes?: ZoneRoute[]` on `ZoneLayout` so existing fixtures still typecheck). Generated layout includes:
- `court` `(0,18)->(0,8)`; `east` `(0,8)->camp1->camp3->(8,-38)`; `west` `(0,8)->camp2->camp4->(-8,-38)`; `south-loop` `(0,18)->camp5->(0,40)->camp6->camp2`; `warden-approach` `(0,8)->camp0->(0,-34)->arena`.
- Width 7; reserve the corridor plus camp discs (radius 6.5) and spawn/arena clearances from props.
- Named sub-areas: Ashen Gate (spawn), Cinder Road (central), Husk Barrows (east camps 1/3), West Ridge (camps 2/4), Mire Sinks (south camps 5/6), Warden's Court (arena). Differentiate with existing prop kinds only: rocks in the barrows, dead trees in the mire, pillar rows on the ridge/approach.

**Props.** 168 random props + 13 arena pillars = 181 instances, ~1.8x today but still four instanced draw calls (plus four shadow draws). Density is ~0.017 props/unit² versus ~0.018 today, so the moor should read similarly populated after camp/route reservations. Keep min separation 3.2 and per-kind collider radii. Use independent seeded streams for props, camps and arena pillars so changing camp contents cannot reshuffle the scenery. Arena moves to `(0,-46)`, radius 9, with 13 pillars total and two of them framing the approach gate; camp 0 flanks the west side of the approach. Embers stay one draw call; raise the 340 count only if the larger radius reads too sparse.

**Save v8.** `campCount`/`activeCamps` for `ashen-moor` become 7; `drowned-ossuary` stays 3. Bump `SAVE_VERSION` to 8 and the `SaveGame.version` literal, freeze a `SaveGameV7` type and `validateV7` (hard-coded version 7 + frozen 3-count), make `migrateV6ToV7` use the frozen 3-count too, add `migrateV7ToV8`, and let `migrateSave` accept 1-8:
- pad `progress['ashen-moor'].campsCleared` from 3 to 7 with `false`;
- if `bossSpawned` or `bossDefeated` is true, set the four new slots true so the v8 gate invariant holds;
- leave the ossuary progress at 3.
`restoreGameState` slices saved flags to live `campsTotal`; new saves write 7. Update `restore.ts`, `schema.ts`, `main.ts` save displays and `ui/saveSlots.ts` to read `save.progress[save.zoneId]`. v8 is not readable by v1.4.x/v15b, so document rollback.

**QA constants.** Update hard-coded 3 -> 7 and 41 -> 55 (or read bounds from the snapshot) in `qa/verify-slice-07.mjs`, `verify-slice-08.mjs`, `verify-release.mjs`, `verify-v15a.mjs`; add a new first-zone browser suite covering a full 7-camp clear, Warden at the new arena, checkpoint/reload, and an old v7 save.

### Phase 3 — Indicator gating

- Add `tier` to the telegraph event (`src/sim/state.ts:250-262`), populate in `src/systems/enemyAi.ts:287-307`, filter in `src/render/telegraphs.ts:109-161`. Keep the sim event for fairness tests; add `visibleTelegraphs`/`hiddenNormalTelegraphs` counters to the snapshot so QA can prove normal tells are absent while elite/boss tells remain.
- Elite/boss rings and nameplates stay. Health bars stay (recommended). Boss phase toasts stay.
- Cursor/aim: default proposal removes `CursorMarker` hover; destination becomes a thin, non-pulsing ring or is removed per decision; player ground-strike runes become rim-only. Update `snapshot.markers`/`probes.rings`, the v15a marker assertions, `qa/verify-slice-03.mjs` (normal fight has no visible tell; elite/boss still does) and `qa/verify-slice-05.mjs` (ground-strike visual assertion) accordingly.
- Add a non-ground normal-enemy windup cue: ramp the existing `flashMaterials` emissive during `phase === 'windup'` (`src/render/enemies.ts:460-470`). There is no audio system in the repo, so "audio-only tells" is not currently available.
- Acceptance: a normal camp fight produces 0 visible ground tells; an elite camp produces >=1; a Warden phase-2 slam produces >=1; elite aura rings/nameplates unchanged; hazards still render for Volatile and cinder pools.

### Phase 4 — Integration and performance

- Draw-call budget remains 320 and triangle budget 260,000 (`qa/verify-release.mjs:20-21`); measure a new camp fight and rebaseline only with evidence.
- Worst-case new cost: ~17 extra far-silhouette draws, ~81 extra prop instances (same 4 calls), 7 camp AI groups. Shadow density is the main visual risk; prop occlusion dither and shadow depth are the main technical risks.
- Update `qa/verify-v15a.mjs` terrain sampling from the old 41-radius disc to the new bounds; the remount gate currently never visits the new outer ring.
- Tests: `src/content/zone.test.ts` (determinism, 7 camps, anchors, route clearance, prop count/density, arena), `src/save/schema.test.ts` (v7->v8, old 3 flags, boss-spawned fill, v8 round-trip, ossuary unchanged), `src/save/restore.test.ts` (camp filter, boss restore), `src/systems/objectives.test.ts` (7-camp gate), browser suites above.

## Risks

- **Readability:** normal enemies lose directional ground footprints; animation windup must carry the tell in 7 crowded camps. Low-vision players and touch users are most affected. Keep elite/boss hierarchy and add the windup emissive ramp; consider an accessibility toggle.
- **Player aim:** removing player ground-strike runes makes Sunder/Rain of Arrows/Meteor Strike hard to aim under the fixed isometric camera. This is the strongest reason to keep a reduced rim.
- **Save:** v8 is a one-way format for v1.4.x/v15b; 5.0b is branch-only and not yet merged, so Phase 0 is a hard dependency.
- **Performance/visual:** 1.8x prop instances and 2x enemy count raise vertex/AI load; 60-unit shadow camera lowers texel density. Dither fade can look noisy and needs a custom depth material for clean shadows.
- **QA brittleness:** many suites hard-code 3 camps and r=41; they must be updated in the same change or they will fail for the wrong reason.

## Decisions for the human

1. **Indicator ambiguity:** remove all player ground indicators (literal), or remove hover and keep a reduced destination/ground-strike rim? Recommendation: reduced.
2. **Player ground-strike runes:** keep rim-only aim confirmation, or remove entirely?
3. **Normal health bars:** keep (recommended), or hide them to match "no indicators"?
4. **Boss adds:** show normal-enemy tells during a live boss fight (recommended) or strictly boss/elite only?
5. **Bounds shape:** circle radius 56 (recommended, no type churn) or a capsule/elongated moor (more code in movement, AI, restore, terrain)?
6. **Save mapping:** freeze legacy camp 0-2 anchors and pad to 7 (recommended), or regenerate all camps and reset old camp progress?
7. **Accessibility:** add a settings toggle to restore normal-enemy ground tells?
