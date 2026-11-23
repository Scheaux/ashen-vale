// Run against npm run dev: node qa/animation-review.mjs [output directory]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.argv[2] ?? 'qa/shots/animation-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const modelStats = {};
try {
  const page = await browser.newPage({ viewport: { width: 650, height: 480 } });
  page.on('pageerror', (error) => console.error(error));
  await page.route('**/__pose-review', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body></body>',
  }));
  await page.goto(`${process.env.QA_URL ?? 'http://localhost:5173'}/__pose-review`);
  for (const id of ['marauder', 'ranger', 'witch']) {
    for (const view of ['close', 'game', 'portrait']) {
      const poses = view === 'portrait'
        ? { idle: 'idle' }
        : { idle: 'idle', run: 'run', load: 0.29, contact: id === 'marauder' ? 0.45 : 0.6, finish: 0.77 };
      for (const [key, pose] of Object.entries(poses)) {
        const counts = await page.evaluate(async ([id, view, pose]) => {
          const { renderPose, modelStats } = await import('/qa/pose-review.ts');
          renderPose(id, view, pose);
          return modelStats();
        }, [id, view, pose]);
        if (view === 'game' && key === 'idle') modelStats[id] = counts;
        await page.screenshot({ path: join(out, `${id}-${view}-${key}.png`) });
      }
    }
  }
  await writeFile(join(out, 'model-stats.json'), `${JSON.stringify(modelStats, null, 2)}\n`);
} finally {
  await browser.close();
}
