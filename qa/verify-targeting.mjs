import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';

const base = process.env.QA_URL ?? 'http://localhost:4173';
const server = process.env.QA_URL ? null : startPreviewServer(4173);
const viewport = { width: 1440, height: 900 };
const onScreen = ({ x, y }) => x > 50 && x < viewport.width - 50 && y > 50 && y < viewport.height - 50;
let browser;
try {
  const deadline = Date.now() + 20_000;
  while (true) {
    if (await fetch(base).then((response) => response.ok, () => false)) break;
    if (Date.now() >= deadline) throw new Error(`Preview not reachable at ${base}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.click('[data-action="new-game"]');
  await page.click('[data-action="begin"]');
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, 1800);

  const snapshot = () => page.evaluate(() => window.__ashen.snapshot());
  const project = (x, z, y) => page.evaluate(([x, z, y]) => window.__ashen.worldToScreen(x, z, y), [x, z, y]);
  const waitHover = (id) => page.waitForFunction((id) => window.__ashen.snapshot().hoverTargetId === id, id);
  const { enemies, playerPos } = await snapshot();
  const nearest = [...enemies].sort((a, b) =>
    Math.hypot(a.x - playerPos.x, a.z - playerPos.z) - Math.hypot(b.x - playerPos.x, b.z - playerPos.z));

  // Project a point just outside the nearest enemy's body, not on a pick mesh.
  const yaw = Math.PI * 0.22;
  let target = null;
  for (const enemy of nearest) {
    const [radius, height] = {
      'ashen-husk': [0.62, 0.81], 'cinder-cultist': [0.58, 0.925], 'mire-skitterer': [0.5, 0.51],
    }[enemy.type];
    const edge = await project(enemy.x + Math.cos(yaw) * radius, enemy.z - Math.sin(yaw) * radius, height);
    const point = { x: edge.x + 6, y: edge.y };
    if (!onScreen(point)) continue;
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(() => window.__ashen.snapshot().hoverTargetId !== null, undefined, { timeout: 1500 }).catch(() => {});
    if ((await snapshot()).hoverTargetId === enemy.id) {
      target = { id: enemy.id, point };
      break;
    }
  }
  assert.ok(target, 'an enemy locks on when the pointer is just outside its body');
  assert.equal(await page.locator('#game').evaluate((element) => getComputedStyle(element).cursor), 'pointer');
  await page.mouse.click(target.point.x, target.point.y);
  await page.waitForFunction((id) => window.__ashen.snapshot().attackTargetId === id, target.id);
  console.log('PASS  near-enemy hover and click agree');

  await page.locator('#game').dispatchEvent('pointerleave');
  await waitHover(null);
  assert.equal(await page.locator('#game').evaluate((element) => getComputedStyle(element).cursor), 'crosshair');
  console.log('PASS  leaving the canvas clears hover');

  // Nearest scenery to the hero: clicking it must read as ground, never a target.
  const scenery = await page.evaluate(() => window.__ashen.sceneryPoints());
  let sceneryClick = null;
  for (const point of scenery) {
    const projected = await project(point.x, point.z, 1.2);
    if (!onScreen(projected)) continue;
    await page.mouse.move(projected.x, projected.y);
    await page.waitForTimeout(150);
    if ((await snapshot()).hoverTargetId !== null) continue; // an enemy owns this pixel
    await page.mouse.click(projected.x, projected.y);
    await page.waitForTimeout(100);
    if ((await snapshot()).attackTargetId !== null) continue;
    sceneryClick = projected;
    break;
  }
  assert.ok(sceneryClick, 'scenery click lands on scenery');
  const start = (await snapshot()).playerPos;
  await page.waitForFunction(({ x, z }) => {
    const p = window.__ashen.snapshot().playerPos;
    return Math.hypot(p.x - x, p.z - z) > 0.5;
  }, start, { timeout: 4500 });
  assert.deepEqual(errors, []);
  console.log('PASS  clicking scenery clears the attack target and moves toward the ground');
} finally {
  await browser?.close();
  stopServer(server);
}
