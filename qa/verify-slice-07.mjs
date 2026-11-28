/**
 * Slice 7 browser QA: optional camps & the end-zone Ashen Warden. Verifies the
 * HUD marks camps optional, clearing every camp does not wake the Warden,
 * entering the end arena does, the hero can retreat (no arena clamp), the
 * boss phases/adds still run, and the kill opens the portal and, because the
 * moor is the final campaign zone, the victory screen.
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

function distanceToCorridor(point, corridor) {
  let best = Infinity;
  for (let i = 0; i < corridor.points.length - 1; i++) {
    const a = corridor.points[i];
    const b = corridor.points[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const lengthSq = vx * vx + vz * vz;
    const t = lengthSq > 0
      ? Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.z - a.z) * vz) / lengthSq))
      : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + vx * t), point.z - (a.z + vz * t)));
  }
  return best;
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

  // --- Objective tracker: camps are optional, the Warden waits at the end ---
  let s = await snap();
  check('the moor opens with 16 optional camps', s.objectives.campsTotal === 16 && s.objectives.campsCleared === 0,
    JSON.stringify(s.objectives));
  check('the moor exposes the linear corridor',
    s.corridor !== null && s.corridor.points.length === 4 && s.corridor.radius === 29,
    JSON.stringify(s.corridor));
  const openingObjective = await objectiveText();
  check('HUD tracker marks the camps optional', openingObjective.includes('Camps cleared (0/16) — optional'), openingObjective);
  check('HUD tracker points at the far-end Warden', openingObjective.includes('Reach the Ashen Warden at the far end'), openingObjective);
  check('the Warden is not in play yet', !s.enemies.some((e) => e.type === 'ashen-warden'));
  await page.screenshot({ path: `${SHOTS}60-objectives.png` });

  // --- Camps clear, but they no longer gate the Warden ---
  await page.evaluate(() => window.__ashen.clearCamps());
  await sleep(300);
  s = await snap();
  check('clearing every camp completes the optional camp track', s.objectives.campsCleared === 16,
    JSON.stringify(s.objectives));
  check('camps alone do not wake the Warden', !s.objectives.bossSpawned &&
    !s.enemies.some((e) => e.type === 'ashen-warden' && !e.dead), JSON.stringify(s.objectives));
  check('the portal stays sealed while the Warden sleeps',
    s.objectives.portalOpen === false && s.portal?.open === false,
    JSON.stringify({ objectives: s.objectives, portal: s.portal }));

  // --- Entering the end arena wakes the Warden ---
  const beforeSpawn = s.playerPos;
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [s.arena.x, s.arena.z]);
  await sleep(400);
  s = await snap();
  check('entering the end arena wakes the Warden', s.objectives.bossSpawned === true, JSON.stringify(s.objectives));
  const boss = s.enemies.find((e) => e.type === 'ashen-warden' && !e.dead);
  check('the Ashen Warden waits in the far-end arena', !!boss &&
    Math.hypot(boss.x - s.arena.x, boss.z - s.arena.z) <= s.arena.radius + 1, JSON.stringify({ boss, arena: s.arena }));
  check('the Warden spawn does not move the hero',
    Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z) < 0.1,
    JSON.stringify({ before: beforeSpawn, after: s.playerPos, arena: s.arena }));
  check('tracker flips to the boss objective', (await objectiveText()).includes('Slay the Ashen Warden'));

  // --- Phase transitions: hp gates, adds, telegraphs ---
  await page.evaluate(([id, amount]) => window.__ashen.hurtEnemy(id, amount), [boss.id, 300]);
  await sleep(300);
  s = await snap();
  const bossNow = s.enemies.find((e) => e.id === boss.id);
  const adds = s.enemies.filter((e) => e.id.startsWith('add-') && !e.dead);
  check('dropping the Warden past 66% enters phase 2', bossNow.bossPhase === 1, `phase ${bossNow.bossPhase}`);
  check('phase 2 calls minion adds', adds.length >= 3, `${adds.length} adds`);

  // Fight from inside the arena for a clean screenshot.
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [s.arena.x, s.arena.z + 5]);
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}61-boss-fight.png` });

  // --- No arena clamp: the hero can retreat down the moor ---
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [s.arena.x, s.arena.z + 24]);
  await sleep(900);
  s = await snap();
  const distToArena = Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z);
  check('the Warden fight does not clamp the hero to the arena', distToArena > s.arena.radius + 1,
    `distance ${distToArena.toFixed(1)} of ${s.arena.radius}`);
  check('the hero is still inside the corridor after retreating',
    s.corridor !== null && distanceToCorridor(s.playerPos, s.corridor) <= s.corridor.radius,
    `corridor distance ${s.corridor ? distanceToCorridor(s.playerPos, s.corridor).toFixed(1) : 'n/a'} / ${s.corridor?.radius}`);

  // --- The kill, the portal and the victory loop ---
  await page.evaluate(([id, amount]) => window.__ashen.hurtEnemy(id, amount), [boss.id, 99999]);
  await sleep(400);
  s = await snap();
  const victoryVisible = await page.locator('[data-screen="victory"]').isVisible();
  check('slaying the Warden opens the victory screen', victoryVisible);
  check('slaying the Warden opens the portal', s.objectives.bossDefeated === true && s.objectives.portalOpen === true,
    JSON.stringify(s.objectives));
  check('the Warden’s Gate toast is announced',
    (await page.locator('.toast').filter({ hasText: /Gate opens/ }).count()) > 0);
  const victoryKills = await page.locator('[data-victory-kills]').textContent();
  check('victory summary counts the run', Number(victoryKills) > 0, `${victoryKills} kills`);
  await page.screenshot({ path: `${SHOTS}62-victory.png` });

  await page.click('[data-action="continue"]');
  await sleep(300);
  s = await snap();
  check('Continue closes the loop back into play', !(await page.locator('[data-screen="victory"]').isVisible()) && s.mode === 'playing');
  check('Continue keeps the portal open', s.objectives.portalOpen === true);

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
