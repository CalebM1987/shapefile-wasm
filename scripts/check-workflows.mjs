/**
 * Static checks on the GitHub Actions workflows.
 *
 * These catch mistakes that only surface as a failed run minutes after a push,
 * or — worse, in the pinning case — never surface at all:
 *
 * 1. A job that runs a build needing a tool, without installing that tool.
 *    `docs.yml` shipped once running `pnpm run build` with no wasm-pack.
 * 2. An action referenced by a mutable tag rather than a commit SHA. A tag can
 *    be repointed by its owner, which matters most in the jobs holding an OIDC
 *    token.
 * 3. A workflow with no `permissions` block, which silently inherits the
 *    repository or organisation default — often more than the job needs.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, '.github/workflows');

/**
 * A command that needs something installed first, and how to recognise the
 * installer. Matched textually: parsing every `run:` shape is not worth it, and
 * a false positive here is cheap to read.
 */
const PREREQUISITES = [
  {
    // Any package build compiles the Rust core to wasm.
    needs: /run:\s*pnpm run (build|docs:build)\b|^\s*pnpm run build\s*$/m,
    installer: /tool:\s*wasm-pack/,
    tool: 'wasm-pack',
  },
  {
    needs: /\bcargo (test|build|doc|fmt|clippy|update|audit)\b/,
    installer: /uses:\s*dtolnay\/rust-toolchain@/,
    tool: 'the Rust toolchain',
  },
  {
    needs: /\bpnpm (install|run|exec|pack|audit)\b/,
    installer: /uses:\s*pnpm\/action-setup@/,
    tool: 'pnpm',
  },
  {
    needs: /\bcargo audit\b/,
    installer: /tool:\s*cargo-audit/,
    tool: 'cargo-audit',
  },
];

const problems = [];

for (const file of (await readdir(DIR)).filter((f) => /\.ya?ml$/.test(f))) {
  const source = await readFile(resolve(DIR, file), 'utf8');

  for (const { needs, installer, tool } of PREREQUISITES) {
    if (needs.test(source) && !installer.test(source)) {
      problems.push(`${file}: runs a step needing ${tool}, but never installs it`);
    }
  }

  // Every `uses:` must carry a 40-character commit SHA.
  for (const line of source.split('\n')) {
    const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
    if (!match?.[1]) continue;

    const ref = match[1];
    // A local or Docker action has no tag to pin.
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;

    if (!/@[0-9a-f]{40}$/.test(ref)) {
      problems.push(`${file}: ${ref} is not pinned to a commit SHA`);
    }
  }

  if (!/^permissions:/m.test(source)) {
    problems.push(`${file}: declares no top-level permissions block`);
  }
}

if (problems.length > 0) {
  console.error('workflow checks failed:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('workflows look consistent: prerequisites installed, actions pinned, permissions set');
