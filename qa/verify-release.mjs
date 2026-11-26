/**
 * Slice 9 release QA: the full playable loop plus the polish gates.
 *
 * Verifies fresh start -> movement -> combat feedback (health bars, heavy
 * numbers, damage vignette) -> level/passives -> camp clear -> boss phases ->
 * victory -> save/quit -> reload -> Continue, plus the desktop render budget,
 * adaptive resolution on a high-DPI device, and reduced-motion boot.
 *
 * Run: node qa/verify-release.mjs   (starts `vite preview` on :4173 itself)
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DRAW_BUDGET = 320;
const TRIANGLE_BUDGET = 260_000;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`Server not reachable at ${url}`);
}

async function startRun(page, classId = 'marauder') {
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(200);
  await page.click(`[data-class="${classId}"]`);
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(900);
}

async function nearestEnemy(page) {
  return page.evaluate(() => {
    const snap = window.__ashen.snapshot();
    const p = snap.playerPos;
    return snap.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  });
}

async function sampleFrames(page, frames = 48) {
  return page.evaluate(async (frames) => {
    const times = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const frame = (now) => {
        times.push(now - last);
        last = now;
        if (times.length < frames) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    const values = times.slice(6).sort((a, b) => a - b);
    return Math.round(values[Math.floor(values.length * 0.5)] * 10) / 10;
  }, frames);
}

async function main() {
  let server = null;
  if (!process.env.QA_URL) server = startPreviewServer(4173);
  await waitForServer(BASE);

  const browser = await chromium.launch();

  // ---------- Main playthrough ----------
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const snap = () => page.evaluate(() => window.__ashen.snapshot());
  const saves = () => page.evaluate(() => window.__ashen.saves());

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);
  check('the release title renders', await page.locator('.game-title').isVisible());
  check('a fresh release has no Continue', !(await page.locator('[data-action="continue-run"]').isVisible()));
  await page.screenshot({ path: `${SHOTS}80-release-title.png` });

  await startRun(page, 'marauder');
  let s = await snap();
  check('a new run enters play', s.mode === 'playing');
  check('a new run starts with one active skill', s.skills.filter((skill) => skill.id !== null).length === 1 &&
    s.skills.find((skill) => skill.slot === 'q')?.id !== null, JSON.stringify(s.skills));
  check('the hotbar shows RMB + QWERF', (await page.locator('.slot').count()) === 6 &&
    (await page.locator('.slot--empty').count()) === 5);
  check('the first slot autosaves the run', (await saves()).activeSlot === 0);
  await page.screenshot({ path: `${SHOTS}81-release-combat.png` });

  // Movement still responds.
  const before = s.playerPos;
  await page.mouse.click(720, 260);
  await sleep(700);
  s = await snap();
  check('click-to-move still responds', Math.hypot(s.playerPos.x - before.x, s.playerPos.z - before.z) > 0.5,
    `moved ${Math.hypot(s.playerPos.x - before.x, s.playerPos.z - before.z).toFixed(1)}`);

  // Combat feedback: damaged health bar, heavy damage number, damage vignette.
  const target = await nearestEnemy(page);
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z + 4), [target.x, target.z]);
  await page.evaluate(([id, amount]) => window.__ashen.hurtEnemy(id, amount), [target.id, Math.round(target.maxHp * 0.45)]);
  await sleep(250);
  s = await snap();
  check('damaged enemies show a health bar', s.render.healthBars >= 1, `${s.render.healthBars} bars`);
  check('the detailed-rig budget holds', s.render.detailedEnemies <= 8, `${s.render.detailedEnemies} rigs`);

  await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 30), [target.id]);
  await sleep(100);
  const heavy = await page.locator('.floating-text--heavy').count();
  check('big hits use the heavy damage treatment', heavy > 0, `${heavy} heavy numbers`);

  await page.evaluate(() => window.__ashen.flashDamage('health', 0.9));
  await sleep(60);
  const vignette = await page.evaluate(() => {
    const el = document.querySelector('[data-damage-vignette]');
    return {
      health: el.classList.contains('damage-vignette--health'),
      running: el.getAnimations().some((animation) => animation.playState === 'running' || Number(animation.currentTime) >= 0),
      tint: getComputedStyle(el).backgroundImage.includes('rgba(184, 34, 25'),
    };
  });
  check('health damage plays the red edge vignette', vignette.health && vignette.running && vignette.tint,
    JSON.stringify(vignette));
  await page.screenshot({ path: `${SHOTS}81-release-combat.png` });

  // Render budget in a live camp fight (headless timing is not a GPU benchmark).
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  const frameMs = await sampleFrames(page);
  s = await snap();
  check('camp-fight draw calls stay within the desktop budget', s.render.drawCalls <= DRAW_BUDGET,
    `${s.render.drawCalls} <= ${DRAW_BUDGET}`);
  check('camp-fight triangles stay within the desktop budget', s.render.triangles <= TRIANGLE_BUDGET,
    `${s.render.triangles} <= ${TRIANGLE_BUDGET}`);
  console.log(`  (headless software-render p50 ${frameMs} ms — recorded, not asserted)`);

  // Progression + passive choice.
  await page.evaluate(() => window.__ashen.grantXp(5000));
  await sleep(400);
  await page.keyboard.press('p');
  await sleep(250);
  await page.click('[data-node="o1"]');
  await sleep(200);
  await page.keyboard.press('Escape');
  s = await snap();
  check('the release build levels and allocates passives', s.level >= 5 && s.passives.allocated.includes('o1'),
    `level ${s.level}, passives ${s.passives.allocated.join(',')}`);
  check('levels grant skill points', s.skillPoints.available >= 6 && s.skillPoints.total === s.level - 1,
    JSON.stringify(s.skillPoints));

  await page.keyboard.press('Escape');
  await sleep(250);
  check('the pause menu names the version and autosave slot',
    (await page.locator('[data-pause-save]').innerText()).toLowerCase().includes('v1.4') &&
    (await page.locator('[data-pause-save]').innerText()).toLowerCase().includes('slot 1'));
  await page.keyboard.press('Escape');
  await sleep(250);

  // Camps -> boss -> phases -> victory.
  await page.evaluate(() => window.__ashen.clearCamps());
  await sleep(700);
  s = await snap();
  check('clearing the camps wakes the Warden', s.objectives.campsCleared === 3 && s.objectives.bossSpawned);
  const boss = s.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
  check('the Warden is in its arena', !!boss &&
    Math.hypot(boss.x - s.arena.x, boss.z - s.arena.z) <= s.arena.radius + 1);
  if (boss) {
    await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 300), [boss.id]);
    await sleep(400);
    s = await snap();
    check('the Warden phase transition calls adds', s.enemies.some((enemy) => enemy.bossPhase === 1) &&
      s.enemies.some((enemy) => enemy.id.startsWith('add-') && !enemy.dead));
    await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 99999), [boss.id]);
    await sleep(500);
  }
  check('the victory screen closes the campaign', await page.locator('[data-screen="victory"]').isVisible());
  await page.screenshot({ path: `${SHOTS}82-release-victory.png` });
  check('victory checkpoints the completed zone', (await saves()).slots[0].bossDefeated === true);

  // Save / quit / reload / Continue.
  await page.click('[data-screen="victory"] [data-action="quit"]');
  await sleep(500);
  check('quitting to title keeps a Continue target', await page.locator('[data-action="continue-run"]').isVisible());
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
  await page.click('[data-action="continue-run"]');
  await sleep(900);
  s = await snap();
  check('Continue restores the completed run', s.mode === 'playing' && s.objectives.bossDefeated === true &&
    s.level >= 5 && s.passives.allocated.includes('o1'), JSON.stringify({
    mode: s.mode,
    level: s.level,
    objectives: s.objectives,
    passives: s.passives.allocated,
  }));
  check('the defeated Warden stays gone', !s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead));
  await page.screenshot({ path: `${SHOTS}83-release-continue.png` });

  check('no console errors in the main playthrough', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  // ---------- High-DPI adaptive resolution ----------
  const hdContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const hdPage = await hdContext.newPage();
  const hdErrors = [];
  hdPage.on('console', (msg) => {
    if (msg.type() === 'error') hdErrors.push(msg.text());
  });
  hdPage.on('pageerror', (err) => hdErrors.push(String(err)));
  await hdPage.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);
  await startRun(hdPage, 'ranger');
  const hdTarget = await nearestEnemy(hdPage);
  await hdPage.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z + 5), [hdTarget.x, hdTarget.z]);
  await sleep(7000);
  await hdPage.evaluate(() => window.__ashen.healPlayer(9999));
  const hdFrameMs = await sampleFrames(hdPage, 32);
  const hd = await hdPage.evaluate(() => window.__ashen.snapshot());
  check('a high-DPI device starts with a 2x pixel-ratio cap', hd.render.pixelRatioCap === 2,
    `cap ${hd.render.pixelRatioCap}`);
  check('adaptive resolution stays in its 1..cap range', hd.render.pixelRatio >= 1 && hd.render.pixelRatio <= 2,
    `ratio ${hd.render.pixelRatio}`);
  check('adaptive resolution responds to a slow frame budget',
    hdFrameMs <= 30 || hd.render.pixelRatio < hd.render.pixelRatioCap,
    `p50 ${hdFrameMs} ms, ratio ${hd.render.pixelRatio}/${hd.render.pixelRatioCap}`);
  check('the high-DPI render also holds the draw budget', hd.render.drawCalls <= DRAW_BUDGET,
    `${hd.render.drawCalls} <= ${DRAW_BUDGET} (quality window ${hd.render.qualityWindow}s / ${hd.render.qualityFrames} frames)`);
  await hdPage.screenshot({ path: `${SHOTS}84-release-quality.png` });
  check('no console errors in the high-DPI run', hdErrors.length === 0, hdErrors.slice(0, 3).join(' | '));

  // ---------- Reduced motion ----------
  const rmContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rmPage = await rmContext.newPage();
  const rmErrors = [];
  rmPage.on('pageerror', (err) => rmErrors.push(String(err)));
  await rmPage.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);
  await startRun(rmPage, 'witch');
  const rm = await rmPage.evaluate(() => window.__ashen.snapshot());
  check('reduced motion is detected and recorded', rm.render.reducedMotion === true);
  await rmPage.evaluate(() => window.__ashen.flashDamage('shield', 0.6));
  await rmPage.keyboard.press('q');
  await sleep(500);
  check('reduced-motion play still runs combat', (await rmPage.evaluate(() => window.__ashen.snapshot())).mode === 'playing');
  check('no page errors under reduced motion', rmErrors.length === 0, rmErrors.slice(0, 3).join(' | '));

  await context.close();
  await hdContext.close();
  await rmContext.close();
  await browser.close();
  stopServer(server);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
