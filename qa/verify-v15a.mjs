/**
 * v1.5 5.0a stable-surface QA: remount the moor twice and prove the run,
 * renderer memory, camera framing, HUD/panels and ground probes survive.
 *
 * The simulation is paused before the measured remounts so player position,
 * enemy HP/positions, inventory and objectives are byte-stable while the
 * renderer keeps producing frames. The run is resumed afterwards for real
 * ring, telegraph and grounding probes on the new surface.
 *
 * Run: node qa/verify-v15a.mjs
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Allowed growth above the warm baseline. Calibrated at 0 for this build. */
const LEAK_TOLERANCE = 2;

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

function watchPage(page, errors) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
}

const snapshot = (page) => page.evaluate(() => window.__ashen.snapshot());

/** The run fields a debug remount must not touch. */
function stableRunState(s) {
  return {
    mode: s.mode,
    dead: s.dead,
    playerPos: { x: s.playerPos.x, z: s.playerPos.z },
    playerHp: s.playerHp,
    playerMana: s.playerMana,
    playerEnergyShield: s.playerEnergyShield,
    level: s.level,
    xp: s.xp,
    bagCount: s.bagCount,
    equippedCount: s.equippedCount,
    objectives: { ...s.objectives },
    enemies: s.enemies.map((enemy) => ({
      id: enemy.id,
      hp: enemy.hp,
      dead: enemy.dead,
      x: enemy.x,
      z: enemy.z,
    })),
  };
}

/** First differing leaf, for a useful failure detail without dumping both states. */
function firstDifference(a, b, path = 'state') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return `${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`;
  if (a === null || b === null) return `${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`;
  if (typeof a !== 'object') return `${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return `${path}: array shape changed`;
  if (aIsArray) {
    if (a.length !== b.length) return `${path}.length: ${a.length} -> ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const diff = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = firstDifference(a[key], b[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

function stateSummary(state) {
  return `${state.enemies.length} enemies, hp ${state.playerHp}, level ${state.level}, `
    + `bag ${state.bagCount}, equipped ${state.equippedCount}, camps ${state.objectives.campsCleared}/${state.objectives.campsTotal}`;
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function leakDetail(warm, base, after) {
  return `warm ${warm.geometries} geo/${warm.textures} tex, `
    + `pre-remount ${base.geometries}/${base.textures}, after ${after.geometries}/${after.textures} `
    + `(delta vs warm ${signed(after.geometries - warm.geometries)} geo, ${signed(after.textures - warm.textures)} tex)`;
}

function normalIsValid(normal) {
  if (!normal) return false;
  const length = Math.hypot(normal.x, normal.y, normal.z);
  return Math.abs(length - 1) < 1e-3 && normal.y > 0.7;
}

function normalDetail(normal) {
  if (!normal) return 'missing';
  return `len ${Math.hypot(normal.x, normal.y, normal.z).toFixed(6)}, y ${normal.y.toFixed(6)}`;
}

function validProbeOrNull(probe, field) {
  return probe === null || (typeof probe[field] === 'number' && probe[field] < 0.03);
}

async function terrainHeight(page, x, z) {
  return page.evaluate(([px, pz]) => window.__ashen.terrainHeightAt(px, pz), [x, z]);
}

/**
 * Wait for a gap between enemy windups so the warm baseline (and the leak
 * delta) is not inflated by a live telegraph that the remount clears as a
 * transient combat view. Returns the latest snapshot either way.
 */
async function waitForTelegraphGap(page, timeoutMs = 3000) {
  const start = Date.now();
  let current = await snapshot(page);
  while (current.probes.telegraph !== null && Date.now() - start < timeoutMs) {
    await sleep(100);
    current = await snapshot(page);
  }
  return { snapshot: current, waitedMs: Date.now() - start };
}

/** Temporary QA-only hide of the pause overlay so both shots show the same HUD/world. */
async function screenshotWithoutPauseOverlay(page, path) {
  await page.evaluate(() => {
    const screen = document.querySelector('[data-screen="paused"]');
    if (screen instanceof HTMLElement) screen.style.visibility = 'hidden';
  });
  try {
    await page.screenshot({ path });
  } finally {
    await page.evaluate(() => {
      const screen = document.querySelector('[data-screen="paused"]');
      if (screen instanceof HTMLElement) screen.style.visibility = '';
    });
  }
}

async function main() {
  let server = null;
  let browser = null;

  try {
    if (!process.env.QA_URL) server = startPreviewServer(4173);
    await waitForServer(BASE);

    browser = await chromium.launch();
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    watchPage(page, errors);

    // ------------------------------------------------------------------
    // 1. Playable new game + warm baseline after ~1.5s
    // ------------------------------------------------------------------
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await sleep(800);
    await page.click('[data-action="new-game"]');
    await sleep(200);
    await page.click('[data-class="marauder"]');
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 10000 });
    await sleep(1500);

    const warm = await snapshot(page);
    check('new game reaches play',
      warm.mode === 'playing' && !warm.dead && warm.playerHp > 0,
      `mode ${warm.mode}, hp ${warm.playerHp}/${warm.playerMaxHp}, position ${warm.playerPos.x.toFixed(2)},${warm.playerPos.z.toFixed(2)}`);
    check('warm baseline has a populated moor and the three-camp objective set',
      warm.enemies.length > 0 &&
      warm.enemies.every((enemy) =>
        typeof enemy.id === 'string' &&
        typeof enemy.hp === 'number' &&
        typeof enemy.dead === 'boolean') &&
      warm.enemies.some((enemy) => !enemy.dead) &&
      warm.objectives.campsTotal === 3 &&
      warm.objectives.campsCleared === 0 &&
      !warm.objectives.bossSpawned &&
      !warm.objectives.bossDefeated,
      `${warm.enemies.length} enemies, camps ${warm.objectives.campsCleared}/${warm.objectives.campsTotal}, boss spawned ${warm.objectives.bossSpawned}`);
    check('warm baseline captures camera, inventory and renderer memory',
      warm.level >= 1 &&
      Math.abs(warm.camera.yaw - Math.PI / 4) < 1e-9 &&
      Math.abs(warm.camera.pitch - 0.78) < 1e-9 &&
      warm.camera.distance === 18 &&
      Number.isFinite(warm.bagCount) &&
      Number.isFinite(warm.equippedCount) &&
      warm.render.geometries > 0 &&
      warm.render.textures > 0,
      `level ${warm.level}, camera ${warm.camera.yaw.toFixed(4)}/${warm.camera.pitch}/${warm.camera.distance}, geo ${warm.render.geometries}, tex ${warm.render.textures}, bag ${warm.bagCount}, equipped ${warm.equippedCount}`);
    console.log(`INFO  warm baseline: ${warm.enemies.length} enemies, ${warm.render.geometries} geometries, ${warm.render.textures} textures, ${warm.render.drawCalls} draw calls, ${warm.render.triangles} triangles`);
    console.log(`INFO  warm enemy roster: ${warm.enemies.map((enemy) => `${enemy.id}:${Math.round(enemy.hp)}${enemy.dead ? 'x' : ''}`).join(', ')}`);
    const warmRender = { geometries: warm.render.geometries, textures: warm.render.textures };

    // Let any live telegraph pass before the pause; this keeps the pre-remount
    // memory baseline scenery-only instead of counting a combat view that the
    // remount is designed to clear.
    const quietWindow = await waitForTelegraphGap(page);
    console.log(`INFO  quiet window: waited +${quietWindow.waitedMs}ms (telegraph probe ${quietWindow.snapshot.probes.telegraph === null ? 'idle' : `live ${quietWindow.snapshot.probes.telegraph.id}`})`);

    // Freeze the sim for the equality checks; the render loop keeps running.
    // Pause immediately after the telegraph gap so no new windup is captured.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'paused', null, { timeout: 5000 });
    // Fading telegraph layers clear during the paused render frames.
    await sleep(400);
    const base = await snapshot(page);
    const baseState = stableRunState(base);
    const baseRender = { geometries: base.render.geometries, textures: base.render.textures };
    check('pause menu opens for a stable pre-remount baseline',
      base.mode === 'paused' &&
      await page.locator('[data-screen="paused"]').isVisible(),
      `${stateSummary(baseState)}, geo ${baseRender.geometries}, tex ${baseRender.textures}`);
    if (base.probes.telegraph) {
      console.log(`INFO  pre-remount baseline had a live telegraph (${base.probes.telegraph.id}, ${base.probes.telegraph.vertices} vertices); the remount clears it as a transient combat view`);
    }

    await screenshotWithoutPauseOverlay(page, `${SHOTS}v15a-remount-before.png`);

    // ------------------------------------------------------------------
    // 2. Two remounts, with the short waits the debug hook expects
    // ------------------------------------------------------------------
    await page.evaluate(() => window.__ashen.remountZone('ashen-moor'));
    await sleep(350);
    const after1 = await snapshot(page);
    const state1 = stableRunState(after1);
    const diff1 = firstDifference(baseState, state1);
    check('remount 1 leaves the run state untouched',
      diff1 === null,
      diff1 ?? stateSummary(state1));

    check('remount 1 keeps the hero grounded',
      after1.probes.playerGround.error < 0.03,
      `playerGround y ${after1.probes.playerGround.y.toFixed(6)} vs terrain ${after1.probes.playerGround.height.toFixed(6)}, error ${after1.probes.playerGround.error.toFixed(6)}`);
    check('remount 1 exposes well-formed probes',
      !!after1.probes &&
      typeof after1.probes.rings === 'object' &&
      'hover' in after1.probes.rings &&
      'destination' in after1.probes.rings &&
      'hoverNormal' in after1.probes.rings &&
      'destinationNormal' in after1.probes.rings &&
      validProbeOrNull(after1.probes.telegraph, 'maxError') &&
      validProbeOrNull(after1.probes.bossRoot, 'error'),
      `telegraph ${after1.probes.telegraph === null ? 'null' : `maxError ${after1.probes.telegraph.maxError.toFixed(6)}`}, bossRoot ${after1.probes.bossRoot === null ? 'null' : `error ${after1.probes.bossRoot.error.toFixed(6)}`}`);
    check('remount 1 does not grow renderer memory beyond the warm baseline',
      after1.render.geometries <= warmRender.geometries + LEAK_TOLERANCE &&
      after1.render.textures <= warmRender.textures + LEAK_TOLERANCE &&
      after1.render.geometries <= baseRender.geometries + LEAK_TOLERANCE &&
      after1.render.textures <= baseRender.textures + LEAK_TOLERANCE,
      leakDetail(warmRender, baseRender, after1.render));

    await page.evaluate(() => window.__ashen.remountZone('ashen-moor'));
    await sleep(350);
    const after2 = await snapshot(page);
    const state2 = stableRunState(after2);
    const diff2 = firstDifference(baseState, state2);
    check('remount 2 leaves the run state untouched',
      diff2 === null,
      diff2 ?? stateSummary(state2));

    check('remount 2 keeps the hero grounded',
      after2.probes.playerGround.error < 0.03,
      `playerGround y ${after2.probes.playerGround.y.toFixed(6)} vs terrain ${after2.probes.playerGround.height.toFixed(6)}, error ${after2.probes.playerGround.error.toFixed(6)}`);
    check('remount 2 exposes well-formed probes',
      !!after2.probes &&
      typeof after2.probes.rings === 'object' &&
      'hover' in after2.probes.rings &&
      'destination' in after2.probes.rings &&
      validProbeOrNull(after2.probes.telegraph, 'maxError') &&
      validProbeOrNull(after2.probes.bossRoot, 'error'),
      `telegraph ${after2.probes.telegraph === null ? 'null' : `maxError ${after2.probes.telegraph.maxError.toFixed(6)}`}, bossRoot ${after2.probes.bossRoot === null ? 'null' : `error ${after2.probes.bossRoot.error.toFixed(6)}`}`);
    check('remount 2 does not grow renderer memory beyond the warm baseline',
      after2.render.geometries <= warmRender.geometries + LEAK_TOLERANCE &&
      after2.render.textures <= warmRender.textures + LEAK_TOLERANCE &&
      after2.render.geometries <= baseRender.geometries + LEAK_TOLERANCE &&
      after2.render.textures <= baseRender.textures + LEAK_TOLERANCE,
      leakDetail(warmRender, baseRender, after2.render));
    check('the two rebuilds are leak-stable against each other',
      after2.render.geometries === after1.render.geometries &&
      after2.render.textures === after1.render.textures,
      `geometries ${after1.render.geometries}->${after2.render.geometries}, textures ${after1.render.textures}->${after2.render.textures}`);

    // ------------------------------------------------------------------
    // 3. Normal moor framing after the remounts
    // ------------------------------------------------------------------
    check('camera yaw, pitch and distance are unchanged after both remounts',
      after2.camera.yaw === base.camera.yaw &&
      after2.camera.pitch === base.camera.pitch &&
      after2.camera.distance === base.camera.distance &&
      Math.abs(after2.camera.yaw - Math.PI / 4) < 1e-9 &&
      Math.abs(after2.camera.pitch - 0.78) < 1e-9 &&
      after2.camera.distance === 18,
      `base ${base.camera.yaw.toFixed(6)}/${base.camera.pitch}/${base.camera.distance} -> ${after2.camera.yaw.toFixed(6)}/${after2.camera.pitch}/${after2.camera.distance}`);

    check('no console errors during the remounts', errors.length === 0, errors.slice(0, 3).join(' | '));

    await screenshotWithoutPauseOverlay(page, `${SHOTS}v15a-remount-after.png`);

    // ------------------------------------------------------------------
    // 4. HUD and panels remain usable after the rebuild
    // ------------------------------------------------------------------
    check('pause panel remains usable after both remounts',
      await page.locator('[data-screen="paused"]').isVisible() &&
      await page.locator('[data-screen="paused"] [data-action="resume"]').isEnabled(),
      'pause screen visible, Resume enabled');

    const hud = await page.evaluate(() => ({
      hidden: document.querySelector('[data-hud]')?.classList.contains('hidden') ?? true,
      hp: document.querySelector('[data-hp-text]')?.textContent?.trim() ?? '',
      objectives: document.querySelector('[data-objectives]')?.innerText ?? '',
    }));
    check('HUD still shows the moor objectives and the unchanged HP',
      !hud.hidden &&
      hud.hp === `${Math.round(base.playerHp)} / ${Math.round(base.playerMaxHp)}` &&
      hud.objectives.includes('Clear the camps (0/3)') &&
      hud.objectives.includes('Slay the Ashen Warden'),
      `hp "${hud.hp}", objectives "${hud.objectives.replace(/\n/g, ' / ')}"`);

    await page.locator('[data-screen="paused"] [data-action="resume"]').click();
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 5000 });
    check('resume from the pause panel returns to play after the remounts',
      (await snapshot(page)).mode === 'playing');
    await sleep(200);

    const resumed = await snapshot(page);
    const resumedGround = await terrainHeight(page, resumed.playerPos.x, resumed.playerPos.z);
    check('hero is grounded after resume on the remounted surface',
      Math.abs(resumed.playerRenderY - resumedGround) < 0.03 &&
      resumed.probes.playerGround.error < 0.03,
      `renderY ${resumed.playerRenderY.toFixed(6)} vs terrain ${resumedGround.toFixed(6)}, probe error ${resumed.probes.playerGround.error.toFixed(6)}`);

    await page.keyboard.press('i');
    await page.locator('.inventory-panel').waitFor({ state: 'visible' });
    const bagText = (await page.locator('[data-bag-count]').innerText()).trim();
    check('inventory panel opens after the remounts with the unchanged bag',
      bagText.startsWith(`${baseState.bagCount}/`) &&
      (await page.locator('[data-bag-count]').isVisible()),
      `bag count "${bagText}"`);
    await page.keyboard.press('i');
    await page.locator('.inventory-panel').waitFor({ state: 'hidden' });
    check('inventory panel closes cleanly after the remounts',
      !(await page.locator('.inventory-panel').isVisible()));

    // ------------------------------------------------------------------
    // 5. Ground probes on a raised patch of the rebuilt moor
    // ------------------------------------------------------------------
    const raised = await page.evaluate(() => {
      let best = { x: 0, z: 0, h: -1 };
      for (let x = -34; x <= 34; x += 3) {
        for (let z = -34; z <= 34; z += 3) {
          if (Math.hypot(x, z) > 39) continue;
          const h = window.__ashen.terrainHeightAt(x, z);
          if (h > best.h) best = { x, z, h };
        }
      }
      return best;
    });
    check('a raised probe point exists on the remounted moor',
      raised.h > 0.05,
      `height ${raised.h.toFixed(6)} at ${raised.x},${raised.z}`);

    await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [raised.x, raised.z]);
    await sleep(500);
    const grounded = await snapshot(page);
    const groundedHeight = await terrainHeight(page, grounded.playerPos.x, grounded.playerPos.z);
    check('hero stands on the raised remounted terrain',
      Math.abs(grounded.playerRenderY - groundedHeight) < 0.03 &&
      grounded.probes.playerGround.error < 0.03,
      `renderY ${grounded.playerRenderY.toFixed(6)} vs terrain ${groundedHeight.toFixed(6)}, probe error ${grounded.probes.playerGround.error.toFixed(6)}`);

    // Real pointer set: hover under the cursor, then a click destination.
    await page.mouse.move(720, 520);
    await sleep(150);
    await page.mouse.click(720, 560);
    await sleep(120);
    const marked = await snapshot(page);
    const rings = marked.probes.rings;
    const hoverHeight = rings.hover ? await terrainHeight(page, rings.hover.x, rings.hover.z) : 0;
    const destinationHeight = rings.destination
      ? await terrainHeight(page, rings.destination.x, rings.destination.z)
      : 0;

    check('hover ring samples the remounted surface normal',
      normalIsValid(rings.hoverNormal),
      normalDetail(rings.hoverNormal));
    check('hover ring keeps the old +0.025 center clearance',
      !!rings.hover && Math.abs(rings.hover.y - (hoverHeight + 0.025)) < 0.03,
      rings.hover
        ? `ring y ${rings.hover.y.toFixed(6)} vs terrain+0.025 ${(hoverHeight + 0.025).toFixed(6)}`
        : 'hover marker missing');
    check('destination ring samples the remounted surface normal',
      normalIsValid(rings.destinationNormal),
      normalDetail(rings.destinationNormal));
    check('destination ring keeps the old +0.035 center clearance',
      !!rings.destination && Math.abs(rings.destination.y - (destinationHeight + 0.035)) < 0.03,
      rings.destination
        ? `ring y ${rings.destination.y.toFixed(6)} vs terrain+0.035 ${(destinationHeight + 0.035).toFixed(6)}`
        : 'destination marker missing');
    check('telegraph probe after the remounts is idle or tightly draped',
      validProbeOrNull(marked.probes.telegraph, 'maxError'),
      marked.probes.telegraph === null
        ? 'null (idle)'
        : `maxError ${marked.probes.telegraph.maxError.toFixed(6)} over ${marked.probes.telegraph.vertices} vertices`);

    // Wake a nearby enemy for a real telegraph probe on the rebuilt surface.
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    const target = await page.evaluate(() => {
      const s = window.__ashen.snapshot();
      const living = s.enemies.filter((enemy) => !enemy.dead);
      living.sort((a, b) =>
        Math.hypot(a.x - s.playerPos.x, a.z - s.playerPos.z)
        - Math.hypot(b.x - s.playerPos.x, b.z - s.playerPos.z));
      return living[0] ?? null;
    });

    let triggeredTelegraph = null;
    if (target) {
      await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [target.x, target.z + 5]);
      try {
        await page.waitForFunction(
          () => window.__ashen.snapshot().probes.telegraph !== null,
          null,
          { timeout: 6000 },
        );
        triggeredTelegraph = (await snapshot(page)).probes.telegraph;
      } catch {
        triggeredTelegraph = null;
      }
    }
    const afterTelegraph = await snapshot(page);
    const telegraph = triggeredTelegraph ?? afterTelegraph.probes.telegraph;
    if (telegraph) {
      check('triggered telegraph probe is tightly draped on the remounted surface',
        telegraph.maxError < 0.03 && telegraph.vertices > 0,
        `id ${telegraph.id}, ${telegraph.vertices} vertices, maxError ${telegraph.maxError.toFixed(6)}`);
    } else {
      check('telegraph probe is idle-null when no windup is live',
        true,
        target ? `no windup observed near ${target.id}; probe null` : 'no living enemy; probe null');
    }
    check('boss root probe is absent or grounded',
      afterTelegraph.probes.bossRoot === null || afterTelegraph.probes.bossRoot.error < 0.03,
      afterTelegraph.probes.bossRoot === null
        ? 'null (no live Warden)'
        : `error ${afterTelegraph.probes.bossRoot.error.toFixed(6)}`);

    check('no console errors across the remount suite', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`INFO  screenshots: qa/shots/v15a-remount-before.png, qa/shots/v15a-remount-after.png`);
  } catch (err) {
    check('suite finished without throwing', false, String(err).split('\n')[0]);
    console.error(err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer(server);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
