# AGENTS.md

Guidance for anyone — human or AI — contributing to `@crmackey/shapefile-wasm`.

Read this before making changes. Much of the code here looks over-careful until
you know which sharp edge of the shapefile format it is working around, and the
fastest way to introduce a subtle data-corruption bug is to "simplify" one of
those places.

---

## What this project is

A Rust core compiled to WebAssembly that converts between GeoJSON and ESRI
Shapefiles, with a TypeScript layer for zipping, projections and browser
integration.

```
rust/       Rust core → WebAssembly. Geometry and attribute conversion only.
src/        TypeScript. Zip, projections, browser helpers, public API.
test/       vitest suites (the Rust has its own #[cfg(test)] modules).
scripts/    Build helpers. Plain .mjs, no framework.
docs/       VitePress site: hand-written guide + generated API references.
```

**The division matters.** The Rust core knows nothing about zip files,
projections, or browsers — it converts bytes. Anything else belongs in `src/`.
This keeps the wasm binary small and leaves the core usable as a plain Rust
crate. Do not reach for a Rust crate to do something TypeScript can do.

---

## Before you start

```bash
npm install          # also installs the git hooks
npm run build        # wasm → inline → TypeScript
npm test             # Rust tests, build, TypeScript tests
```

You need Rust 1.85+ with the `wasm32-unknown-unknown` target, wasm-pack, and
Node 18+. See [Development](https://crmackey.github.io/shapefile-wasm/guide/development).

---

## Ground rules

### 1. Do not break the format invariants

These are not style preferences. Each one exists because getting it wrong
produces a file that opens fine in one GIS and silently misbehaves in another.

- **`.dbf` column widths are measured from the data, never guessed.** The
  `dbase` crate crops any value that overruns its column *without erroring*, so
  a guessed width turns `-123456789.125` into a different number. If you touch
  `rust/schema.rs`, keep the measuring pass.
- **Every record supplies every column.** `dbase` treats a missing field as a
  hard error, not a null. Ragged input is padded before it reaches the writer.
- **Features with no geometry are skipped, and counted.** The `.shp` and `.dbf`
  are paired by position. Writing an attribute row with no shape shifts every
  later pairing — corruption that surfaces months later, in someone else's tool.
- **Polygon holes are re-nested by containment, not by order.** A shapefile
  stores rings flat. Pairing them by index is the obvious approach and it is
  wrong; see `rings_to_geometry` in `rust/read.rs`.
- **Ring winding is converted in both directions.** Shapefiles wind exteriors
  clockwise, RFC 7946 counter-clockwise.
- **Text is truncated on character boundaries.** `dbase` crops bytes, which
  would split a multi-byte character and produce invalid UTF-8.

### 2. Guard the panic paths

`panic = "abort"` in the release profile means a Rust panic reaches JavaScript
as a bare `RuntimeError: unreachable` with no message. The underlying crates
panic on several inputs — a polyline part with under two points, an empty ring
list — so those are checked ahead of time and returned as proper errors.

If you call a new `shapefile` or `dbase` constructor, read its source for
`assert!` and guard it. A panic that escapes to a user is a bug.

### 3. Explain *why*, not *what*

The comment density here is deliberate. A comment restating the code is noise; a
comment recording which format quirk forced the code is the reason the next
person does not undo it.

```rust
// Good: records the constraint.
// `dbase` crops overlong values silently, so the width has to come from the
// data rather than a guess.

// Useless: restates the code.
// Set the width to the max length.
```

### 4. Every public API gets a docstring

TypeDoc runs with `notDocumented` validation and CI treats warnings as failure.
Public TypeScript needs `@param`, `@returns`, `@throws` and at least one
`@example`; public Rust needs `///` with `# Arguments` and `# Errors`. These are
also what editors show on hover, so write them for someone mid-task.

Note that TypeDoc reads the first line after `@example` as the example's *title*,
so put a short description there, not the opening code fence.

### 5. Prefer a round-trip test

`test/roundtrip.test.ts` writes bytes and reads them straight back. Without
binary fixtures from other software, that is the only real evidence that what we
emit is what a reader understands.

Make fixtures adversarial. A hole-nesting test passes even when the logic is
wrong if both polygons sit in the same place — so the fixture puts them 100 units
apart and asserts each hole came back on its own square.

### 6. Keep the dependency tree small

The published package has **one** runtime dependency (`fflate`). That is a
feature. A new runtime dependency needs a real justification; a new dev
dependency should earn its place too.

This is also why the git hooks are forty lines of shell rather than husky and
commitlint.

---

## Commits and releases

**Conventional Commits are enforced** by `.githooks/commit-msg`, installed
automatically by `npm install`. CI also checks pull request titles, because a
squash merge turns the title into the commit message on `main`.

```
feat: add multi-layer archives
fix(read): attach holes to the containing ring
docs: explain the nested layout
feat!: drop the trimStrings option
```

Types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
`revert`, `style`, `test`. A `!` or a `BREAKING CHANGE:` footer marks a breaking
change.

**Releases are automated.** release-please reads these commits, opens a release
PR that bumps `package.json`, `Cargo.toml` and `CHANGELOG.md`, and on merge tags
a GitHub Release — which triggers the npm publish. So:

- `fix:` → patch, `feat:` → minor, `!` → major (minor while pre-1.0)
- Never hand-edit a version or `CHANGELOG.md`; release-please owns both
- The commit message *is* the changelog entry — write it for a reader

---

## Security

This package parses untrusted input and publishes to npm. Both matter.

- The crate declares `#![forbid(unsafe_code)]`. Keep it.
- Every GitHub Action is pinned to a **commit SHA**, not a tag. Dependabot
  updates them. Do not "tidy" a SHA back to `@v4`.
- Workflows declare least-privilege `permissions`. Only publish and Pages can
  mint an OIDC token, and neither runs on pull requests.
- npm publishing uses **Trusted Publishing** — there is no long-lived npm token.
  Do not add one.
- `package.json` uses a `files` allowlist. Check `npm pack --dry-run` after
  changing what the build emits.

See [SECURITY.md](./SECURITY.md).

---

## Checks to run

CI runs all of these; running them first saves a round trip.

```bash
cargo test                              # Rust unit tests
cargo fmt --check                       # formatting
cargo clippy --all-targets -- -D warnings
npm run build                           # wasm + TypeScript
npm run typecheck                       # tsc --noEmit
npm run check:versions                  # package.json vs Cargo.toml
npm run test:ts                         # vitest
npm run docs:api                        # TypeDoc; warnings are failures
npm pack --dry-run                      # what would ship
```

TypeScript is strict, including `exactOptionalPropertyTypes` — so build option
objects by omitting absent keys rather than assigning `undefined`. See
`resolveOptions` in `src/layers.ts`.

---

## Common tasks

**Adding a geometry type**

1. `rust/input.rs` — the `Geometry` and `Family` variants
2. `rust/geometry.rs` — the conversion
3. `rust/lib.rs` — an arm in `write_geometry`'s match
4. `rust/read.rs` — the reverse, in `shape_to_geometry`
5. A round-trip test

The match in `write_geometry` is exhaustive over `(Family, Dimension)`, so the
compiler points at what is missing.

**Adding a write option**

1. `rust/lib.rs` — the `Options` struct, `#[serde(rename_all = "camelCase")]`
2. `src/types.ts` — the `WriteOptions` interface, with a docstring
3. `src/write.ts` — pass it through
4. `src/layers.ts` — add it to `resolveOptions` so batches honour it
5. Tests, and a mention in the guide

**Adding EPSG codes to the bundled table**

Edit the `CODES` list in `scripts/fetch-projections.mjs` and run
`npm run projections`. The result is committed on purpose — the published
package must never depend on epsg.io being reachable.

**Changing what the package ships**

Update the `files` array in `package.json`, then verify with
`npm pack --dry-run`. The `files` allowlist takes precedence over `.gitignore`,
so gitignored build output still ships — that is intended for `dist/` and `pkg/`.

---

## Things that will surprise you

- **`docs/reference/` and `src/generated/` are generated** and gitignored.
  `src/generated/projections.ts` is the exception: it is committed on purpose.
- **`Cargo.toml` has two load-bearing blocks.** The `wasm-opt` feature flags
  (the bundled `wasm-opt` predates the features Rust emits) and the `time`
  dependency (`dbase` stamps the `.dbf` header with today's date, which reaches
  `SystemTime::now()` — unimplemented on wasm, and it aborts the module).
  Removing either breaks the build with an error pointing somewhere else.
- **`src/generated/bindings.js` is copied, not compiled.** `tsc` will not emit
  for it, so `scripts/copy-runtime.mjs` places it in `dist/` by hand.
- **The wasm binary is embedded as base64** in the main entry point. `/slim`
  exists for consumers who would rather serve the `.wasm` themselves.

---

## Notes for AI agents

- **Verify, do not assume.** Read the actual signature in
  `~/.cargo/registry/…/shapefile-0.9.0/src/` before calling into it. Several
  APIs in these crates differ from what a plausible guess would produce —
  `build_with_dest` rather than `bind_to`, `finalize()` returning `()` rather
  than the cursor.
- **Run the checks.** Do not report work as done on the strength of it looking
  right. `cargo test` and `npm run test:ts` are fast.
- **Watch for truncated output.** A `curl` piped through `head` can cut off the
  status line and lead you to the wrong conclusion about an API's behaviour.
- **Do not weaken a test to make it pass.** If a test fails, decide whether the
  code or the expectation is wrong, and say which.
- **Leave the comments.** They encode format constraints that are not
  recoverable from reading the code.
