# Troubleshooting

## "a shapefile holds a single geometry type"

Your input mixes types a shapefile cannot store together. The message names the
offending feature index.

Split by type:

```ts
const byType = new Map<string, Feature[]>();
for (const feature of collection.features) {
  const key = feature.geometry?.type ?? 'null';
  byType.set(key, [...(byType.get(key) ?? []), feature]);
}

for (const [type, features] of byType) {
  await writeShapefileZip({ type: 'FeatureCollection', features }, {
    fileName: `export-${type.toLowerCase()}`,
  });
}
```

`Point` + `MultiPoint` is the one mix that is allowed — it is promoted to
`Multipoint` rather than failing.

## "the input contains no writable features"

The collection was empty, or every feature had `geometry: null`. Check
`skippedCount` on a successful call to see how many were dropped.

## "EPSG:… is not in the projection table"

The code is not in the 116-entry bundled table. Register it:

```ts
registerProjections({ 2027: 'PROJCS["…"]' });
```

Grab the WKT from `https://epsg.io/<code>.esriwkt`, or pass it inline with
`{ wkt }`.

## Attributes are truncated

dBase columns are fixed-width. Widths are measured from your data, so truncation
means either the 254-byte character ceiling, or a `maxFieldLength` you set.

Check what was allocated:

```ts
parts.fields.filter((f) => f.width === 254);
```

## Field names look wrong

dBase caps names at 11 bytes. `parts.fields` reports every rename:

```ts
parts.fields.filter((f) => f.source !== f.name);
```

Rename properties before export if the truncated names are unclear.

## Text comes back as mojibake

The `.dbf` was written in a legacy code page and the `.cpg` is missing or wrong.
Force it:

```ts
await readShapefileZip(bytes, { encoding: 'cp1252' });
```

`cp1252` covers most Western-European files from older ArcGIS versions; `cp437`
and `cp850` show up in genuinely old data.

## Polygons render inside out

Ring winding is corrected automatically in both directions. If something still
looks wrong, check whether the source rings were tagged correctly as outer or
inner — some writers get this wrong, and a hole with no containing exterior is
attached to the first ring as a fallback.

## "RuntimeError: unreachable"

A panic inside WebAssembly. Turn on the panic hook for a real message:

```ts
import { load } from '@crmackey/shapefile-wasm';
// (development only)
```

Or from the generated bindings directly:

```ts
import initWasm, { setPanicHook } from '@crmackey/shapefile-wasm/pkg/shapefile_wasm.js';
await initWasm();
setPanicHook();
```

Then re-run. The message and a Rust stack go to `console.error`. Please
[open an issue](https://github.com/crmackey/shapefile-wasm/issues) with it — a
panic is a bug, not a supported failure mode.

## Out of memory on a large dataset

Everything is held in memory, and WebAssembly's heap is smaller than Node's.
Split the work:

```ts
const CHUNK = 50_000;
for (let i = 0; i < features.length; i += CHUNK) {
  const part = features.slice(i, i + CHUNK);
  await writeShapefileZip({ type: 'FeatureCollection', features: part }, {
    fileName: `export-${i / CHUNK}`,
  });
}
```

## The build fails on bulk-memory operations

You are building from source with a `wasm-opt` older than the features the Rust
toolchain emits. The flags in `Cargo.toml` under
`[package.metadata.wasm-pack.profile.release]` exist for this — see
[Development](/guide/development).

## "time not implemented on this platform"

`dbase` stamps the `.dbf` header with the current date, which reaches
`SystemTime::now()` — unimplemented on `wasm32-unknown-unknown`. The `time`
dependency with its `wasm-bindgen` feature fixes it; see
[Development](/guide/development). If you see this, that dependency has been
dropped from `Cargo.toml`.

## CSP blocks the module

WebAssembly compilation needs `'wasm-unsafe-eval'` in `script-src`. It is a
narrower permission than `'unsafe-eval'` and does not enable JavaScript `eval`.
