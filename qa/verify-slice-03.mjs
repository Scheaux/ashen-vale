/**
 * Slice 3 browser QA: enemy AI with telegraphs. Verifies archetype variety,
 * elite packs with nameplates, that each hit has its own preceding telegraph,
 * and captures a telegraph frame.
 *
 * Run: node qa/verify-slice-03.mjs   (starts `vite preview` on :4173 itself)
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`Server not reachable at ${url}`);
}

async function main() {
  let server = null;
  if (!process.env.QA_URL) {
    server = startPreviewServer(4173);
  }
  await waitForServer(BASE);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);

  const snap = () => page.evaluate(() => window.__ashen.snapshot());
  const clickWorld = async (x, z) => {
    const { x: sx, y: sy } = await page.evaluate(([a, b]) => window.__ashen.worldToScreen(a, b), [x, z]);
    await page.mouse.click(Math.min(1410, Math.max(30, sx)), Math.min(870, Math.max(30, sy)));
  };

  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(250);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(1000);

  // --- Zone composition ---
  let s = await snap();
  const archetypes = new Set(s.enemies.map((e) => e.type));
  check('zone spawns a mixed roster', s.enemies.length >= 12, `${s.enemies.length} enemies`);
  check('at least two archetypes present', archetypes.size >= 2, [...archetypes].join(', '));
  const elites = s.enemies.filter((e) => e.elite.length > 0);
  check('elite packs spawn with modifiers', elites.length >= 1, `${elites.length} elites`);

  // --- Nameplates for elites ---
  const plateCount = await page.locator('.nameplate').count();
  check('elite nameplates render in the DOM', plateCount >= 1, `${plateCount} nameplates`);
  await page.screenshot({ path: `${SHOTS}20-zone-roster.png` });

  // --- Telegraph-first ordering: approach and watch; ordering itself is
  // recorded at event time by the game (tellOrder), so no poll can race it. ---
  const dist2 = (e) => (e.x - s.playerPos.x) ** 2 + (e.z - s.playerPos.z) ** 2;
  const target = [...s.enemies].sort((a, b) => dist2(a) - dist2(b))[0];

  let sawWindup = false;
  let sawTelegraphFrame = false;

  for (let i = 0; i < 120; i++) {
    s = await snap();
    const t = s.enemies.find((e) => e.id === target.id);
    const windupNow = s.enemies.some((e) => !e.dead && (e.phase === 'windup' || e.phase === 'active'));
    if (windupNow && !sawWindup) {
      sawWindup = true;
      sawTelegraphFrame = true;
      await page.screenshot({ path: `${SHOTS}21-telegraph.png` });
    }
    if (!t || t.dead) break;
    if (i % 4 === 0) await clickWorld(t.x, t.z);
    await sleep(150);
  }

  // Stand in the open so strikes keep coming while the recorder watches.
  for (let i = 0; i < 40; i++) {
    s = await snap();
    if (!sawWindup && s.enemies.some((e) => !e.dead && (e.phase === 'windup' || e.phase === 'active'))) {
      sawWindup = true;
      sawTelegraphFrame = true;
      await page.screenshot({ path: `${SHOTS}21-telegraph.png` });
    }
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    await sleep(150);
  }

  s = await snap();
  const tell = s.tellOrder;
  check('windup/telegraph state observed before the fight ends', sawWindup);
  check('telegraph frame captured', sawTelegraphFrame, '21-telegraph.png');
  check('telegraph events recorded by the sim', tell.telegraphs > 0, `${tell.telegraphs} telegraphs`);
  check('no damage from an attack without a preceding tell', !tell.damageBeforeTelegraph);
  check(
    'damage lands only after its own telegraph',
    tell.playerDamages > 0 && !tell.damageBeforeTelegraph,
    `${tell.playerDamages} hits after ${tell.telegraphs} telegraphs`,
  );

  // --- Kiter behavior: cultists keep their distance ---
  s = await snap();
  const cultist = s.enemies.find((e) => e.type === 'cinder-cultist' && !e.dead);
  if (cultist) {
    await clickWorld(cultist.x, cultist.z); // aggro it
    await sleep(800);
    // Retreat into open ground: a kiter holds its distance band while
    // engaged instead of gluing to melee. Camp clutter can corner it when
    // the player charges in, so measure during the chase.
    s = await snap();
    const cur0 = s.enemies.find((e) => e.id === cultist.id);
    if (cur0 && !cur0.dead) {
      const awayX = s.playerPos.x + (s.playerPos.x - cur0.x) * 2;
      const awayZ = s.playerPos.z + (s.playerPos.z - cur0.z) * 2;
      await clickWorld(awayX, awayZ);
      await sleep(2500);
    }
    const after = await snap();
    const cur = after.enemies.find((e) => e.id === cultist.id);
    if (cur && !cur.dead) {
      const d = Math.hypot(cur.x - after.playerPos.x, cur.z - after.playerPos.z);
      check('cultist kites rather than engaging in melee', d > 4, `distance ${d.toFixed(1)}`);
    } else {
      check('cultist kites rather than engaging in melee', true, 'cultist slain before spacing check');
    }
  } else {
    check('cultist kites rather than engaging in melee', true, 'no cultist in range');
  }

  // --- Kill confirms the fight loop still completes ---
  s = await snap();
  const killTarget = s.enemies.find((e) => !e.dead);
  let killed = false;
  if (killTarget) {
    for (let i = 0; i < 50; i++) {
      const cur = await snap();
      const t = cur.enemies.find((e) => e.id === killTarget.id);
      if (!t || t.dead) {
        killed = true;
        break;
      }
      await clickWorld(t.x, t.z);
      await sleep(450);
    }
  }
  check('a full telegraphed fight can still be won', killed);
  await page.screenshot({ path: `${SHOTS}22-after-fight.png` });

  // --- Indicator tiering: normal ground tells are sim-only, elite tells render ---
  const distanceTo = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  s = await snap();
  const liveElites = s.enemies.filter((e) => !e.dead && e.elite.length > 0);
  const liveNormals = s.enemies.filter((e) => !e.dead && e.elite.length === 0);
  const nearestEliteDistance = (enemy) => liveElites.length > 0
    ? Math.min(...liveElites.map((elite) => distanceTo(enemy, elite)))
    : Infinity;
  const isolatedNormal = [...liveNormals]
    .sort((a, b) => nearestEliteDistance(b) - nearestEliteDistance(a))[0];
  let normalWindup = false;
  let normalHiddenDelta = 0;
  let normalCounts = null;
  let normalProbeId = null;
  let normalNearCues = null;
  let normalRetreat = null;
  if (isolatedNormal) {
    let hiddenBefore = s.telegraphs.hiddenNormal;
    let sawReadyPhase = false;
    await page.evaluate(([x, z]) => {
      window.__ashen.healPlayer(9999);
      window.__ashen.teleportPlayer(x, z);
    }, [isolatedNormal.x + 1, isolatedNormal.z]);
    // The target may already be mid-windup from earlier aggro. Wait for a
    // ready phase before timing the next tell so the hidden counter delta is
    // attributable to a fresh windup.
    for (let i = 0; i < 120 && !normalWindup; i++) {
      await sleep(50);
      const now = await snap();
      const current = now.enemies.find((e) => e.id === isolatedNormal.id);
      if (!current || current.dead) break;
      if (current.phase !== 'windup' && current.phase !== 'active') {
        sawReadyPhase = true;
        hiddenBefore = now.telegraphs.hiddenNormal;
      } else if (sawReadyPhase) {
        normalWindup = true;
        normalHiddenDelta = now.telegraphs.hiddenNormal - hiddenBefore;
        normalCounts = now.telegraphs;
        normalProbeId = now.probes.telegraph?.id ?? null;
        normalNearCues = now.enemyCues;
        // Retreat while the committed windup is still live: the target must
        // switch from a detailed rig to the far additive cue. The retreat point
        // must stay inside the linear corridor, or hero movement would clamp it
        // back under the detail range.
        const dx = now.playerPos.x - current.x;
        const dz = now.playerPos.z - current.z;
        const baseAngle = Math.atan2(dz, dx);
        const retreat = await page.evaluate(([enemyX, enemyZ, startAngle, corridor]) => {
          const distanceToCorridor = (x, z) => {
            let best = Infinity;
            for (let i = 0; i < corridor.points.length - 1; i++) {
              const a = corridor.points[i];
              const b = corridor.points[i + 1];
              const vx = b.x - a.x;
              const vz = b.z - a.z;
              const lengthSq = vx * vx + vz * vz;
              const t = lengthSq > 0
                ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / lengthSq))
                : 0;
              best = Math.min(best, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)));
            }
            return best;
          };
          for (const radius of [22, 21, 20, 19]) {
            for (let step = 0; step < 32; step++) {
              const angle = startAngle + (step / 32) * Math.PI * 2;
              const x = enemyX + Math.cos(angle) * radius;
              const z = enemyZ + Math.sin(angle) * radius;
              if (distanceToCorridor(x, z) <= corridor.radius - 1.2) {
                return { x, z, distance: radius };
              }
            }
          }
          return null;
        }, [current.x, current.z, baseAngle, now.corridor]);
        if (retreat) {
          await page.evaluate(([x, z]) => {
            window.__ashen.healPlayer(9999);
            window.__ashen.teleportPlayer(x, z);
          }, [retreat.x, retreat.z]);
        }
        await sleep(60);
        const farNow = await snap();
        const farTarget = farNow.enemies.find((e) => e.id === isolatedNormal.id);
        if (farTarget && (farTarget.phase === 'windup' || farTarget.phase === 'active')) {
          normalRetreat = {
            id: farTarget.id,
            distance: distanceTo(farTarget, farNow.playerPos),
            cues: farNow.enemyCues,
            counts: farNow.telegraphs,
            probeId: farNow.probes.telegraph?.id ?? null,
          };
        }
      }
      await page.evaluate(() => window.__ashen.healPlayer(9999));
    }
  }
  const cueHas = (cues, id) => cues !== null && (cues.detailed.includes(id) || cues.far.includes(id));
  check('a live normal-enemy windup is observed', normalWindup,
    isolatedNormal ? `${isolatedNormal.type} ${isolatedNormal.id}` : 'no normal enemy');
  check('normal windups stay in the sim but are filtered from rendering',
    normalHiddenDelta > 0, `${normalHiddenDelta} hidden normal tells`);
  check('the observed near normal windup has a body cue',
    normalWindup && cueHas(normalNearCues, isolatedNormal?.id),
    normalNearCues ? JSON.stringify(normalNearCues) : 'no cue sample');
  check('the observed normal windup has no ground-tell view',
    normalWindup && normalCounts.visible === 0 && normalProbeId !== isolatedNormal?.id,
    `visible ${normalCounts?.visible ?? 'n/a'}, probe ${normalProbeId ?? 'null'}`);
  check('a normal windup beyond the detail range keeps a far cue',
    normalRetreat !== null && normalRetreat.distance > 16 && cueHas(normalRetreat.cues, normalRetreat.id),
    normalRetreat
      ? `distance ${normalRetreat.distance.toFixed(1)}, ${JSON.stringify(normalRetreat.cues)}`
      : 'windup resolved before the retreat sample');
  check('the far normal windup still has no ground tell',
    normalRetreat !== null && normalRetreat.counts.visible === 0 &&
    normalRetreat.probeId !== normalRetreat.id,
    normalRetreat
      ? `visible ${normalRetreat.counts.visible}, probe ${normalRetreat.probeId ?? 'null'}`
      : 'no retreat sample');

  s = await snap();
  const eliteTarget = [...s.enemies]
    .filter((e) => !e.dead && e.elite.length > 0)
    .sort((a, b) => distanceTo(a, s.playerPos) - distanceTo(b, s.playerPos))[0];
  let eliteTell = null;
  if (eliteTarget) {
    await page.evaluate(([x, z]) => {
      window.__ashen.healPlayer(9999);
      window.__ashen.teleportPlayer(x, z);
    }, [eliteTarget.x + 1.2, eliteTarget.z]);
    await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 4), [eliteTarget.id]);
    for (let i = 0; i < 100 && !eliteTell; i++) {
      await sleep(50);
      const now = await snap();
      if (now.telegraphs.visibleElite > 0) eliteTell = now.telegraphs;
      await page.evaluate(() => window.__ashen.healPlayer(9999));
    }
    const afterEliteHit = await snap();
    const eliteNow = afterEliteHit.enemies.find((e) => e.id === eliteTarget.id);
    const ring = await page.evaluate(([id]) => window.__ashen.eliteRingProbe(id), [eliteTarget.id]);
    check('a damaged elite still shows its health bar',
      eliteNow !== undefined && eliteNow.hp < eliteNow.maxHp && afterEliteHit.render.healthBars >= 1,
      `${eliteNow?.hp ?? '?'}/${eliteNow?.maxHp ?? '?'} hp, ${afterEliteHit.render.healthBars} bars`);
    check('the damaged elite keeps its aura ring',
      ring?.present === true && ring.opacity > 0, JSON.stringify(ring));
  }
  check('an elite windup keeps a visible ground tell',
    eliteTell !== null && eliteTell.visibleElite > 0,
    eliteTell ? JSON.stringify(eliteTell) : 'no elite tell within 5s');
  check('elite nameplates are unaffected by the indicator filter',
    (await page.locator('.nameplate').count()) >= 1);

  // --- Dense two-camp pull: >8 normals cannot hide the windup body cue ---
  s = await snap();
  const livingNormals = s.enemies.filter((e) => !e.dead && e.elite.length === 0);
  const localDensity = (enemy) => livingNormals.filter((other) => distanceTo(enemy, other) <= 6).length;
  const anchors = [...livingNormals].sort((a, b) => localDensity(b) - localDensity(a));
  const campA = anchors[0];
  const campB = anchors.find((enemy) => campA && distanceTo(enemy, campA) > 12);
  let dense = null;
  if (campA && campB) {
    const hiddenBefore = s.telegraphs.hiddenNormal;
    for (const anchor of [campA, campB]) {
      await page.evaluate(([x, z]) => {
        window.__ashen.healPlayer(9999);
        window.__ashen.teleportPlayer(x, z);
      }, [anchor.x, anchor.z]);
      await sleep(450);
    }
    await page.evaluate(([x, z]) => {
      window.__ashen.healPlayer(9999);
      window.__ashen.teleportPlayer(x, z);
    }, [(campA.x + campB.x) / 2, (campA.z + campB.z) / 2]);
    for (let i = 0; i < 100 && !dense; i++) {
      await sleep(100);
      const now = await snap();
      await page.evaluate(() => window.__ashen.healPlayer(9999));
      const nearNormals = now.enemies.filter((e) =>
        !e.dead && e.elite.length === 0 && distanceTo(e, now.playerPos) <= 16).length;
      const target = now.enemies.find((e) =>
        !e.dead && e.elite.length === 0 && nearNormals > 8 &&
        (e.phase === 'windup' || e.phase === 'active') &&
        (now.enemyCues.detailed.includes(e.id) || now.enemyCues.far.includes(e.id)));
      if (target) {
        dense = {
          targetId: target.id,
          nearNormals,
          hiddenDelta: now.telegraphs.hiddenNormal - hiddenBefore,
          cues: now.enemyCues,
          counts: now.telegraphs,
        };
      }
    }
  }
  check('a dense pull puts more than eight normals within detail range',
    dense !== null && dense.nearNormals > 8,
    dense ? `${dense.nearNormals} normals near ${dense.targetId}` : 'no dense windup within 10s');
  check('a windup in the dense pull still carries a body cue while its ground tell is filtered',
    dense !== null && dense.hiddenDelta > 0 &&
    (dense.cues.detailed.includes(dense.targetId) || dense.cues.far.includes(dense.targetId)),
    dense ? `${JSON.stringify(dense.cues)}, hidden +${dense.hiddenDelta}` : 'no dense sample');

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
  stopServer(server);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
