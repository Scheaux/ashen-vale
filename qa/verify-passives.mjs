/**
 * Slice 6 browser QA: passive skill tree. Verifies the allocation UI opens
 * on P, points accrue one per level, allocation enforces adjacency and
 * points, refunds obey the no-orphan rule, and build choices move the
 * derived combat stats that feed the damage pipeline.
 *
 * Run: node qa/verify-passives.mjs   (starts `vite preview` on :4173 itself)
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
  const hasToast = (text) => page.locator('.toast', { hasText: text }).first().isVisible();
  const waitForToast = async (text, timeoutMs = 2500) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await hasToast(text)) return true;
      await sleep(80);
    }
    return false;
  };

  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(250);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(800);

  // --- The tree opens on P with the full graph ---
  await page.keyboard.press('p');
  await sleep(300);
  check('passive tree opens with P', await page.locator('.passive-panel').isVisible());
  const nodeCount = await page.locator('.pnode').count();
  check('tree renders ~30 nodes with connectors', nodeCount >= 30 && (await page.locator('.passive-edges line').count()) >= 25,
    `${nodeCount} nodes`);
  await page.screenshot({ path: `${SHOTS}50-passive-tree.png` });

  // --- Points come from levels ---
  let s = await snap();
  check('level 1 starts with no points to spend', s.passives.available === 0, JSON.stringify(s.passives));
  await page.evaluate(() => window.__ashen.grantXp(5000));
  await sleep(300);
  s = await snap();
  check('levels grant one point each', s.passives.total === s.level - 1 && s.passives.available >= 5,
    `level ${s.level}, ${s.passives.available} available`);
  check('HUD shows the unspent points nag', (await page.locator('[data-hud-points]').textContent())?.includes('passive point'));

  // --- Allocation rules ---
  await page.click('[data-node="o4"]'); // locked: needs o1
  check('locked node refuses with guidance', await waitForToast('Connect this node'));
  s = await snap();
  check('refused allocation changes nothing', !s.passives.allocated.includes('o4') && s.passives.available >= 5);

  const attackBefore = s.stats.attackDamagePct;
  await page.click('[data-node="o1"]'); // Weapon Training: +4% attack damage
  await sleep(150);
  s = await snap();
  check('allocating spends a point', s.passives.allocated.includes('o1') && s.passives.available >= 4,
    `${s.passives.available} left`);
  check('passives move combat numbers', s.stats.attackDamagePct > attackBefore,
    `attack damage ${attackBefore}% -> ${s.stats.attackDamagePct}%`);
  await page.screenshot({ path: `${SHOTS}51-passive-allocated.png` });

  // --- Refund rules ---
  await page.click('[data-node="o4"]'); // now unlocked
  await sleep(150);
  s = await snap();
  check('child node unlocks after its prerequisite', s.passives.allocated.includes('o4'));

  await page.click('[data-node="o1"]', { button: 'right' }); // has allocated dependent o4
  check('refunding an inner node refuses', await waitForToast('Refund the nodes beyond it'));
  s = await snap();
  check('refused refund keeps the node', s.passives.allocated.includes('o1'));

  const attackWithO4 = s.stats.attackDamagePct;
  await page.click('[data-node="o4"]', { button: 'right' });
  await sleep(150);
  s = await snap();
  check('leaf refund works and returns the point', !s.passives.allocated.includes('o4'),
    `${s.passives.available} available`);
  await page.click('[data-node="o1"]', { button: 'right' });
  await sleep(150);
  s = await snap();
  check('refunds restore combat numbers', s.stats.attackDamagePct < attackWithO4 && !s.passives.allocated.includes('o1'),
    `attack damage back to ${s.stats.attackDamagePct}%`);

  // --- Keystones deep in the tree need the whole path ---
  await page.click('[data-node="d12"]'); // Unbreakable: needs d8 AND d9
  check('keystones refuse without their paths', await waitForToast('Connect this node'));

  // --- Escape closes ---
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Escape closes the passive tree', !(await page.locator('.passive-panel').isVisible()));

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
