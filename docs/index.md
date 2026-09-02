---
layout: home

hero:
  name: shapefile-wasm
  text: ESRI Shapefiles, in the browser
  tagline: Read and write shapefiles from GeoJSON — no server round-trip, no GDAL. A Rust core compiled to WebAssembly, with a small typed API in front of it.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Live demo
      link: /demo
    - theme: alt
      text: API reference
      link: /reference/
    - theme: alt
      text: View on GitHub
      link: https://github.com/CalebM1987/shapefile-wasm

features:
  - title: Both directions
    details: GeoJSON to .shp/.shx/.dbf/.cpg/.prj, and all the way back again — including the ring re-nesting a shapefile's flat ring list makes necessary.
  - title: Runs anywhere
    details: Browser, Node, and workers from one import. DOM helpers live behind a separate entry point, so the core is safe in SSR.
  - title: Correct by construction
    details: dBase column widths are measured from your data rather than guessed, so long values are never silently cropped into different numbers.
  - title: Projections included
    details: 116 EPSG definitions — US UTM zones, NAD83 State Plane, the global basics — loaded on demand. No network call at runtime, ever.
  - title: Zero configuration
    details: The WebAssembly binary ships embedded. Nothing to copy, serve, or teach your bundler about. A slim entry point is there when you want to stream it.
  - title: Typed and documented
    details: Full TypeScript types with TSDoc on every public function, so your editor explains the format's sharp edges as you use it.
---

## Try it

```ts
import { writeShapefileZip, readShapefileZip } from '@crmackey/shapefile-wasm';

const zip = await writeShapefileZip(
  {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-93.265, 44.9778] },
        properties: { name: 'Minneapolis', pop: 429954 },
      },
    ],
  },
  { fileName: 'cities', epsg: 26915 },
);

const [layer] = await readShapefileZip(zip);
layer.geojson.features[0].properties.name; // "Minneapolis"
```

## Why this exists

A shapefile is not one file. It is a `.shp` of geometry, a `.shx` index, a `.dbf`
attribute table in a 1980s database format, and a `.prj` of projection text —
all of which have to agree with each other. Getting that wrong produces files
that open fine in one GIS and misbehave in another, usually without saying so.

This package leans on two well-tested Rust crates,
[`shapefile`](https://crates.io/crates/shapefile) and
[`dbase`](https://crates.io/crates/dbase), and handles the parts that are easy
to get subtly wrong. [Read more →](/guide/)
