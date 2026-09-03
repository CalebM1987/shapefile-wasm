# @crmackey/shapefile-wasm

Read and write ESRI Shapefiles from GeoJSON — in the browser, in Node, and in
workers. The conversion runs in a Rust core compiled to WebAssembly; the
TypeScript layer handles zipping, projections and the browser bits.

No server round-trip, no GDAL, no native build step for consumers.

```ts
import { writeShapefileZip, readShapefileZip } from '@crmackey/shapefile-wasm';

// GeoJSON -> a zipped .shp/.shx/.dbf/.cpg/.prj bundle
const zip = await writeShapefileZip(featureCollection, {
  fileName: 'survey-points',
  epsg: 26915,
});

// ...and back again
const layers = await readShapefileZip(zip);
console.log(layers[0].geojson.features.length);
```

📖 **[Full documentation](https://calebm1987.github.io/shapefile-wasm/)** — guide,
TypeScript API reference and Rust API reference in one searchable site. Run it
locally with `pnpm run docs:dev`; see [Documentation](#documentation).

---

## Contents

- [@crmackey/shapefile-wasm](#crmackeyshapefile-wasm)
  - [Contents](#contents)
  - [Why](#why)
  - [Install](#install)
  - [Quick start](#quick-start)
    - [Write](#write)
    - [Read](#read)
    - [In the browser](#in-the-browser)
  - [API](#api)
    - [Write options](#write-options)
    - [Read options](#read-options)
  - [Projections](#projections)
  - [Multiple layers](#multiple-layers)
  - [Looking up a projection](#looking-up-a-projection)
  - [Entry points](#entry-points)
  - [How it maps GeoJSON to a shapefile](#how-it-maps-geojson-to-a-shapefile)
  - [Known limits](#known-limits)
  - [Development](#development)
    - [Prerequisites](#prerequisites)
    - [Build](#build)
    - [A note on the wasm build](#a-note-on-the-wasm-build)
  - [Testing](#testing)
  - [Documentation](#documentation)
    - [Running it](#running-it)
    - [What it is assembled from](#what-it-is-assembled-from)
    - [Guide contents](#guide-contents)
    - [Where the output goes](#where-the-output-goes)
  - [Contributing](#contributing)
  - [Continuous integration](#continuous-integration)
    - [Setting up GitHub Pages](#setting-up-github-pages)
    - [Publishing a release](#publishing-a-release)
  - [Project layout](#project-layout)
  - [How it works](#how-it-works)
  - [License](#license)

---

## Why

A shapefile is not one file — it is a `.shp` of geometry, a `.shx` index, a
`.dbf` attribute table in a 1980s database format, and a `.prj` of projection
text, all of which have to agree with each other. Getting that right in
JavaScript is fiddly; getting it wrong produces files that open fine in one GIS
and silently misbehave in another.

This package leans on two well-tested Rust crates — [`shapefile`](https://crates.io/crates/shapefile) and [`dbase`](https://crates.io/crates/dbase) — and puts a small, typed API in front of them.

Some specific things it takes care of:

- **dBase column widths are computed from the data.** `dbase` silently crops a
  value that overruns its column, so a guessed width turns `-123456789.125` into
  a different number. Widths here are derived from the widest value actually
  present.
- **Polygon holes are re-nested on read.** A shapefile stores rings in one flat
  list with no nesting. Reading back, each hole is matched to the *smallest*
  ring that contains it, so two adjacent donuts do not swap holes.
- **Ring winding is corrected.** Shapefiles wind exteriors clockwise; RFC 7946
  wants counter-clockwise. Both directions are handled.
- **Field names are truncated and de-duplicated.** dBase caps names at 11 bytes.
  `measurement_one` and `measurement_two` both truncate to `measurement`, so the
  second gets a suffix — and the full mapping is reported back to you.
- **Ragged properties are padded.** `dbase` treats a record that omits a declared
  field as an error, not a null.

## Install

```bash
npm install @crmackey/shapefile-wasm
```

Requires Node 18+ or any browser with WebAssembly. The `.wasm` binary is
embedded in the package, so there is nothing to copy or serve and no bundler
configuration to write. If you would rather stream the binary separately, see
[Entry points](#entry-points).

## Quick start

### Write

```ts
import { writeShapefile, writeShapefileZip } from '@crmackey/shapefile-wasm';

const featureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-93.265, 44.9778] },
      properties: { name: 'Minneapolis', pop: 429954, county_seat: true },
    },
  ],
};

// One archive, ready to save or upload.
const zip = await writeShapefileZip(featureCollection, {
  fileName: 'cities',
  epsg: 4326,
});

// Or the raw components, if you need them individually.
const parts = await writeShapefile(featureCollection, { epsg: 4326 });
parts.shp; // Uint8Array
parts.dbf; // Uint8Array
parts.shapeType; // "Point"
parts.fields; // how each property became a .dbf column
```

### Read

```ts
import { readShapefile, readShapefileZip } from '@crmackey/shapefile-wasm';

// From a zip — handles archives with several layers, including nested folders.
const layers = await readShapefileZip(zipBytes);
for (const layer of layers) {
  console.log(layer.name, layer.geojson.features.length, layer.prj);
}

// Or from loose components. The .shx is not needed.
const geojson = await readShapefile({
  shp: await readFile('roads.shp'),
  dbf: await readFile('roads.dbf'),
  prj: await readFile('roads.prj', 'utf8'),
});
```

### In the browser

Anything touching the DOM lives behind a separate entry point, so the core stays
importable from Node and during SSR.

```ts
import { downloadShapefileZip, readShapefileFile } from '@crmackey/shapefile-wasm/browser';

// Save to the user's downloads.
await downloadShapefileZip(featureCollection, { fileName: 'parcels', epsg: 4326 });

// Read whatever they picked with <input type="file">.
input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  const layers = await readShapefileFile(file);
});
```

## API

Every function instantiates the WebAssembly module on first use, so `init()` is
optional. Full signatures and options are in the generated
[API documentation](#documentation) and in your editor's IntelliSense.

| Function | Purpose |
| --- | --- |
| `writeShapefile(geojson, options?)` | GeoJSON → `.shp`/`.shx`/`.dbf`/`.cpg` bytes plus metadata |
| `writeShapefileZip(geojson, options?)` | GeoJSON → a single zip archive |
| `zipParts(parts, options?)` | Pack already-generated components into a zip |
| `readShapefile(source, options?)` | Components → GeoJSON `FeatureCollection` |
| `readShapefileZip(archive, options?)` | Archive → one entry per layer |
| `writeLayersZip(layers, options?)` | Several GeoJSON inputs → one multi-layer archive |
| `writeLayers(layers, options?)` | Convert a batch without packing it |
| `zipLayers(written, options?)` | Pack an already-converted batch |
| `fetchProjection(epsg, options?)` | Look up a definition from epsg.io |
| `init(source?)` | Instantiate the wasm module ahead of time |
| `isReady()` | Whether instantiation has finished |
| `registerProjections(map)` | Add or override EPSG → WKT definitions |
| `getProjection(epsg)` | Look up a loaded definition |
| `registeredProjections()` | List loaded EPSG codes |
| `loadProjectionTable()` | Force-load the bundled EPSG table |

From `@crmackey/shapefile-wasm/browser`:

| Function | Purpose |
| --- | --- |
| `downloadShapefileZip(geojson, options?)` | Convert and save to the user's downloads |
| `readShapefileFile(file, options?)` | Read a zip from a `File`/`Blob` |
| `triggerDownload(data, fileName, mimeType?)` | Save arbitrary bytes |

### Write options

| Option | Default | Meaning |
| --- | --- | --- |
| `shapeType` | inferred | Force `point`, `multipoint`, `polyline` or `polygon` |
| `dimensions` | `auto` | `xy`, `xym`, `xyz` or `xyzm`. `auto` follows the coordinates |
| `maxFieldLength` | `254` | Cap on `.dbf` character column width |
| `epsg` | — | EPSG code for the `.prj` |
| `wkt` | — | Raw ESRI WKT for the `.prj`; beats `epsg` |
| `fileName` | `shapefile` | Base name inside the archive (zip only) |
| `level` | `6` | DEFLATE level, 0–9 (zip only) |

### Read options

| Option | Default | Meaning |
| --- | --- | --- |
| `encoding` | from `.cpg`, else UTF-8 | `.dbf` character set, e.g. `cp1252` |
| `includeM` | `false` | Emit shapefile M values as a trailing ordinate |

## Projections

Four common codes are compiled in: **4326** (WGS 84), **4269** (NAD83), **6318**
(NAD83 2011) and **3857** (Web Mercator).

Beyond those, a bundled table of **116 definitions** — US UTM zones, NAD83 State
Plane, and the usual global ones — is imported automatically the first time you
name a code that is not already loaded. You do not have to do anything; bundlers
keep it out of the initial chunk.

```ts
// Just works. The table loads on demand.
await writeShapefileZip(data, { epsg: 26915 }); // NAD83 / UTM zone 15N
```

For a local grid or anything without an EPSG code, register it yourself or pass
the WKT directly:

```ts
import { registerProjections } from '@crmackey/shapefile-wasm';

registerProjections({ 900914: 'PROJCS["County Grid", ... ]' });
await writeShapefileZip(data, { epsg: 900914 });

// or, one-off:
await writeShapefileZip(data, { wkt: 'PROJCS["County Grid", ... ]' });
```

An unresolvable EPSG code is an **error**, not a silently omitted `.prj` — data
that looks fine until someone opens it in the wrong coordinate system is a much
worse outcome than a failed export.

The table is baked in at authoring time from [epsg.io](https://epsg.io) by
`pnpm run projections`, and committed. The published package never makes a
network request.

## Multiple layers

A shapefile holds one geometry type, so a storm network or a survey deliverable
is inherently several files. `writeLayersZip` converts a batch and packs it:

```ts
import { writeLayersZip } from '@crmackey/shapefile-wasm';

const zip = await writeLayersZip(
  [
    { name: 'StormManholes', geojson: manholes },  // points
    { name: 'StormPipes', geojson: pipes },        // lines
    { name: 'Basins', geojson: basins },           // polygons
  ],
  { epsg: 26915 },
);
```

`layout` decides how they sit inside the archive:

| Layout | Produces | Use it when |
| --- | --- | --- |
| `flat` *(default)* | `StormPipes.shp`, `Basins.shp`, … | Someone opens the archive in QGIS or ArcGIS |
| `folders` | `StormPipes/StormPipes.shp`, … | Enough layers that a flat list is unpleasant |
| `nested` | `StormPipes.zip`, `Basins.zip`, … | Each layer goes to something wanting one shapefile per archive |

Add `folder: '2026-08-30-storm'` to wrap everything in a top-level directory, in
any layout.

Shared options apply to every layer and a layer can override any of them. Two
layers that sanitise to the same name are an error rather than a silent
overwrite, and a layer that fails to convert names itself in the message.

Use `writeLayers` when you want the per-layer detail — feature counts, field
renames, skipped features — then `zipLayers` to pack it.

[Full guide →](https://calebm1987.github.io/shapefile-wasm/guide/multiple-layers)

## Looking up a projection

For a code outside the bundled table, `fetchProjection` asks epsg.io using the
native `fetch`:

```ts
import { fetchProjection, registerProjections } from '@crmackey/shapefile-wasm';

// Straight into an export.
const wkt = await fetchProjection(2027);
await writeShapefileZip(data, { fileName: 'parcels', wkt });

// Or fetch once, and every later export is offline again.
registerProjections({ 2027: await fetchProjection(2027) });
```

Formats are `'esri-wkt'` (the default, and what a `.prj` wants), `'wkt'` and
`'wkt2'`. Unknown codes, timeouts, aborts, unreachable networks and
proxy-intercepted responses each throw a distinct, named error.

This is the only part of the package that touches the network, and nothing calls
it for you — the bundled table stays the default so an export never depends on a
third-party service.

## Entry points

| Import | Contents |
| --- | --- |
| `@crmackey/shapefile-wasm` | Core API, wasm binary embedded as base64 |
| `@crmackey/shapefile-wasm/slim` | Same API, no embedded binary — call `init(url)` first |
| `@crmackey/shapefile-wasm/browser` | DOM helpers: download, file input |
| `@crmackey/shapefile-wasm/projections` | The raw EPSG table, if you want it eagerly |
| `@crmackey/shapefile-wasm/wasm` | The `.wasm` file itself |

The root entry embeds the binary as base64: zero configuration, at the cost of
roughly a third more bytes and a decode step before compilation. When you can
serve the `.wasm` as its own asset, `/slim` is the better trade — it streams and
compiles in parallel.

```ts
import { init, writeShapefileZip } from '@crmackey/shapefile-wasm/slim';
import wasmUrl from '@crmackey/shapefile-wasm/wasm?url'; // Vite

await init(wasmUrl);
```

## How it maps GeoJSON to a shapefile

A shapefile holds exactly **one** geometry type, so the whole input must agree.

| GeoJSON | Shapefile |
| --- | --- |
| `Point` | `Point` |
| `MultiPoint` | `Multipoint` |
| `LineString`, `MultiLineString` | `Polyline` |
| `Polygon`, `MultiPolygon` | `Polygon` |
| `GeometryCollection` | *not representable — rejected* |

Mixed `Point` and `MultiPoint` input is promoted to `Multipoint`. Any other mix
is an error naming the offending feature index.

**Dimensions** follow the coordinates: a third ordinate becomes Z, a fourth
becomes a measure (`PointZ`, `PolylineZ`, …). Pass `dimensions: 'xym'` to read
the third ordinate as a measure instead, or `'xy'` to drop it.

**Attributes** become `.dbf` columns, typed from the values seen across every
feature — numbers to `numeric`, booleans to `logical`, everything else (and
anything mixed) to `character`. Objects and arrays are JSON-encoded. The `.dbf`
is written as UTF-8 with a matching `.cpg`.

**Features with `null` geometry are skipped** and reported in `skippedCount`;
writing them would desynchronise the `.shp` and `.dbf` record numbering.

## Known limits

- `GeometryCollection` cannot be expressed in a shapefile and is rejected.
- `Multipatch` geometry can be read (triangle strips and fans are expanded into
  a `MultiPolygon`) but not written.
- dBase strips the padding from character columns on read; there is no option to
  keep it, because the underlying reader does not offer one.
- GeoJSON has no concept of M values, so measures are dropped on read unless you
  ask for them with `includeM`.
- A `.dbf` with no columns is rejected by many GIS readers, so input with no
  properties at all gets a synthetic sequential `FID` column.
- Field names are capped at 11 bytes by the format itself. Check
  `parts.fields` to see what was renamed.

## Development

### Prerequisites

- **Rust** 1.85+ (edition 2024, required by `dbase`) with the
  `wasm32-unknown-unknown` target
- **wasm-pack**
- **Node** 18+

```bash
# Rust toolchain and the wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  --target wasm32-unknown-unknown

# wasm-pack
curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

npm install
```

### Build

```bash
pnpm run build
```

Three stages, individually runnable:

| Script | Does |
| --- | --- |
| `pnpm run build:wasm` | `wasm-pack` compiles `rust/` to `pkg/` |
| `pnpm run build:inline` | Embeds the `.wasm` as base64, copies the glue into `src/generated/` |
| `pnpm run build:ts` | `tsc` to `dist/`, then copies the runtime glue across |

Other scripts:

| Script | Does |
| --- | --- |
| `pnpm run typecheck` | Type-check without emitting |
| `pnpm run test` | Rust tests, a build, then the TypeScript suite |
| `pnpm run docs:dev` | Documentation site with hot reload — see [Documentation](#documentation) |
| `pnpm run docs:build` | Build the documentation site into `docs/.vitepress/dist` |
| `pnpm run docs:preview` | Serve what `docs:build` produced |
| `pnpm run docs:api` | Regenerate the TypeScript reference only |
| `pnpm run docs:rust` | Regenerate the Rust reference only |
| `pnpm run projections` | Re-scrape the EPSG table from epsg.io (rarely needed) |
| `pnpm run clean` | Remove `dist/`, `pkg/`, `target/` and generated sources |

### A note on the wasm build

Two things in `Cargo.toml` are load-bearing and easy to undo by accident:

1. **`[package.metadata.wasm-pack.profile.release] wasm-opt`** names its feature
   flags explicitly. The `wasm-opt` that ships with wasm-pack defaults to an
   older feature set than the Rust toolchain emits, and without these the build
   fails validation on bulk-memory operations.
2. **The `time` dependency** is pulled in for `wasm32` with its `wasm-bindgen`
   feature. `dbase` stamps the `.dbf` header with today's date, which reaches
   `SystemTime::now()` — unimplemented on `wasm32-unknown-unknown`, where it
   aborts the whole module. That feature makes `time` read the clock from JS
   instead. Cargo's feature unification applies it to `dbase`'s copy of the
   crate.

## Testing

```bash
pnpm test               # Rust tests, then a build, then the TypeScript suite
```

Individually:

```bash
pnpm run test:rust       # cargo test — conversion rules, schema inference
pnpm run test:ts         # vitest — the wasm boundary, zip layer, public API
pnpm run test:watch      # vitest in watch mode
pnpm run test:coverage   # vitest with a v8 coverage report
```

The TypeScript suites run against `src/`, so no build is needed while iterating.
`test/package.test.ts` is the exception: it imports the built `dist/` to check
that every entry point in `package.json` actually resolves, and skips itself when
`dist/` is absent.

The strongest tests are the **round-trips** in `test/roundtrip.test.ts` — write
the bytes, read them straight back, compare. Without binary fixtures that is the
only real proof that what this package emits is what a reader understands.

| File | Covers |
| --- | --- |
| `test/write.test.ts` | File structure, header fields, schema inference, errors |
| `test/roundtrip.test.ts` | Write-then-read equivalence, ring nesting, winding order, encodings, 2,500 features |
| `test/zip.test.ts` | Archive contents, multi-layer and nested archives |
| `test/layers.test.ts` | Batch conversion, the three layouts, name collisions |
| `test/epsg.test.ts` | The epsg.io client, against an injected fetch |
| `test/projections.test.ts` | The registry and `.prj` resolution |
| `test/browser.test.ts` | DOM helpers, under happy-dom |
| `test/wasm.test.ts` | Init lifecycle, `/slim`, memory handling |
| `test/package.test.ts` | The built package and its entry points |

## Documentation

The documentation site brings the guide, the TypeScript API reference and the
Rust API reference together into one searchable [VitePress](https://vitepress.dev)
site.

### Running it

```bash
pnpm run docs:dev       # live site with hot reload at http://localhost:5173
pnpm run docs:build     # static site into docs/.vitepress/dist
pnpm run docs:preview   # serve what docs:build produced
```

`docs:dev` and `docs:build` regenerate both API references first, so a single
command is enough — there is no separate step to remember.

> [!NOTE]
> The Rust reference needs the Rust toolchain installed. Everything else builds
> with Node alone — `pnpm run docs:api && npx vitepress dev docs` skips it.

### llms.txt

The site publishes [`/llms.txt`](https://calebm1987.github.io/shapefile-wasm/llms.txt)
and [`/llms-full.txt`](https://calebm1987.github.io/shapefile-wasm/llms-full.txt)
following the [llmstxt.org](https://llmstxt.org) convention, so AI tooling can
pick up the API surface and — more importantly — the format constraints that
decide whether generated code is actually correct.

`llms.txt` is hand-written at the repository root and **also ships in the npm
tarball**, so tools that read `node_modules` find it without a network request.
`llms-full.txt` is the whole guide concatenated, generated at build time. A guide
page not listed in the build script's reading order fails the build rather than
being silently dropped.

### What it is assembled from

| Part | Comes from | Script |
| --- | --- | --- |
| Guide | Hand-written markdown in `docs/guide/` | — |
| TypeScript reference | TypeDoc, from the TSDoc comments in `src/` | `pnpm run docs:api` |
| Rust reference | `cargo doc`, from the `///` comments in `rust/` | `pnpm run docs:rust` |
| llms.txt | Hand-written `llms.txt`, plus the guide concatenated | `pnpm run docs:llms` |

TypeDoc emits **markdown** rather than HTML, so the TypeScript reference renders
as ordinary VitePress pages — themed like the guide and covered by the site's
local search. `cargo doc` and the demo are each their own static site, copied
into the build afterwards and embedded by a real VitePress page (`/rust` and
`/demo`) so the router resolves them like anything else.

The same comments are what your editor shows on hover.

### Guide contents

| Page | Covers |
| --- | --- |
| What it is | The format's sharp edges and which ones this handles |
| Getting started | Install, first conversion, reading it back |
| Entry points | Root vs `/slim` vs `/browser`, and when to use which |
| Writing shapefiles | Input shapes, dimensions, schema inference, errors |
| Reading shapefiles | Archives, encodings, ring re-nesting, measures |
| Projections | EPSG codes, custom WKT, why unknown codes throw |
| In the browser | Downloads, file pickers, workers, CSP, framework notes |
| Format mapping | Every GeoJSON ↔ shapefile correspondence, in tables |
| Known limits | Format limits, package limits, deliberate choices |
| Troubleshooting | Error messages and what to do about them |
| Development | Prerequisites, scripts, the load-bearing Cargo.toml bits |
| Testing | What is covered and how to add to it |
| Architecture | Why the code is shaped the way it is |
| Changelog | Release history |

### Where the output goes

`docs/reference/` (TypeDoc) and `docs/public/rust/` (rustdoc, dev only) are
generated and gitignored. `docs/guide/`, `docs/index.md` and
`docs/.vitepress/config.ts` are hand-written and tracked.

## Contributing

See [AGENTS.md](./AGENTS.md) for the working agreements — format invariants that
must not be broken, comment and docstring expectations, and the checks CI runs.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
enforced by a git hook that `npm install` sets up:

```
feat: add multi-layer archives
fix(read): attach holes to the containing ring
feat!: drop the trimStrings option
```

Releases are automated. [release-please](https://github.com/googleapis/release-please)
reads those commits, opens a release PR that bumps `package.json`, `Cargo.toml`
and `CHANGELOG.md`, and on merge tags a GitHub Release — which triggers the npm
publish. Never hand-edit a version or the changelog.

## Continuous integration

Four workflows in `.github/workflows/`:

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | Push to `main`, every PR | Conventional PR title, `cargo test`, `fmt --check`, `clippy -D warnings`, build, `tsc --noEmit`, version consistency, `vitest`, `ppnpm pack --dry-run`, `npm audit`, `cargo audit` |
| `release-please.yml` | Push to `main` | Maintains the release PR; tags a GitHub Release when it merges |
| `docs.yml` | Push to `main` | Builds the documentation site and deploys it to GitHub Pages |
| `publish.yml` | A published GitHub release | Re-runs the tests, checks the tag matches, publishes to npm with provenance |

Every action is pinned to a commit SHA rather than a tag, and each workflow
declares least-privilege `permissions`. See [SECURITY.md](./SECURITY.md).

### Setting up GitHub Pages

Once, in the repository settings: **Settings → Pages → Build and deployment →
Source → GitHub Actions**. The workflow does the rest on the next push to `main`.

A project site is served from `https://<user>.github.io/<repo>/`, so the site
needs that path as its `base` or every asset 404s. The workflow reads it from
`actions/configure-pages` rather than hardcoding it, so renaming the repository
or moving to a custom domain does not quietly break the CSS.

Locally the base stays `/`. To preview exactly what Pages will serve:

```bash
DOCS_BASE=/shapefile-wasm/ pnpm run docs:build
pnpm run docs:preview
```

### Publishing a release

Publishing uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers),
so there is **no npm token in CI** — npm mints a short-lived credential from the
workflow's OIDC identity. A stolen or phished token is how most recent npm
supply-chain compromises started; this removes that target entirely.

One-time setup, after the first release exists on npm:

1. On npmjs.com, open the package → **Settings → Trusted Publishers**
2. Add a GitHub Actions publisher: this repository, workflow `publish.yml`,
   environment `npm-publish`
3. In GitHub, create the `npm-publish` environment and add yourself as a required
   reviewer, so nothing reaches npm without an approval

Day to day you do nothing: merge the release PR that release-please opens, and
the tagged Release triggers the publish.

## Project layout

```
AGENTS.md             contributor guide: invariants, conventions, checks
llms.txt              API surface and format constraints, for AI tooling
SECURITY.md           security policy and supply-chain posture
.githooks/            conventional-commit hook (no dependencies)

rust/                 Rust core, compiled to WebAssembly
  lib.rs              wasm-bindgen entry points, the write pipeline
  read.rs             shapefile -> GeoJSON, ring nesting, encodings
  input.rs            GeoJSON parsing and geometry-type resolution
  schema.rs           .dbf schema inference, field naming
  geometry.rs         GeoJSON -> concrete shapefile shape types
  error.rs            error types

src/                  TypeScript layer
  index.ts            main entry, registers the inlined wasm loader
  slim.ts             same API, no embedded binary
  api.ts              the surface shared by both entry points
  write.ts            writeShapefile, writeShapefileZip, zipParts
  read.ts             readShapefile, readShapefileZip
  layers.ts           multi-layer archives and their layouts
  epsg.ts             optional epsg.io lookup
  projections.ts      EPSG registry and lazy table loading
  browser.ts          DOM-only helpers
  types.ts            public types
  generated/          build output — see .gitignore for what is and isn't tracked

.github/workflows/    CI, docs deployment, npm publish
scripts/              build helpers
test/                 vitest suites

docs/                 documentation site (VitePress)
  index.md            landing page
  guide/              hand-written guide
  reference/          generated by TypeDoc (not tracked)
  .vitepress/         site config
```

## How it works

```
GeoJSON ──► serde_json ──► geometry + schema resolution ──► shapefile / dbase crates
                                                                      │
                                                            .shp .shx .dbf bytes
                                                                      │
                                                    TypeScript: .cpg, .prj, zip
```

The Rust core deliberately does **not** know about zip files, projections or
browsers. It converts between GeoJSON and shapefile bytes, and nothing else —
which keeps the binary small and leaves the core usable from plain Rust.

Everything above that line is TypeScript: `fflate` for zipping, a projection
registry for the `.prj`, and an optional DOM layer for downloads.

Roughly 357 KB of WebAssembly, about 139 KB gzipped.

## License

MIT
