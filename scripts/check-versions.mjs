/**
 * Fails if package.json and Cargo.toml disagree about the version.
 *
 * release-please bumps both, but through different mechanisms — the node
 * release type for package.json, a generic annotation for Cargo.toml. If the
 * annotation is ever dropped, the two drift apart silently and a release goes
 * out with a crate version that does not match the package.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const cargo = await readFile(resolve(ROOT, 'Cargo.toml'), 'utf8');

// The first `version = "..."` after [package], which is the crate's own.
const match = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargo);

if (!match) {
  console.error('could not find the crate version in Cargo.toml');
  process.exit(1);
}

const [, crateVersion] = match;

if (crateVersion !== pkg.version) {
  console.error(
    `version mismatch:\n` +
      `  package.json  ${pkg.version}\n` +
      `  Cargo.toml    ${crateVersion}\n\n` +
      'Check that the `# x-release-please-version` annotation is still on the ' +
      'version line in Cargo.toml.',
  );
  process.exit(1);
}

if (!cargo.includes('x-release-please-version')) {
  console.error(
    'Cargo.toml has lost its `# x-release-please-version` annotation. ' +
      'release-please will stop bumping the crate version.',
  );
  process.exit(1);
}

console.log(`versions agree: ${pkg.version}`);
