/**
 * Mirrors the root CHANGELOG.md into the documentation site.
 *
 * release-please owns CHANGELOG.md and knows nothing about `docs/`. Keeping a
 * second hand-written copy would guarantee the two drift, so the docs page is
 * generated from the canonical file and gitignored.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const source = await readFile(resolve(ROOT, 'CHANGELOG.md'), 'utf8');

// Drop the file's own H1: VitePress takes the page title from the first
// heading, and the sidebar already says "Changelog".
const body = source.replace(/^#\s+.*\n+/, '');

await writeFile(
  resolve(ROOT, 'docs/guide/changelog.md'),
  `<!-- Generated from CHANGELOG.md by scripts/sync-changelog.mjs. Do not edit. -->

# Changelog

${body.trimStart()}`,
  'utf8',
);

console.log('synced CHANGELOG.md into docs/guide/changelog.md');
