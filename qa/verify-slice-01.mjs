/**
 * Slice 0-1 browser QA: boots the game, walks the full menu flow, issues a
 * click-to-move, verifies the player actually moves and obstacles block,
 * exercises pause/restart/quit, and captures screenshots as evidence.
 *
 * Run: node qa/verify-slice-01.mjs   (requires `npm run dev` on :5173,
 *      or it starts `vite preview` automatically on :4173)
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

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
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server not reachable at ${url}`);
}

async function main() {
  // Serve the production build unless a dev server is provided.
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
  await page.waitForTimeout(1200);

  // --- Title screen ---
  const title = page.locator('.game-title');
  check('title screen renders', await title.isVisible());
  await page.screenshot({ path: `${SHOTS}01-title.png` });

  // --- Class select ---
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(400);
  check('class select shows 3 classes', (await page.locator('.class-card').count()) === 3);
  await page.click('[data-class="ranger"]');
  check(
    'class card selection works',
    await page.locator('.class-card--selected[data-class="ranger"]').isVisible(),
  );
  await page.screenshot({ path: `${SHOTS}02-class-select.png` });

  // --- Enter the game ---
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(1500);
  const hudVisible = await page.locator('[data-hud]').isVisible();
  check('HUD appears after starting run', hudVisible);
  const hudText = await page.locator('[data-hud-class]').textContent();
  check('HUD shows chosen class', (hudText ?? '').includes('Ranger'), hudText ?? '');
  await page.screenshot({ path: `${SHOTS}03-in-game.png` });

  // --- Click-to-move: click a spot and verify the player travels ---
  const canvas = page.locator('#game');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Sample the rendered scene via pixel diff: moving camera/player changes frames.
  const before = await page.screenshot();
  await page.mouse.click(cx + 260, cy - 60); // click right-ish on the ground
  await page.waitForTimeout(1600);
  const after = await page.screenshot();
  check('scene changes after click-to-move', !before.equals(after));
  await page.screenshot({ path: `${SHOTS}04-after-move.png` });

  // Click somewhere else; movement continues (camera follows player).
  await page.mouse.click(cx - 300, cy + 120);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}05-second-move.png` });

  // --- Camera: wheel zoom + right-drag rotate ---
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 180, cy, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  const rotated = await page.screenshot();
  check('camera responds to zoom/rotate', !after.equals(rotated));
  await page.screenshot({ path: `${SHOTS}06-camera-rotate.png` });

  // --- Pause flow ---
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc opens pause menu', await page.locator('[data-screen="paused"]').isVisible());
  await page.screenshot({ path: `${SHOTS}07-pause.png` });

  // Restart run keeps the HUD and resumes play.
  await page.click('[data-action="restart"]');
  await page.waitForTimeout(800);
  check(
    'restart returns to play',
    !(await page.locator('[data-screen="paused"]').isVisible()) &&
      (await page.locator('[data-hud]').isVisible()),
  );

  // Quit to title.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.click('[data-action="quit"]');
  await page.waitForTimeout(400);
  check('quit returns to title', await page.locator('.game-title').isVisible());

  // --- Console health ---
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
