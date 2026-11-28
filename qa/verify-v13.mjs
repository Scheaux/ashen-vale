/**
 * v1.3 combat-depth QA: fourth actives, rune trade-offs, volatile elite
 * hazards, the Warden's cinder pools, and camera occlusion.
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

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

/** Decode two clipped screenshots in the browser and measure the pixel delta. */
async function compareScreenshots(page, a, b) {
  const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
  return page.evaluate(async ([urlA, urlB]) => {
    async function readPixels(url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D canvas unavailable');
      context.drawImage(img, 0, 0);
      return {
        width: img.width,
        height: img.height,
        data: context.getImageData(0, 0, img.width, img.height).data,
      };
    }
    const [pixelsA, pixelsB] = await Promise.all([readPixels(urlA), readPixels(urlB)]);
    let changed = 0;
    let sum = 0;
    for (let i = 0; i < pixelsA.data.length; i += 4) {
      const dr = Math.abs(pixelsA.data[i] - pixelsB.data[i]);
      const dg = Math.abs(pixelsA.data[i + 1] - pixelsB.data[i + 1]);
      const db = Math.abs(pixelsA.data[i + 2] - pixelsB.data[i + 2]);
      const delta = dr + dg + db;
      sum += delta;
      if (delta > 45) changed++;
    }
    const pixels = pixelsA.data.length / 4;
    return {
      width: pixelsA.width,
      height: pixelsA.height,
      pixels,
      changed,
      meanDelta: sum / (pixels * 3),
    };
  }, [dataUrl(a), dataUrl(b)]);
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
  const zoomTargets = [18, 12, 21];
  const actualZooms = [];
  for (const zoom of zoomTargets) {
    const actualZoom = await setZoom(zoom);
    actualZooms.push(actualZoom);
    const zoomReached = Math.abs(actualZoom - zoom) <= 0.1;
    check(`camera zoom settles at ${zoom}`, zoomReached, `actual ${actualZoom.toFixed(2)}`);
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
    check(`tall props fade between the camera and the hero at zoom ${zoom}`,
      zoomReached && occluded > 0 && occlusionFade > 0.9,
      `zoom ${actualZoom.toFixed(2)}, ${occluded} occluded props, target fade ${occlusionFade.toFixed(2)}`);

    const after = await probeProps();
    const scaleChanged = after.sample.length !== preProps.sample.length ||
      after.sample.some((sample, i) => maxScaleDelta(sample.scale, preProps.sample[i].scale) > 1e-6);
    const authoredMismatch = after.sample.findIndex((sample) =>
      maxScaleDelta(sample.scale, sample.authoredScale) > 1e-6);
    check(`authored prop scale is unchanged at zoom ${zoom}`,
      !scaleChanged && authoredMismatch === -1,
      scaleChanged
        ? 'live instance scale changed'
        : authoredMismatch >= 0
          ? `matrix/authored mismatch at sample ${authoredMismatch}`
          : `${after.total} scales stable`);
  }
  check('occlusion was exercised at zooms 12, 18 and 21',
    actualZooms.length === zoomTargets.length &&
    zoomTargets.every((zoom, i) => Math.abs(actualZooms[i] - zoom) <= 0.1),
    actualZooms.map((zoom) => zoom.toFixed(2)).join(', '));
  check('tall props fade between the camera and the hero', occluded > 0,
    `${occluded} occluded props at zoom ${occlusionZoom.toFixed(1)}, fade ${occlusionFade.toFixed(2)}`);
  const counts = await page.evaluate(() => ({
    snapshot: window.__ashen.snapshot().render.occludedProps,
    probe: window.__ashen.propProbe().occluded,
  }));
  check('the render snapshot keeps the occluded prop count', counts.snapshot === counts.probe,
    `${counts.snapshot} snapshot vs ${counts.probe} probe`);

  // --- Render-level proof: the fade changes the prop's screen coverage ---
  const enemyPoints = (await snap()).enemies.filter((enemy) => !enemy.dead);
  const distanceToEnemies = (prop) => enemyPoints.length === 0
    ? 0
    : Math.min(...enemyPoints.map((enemy) => Math.hypot(prop.x - enemy.x, prop.z - enemy.z)));
  const renderTarget = [...tallProps].sort((a, b) => distanceToEnemies(b) - distanceToEnemies(a))[0];
  if (!renderTarget) {
    check('fade changes the prop screen coverage in rendered pixels', false, 'no occlusion target found');
  } else {
    // A prop far from live enemies keeps telegraphs/projectiles out of the
    // evidence frame. Snap the camera to its converged occlusion pose.
    await page.evaluate(([x, z]) => {
      window.__ashen.healPlayer(9999);
      window.__ashen.teleportPlayer(x, z);
      window.__ashen.remountZone('ashen-moor');
    }, [renderTarget.x - 2.2, renderTarget.z - 2.2]);

    let renderFade = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      const probe = await probeProps();
      const sample = probe.sample.find((candidate) =>
        Math.abs(candidate.x - renderTarget.x) < 1e-6 &&
        Math.abs(candidate.z - renderTarget.z) < 1e-6);
      renderFade = sample?.fade ?? 0;
      if (renderFade > 0.99) break;
    }
    check('render evidence target reaches full fade', renderFade > 0.99,
      `${renderTarget.kind} at ${renderTarget.x.toFixed(1)}, ${renderTarget.z.toFixed(1)}; fade ${renderFade.toFixed(3)}`);
    await page.screenshot({ path: `${SHOTS}93-occlusion.png` });

    const region = await page.evaluate(([x, z, kind, authoredY]) => {
      const ground = window.__ashen.terrainHeightAt(x, z);
      const height = kind === 'deadTree' ? authoredY * 4.8 : authoredY * 1.2 + 1;
      const base = window.__ashen.worldToScreen(x, z, ground);
      const top = window.__ashen.worldToScreen(x, z, ground + height);
      const pad = 80;
      const centerX = (base.x + top.x) / 2;
      const centerY = (base.y + top.y) / 2;
      const width = Math.min(window.innerWidth, Math.max(320, Math.abs(base.x - top.x) + pad * 2));
      const heightPx = Math.min(window.innerHeight, Math.max(380, Math.abs(base.y - top.y) + pad * 2));
      return {
        x: Math.round(Math.max(0, Math.min(window.innerWidth - width, centerX - width / 2))),
        y: Math.round(Math.max(0, Math.min(window.innerHeight - heightPx, centerY - heightPx / 2))),
        width: Math.round(width),
        height: Math.round(heightPx),
      };
    }, [renderTarget.x, renderTarget.z, renderTarget.kind, renderTarget.authoredScale.y]);

    const fade1Shot = await page.screenshot({ clip: region });
    writeFileSync(`${SHOTS}93-occlusion-fade1.png`, fade1Shot);

    // Freeze the fade/camera smoothing via negative Math.exp, then rebuild the
    // props at fade 0 without moving the camera. Restored immediately after.
    await page.evaluate(() => {
      const original = Math.exp;
      window.__qaOriginalExp = original;
      Math.exp = (value) => (value < 0 ? 1 : original(value));
      window.__ashen.remountZone('ashen-moor');
    });
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const fadeZeroProbe = await probeProps();
    const fadeZeroSample = fadeZeroProbe.sample.find((candidate) =>
      Math.abs(candidate.x - renderTarget.x) < 1e-6 &&
      Math.abs(candidate.z - renderTarget.z) < 1e-6);
    check('render evidence target resets to fade 0',
      fadeZeroSample?.fade === 0, `fade ${fadeZeroSample?.fade?.toFixed(3) ?? 'missing'}`);
    const fade0Shot = await page.screenshot({ clip: region });
    writeFileSync(`${SHOTS}93-occlusion-fade0.png`, fade0Shot);
    await page.screenshot({ path: `${SHOTS}93-occlusion-fade0-full.png` });
    await page.evaluate(() => {
      if (window.__qaOriginalExp) {
        Math.exp = window.__qaOriginalExp;
        delete window.__qaOriginalExp;
      }
    });

    const diff = await compareScreenshots(page, fade1Shot, fade0Shot);
    check('fade changes the prop screen coverage in rendered pixels',
      diff.changed > 1500 && diff.meanDelta > 1,
      `${renderTarget.kind}; ${diff.changed}/${diff.pixels} px changed, ` +
      `mean delta ${diff.meanDelta.toFixed(2)}`);
  }
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
