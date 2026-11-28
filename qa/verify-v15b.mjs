/**
 * v1.5/moor save v8 browser QA: prove the live export carries 16 moor camp
 * slots (3 active) and 3 ossuary slots with no legacy objectives field, a live
 * zero-camp Warden checkpoint is valid, a completed v7 save migrates with all
 * camp flags reset while boss flags are preserved, a v7 zero-camp boss save is
 * still rejected at the v7 stage, a v8 zero-camp boss save is accepted, and a
 * normal v8 checkpoint survives reload.
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

/** Read a raw slot body without going through the game's migration path. */
async function readRawSave(page, slot) {
  const raw = await page.evaluate(
    (slotIndex) => localStorage.getItem(`ashen-vale:save:${slotIndex}`),
    slot,
  );
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const MOOR_SLOTS = 16;
const OSSUARY_SLOTS = 3;

/** Exact v8 progress shape: 16 moor slots and 3 ossuary slots. */
function hasZoneProgressShape(save) {
  if (!save || typeof save !== 'object' || !save.progress || typeof save.progress !== 'object') return false;
  const ids = Object.keys(save.progress).sort();
  if (ids.length !== 2 || ids[0] !== 'ashen-moor' || ids[1] !== 'drowned-ossuary') return false;
  return ids.every((id) => {
    const progress = save.progress[id];
    const expected = id === 'ashen-moor' ? MOOR_SLOTS : OSSUARY_SLOTS;
    return Boolean(progress)
      && typeof progress === 'object'
      && Object.keys(progress).length === 3
      && Array.isArray(progress.campsCleared)
      && progress.campsCleared.length === expected
      && progress.campsCleared.every((flag) => typeof flag === 'boolean')
      && typeof progress.bossSpawned === 'boolean'
      && typeof progress.bossDefeated === 'boolean';
  });
}

function isEmptyProgress(progress, slots) {
  return Boolean(progress)
    && Array.isArray(progress.campsCleared)
    && progress.campsCleared.length === slots
    && progress.campsCleared.every((flag) => flag === false)
    && progress.bossSpawned === false
    && progress.bossDefeated === false;
}

const moorSlots = (...cleared) =>
  Array.from({ length: MOOR_SLOTS }, (_, index) => cleared.includes(index));

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
    // 1. New game: the exported save is a v8 both-zone shape
    // ------------------------------------------------------------------
    await page.click('[data-action="new-game"]');
    await sleep(200);
    await page.click('[data-class="marauder"]');
    await page.click('[data-action="begin"]');
    await waitForPlaying(page);

    const fresh = await exportSave();
    check('new-game export is schema v8', fresh.version === 8, `version ${fresh.version}`);
    check('new-game export names the Ashen Moor', fresh.zoneId === 'ashen-moor',
      `zoneId ${String(fresh.zoneId)}`);
    check('new-game export carries a valid zone seed',
      Number.isInteger(fresh.zoneSeed) && fresh.zoneSeed >= 0,
      `zoneSeed ${String(fresh.zoneSeed)}`);

    const zoneKeys = fresh.progress && typeof fresh.progress === 'object'
      ? Object.keys(fresh.progress).sort()
      : [];
    check('new-game export has progress for exactly both zones',
      zoneKeys.length === 2 && zoneKeys[0] === 'ashen-moor' && zoneKeys[1] === 'drowned-ossuary',
      zoneKeys.join(', ') || 'missing progress');

    check('the moor carries 16 slots and the ossuary 3',
      hasZoneProgressShape(fresh),
      JSON.stringify(zoneKeys.map((id) => fresh.progress[id]?.campsCleared?.length)));

    check('new-game export starts with empty progress in both zones',
      zoneKeys.length === 2
      && isEmptyProgress(fresh.progress['ashen-moor'], MOOR_SLOTS)
      && isEmptyProgress(fresh.progress['drowned-ossuary'], OSSUARY_SLOTS),
      JSON.stringify(zoneKeys.map((id) => fresh.progress[id])));

    check('the v8 export carries no legacy objectives field', !('objectives' in fresh),
      Object.keys(fresh).filter((key) => key === 'objectives').join(', ') || 'absent');

    // ------------------------------------------------------------------
    // 2. Zero-camp v8 checkpoint: the end-arena Warden survives save/reload
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      const current = window.__ashen.snapshot();
      window.__ashen.teleportPlayer(current.arena.x, current.arena.z);
    });
    await page.waitForFunction(() => {
      const current = window.__ashen.snapshot();
      return current.objectives.bossSpawned && !current.objectives.bossDefeated;
    }, null, { timeout: 5000 });
    await sleep(300);
    s = await snap();
    check('entering the end arena wakes the Warden with zero camps cleared',
      s.objectives.campsCleared === 0
      && s.objectives.campsTotal === 3
      && s.objectives.bossSpawned === true
      && s.objectives.bossDefeated === false,
      JSON.stringify(s.objectives));

    await page.keyboard.press('Escape');
    await page.locator('[data-action="save-slots"]').waitFor({ state: 'visible' });
    await page.click('[data-action="save-slots"]');
    await sleep(250);
    await page.locator('.save-slot[data-slot="0"] .save-slot__body').click();
    await sleep(450);
    s = await saves();
    check('the normal checkpoint writes slot 1 with the active three-camp total and zero clears',
      s.slots[0].status === 'ok' && s.slots[0].campsCleared === 0 && s.slots[0].campsTotal === 3,
      `${s.slots[0].status}, camps ${s.slots[0].campsCleared}/${s.slots[0].campsTotal}`);

    const slotBody = await readRawSave(page, 0);
    const slotMoor = slotBody?.progress?.['ashen-moor'];
    const slotOssuary = slotBody?.progress?.['drowned-ossuary'];
    check('the normal checkpoint body is a complete v8 16-slot zero-camp live-boss save',
      Boolean(slotBody)
      && slotBody.version === 8
      && slotBody.zoneId === 'ashen-moor'
      && Number.isInteger(slotBody.zoneSeed)
      && slotBody.zoneSeed >= 0
      && hasZoneProgressShape(slotBody)
      && !('objectives' in slotBody)
      && Array.isArray(slotMoor?.campsCleared)
      && slotMoor.campsCleared.length === MOOR_SLOTS
      && slotMoor.campsCleared.every((flag) => flag === false)
      && slotMoor.bossSpawned === true
      && slotMoor.bossDefeated === false
      && Array.isArray(slotOssuary?.campsCleared)
      && slotOssuary.campsCleared.length === OSSUARY_SLOTS
      && slotOssuary.campsCleared.every((flag) => flag === false),
      slotBody
        ? JSON.stringify({
          version: slotBody.version,
          zoneId: slotBody.zoneId,
          zoneSeed: slotBody.zoneSeed,
          moor: slotMoor,
        })
        : 'missing slot body');

    await reload(page);
    check('reload brings back the title with Continue',
      await page.locator('[data-action="continue-run"]').isVisible());

    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const cardText = await page.locator('.save-slot[data-slot="0"]').innerText();
    check('the save card shows the zone and the active three-camp total',
      /The Ashen Moor/.test(cardText) && /Camps 0\/3/.test(cardText),
      cardText.replace(/\n/g, ' | '));
    await page.screenshot({ path: `${SHOTS}v15b-save-card.png` });
    await page.locator('[data-save-close]').click();
    await sleep(200);

    await page.click('[data-action="continue-run"]');
    await waitForPlaying(page);
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    s = await snap();
    check('Continue restores the zero-camp v8 boss progress',
      s.objectives.campsCleared === 0 && s.objectives.campsTotal === 3 && s.objectives.bossSpawned === true,
      JSON.stringify(s.objectives));

    const liveWardens = s.enemies.filter((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    check('Continue restores the live Warden and leaves it undefeated',
      s.objectives.bossDefeated === false && liveWardens.length === 1,
      `${liveWardens.length} live warden(s), bossDefeated ${s.objectives.bossDefeated}`);

    const thresholdDistance = Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z);
    check('Continue places the hero at the arena threshold',
      s.arena.radius > 0
      && thresholdDistance < s.arena.radius
      && thresholdDistance > s.arena.radius - 2,
      `distance ${thresholdDistance.toFixed(2)} / radius ${s.arena.radius}`);

    const v8Base = await exportSave();
    check('the live v8 export has 16 empty moor slots and 3 ossuary slots',
      v8Base.version === 8
      && v8Base.progress['ashen-moor'].campsCleared.length === MOOR_SLOTS
      && v8Base.progress['ashen-moor'].campsCleared.every((flag) => flag === false)
      && v8Base.progress['ashen-moor'].bossSpawned === true,
      `camps ${JSON.stringify(v8Base.progress['ashen-moor'].campsCleared)}`);

    // ------------------------------------------------------------------
    // 3. A completed v7 save migrates 3 -> 16 with the Warden dead
    // ------------------------------------------------------------------
    const v7Completed = {
      ...v8Base,
      version: 7,
      progress: {
        'ashen-moor': {
          campsCleared: [true, true, true],
          bossSpawned: true,
          bossDefeated: true,
        },
        'drowned-ossuary': {
          campsCleared: [false, false, false],
          bossSpawned: false,
          bossDefeated: false,
        },
      },
      savedAt: Date.now() + 5000,
    };
    check('the v7 fixture is a real v7 shape',
      v7Completed.version === 7
      && Object.keys(v7Completed.progress).sort().join(',') === 'ashen-moor,drowned-ossuary'
      && v7Completed.progress['ashen-moor'].campsCleared.length === 3
      && v7Completed.progress['ashen-moor'].campsCleared.every(Boolean)
      && v7Completed.progress['drowned-ossuary'].campsCleared.length === 3,
      `version ${v7Completed.version}, moor ${JSON.stringify(v7Completed.progress['ashen-moor'])}`);

    await writeRawSave(page, 1, v7Completed);
    await reload(page);

    s = await saves();
    check('the completed v7 fixture migrates as a valid slot with flags reset',
      s.slots[1].status === 'ok' && s.slots[1].campsCleared === 0 && s.slots[1].campsTotal === 3
      && s.slots[1].bossDefeated === true,
      `${s.slots[1].status}, camps ${s.slots[1].campsCleared}/${s.slots[1].campsTotal}, boss defeated ${s.slots[1].bossDefeated}`);

    await page.click('[data-action="continue-run"]');
    await waitForPlaying(page);
    s = await snap();
    check('a completed v7 save loads into play', s.mode === 'playing' && !s.dead,
      `mode ${s.mode}, dead ${s.dead}`);
    check('v7 -> v8 restores the optional camps at 0/3',
      s.objectives.campsCleared === 0 && s.objectives.campsTotal === 3,
      `${s.objectives.campsCleared}/${s.objectives.campsTotal}`);
    check('v7 -> v8 restores bossDefeated with zero camps', s.objectives.bossDefeated === true,
      JSON.stringify(s.objectives));
    check('the defeated Warden is not spawned live',
      !s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead),
      `${s.enemies.filter((enemy) => enemy.type === 'ashen-warden').length} warden entries`);

    const hudZone = (await page.locator('[data-hud-zone]').textContent()).trim();
    check('the migrated run plays in The Ashen Moor', hudZone === 'The Ashen Moor', hudZone);
    await page.screenshot({ path: `${SHOTS}v15b-v7-completed.png` });

    const migrated = await exportSave();
    check('a migrated v7 save exports as v8',
      migrated.version === 8 && migrated.zoneId === 'ashen-moor' && !('objectives' in migrated),
      `version ${migrated.version}, zoneId ${migrated.zoneId}, objectives ${'objectives' in migrated}`);
    check('the migrated export carries 16 moor slots and 3 ossuary slots',
      hasZoneProgressShape(migrated)
      && Number.isInteger(migrated.zoneSeed)
      && migrated.zoneSeed >= 0,
      JSON.stringify(Object.keys(migrated.progress ?? {}).sort()));
    check('the migrated 3 -> 16 export resets every moor camp flag and preserves the boss',
      migrated.progress?.['ashen-moor']?.campsCleared?.length === MOOR_SLOTS
      && migrated.progress['ashen-moor'].campsCleared.every((flag) => flag === false)
      && migrated.progress['ashen-moor'].bossDefeated === true,
      JSON.stringify(migrated.progress?.['ashen-moor']));
    check('the migrated export pads the ossuary with 3 empty slots',
      isEmptyProgress(migrated.progress?.['drowned-ossuary'], OSSUARY_SLOTS),
      JSON.stringify(migrated.progress?.['drowned-ossuary']));

    // ------------------------------------------------------------------
    // 4. A v7 zero-camp boss gate is still corrupt at the v7 stage
    // ------------------------------------------------------------------
    const v7ZeroGate = JSON.parse(JSON.stringify(v7Completed));
    v7ZeroGate.progress['ashen-moor'] = {
      campsCleared: [false, false, false],
      bossSpawned: true,
      bossDefeated: true,
    };
    v7ZeroGate.savedAt = Date.now() + 10000;
    await writeRawSave(page, 2, v7ZeroGate);
    // Leave the v7 gate slot as the only save so a corrupt read cannot hide
    // behind the earlier valid checkpoints' backups.
    await page.evaluate(() => {
      for (const slot of [0, 1]) {
        localStorage.removeItem(`ashen-vale:save:${slot}`);
        localStorage.removeItem(`ashen-vale:save:${slot}:backup`);
      }
    });
    await reload(page);

    s = await saves();
    check('a v7 zero-camp boss slot is reported corrupt',
      s.slots[2].status === 'corrupt', s.slots[2].error ?? s.slots[2].status);
    check('the v7 zero-camp save is rejected by the frozen boss gate',
      /spawns the boss before the camps are cleared/i.test(s.slots[2].error ?? ''),
      s.slots[2].error ?? 'no error text');
    check('only the corrupt v7 slot remains',
      s.slots[0].status === 'empty' && s.slots[1].status === 'empty',
      s.slots.map((slot) => slot.status).join(', '));
    check('the title offers no Continue for a corrupt-only store',
      !(await page.locator('[data-action="continue-run"]').isVisible()));
    check('the game does not enter play from the v7 zero-camp save', (await snap()).mode === 'title',
      `mode ${(await snap()).mode}`);

    check('Load Game is still offered so the corrupt slot can be reclaimed',
      await page.locator('[data-action="load-game"]').isVisible());
    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const corruptText = await page.locator('.save-slot[data-slot="2"]').innerText();
    check('the save card explains the corrupt v7 save',
      /Corrupted/i.test(corruptText)
      && /spawns the boss before the camps are cleared/i.test(corruptText),
      corruptText.replace(/\n/g, ' | '));
    check('the corrupt v7 slot cannot be loaded',
      await page.locator('.save-slot[data-slot="2"] .save-slot__body').isDisabled());
    await page.screenshot({ path: `${SHOTS}v15b-v7-zero-gate.png` });
    await page.locator('[data-save-close]').click();
    await sleep(200);

    check('the game still has not entered play after the refused load',
      (await snap()).mode === 'title',
      `mode ${(await snap()).mode}`);

    // ------------------------------------------------------------------
    // 5. A v8 zero-camp boss save is valid and opens the portal
    // ------------------------------------------------------------------
    const v8ZeroCampBoss = JSON.parse(JSON.stringify(migrated));
    v8ZeroCampBoss.progress['ashen-moor'].campsCleared = moorSlots();
    v8ZeroCampBoss.progress['ashen-moor'].bossSpawned = true;
    v8ZeroCampBoss.progress['ashen-moor'].bossDefeated = true;
    v8ZeroCampBoss.savedAt = Date.now() + 15000;
    await writeRawSave(page, 2, v8ZeroCampBoss);
    await reload(page);

    s = await saves();
    check('a v8 boss save with zero camps is valid',
      s.slots[2].status === 'ok'
      && s.slots[2].campsCleared === 0
      && s.slots[2].campsTotal === 3
      && s.slots[2].bossDefeated === true,
      `${s.slots[2].status}, camps ${s.slots[2].campsCleared}/${s.slots[2].campsTotal}, boss defeated ${s.slots[2].bossDefeated}`);
    check('the title offers Continue for the zero-camp v8 boss save',
      await page.locator('[data-action="continue-run"]').isVisible());

    await page.click('[data-action="continue-run"]');
    await waitForPlaying(page);
    s = await snap();
    check('the zero-camp v8 boss save loads with the portal open',
      s.objectives.campsCleared === 0
      && s.objectives.bossDefeated === true
      && s.objectives.portalOpen === true,
      JSON.stringify(s.objectives));

    // ------------------------------------------------------------------
    // 6. A valid ossuary v8 save is displayed but refused by 5.0b loading
    // ------------------------------------------------------------------
    const ossuary = JSON.parse(JSON.stringify(migrated));
    ossuary.zoneId = 'drowned-ossuary';
    ossuary.zoneSeed = 20261123;
    ossuary.savedAt = Date.now() + 20000;
    await writeRawSave(page, 2, ossuary);
    await reload(page);

    s = await saves();
    check('the ossuary v8 fixture reads as a valid slot with its active 1 camp',
      s.slots[2].status === 'ok'
      && s.slots[2].zoneId === 'drowned-ossuary'
      && s.slots[2].campsCleared === 0
      && s.slots[2].campsTotal === 1,
      `${s.slots[2].status}, ${String(s.slots[2].zoneId)}, camps ${s.slots[2].campsCleared}/${s.slots[2].campsTotal}`);
    check('the title offers Continue for the ossuary save',
      await page.locator('[data-action="continue-run"]').isVisible());

    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const ossuaryCard = await page.locator('.save-slot[data-slot="2"]').innerText();
    check('the ossuary save card shows its zone and active camp total',
      /The Drowned Ossuary/.test(ossuaryCard) && /Camps 0\/1/.test(ossuaryCard),
      ossuaryCard.replace(/\n/g, ' | '));
    await page.screenshot({ path: `${SHOTS}v15b-ossuary-card.png` });

    await page.locator('.save-slot[data-slot="2"] .save-slot__body').click();
    const refusalToast = page.locator('.toast').filter({ hasText: /not available yet/i }).last();
    await refusalToast.waitFor({ state: 'visible' });
    const refusalText = (await refusalToast.innerText()).trim();
    check('loading the ossuary save is refused with the zone toast',
      /The Drowned Ossuary/.test(refusalText) && /not available yet/i.test(refusalText),
      refusalText);
    check('the ossuary load refusal leaves the game at the title',
      (await snap()).mode === 'title',
      `mode ${(await snap()).mode}`);
    await page.locator('[data-save-close]').click();
    await sleep(200);

    check('no console errors across the save v8 suite',
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
