# Architecture

## The split

```
GeoJSON ──► serde_json ──► geometry + schema resolution ──► shapefile / dbase crates
                                                                      │
                                                            .shp .shx .dbf bytes
                                                                      │
                                                    TypeScript: .cpg, .prj, zip
```

The Rust core deliberately knows nothing about zip files, projections or
browsers. It converts between GeoJSON and shapefile bytes and stops there.

That keeps the WebAssembly binary small, and leaves the core usable as a plain
Rust crate. Everything above the line is ordinary TypeScript: `fflate` for
zipping, a projection registry for the `.prj`, and an optional DOM layer.

## Layout

```
rust/                 Rust core, compiled to WebAssembly
  lib.rs              wasm-bindgen entry points, the write pipeline
  read.rs             shapefile -> GeoJSON, ring nesting, encodings
  input.rs            GeoJSON parsing, geometry-type resolution
  schema.rs           .dbf schema inference, field naming
  geometry.rs         GeoJSON -> concrete shapefile shape types
  error.rs            error types

src/                  TypeScript layer
  index.ts            main entry; registers the inlined wasm loader
  slim.ts             same API, no embedded binary
  api.ts              the surface both entry points share
  write.ts            writeShapefile, writeShapefileZip, zipParts
  read.ts             readShapefile, readShapefileZip
  projections.ts      EPSG registry, lazy table loading
  browser.ts          DOM-only helpers
  types.ts            public types
  generated/          build output

scripts/              build helpers
test/                 vitest suites
docs/                 this site
```

## Why the generics in geometry.rs

The `shapefile` crate has no single "geometry" type. Each dimensionality is a
separate Rust type — `Polyline`, `PolylineM`, `PolylineZ` — so the conversion is
generic over the point type and `lib.rs` picks the concrete one:

```rust
match (family, dimension) {
    (Family::Polyline, Dimension::Xy)  => emit!(to_polyline, Point),
    (Family::Polyline, Dimension::Xym) => emit!(to_polyline, PointM),
    (Family::Polyline, Dimension::Xyz | Dimension::Xyzm) => emit!(to_polyline, PointZ),
    // …
}
```

The `match` is exhaustive, so adding a `Dimension` variant produces a compile
error at every site that has to handle it.

## Why the schema needs a whole pass

`dbase` crops any value that overruns its column, silently. Deciding column
widths therefore requires seeing every value first — which is why
`Schema::infer` walks all features before a single byte is written.

For numeric columns it goes further: it renders each value at a candidate
precision and measures the result, dropping precision if the widest value would
not fit, and falling back to text if it still cannot.

## Why reading rebuilds nesting

A shapefile polygon is a flat list of rings tagged only outer or inner. GeoJSON
needs the nesting back.

Pairing rings in order is the obvious approach and it is wrong the moment an
archive lists them differently. Instead each hole is tested against every
exterior with a ray-casting point-in-polygon check, and assigned to the
**smallest** ring that contains it — which also gets nested polygons right.

## Why the wasm binary is inlined

The root entry embeds the binary as base64 so the package works with no bundler
configuration in any environment. That costs about a third more bytes and a
decode step.

`/slim` exists for the other trade: serve the `.wasm` yourself, and the browser
streams and compiles it in parallel. The blob is behind a dynamic import, so
`/slim` consumers never download it.

## Why the projection table is scraped at authoring time

`scripts/fetch-projections.mjs` reads epsg.io and writes a committed TypeScript
file. It is not part of the build.

A runtime lookup can fail quietly and produce an export with no projection at
all — data that looks correct until someone opens it in the wrong coordinate
system. Builds should also not depend on a free service staying reachable.

The table is a dynamic import loaded on a cache miss, so the 60 KB is only paid
by projects that use a code outside the four built-ins.

## Error handling

Rust errors are a `thiserror` enum carrying the feature index where one applies,
converted to a JavaScript `Error` at the boundary. There are no error codes —
messages are meant to be read, and they name what to do about the problem.

`panic = "abort"` keeps the binary small, so a panic is an opaque
`RuntimeError: unreachable`. Every known panic path in the underlying crates —
short polyline parts, empty ring lists — is guarded ahead of time and returned as
a proper error instead. A panic that escapes is a bug.
