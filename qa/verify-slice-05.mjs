/**
 * Slice 5 browser QA: skills & flasks. Verifies the full combat kit —
 * QWER hotbar with mana costs and cooldown sweeps, nova / ground / spread /
 * dash deliveries, mana gating with refusal feedback, health and mana flasks
 * with refill-on-kill charges, and the formalized death -> checkpoint retry
 * flow with a death recap.
 *
 * Run: node qa/verify-slice-05.mjs   (starts `vite preview` on :4173 itself)
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
  const startRun = async (classId) => {
    await page.click('[data-action="new-game"]');
    await page.waitForTimeout(250);
    await page.click(`[data-class="${classId}"]`);
    await page.click('[data-action="begin"]');
    await page.waitForTimeout(800);
  };
  const hasToast = (text) => page.locator('.toast', { hasText: text }).first().isVisible();
  /** Poll for a toast instead of trusting a fixed sleep. */
  const waitForToast = async (text, timeoutMs = 2500) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await hasToast(text)) return true;
      await sleep(80);
    }
    return false;
  };
  /** Engage the nearest on-screen enemy so skill aim keys off the attack target. */
  const engage = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const s = await snap();
      const alive = [...s.enemies].filter((e) => !e.dead);
      if (alive.length === 0) return null;
      const scored = [];
      for (const e of alive) {
        const scr = await page.evaluate(([x, z]) => window.__ashen.worldToScreen(x, z), [e.x, e.z]);
        scored.push({
          e,
          scr,
          onScreen: scr.x > 60 && scr.x < 1380 && scr.y > 60 && scr.y < 840,
          d: (e.x - s.playerPos.x) ** 2 + (e.z - s.playerPos.z) ** 2,
        });
      }
      scored.sort((a, b) => (b.onScreen - a.onScreen) || (a.d - b.d));
      const pick = scored[0];
      if (pick.onScreen) {
        await page.mouse.click(pick.scr.x, pick.scr.y);
        await sleep(250);
        const after = await snap();
        if (after.attackTargetId === pick.e.id) return pick.e;
      } else {
        await clickWorld(pick.e.x, pick.e.z); // walk the enemy into view first
        await sleep(600);
      }
    }
    return null;
  };
  /** Engage, then wait until the hero is close enough for a melee-range skill. */
  const engageClose = async (radius) => {
    for (let round = 0; round < 3; round++) {
      const target = await engage();
      if (!target) return null;
      for (let i = 0; i < 100; i++) {
        await page.evaluate(() => window.__ashen.healPlayer(9999));
        const s = await snap();
        const enemy = s.enemies.find((e) => e.id === target.id && !e.dead);
        if (!enemy) break; // the target died mid-approach: pick another
        if (s.attackTargetId === target.id && Math.hypot(enemy.x - s.playerPos.x, enemy.z - s.playerPos.z) < radius) {
          return enemy;
        }
        await sleep(100);
      }
    }
    return null;
  };
  /** Wait for a skill cooldown to finish so the next gate test is unambiguous. */
  const waitCooldown = async (skillId) => {
    for (let i = 0; i < 100; i++) {
      const s = await snap();
      if (!(s.cooldowns[skillId] > 0)) return;
      await sleep(100);
    }
  };

  // ============ Marauder: hotbar, deliveries, gating, flasks, recap ============
  await startRun('marauder');

  // --- Hotbar shell: six PoE slots; a fresh exile has only the signature ---
  const slots = await page.locator('.slot').evaluateAll((els) =>
    els.map((el) => ({ slot: el.getAttribute('data-skill-slot'), key: el.querySelector('.slot__key')?.textContent })));
  check('hotbar shows six PoE slots (RMB + QWERF)', slots.length === 6 &&
    slots.map((s) => s.slot).join('') === 'rmbqwerf' &&
    slots.map((s) => s.key).join(',') === 'RMB,Q,W,E,R,F', JSON.stringify(slots));
  check('a fresh exile starts with one equipped skill', (await page.locator('.slot:not(.slot--empty)').count()) === 1);
  check('the other five slots are empty and assignable', (await page.locator('.slot--empty').count()) === 5);
  check('the equipped skill advertises its mana cost', (await page.locator('.slot__cost').allTextContents()).length === 1);
  check('flask slots show full charge pips', (await page.locator('.pip--full').count()) === 8);

  // Unlock and equip the legacy QWER kit through the real loadout rules.
  await page.evaluate(() => {
    window.__ashen.grantXp(5000);
    window.__ashen.unlockSkill('whirlwind');
    window.__ashen.unlockSkill('reckless-charge');
    window.__ashen.equipSkill('w', 'sunder');
    window.__ashen.equipSkill('e', 'whirlwind');
    window.__ashen.equipSkill('r', 'reckless-charge');
  });
  await sleep(300);
  check('unlocked skills can be assigned to any slot', (await page.locator('.slot:not(.slot--empty)').count()) === 3);

  // --- Ground strike (W): mana spend, cooldown sweep, telegraph, burst ---
  let s = await snap();
  let target = await engageClose(3.5);
  s = await snap();
  const manaBefore = s.playerMana;
  const strikeTargetHp = target ? s.enemies.find((e) => e.id === target.id)?.hp : null;
  await page.keyboard.press('w');
  await sleep(120);
  s = await snap();
  const manaAfter = s.playerMana;
  check('casting Sunder spends mana', manaAfter < manaBefore, `mana ${manaBefore.toFixed(1)} -> ${manaAfter.toFixed(1)}`);
  check('cooldown sweep appears on the used slot', await page.locator('.slot[data-skill-slot="w"].slot--cooling').count() === 1);

  let sawStrike = false;
  for (let i = 0; i < 40 && !sawStrike; i++) {
    s = await snap();
    sawStrike = s.strikes > 0;
    if (!sawStrike) await sleep(30);
  }
  check('ground strike telegraph appears in the world', sawStrike);
  await page.screenshot({ path: `${SHOTS}30-skills-hotbar.png` });

  let strikeLanded = false;
  for (let i = 0; i < 60 && !strikeLanded; i++) {
    await sleep(40);
    s = await snap();
    const hp = target ? s.enemies.find((e) => e.id === target.id)?.hp : null;
    strikeLanded = s.strikes === 0 && (strikeTargetHp === null || hp < strikeTargetHp);
  }
  check('ground strike resolves its fuse and bursts', strikeLanded,
    `target hp ${strikeTargetHp} -> ${target ? (await snap()).enemies.find((e) => e.id === target.id)?.hp : '?'}`);

  // --- Cooldown gating: immediate recast refuses with feedback ---
  await page.keyboard.press('w');
  check('recast on cooldown is refused with feedback', await waitForToast('recharging'));
  s = await snap();
  check('refused recast does not spend mana', s.playerMana >= manaAfter);

  // --- Nova (E): damages nearby enemies ---
  await waitCooldown('sunder');
  target = await engageClose(2.5);
  const novaVictimHp = target ? (await snap()).enemies.find((e) => e.id === target.id)?.hp : null;
  await page.keyboard.press('e');
  await sleep(700);
  s = await snap();
  const novaHpAfter = target ? s.enemies.find((e) => e.id === target.id)?.hp : null;
  check('Whirlwind nova damages nearby enemies', novaVictimHp !== null && novaHpAfter < novaVictimHp,
    `hp ${novaVictimHp} -> ${novaHpAfter}`);

  // --- Dash (R): the hero travels ---
  const beforeDash = (await snap()).playerPos;
  await page.keyboard.press('r');
  await sleep(1400); // let the committed charge finish before measuring
  const afterDash = (await snap()).playerPos;
  const dashDist = Math.hypot(afterDash.x - beforeDash.x, afterDash.z - beforeDash.z);
  check('Reckless Charge carries the hero forward', dashDist > 3, `travelled ${dashDist.toFixed(1)}`);

  // --- Mana gating: empty pool refuses and marks the slot ---
  await waitCooldown('whirlwind');
  await page.evaluate(() => window.__ashen.drainMana(99999));
  await page.keyboard.press('e');
  check('cast without mana is refused with feedback', await waitForToast('not enough mana'));
  check('unaffordable slot is dimmed', await page.locator('.slot[data-skill-slot="e"].slot--unaffordable').count() === 1);
  await page.screenshot({ path: `${SHOTS}31-mana-gate.png` });

  // --- Flasks: drink, charges drop, kills refill ---
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  await page.evaluate(() => window.__ashen.hurtPlayer(70));
  s = await snap();
  const hpHurt = s.playerHp;
  await page.keyboard.press('1');
  await sleep(150);
  s = await snap();
  check('health flask restores health', s.playerHp > hpHurt, `hp ${hpHurt} -> ${s.playerHp}`);
  check('drinking consumes a charge', s.flasks.health === s.flasks.max - 1, `charges ${s.flasks.health}/${s.flasks.max}`);
  await page.screenshot({ path: `${SHOTS}32-flask-use.png` });

  await page.evaluate(() => window.__ashen.setFlaskCharges('health', 0));
  await page.keyboard.press('1');
  check('empty flask refuses with refill hint', await waitForToast('no charges'));

  await page.evaluate(() => window.__ashen.setFlaskCharges('health', 0));
  const killTarget = await engage();
  for (let i = 0; i < 45 && killTarget; i++) {
    s = await snap();
    const t = s.enemies.find((e) => e.id === killTarget.id);
    if (!t || t.dead) break;
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    await clickWorld(t.x, t.z);
    await sleep(450);
  }
  s = await snap();
  check('kills refill flask charges', s.flasks.health > 0, `charges ${s.flasks.health}/${s.flasks.max}`);

  // --- Death recap + checkpoint retry ---
  const preDeath = await snap();
  await page.evaluate(() => window.__ashen.hurtPlayer(99999));
  await sleep(400);
  const deathVisible = await page.locator('[data-screen="death"]').isVisible();
  check('death screen shows the recap', deathVisible);
  const killer = await page.locator('[data-recap-killer]').textContent();
  const kills = await page.locator('[data-recap-kills]').textContent();
  check('recap names the killing blow', (killer ?? '').length > 0, `slain by ${killer}`);
  check('recap counts the run', Number(kills) === preDeath.run.kills, `${kills} kills recorded`);
  await page.screenshot({ path: `${SHOTS}33-death-recap.png` });

  await page.click('[data-action="respawn"]');
  await sleep(400);
  s = await snap();
  check('rise again restores the hero at the checkpoint', s.playerHp === s.playerMaxHp && !s.dead);
  check('rise again refills flasks and mana', s.flasks.health === s.flasks.max && s.playerMana > s.playerMaxMana * 0.9,
    `flasks ${s.flasks.health}/${s.flasks.max}, mana ${s.playerMana.toFixed(0)}/${s.playerMaxMana}`);
  check('rise again keeps progression', s.level === preDeath.level, `level ${s.level}`);

  // ============ Ranger: spread fan, snipe, arrow rain ============
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('[data-screen="paused"] [data-action="quit"]');
  await sleep(300);
  await startRun('ranger');
  await page.evaluate(() => {
    window.__ashen.grantXp(5000);
    window.__ashen.unlockSkill('snipe');
    window.__ashen.unlockSkill('rain-of-arrows');
    window.__ashen.equipSkill('w', 'split-shot');
    window.__ashen.equipSkill('e', 'snipe');
    window.__ashen.equipSkill('r', 'rain-of-arrows');
  });
  await sleep(300);

  // --- Split Shot: the fan must be visible in flight ---
  await page.evaluate(() => window.__ashen.clearEnemies()); // clear sky for the fan
  const splitMana = (await snap()).playerMana;
  await page.keyboard.press('w'); // Split Shot
  let peakProjectiles = 0;
  for (let i = 0; i < 25; i++) {
    s = await snap();
    peakProjectiles = Math.max(peakProjectiles, s.projectiles);
    await sleep(40);
  }
  check('Split Shot looses a fan of three arrows', peakProjectiles >= 3, `peak ${peakProjectiles} projectiles`);
  check('Split Shot pays its mana', s.playerMana < splitMana);
  await page.screenshot({ path: `${SHOTS}34-split-shot.png` });

  const rangerMana = (await snap()).playerMana;
  await page.keyboard.press('e'); // Snipe
  await sleep(150);
  s = await snap();
  check('Snipe is a paid skill', s.playerMana < rangerMana);

  await page.keyboard.press('r'); // Rain of Arrows
  let rainStrike = false;
  for (let i = 0; i < 30 && !rainStrike; i++) {
    s = await snap();
    rainStrike = s.strikes > 0;
    if (!rainStrike) await sleep(50);
  }
  check('Rain of Arrows marks its landing zone', rainStrike);
  await page.screenshot({ path: `${SHOTS}35-rain-of-arrows.png` });

  // ============ Witch: nova kit sanity ============
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('[data-screen="paused"] [data-action="quit"]');
  await sleep(300);
  await startRun('witch');
  await page.evaluate(() => window.__ashen.equipSkill('w', 'ember-nova'));
  await sleep(200);

  target = await engageClose(2.5);
  let witchVictimHp = target ? (await snap()).enemies.find((e) => e.id === target.id)?.hp : null;
  if (target) {
    await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z + 0.8), [target.x, target.z]);
    await sleep(120);
    witchVictimHp = (await snap()).enemies.find((e) => e.id === target.id)?.hp ?? witchVictimHp;
  }
  await page.keyboard.press('w'); // Ember Nova
  for (let i = 0; i < 25; i++) {
    if ((await snap()).cooldowns['ember-nova'] > 0) break;
    await page.keyboard.press('w');
    await sleep(80);
  }
  await sleep(700);
  s = await snap();
  const witchVictim = target ? s.enemies.find((e) => e.id === target.id) : null;
  const witchHpAfter = witchVictim ? (witchVictim.dead ? 0 : witchVictim.hp) : 0;
  check('Ember Nova burns everything around the caster',
    witchVictimHp !== null && (witchVictim === null || witchVictim.dead || witchHpAfter < witchVictimHp),
    `hp ${witchVictimHp} -> ${witchHpAfter}`);

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
