# Getting started

## Install

::: code-group
```bash [npm]
npm install @crmackey/shapefile-wasm
```
```bash [pnpm]
pnpm add @crmackey/shapefile-wasm
```
```bash [yarn]
yarn add @crmackey/shapefile-wasm
```
:::

Requires Node 18+ or any browser with WebAssembly.

The `.wasm` binary ships embedded in the package, so there is nothing to copy,
serve, or configure in your bundler. If you would rather stream it as a separate
asset, see [Entry points](/guide/entry-points).

## Your first conversion

```ts
import { writeShapefileZip } from '@crmackey/shapefile-wasm';

const featureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-93.265, 44.9778] },
      properties: { name: 'Minneapolis', pop: 429954, county_seat: true },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-93.09, 44.9537] },
      properties: { name: 'Saint Paul', pop: 311527, county_seat: true },
    },
  ],
};

const zip = await writeShapefileZip(featureCollection, {
  fileName: 'cities',
  epsg: 4326,
});
```

`zip` is a `Uint8Array` holding `cities.shp`, `cities.shx`, `cities.dbf`,
`cities.cpg` and `cities.prj`. Write it to disk, upload it, or hand it to the
browser.

::: tip No init required
Every function instantiates the WebAssembly module on first use. Call
[`init()`](/reference/index/functions/init) only if you want to control *when*
that roughly 50 ms cost is paid.
:::

## And back again

```ts
import { readShapefileZip } from '@crmackey/shapefile-wasm';

const layers = await readShapefileZip(zip);

layers[0].name;                          // "cities"
layers[0].geojson.features.length;       // 2
layers[0].geojson.features[0].properties; // { name: "Minneapolis", ... }
layers[0].prj;                           // the WKT that was written
```

An archive can hold several layers, including in nested folders, so the result is
always a list.

## Working with the raw parts

When you need the individual files rather than an archive:

```ts
import { writeShapefile } from '@crmackey/shapefile-wasm';

const parts = await writeShapefile(featureCollection, { epsg: 4326 });

await writeFile('cities.shp', parts.shp);
await writeFile('cities.shx', parts.shx);
await writeFile('cities.dbf', parts.dbf);
await writeFile('cities.cpg', parts.cpg);
await writeFile('cities.prj', parts.prj!);
```

The result also reports what was inferred:

```ts
parts.shapeType;    // "Point"
parts.dimensions;   // "xy"
parts.featureCount; // 2
parts.skippedCount; // 0
parts.bbox;         // [minX, minY, maxX, maxY]
parts.fields;       // how each property became a .dbf column
```

## Check for renamed fields

dBase caps column names at 11 bytes. It is worth surfacing what changed:

```ts
for (const field of parts.fields) {
  if (field.source !== field.name) {
    console.warn(`"${field.source}" was written as "${field.name}"`);
  }
}
```

## Next

- [Writing shapefiles](/guide/writing) — options, schema inference, errors
- [Reading shapefiles](/guide/reading) — encodings, archives, geometry
- [Projections](/guide/projections) — EPSG codes and custom WKT
