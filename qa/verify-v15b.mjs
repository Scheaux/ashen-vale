/**
 * v1.5 5.0b save v7 browser QA: prove the live export carries per-zone
 * progress with no legacy objectives field, a completed v6 save migrates into
 * the Ashen Moor with the Warden defeated, a forged v7 empty-camp boss gate is
 * refused instead of normalized, and a normal v7 checkpoint survives reload.
 *
 * Run: node qa/verify-v15b.mjs   (starts `vite preview` on :4173 itself)
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Write a raw save body to a slot and drop its backup, isolating the read. */
async function writeRawSave(page, slot, save) {
  await page.evaluate(({ slotIndex, body }) => {
    localStorage.setItem(`ashen-vale:save:${slotIndex}`, body);
    localStorage.removeItem(`ashen-vale:save:${slotIndex}:backup`);
  }, { slotIndex: slot, body: JSON.stringify(save) });
}

async function reload(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
}

async function waitForPlaying(page) {
  await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 10000 });
  await sleep(400);
}

async function main() {
  let server = null;
  let browser = null;

  try {
    if (!process.env.QA_URL) server = startPreviewServer(4173);
    await waitForServer(BASE);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const snap = () => page.evaluate(() => window.__ashen.snapshot());
    const saves = () => page.evaluate(() => window.__ashen.saves());
    const exportSave = async () => JSON.parse(await page.evaluate(() => window.__ashen.exportSave()));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await reload(page);

    let s = await saves();
    check('a fresh browser starts with three empty slots',
      s.slots.length === 3 && s.slots.every((slot) => slot.status === 'empty'),
      JSON.stringify(s.slots.map((slot) => slot.status)));

    // ------------------------------------------------------------------
    // 1. New game: the exported save is a v7 both-zone shape
    // ------------------------------------------------------------------
    await page.click('[data-action="new-game"]');
    await sleep(200);
    await page.click('[data-class="marauder"]');
    await page.click('[data-action="begin"]');
    await waitForPlaying(page);

    const fresh = await exportSave();
    check('new-game export is schema v7', fresh.version === 7, `version ${fresh.version}`);
    check('new-game export names the Ashen Moor', fresh.zoneId === 'ashen-moor',
      `zoneId ${String(fresh.zoneId)}`);

    const zoneKeys = fresh.progress && typeof fresh.progress === 'object'
      ? Object.keys(fresh.progress).sort()
      : [];
    check('new-game export has progress for exactly both zones',
      zoneKeys.length === 2 && zoneKeys[0] === 'ashen-moor' && zoneKeys[1] === 'drowned-ossuary',
      zoneKeys.join(', ') || 'missing progress');

    const campLengths = zoneKeys.map((id) => fresh.progress[id]?.campsCleared?.length);
    check('both zones carry exactly three camp slots',
      campLengths.length === 2 && campLengths.every((length) => length === 3),
      JSON.stringify(campLengths));

    check('the v7 export carries no legacy objectives field', !('objectives' in fresh),
      Object.keys(fresh).filter((key) => key === 'objectives').join(', ') || 'absent');

    // ------------------------------------------------------------------
    // 2. Normal v7 checkpoint: camps + live Warden survive save/reload
    // ------------------------------------------------------------------
    await page.evaluate(() => window.__ashen.clearCamps());
    await page.waitForFunction(() => {
      const current = window.__ashen.snapshot();
      return current.objectives.campsCleared === 3
        && current.objectives.bossSpawned
        && !current.objectives.bossDefeated;
    }, null, { timeout: 5000 });
    await sleep(300);
    check('clearing every camp wakes the Warden before the checkpoint', true, '3/3 camps, boss awake');

    await page.keyboard.press('Escape');
    await page.locator('[data-action="save-slots"]').waitFor({ state: 'visible' });
    await page.click('[data-action="save-slots"]');
    await sleep(250);
    await page.locator('.save-slot[data-slot="0"] .save-slot__body').click();
    await sleep(450);
    s = await saves();
    check('the normal checkpoint writes slot 1 as v7 progress',
      s.slots[0].status === 'ok' && s.slots[0].campsCleared === 3 && s.slots[0].campsTotal === 3,
      `${s.slots[0].status}, camps ${s.slots[0].campsCleared}/${s.slots[0].campsTotal}`);

    await reload(page);
    check('reload brings back the title with Continue',
      await page.locator('[data-action="continue-run"]').isVisible());

    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const cardText = await page.locator('.save-slot[data-slot="0"]').innerText();
    check('the save card shows the zone and the three-slot total',
      /The Ashen Moor/.test(cardText) && /Camps 3\/3/.test(cardText),
      cardText.replace(/\n/g, ' | '));
    await page.screenshot({ path: `${SHOTS}v15b-save-card.png` });
    await page.locator('[data-save-close]').click();
    await sleep(200);

    await page.click('[data-action="continue-run"]');
    await waitForPlaying(page);
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    s = await snap();
    check('Continue restores the v7 camp and boss progress',
      s.objectives.campsCleared === 3 && s.objectives.campsTotal === 3 && s.objectives.bossSpawned === true,
      JSON.stringify(s.objectives));

    const v7Base = await exportSave();
    check('the live v7 export still has moor 3/3 progress',
      v7Base.version === 7
      && v7Base.progress['ashen-moor'].campsCleared.length === 3
      && v7Base.progress['ashen-moor'].campsCleared.every(Boolean),
      `camps ${JSON.stringify(v7Base.progress['ashen-moor'].campsCleared)}`);

    // ------------------------------------------------------------------
    // 3. A completed v6 save migrates into the moor with the Warden dead
    // ------------------------------------------------------------------
    const { zoneId: _zoneId, progress: _progress, ...v6Rest } = v7Base;
    const v6Completed = {
      ...v6Rest,
      version: 6,
      objectives: { campsCleared: [true, true, true], bossSpawned: true, bossDefeated: true },
      savedAt: Date.now() + 5000,
    };
    check('the v6 fixture is a real v6 shape',
      v6Completed.version === 6
      && !('zoneId' in v6Completed)
      && !('progress' in v6Completed)
      && Array.isArray(v6Completed.objectives?.campsCleared),
      `version ${v6Completed.version}, objectives ${JSON.stringify(v6Completed.objectives)}`);

    await writeRawSave(page, 1, v6Completed);
    await reload(page);

    s = await saves();
    check('the completed v6 fixture reads as a valid slot',
      s.slots[1].status === 'ok' && s.slots[1].campsCleared === 3 && s.slots[1].bossDefeated === true,
      `${s.slots[1].status}, camps ${s.slots[1].campsCleared}/${s.slots[1].campsTotal}, boss defeated ${s.slots[1].bossDefeated}`);

    await page.click('[data-action="continue-run"]');
    await waitForPlaying(page);
    s = await snap();
    check('a completed v6 save loads into play', s.mode === 'playing' && !s.dead,
      `mode ${s.mode}, dead ${s.dead}`);
    check('v6 -> v7 restores objectives at 3/3',
      s.objectives.campsCleared === 3 && s.objectives.campsTotal === 3,
      `${s.objectives.campsCleared}/${s.objectives.campsTotal}`);
    check('v6 -> v7 restores bossDefeated', s.objectives.bossDefeated === true,
      JSON.stringify(s.objectives));
    check('the defeated Warden is not spawned live',
      !s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead),
      `${s.enemies.filter((enemy) => enemy.type === 'ashen-warden').length} warden entries`);

    const hudZone = (await page.locator('[data-hud-zone]').textContent()).trim();
    check('the migrated run plays in The Ashen Moor', hudZone === 'The Ashen Moor', hudZone);
    await page.screenshot({ path: `${SHOTS}v15b-v6-completed.png` });

    const migrated = await exportSave();
    check('a migrated v6 save exports as v7',
      migrated.version === 7 && migrated.zoneId === 'ashen-moor' && !('objectives' in migrated),
      `version ${migrated.version}, zoneId ${migrated.zoneId}, objectives ${'objectives' in migrated}`);
    check('the migrated export carries moor 3/3 progress',
      migrated.progress?.['ashen-moor']?.campsCleared?.length === 3
      && migrated.progress['ashen-moor'].campsCleared.every(Boolean)
      && migrated.progress['ashen-moor'].bossDefeated === true,
      JSON.stringify(migrated.progress?.['ashen-moor']));

    // ------------------------------------------------------------------
    // 4. A forged v7 empty-camp boss gate is corrupt and refused
    // ------------------------------------------------------------------
    const forged = JSON.parse(JSON.stringify(migrated));
    forged.progress['ashen-moor'].campsCleared = [];
    forged.progress['ashen-moor'].bossSpawned = true;
    forged.progress['ashen-moor'].bossDefeated = true;
    forged.savedAt = Date.now() + 10000;
    await writeRawSave(page, 2, forged);
    // Leave the forged slot as the only save so a corrupt read cannot hide
    // behind the earlier valid checkpoints' backups.
    await page.evaluate(() => {
      for (const slot of [0, 1]) {
        localStorage.removeItem(`ashen-vale:save:${slot}`);
        localStorage.removeItem(`ashen-vale:save:${slot}:backup`);
      }
    });
    await reload(page);

    s = await saves();
    check('the forged empty-camp v7 slot is reported corrupt',
      s.slots[2].status === 'corrupt', s.slots[2].error ?? s.slots[2].status);
    check('the forged save is rejected for its impossible boss gate',
      /progress|camps/i.test(s.slots[2].error ?? ''),
      s.slots[2].error ?? 'no error text');
    check('only the forged slot remains',
      s.slots[0].status === 'empty' && s.slots[1].status === 'empty',
      s.slots.map((slot) => slot.status).join(', '));
    check('the title offers no Continue for a corrupt-only store',
      !(await page.locator('[data-action="continue-run"]').isVisible()));
    check('the game does not enter play from the forged save', (await snap()).mode === 'title',
      `mode ${(await snap()).mode}`);

    check('Load Game is still offered so the corrupt slot can be reclaimed',
      await page.locator('[data-action="load-game"]').isVisible());
    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const corruptText = await page.locator('.save-slot[data-slot="2"]').innerText();
    check('the save card explains the corrupt v7 save',
      /Corrupted/i.test(corruptText) && /invalid zone progress/i.test(corruptText),
      corruptText.replace(/\n/g, ' | '));
    check('the forged slot cannot be loaded',
      await page.locator('.save-slot[data-slot="2"] .save-slot__body').isDisabled());
    await page.screenshot({ path: `${SHOTS}v15b-forged-corrupt.png` });
    await page.locator('[data-save-close]').click();
    await sleep(200);

    check('the game still has not entered play after the refused load',
      (await snap()).mode === 'title',
      `mode ${(await snap()).mode}`);

    check('no console errors across the save v7 suite',
      consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('suite finished without throwing', false, String(err).split('\n')[0]);
    console.error(err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer(server);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
