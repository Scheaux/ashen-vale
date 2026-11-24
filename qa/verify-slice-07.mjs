/**
 * Slice 7 browser QA: zone objectives & the Ashen Warden. Verifies the HUD
 * objective tracker, camp clearing unlocking the boss, the boss spawning in
 * its arena, hp-driven phase transitions with minion adds and their
 * telegraphs, the arena boundary during the fight, and the victory screen
 * closing the loop back to play/title.
 *
 * Run: node qa/verify-slice-07.mjs   (starts `vite preview` on :4173 itself)
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
  const objectiveText = () => page.locator('.objectives__list').innerText();

  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(250);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(800);

  // --- Objective tracker: the zone opens with camps to clear ---
  let s = await snap();
  check('the moor opens with three camps to clear', s.objectives.campsTotal === 3 && s.objectives.campsCleared === 0,
    JSON.stringify(s.objectives));
  check('HUD tracker shows the camp objective', (await objectiveText()).includes('Clear the camps (0/3)'));
  check('the Warden is not in play yet', !s.enemies.some((e) => e.type === 'ashen-warden'));
  await page.screenshot({ path: `${SHOTS}60-objectives.png` });

  // --- Camps clear -> the Warden wakes ---
  await page.evaluate(() => window.__ashen.clearCamps());
  await sleep(300);
  s = await snap();
  check('clearing every camp completes the first objective', s.objectives.campsCleared === 3 && s.objectives.bossSpawned,
    JSON.stringify(s.objectives));
  const boss = s.enemies.find((e) => e.type === 'ashen-warden' && !e.dead);
  check('the Ashen Warden spawns in its arena', !!boss &&
    Math.hypot(boss.x - s.arena.x, boss.z - s.arena.z) <= s.arena.radius + 1, JSON.stringify({ boss, arena: s.arena }));
  check('tracker flips to the boss objective', (await objectiveText()).includes('Slay the Ashen Warden'));

  // --- Phase transitions: hp gates, adds, telegraphs ---
  await page.evaluate(([id, amount]) => window.__ashen.hurtEnemy(id, amount), [boss.id, 300]);
  await sleep(300);
  s = await snap();
  const bossNow = s.enemies.find((e) => e.id === boss.id);
  const adds = s.enemies.filter((e) => e.id.startsWith('add-') && !e.dead);
  check('dropping the Warden past 66% enters phase 2', bossNow.bossPhase === 1, `phase ${bossNow.bossPhase}`);
  check('phase 2 calls minion adds', adds.length >= 3, `${adds.length} adds`);

  // Move into the arena and fight from inside; the boundary holds the hero.
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [s.arena.x, s.arena.z + 5]);
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}61-boss-fight.png` });

  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [s.arena.x, s.arena.z + 24]);
  await page.mouse.click(720, 200); // walk away, out of the arena
  await sleep(900);
  s = await snap();
  const distToArena = Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z);
  check('the arena boundary holds the hero during the fight', distToArena <= s.arena.radius + 1,
    `distance ${distToArena.toFixed(1)} of ${s.arena.radius}`);

  // --- The kill and the victory loop ---
  await page.evaluate(([id, amount]) => window.__ashen.hurtEnemy(id, amount), [boss.id, 99999]);
  await sleep(400);
  const victoryVisible = await page.locator('[data-screen="victory"]').isVisible();
  check('slaying the Warden opens the victory screen', victoryVisible);
  const victoryKills = await page.locator('[data-victory-kills]').textContent();
  check('victory summary counts the run', Number(victoryKills) > 0, `${victoryKills} kills`);
  await page.screenshot({ path: `${SHOTS}62-victory.png` });

  await page.click('[data-action="continue"]');
  await sleep(300);
  s = await snap();
  check('Continue closes the loop back into play', !(await page.locator('[data-screen="victory"]').isVisible()) && s.mode === 'playing');

  // --- The defeat screen still closes back to retry/title ---
  await page.evaluate(() => window.__ashen.hurtPlayer(99999));
  await sleep(300);
  check('the defeat screen offers retry and title',
    await page.locator('[data-action="respawn"]').isVisible() &&
    await page.locator('[data-screen="death"] [data-action="quit"]').isVisible());
  await page.click('[data-action="respawn"]');
  await sleep(300);
  check('retry returns to the cleared moor', (await snap()).mode === 'playing');

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
