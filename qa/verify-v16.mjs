/**
 * v1.6 linear-moor expansion browser QA.
 *
 * Covers the end-to-end shape of the 16-camp bog:
 *  - corridor spawn, 16 optional camps, 16-slot save body and save card;
 *  - clearing some camps while skipping others, then waking the Warden by
 *    entering the end clearing (never by camp completion);
 *  - no arena clamp, Warden leash/return and re-engage;
 *  - sealed portal before the kill, open portal/victory after the kill, the
 *    ossuary refusal on portal interaction, and portal persistence through
 *    save/reload/Continue;
 *  - v8 save/reload with a 16-slot body and a zero-camp live-boss body;
 *  - the densest 16-camp pull and the end Warden/portal animation against the
 *    desktop draw-call/triangle budget.
 *
 * Run: node qa/verify-v16.mjs   (starts `vite preview` on :4173 itself)
 */
import { chromium } from 'playwright';
import { startPreviewServer, stopServer } from './server.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.QA_URL ?? 'http://localhost:4173';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DRAW_BUDGET = 320;
const TRIANGLE_BUDGET = 260_000;
const MOOR_SLOTS = 16;
const OSSUARY_SLOTS = 3;

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

async function startRun(page, classId = 'marauder') {
  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(200);
  await page.click(`[data-class="${classId}"]`);
  await page.click('[data-action="begin"]');
  await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 10000 });
  await sleep(600);
}

async function reload(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
}

async function waitForPlaying(page) {
  await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 10000 });
  await sleep(400);
}

async function readRawSave(page, slot) {
  const raw = await page.evaluate(
    (slotIndex) => localStorage.getItem(`ashen-vale:save:${slotIndex}`),
    slot,
  );
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeRawSave(page, slot, save) {
  await page.evaluate(({ slotIndex, body }) => {
    localStorage.setItem(`ashen-vale:save:${slotIndex}`, body);
    localStorage.removeItem(`ashen-vale:save:${slotIndex}:backup`);
  }, { slotIndex: slot, body: JSON.stringify(save) });
}

/** Distance from a point to the corridor polyline (same band the sim uses). */
function corridorDistance(point, corridor) {
  let best = Infinity;
  for (let i = 0; i < corridor.points.length - 1; i++) {
    const a = corridor.points[i];
    const b = corridor.points[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const lengthSq = vx * vx + vz * vz;
    const t = lengthSq > 0
      ? Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.z - a.z) * vz) / lengthSq))
      : 0;
    const x = a.x + vx * t;
    const z = a.z + vz * t;
    best = Math.min(best, Math.hypot(point.x - x, point.z - z));
  }
  return best;
}

function inCorridor(point, corridor, margin = 0) {
  return corridorDistance(point, corridor) <= corridor.radius - margin;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

/**
 * Sample the live renderer after a settle warmup. Frame time is headless
 * software rendering and is reported only; draw calls and triangles are the
 * desktop budgets.
 */
async function sampleRender(page, frames = 60, warmup = 12) {
  return page.evaluate(async ({ frames: frameCount, warmup: warmCount }) => {
    const records = [];
    const frameTimes = [];
    let phase = 0;
    let last = 0;
    const total = frameCount + warmCount;
    await new Promise((resolve) => {
      const step = (now) => {
        if (phase > 0) frameTimes.push(now - last);
        last = now;
        window.__ashen.healPlayer(9999);
        const render = window.__ashen.snapshot().render;
        if (phase >= warmCount) {
          records.push({
            calls: render.drawCalls,
            triangles: render.triangles,
            detailed: render.detailedEnemies,
          });
        }
        phase++;
        if (phase < total) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

    const sortedPct = (values, p) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
    };
    const calls = records.map((record) => record.calls);
    const triangles = records.map((record) => record.triangles);
    const times = frameTimes.slice(warmCount);
    return {
      callsP50: sortedPct(calls, 0.5),
      callsP95: sortedPct(calls, 0.95),
      callsMax: Math.max(...calls),
      trianglesP50: sortedPct(triangles, 0.5),
      trianglesP95: sortedPct(triangles, 0.95),
      trianglesMax: Math.max(...triangles),
      detailedMax: Math.max(...records.map((record) => record.detailed)),
      frameP50: sortedPct(times, 0.5),
      frameP95: sortedPct(times, 0.95),
      samples: records.length,
    };
  }, { frames, warmup });
}

function checkRenderBudget(label, sample) {
  check(`${label}: draw calls stay within the expansion budget`,
    sample.callsP95 <= DRAW_BUDGET && sample.callsMax <= DRAW_BUDGET,
    `p50 ${sample.callsP50}, p95 ${sample.callsP95}, max ${sample.callsMax} <= ${DRAW_BUDGET}`);
  check(`${label}: triangles stay within the expansion budget`,
    sample.trianglesP95 <= TRIANGLE_BUDGET && sample.trianglesMax <= TRIANGLE_BUDGET,
    `p50 ${sample.trianglesP50}, p95 ${sample.trianglesP95}, max ${sample.trianglesMax} <= ${TRIANGLE_BUDGET}`);
  console.log(`  INFO ${label}: ${sample.samples} frames, detailed rigs max ${sample.detailedMax}, `
    + `headless frame p50/p95 ${sample.frameP50.toFixed(1)}/${sample.frameP95.toFixed(1)} ms (diagnostic only)`);
}

function hasZoneProgressShape(save) {
  if (!save || !save.progress || typeof save.progress !== 'object') return false;
  const ids = Object.keys(save.progress).sort();
  if (ids.length !== 2 || ids[0] !== 'ashen-moor' || ids[1] !== 'drowned-ossuary') return false;
  return ids.every((id) => {
    const progress = save.progress[id];
    const expected = id === 'ashen-moor' ? MOOR_SLOTS : OSSUARY_SLOTS;
    return Boolean(progress)
      && Array.isArray(progress.campsCleared)
      && progress.campsCleared.length === expected
      && progress.campsCleared.every((flag) => typeof flag === 'boolean')
      && typeof progress.bossSpawned === 'boolean'
      && typeof progress.bossDefeated === 'boolean';
  });
}

function campaignZoneIds() {
  const source = readFileSync(new URL('../src/content/zones.ts', import.meta.url), 'utf8');
  const match = source.match(/export const CAMPAIGN_ZONES[^=]*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

async function main() {
  let server = null;
  let browser = null;

  try {
    if (!process.env.QA_URL) server = startPreviewServer(4173);
    await waitForServer(BASE);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(8000);
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const snap = () => page.evaluate(() => window.__ashen.snapshot());
    const saves = () => page.evaluate(() => window.__ashen.saves());

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await reload(page);
    check('the expansion suite starts on the title', (await snap()).mode === 'title');

    // ------------------------------------------------------------------
    // 1. Corridor spawn, 16 optional camps, 16-slot save and save card
    // ------------------------------------------------------------------
    await startRun(page, 'marauder');
    let s = await snap();
    check('a new run enters play', s.mode === 'playing' && !s.dead);

    const corridor = s.corridor;
    check('the moor exposes the authored corridor',
      corridor !== null
      && corridor.points.length === 4
      && corridor.radius === 29
      && corridor.points[0].x === 0 && corridor.points[0].z === 74
      && corridor.points[3].x === 0 && corridor.points[3].z === -72,
      JSON.stringify(corridor));

    const spawnDistance = Math.hypot(s.playerPos.x - 0, s.playerPos.z - 74);
    check('the hero spawns at the corridor mouth',
      spawnDistance < 1.5 && inCorridor(s.playerPos, corridor, 0.5),
      `position ${s.playerPos.x.toFixed(2)},${s.playerPos.z.toFixed(2)}, distance ${spawnDistance.toFixed(2)}`);

    check('the moor opens with 16 optional camps and none cleared',
      s.objectives.campsTotal === 16 && s.objectives.campsCleared === 0,
      JSON.stringify(s.objectives));
    const openingHud = await page.locator('.objectives__list').innerText();
    check('HUD marks the 16 camps optional',
      openingHud.includes('Camps cleared (0/16) — optional'), openingHud);
    check('HUD points at the far-end Warden',
      openingHud.includes('Reach the Ashen Warden at the far end'), openingHud);
    check('the Warden is asleep before the end clearing',
      !s.objectives.bossSpawned && !s.enemies.some((enemy) => enemy.type === 'ashen-warden'));
    check('the camp population is the authored 16-camp roster',
      s.enemies.filter((enemy) => !enemy.dead).length >= 48
      && s.enemies.filter((enemy) => !enemy.dead).length <= 80,
      `${s.enemies.filter((enemy) => !enemy.dead).length} camp enemies`);
    await page.screenshot({ path: `${SHOTS}v16-corridor-spawn.png` });

    let slotState = await saves();
    check('the new run autosaves into slot 1 with a 16-camp total',
      slotState.activeSlot === 0
      && slotState.slots[0].status === 'ok'
      && slotState.slots[0].campsTotal === 16
      && slotState.slots[0].campsCleared === 0,
      `active ${slotState.activeSlot}, camps ${slotState.slots[0].campsCleared}/${slotState.slots[0].campsTotal}`);

    await page.keyboard.press('Escape');
    await page.locator('[data-action="load-slots"]').waitFor({ state: 'visible' });
    await page.click('[data-action="load-slots"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const saveCard = await page.locator('.save-slot[data-slot="0"]').innerText();
    check('the save card shows 16 camps and a sleeping Warden',
      /The Ashen Moor/.test(saveCard) && /Camps 0\/16/.test(saveCard) && /Warden sleeping/.test(saveCard),
      saveCard.replace(/\n/g, ' | '));
    await page.locator('[data-save-close]').click();
    await sleep(200);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__ashen?.snapshot().mode === 'playing', null, { timeout: 5000 });
    await sleep(300);

    const freshBody = await readRawSave(page, 0);
    check('the checkpoint body is v8 with a 16-slot moor and 3-slot ossuary',
      Boolean(freshBody)
      && freshBody.version === 8
      && hasZoneProgressShape(freshBody)
      && freshBody.progress['ashen-moor'].campsCleared.every((flag) => flag === false),
      freshBody
        ? `version ${freshBody.version}, moor ${freshBody.progress?.['ashen-moor']?.campsCleared?.length}`
        : 'missing slot body');

    check('the moor is the final CAMPAIGN_ZONES entry',
      campaignZoneIds().at(-1) === 'ashen-moor', campaignZoneIds().join(', '));

    // ------------------------------------------------------------------
    // 2. Densest 16-camp pull performance sample
    // ------------------------------------------------------------------
    const campFocus = await page.evaluate(() => {
      const current = window.__ashen.snapshot();
      const alive = current.enemies.filter((enemy) => !enemy.dead);
      let best = null;
      for (const enemy of alive) {
        const near = alive.filter((other) =>
          Math.hypot(other.x - enemy.x, other.z - enemy.z) <= 17);
        if (!best || near.length > best.count) {
          best = { x: enemy.x, z: enemy.z, count: near.length };
        }
      }
      if (!best) return null;
      const group = alive.filter((enemy) =>
        Math.hypot(enemy.x - best.x, enemy.z - best.z) <= 17);
      return {
        x: group.reduce((sum, enemy) => sum + enemy.x, 0) / group.length,
        z: group.reduce((sum, enemy) => sum + enemy.z, 0) / group.length,
        count: group.length,
      };
    });
    check('a dense camp pull can be located', campFocus !== null && campFocus.count >= 5,
      campFocus ? `${campFocus.count} enemies within 17 of ${campFocus.x.toFixed(1)},${campFocus.z.toFixed(1)}` : 'no camp cluster');
    if (campFocus) {
      await page.evaluate(([x, z]) => {
        window.__ashen.healPlayer(9999);
        window.__ashen.teleportPlayer(x, z);
      }, [campFocus.x, campFocus.z]);
      await sleep(1400);
      const campSample = await sampleRender(page);
      checkRenderBudget('densest camp pull', campSample);
      check('the densest camp pull keeps the detailed rig cap',
        campSample.detailedMax <= 8, `${campSample.detailedMax} detailed rigs <= 8`);
      await page.screenshot({ path: `${SHOTS}v16-densest-camp.png` });
    }

    // ------------------------------------------------------------------
    // 3. Clear some camps, skip the others, then enter the end clearing
    // ------------------------------------------------------------------
    await page.evaluate(() => {
      window.__ashen.teleportPlayer(0, 74);
      window.__ashen.healPlayer(9999);
    });
    await sleep(400);
    const killSummary = await page.evaluate(() => {
      const current = window.__ashen.snapshot();
      // Kill the camps on the spawn-half of the corridor and leave the far
      // half untouched, so the boss wake-up cannot depend on camp completion.
      const targets = current.enemies.filter((enemy) => !enemy.dead && enemy.z > 10);
      for (const enemy of targets) window.__ashen.hurtEnemy(enemy.id, 99999);
      return targets.length;
    });
    await sleep(700);
    s = await snap();
    check('some camps are cleared while others are skipped',
      s.objectives.campsCleared > 0
      && s.objectives.campsCleared < 16
      && s.enemies.some((enemy) => !enemy.dead && enemy.type !== 'ashen-warden'),
      `killed ${killSummary}; camps ${s.objectives.campsCleared}/16, `
      + `${s.enemies.filter((enemy) => !enemy.dead).length} enemies still alive`);
    check('clearing the spawn-half camps does not wake the Warden',
      s.objectives.bossSpawned === false
      && !s.enemies.some((enemy) => enemy.type === 'ashen-warden'),
      JSON.stringify(s.objectives));
    const partialHud = await page.locator('.objectives__list').innerText();
    check('HUD keeps the partial camp track optional',
      partialHud.includes(`Camps cleared (${s.objectives.campsCleared}/16) — optional`)
      && partialHud.includes('Reach the Ashen Warden at the far end'),
      partialHud.replace(/\n/g, ' / '));

    const arenaEntry = { x: s.arena.x, z: s.arena.z };
    await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [arenaEntry.x, arenaEntry.z]);
    await page.waitForFunction(() => window.__ashen.snapshot().objectives.bossSpawned, null, { timeout: 5000 });
    await sleep(500);
    s = await snap();
    check('entering the end clearing wakes the Warden without the camps',
      s.objectives.bossSpawned === true && s.objectives.campsCleared < 16,
      JSON.stringify(s.objectives));
    check('the hero is not moved or clamped by the Warden spawn',
      Math.hypot(s.playerPos.x - arenaEntry.x, s.playerPos.z - arenaEntry.z) < 0.75,
      `position ${s.playerPos.x.toFixed(2)},${s.playerPos.z.toFixed(2)} vs arena ${arenaEntry.x},${arenaEntry.z}`);
    const wardenAtSpawn = s.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    check('the Warden waits at the end-clearing centre',
      Boolean(wardenAtSpawn)
      && Math.hypot(wardenAtSpawn.x - s.arena.x, wardenAtSpawn.z - s.arena.z) <= s.arena.radius + 1,
      wardenAtSpawn ? `distance ${Math.hypot(wardenAtSpawn.x - s.arena.x, wardenAtSpawn.z - s.arena.z).toFixed(2)}` : 'missing');
    check('HUD flips to the Warden objective', (await page.locator('.objectives__list').innerText()).includes('Slay the Ashen Warden'));

    check('the portal is sealed before the Warden falls',
      s.objectives.portalOpen === false
      && s.portal?.open === false
      && (s.portal?.glow ?? 1) < 0.01,
      JSON.stringify({ objectives: s.objectives, portal: s.portal }));

    // ------------------------------------------------------------------
    // 4. Retreat is allowed; the Warden leashes home and re-engages
    // ------------------------------------------------------------------
    const leashRadius = s.arena.radius + 10;
    const retreat = { x: 0, z: -45 };
    check('the retreat point is inside the corridor and outside the leash',
      inCorridor(retreat, s.corridor, 0.6)
      && Math.hypot(retreat.x - s.arena.x, retreat.z - s.arena.z) > leashRadius + 4,
      `distance ${Math.hypot(retreat.x - s.arena.x, retreat.z - s.arena.z).toFixed(1)} > ${leashRadius + 4}`);

    await page.evaluate(([x, z]) => {
      window.__ashen.healPlayer(9999);
      window.__ashen.teleportPlayer(x, z);
    }, [retreat.x, retreat.z]);
    await sleep(900);
    s = await snap();
    check('the hero can retreat down the corridor with the Warden live',
      Math.hypot(s.playerPos.x - retreat.x, s.playerPos.z - retreat.z) < 1.5
      && Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z) > leashRadius,
      `position ${s.playerPos.x.toFixed(2)},${s.playerPos.z.toFixed(2)}, `
      + `arena distance ${Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z).toFixed(1)}`);

    const wardenHomeStart = await snap();
    const wardenBefore = wardenHomeStart.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    let wardenHome = null;
    const homeWaitStart = Date.now();
    while (Date.now() - homeWaitStart < 22000) {
      await page.evaluate(() => window.__ashen.healPlayer(9999));
      const now = await snap();
      const warden = now.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
      if (warden
        && warden.phase === 'idle'
        && Math.hypot(warden.x - now.arena.x, warden.z - now.arena.z) <= 2) {
        wardenHome = { ...warden, arena: now.arena, playerPos: now.playerPos };
        break;
      }
      await sleep(200);
    }
    check('the Warden leashes home instead of following the retreat',
      wardenHome !== null,
      wardenHome
        ? `phase ${wardenHome.phase}, distance ${Math.hypot(wardenHome.x - wardenHome.arena.x, wardenHome.z - wardenHome.arena.z).toFixed(2)}`
        : `no home return within 22s (last ${wardenBefore ? wardenBefore.phase : 'missing'})`);
    if (wardenHome) {
      check('the Warden keeps its health through the leash return',
        wardenHome.hp === wardenHome.maxHp,
        `${wardenHome.hp}/${wardenHome.maxHp}`);
    }

    await page.evaluate(([x, z]) => {
      window.__ashen.healPlayer(9999);
      window.__ashen.teleportPlayer(x, z);
    }, [0, -64]);
    let reengaged = null;
    const reengageStart = Date.now();
    while (Date.now() - reengageStart < 8000) {
      await page.evaluate(() => window.__ashen.healPlayer(9999));
      const now = await snap();
      const warden = now.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
      if (warden && warden.phase !== 'idle') {
        reengaged = warden;
        break;
      }
      await sleep(100);
    }
    check('the Warden re-engages when the hero returns to the ring',
      reengaged !== null,
      reengaged ? `phase ${reengaged.phase}` : 'still idle after 8s');

    // ------------------------------------------------------------------
    // 5. End clearing Warden pack / sealed portal performance sample
    // ------------------------------------------------------------------
    await page.evaluate(() => window.__ashen.healPlayer(9999));
    const liveWarden = (await snap()).enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    if (liveWarden) {
      await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 300), [liveWarden.id]);
      await sleep(600);
      const phaseState = await snap();
      check('the end-clearing Warden pack reaches phase 2 adds',
        phaseState.enemies.some((enemy) => enemy.type === 'ashen-warden' && enemy.bossPhase >= 1)
        && phaseState.enemies.some((enemy) => enemy.id.startsWith('add-') && !enemy.dead),
        `${phaseState.enemies.filter((enemy) => enemy.id.startsWith('add-') && !enemy.dead).length} adds`);
      await page.evaluate(() => window.__ashen.teleportPlayer(0, -66));
      await sleep(900);
      const wardenSample = await sampleRender(page);
      checkRenderBudget('end Warden pack', wardenSample);
      await page.screenshot({ path: `${SHOTS}v16-warden-pack.png` });
    } else {
      check('the end-clearing Warden pack reaches phase 2 adds', false, 'Warden missing');
      check('end Warden pack: draw calls stay within the expansion budget', false, 'Warden missing');
      check('end Warden pack: triangles stay within the expansion budget', false, 'Warden missing');
    }

    // ------------------------------------------------------------------
    // 6. Save/reload: 16-slot body and zero-camp live-boss fixture
    // ------------------------------------------------------------------
    const liveBody = JSON.parse(await page.evaluate(() => window.__ashen.exportSave()));
    s = await snap();
    check('the live v8 export carries a 16-slot moor and partial camp progress',
      liveBody.version === 8
      && hasZoneProgressShape(liveBody)
      && s.objectives.campsCleared > 0
      && s.objectives.campsCleared < 16
      && liveBody.progress['ashen-moor'].bossSpawned === true,
      `version ${liveBody.version}, camps ${s.objectives.campsCleared}/16, `
      + `body slots ${liveBody.progress?.['ashen-moor']?.campsCleared?.length}`);

    const zeroCampBody = JSON.parse(JSON.stringify(liveBody));
    zeroCampBody.progress['ashen-moor'].campsCleared = Array.from({ length: MOOR_SLOTS }, () => false);
    zeroCampBody.progress['ashen-moor'].bossSpawned = true;
    zeroCampBody.progress['ashen-moor'].bossDefeated = false;
    zeroCampBody.savedAt = Date.now() + 1000;
    await writeRawSave(page, 1, zeroCampBody);
    await reload(page);

    slotState = await saves();
    check('a zero-camp live-boss v8 save is accepted',
      slotState.slots[1].status === 'ok'
      && slotState.slots[1].campsTotal === 16
      && slotState.slots[1].campsCleared === 0
      && slotState.slots[1].bossSpawned === true
      && slotState.slots[1].bossDefeated === false,
      `${slotState.slots[1].status}, camps ${slotState.slots[1].campsCleared}/${slotState.slots[1].campsTotal}, `
      + `boss ${slotState.slots[1].bossSpawned}/${slotState.slots[1].bossDefeated}`);

    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    const zeroCard = await page.locator('.save-slot[data-slot="1"]').innerText();
    check('the zero-camp save card still shows 16 slots and an awake Warden',
      /Camps 0\/16/.test(zeroCard) && /Warden awake/.test(zeroCard),
      zeroCard.replace(/\n/g, ' | '));
    await page.locator('.save-slot[data-slot="1"] .save-slot__body').click();
    await waitForPlaying(page);
    s = await snap();
    const zeroWardens = s.enemies.filter((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    const thresholdDistance = Math.hypot(s.playerPos.x - s.arena.x, s.playerPos.z - s.arena.z);
    check('loading the zero-camp save restores the live Warden and partial progress',
      s.objectives.campsTotal === 16
      && s.objectives.campsCleared === 0
      && s.objectives.bossSpawned === true
      && s.objectives.bossDefeated === false
      && zeroWardens.length === 1,
      JSON.stringify({ objectives: s.objectives, wardens: zeroWardens.length }));
    check('the zero-camp restore places the hero at the end-clearing threshold',
      thresholdDistance < s.arena.radius && thresholdDistance > s.arena.radius - 2,
      `distance ${thresholdDistance.toFixed(2)} / radius ${s.arena.radius}`);
    check('the zero-camp restore keeps the portal sealed',
      s.objectives.portalOpen === false && s.portal?.open === false,
      JSON.stringify({ objectives: s.objectives, portal: s.portal }));

    // Return to the partial-camp autosave for the victory flow.
    await reload(page);
    await page.click('[data-action="load-game"]');
    await page.locator('.save-screen').waitFor({ state: 'visible' });
    await page.locator('.save-slot[data-slot="0"] .save-slot__body').click();
    await waitForPlaying(page);
    s = await snap();
    check('the partial-camp autosave survives the zero-camp detour',
      s.objectives.campsCleared > 0
      && s.objectives.campsCleared < 16
      && s.objectives.bossSpawned === true
      && s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead),
      JSON.stringify(s.objectives));

    // ------------------------------------------------------------------
    // 7. Kill with camps unfinished: portal opens, victory, refusal, reload
    // ------------------------------------------------------------------
    const finalWarden = s.enemies.find((enemy) => enemy.type === 'ashen-warden' && !enemy.dead);
    if (finalWarden) {
      await page.evaluate(([id]) => window.__ashen.hurtEnemy(id, 99999), [finalWarden.id]);
    }
    await page.waitForFunction(() => {
      const current = window.__ashen.snapshot();
      return current.objectives.bossDefeated && current.objectives.portalOpen;
    }, null, { timeout: 5000 });
    await sleep(800);
    s = await snap();
    check('the Warden dies with camps unfinished',
      s.objectives.campsCleared > 0 && s.objectives.campsCleared < 16 && s.objectives.bossDefeated,
      JSON.stringify(s.objectives));
    check('the final-zone Warden opens the victory screen',
      await page.locator('[data-screen="victory"]').isVisible());
    check('the portal opens on the Warden kill',
      s.objectives.portalOpen === true
      && s.portal?.open === true
      && (s.portal?.glow ?? 0) > 0.5,
      JSON.stringify({ objectives: s.objectives, portal: s.portal }));
    check('the Warden’s Gate toast is announced',
      (await page.locator('.toast').filter({ hasText: /Gate opens/ }).count()) > 0);
    const victoryKills = Number(await page.locator('[data-victory-kills]').textContent());
    check('the victory summary counts the run', victoryKills > 0, `${victoryKills} kills`);
    await page.screenshot({ path: `${SHOTS}v16-victory.png` });

    await page.click('[data-action="continue"]');
    await sleep(500);
    s = await snap();
    check('Continue keeps the portal open',
      !(await page.locator('[data-screen="victory"]').isVisible())
      && s.mode === 'playing'
      && s.objectives.portalOpen === true
      && s.portal?.open === true,
      JSON.stringify({ mode: s.mode, objectives: s.objectives, portal: s.portal }));

    // Approach the open gate; let the approach toast expire, then click it.
    await page.evaluate(([x, z]) => window.__ashen.teleportPlayer(x, z), [0, -76]);
    await page.waitForTimeout(3100);
    const portalScreen = await page.evaluate(() => {
      const current = window.__ashen.snapshot();
      const height = window.__ashen.terrainHeightAt(current.portal.x, current.portal.z) + 0.1;
      return window.__ashen.worldToScreen(current.portal.x, current.portal.z, height);
    });
    await page.mouse.click(portalScreen.x, portalScreen.y);
    await sleep(200);
    const refusal = page.locator('.toast').filter({ hasText: /Ossuary is not yet available/i }).last();
    check('clicking the open portal refuses the unfinished Ossuary',
      await refusal.isVisible().catch(() => false),
      (await refusal.innerText().catch(() => 'no refusal toast')).trim());
    await page.screenshot({ path: `${SHOTS}v16-portal-open.png` });

    slotState = await saves();
    check('victory checkpoints the completed 16-slot zone',
      slotState.slots[0].status === 'ok'
      && slotState.slots[0].campsTotal === 16
      && slotState.slots[0].bossDefeated === true,
      `${slotState.slots[0].status}, camps ${slotState.slots[0].campsCleared}/${slotState.slots[0].campsTotal}, `
      + `defeated ${slotState.slots[0].bossDefeated}`);

    // Open portal performance sample (the animated gate plus the end clearing).
    const portalSample = await sampleRender(page);
    checkRenderBudget('open portal / end clearing', portalSample);

    await reload(page);
    await page.click('[data-action="continue-run"]');
    await waitForPlaying(page);
    s = await snap();
    check('Continue after reload keeps the defeated Warden and open portal',
      s.objectives.bossDefeated === true
      && s.objectives.portalOpen === true
      && s.portal?.open === true
      && !s.enemies.some((enemy) => enemy.type === 'ashen-warden' && !enemy.dead),
      JSON.stringify({ objectives: s.objectives, portal: s.portal }));
    check('Continue after reload keeps the partial camp progress',
      s.objectives.campsTotal === 16
      && s.objectives.campsCleared > 0
      && s.objectives.campsCleared < 16,
      `${s.objectives.campsCleared}/16`);

    check('no console errors across the expansion suite',
      consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
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
