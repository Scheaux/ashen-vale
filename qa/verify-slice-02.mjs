/**
 * Slice 2 browser QA: full combat playthrough — click-to-attack an enemy,
 * verify damage numbers, health bar loss, enemy death, enemy retaliation,
 * and the death/respawn flow. Uses the game's debug hook for numeric
 * assertions instead of fragile pixel matching.
 *
 * Run: node qa/verify-slice-02.mjs   (starts `vite preview` on :4173 itself)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(1000);

  const snap = () => page.evaluate(() => window.__ashen.snapshot());
  const toScreen = (x, z) => page.evaluate(([x2, z2]) => window.__ashen.worldToScreen(x2, z2), [x, z]);
  const clickWorld = async (x, z) => {
    const { x: sx, y: sy } = await toScreen(x, z);
    // Off-screen targets project outside the viewport; clamp so the click
    // still drives movement in their direction, and retry until close.
    const cx = Math.min(1410, Math.max(30, sx));
    const cy = Math.min(870, Math.max(30, sy));
    await page.mouse.click(cx, cy);
  };

  // --- Enter the game as the Marauder (melee: easiest contact to verify) ---
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(300);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(1200);

  let s = await snap();
  check('run starts with enemies in the zone', s.enemies.length >= 5, `${s.enemies.length} husks`);
  check('player starts at full health', s.playerHp === s.playerMaxHp, `${s.playerHp}/${s.playerMaxHp}`);

  // --- Pick the nearest enemy and attack it to death ---
  const dist2 = (e) => (e.x - s.playerPos.x) ** 2 + (e.z - s.playerPos.z) ** 2;
  const targetId = [...s.enemies].sort((a, b) => dist2(a) - dist2(b))[0].id;

  let sawDamageNumbers = false;
  let sawHpDrop = false;
  let killed = false;
  let lastHp = Infinity;

  for (let i = 0; i < 60; i++) {
    s = await snap();
    const target = s.enemies.find((e) => e.id === targetId);
    if (!target || target.dead) {
      killed = true;
      break;
    }
    if (target.hp < target.maxHp) sawHpDrop = true;
    if (target.hp > lastHp) check('enemy hp never regenerates', false, `tick ${i}`);
    lastHp = target.hp;

    await clickWorld(target.x, target.z);
    for (let poll = 0; poll < 10; poll++) {
      if ((await page.locator('.floating-text').count()) > 0) {
        sawDamageNumbers = true;
        break;
      }
      await sleep(80);
    }
    await sleep(120);
    // Observe mid-gap: two swings land 0.85s apart and can kill inside one
    // long poll window (the screenshot below stretches it).
    s = await snap();
    const mid = s.enemies.find((e) => e.id === targetId);
    if (mid && mid.hp < mid.maxHp) sawHpDrop = true;
    if (mid && mid.hp > lastHp) check('enemy hp never regenerates', false, `tick ${i}b`);
    lastHp = mid ? mid.hp : lastHp;
    if (mid && mid.dead) {
      killed = true;
      break;
    }
    await sleep(350);
    if (i === 3) await page.screenshot({ path: `${SHOTS}10-combat.png` });
  }

  check('clicking an enemy deals damage to it', sawHpDrop || killed, `hpDrop ${sawHpDrop}, killed ${killed}`);
  check('floating damage numbers appear', sawDamageNumbers);
  check('enemy dies and leaves play', killed);
  await page.screenshot({ path: `${SHOTS}11-enemy-down.png` });

  // --- Enemy retaliation: player took damage during the fight ---
  s = await snap();
  check('enemy fights back (player lost vitality)',
    s.playerHp + s.playerEnergyShield < s.playerMaxHp + s.playerMaxEnergyShield,
    `${s.playerHp}+${s.playerEnergyShield}/${s.playerMaxHp}+${s.playerMaxEnergyShield}`);

  // Pause first: the camp keeps swinging, and a frozen sim makes the HUD
  // comparison exact instead of racy.
  await page.keyboard.press('Escape');
  await sleep(150);
  s = await snap();
  const hpText = await page.locator('[data-hp-text]').textContent();
  // The HUD rounds HP; the sim can hold fractional damage mid-fight.
  check('HUD health readout updates', (hpText ?? '').includes(String(Math.round(s.playerHp))), hpText ?? '');
  await page.keyboard.press('Escape'); // resume
  await sleep(150);

  // --- Projectile class: ranger arrow kills at range ---
  await page.keyboard.press('Escape'); // pause
  await page.waitForTimeout(250);
  await page.click('[data-screen="paused"] [data-action="quit"]');
  await page.waitForTimeout(350);
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(300);
  await page.click('[data-class="ranger"]');
  await page.click('[data-action="begin"]');
  await page.waitForTimeout(1000);

  const distToPlayer = (e) => (e.x - s.playerPos.x) ** 2 + (e.z - s.playerPos.z) ** 2;
  s = await snap();
  const rangerTarget = [...s.enemies].sort((a, b) => distToPlayer(a) - distToPlayer(b))[0].id;
  let arrowHit = false;
  for (let i = 0; i < 40; i++) {
    s = await snap();
    const target = s.enemies.find((e) => e.id === rangerTarget);
    if (!target || target.dead) break;
    if (target.hp < target.maxHp) arrowHit = true;
    await clickWorld(target.x, target.z);
    await sleep(600);
    if (i === 4) await page.screenshot({ path: `${SHOTS}12-ranger-shot.png` });
  }
  check('ranger projectile damages at range', arrowHit);

  // --- Death & respawn: fight until hurt, then force the edge state ---
  s = await snap();
  const pack = s.enemies.find((e) => !e.dead);
  if (pack) {
    await clickWorld(pack.x, pack.z);
    await sleep(1500);
  }
  for (let i = 0; i < 6; i++) {
    const cur = await snap();
    if (cur.dead) break;
    await page.evaluate(() => window.__ashen.hurtPlayer(30));
    await sleep(150);
  }
  s = await snap();
  if (s.dead) {
    check('player death shows the fallen screen', await page.locator('[data-screen="death"]').isVisible());
    await page.screenshot({ path: `${SHOTS}13-you-have-fallen.png` });
    await page.click('[data-action="respawn"]');
    await page.waitForTimeout(500);
    const after = await snap();
    check('respawn restores full health at spawn', after.playerHp === after.playerMaxHp && !after.dead);
    check('respawn returns to play', after.mode === 'playing');
  } else {
    check('death/respawn flow exercised', false, 'player never reached 0 hp');
  }

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
