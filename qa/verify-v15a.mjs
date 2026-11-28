/**
 * v1.5 5.0a stable-surface QA: prove a real, changed run survives two surface
 * remounts and one live atomic remount without resetting state, leaking GPU
 * resources, losing the camera, or leaving transient prompts behind.
 *
 * The measured remounts run while the sim is paused so the full persistent
 * state can be compared byte-for-byte. A separate live remount uses a single
 * page.evaluate (snapshot -> remount -> snapshot) while the game is playing,
 * so no simulation tick can intervene.
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

/** Projected player motion allowed between a remount's before/after camera poses. */
const CAMERA_PIXEL_TOLERANCE = 2;
/** Largest ring-telegraph ground error accepted by the probes. */
const PROBE_ERROR = 0.03;

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

/**
 * Every persistent run field a remount must leave untouched. Transient
 * movement/attack/cast intent, prompt markers, camera and render counters are
 * intentionally excluded; the probe and epoch checks cover those separately.
 */
function stableRunState(s) {
  return {
    mode: s.mode,
    dead: s.dead,
    playerPos: { x: s.playerPos.x, z: s.playerPos.z },
    playerHp: s.playerHp,
    playerMaxHp: s.playerMaxHp,
    playerMana: s.playerMana,
    playerMaxMana: s.playerMaxMana,
    playerEnergyShield: s.playerEnergyShield,
    playerMaxEnergyShield: s.playerMaxEnergyShield,
    stats: { ...s.stats },
    level: s.level,
    xp: s.xp,
    xpToNext: s.xpToNext,
    bagCount: s.bagCount,
    equippedCount: s.equippedCount,
    items: s.items.map((item) => ({ ...item })),
    currency: { ...s.currency },
    flasks: { ...s.flasks },
    passives: {
      allocated: [...s.passives.allocated],
      spent: s.passives.spent,
      total: s.passives.total,
      available: s.passives.available,
    },
    skills: s.skills.map((skill) => ({ ...skill })),
    skillPoints: { ...s.skillPoints },
    cooldowns: { ...s.cooldowns },
    objectives: { ...s.objectives },
    arena: { ...s.arena },
    corridor: s.corridor
      ? { radius: s.corridor.radius, points: s.corridor.points.map((point) => ({ ...point })) }
      : null,
    portal: s.portal
      ? { x: s.portal.x, z: s.portal.z, open: s.portal.open }
      : null,
    enemies: s.enemies.map((enemy) => ({
      id: enemy.id,
      type: enemy.type,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      x: enemy.x,
      z: enemy.z,
      dead: enemy.dead,
      phase: enemy.phase,
      elite: [...enemy.elite],
      bossPhase: enemy.bossPhase,
    })),
    drops: s.drops,
    dropPositions: s.dropPositions.map((drop) => ({ ...drop })),
    run: { ...s.run },
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
    + `bag ${state.bagCount}, equipped ${state.equippedCount}, `
    + `camps ${state.objectives.campsCleared}/${state.objectives.campsTotal}`;
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function leakDetail(warm, base, after) {
  return `warm ${warm.geometries}/${warm.textures}, base ${base.geometries}/${base.textures}, `
    + `after ${after.geometries}/${after.textures} `
    + `(delta vs base ${signed(after.geometries - base.geometries)} geo, ${signed(after.textures - base.textures)} tex; `
    + `vs warm ${signed(after.geometries - warm.geometries)} geo, ${signed(after.textures - warm.textures)} tex)`;
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

/** Null is allowed only for the explicitly nullable telegraph/boss probes. */
function validProbeOrNull(probe, field) {
  return probe === null
    || (typeof probe[field] === 'number' && probe[field] >= 0 && probe[field] < PROBE_ERROR);
}

function screenDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function terrainHeight(page, x, z) {
  return page.evaluate(([px, pz]) => window.__ashen.terrainHeightAt(px, pz), [x, z]);
}

async function screenOf(page, x, z, height) {
  return page.evaluate(
    ([px, pz, py]) => window.__ashen.worldToScreen(px, pz, py),
    [x, z, height],
  );
}

/** Same central-difference normal the terrain/rings use: half a grid cell. */
async function finiteNormal(page, x, z) {
  return page.evaluate(([px, pz]) => {
    const h = (a, b) => window.__ashen.terrainHeightAt(a, b);
    const e = 0.5;
    const dx = (h(px + e, pz) - h(px - e, pz)) / (2 * e);
    const dz = (h(px, pz + e) - h(px, pz - e)) / (2 * e);
    const length = Math.hypot(dx, 1, dz);
    return { x: -dx / length, y: 1 / length, z: -dz / length, slope: Math.hypot(dx, dz) };
  }, [x, z]);
}

/** Current save-slot inventory plus the relevant localStorage bodies. */
async function saveState(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage)
      .filter((key) => key.startsWith('ashen-vale:save:'))
      .sort();
    const storage = {};
    for (const key of keys) storage[key] = localStorage.getItem(key);
    return { saves: window.__ashen.saves(), storage };
  });
}

/** Wait for the current telegraph to end before freezing or sampling. */
async function waitForTelegraphIdle(page, timeoutMs = 4000, heal = false) {
  const start = Date.now();
  let current = await snapshot(page);
  while (current.probes.telegraph !== null && Date.now() - start < timeoutMs) {
    if (heal) await page.evaluate(() => window.__ashen.healPlayer(9999));
    await sleep(100);
    current = await snapshot(page);
  }
  return current;
}

/** Temporary QA-only hide of the pause overlay for a comparable world shot. */
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

async function equipItem(page, uid) {
  await page.keyboard.press('i');
  await page.locator('.inventory-panel').waitFor({ state: 'visible' });
  await page.locator(`[data-item-uid="${uid}"]`).click();
  await page.waitForFunction(
    (id) => window.__ashen.snapshot().items.some((item) => item.uid === id && item.equipped),
    uid,
    { timeout: 5000 },
  );
  await page.keyboard.press('i');
  await page.locator('.inventory-panel').waitFor({ state: 'hidden' });
}

/**
 * One paused remount with the complete persistent-state, epoch, camera,
 * prompt, boss, leak and save assertions. Returns the post-remount snapshot.
 */
async function pausedRemount(page, label, expectedEpoch, expectedTerrainId, base, baseState, baseRender, baseScreen, baseSaves, warmRender) {
  await page.evaluate(() => window.__ashen.remountZone('ashen-moor'));
  await sleep(350);
  const after = await snapshot(page);
  const state = stableRunState(after);
  const diff = firstDifference(baseState, state);
  check(`${label}: persistent run state unchanged`, diff === null, diff ?? stateSummary(state));

  check(`${label}: mount epoch increments exactly once`,
    after.render.mountEpoch === expectedEpoch,
    `epoch ${expectedEpoch - 1} -> ${after.render.mountEpoch}, expected ${expectedEpoch}`);
  check(`${label}: terrain id increments exactly once`,
    after.render.terrainId === expectedTerrainId,
    `terrain ${expectedTerrainId - 1} -> ${after.render.terrainId}, expected ${expectedTerrainId}`);

  check(`${label}: destination ring cleared`,
    after.probes.rings.destination === null,
    `destination ${after.probes.rings.destination === null ? 'null' : 'visible'} `
    + '(hover clearing is proven on the live path where hover was established first)');

  check(`${label}: corridor route unchanged`,
    after.corridor !== null
    && after.corridor.radius === base.corridor?.radius
    && JSON.stringify(after.corridor.points) === JSON.stringify(base.corridor?.points),
    after.corridor
      ? `${after.corridor.points.length} points, radius ${after.corridor.radius}`
      : 'corridor missing');

  check(`${label}: telegraph view cleared`,
    after.probes.telegraph === null,
    after.probes.telegraph === null ? 'null' : JSON.stringify(after.probes.telegraph));

  const afterScreen = await screenOf(page, base.playerPos.x, base.playerPos.z, base.playerRenderY);
  const projectedPixels = screenDistance(baseScreen, afterScreen);
  check(`${label}: camera pose and projected player point unchanged`,
    after.camera.yaw === base.camera.yaw &&
    after.camera.pitch === base.camera.pitch &&
    after.camera.distance === base.camera.distance &&
    projectedPixels <= CAMERA_PIXEL_TOLERANCE,
    `pose ${after.camera.yaw.toFixed(6)}/${after.camera.pitch}/${after.camera.distance}, `
    + `projection moved ${projectedPixels.toFixed(3)}px`);

  const expectedGround = await terrainHeight(page, base.playerPos.x, base.playerPos.z);
  check(`${label}: player ground probe is exact and sampled from the surface`,
    after.probes.playerGround.y === after.playerRenderY &&
    after.probes.playerGround.height === expectedGround &&
    after.probes.playerGround.error < 1e-6 &&
    Number.isFinite(expectedGround),
    `probe y ${after.probes.playerGround.y.toFixed(9)} vs renderY ${after.playerRenderY.toFixed(9)}, `
    + `height ${after.probes.playerGround.height.toFixed(9)} vs terrainHeightAt ${expectedGround.toFixed(9)}, `
    + `error ${after.probes.playerGround.error.toExponential(3)}`);

  check(`${label}: live boss root remains grounded`,
    after.probes.bossRoot !== null && validProbeOrNull(after.probes.bossRoot, 'error'),
    after.probes.bossRoot
      ? `id ${after.probes.bossRoot.id}, error ${after.probes.bossRoot.error.toExponential(3)}`
      : 'bossRoot missing');

  check(`${label}: renderer memory delta is exactly zero`,
    after.render.geometries === baseRender.geometries &&
    after.render.textures === baseRender.textures,
    leakDetail(warmRender, baseRender, after.render));

  const afterSaves = await saveState(page);
  const saveDiff = firstDifference(baseSaves, afterSaves);
  check(`${label}: save slots and localStorage unchanged`, saveDiff === null, saveDiff ?? 'unchanged');

  return after;
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
    // 1. New game, warm snapshot (informational only), then a real changed run
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
    const warmRender = { geometries: warm.render.geometries, textures: warm.render.textures };
    check('new game reaches play', warm.mode === 'playing' && !warm.dead && warm.playerHp > 0,
      `mode ${warm.mode}, hp ${warm.playerHp}/${warm.playerMaxHp}, position ${warm.playerPos.x.toFixed(2)},${warm.playerPos.z.toFixed(2)}`);
    check('the live run exposes the linear corridor spawn',
      warm.corridor !== null
      && warm.corridor.points.length === 4
      && warm.corridor.radius === 29
      && Math.hypot(warm.playerPos.x, warm.playerPos.z - 74) < 1.5,
      JSON.stringify({ corridor: warm.corridor, playerPos: warm.playerPos }));
    console.log(`INFO  warm frame (pristine, informational): ${warm.render.geometries} geo, ${warm.render.textures} tex, `
      + `${warm.render.drawCalls} calls, ${warm.render.triangles} triangles, `
      + `epoch ${warm.render.mountEpoch}, terrain ${warm.render.terrainId}`);

    // A real slope probe must happen on walkable ground. The linear bog is
    // deliberately flatter than the old disc, so the steepest in-corridor rim
    // is the surface-rebake probe. The finite-difference value is cross-checked
    // again after the remounts to prove the rebuilt surface kept that slope.
    let slopeEvidence = null;
    const slope = await page.evaluate(() => {
      const current = window.__ashen.snapshot();
      const corridor = current.corridor;
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
      const height = (x, z) => window.__ashen.terrainHeightAt(x, z);
      const e = 0.5;
      let best = { x: 0, z: 0, slope: -1, height: 0, corridorDistance: 0 };
      for (let x = -100; x <= 100; x += 1) {
        for (let z = -105; z <= 105; z += 1) {
          const corridorDistance = distanceToCorridor(x, z);
          if (corridorDistance > corridor.radius - 1.2) continue;
          const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
          const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
          const gradient = Math.hypot(dx, dz);
          if (gradient > best.slope) {
            best = { x, z, slope: gradient, height: height(x, z), corridorDistance };
          }
        }
      }
      return best;
    });
    check('a steep walkable slope exists on the linear moor',
      slope.slope > 0.03 && slope.corridorDistance <= 28,
      `gradient ${slope.slope.toFixed(6)} at ${slope.x},${slope.z}, height ${slope.height.toFixed(6)}, `
      + `corridor distance ${slope.corridorDistance.toFixed(2)}`);

    const slopeView = await page.evaluate(([sx, sz]) => {
      const length = Math.hypot(sx, sz) || 1;
      const px = sx - (sx / length) * 4;
      const pz = sz - (sz / length) * 4;
      window.__ashen.teleportPlayer(px, pz);
      return { x: px, z: pz };
    }, [slope.x, slope.z]);
    console.log(`INFO  slope probe at ${slope.x},${slope.z}; viewpoint ${slopeView.x.toFixed(2)},${slopeView.z.toFixed(2)}`);
    // The camera follow is damped; wait for it to settle before projecting the
    // slope pixel, or the pointer raycast lands on a flatter nearby point.
    await sleep(1400);

    const slopeScreen = await screenOf(page, slope.x, slope.z, slope.height);
    await page.mouse.move(slopeScreen.x, slopeScreen.y);
    await sleep(200);
    const hovered = await snapshot(page);
    const hover = hovered.probes.rings.hover;
    if (hover) {
      const expected = await finiteNormal(page, hover.x, hover.z);
      const componentError = Math.max(
        Math.abs(hovered.probes.rings.hoverNormal.x - expected.x),
        Math.abs(hovered.probes.rings.hoverNormal.y - expected.y),
        Math.abs(hovered.probes.rings.hoverNormal.z - expected.z),
      );
      const hoverHeight = await terrainHeight(page, hover.x, hover.z);
      check('hover ring normal matches the finite-difference normal',
        componentError < 1e-4 && hovered.probes.rings.hoverNormal.y < 0.9999,
        `components error ${componentError.toExponential(3)}, ${normalDetail(hovered.probes.rings.hoverNormal)}, expected ${normalDetail(expected)}`);
      check('hover ring center clearance stays +0.025 on the slope',
        Math.abs(hover.y - (hoverHeight + 0.025)) < 1e-6,
        `ring y ${hover.y.toFixed(9)} vs terrain+0.025 ${(hoverHeight + 0.025).toFixed(9)}`);
    } else {
      check('hover ring normal matches the finite-difference normal', false, 'hover marker missing');
      check('hover ring center clearance stays +0.025 on the slope', false, 'hover marker missing');
    }

    await page.mouse.click(slopeScreen.x, slopeScreen.y);
    await sleep(120);
    const destinationMarked = await snapshot(page);
    const dest = destinationMarked.probes.rings.destination;
    if (dest) {
      const expected = await finiteNormal(page, dest.x, dest.z);
      const componentError = Math.max(
        Math.abs(destinationMarked.probes.rings.destinationNormal.x - expected.x),
        Math.abs(destinationMarked.probes.rings.destinationNormal.y - expected.y),
        Math.abs(destinationMarked.probes.rings.destinationNormal.z - expected.z),
      );
      const destHeight = await terrainHeight(page, dest.x, dest.z);
      check('destination ring normal matches the finite-difference normal',
        componentError < 1e-4 && destinationMarked.probes.rings.destinationNormal.y < 0.9999,
        `components error ${componentError.toExponential(3)}, ${normalDetail(destinationMarked.probes.rings.destinationNormal)}, expected ${normalDetail(expected)}`);
      check('destination ring center clearance stays +0.035 on the slope',
        Math.abs(dest.y - (destHeight + 0.035)) < 1e-6,
        `ring y ${dest.y.toFixed(9)} vs terrain+0.035 ${(destHeight + 0.035).toFixed(9)}`);
    } else {
      check('destination ring normal matches the finite-difference normal', false, 'destination marker missing');
      check('destination ring center clearance stays +0.035 on the slope', false, 'destination marker missing');
    }
    if (hover && dest) {
      slopeEvidence = {
        point: { x: slope.x, z: slope.z },
        hoverPoint: { x: hover.x, z: hover.z },
        hoverNormal: { ...hovered.probes.rings.hoverNormal },
        destinationNormal: { ...destinationMarked.probes.rings.destinationNormal },
      };
    }

    // Move off spawn and build a state that a no-op/reset remount must preserve.
    await page.evaluate(() => window.__ashen.teleportPlayer(20, 20));
    const rareUid = await page.evaluate(() => window.__ashen.grantItem('rare'));
    const equipUid = await page.evaluate(() => window.__ashen.grantItem('magic'));
    await equipItem(page, equipUid);
    await page.evaluate(() => {
      window.__ashen.grantXp(20);
      window.__ashen.grantCurrency(3, 2, 1);
      window.__ashen.setFlaskCharges('health', 1);
      window.__ashen.hurtPlayer(10);
      window.__ashen.equipSkill('w', 'sunder');
    });

    // Clear the 16 optional camps; they do not wake the Warden. The live boss
    // is spawned by entering the end clearing, and the hero is not moved.
    await page.evaluate(() => window.__ashen.clearCamps());
    await page.waitForFunction(() => {
      const s = window.__ashen.snapshot();
      return s.objectives.campsCleared === 16 && s.objectives.bossSpawned === false;
    }, null, { timeout: 5000 });
    await page.evaluate(() => {
      const s = window.__ashen.snapshot();
      window.__ashen.teleportPlayer(s.arena.x, s.arena.z);
    });
    await page.waitForFunction(() => {
      const s = window.__ashen.snapshot();
      return s.objectives.bossSpawned
        && s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    }, null, { timeout: 5000 });
    await sleep(200);
    const wardenBase = (await snapshot(page)).enemies.find(
      (enemy) => enemy.type === 'ashen-warden' && !enemy.dead,
    );
    if (!wardenBase) throw new Error('the end-clearing entry did not spawn a live Ashen Warden');

    // Do not freeze while a windup telegraph is live: pause would keep the
    // view active and make the quiet baseline fail for the wrong reason.
    const quiet = await waitForTelegraphIdle(page, 5000, false);
    check('baseline quiet wait leaves the hero alive', !quiet.dead,
      `hp ${quiet.playerHp}/${quiet.playerMaxHp}, telegraph ${quiet.probes.telegraph === null ? 'null' : 'live'}`);

    // Set a real destination ring on a clear world point, then pause at once.
    const destination = await page.evaluate(() => {
      const s = window.__ashen.snapshot();
      const living = s.enemies.filter((enemy) => !enemy.dead);
      living.sort((a, b) =>
        Math.hypot(a.x - s.playerPos.x, a.z - s.playerPos.z)
        - Math.hypot(b.x - s.playerPos.x, b.z - s.playerPos.z));
      const nearest = living[0];
      const away = nearest
        ? Math.atan2(s.playerPos.z - nearest.z, s.playerPos.x - nearest.x)
        : 0;
      const candidates = [];
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
        for (const distance of [4, 3.5, 5]) {
          const angle = away + turn;
          candidates.push({
            x: s.playerPos.x + Math.cos(angle) * distance,
            z: s.playerPos.z + Math.sin(angle) * distance,
          });
        }
      }
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
        candidates.push({ x: s.playerPos.x + dx, z: s.playerPos.z + dz });
      }
      const corridor = s.corridor;
      const inCorridor = (x, z) => {
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
        return depth <= corridor.radius - 1.2;
      };
      for (const { x, z } of candidates) {
        if (!inCorridor(x, z)) continue;
        if (s.enemies.some((enemy) => !enemy.dead && Math.hypot(enemy.x - x, enemy.z - z) < 3)) continue;
        const height = window.__ashen.terrainHeightAt(x, z);
        const screen = window.__ashen.worldToScreen(x, z, height);
        if (screen.x > 24 && screen.x < window.innerWidth - 24
          && screen.y > 24 && screen.y < window.innerHeight - 24) {
          return { x, z, screen };
        }
      }
      return null;
    });
    if (!destination) throw new Error('No clear destination point found near the hero');
    await page.mouse.click(destination.screen.x, destination.screen.y);
    await sleep(80);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'paused', null, { timeout: 5000 });
    await sleep(400);

    // Damage the live Warden while paused; the renderer still builds its view.
    await page.evaluate((id) => window.__ashen.hurtEnemy(id, 20), wardenBase.id);
    await sleep(400);

    const base = await snapshot(page);
    const baseState = stableRunState(base);
    const baseRender = { geometries: base.render.geometries, textures: base.render.textures };
    const baseSaves = await saveState(page);
    const baseScreen = await screenOf(page, base.playerPos.x, base.playerPos.z, base.playerRenderY);

    check('changed baseline is off spawn',
      Math.hypot(base.playerPos.x - warm.playerPos.x, base.playerPos.z - warm.playerPos.z) > 5,
      `spawn ${warm.playerPos.x},${warm.playerPos.z} -> ${base.playerPos.x.toFixed(2)},${base.playerPos.z.toFixed(2)}`);
    check('changed baseline carries real damage in HP or energy shield',
      base.playerHp < base.playerMaxHp || base.playerEnergyShield < base.playerMaxEnergyShield,
      `hp ${base.playerHp}/${base.playerMaxHp}, es ${base.playerEnergyShield}/${base.playerMaxEnergyShield}`);
    check('changed baseline carries earned XP and currency',
      (base.xp > warm.xp || base.level > warm.level) &&
      base.currency.dust - warm.currency.dust === 3 &&
      base.currency.rune - warm.currency.rune === 2 &&
      base.currency.quality - warm.currency.quality === 1,
      `level ${base.level}, xp ${base.xp}, currency ${base.currency.dust}/${base.currency.rune}/${base.currency.quality}`);
    check('changed baseline carries a bag item and an equipped item',
      base.bagCount === 1 &&
      base.equippedCount === 1 &&
      base.items.some((item) => item.uid === rareUid && item.equipped === false) &&
      base.items.some((item) => item.uid === equipUid && item.equipped === true),
      `items ${base.items.map((item) => `${item.uid}:${item.equipped ? 'eq' : 'bag'}:${item.rarity}`).join(', ')}`);
    check('changed baseline carries a moved skill loadout',
      base.skills.find((skill) => skill.slot === 'w')?.id === 'sunder' &&
      base.skills.find((skill) => skill.slot === 'q')?.id === null,
      JSON.stringify(base.skills.map((skill) => `${skill.slot}:${skill.id}`)));
    check('changed baseline carries the drained flask',
      base.flasks.health === 1 && base.flasks.mana === warm.flasks.mana,
      `flasks ${base.flasks.health}/${base.flasks.mana}/${base.flasks.max}`);
    check('changed baseline has all 16 camps cleared and a live damaged Warden',
      base.objectives.campsCleared === 16 &&
      base.objectives.campsTotal === 16 &&
      base.objectives.bossSpawned === true &&
      base.objectives.bossDefeated === false &&
      base.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead && enemy.hp < enemy.maxHp),
      `camps ${base.objectives.campsCleared}/${base.objectives.campsTotal}, boss ${base.objectives.bossSpawned}/${base.objectives.bossDefeated}, `
      + `enemies ${base.enemies.length}`);
    check('changed baseline has the real destination prompt set',
      base.markers.destination !== null && base.probes.rings.destination !== null,
      JSON.stringify(base.markers.destination));
    check('changed baseline is quiet and the Warden root is grounded',
      base.probes.telegraph === null &&
      base.probes.bossRoot !== null &&
      validProbeOrNull(base.probes.bossRoot, 'error'),
      `telegraph ${base.probes.telegraph === null ? 'null' : 'live'}, `
      + `bossRoot ${base.probes.bossRoot ? `error ${base.probes.bossRoot.error.toExponential(3)}` : 'missing'}`);
    console.log(`INFO  changed baseline: ${stateSummary(baseState)}, `
      + `destination ${destination.x.toFixed(1)},${destination.z.toFixed(1)}, `
      + `geo ${baseRender.geometries}, tex ${baseRender.textures}, `
      + `epoch ${base.render.mountEpoch}, terrain ${base.render.terrainId}`);
    console.log(`INFO  warm->baseline render delta (informational only): `
      + `${signed(baseRender.geometries - warmRender.geometries)} geo, `
      + `${signed(baseRender.textures - warmRender.textures)} tex`);

    await screenshotWithoutPauseOverlay(page, `${SHOTS}v15a-remount-before.png`);

    // ------------------------------------------------------------------
    // 2. Two paused remounts with exact state, epoch, camera and leak checks
    // ------------------------------------------------------------------
    const after1 = await pausedRemount(
      page, 'paused remount 1', base.render.mountEpoch + 1, base.render.terrainId + 1,
      base, baseState, baseRender, baseScreen, baseSaves, warmRender,
    );
    const after2 = await pausedRemount(
      page, 'paused remount 2', base.render.mountEpoch + 2, base.render.terrainId + 2,
      base, baseState, baseRender, baseScreen, baseSaves, warmRender,
    );
    check('paused remounts are leak-stable against each other',
      after2.render.geometries === after1.render.geometries &&
      after2.render.textures === after1.render.textures,
      `geometries ${after1.render.geometries}->${after2.render.geometries}, `
      + `textures ${after1.render.textures}->${after2.render.textures}`);
    check('no console errors through the paused remounts', errors.length === 0, errors.slice(0, 3).join(' | '));

    await screenshotWithoutPauseOverlay(page, `${SHOTS}v15a-remount-after.png`);

    // HUD and inventory must remain usable and still show the changed run.
    const hud = await page.evaluate(() => ({
      hidden: document.querySelector('[data-hud]')?.classList.contains('hidden') ?? true,
      hp: document.querySelector('[data-hp-text]')?.textContent?.trim() ?? '',
      objectives: document.querySelector('[data-objectives]')?.innerText ?? '',
    }));
    check('HUD still shows the changed HP and the 16 optional camps',
      !hud.hidden &&
      hud.hp === `${Math.round(base.playerHp)} / ${Math.round(base.playerMaxHp)}` &&
      hud.objectives.includes('Camps cleared (16/16) — optional') &&
      hud.objectives.includes('Slay the Ashen Warden'),
      `hp "${hud.hp}", objectives "${hud.objectives.replace(/\n/g, ' / ')}"`);

    await page.locator('[data-screen="paused"] [data-action="resume"]').click();
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 5000 });
    await page.keyboard.press('i');
    await page.locator('.inventory-panel').waitFor({ state: 'visible' });
    const bagText = (await page.locator('[data-bag-count]').innerText()).trim();
    const bagNames = await page.locator('[data-bag-grid] .item-cell').allInnerTexts();
    const equippedNames = await page.locator('[data-eq-slots] .eq-item').allInnerTexts();
    const baseBagItem = base.items.find((item) => item.uid === rareUid);
    const baseEquippedItem = base.items.find((item) => item.uid === equipUid);
    check('inventory shows the exact bag count and item content after the remounts',
      bagText === `${base.bagCount}/40` &&
      bagNames.length === base.bagCount &&
      bagNames[0] === baseBagItem?.name &&
      equippedNames.length === base.equippedCount &&
      equippedNames[0] === baseEquippedItem?.name,
      `bag "${bagText}" ${JSON.stringify(bagNames)}, equipped ${JSON.stringify(equippedNames)}`);
    await page.keyboard.press('i');
    await page.locator('.inventory-panel').waitFor({ state: 'hidden' });

    // ------------------------------------------------------------------
    // 3. Live atomic remount: snapshot -> remount -> snapshot, no tick
    // ------------------------------------------------------------------
    const currentWarden = (await snapshot(page)).enemies.find(
      (enemy) => enemy.type === 'ashen-warden' && !enemy.dead,
    );
    if (!currentWarden) throw new Error('Warden disappeared before the live remount');
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [currentWarden.x, currentWarden.z + 7]);
    await sleep(300);
    const localBase = await waitForTelegraphIdle(page, 2000, true);
    check('near-Warden quiet baseline is telegraph-free',
      localBase.probes.telegraph === null,
      localBase.probes.telegraph === null ? 'null' : JSON.stringify(localBase.probes.telegraph));

    let telegraph = null;
    let deadDuringWait = false;
    const waitStart = Date.now();
    for (let i = 0; Date.now() - waitStart < 8000; i++) {
      const s = await snapshot(page);
      if (s.dead) {
        deadDuringWait = true;
        break;
      }
      if (s.probes.telegraph) {
        telegraph = s.probes.telegraph;
        break;
      }
      if (i % 5 === 0) await page.evaluate(() => window.__ashen.healPlayer(9999));
      await sleep(100);
    }
    check('a live nearby Warden produces a windup telegraph within 8s',
      telegraph !== null && !deadDuringWait,
      telegraph ? `id ${telegraph.id}` : deadDuringWait ? 'player died during the wait' : 'no windup within 8000ms');
    if (telegraph) {
      check('the measured telegraph has vertices and is draped tightly',
        telegraph.vertices > 0 && telegraph.maxError >= 0 && telegraph.maxError < PROBE_ERROR,
        `id ${telegraph.id}, ${telegraph.vertices} vertices, maxError ${telegraph.maxError.toExponential(3)}`);
    }

    // Establish a real hover before the live remount. The pointer must be over
    // clear ground, and the hover must survive into the same before-snapshot
    // that also carries the destination ring and live telegraph.
    const hoverCandidates = await page.evaluate(() => {
      const s = window.__ashen.snapshot();
      const boss = s.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
      let dx = boss ? s.playerPos.x - boss.x : 1;
      let dz = boss ? s.playerPos.z - boss.z : 0;
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      const directions = [
        { x: -dz, z: dx },
        { x: dz, z: -dx },
        { x: dx, z: dz },
        { x: -dx, z: -dz },
      ];
      const corridor = s.corridor;
      const inCorridor = (x, z) => {
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
        return depth <= corridor.radius - 1.2;
      };
      const candidates = [];
      for (const direction of directions) {
        for (const distance of [2, 2.5, 3]) {
          const x = s.playerPos.x + direction.x * distance;
          const z = s.playerPos.z + direction.z * distance;
          if (!inCorridor(x, z)) continue;
          if (s.enemies.some((enemy) => !enemy.dead && Math.hypot(enemy.x - x, enemy.z - z) < 2)) continue;
          const height = window.__ashen.terrainHeightAt(x, z);
          const screen = window.__ashen.worldToScreen(x, z, height);
          if (screen.x > 24 && screen.x < window.innerWidth - 24
            && screen.y > 24 && screen.y < window.innerHeight - 24) {
            candidates.push({ x, z, screen });
          }
        }
      }
      return candidates;
    });
    let hoverSet = null;
    for (const candidate of hoverCandidates) {
      await page.mouse.move(candidate.screen.x, candidate.screen.y);
      await sleep(150);
      const s = await snapshot(page);
      if (s.probes.rings.hover !== null) {
        hoverSet = s;
        break;
      }
    }
    check('live remount: hover ring is established before the remount',
      hoverSet !== null,
      hoverSet ? JSON.stringify(hoverSet.probes.rings.hover) : 'no hover after pointer moves over clear ground');

    const live = await page.evaluate(() => {
      const readStorage = () => {
        const keys = Object.keys(localStorage)
          .filter((key) => key.startsWith('ashen-vale:save:'))
          .sort();
        const storage = {};
        for (const key of keys) storage[key] = localStorage.getItem(key);
        return storage;
      };

      const before = window.__ashen.snapshot();
      const screenBefore = window.__ashen.worldToScreen(
        before.playerPos.x, before.playerPos.z, before.playerRenderY,
      );
      const savesBefore = window.__ashen.saves();
      const storageBefore = readStorage();

      // Set a destination ring synchronously, away from the Warden, then remount
      // in the same turn so no fixed tick or render can run in between.
      const boss = before.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
      let dx = boss ? before.playerPos.x - boss.x : 1;
      let dz = boss ? before.playerPos.z - boss.z : 0;
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      const destX = before.playerPos.x + dx * 2;
      const destZ = before.playerPos.z + dz * 2;
      const destHeight = window.__ashen.terrainHeightAt(destX, destZ);
      const destScreen = window.__ashen.worldToScreen(destX, destZ, destHeight);
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: destScreen.x,
        clientY: destScreen.y,
        button: 0,
        bubbles: true,
        cancelable: true,
        pointerId: 99,
      }));

      const marked = window.__ashen.snapshot();
      const destinationSet = marked.probes.rings.destination !== null;
      const hoverBefore = marked.probes.rings.hover;
      const telegraphBefore = marked.probes.telegraph;
      window.__ashen.remountZone('ashen-moor');
      const after = window.__ashen.snapshot();
      const screenAfter = window.__ashen.worldToScreen(
        after.playerPos.x, after.playerPos.z, after.playerRenderY,
      );
      const savesAfter = window.__ashen.saves();
      const storageAfter = readStorage();

      return {
        marked,
        after,
        screenBefore,
        screenAfter,
        destinationSet,
        hoverBefore,
        telegraphBefore,
        savesBefore,
        savesAfter,
        storageBefore,
        storageAfter,
      };
    });

    const liveDiff = firstDifference(stableRunState(live.marked), stableRunState(live.after));
    check('live remount: persistent state unchanged with no tick intervening',
      liveDiff === null,
      liveDiff ?? stateSummary(stableRunState(live.after)));
    check('live remount: corridor route unchanged',
      JSON.stringify(live.after.corridor) === JSON.stringify(live.marked.corridor),
      live.after.corridor
        ? `${live.after.corridor.points.length} points, radius ${live.after.corridor.radius}`
        : 'corridor missing');
    check('live remount: mount epoch increments exactly once',
      live.after.render.mountEpoch === live.marked.render.mountEpoch + 1,
      `epoch ${live.marked.render.mountEpoch} -> ${live.after.render.mountEpoch}`);
    check('live remount: terrain id increments exactly once',
      live.after.render.terrainId === live.marked.render.terrainId + 1,
      `terrain ${live.marked.render.terrainId} -> ${live.after.render.terrainId}`);
    check('live remount: destination and hover rings were set, then both cleared',
      live.destinationSet &&
      live.hoverBefore !== null &&
      live.after.probes.rings.destination === null &&
      live.after.probes.rings.hover === null,
      `before destination ${live.destinationSet ? 'set' : 'missing'}, hover ${live.hoverBefore ? 'set' : 'missing'}; `
      + `after destination ${live.after.probes.rings.destination === null ? 'null' : 'visible'}, `
      + `hover ${live.after.probes.rings.hover === null ? 'null' : 'visible'}`);
    check('live remount: active telegraph cleared',
      live.telegraphBefore !== null && live.after.probes.telegraph === null,
      `before ${live.telegraphBefore ? live.telegraphBefore.id : 'null'}, `
      + `after ${live.after.probes.telegraph === null ? 'null' : 'live'}`);
    const livePixels = screenDistance(live.screenBefore, live.screenAfter);
    check('live remount: projected player point unchanged',
      livePixels <= CAMERA_PIXEL_TOLERANCE,
      `projection moved ${livePixels.toFixed(3)}px`);
    const liveGround = await terrainHeight(page, live.after.playerPos.x, live.after.playerPos.z);
    check('live remount: player ground probe is exact and sampled from the surface',
      live.after.probes.playerGround.y === live.after.playerRenderY &&
      live.after.probes.playerGround.height === liveGround &&
      live.after.probes.playerGround.error < 1e-6,
      `probe y ${live.after.probes.playerGround.y.toFixed(9)} vs renderY ${live.after.playerRenderY.toFixed(9)}, `
      + `height ${live.after.probes.playerGround.height.toFixed(9)} vs terrainHeightAt ${liveGround.toFixed(9)}, `
      + `error ${live.after.probes.playerGround.error.toExponential(3)}`);
    check('live remount: transient render resources do not grow',
      live.after.render.geometries <= localBase.render.geometries &&
      live.after.render.textures <= localBase.render.textures,
      `local base ${localBase.render.geometries}/${localBase.render.textures}, `
      + `after ${live.after.render.geometries}/${live.after.render.textures} `
      + `(drop = cleared telegraph/combat views; exact scenery leak is checked on the paused remounts)`);
    check('live remount: save slots and localStorage unchanged',
      firstDifference(live.savesBefore, live.savesAfter) === null &&
      firstDifference(live.storageBefore, live.storageAfter) === null,
      firstDifference(live.savesBefore, live.savesAfter) ?? 'unchanged');

    // ------------------------------------------------------------------
    // 4. Rebuilt surface keeps the measured slope; live Warden still grounded
    // ------------------------------------------------------------------
    if (slopeEvidence) {
      const slopeNow = await finiteNormal(
        page, slopeEvidence.hoverPoint.x, slopeEvidence.hoverPoint.z,
      );
      const componentError = Math.max(
        Math.abs(slopeNow.x - slopeEvidence.hoverNormal.x),
        Math.abs(slopeNow.y - slopeEvidence.hoverNormal.y),
        Math.abs(slopeNow.z - slopeEvidence.hoverNormal.z),
      );
      check('remounted surface reproduces the pre-remount slope normal',
        componentError < 1e-4 && slopeNow.y < 0.9999,
        `components error ${componentError.toExponential(3)}, `
        + `before ${normalDetail(slopeEvidence.hoverNormal)}, now ${normalDetail(slopeNow)}`);
    } else {
      check('remounted surface reproduces the pre-remount slope normal', false, 'initial slope evidence missing');
    }

    const finalState = await snapshot(page);
    check('live Warden root remains grounded after the remounts',
      finalState.probes.bossRoot !== null &&
      validProbeOrNull(finalState.probes.bossRoot, 'error'),
      finalState.probes.bossRoot
        ? `id ${finalState.probes.bossRoot.id}, error ${finalState.probes.bossRoot.error.toExponential(3)}`
        : 'bossRoot missing');

    const finalSaves = await saveState(page);
    const finalSaveDiff = firstDifference(baseSaves, finalSaves);
    check('no save path ran across the whole remount suite',
      finalSaveDiff === null,
      finalSaveDiff ?? 'save slots and localStorage unchanged');

    check('no console errors across the remount suite', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log('INFO  screenshots: qa/shots/v15a-remount-before.png, qa/shots/v15a-remount-after.png');
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
