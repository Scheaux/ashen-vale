# Deploying Ashen Vale to GitHub Pages

The game is a static Vite build. `vite.config.ts` already sets `base: './'`, so
the project page can live at:

**https://scheaux.github.io/ashen-vale/**

## One-time repository setup

Pages is not enabled yet (`has_pages: false` as of the v1.5.0 release). This
step needs repository admin access in the GitHub UI; the workflow's
`GITHUB_TOKEN` cannot enable Pages by itself.

1. Open <https://github.com/Scheaux/ashen-vale/settings/pages>.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Make sure the repository has Pages available (public repository, or a plan
   that supports Pages for private repositories).

If the workflow runs before this is done, it stops at **Configure Pages** with
a "Get Pages site failed" error. Enable the source above, then re-run the
failed job (or **Actions → Deploy to GitHub Pages → Run workflow**). No code
change is needed.

The workflow is `.github/workflows/pages.yml`. It runs on every push to `main`
and can be started manually from **Actions → Deploy to GitHub Pages → Run
workflow**.

## What the workflow does

- checks out the exact commit;
- installs from `package-lock.json` with `npm ci`;
- runs the unit tests;
- builds `dist/` with `npm run build` (typecheck + Vite);
- uploads `dist/` as the Pages artifact;
- deploys with the official `deploy-pages` action.

It does **not** run the Playwright QA chain; run `npm run qa` locally before
merging a release.

## Local production check

```bash
npm run build
npm run preview   # http://localhost:4173
```

Open the title screen, start a run, move, fight, open the inventory and pause
menu, save/continue, and confirm there are no console errors.

## Post-deploy smoke test

Open the Pages URL and verify:

- the title screen renders and assets load from `/ashen-vale/assets/...`;
- New Game → class select → play;
- movement, combat, salvage, passive tree, inventory, save/continue;
- no console errors, no 404s in the network panel;
- the page works after a hard refresh and from a fresh browser profile.

A local Playwright smoke run can target the deployed URL by setting
`QA_URL=https://scheaux.github.io/ashen-vale/`.

## Rollback

Pages keeps deployment history. Re-run the workflow for the last good commit
from **Actions → Deploy to GitHub Pages → Run workflow**, or revert the bad
commit on `main` and push. Never force-push `main` for a rollback.

## Notes

- `dist/` is generated and git-ignored; the artifact is uploaded, not committed.
- Vite hashes assets, so Pages' static caching is safe.
- `vite.config.ts` enables sourcemaps. If public sourcemaps are unwanted, set
  `build.sourcemap` to `false` before deploying.
- Save data is `localStorage` scoped to the Pages origin, separate from local
  development.
- If Pages is not enabled, the workflow stops at **Configure Pages**; enable the
  source as above and re-run.
