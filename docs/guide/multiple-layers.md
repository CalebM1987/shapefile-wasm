# Multiple layers in one archive

A shapefile holds exactly one geometry type, so a dataset that mixes points,
lines and polygons — a storm network, a parcel package, a survey deliverable —
is inherently several files.
[`writeLayersZip`](/reference/index/functions/writeLayersZip) converts a batch in
one call and packs the results.

```ts
import { writeLayersZip } from '@crmackey/shapefile-wasm';

const zip = await writeLayersZip(
  [
    { name: 'StormManholes', geojson: manholes },
    { name: 'StormPipes', geojson: pipes },
    { name: 'Basins', geojson: basins },
  ],
  { epsg: 26915 },
);
```

Each layer needs a `name` and a `geojson`. `geojson` accepts everything
`writeShapefile` does — a `FeatureCollection`, a lone `Feature`, a bare geometry,
an array, or a JSON string.

## Choosing a layout

The `layout` option decides how the layers sit inside the archive. Which one you
want depends entirely on what is going to open the file.

::: code-group
```text [flat (default)]
export.zip
├── StormManholes.shp
├── StormManholes.shx
├── StormManholes.dbf
├── StormManholes.cpg
├── StormManholes.prj
├── StormPipes.shp
├── StormPipes.shx
├── ...
└── Basins.prj
```
```text [folders]
export.zip
├── StormManholes/
│   ├── StormManholes.shp
│   ├── StormManholes.shx
│   ├── StormManholes.dbf
│   ├── StormManholes.cpg
│   └── StormManholes.prj
├── StormPipes/
│   └── ...
└── Basins/
    └── ...
```
```text [nested]
export.zip
├── StormManholes.zip
├── StormPipes.zip
└── Basins.zip
```
:::

| Layout | Use it when |
| --- | --- |
| `flat` | Someone will open the archive in QGIS or ArcGIS. The default, and the most widely understood. |
| `folders` | There are enough layers that a flat list is unpleasant to read, but you still want one archive. |
| `nested` | Each layer has to be handed to something that expects an archive containing exactly one shapefile — which a lot of web GIS uploaders do. |

```ts
await writeLayersZip(layers, { layout: 'nested' });
```

Every inner archive in `nested` is complete and standalone: `.shp`, `.shx`,
`.dbf`, `.cpg` and its own `.prj`. You can hand one straight to an uploader, or
read it back with `readShapefileZip` on its own.

## A top-level folder

`folder` wraps everything, in any layout — useful for a dated or job-numbered
export:

```ts
await writeLayersZip(layers, { folder: '2026-08-30-storm', layout: 'folders' });
// 2026-08-30-storm/StormPipes/StormPipes.shp
```

## Shared and per-layer options

Options given at the top level apply to every layer; a layer can override any of
them. Set the projection once, and let one layer opt out:

```ts
await writeLayersZip(
  [
    { name: 'Parcels', geojson: parcels },
    { name: 'Aerials', geojson: aerials, epsg: 3857 }, // this one differs
  ],
  { epsg: 26915, maxFieldLength: 80 },
);
```

Anything [`writeShapefile`](/guide/writing) accepts works in both places:
`shapeType`, `dimensions`, `maxFieldLength`, `epsg` and `wkt`.

## Names

Layer names are sanitised exactly like `fileName` — directory parts and
extensions stripped, and characters Windows reserves replaced.

Two layers that resolve to the same name are an **error**, not a silent
overwrite:

```ts
await writeLayersZip([
  { name: 'storm pipes', geojson: a },
  { name: 'storm:pipes', geojson: b },
]);
// Error: layers "storm pipes" and "storm:pipes" both resolve to "storm_pipes"
// inside the archive. Give them distinct names.
```

Both a space and a colon become an underscore, so those collide even though they
were written differently. In a flat archive the second would quietly replace the
first, and you would ship an archive missing a layer without knowing.

## Errors name the layer

A failure in a batch of twenty is useless if it does not say which one:

```ts
// Error: layer "StormPipes" could not be written. a shapefile holds a single
// geometry type, but the input mixes Polyline and Polygon (feature 3); ...
```

The original error is kept on `cause`.

The whole batch fails — no partial archive is produced. An archive that is
missing a layer but looks complete is worse than an export that stops and tells
you.

## Inspecting before you ship

[`writeLayers`](/reference/index/functions/writeLayers) does the conversion
without packing, so you can look at what came out:

```ts
import { writeLayers, zipLayers } from '@crmackey/shapefile-wasm';

const written = await writeLayers(layers, { epsg: 26915 });

for (const layer of written) {
  console.log(layer.name, layer.parts.shapeType, layer.parts.featureCount);

  if (layer.parts.skippedCount > 0) {
    console.warn(`${layer.name}: ${layer.parts.skippedCount} features had no geometry`);
  }

  for (const field of layer.parts.fields) {
    if (field.source !== field.name) {
      console.warn(`${layer.name}: "${field.source}" written as "${field.name}"`);
    }
  }
}

const zip = zipLayers(written, { layout: 'folders' });
```

`name` is the sanitised name used in the archive; `source` is what you passed in.

## Re-packing what you read

A layer from `readShapefileZip` already has `name`, `geojson` and `prj`, so it
can go straight back in:

```ts
const layers = await readShapefileZip(incoming);

// Same data, different arrangement.
const repacked = await writeLayersZip(layers, { layout: 'nested' });
```

`prj` is accepted as an alias for `wkt` precisely so this works without renaming
a field.
