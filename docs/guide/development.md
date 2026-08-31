# Development

## Prerequisites

- **Rust** 1.85+ with the `wasm32-unknown-unknown` target. Edition 2024 is
  required by `dbase`.
- **wasm-pack**
- **Node** 18+
- **pnpm** 11+ (`corepack enable pnpm`, or install it however you prefer)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  --target wasm32-unknown-unknown

curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

git clone https://github.com/crmackey/shapefile-wasm
cd shapefile-wasm
pnpm install
pnpm run build
```

## The workspace

This is a pnpm workspace. The library is the root package; `demo/` is a member
that links it with `workspace:*`. One `pnpm install` at the root covers both,
and there is a single `pnpm-lock.yaml` — the demo does not have its own.

That linkage is why the demo always builds against your working tree rather than
a published copy, and why `pnpm run build` has to run before the demo does.

pnpm refuses to run dependency install scripts unless they are approved in
`pnpm-workspace.yaml`. Only `esbuild` is, for the platform binary Vite and
Vitest need. If a dependency update makes pnpm ask about a new one, look at what
the script actually does before running `pnpm approve-builds`.

## Scripts

| Script | Does |
| --- | --- |
| `pnpm run build` | The three build stages below, in order |
| `pnpm run build:wasm` | `wasm-pack` compiles `rust/` into `pkg/` |
| `pnpm run build:inline` | Embeds the `.wasm` as base64, copies the glue into `src/generated/` |
| `pnpm run build:ts` | `tsc` into `dist/`, then copies the runtime glue across |
| `pnpm run typecheck` | Type-check without emitting |
| `pnpm run test` | Rust tests, a build, then the TypeScript suite |
| `pnpm run docs:dev` | This site, with hot reload |
| `pnpm run projections` | Re-scrape the EPSG table from epsg.io |
| `pnpm run clean` | Remove all build output and generated sources |

## Two load-bearing bits of Cargo.toml

Both of these look like noise and are not. Removing either breaks the build in a
way whose error message points somewhere else entirely.

### wasm-opt feature flags

```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = ["-Oz", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", ...]
```

The `wasm-opt` binary that wasm-pack downloads defaults to an older feature set
than the current Rust toolchain emits. Without these flags the build fails
validation:

```
[wasm-validator error] unexpected false: Bulk memory operations require
bulk memory [--enable-bulk-memory]
```

Every feature listed is baseline in all browsers since 2021 and in Node 16.

### The `time` dependency

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
time = { version = "0.3", default-features = false, features = ["wasm-bindgen"] }
```

`dbase` stamps the `.dbf` header with today's date. That reaches
`SystemTime::now()`, which is unimplemented on `wasm32-unknown-unknown` and
**aborts the whole module** — surfacing in JavaScript as a bare
`RuntimeError: unreachable` with no hint of the cause.

The `wasm-bindgen` feature makes `time` read the clock from JavaScript instead.
This crate does not use `time` directly; the dependency exists purely so Cargo's
feature unification applies it to `dbase`'s copy.

## Debugging a panic

`panic = "abort"` in the release profile means panics surface as
`RuntimeError: unreachable`. To get a real message:

```bash
wasm-pack build --dev --target web --out-dir pkg --out-name shapefile_wasm
```

```js
import init, { setPanicHook } from './pkg/shapefile_wasm.js';
await init({ module_or_path: await readFile('./pkg/shapefile_wasm_bg.wasm') });
setPanicHook();
```

The panic message and a demangled Rust stack then go to `console.error`.

## Regenerating the projection table

```bash
pnpm run projections
```

Scrapes [epsg.io](https://epsg.io) for the codes listed in
`scripts/fetch-projections.mjs` and rewrites `src/generated/projections.ts`.

This is **not** part of the build, and the result is committed. The published
package must never depend on that service being reachable, and a `.prj` that
changes silently between builds would be worse than one that is missing.

## Adding a geometry type

1. Add the variant in `rust/input.rs` (`Geometry`, `Family`).
2. Add the conversion in `rust/geometry.rs`.
3. Add the arm to the `match` in `write_geometry` in `rust/lib.rs`.
4. Add the reverse in `shape_to_geometry` in `rust/read.rs`.
5. Add a round-trip test.

The `match` in `write_geometry` is exhaustive over `(Family, Dimension)`, so the
compiler will point at what is missing.

## Code style

Rust is `rustfmt` default. TypeScript is 2-space, single quotes, trailing commas,
100-column soft wrap.

Comments explain *why*, not *what* — most of the non-obvious code in this
repository exists to work around a specific sharp edge in the shapefile or dBase
format, and that reason is worth recording.
