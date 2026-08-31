/**
 * Builds the Vue demo and stages it inside the VitePress site.
 *
 * Same approach as the Rust docs: the demo is its own Vite application, so its
 * output is copied into `dist/demo/` *after* `vitepress build` rather than
 * through `docs/public/`. Letting one Vite build process another's output
 * produces duplicated assets and rewritten URLs.
 *
 * The base is handed over as `DEMO_BASE` rather than a CLI flag: the demo's
 * build script chains a type-check before Vite, and trailing arguments would
 * attach to the wrong half of it.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEMO = resolve(ROOT, 'demo');
const DEMO_DIST = resolve(DEMO, 'dist');

const dev = process.argv.includes('--dev');
// Staged at /app/, not /demo/. The docs page about the demo renders to
// `demo.html`, which cleanUrls serves at /demo — and a host asked for /demo
// with both `demo.html` and a `demo/` directory present has to guess. Sharing
// no prefix removes the ambiguity.
const STAGED = dev ? resolve(ROOT, 'docs/public/app') : resolve(ROOT, 'docs/.vitepress/dist/app');

if (!existsSync(resolve(DEMO, 'node_modules'))) {
  console.error('demo/node_modules is missing. Run `pnpm install` at the workspace root.');
  process.exit(1);
}

// The docs base plus /demo/. DOCS_BASE already carries a trailing slash.
const docsBase = process.env.DOCS_BASE ?? '/';
const base = `${docsBase.replace(/\/+$/, '')}/app/`;

const build = spawnSync('pnpm', ['run', 'build'], {
  cwd: DEMO,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DEMO_BASE: base },
});

if (build.status !== 0) {
  console.error('the demo build failed');
  process.exit(build.status ?? 1);
}

if (!dev && !existsSync(resolve(ROOT, 'docs/.vitepress/dist'))) {
  console.error('docs/.vitepress/dist does not exist — run `vitepress build docs` first.');
  process.exit(1);
}

await rm(STAGED, { recursive: true, force: true });
await mkdir(STAGED, { recursive: true });
await cp(DEMO_DIST, STAGED, { recursive: true });

console.log(`staged the demo at ${STAGED.replace(`${ROOT}/`, '')} (served at ${base})`);
