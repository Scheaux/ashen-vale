/**
 * v1.4.1 salvage QA: exact displayed value, two-step confirmation, single
 * credit, bench removal, equipped-item refusal, real double-clicks at the old
 * Salvage position (including a short/scrolled panel), pending invalidation,
 * fallback selection, and save/reload persistence. Runs against the built
 * preview server with the same debug hooks as the other browser suites.
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SALVAGE_RARITY_VALUE = { normal: 1, magic: 2, rare: 4, unique: 10 };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Mirrors systems/salvage.ts so the displayed value is verified, not trusted. */
function expectedSalvage(item) {
  const levelBonus = Math.floor(item.itemLevel / 5);
  const qualityBonus = Math.floor(item.quality / 10);
  return Math.max(1, (1 + levelBonus) * SALVAGE_RARITY_VALUE[item.rarity] + qualityBonus);
}

/** Read the dust amount out of "Salvage · 4 Dust" / "Confirm salvage · 4 Dust". */
function displayedDust(text) {
  const match = text.match(/(?:·|•)\s*(\d+)\s*Dust/i) ?? text.match(/(\d+)\s*Dust/i);
  if (!match) throw new Error(`No salvage value in button text: ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** Full currency token match, not a prefix substring: "Ember Dust 4". */
function hasCurrencyToken(text, expected) {
  return text
    .split('·')
    .some((part) => part.trim().toLowerCase() === expected.toLowerCase());
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

function watchPage(page, errors, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${label}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${label}] ${String(err)}`));
}

const snapshot = (page) => page.evaluate(() => window.__ashen.snapshot());

async function startNewRun(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(200);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 10000 });
  await sleep(300);
  // Silence the moor so no background kill can add dust mid-transaction.
  await page.evaluate(() => window.__ashen.clearEnemies());
  await sleep(150);
}

async function openBench(page) {
  await page.keyboard.press('c');
  await page.locator('.craft-screen').waitFor({ state: 'visible' });
  await sleep(100);
}

async function closeBench(page) {
  await page.keyboard.press('Escape');
  await page.locator('.craft-screen').waitFor({ state: 'hidden' });
}

async function cancelPendingSalvage(page) {
  const cancel = page.locator('[data-craft-salvage-cancel]');
  if ((await cancel.count()) === 0) return false;
  await cancel.click();
  await page.locator('[data-craft-salvage]').waitFor({ state: 'visible' });
  return true;
}

function boxCenter(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function isActiveCraftItem(page, uid) {
  return page.locator(`[data-craft-item="${uid}"]`)
    .evaluate((el) => el.classList.contains('craft-item--active'));
}

async function main() {
  let server = null;
  let browser = null;

  try {
    if (!process.env.QA_URL) server = startPreviewServer(4173);
    await waitForServer(BASE);

    browser = await chromium.launch();
    const errors = [];

    // =====================================================================
    // Core transaction flow (1440×900): arm/cancel, real double-click,
    // fast legitimate Confirm, and save/reload persistence.
    // =====================================================================
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    watchPage(page, errors, 'core');

    await startNewRun(page);

    let s = await snapshot(page);
    check('new game reaches play', s.mode === 'playing' && !s.dead, `${s.mode}, hp ${s.playerHp}`);
    check('no console errors after new game', errors.length === 0, errors.slice(0, 3).join(' | '));

    // --- Deterministic rare item, zero granted currency, open bench ---
    const uid = await page.evaluate(() => window.__ashen.grantItem('rare'));
    await page.evaluate(() => window.__ashen.grantCurrency(0, 0, 0));
    s = await snapshot(page);
    const baseline = {
      dust: s.currency.dust,
      bags: s.bagCount,
      equipped: s.equippedCount,
      items: s.items.length,
    };
    const item = s.items.find((entry) => entry.uid === uid);
    check('granted rare item is in the bag', !!item && item.rarity === 'rare' && item.equipped === false,
      `uid ${uid}, ${item?.rarity ?? 'missing'}`);
    check('new-run dust baseline recorded for delta checks',
      Number.isInteger(baseline.dust) && baseline.dust >= 0,
      `${baseline.dust} dust (informational; new games need not start at 0)`);

    await openBench(page);
    check('C opens the crafting bench', await page.locator('.craft-screen').isVisible());
    await page.locator(`[data-craft-item="${uid}"]`).click();
    await sleep(150);
    check('the granted item is selected in the bench', await isActiveCraftItem(page, uid));

    // --- Parse the displayed value and verify it against the item ---
    const salvageButton = page.locator('[data-craft-salvage]');
    await salvageButton.waitFor({ state: 'visible' });
    const salvageLabel = (await salvageButton.innerText()).trim();
    const value = displayedDust(salvageLabel);
    const exactValue = expectedSalvage(item);
    check('salvage button shows the exact item value', value === exactValue,
      `${JSON.stringify(salvageLabel)} → ${value}, expected ${exactValue}`);

    // --- First click only arms confirmation, never salvages ---
    await salvageButton.click();
    await page.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    s = await snapshot(page);
    const confirmLabel = (await page.locator('[data-craft-salvage-confirm]').innerText()).trim();
    check('first click reveals confirm and removes the old salvage control',
      (await page.locator('[data-craft-salvage]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-confirm]').isVisible()),
      confirmLabel);
    check('arming confirmation changes neither dust nor bags',
      s.currency.dust === baseline.dust && s.bagCount === baseline.bags,
      `dust ${s.currency.dust}, bags ${s.bagCount}`);
    check('confirm shows the same parsed value', displayedDust(confirmLabel) === value, confirmLabel);

    await page.screenshot({ path: `${SHOTS}v141-salvage.png` });

    // --- Cancel restores the single-step control and changes nothing ---
    await page.locator('[data-craft-salvage-cancel]').click();
    await page.locator('[data-craft-salvage]').waitFor({ state: 'visible' });
    await sleep(150);
    s = await snapshot(page);
    const rearmedLabel = (await page.locator('[data-craft-salvage]').innerText()).trim();
    check('cancel hides confirmation and restores the salvage button',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0 &&
      displayedDust(rearmedLabel) === value,
      rearmedLabel);
    check('cancel changes neither dust nor bags',
      s.currency.dust === baseline.dust && s.bagCount === baseline.bags,
      `dust ${s.currency.dust}, bags ${s.bagCount}`);

    // --- Real double-click at the Salvage button's actual bounding-box center ---
    // A double-click must never sell: the first click replaces the button with a
    // non-interactive prompt, and the second click must not land on Confirm.
    const dblBox = await page.locator('[data-craft-salvage]').boundingBox();
    if (!dblBox) throw new Error('Salvage button has no bounding box');
    const dblPoint = boxCenter(dblBox);
    const beforeDouble = await snapshot(page);
    await page.mouse.dblclick(dblPoint.x, dblPoint.y);
    await sleep(200);
    const afterDouble = await snapshot(page);
    const survivedDouble = afterDouble.items.find((entry) => entry.uid === uid);
    check('real double-click at Salvage leaves the item owned',
      !!survivedDouble && survivedDouble.equipped === false,
      `uid ${uid}, items ${beforeDouble.items.length} → ${afterDouble.items.length}`);
    check('real double-click at Salvage does not sell or credit dust',
      afterDouble.currency.dust === beforeDouble.currency.dust &&
      afterDouble.bagCount === beforeDouble.bagCount &&
      afterDouble.items.length === beforeDouble.items.length,
      `dust ${beforeDouble.currency.dust} → ${afterDouble.currency.dust}, bags ${beforeDouble.bagCount} → ${afterDouble.bagCount}`);
    await page.screenshot({ path: `${SHOTS}v141-salvage-dblclick.png` });

    const doubleArmed = (await page.locator('[data-craft-salvage-cancel]').count()) > 0;
    await cancelPendingSalvage(page);
    check('the double-click armed state cancels cleanly',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0 &&
      (await snapshot(page)).items.some((entry) => entry.uid === uid),
      doubleArmed ? 'pending row was present and cancelled' : 'second click cancelled or left no row');

    // --- Fast legitimate Confirm: arm, parse the re-armed label, click promptly ---
    const rearmSalvage = page.locator('[data-craft-salvage]');
    await rearmSalvage.waitFor({ state: 'visible' });
    await rearmSalvage.click();
    const confirm = page.locator('[data-craft-salvage-confirm]');
    await confirm.waitFor({ state: 'visible' });
    const rearmedConfirmLabel = (await confirm.innerText()).trim();
    check('re-armed confirm label parses to the same value',
      rearmedConfirmLabel === confirmLabel && displayedDust(rearmedConfirmLabel) === value,
      `${JSON.stringify(rearmedConfirmLabel)} → ${displayedDust(rearmedConfirmLabel)}`);
    const beforeConfirm = await snapshot(page);
    check('the re-armed state still has the baseline dust and bags',
      beforeConfirm.currency.dust === baseline.dust && beforeConfirm.bagCount === baseline.bags,
      `dust ${beforeConfirm.currency.dust}, bags ${beforeConfirm.bagCount}`);

    const confirmBox = await confirm.boundingBox();
    if (!confirmBox) throw new Error('Confirm button has no bounding box');
    const confirmPoint = boxCenter(confirmBox);
    await page.mouse.click(confirmPoint.x, confirmPoint.y);
    await page.waitForFunction(
      (id) => !window.__ashen.snapshot().items.some((entry) => entry.uid === id),
      uid,
      { timeout: 8000 },
    );
    await sleep(150);
    const afterConfirm = await snapshot(page);
    check('fast legitimate Confirm removes the item from owned items',
      !afterConfirm.items.some((entry) => entry.uid === uid),
      `items ${beforeConfirm.items.length} → ${afterConfirm.items.length}`);
    check('fast legitimate Confirm credits the parsed value exactly once',
      afterConfirm.currency.dust - baseline.dust === value,
      `${baseline.dust} → ${afterConfirm.currency.dust} (+${value})`);
    check('bags drop by exactly one and equipment is untouched',
      afterConfirm.bagCount === baseline.bags - 1 &&
      afterConfirm.equippedCount === baseline.equipped,
      `bags ${baseline.bags} → ${afterConfirm.bagCount}`);
    check('confirmation row is gone after confirming',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0);

    await sleep(600);
    const settled = await snapshot(page);
    check('dust is not credited a second time after settling',
      settled.currency.dust === afterConfirm.currency.dust &&
      settled.currency.dust - baseline.dust === value,
      `${settled.currency.dust} dust`);

    // --- The item leaves the bench, the full currency token is shown, panel usable ---
    check('salvaged item disappears from the bench list',
      (await page.locator(`[data-craft-item="${uid}"]`).count()) === 0);
    const currencyText = await page.locator('[data-craft-currency]').innerText();
    check('bench remains usable after salvage',
      (await page.locator('.craft-screen').isVisible()) &&
      (await page.locator('[data-craft-close]').isEnabled()),
      currencyText);
    check('bench shows the full Ember Dust token',
      hasCurrencyToken(currencyText, `Ember Dust ${settled.currency.dust}`),
      JSON.stringify(currencyText));

    await page.keyboard.press('Escape');
    await page.locator('.craft-screen').waitFor({ state: 'hidden' });
    check('bench closes cleanly after salvage', !(await page.locator('.craft-screen').isVisible()));

    // --- Save/reload: the checkpoint must persist dust and the removed uid ---
    await sleep(300);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-action="continue-run"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.click('[data-action="continue-run"]');
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 10000 });
    await sleep(300);
    s = await snapshot(page);
    check('reload + Continue persists the post-salvage dust total',
      s.currency.dust === settled.currency.dust,
      `${settled.currency.dust} → ${s.currency.dust}`);
    check('reload + Continue keeps the sold uid out of the save',
      !s.items.some((entry) => entry.uid === uid) && s.bagCount === settled.bagCount,
      `items ${s.items.length}, bags ${s.bagCount}`);
    await page.screenshot({ path: `${SHOTS}v141-salvage-reload.png` });

    // --- Equipped gear offers the hint, never an enabled salvage ---
    const equippedUid = await page.evaluate(() => window.__ashen.grantItem('magic'));
    await page.keyboard.press('i');
    await page.locator('.inventory-panel').waitFor({ state: 'visible' });
    check('I opens inventory with the second item', await page.locator('.inventory-panel').isVisible());
    await page.locator(`[data-item-uid="${equippedUid}"]`).click();
    await page.waitForFunction(
      (id) => window.__ashen.snapshot().items.some((entry) => entry.uid === id && entry.equipped),
      equippedUid,
      { timeout: 8000 },
    );
    s = await snapshot(page);
    check('second item is equipped',
      s.equippedCount === baseline.equipped + 1 &&
      s.items.find((entry) => entry.uid === equippedUid)?.equipped === true,
      `${s.equippedCount} equipped`);

    await page.keyboard.press('Escape');
    await page.locator('.inventory-panel').waitFor({ state: 'hidden' });
    await openBench(page);
    await page.locator(`[data-craft-item="${equippedUid}"]`).click();
    await sleep(150);
    const hint = page.locator('.craft-salvage-hint');
    await hint.waitFor({ state: 'visible' });
    const equippedSelected = await isActiveCraftItem(page, equippedUid);
    check('equipped item shows the unequip hint',
      equippedSelected && (await hint.innerText()).toLowerCase().includes('unequip'),
      await hint.innerText());
    check('equipped item has no salvage control',
      (await page.locator('.craft-detail [data-craft-salvage]').count()) === 0 &&
      (await page.locator('.craft-detail [data-craft-salvage]:not([disabled])').count()) === 0 &&
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0);
    await page.screenshot({ path: `${SHOTS}v141-salvage-equipped.png` });

    // --- Pending invalidation: selection change, close/reopen, equip ---
    const pendingUid = await page.evaluate(() => window.__ashen.grantItem('magic'));
    const otherUid = await page.evaluate(() => window.__ashen.grantItem('normal'));

    // Selection change.
    await page.locator(`[data-craft-item="${pendingUid}"]`).click();
    await page.locator('[data-craft-salvage]').click();
    await page.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    const preSelection = await snapshot(page);
    await page.locator(`[data-craft-item="${otherUid}"]`).click();
    await sleep(150);
    const postSelection = await snapshot(page);
    check('selecting another item clears the pending confirmation row',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0);
    check('selecting another item makes it active and leaves the armed item intact',
      (await isActiveCraftItem(page, otherUid)) &&
      postSelection.items.some((entry) => entry.uid === pendingUid) &&
      postSelection.currency.dust === preSelection.currency.dust &&
      postSelection.bagCount === preSelection.bagCount,
      `dust ${postSelection.currency.dust}, bags ${postSelection.bagCount}`);

    // Close and reopen.
    await page.locator(`[data-craft-item="${pendingUid}"]`).click();
    await page.locator('[data-craft-salvage]').click();
    await page.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    await closeBench(page);
    await openBench(page);
    await page.locator(`[data-craft-item="${pendingUid}"]`).click();
    await sleep(150);
    check('closing and reopening the bench drops any pending confirmation',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0 &&
      (await page.locator('[data-craft-salvage]').isVisible()) &&
      (await snapshot(page)).items.some((entry) => entry.uid === pendingUid));
    await page.screenshot({ path: `${SHOTS}v141-salvage-pending-cleared.png` });

    // Equip through the real inventory UI while a confirmation is armed.
    await page.locator('[data-craft-salvage]').click();
    await page.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    await page.keyboard.press('i');
    await page.locator('.inventory-panel').waitFor({ state: 'visible' });
    await page.locator(`[data-item-uid="${pendingUid}"]`).click();
    await page.waitForFunction(
      (id) => window.__ashen.snapshot().items.some((entry) => entry.uid === id && entry.equipped),
      pendingUid,
      { timeout: 8000 },
    );
    await openBench(page);
    const pendingHint = page.locator('.craft-salvage-hint');
    await pendingHint.waitFor({ state: 'visible' });
    check('equipping a pending item clears the row and shows the unequip hint',
      (await pendingHint.innerText()).toLowerCase().includes('unequip') &&
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0);
    check('equipped pending item has no salvage control',
      (await page.locator('.craft-detail [data-craft-salvage]').count()) === 0);
    await page.screenshot({ path: `${SHOTS}v141-salvage-pending-equip.png` });
    await closeBench(page);

    // =====================================================================
    // Short/scrolled panel regression (900×600): enough bag items to scroll,
    // Salvage near the bottom edge, real double-click. Focus must not scroll
    // the panel and move Confirm under the old pointer position.
    // =====================================================================
    const scrollPage = await browser.newPage({ viewport: { width: 900, height: 600 } });
    scrollPage.setDefaultTimeout(8000);
    watchPage(scrollPage, errors, 'scrolled');
    await startNewRun(scrollPage);

    const scrollUids = await scrollPage.evaluate(() => {
      const uids = [];
      for (let i = 0; i < 14; i++) uids.push(window.__ashen.grantItem('normal'));
      return uids;
    });
    await openBench(scrollPage);
    await scrollPage.locator(`[data-craft-item="${scrollUids[0]}"]`).click();
    await sleep(150);

    const panel = scrollPage.locator('.craft-panel');
    const scrollMetrics = await panel.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    check('short viewport makes the bench panel scroll',
      scrollMetrics.scrollHeight > scrollMetrics.clientHeight + 50,
      `${scrollMetrics.clientHeight}px visible of ${scrollMetrics.scrollHeight}px`);

    // Put the Salvage button's center ~24px above the panel's bottom edge.
    // The reserved confirmation row then sits below the clip, so a default
    // focus() scroll would move it; preventScroll must keep scrollTop fixed.
    await scrollPage.evaluate(() => {
      const craftPanel = document.querySelector('.craft-panel');
      const button = document.querySelector('[data-craft-salvage]');
      const panelRect = craftPanel.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const desiredTop = panelRect.bottom - 24 - buttonRect.height / 2;
      craftPanel.scrollTop += buttonRect.top - desiredTop;
    });
    await sleep(150);

    const scrollBefore = await panel.evaluate((el) => el.scrollTop);
    const scrollSalvageBox = await scrollPage.locator('[data-craft-salvage]').boundingBox();
    const scrollPanelBox = await panel.boundingBox();
    if (!scrollSalvageBox || !scrollPanelBox) throw new Error('Scrolled panel geometry missing');
    const scrollSalvageCenter = boxCenter(scrollSalvageBox);
    const scrollFraction = (scrollSalvageCenter.y - scrollPanelBox.y) / scrollPanelBox.height;
    check('short viewport: Salvage sits near the bottom edge',
      scrollFraction > 0.85 &&
      scrollSalvageCenter.y < scrollPanelBox.y + scrollPanelBox.height &&
      scrollBefore > 0,
      `center ${scrollSalvageCenter.y.toFixed(1)}px, panel ${scrollPanelBox.y.toFixed(1)}–${(scrollPanelBox.y + scrollPanelBox.height).toFixed(1)}, scrollTop ${scrollBefore}`);

    const beforeScrolledDouble = await snapshot(scrollPage);
    await scrollPage.mouse.dblclick(scrollSalvageCenter.x, scrollSalvageCenter.y);
    await sleep(250);
    const afterScrolledDouble = await snapshot(scrollPage);
    const scrollAfter = await panel.evaluate((el) => el.scrollTop);
    check('short/scrolled double-click salvages nothing',
      afterScrolledDouble.items.some((entry) => entry.uid === scrollUids[0]) &&
      afterScrolledDouble.currency.dust === beforeScrolledDouble.currency.dust &&
      afterScrolledDouble.bagCount === beforeScrolledDouble.bagCount &&
      afterScrolledDouble.items.length === beforeScrolledDouble.items.length,
      `dust ${beforeScrolledDouble.currency.dust} → ${afterScrolledDouble.currency.dust}, bags ${beforeScrolledDouble.bagCount} → ${afterScrolledDouble.bagCount}`);
    check('short/scrolled double-click does not focus-scroll the panel',
      Math.abs(scrollAfter - scrollBefore) < 1,
      `scrollTop ${scrollBefore} → ${scrollAfter}`);
    await scrollPage.screenshot({ path: `${SHOTS}v141-salvage-scrolled-dblclick.png` });

    await cancelPendingSalvage(scrollPage);
    check('scrolled double-click leaves the panel usable and the item owned',
      (await scrollPage.locator('.craft-screen').isVisible()) &&
      (await scrollPage.locator('[data-craft-salvage]').isVisible()) &&
      (await snapshot(scrollPage)).items.some((entry) => entry.uid === scrollUids[0]));
    await scrollPage.close();

    // =====================================================================
    // Fallback selection on a fresh run with exactly two bag items.
    // =====================================================================
    const fallbackPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    fallbackPage.setDefaultTimeout(8000);
    watchPage(fallbackPage, errors, 'fallback');
    await startNewRun(fallbackPage);

    const firstUid = await fallbackPage.evaluate(() => window.__ashen.grantItem('normal'));
    const secondUid = await fallbackPage.evaluate(() => window.__ashen.grantItem('rare'));
    s = await snapshot(fallbackPage);
    check('fallback fixture has exactly two bag items and no equipment',
      s.bagCount === 2 && s.equippedCount === 0,
      `bags ${s.bagCount}, equipped ${s.equippedCount}`);

    await openBench(fallbackPage);
    await fallbackPage.locator(`[data-craft-item="${firstUid}"]`).click();
    await sleep(100);
    const fallbackValue = displayedDust((await fallbackPage.locator('[data-craft-salvage]').innerText()).trim());
    const fallbackDustBefore = (await snapshot(fallbackPage)).currency.dust;
    await fallbackPage.locator('[data-craft-salvage]').click();
    await fallbackPage.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    await fallbackPage.locator('[data-craft-salvage-confirm]').click();
    await fallbackPage.waitForFunction(
      (id) => !window.__ashen.snapshot().items.some((entry) => entry.uid === id),
      firstUid,
      { timeout: 8000 },
    );
    await sleep(150);
    const afterFallback = await snapshot(fallbackPage);
    check('fallback selection picks the surviving item after salvage',
      (await isActiveCraftItem(fallbackPage, secondUid)) &&
      !afterFallback.items.some((entry) => entry.uid === firstUid) &&
      afterFallback.items.some((entry) => entry.uid === secondUid) &&
      afterFallback.currency.dust - fallbackDustBefore === fallbackValue,
      `active ${secondUid}, dust ${afterFallback.currency.dust} (+${fallbackValue})`);
    check('fallback leaves the panel usable',
      (await fallbackPage.locator('.craft-screen').isVisible()) &&
      (await fallbackPage.locator('[data-craft-salvage]').isVisible()) &&
      (await fallbackPage.locator('[data-craft-salvage]').isEnabled()) &&
      (await fallbackPage.locator('[data-craft-close]').isEnabled()) &&
      afterFallback.bagCount === 1);
    await fallbackPage.screenshot({ path: `${SHOTS}v141-salvage-fallback.png` });

    // Confirm must not be gated on click count: a rapid detail=2 click on a
    // freshly armed control is still a legitimate sale and runs exactly once.
    const survivorValue = displayedDust((await fallbackPage.locator('[data-craft-salvage]').innerText()).trim());
    await fallbackPage.locator('[data-craft-salvage]').click();
    await fallbackPage.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    await fallbackPage.evaluate(() => {
      const button = document.querySelector('[data-craft-salvage-confirm]');
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
    });
    await fallbackPage.waitForFunction(
      (id) => !window.__ashen.snapshot().items.some((entry) => entry.uid === id),
      secondUid,
      { timeout: 8000 },
    );
    await sleep(150);
    const afterFastConfirm = await snapshot(fallbackPage);
    check('fast detail=2 Confirm sells exactly once (no click-count guard)',
      afterFastConfirm.currency.dust - afterFallback.currency.dust === survivorValue &&
      afterFastConfirm.bagCount === 0,
      `dust ${afterFallback.currency.dust} → ${afterFastConfirm.currency.dust} (+${survivorValue}), bags ${afterFastConfirm.bagCount}`);
    await closeBench(fallbackPage);
    await fallbackPage.close();

    await page.close();
    await sleep(200);
    check('no console errors across the salvage flow', errors.length === 0, errors.slice(0, 3).join(' | '));
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
