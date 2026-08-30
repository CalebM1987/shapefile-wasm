/**
 * Points git at the tracked hooks in `.githooks/`.
 *
 * Runs from the `prepare` script, so `npm install` sets a contributor up with
 * no extra step. Deliberately not husky: this repository publishes to npm, and
 * the commit-message check is forty lines of shell — not worth another
 * dependency in a tree that has to be trusted.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `prepare` also runs in CI, in Docker images, and when the package is
// installed from a git URL. None of those are a working checkout, so do
// nothing rather than fail an install.
const isRepo = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' });
if (isRepo.status !== 0 || !existsSync(resolve(ROOT, '.githooks'))) {
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: ROOT,
  stdio: 'inherit',
});

if (result.status === 0) {
  console.log('git hooks enabled from .githooks/');
} else {
  // A hook that will not install is an inconvenience, never a failed install.
  console.warn('could not set core.hooksPath; commit messages will not be checked locally');
}
