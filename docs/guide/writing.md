# Writing shapefiles

Two functions cover almost everything:
[`writeShapefile`](/reference/index/functions/writeShapefile) returns the raw
components, and [`writeShapefileZip`](/reference/index/functions/writeShapefileZip)
wraps them into one archive.

## Accepted input

Both take any of these:

```ts
await writeShapefile(featureCollection);          // a FeatureCollection
await writeShapefile(feature);                    // one Feature
await writeShapefile(feature.geometry);           // a bare geometry
await writeShapefile([featureA, featureB]);       // an array of either
await writeShapefile(JSON.stringify(collection)); // a GeoJSON string
```

::: tip Passing a string is cheaper
A string is parsed in Rust, which skips a `JSON.parse` in JavaScript. Worth it
when the data arrived as text over the network anyway.
:::

## One file, one geometry type

A shapefile holds exactly one geometry type. Mixed input is rejected with an
error naming the offending feature index:

```
a shapefile holds a single geometry type, but the input mixes Polyline and
Polygon (feature 3); split the input or pass an explicit `shapeType`
```

The one exception is `Point` and `MultiPoint`, which are promoted to a single
`Multipoint` file — they are compatible, so there is no reason to fail.

To force a family regardless of what the data looks like:

```ts
await writeShapefile(points, { shapeType: 'multipoint' });
```

See [Format mapping](/guide/format-mapping) for the full table.

## Dimensions

By default the ordinates decide:

| Coordinates look like | Written as |
| --- | --- |
| `[x, y]` | `Point`, `Polyline`, `Polygon`, `Multipoint` |
| `[x, y, z]` | the `Z` variants |
| `[x, y, z, m]` | the `Z` variants, with measures |

The richest coordinate in the whole set wins, so one 3D vertex promotes the file.

Override when the third ordinate is really a measure rather than an elevation:

```ts
await writeShapefile(data, { dimensions: 'xym' }); // 3rd ordinate is M
await writeShapefile(data, { dimensions: 'xy' });  // drop Z entirely
```

## How attributes become .dbf columns

Every feature's properties are scanned, and each property becomes one column.

| Values seen | Column type |
| --- | --- |
| Only numbers | `numeric` |
| Only booleans | `logical` |
| Only strings | `character` |
| Objects or arrays | `character`, JSON-encoded |
| More than one of the above | `character` |
| Only `null` | `character`, width 1 |

Column order follows first appearance, not alphabetical order.

### Widths are measured, not guessed

`dbase` silently crops anything that overruns its column, so widths come from the
data. A `numeric` column takes the most decimal places any value needed, then the
width required to print the widest value at that precision.

```ts
const { fields } = await writeShapefile({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { big: -123456789.125 },
});

fields[0]; // { type: 'numeric', decimals: 3, width: 14, ... }
```

Cap character columns if file size matters more than long text:

```ts
await writeShapefile(data, { maxFieldLength: 50 });
```

### Names are truncated and de-duplicated

dBase caps names at 11 bytes and expects them to start with a letter. Names are
sanitised, truncated, and given a numeric suffix when two collide:

| Property | Column |
| --- | --- |
| `population` | `population` |
| `population_density` | `populatio_2` |
| `2020_pop` | `F2020_pop` |

The mapping is returned so you can surface it:

```ts
parts.fields.map((f) => [f.source, f.name]);
```

### Missing properties become nulls

`dbase` treats a record that omits a declared field as an error. Ragged input is
padded automatically, so this is fine:

```ts
await writeShapefile([
  { type: 'Feature', geometry: pointA, properties: { a: 1 } },
  { type: 'Feature', geometry: pointB, properties: { b: 'two' } },
]);
// Two columns; each row gets a null for the one it lacks.
```

### Input with no properties at all

A `.dbf` with zero columns is rejected by many GIS readers, so a sequential `FID`
column is added rather than writing something unreadable.

## Features with no geometry

They are skipped, and counted:

```ts
const parts = await writeShapefile(collection);
if (parts.skippedCount > 0) {
  console.warn(`${parts.skippedCount} features had no geometry and were dropped`);
}
```

Writing an attribute row with no shape would desynchronise the `.shp` and `.dbf`
record numbering — a corruption that shows up much later, in someone else's tool.

## Building the archive yourself

When you want the parts *and* an archive without converting twice:

```ts
import { writeShapefile, zipParts } from '@crmackey/shapefile-wasm';

const parts = await writeShapefile(data, { epsg: 4326 });
await uploadForPreview(parts.shp);

const zip = zipParts(parts, { fileName: 'parcels', level: 9 });
```

## Errors

Every failure is an `Error` with a message that names the cause, and the feature
index where one applies:

| Message contains | Cause |
| --- | --- |
| `single geometry type` | Incompatible geometry types in one input |
| `no writable features` | Empty collection, or every feature lacked geometry |
| `at least 2 coordinates` | A line with fewer than two vertices |
| `at least 3 coordinates` | A polygon ring with fewer than three vertices |
| `GeometryCollection` | Not representable in a shapefile |
| `not a number` | A malformed coordinate |
| `not in the projection table` | An EPSG code that could not be resolved |
