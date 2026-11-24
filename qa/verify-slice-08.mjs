/**
 * Slice 8 browser QA: save slots. Verifies the fresh title has no Continue,
 * a new run autosaves into the first slot, passive/camp progress is captured
 * at milestones, Continue restores the run after a reload (level, passives,
 * camp and boss state), the pause menu saves/loads slots, and a corrupted
 * slot is reported and recoverable without a crash.
 *
 * Run: node qa/verify-slice-08.mjs   (starts `vite preview` on :4173 itself)
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

  const snap = () => page.evaluate(() => window.__ashen.snapshot());
  const saves = () => page.evaluate(() => window.__ashen.saves());

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);

  // --- Fresh title: no saves, so no Continue or Load ---
  let s = await saves();
  check('a fresh browser starts with three empty slots', s.slots.length === 3 && s.slots.every((slot) => slot.status === 'empty'),
    JSON.stringify(s.slots.map((slot) => slot.status)));
  check('storage is persistent in the browser', s.persistent === true);
  check('the fresh title has no Continue button', !(await page.locator('[data-action="continue-run"]').isVisible()));
  check('the fresh title has no Load Game button', !(await page.locator('[data-action="load-game"]').isVisible()));
  await page.screenshot({ path: `${SHOTS}70-title-fresh.png` });

  // --- A new run binds to the first empty slot and checkpoints ---
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(250);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(900);

  s = await saves();
  check('a new run autosaves into slot 1', s.activeSlot === 0 && s.slots[0].status === 'ok',
    `active ${s.activeSlot}, slot 1 ${s.slots[0].status}`);
  check('the checkpoint records the class and level', s.slots[0].classId === 'marauder' && s.slots[0].level === 1,
    `${s.slots[0].classId} lv ${s.slots[0].level}`);

  // --- Level-up and a passive allocation are captured at the next milestone ---
  await page.evaluate(() => window.__ashen.grantXp(5000));
  await sleep(400);
  await page.keyboard.press('p');
  await sleep(300);
  check('the passive tree opens for the build choice', await page.locator('.passive-panel').isVisible());
  await page.click('[data-node="o1"]');
  await sleep(250);
  await page.keyboard.press('Escape');
  await sleep(200);
  const leveled = await snap();
  check('the review fixture levels the exile', leveled.level >= 5, `level ${leveled.level}`);
  check('the passive allocation lands', leveled.passives.allocated.includes('o1'));

  await page.evaluate(() => window.__ashen.clearCamps());
  await sleep(500);
  s = await saves();
  check('clearing the camps checkpoints the objective', s.slots[0].campsCleared === 3 && s.slots[0].campsTotal === 3,
    `${s.slots[0].campsCleared}/${s.slots[0].campsTotal}`);
  check('the checkpoint records the awakened Warden', s.slots[0].bossSpawned === true);
  check('the checkpoint keeps the level and passive', s.slots[0].level >= 5 && s.slots[0].status === 'ok',
    `lv ${s.slots[0].level}`);
  await page.screenshot({ path: `${SHOTS}71-checkpoint-camps.png` });

  // --- Reload: Continue appears and restores the checkpoint ---
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  check('reload brings back the title with Continue', await page.locator('[data-action="continue-run"]').isVisible());
  const continueDetail = await page.locator('[data-title-continue-detail]').innerText();
  check('Continue names the exile and level', /Marauder/i.test(continueDetail) && /Level\s+\d+/i.test(continueDetail), continueDetail);
  check('the title offers Load Game once a slot exists', await page.locator('[data-action="load-game"]').isVisible());
  await page.screenshot({ path: `${SHOTS}72-title-continue.png` });

  await page.click('[data-action="load-game"]');
  await sleep(300);
  check('Load Game opens the slot screen', await page.locator('.save-screen').isVisible());
  check('the slot screen shows three cards', (await page.locator('.save-slot').count()) === 3);
  const slotOneText = await page.locator('.save-slot[data-slot="0"]').innerText();
  check('the occupied slot reads as a checkpoint', /Checkpoint/i.test(slotOneText) && /Marauder/i.test(slotOneText), slotOneText.replace(/\n/g, ' | '));
  await page.screenshot({ path: `${SHOTS}73-save-slots.png` });
  await page.locator('[data-save-close]').click();
  await sleep(200);
  check('the slot screen closes', !(await page.locator('.save-screen').isVisible()));

  await page.click('[data-action="continue-run"]');
  await sleep(900);
  s = await snap();
  const restored = await saves();
  check('Continue returns to play', s.mode === 'playing');
  check('Continue restores the level', s.level >= 5, `level ${s.level}`);
  check('Continue restores passive allocations', s.passives.allocated.includes('o1'), s.passives.allocated.join(','));
  check('Continue restores cleared camps and the boss', s.objectives.campsCleared === 3 && s.objectives.bossSpawned,
    JSON.stringify(s.objectives));
  check('the restored run stays bound to slot 1', restored.activeSlot === 0);
  await page.screenshot({ path: `${SHOTS}74-continue-restored.png` });

  // --- Pause menu: save to slot 2, then load slot 1 from pause ---
  await page.keyboard.press('Escape');
  await sleep(250);
  check('Escape opens the pause menu with save/load actions',
    await page.locator('[data-action="save-slots"]').isVisible() &&
    await page.locator('[data-action="load-slots"]').isVisible());
  check('the pause menu names the active autosave slot',
    (await page.locator('[data-pause-save]').innerText()).toLowerCase().includes('autosave slot 1'));
  await page.click('[data-action="save-slots"]');
  await sleep(250);
  check('Save Game opens the slot screen in save mode',
    (await page.locator('[data-save-title]').innerText()).toLowerCase().includes('save'));
  await page.locator('.save-slot[data-slot="1"] .save-slot__body').click();
  await sleep(400);
  s = await saves();
  check('saving from pause fills slot 2 and rebinds autosave', s.slots[1].status === 'ok' && s.activeSlot === 1,
    `active ${s.activeSlot}, slot 2 ${s.slots[1].status}`);
  await page.screenshot({ path: `${SHOTS}75-pause-save.png` });

  await page.click('[data-action="load-slots"]');
  await sleep(250);
  check('Load Game from pause lists both checkpoints', (await page.locator('.save-slot__body:not([disabled])').count()) === 2);
  await page.locator('.save-slot[data-slot="0"] .save-slot__body').click();
  await sleep(800);
  s = await saves();
  check('loading slot 1 from pause rebinds the run', s.activeSlot === 0);
  check('play resumes after a pause-menu load', (await snap()).mode === 'playing');

  // --- Boss kill checkpoints victory; Continue keeps the completed run ---
  const boss = (await snap()).enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
  check('the restored boss is present in its arena', !!boss);
  if (boss) await page.evaluate(([id, amount]) => window.__ashen.hurtEnemy(id, amount), [boss.id, 99999]);
  await sleep(500);
  check('the victory screen opens', await page.locator('[data-screen="victory"]').isVisible());
  s = await saves();
  check('victory checkpoints the defeated Warden', s.slots[0].bossDefeated === true);
  await page.click('[data-action="continue"]');
  await sleep(300);

  await page.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  await page.click('[data-action="continue-run"]');
  await sleep(800);
  s = await snap();
  const afterVictory = await saves();
  check('Continue after victory restores the completed zone', s.objectives.bossDefeated === true &&
    !s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead), JSON.stringify(s.objectives));
  check('the completed run remains in a slot', afterVictory.slots[0].status === 'ok' && afterVictory.slots[0].bossDefeated);

  // --- A torn primary write recovers the previous checkpoint from its backup ---
  // Overwrite slot 2 once so its previous body becomes the backup.
  await page.keyboard.press('Escape');
  await sleep(250);
  await page.click('[data-action="save-slots"]');
  await sleep(250);
  await page.locator('.save-slot[data-slot="1"] .save-slot__body').click();
  await sleep(400);
  await page.evaluate(() => localStorage.setItem('ashen-vale:save:1', '{"version":3,"classId":'));
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  s = await saves();
  check('a torn slot read recovers from its backup', s.slots[1].status === 'ok' && s.slots[1].recovered === true,
    JSON.stringify({ status: s.slots[1].status, recovered: s.slots[1].recovered }));
  await page.click('[data-action="load-game"]');
  await sleep(300);
  const recoveredText = await page.locator('.save-slot[data-slot="1"]').innerText();
  check('the slot screen marks a backup recovery', /Recovered/i.test(recoveredText), recoveredText.replace(/\n/g, ' | '));
  await page.locator('.save-slot[data-slot="1"] .save-slot__body').click();
  await sleep(800);
  s = await saves();
  check('loading a recovered slot heals its primary body', s.slots[1].status === 'ok' && s.slots[1].recovered === false,
    JSON.stringify({ status: s.slots[1].status, recovered: s.slots[1].recovered }));
  check('the recovered run resumes in play', (await snap()).mode === 'playing');

  // --- Corrupted slot: listed, refused safely, then deleted ---
  await page.evaluate(() => {
    localStorage.setItem('ashen-vale:save:2', '{"version":3,"classId":');
    localStorage.removeItem('ashen-vale:save:2:backup');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  s = await saves();
  check('a corrupted slot is reported as corrupt', s.slots[2].status === 'corrupt', s.slots[2].error ?? '');
  await page.click('[data-action="load-game"]');
  await sleep(300);
  const corruptText = await page.locator('.save-slot[data-slot="2"]').innerText();
  check('the slot screen explains the corrupt save', /Corrupted/i.test(corruptText) && /unreadable/i.test(corruptText),
    corruptText.replace(/\n/g, ' | '));
  check('a corrupt slot cannot be loaded', await page.locator('.save-slot[data-slot="2"] .save-slot__body').isDisabled());
  await page.screenshot({ path: `${SHOTS}76-corrupt-slot.png` });

  await page.locator('.save-slot[data-slot="2"] .save-slot__delete').click();
  await sleep(300);
  s = await saves();
  check('deleting a corrupt slot reclaims it', s.slots[2].status === 'empty');
  check('the readable checkpoints survive the repair', s.slots[0].status === 'ok' && s.slots[1].status === 'ok');
  await page.locator('[data-save-close]').click();
  await sleep(200);
  check('Continue remains available after the repair', await page.locator('[data-action="continue-run"]').isVisible());

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
