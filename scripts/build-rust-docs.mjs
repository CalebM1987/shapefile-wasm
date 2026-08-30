/**
 * Builds the Rust API docs and stages them inside the VitePress site, so the
 * guide, the TypeScript reference and the Rust reference all live at one URL
 * instead of three.
 *
 * `cargo doc` emits a self-contained static site. Where it gets staged depends
 * on what is being run:
 *
 * * `--dev`  -> `docs/public/rust/`, which `vitepress dev` serves at `/rust/`.
 * * default  -> `docs/.vitepress/dist/rust/`, copied in *after* `vitepress
 *   build` has finished.
 *
 * The build case deliberately bypasses `public/`. Rustdoc ships a handful of
 * `.html` license files, and Vite pulls those into its own output as well —
 * harmless, but it leaves a confusing duplicate `dist/public/` tree. Copying
 * after the build keeps rustdoc's output out of Vite's sight entirely, and
 * byte-for-byte identical to what `cargo doc` produced.
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CRATE_DOCS = resolve(ROOT, 'target/doc');

const dev = process.argv.includes('--dev');
const STAGED = dev
  ? resolve(ROOT, 'docs/public/rust')
  : resolve(ROOT, 'docs/.vitepress/dist/rust');

const result = spawnSync('cargo', ['doc', '--no-deps'], {
  cwd: ROOT,
  stdio: 'inherit',
  // cargo lives in ~/.cargo/bin, which is not always on a CI PATH.
  env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
});

if (result.status !== 0) {
  console.error('cargo doc failed; is the Rust toolchain installed?');
  process.exit(result.status ?? 1);
}

if (!existsSync(CRATE_DOCS)) {
  console.error(`expected generated docs at ${CRATE_DOCS}`);
  process.exit(1);
}

if (!dev && !existsSync(resolve(ROOT, 'docs/.vitepress/dist'))) {
  console.error('docs/.vitepress/dist does not exist — run `vitepress build docs` first.');
  process.exit(1);
}

await rm(STAGED, { recursive: true, force: true });
await mkdir(STAGED, { recursive: true });
await cp(CRATE_DOCS, STAGED, { recursive: true });

// Rustdoc nests everything under the crate name and leaves its root bare, so
// point /rust/ at the crate landing page.
await writeFile(
  resolve(STAGED, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>shapefile-wasm — Rust API</title>
    <meta http-equiv="refresh" content="0; url=./shapefile_wasm/index.html">
    <link rel="canonical" href="./shapefile_wasm/index.html">
  </head>
  <body>
    <p>Redirecting to the <a href="./shapefile_wasm/index.html">Rust API documentation</a>.</p>
  </body>
</html>
`,
  'utf8',
);

console.log(`staged Rust docs at ${STAGED.replace(`${ROOT}/`, '')} (served at /rust/)`);
