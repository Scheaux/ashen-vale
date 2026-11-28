/**
 * v1.4 itemization/economy QA: crafted item state, currency spend, base
 * implicits/quality, save v8 persistence, and no identity loss.
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
  if (!process.env.QA_URL) server = startPreviewServer(4173);
  await waitForServer(BASE);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  await sleep(900);

  // --- Kills earn dust; the boss economy is covered by unit tests ---
  const victim = await page.evaluate(() => {
    const snap = window.__ashen.snapshot();
    const p = snap.playerPos;
    return snap.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  });
  const dustBefore = (await snap()).currency.dust;
  await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 9999), [victim.id]);
  await sleep(250);
  check('kills earn Ember Dust', (await snap()).currency.dust > dustBefore,
    `${dustBefore} -> ${(await snap()).currency.dust}`);

  // --- Give a deterministic item and currency for the craft flow ---
  const uid = await page.evaluate(() => window.__ashen.grantItem('normal'));
  await page.evaluate(() => window.__ashen.grantCurrency(10, 10, 10));
  let s = await snap();
  const baseItem = s.items.find((item) => item.uid === uid);
  check('rolled items carry a base implicit', !!baseItem?.implicit, JSON.stringify(baseItem?.implicit));
  check('rolled items start at quality 0', baseItem?.quality === 0);

  await page.keyboard.press('c');
  await sleep(250);
  check('C opens the crafting bench', await page.locator('.craft-screen').isVisible());
  await page.locator(`[data-craft-item="${uid}"]`).click();
  await sleep(150);
  check('the crafting list shows the implicit and quality',
    (await page.locator('.craft-detail').innerText()).toLowerCase().includes('implicit'));

  await page.locator('[data-craft-action="add"]').click();
  await sleep(200);
  s = await snap();
  let item = s.items.find((entry) => entry.uid === uid);
  check('adding an affix upgrades normal to magic', item?.rarity === 'magic' && item?.affixes.length >= 1,
    `${item?.rarity}, ${item?.affixes.length} affixes`);
  check('adding an affix spends an Ashen Rune', s.currency.rune === 9, `${s.currency.rune}`);

  await page.locator('[data-craft-action="reforge"]').click();
  await sleep(200);
  s = await snap();
  item = s.items.find((entry) => entry.uid === uid);
  check('reforging spends Ember Dust', s.currency.dust === 10, `${s.currency.dust}`);
  check('reforged item still has its identity', item?.uid === uid && item?.affixes.length === 1);

  await page.locator('[data-craft-action="quality"]').click();
  await sleep(200);
  s = await snap();
  item = s.items.find((entry) => entry.uid === uid);
  check('quality spends a Quality Ember and reaches 5%', s.currency.quality === 9 && item?.quality === 5,
    `${s.currency.quality} embers, ${item?.quality}%`);
  await page.screenshot({ path: `${SHOTS}97-crafting.png` });

  await page.keyboard.press('Escape');
  await sleep(200);
  check('Escape closes the bench', !(await page.locator('.craft-screen').isVisible()));

  // --- Save/reload preserves the crafted item and currency ---
  await page.screenshot({ path: `${SHOTS}98-crafted-item.png` });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
  await page.click('[data-action="continue-run"]');
  await sleep(900);
  s = await snap();
  item = s.items.find((entry) => entry.uid === uid);
  const save = await page.evaluate(() => JSON.parse(window.__ashen.exportSave()));
  check('save v8 carries the crafted item', save.version === 8 &&
    save.inventory.bags.some((entry) => entry.uid === uid));
  check('Continue restores item quality and affix count', item?.quality === 5 && item?.affixes.length === 1);
  check('Continue restores crafting currency', s.currency.dust === 10 && s.currency.rune === 9 && s.currency.quality === 9,
    JSON.stringify(s.currency));

  // --- Equipped quality changes derived combat stats ---
  await page.keyboard.press('c');
  await sleep(250);
  await page.locator(`[data-craft-item="${uid}"]`).click();
  await page.locator('[data-craft-action="quality"]').click();
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('i');
  await sleep(200);
  await page.locator(`[data-item-uid="${uid}"]`).click();
  await sleep(250);
  s = await snap();
  check('crafted gear can be equipped', s.equippedCount === 1);
  await page.keyboard.press('Escape');
  await sleep(200);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
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
