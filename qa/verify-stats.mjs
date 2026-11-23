/**
 * Stats rework browser QA: three primary attributes, three defence layers
 * (armour / evasion / energy shield) and the Attack-vs-Spell damage split.
 * Verifies class identity in the derived stats, the HUD energy shield bar and
 * absorption, out-of-combat recharge, armour mitigation on attack hits,
 * spell hits bypassing armour, evasion feedback, and the character sheet.
 *
 * Run: node qa/verify-stats.mjs   (starts `vite preview` on :4173 itself)
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
  const startRun = async (classId) => {
    await page.click('[data-action="new-game"]');
    await page.waitForTimeout(250);
    await page.click(`[data-class="${classId}"]`);
    await page.click('[data-action="begin"]');
    await page.waitForTimeout(800);
  };
  const quitRun = async () => {
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.click('[data-screen="paused"] [data-action="quit"]');
    await sleep(300);
  };

  // ============ Class identity in the derived stats ============
  const statsByClass = {};
  for (const classId of ['marauder', 'ranger', 'witch']) {
    await startRun(classId);
    statsByClass[classId] = (await snap()).stats;
    await quitRun();
  }
  const w = statsByClass.marauder;
  const r = statsByClass.ranger;
  const c = statsByClass.witch;

  check('warrior identity: strength drives armour', w.armour > r.armour && w.armour > c.armour,
    `armour w ${w.armour} > r ${r.armour} >? c ${c.armour}`);
  check('archer identity: dexterity drives evasion', r.evasion > w.evasion && r.evasion > c.evasion,
    `evasion r ${r.evasion} > w ${w.evasion} >? c ${c.evasion}`);
  check('witch identity: intelligence drives energy shield', c.energyShield > w.energyShield && c.energyShield > r.energyShield,
    `es c ${c.energyShield} > w ${w.energyShield} >? r ${r.energyShield}`);
  check('attributes are the primary stats', w.strength > r.strength && r.dexterity > w.dexterity && c.intelligence > w.intelligence,
    `w STR ${w.strength}, r DEX ${r.dexterity}, c INT ${c.intelligence}`);
  check('attack/spell damage split follows the class kit',
    w.attackDamagePct > w.spellDamagePct && r.attackDamagePct > r.spellDamagePct && c.spellDamagePct > c.attackDamagePct,
    `w atk ${w.attackDamagePct}/spl ${w.spellDamagePct}, r atk ${r.attackDamagePct}, c spl ${c.spellDamagePct}`);

  // ============ Energy shield: HUD bar, absorption, recharge ============
  await startRun('witch');
  await page.evaluate(() => window.__ashen.clearEnemies()); // timing checks need a quiet moor
  let s = await snap();
  check('energy shield pool is live for the witch', s.playerEnergyShield === s.playerMaxEnergyShield && s.playerMaxEnergyShield > 0,
    `${s.playerEnergyShield}/${s.playerMaxEnergyShield}`);
  const esBarVisible = await page.locator('[data-es-bar]').isVisible();
  check('HUD energy shield bar renders', esBarVisible);

  await page.evaluate(() => window.__ashen.hurtPlayer(5));
  s = await snap();
  check('the shield absorbs before life', s.playerHp === s.playerMaxHp && s.playerEnergyShield < s.playerMaxEnergyShield,
    `hp ${s.playerHp}, es ${s.playerEnergyShield}/${s.playerMaxEnergyShield}`);
  await page.screenshot({ path: `${SHOTS}40-energy-shield.png` });

  await sleep(3500); // recharge delay + refill
  s = await snap();
  check('the shield recharges out of combat', s.playerEnergyShield === s.playerMaxEnergyShield,
    `es ${s.playerEnergyShield}/${s.playerMaxEnergyShield}`);

  // ============ Armour mitigates attacks; spells bypass it ============
  await page.evaluate(() => window.__ashen.setDefences(0, 0));
  const beforeBare = (await snap()).run.damageTaken;
  await page.evaluate(() => window.__ashen.hurtPlayerAttack(20));
  const bare = (await snap()).run.damageTaken - beforeBare;

  await page.evaluate(() => window.__ashen.setDefences(200, 0));
  const beforeArmored = (await snap()).run.damageTaken;
  await page.evaluate(() => window.__ashen.hurtPlayerAttack(20));
  const armored = (await snap()).run.damageTaken - beforeArmored;
  check('armour mitigates attack hits', armored > 0 && armored < bare, `bare ${bare} -> armoured ${armored}`);

  await page.evaluate(() => window.__ashen.setDefences(5000, 0));
  const beforeSpell = (await snap()).run.damageTaken;
  await page.evaluate(() => window.__ashen.hurtPlayer(20)); // spell damage
  const spell = (await snap()).run.damageTaken - beforeSpell;
  check('spells bypass armour entirely', spell === 20, `spell hit took ${spell}`);

  // ============ Evasion: attack hits can miss entirely ============
  await page.evaluate(() => window.__ashen.setDefences(0, 100000));
  const evadesBefore = (await snap()).run.evades;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.__ashen.hurtPlayerAttack(1));
    await page.evaluate(() => window.__ashen.healPlayer(9999));
  }
  s = await snap();
  check('evasion turns attack hits into misses', s.run.evades > evadesBefore,
    `${s.run.evades - evadesBefore} evades in 30 swings (chance ${s.stats.evadeChance})`);
  let evadeTextSeen = false;
  for (let i = 0; i < 25 && !evadeTextSeen; i++) {
    await page.evaluate(() => window.__ashen.hurtPlayerAttack(1));
    await sleep(60);
    evadeTextSeen = (await page.locator('.floating-text--player-miss').count()) > 0;
    await page.evaluate(() => window.__ashen.healPlayer(9999));
  }
  check('misses report as Evaded combat text', evadeTextSeen);
  await page.screenshot({ path: `${SHOTS}41-evaded.png` });

  // ============ Character sheet ============
  await page.keyboard.press('i');
  await sleep(300);
  const sheet = await page.locator('.char-sheet').innerText();
  check('character sheet lists the three attributes', /STR \d+ · DEX \d+ · INT \d+/.test(sheet), sheet.split('\n')[1] ?? '');
  check('character sheet lists the three defences', /Armour \d+ · Evasion \d+ · Energy Shield \d+/.test(sheet));
  check('character sheet reads damage as added and increased',
    /\+\d+ added · \d+% increased/.test(sheet) && /ATTACK DAMAGE/.test(sheet) && /SPELL DAMAGE/.test(sheet));
  await page.screenshot({ path: `${SHOTS}42-character-sheet.png` });
  await page.keyboard.press('Escape');
  await sleep(200);

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
