/**
 * Post-release QA: terrain grounding, fixed 45° camera with close zoom,
 * HUD declutter, and the skill-point/loadout system (RMB + QWERF).
 *
 * Run: node qa/verify-postrelease.mjs
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
  const terrain = (x, z) => page.evaluate(([a, b]) => window.__ashen.terrainHeightAt(a, b), [x, z]);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(200);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await sleep(900);

  // --- HUD declutter + fixed camera ---
  check('the persistent bottom guide is gone', (await page.locator('.hud__hints').count()) === 0);
  let s = await snap();
  check('the camera starts at a fixed 45° yaw', Math.abs(s.camera.yaw - Math.PI / 4) < 1e-9, `${s.camera.yaw}`);
  await page.mouse.move(720, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(900, 450, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await sleep(200);
  check('right drag does not rotate the camera', (await snap()).camera.yaw === s.camera.yaw);
  await page.mouse.wheel(0, -2000);
  await sleep(250);
  s = await snap();
  check('zooming in is clamped to 12 units', s.camera.distance === 12, `distance ${s.camera.distance}`);
  await page.mouse.wheel(0, 2000);
  await sleep(250);
  s = await snap();
  check('zooming out is clamped to a close 21 units', s.camera.distance === 21, `distance ${s.camera.distance}`);
  await page.keyboard.press('Escape');
  await sleep(200);
  check('pause controls replace the guide', (await page.locator('.controls').innerText()).includes('Q W E R F'));
  await page.keyboard.press('Escape');
  await sleep(200);

  // --- Grounding: find a raised walkable point and verify every ground layer ---
  const raised = await page.evaluate(() => {
    const corridor = window.__ashen.snapshot().corridor;
    const distanceToCorridor = (x, z) => {
      let depth = Infinity;
      for (let i = 0; i < corridor.points.length - 1; i++) {
        const a = corridor.points[i];
        const b = corridor.points[i + 1];
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const lengthSq = vx * vx + vz * vz;
        const t = lengthSq > 0
          ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / lengthSq))
          : 0;
        depth = Math.min(depth, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)));
      }
      return depth;
    };
    let best = { x: 0, z: 0, h: -1 };
    for (let x = -110; x <= 110; x += 3) {
      for (let z = -110; z <= 110; z += 3) {
        if (distanceToCorridor(x, z) > corridor.radius - 1.2) continue;
        const h = window.__ashen.terrainHeightAt(x, z);
        if (h > best.h) best = { x, z, h };
      }
    }
    return best;
  });
  check('the terrain probe finds a raised walkable point', raised.h > 0.05,
    `height ${raised.h.toFixed(3)} at ${raised.x},${raised.z}`);
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [raised.x, raised.z]);
  await sleep(500);
  s = await snap();
  check('the hero stands on the terrain height', Math.abs(s.playerRenderY - raised.h) < 0.03,
    `render ${s.playerRenderY.toFixed(3)} vs terrain ${raised.h.toFixed(3)}`);

  await page.mouse.click(720, 600);
  await sleep(120);
  s = await snap();
  const destMarker = s.markers.destination;
  const destHeight = destMarker ? await terrain(destMarker.x, destMarker.z) : 0;
  check('the move marker sits on the destination ground',
    destMarker !== null && Math.abs(destMarker.y - (destHeight + 0.035)) < 0.03,
    JSON.stringify({ marker: destMarker, terrain: destHeight }));
  await page.screenshot({ path: `${SHOTS}90-postrelease-grounding.png` });

  await page.mouse.move(560, 430);
  await sleep(150);
  s = await snap();
  const hoverMarker = s.markers.hover;
  const hoverHeight = hoverMarker ? await terrain(hoverMarker.x, hoverMarker.z) : 0;
  check('the hover ring sits on the ground',
    hoverMarker !== null && Math.abs(hoverMarker.y - (hoverHeight + 0.025)) < 0.03,
    JSON.stringify({ marker: hoverMarker, terrain: hoverHeight }));
  await page.evaluate(() => window.__ashen.healPlayer(9999));

  // --- Skill loadout: fresh state, picker unlock/equip, points, casts ---
  s = await snap();
  check('a fresh exile has one active skill in Q',
    s.skills.filter((skill) => skill.id !== null).length === 1 &&
    s.skills.find((skill) => skill.slot === 'q')?.id === 'sunder');
  check('the hotbar has six slots and five empties',
    (await page.locator('.slot').count()) === 6 && (await page.locator('.slot--empty').count()) === 5);
  check('the fresh skill budget is zero', s.skillPoints.total === 0 && s.skillPoints.available === 0);

  await page.evaluate(() => window.__ashen.grantXp(5000));
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  await sleep(400);
  s = await snap();
  check('levels grant skill points', s.skillPoints.total === s.level - 1 && s.skillPoints.available >= 7,
    JSON.stringify(s.skillPoints));

  await page.click('[data-skill-slot="w"]');
  await sleep(250);
  check('clicking an empty slot opens the picker for that slot',
    await page.locator('.skill-screen').isVisible() &&
    (await page.locator('[data-skill-target-label]').innerText()).toLowerCase().includes('assigning to w'));
  check('clicking a hotbar slot does not cast', (await snap()).cooldowns.whirlwind === undefined);

  await page.locator('[data-skill-unlock="whirlwind"]').click();
  await sleep(200);
  await page.locator('[data-skill-equip="whirlwind"]').click();
  await sleep(250);
  s = await snap();
  check('unlocking spends one skill point', s.skillPoints.spent === 1 && s.skillPoints.available === s.skillPoints.total - 1,
    JSON.stringify(s.skillPoints));
  check('the unlocked skill equips into the chosen slot', s.skills.find((slot) => slot.slot === 'w')?.id === 'whirlwind');

  await page.locator('[data-skill-target="q"]').click();
  await page.locator('[data-skill-upgrade="sunder"]').click();
  await sleep(250);
  s = await snap();
  const sunder = s.skills.find((skill) => skill.slot === 'q');
  check('upgrading a skill raises its rank and cost', sunder?.rank === 2 && s.skillPoints.spent === 2,
    JSON.stringify({ sunder, points: s.skillPoints }));
  check('rank upgrade lowers the effective cooldown', sunder?.cooldown === 4.8, `${sunder?.cooldown}s`);

  await page.locator('[data-skill-target="rmb"]').click();
  await page.locator('[data-skill-equip="whirlwind"]').click();
  await sleep(250);
  await page.keyboard.press('Escape');
  await sleep(200);
  s = await snap();
  check('the skill moves to the RMB slot', s.skills.find((slot) => slot.slot === 'rmb')?.id === 'whirlwind' &&
    s.skills.find((slot) => slot.slot === 'w')?.id === null);

  // Right click casts the RMB skill; F casts the F slot after one more unlock.
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  const beforeMana = (await snap()).playerMana;
  await page.mouse.click(720, 300, { button: 'right' });
  await sleep(180);
  s = await snap();
  check('right click casts the RMB skill', s.cooldowns.whirlwind > 0 && s.playerMana < beforeMana,
    `cooldown ${s.cooldowns.whirlwind}, mana ${beforeMana.toFixed(1)} -> ${s.playerMana.toFixed(1)}`);

  await page.keyboard.press('k');
  await sleep(200);
  await page.locator('[data-skill-target="f"]').click();
  await page.locator('[data-skill-unlock="reckless-charge"]').click();
  await sleep(200);
  await page.locator('[data-skill-equip="reckless-charge"]').click();
  await sleep(250);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  await page.keyboard.press('f');
  await sleep(200);
  s = await snap();
  check('F casts the F-slot skill', s.cooldowns['reckless-charge'] > 0,
    `cooldown ${s.cooldowns['reckless-charge']}`);
  await page.screenshot({ path: `${SHOTS}91-postrelease-loadout.png` });

  // --- Save/reload keeps the loadout and ranks ---
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('[data-screen="paused"] [data-action="quit"]');
  await sleep(400);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
  await page.click('[data-action="continue-run"]');
  await sleep(900);
  s = await snap();
  check('Continue restores the six-slot loadout and ranks',
    s.skills.find((slot) => slot.slot === 'q')?.rank === 2 &&
    s.skills.find((slot) => slot.slot === 'rmb')?.id === 'whirlwind' &&
    s.skills.find((slot) => slot.slot === 'f')?.id === 'reckless-charge',
    JSON.stringify(s.skills));
  check('Continue restores the spent skill points', s.skillPoints.spent === 3,
    JSON.stringify(s.skillPoints));
  await page.screenshot({ path: `${SHOTS}92-postrelease-continue.png` });

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
