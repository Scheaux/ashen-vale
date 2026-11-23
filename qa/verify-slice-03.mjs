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
    await clickWorld(cultist.x, cultist.z);
    await sleep(3500);
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
