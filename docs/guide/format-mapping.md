# Format mapping

How GeoJSON concepts land in the shapefile format, and back.

## Geometry types

| GeoJSON | Shapefile | Notes |
| --- | --- | --- |
| `Point` | `Point` | |
| `MultiPoint` | `Multipoint` | |
| `LineString` | `Polyline` | One part |
| `MultiLineString` | `Polyline` | Several parts |
| `Polygon` | `Polygon` | Exterior ring plus holes |
| `MultiPolygon` | `Polygon` | All rings flattened into one record |
| `GeometryCollection` | — | Not representable; rejected |

Reading back, single-part geometry returns the simple type: a one-part `Polyline`
becomes a `LineString`, not a one-element `MultiLineString`.

## Mixing types

A shapefile holds exactly one geometry type.

| Input | Result |
| --- | --- |
| `Point` + `MultiPoint` | Promoted to `Multipoint` |
| `LineString` + `MultiLineString` | Both are `Polyline` already |
| `Polygon` + `MultiPolygon` | Both are `Polygon` already |
| Anything else mixed | Error naming the feature index |

## Dimensions

| Coordinate | Detected | Shape type |
| --- | --- | --- |
| `[x, y]` | `xy` | `Point`, `Polyline`, … |
| `[x, y, z]` | `xyz` | `PointZ`, `PolylineZ`, … |
| `[x, y, z, m]` | `xyzm` | `PointZ` with measures |

Detection uses the richest coordinate anywhere in the input. Override with
`dimensions`; `'xym'` reads the third ordinate as a measure instead of Z.

Reading back, Z is emitted as a third ordinate. M is dropped unless
`includeM: true`, because GeoJSON has no concept of measures.

## Attribute types

Writing:

| Property values | dBase column |
| --- | --- |
| Numbers only | `numeric`, width and decimals measured from the data |
| Booleans only | `logical` |
| Strings only | `character`, width = longest value |
| Objects or arrays | `character`, JSON-encoded |
| Mixed types | `character` |
| All `null` | `character`, width 1 |
| No properties at all | A synthetic `FID` `numeric` column |

Reading:

| dBase column | JSON value |
| --- | --- |
| `character` | `string`, trimmed; `null` when empty |
| `numeric`, `float`, `double`, `currency` | `number`, or `null` |
| `logical` | `boolean`, or `null` |
| `integer` | `number` |
| `date` | `string`, `"YYYY-MM-DD"` |
| `datetime` | `string`, ISO 8601 |
| `memo` | `string` |

## Field names

dBase caps names at 11 bytes and expects a leading letter.

| Property | Column | Why |
| --- | --- | --- |
| `name` | `name` | Fits |
| `population_density` | `populatio_2` | Truncated, then de-duplicated |
| `2020_pop` | `F2020_pop` | Prefixed — cannot start with a digit |
| `my property!` | `my_propert` | Non-alphanumerics replaced, then truncated |

The full mapping is in `parts.fields`.

## Encoding

The `.dbf` is always written as UTF-8, with a `.cpg` saying so. On read, the
`.cpg` decides, falling back to UTF-8; legacy single-byte code pages are
supported.

## Ring winding

| Format | Exterior | Holes |
| --- | --- | --- |
| Shapefile | Clockwise | Counter-clockwise |
| GeoJSON (RFC 7946) | Counter-clockwise | Clockwise |

Converted automatically in both directions. Rings are closed if they are not.

## Record alignment

The `.shp` and `.dbf` are matched by position — record *n* of one belongs to
record *n* of the other. Nothing links them by id.

That is why features with `null` geometry are skipped entirely rather than
written as an attribute row with no shape: one such row would shift every
subsequent pairing.
