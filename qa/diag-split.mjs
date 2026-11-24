import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = startPreviewServer(4173);
await sleep(1500);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173', { waitUntil: 'networkidle' });
await sleep(600);
const snap = () => page.evaluate(() => window.__ashen.snapshot());
const clickWorld = async (x, z) => {
  const { x: sx, y: sy } = await page.evaluate(([a, b]) => window.__ashen.worldToScreen(a, b), [x, z]);
  await page.mouse.click(Math.min(1410, Math.max(30, sx)), Math.min(870, Math.max(30, sy)));
};
for (let run = 0; run < 3; run++) {
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(250);
  await page.click('[data-class="ranger"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(800);
  // engage (simplified): click nearest on-screen enemy
  let s = await snap();
  const alive = [...s.enemies].filter((e) => !e.dead);
  let picked = null;
  for (const e of alive) {
    const scr = await page.evaluate(([x, z]) => window.__ashen.worldToScreen(x, z), [e.x, e.z]);
    if (scr.x > 60 && scr.x < 1380 && scr.y > 60 && scr.y < 840) { picked = { e, scr }; break; }
  }
  if (picked) await page.mouse.click(picked.scr.x, picked.scr.y);
  await sleep(250);
  s = await snap();
  console.log(`run ${run}: attackTarget=${s.attackTargetId} mana=${s.playerMana.toFixed(0)} proj=${s.projectiles}`);
  await page.keyboard.press('w');
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(40);
    s = await snap();
    peak = Math.max(peak, s.projectiles);
    if (i % 6 === 0) console.log(`  t${i}: proj=${s.projectiles} cds=${JSON.stringify(s.cooldowns)} mana=${s.playerMana.toFixed(0)} atk=${s.attackTargetId}`);
  }
  console.log(`  peak=${peak}`);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('[data-screen="paused"] [data-action="quit"]');
  await sleep(300);
}
await browser.close();
stopServer(server);
