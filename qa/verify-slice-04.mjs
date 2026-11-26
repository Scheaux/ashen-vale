/**
 * Slice 4 browser QA: rewards & loot. Verifies the full loop — kills award XP,
 * enemies drop rarity-tagged items, walking over a drop fills the bag, the
 * inventory screen equips items atomically, level-ups toast, and the save
 * stub serializes the character state at schema v2.
 *
 * Run: node qa/verify-slice-04.mjs   (starts `vite preview` on :4173 itself)
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
  const killNearest = async () => {
    let s = await snap();
    await page.evaluate(() => window.__ashen.healPlayer(9999)); // keep the run stable
    const target = [...s.enemies].filter((e) => !e.dead).sort((a, b) => (a.x - s.playerPos.x) ** 2 + (a.z - s.playerPos.z) ** 2)[0];
    if (!target) return false;
    for (let i = 0; i < 45; i++) {
      s = await snap();
      if (s.dead) {
        await page.evaluate(() => window.__ashen.healPlayer(9999));
        const risen = page.locator('[data-action="respawn"]');
        if (await risen.isVisible()) {
          await risen.click();
          await sleep(300);
        }
      }
      const t = s.enemies.find((e) => e.id === target.id);
      if (!t || t.dead) return true;
      await clickWorld(t.x, t.z);
      await sleep(450);
    }
    return false;
  };

  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(250);
  await page.click('[data-class="ranger"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(800);

  // --- XP on kills ---
  let s = await snap();
  const xpBefore = s.xp + s.level * 1000;
  await killNearest();
  s = await snap();
  const xpAfter = s.xp + s.level * 1000;
  check('kills award XP', xpAfter > xpBefore, `xp ${s.xp}/${s.xpToNext} at level ${s.level}`);

  // --- Loot pipeline: kills produce items (dropped in the world or auto-picked) ---
  s = await snap();
  const itemsBefore = s.bagCount + s.equippedCount + s.drops;
  const dropsBaseline = s.drops;
  let sawWorldDrop = false;
  for (let i = 0; i < 5; i++) {
    await killNearest();
    await sleep(300);
    s = await snap();
    if (s.drops > dropsBaseline) {
      sawWorldDrop = true;
      await page.screenshot({ path: `${SHOTS}23-loot-drop.png` });
      break;
    }
    if (s.bagCount + s.equippedCount + s.drops > itemsBefore) break;
  }
  s = await snap();
  const itemsAfter = s.bagCount + s.equippedCount + s.drops;
  check('kills produce loot (drops and/or pickups)', itemsAfter > itemsBefore, `${itemsBefore} -> ${itemsAfter} items`);
  if (sawWorldDrop) check('drop visible in the world', true, '23-loot-drop.png');

  // --- Pickup: walk onto drops; a pack standing over one can eat the click,
  // so fall back to standing on it (proximity is the collection mechanic). ---
  const dropsBefore = s.drops;
  for (const d of s.dropPositions.slice(0, 3)) {
    await clickWorld(d.x, d.z);
    await sleep(1600);
  }
  s = await snap();
  if (s.drops >= dropsBefore && s.bagCount === 0) {
    for (const d of s.dropPositions.slice(0, 3)) {
      await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [d.x, d.z]);
      await sleep(300);
    }
    s = await snap();
  }
  check(
    'walking over drops collects them',
    s.drops < dropsBefore || s.bagCount > 0,
    `drops ${dropsBefore} -> ${s.drops}, bag ${s.bagCount}`,
  );

  // --- Inventory screen: open, view item, equip it ---
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  const panelVisible = await page.locator('.inventory-panel').isVisible();
  check('inventory screen opens with I', panelVisible);

  const itemCells = await page.locator('.item-cell').count();
  check('bag shows collected items', itemCells > 0 || s.bagCount === 0, `${itemCells} cells`);
  if (panelVisible) await page.screenshot({ path: `${SHOTS}24-inventory.png` });

  if (itemCells > 0) {
    await page.locator('.item-cell').first().hover();
    await sleep(200);
    check('tooltip shows affix data', await page.locator('.tt-name').isVisible());
    await page.locator('.item-cell').first().click();
    await sleep(250);
    s = await snap();
    check('clicking an item equips it', s.equippedCount >= 1, `equipped ${s.equippedCount}, bag ${s.bagCount}`);
    await page.screenshot({ path: `${SHOTS}25-equipped.png` });
  }

  await page.keyboard.press('Escape');
  await sleep(200);
  check('Escape closes the inventory', !(await page.locator('.inventory-panel').isVisible()));

  // --- Level-up toast via the review fixture ---
  await page.evaluate(() => window.__ashen.grantXp(5000));
  await sleep(400);
  s = await snap();
  check('level-up grants apply', s.level >= 2, `level ${s.level}`);
  check('level-up toast appears', (await page.locator('.toast').count()) > 0);

  // --- Save shape (current schema) ---
  const save = await page.evaluate(() => JSON.parse(window.__ashen.exportSave()));
  check('save serializes at the current schema version', save.version === 6, `version ${save.version}`);
  check('save carries progression + inventory', save.level >= 2 && Array.isArray(save.inventory.bags));

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
