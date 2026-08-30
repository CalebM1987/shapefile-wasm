# Reading shapefiles

[`readShapefileZip`](/reference/index/functions/readShapefileZip) takes an
archive; [`readShapefile`](/reference/index/functions/readShapefile) takes loose
components.

## From an archive

```ts
import { readShapefileZip } from '@crmackey/shapefile-wasm';

const layers = await readShapefileZip(zipBytes);

for (const layer of layers) {
  console.log(layer.name);                     // base name, no extension
  console.log(layer.geojson.features.length);
  console.log(layer.prj);                      // WKT, if the archive had one
  console.log(layer.encoding);                 // how the .dbf was decoded
}
```

Archives in the wild are messy, so the reader is deliberately tolerant:

- **Several layers per archive** — each is returned separately, sorted by name.
- **Nested folders** — components are grouped by full path, so `a/roads.shp` and
  `b/roads.shp` stay distinct layers.
- **macOS pollution** — `__MACOSX/` resource forks and `.DS_Store` are ignored.
- **Orphans** — a `.dbf` with no `.shp` beside it is not treated as a layer.
- **Missing `.dbf`** — the layer still reads, with empty properties.

An archive with no `.shp` at all throws.

## From loose components

```ts
import { readShapefile } from '@crmackey/shapefile-wasm';

const geojson = await readShapefile({
  shp: await readFile('roads.shp'),
  dbf: await readFile('roads.dbf'),   // optional
  cpg: await readFile('roads.cpg', 'utf8'), // optional
  prj: await readFile('roads.prj', 'utf8'), // optional
});
```

::: tip The .shx is not needed
It is only a fixed-width index into the `.shp`, which this reader walks
sequentially. It is still written on export, because other software expects it.
:::

Without a `.dbf`, every feature comes back with `properties: {}` — still useful
for inspecting geometry.

## Geometry comes back idiomatic

Single-part geometries are returned as the simple GeoJSON type rather than a
one-element collection:

| Shapefile | GeoJSON |
| --- | --- |
| `Polyline`, one part | `LineString` |
| `Polyline`, several parts | `MultiLineString` |
| `Polygon`, one exterior | `Polygon` |
| `Polygon`, several exteriors | `MultiPolygon` |

### Polygon holes are re-nested

This is the part that is easy to get wrong. A shapefile stores every ring in one
flat list, tagged only outer or inner — the nesting is gone. Rebuilding it by
pairing rings in order works right up until an archive lists them differently.

Instead, each hole is tested against the exterior rings and assigned to the
**smallest** one that contains it. Two adjacent donuts keep their own holes, and
a polygon nested inside another gets the right parent.

Rings are then rewound to RFC 7946 order: exteriors counter-clockwise, holes
clockwise. Shapefiles use the opposite convention.

## Text encoding

A `.dbf` carries no encoding of its own. The companion `.cpg` usually names one,
but it is often missing, and its spelling is not standardised.

Resolution order:

1. An explicit `options.encoding`
2. The `.cpg` contents
3. UTF-8

Legacy single-byte code pages are supported — `cp1252`/`windows-1252`/`latin1`,
`cp437`, `cp850`, `cp852`, `cp865`, `cp866`, `cp874`, and the `cp125x` family.
Labels are matched generously (`UTF-8`, `utf8`, `65001` all work), and an
unrecognised label falls back to UTF-8 rather than failing the read.

```ts
// Force it when you know the .cpg is wrong or missing.
const layers = await readShapefileZip(bytes, { encoding: 'cp1252' });
```

::: warning Text is always trimmed
dBase pads character columns out to their full width. The underlying reader
strips that padding and offers no way to keep it, so values always come back
trimmed.
:::

## Measures

GeoJSON has no concept of M values, so they are dropped by default. Ask for them
and they arrive as a trailing ordinate:

```ts
const geojson = await readShapefile({ shp, dbf }, { includeM: true });
// coordinates: [x, y, z, m]
```

## The projection

GeoJSON is defined as WGS 84 and has nowhere to record anything else. When a
`.prj` is present its text is carried on a non-standard `wkt` member rather than
being discarded:

```ts
layers[0].geojson.wkt; // 'PROJCS["NAD_1983_UTM_Zone_15N", ... ]'
```

Coordinates are **not** reprojected — they come back exactly as stored. Use
[proj4js](https://github.com/proj4js/proj4js) with that WKT if you need WGS 84.

## Null geometry

A shapefile can store a null shape. Those features come back with
`geometry: null`, matching GeoJSON.
