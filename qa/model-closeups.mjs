/**
 * Art-pass probe: close-up screenshots of every hero class and a husk,
 * including mid-strike frames, for judging the procedural rigs up close.
 * Complements the behavioral QA suites (which judge from the game camera).
 *
 * Run: node qa/model-closeups.mjs
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);

  const snap = () => page.evaluate(() => window.__ashen.snapshot());
  const clickWorld = async (x, z) => {
    const { x: sx, y: sy } = await page.evaluate(([a, b]) => window.__ashen.worldToScreen(a, b), [x, z]);
    await page.mouse.click(Math.min(1410, Math.max(30, sx)), Math.min(870, Math.max(30, sy)));
  };

  let stats = null;

  for (const cls of ['marauder', 'ranger', 'witch']) {
    await page.click('[data-action="new-game"]');
    await page.waitForTimeout(250);
    await page.click(`[data-class="${cls}"]`);
    await page.click('[data-action="begin"]');
    await page.waitForTimeout(600);

    // Zoom in on the hero.
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -1800);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}model-${cls}-idle.png` });

    // Attack an enemy to catch strike frames.
    const s = await snap();
    const dist2 = (e) => (e.x - s.playerPos.x) ** 2 + (e.z - s.playerPos.z) ** 2;
    const target = [...s.enemies].sort((a, b) => dist2(a) - dist2(b))[0];
    for (let i = 0; i < 22; i++) {
      const cur = await snap();
      const t = cur.enemies.find((e) => e.id === target.id);
      if (!t || t.dead) break;
      await clickWorld(t.x, t.z);
      if (i === 6) {
        await sleep(120); // ~mid-swing after a hit lands
        await page.screenshot({ path: `${SHOTS}model-${cls}-strike.png` });
      }
      await sleep(450);
    }
    const after = await snap();
    if (after.enemies.some((e) => !e.dead)) {
      const next = after.enemies.find((e) => !e.dead);
      await clickWorld(next.x, next.z);
      await sleep(2500); // close in for a husk close-up
      await page.screenshot({ path: `${SHOTS}model-husk-${cls}.png` });
    }

    // Back to title for the next class.
    await page.keyboard.press('Escape');
    await sleep(250);
    await page.click('[data-action="quit"]');
    await sleep(350);
    stats = (await snap()).render;
  }

  await browser.close();
  stopServer(server);
  console.log('close-ups captured in qa/shots/model-*.png');
  console.log('render budget:', JSON.stringify(stats));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
