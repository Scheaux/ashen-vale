/**
 * v1.3 combat-depth QA: fourth actives, rune trade-offs, volatile elite
 * hazards, the Warden's cinder pools, and camera occlusion.
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
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(200);
  await page.click('[data-class="marauder"]');
  await page.click('[data-action="begin"]');
  await sleep(900);

  // --- Camera occlusion: place the hero behind a tall prop relative to the camera ---
  const probeProps = () => page.evaluate(() => window.__ashen.propProbe());
  const preProps = await probeProps();
  check('prop probe exposes authored scenery instances',
    preProps.total > 0 && preProps.sample.length === preProps.total, `${preProps.total} props`);
  const tallProps = preProps.sample.filter((prop) => prop.tall);
  check('prop probe exposes tall occlusion targets', tallProps.length > 0, `${tallProps.length} tall props`);

  async function setZoom(distance) {
    for (let i = 0; i < 8; i++) {
      const current = (await snap()).camera.distance;
      if (Math.abs(current - distance) <= 0.1) return current;
      await page.mouse.move(720, 450);
      await page.mouse.wheel(0, (distance / current - 1) / 0.0012);
      await sleep(120);
    }
    return (await snap()).camera.distance;
  }

  const maxScaleDelta = (a, b) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

  let occluded = 0;
  let occlusionFade = 0;
  let occlusionZoom = 0;
  for (const zoom of [18, 12, 21]) {
    const actualZoom = await setZoom(zoom);
    let found = null;
    for (const point of tallProps.slice(0, 12)) {
      await page.evaluate(([x, z]) => {
        window.__ashen.healPlayer(9999);
        window.__ashen.teleportPlayer(x, z);
      }, [point.x - 2.2, point.z - 2.2]);
      await sleep(500);
      const probe = await probeProps();
      const target = probe.sample.find((sample) =>
        Math.abs(sample.x - point.x) < 1e-6 && Math.abs(sample.z - point.z) < 1e-6);
      if (probe.occluded > 0 && target && target.fade > 0.9) {
        found = { probe, target };
        break;
      }
    }
    occluded = found?.probe.occluded ?? 0;
    occlusionFade = found?.target.fade ?? 0;
    occlusionZoom = actualZoom;
    check(`tall props fade between the camera and the hero at zoom ${actualZoom.toFixed(1)}`,
      occluded > 0 && occlusionFade > 0.9,
      `${occluded} occluded props, target fade ${occlusionFade.toFixed(2)}`);

    const after = await probeProps();
    const scaleChanged = after.sample.length !== preProps.sample.length ||
      after.sample.some((sample, i) => maxScaleDelta(sample.scale, preProps.sample[i].scale) > 1e-6);
    const authoredMismatch = after.sample.findIndex((sample) =>
      maxScaleDelta(sample.scale, sample.authoredScale) > 1e-6);
    check(`authored prop scale is unchanged at zoom ${actualZoom.toFixed(1)}`,
      !scaleChanged && authoredMismatch === -1,
      scaleChanged
        ? 'live instance scale changed'
        : authoredMismatch >= 0
          ? `matrix/authored mismatch at sample ${authoredMismatch}`
          : `${after.total} scales stable`);
  }
  check('tall props fade between the camera and the hero', occluded > 0,
    `${occluded} occluded props at zoom ${occlusionZoom.toFixed(1)}, fade ${occlusionFade.toFixed(2)}`);
  const counts = await page.evaluate(() => ({
    snapshot: window.__ashen.snapshot().render.occludedProps,
    probe: window.__ashen.propProbe().occluded,
  }));
  check('the render snapshot keeps the occluded prop count', counts.snapshot === counts.probe,
    `${counts.snapshot} snapshot vs ${counts.probe} probe`);
  await page.screenshot({ path: `${SHOTS}93-occlusion.png` });
  await setZoom(18);

  // --- Volatile elite: kill it at close range, read the warning, take the blast ---
  const victim = await page.evaluate(() => {
    const snap = window.__ashen.snapshot();
    const p = snap.playerPos;
    return snap.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  });
  await page.evaluate(([id]) => window.__ashen.makeVolatile(id), [victim.id]);
  await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [victim.x + 1, victim.z]);
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 9999), [victim.id]);
  // The blast is placed at the victim's live position, which can differ from the
  // snapshot above. Poll the live hazard list and stand at its centre so the fuse
  // cannot expire around a stale teleport.
  let hazard = null;
  for (let i = 0; i < 20 && !hazard; i++) {
    const hazards = await page.evaluate(() => window.__ashen.hazardPoints());
    hazard = hazards.find((point) => point.kind === 'volatile') ?? null;
    if (!hazard) await sleep(50);
  }
  check('a Volatile elite leaves a telegraphed hazard', !!hazard,
    hazard ? `${hazard.id} at ${hazard.x.toFixed(1)}, ${hazard.z.toFixed(1)}, r${hazard.radius}` : 'no volatile hazard');
  let beforeTotal = 0;
  if (hazard) {
    const beforeBlast = await page.evaluate(([x, z]) => {
      window.__ashen.teleportPlayer(x, z);
      window.__ashen.healPlayer(9999);
      return window.__ashen.snapshot();
    }, [hazard.x, hazard.z]);
    beforeTotal = beforeBlast.playerHp + beforeBlast.playerEnergyShield;
  }
  await page.screenshot({ path: `${SHOTS}94-volatile-hazard.png` });
  let s = await snap();
  for (let i = 0; i < 40 && s.hazards > 0; i++) {
    await sleep(100);
    s = await snap();
  }
  check('the volatile blast resolves and expires', s.hazards === 0,
    `${s.hazards} hazards, life ${s.playerHp}+${s.playerEnergyShield}`);
  check('the volatile blast damages the player at close range',
    s.playerHp + s.playerEnergyShield < beforeTotal,
    `${beforeTotal} -> ${s.playerHp + s.playerEnergyShield}`);

  // --- Skill points, runes and the fourth active ---
  await page.evaluate(() => window.__ashen.grantXp(5000));
  await page.evaluate(() => window.__ashen.healPlayer(9999));
  await sleep(500);
  s = await snap();
  check('level 9 grants the post-release skill budget', s.skillPoints.available >= 7, JSON.stringify(s.skillPoints));

  await page.keyboard.press('k');
  await sleep(250);
  check('the skill library includes the fourth active', (await page.locator('.skill-card').count()) === 4);
  await page.locator('[data-skill-target="q"]').click();
  await page.locator('[data-skill-rune="cruel"][data-skill-rune-for="sunder"]').click();
  await sleep(250);
  s = await snap();
  const runed = s.skills.find((skill) => skill.slot === 'q');
  check('a rune applies its mana/damage trade-off',
    runed?.rune === 'cruel' && runed?.manaCost === 21, JSON.stringify(runed));
  await page.locator('[data-skill-rune-none="sunder"]').click();
  await sleep(200);
  check('a rune can be removed without spending points',
    (await snap()).skills.find((skill) => skill.slot === 'q')?.rune === null);

  await page.locator('[data-skill-target="f"]').click();
  await page.locator('[data-skill-unlock="leap-slam"]').click();
  await sleep(200);
  await page.locator('[data-skill-equip="leap-slam"]').click();
  await sleep(250);
  await page.keyboard.press('Escape');
  await sleep(200);
  const beforeLeap = (await snap()).playerPos;
  await page.mouse.move(720, 420);
  await page.keyboard.press('f');
  await sleep(900);
  s = await snap();
  const leapDistance = Math.hypot(s.playerPos.x - beforeLeap.x, s.playerPos.z - beforeLeap.z);
  check('Leap Slam casts from the F slot and travels', s.cooldowns['leap-slam'] > 0 && leapDistance > 2,
    `cooldown ${s.cooldowns['leap-slam']}, moved ${leapDistance.toFixed(1)}`);
  await page.screenshot({ path: `${SHOTS}95-leap-slam.png` });

  // Leave a rune on the bar for the persistence check.
  await page.keyboard.press('k');
  await sleep(200);
  await page.locator('[data-skill-target="q"]').click();
  await page.locator('[data-skill-rune="wide"][data-skill-rune-for="sunder"]').click();
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  check('wide rune is reflected in the hotbar damage stats',
    (await page.locator('[data-skill-slot="q"] .slot__rune').innerText()).length > 0);

  // --- Save/reload keeps the rune and fourth skill ---
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('[data-screen="paused"] [data-action="quit"]');
  await sleep(400);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
  await page.click('[data-action="continue-run"]');
  await sleep(900);
  s = await snap();
  check('Continue restores the rune and fourth active',
    s.skills.find((skill) => skill.slot === 'q')?.rune === 'wide' &&
    s.skills.find((skill) => skill.slot === 'f')?.id === 'leap-slam', JSON.stringify(s.skills));

  // --- Warden slam leaves a cinder pool ---
  await page.evaluate(() => window.__ashen.clearCamps());
  await sleep(700);
  s = await snap();
  const boss = s.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
  check('the Warden is back for the hazard test', !!boss);
  if (boss) {
    await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [s.arena.x, s.arena.z + 3]);
    await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 300), [boss.id]);
    let sawCinder = false;
    for (let i = 0; i < 60 && !sawCinder; i++) {
      await page.evaluate(() => window.__ashen.healPlayer(9999));
      await sleep(100);
      const now = await snap();
      sawCinder = now.hazards > 0;
    }
    check('the Warden slam leaves a cinder pool', sawCinder);
    await page.screenshot({ path: `${SHOTS}96-cinder-pool.png` });
  }

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
