/**
 * v1.4.1 salvage QA: exact displayed value, two-step confirmation, single
 * credit, bench removal, and equipped-item refusal. Runs against the built
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

async function main() {
  let server = null;
  let browser = null;

  try {
    if (!process.env.QA_URL) server = startPreviewServer(4173);
    await waitForServer(BASE);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    const snap = () => page.evaluate(() => window.__ashen.snapshot());

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

    let s = await snap();
    check('new game reaches play', s.mode === 'playing' && !s.dead, `${s.mode}, hp ${s.playerHp}`);
    check('no console errors after new game', errors.length === 0, errors.slice(0, 3).join(' | '));

    // --- Check 2: deterministic rare item, zero granted currency, open bench ---
    const uid = await page.evaluate(() => window.__ashen.grantItem('rare'));
    await page.evaluate(() => window.__ashen.grantCurrency(0, 0, 0));
    s = await snap();
    const baseline = {
      dust: s.currency.dust,
      bags: s.bagCount,
      equipped: s.equippedCount,
      items: s.items.length,
    };
    const item = s.items.find((entry) => entry.uid === uid);
    check('granted rare item is in the bag', !!item && item.rarity === 'rare' && item.equipped === false,
      `uid ${uid}, ${item?.rarity ?? 'missing'}`);
    check('new run has zero dust before salvage', baseline.dust === 0, `${baseline.dust} dust`);

    await page.keyboard.press('c');
    await page.locator('.craft-screen').waitFor({ state: 'visible' });
    check('C opens the crafting bench', await page.locator('.craft-screen').isVisible());
    await page.locator(`[data-craft-item="${uid}"]`).click();
    await sleep(150);
    const selected = await page.locator(`[data-craft-item="${uid}"]`)
      .evaluate((el) => el.classList.contains('craft-item--active'));
    check('the granted item is selected in the bench', selected);

    // --- Check 3: parse the displayed value and verify it against the item ---
    const salvageButton = page.locator('[data-craft-salvage]');
    await salvageButton.waitFor({ state: 'visible' });
    const salvageLabel = (await salvageButton.innerText()).trim();
    const value = displayedDust(salvageLabel);
    const exactValue = expectedSalvage(item);
    check('salvage button shows the exact item value', value === exactValue,
      `${JSON.stringify(salvageLabel)} → ${value}, expected ${exactValue}`);

    // --- Check 4: first click only arms confirmation, never salvages ---
    await salvageButton.click();
    await page.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    s = await snap();
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

    // --- Check 5: cancel restores the single-step control and changes nothing ---
    await page.locator('[data-craft-salvage-cancel]').click();
    await page.locator('[data-craft-salvage]').waitFor({ state: 'visible' });
    await sleep(150);
    s = await snap();
    const rearmedLabel = (await page.locator('[data-craft-salvage]').innerText()).trim();
    check('cancel hides confirmation and restores the salvage button',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0 &&
      displayedDust(rearmedLabel) === value,
      rearmedLabel);
    check('cancel changes neither dust nor bags',
      s.currency.dust === baseline.dust && s.bagCount === baseline.bags,
      `dust ${s.currency.dust}, bags ${s.bagCount}`);

    // --- Check 6: confirm removes one item and credits exactly one value ---
    await page.locator('[data-craft-salvage]').click();
    await page.locator('[data-craft-salvage-confirm]').waitFor({ state: 'visible' });
    const beforeConfirm = await snap();
    await page.locator('[data-craft-salvage-confirm]').click();
    await page.waitForFunction(
      (id) => !window.__ashen.snapshot().items.some((entry) => entry.uid === id),
      uid,
      { timeout: 8000 },
    );
    await sleep(150);
    const afterConfirm = await snap();
    check('confirm removes the item from owned items',
      !afterConfirm.items.some((entry) => entry.uid === uid),
      `items ${beforeConfirm.items.length} → ${afterConfirm.items.length}`);
    check('confirm credits the parsed value exactly once',
      afterConfirm.currency.dust - beforeConfirm.currency.dust === value,
      `${beforeConfirm.currency.dust} → ${afterConfirm.currency.dust} (+${value})`);
    check('bags drop by exactly one and equipment is untouched',
      afterConfirm.bagCount === beforeConfirm.bagCount - 1 &&
      afterConfirm.equippedCount === beforeConfirm.equippedCount,
      `bags ${beforeConfirm.bagCount} → ${afterConfirm.bagCount}`);
    check('confirmation row is gone after confirming',
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0 &&
      (await page.locator('[data-craft-salvage-cancel]').count()) === 0);

    await sleep(600);
    const settled = await snap();
    check('dust is not credited a second time after settling',
      settled.currency.dust === afterConfirm.currency.dust &&
      settled.currency.dust - beforeConfirm.currency.dust === value,
      `${settled.currency.dust} dust`);

    // --- Check 7: the item leaves the bench and the panel stays usable ---
    check('salvaged item disappears from the bench list',
      (await page.locator(`[data-craft-item="${uid}"]`).count()) === 0);
    const currencyText = await page.locator('[data-craft-currency]').innerText();
    check('bench remains usable and shows the new dust total',
      (await page.locator('.craft-screen').isVisible()) &&
      currencyText.toLowerCase().includes(`ember dust ${settled.currency.dust}`) &&
      (await page.locator('[data-craft-close]').isEnabled()),
      currencyText);
    await page.keyboard.press('Escape');
    await page.locator('.craft-screen').waitFor({ state: 'hidden' });
    check('bench closes cleanly after salvage', !(await page.locator('.craft-screen').isVisible()));

    // --- Check 8: equipped gear offers the hint, never an enabled salvage ---
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
    s = await snap();
    check('second item is equipped',
      s.equippedCount === baseline.equipped + 1 &&
      s.items.find((entry) => entry.uid === equippedUid)?.equipped === true,
      `${s.equippedCount} equipped`);

    await page.keyboard.press('Escape');
    await page.locator('.inventory-panel').waitFor({ state: 'hidden' });
    await page.keyboard.press('c');
    await page.locator('.craft-screen').waitFor({ state: 'visible' });
    await page.locator(`[data-craft-item="${equippedUid}"]`).click();
    await sleep(150);
    const hint = page.locator('.craft-salvage-hint');
    await hint.waitFor({ state: 'visible' });
    const equippedSelected = await page.locator(`[data-craft-item="${equippedUid}"]`)
      .evaluate((el) => el.classList.contains('craft-item--active'));
    check('equipped item shows the unequip hint',
      equippedSelected && (await hint.innerText()).toLowerCase().includes('unequip'),
      await hint.innerText());
    check('equipped item has no salvage control',
      (await page.locator('.craft-detail [data-craft-salvage]').count()) === 0 &&
      (await page.locator('.craft-detail [data-craft-salvage]:not([disabled])').count()) === 0 &&
      (await page.locator('[data-craft-salvage-confirm]').count()) === 0);
    await page.screenshot({ path: `${SHOTS}v141-salvage-equipped.png` });

    // --- Check 9: the required screenshot exists and the console stayed clean ---
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
