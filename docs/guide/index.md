# What it is

`@crmackey/shapefile-wasm` converts between GeoJSON and ESRI Shapefiles, entirely
on the client. The conversion runs in a Rust core compiled to WebAssembly; a thin
TypeScript layer handles zipping, projection files and the browser-specific bits.

No server round-trip, no GDAL, and no native build step for anyone installing it.

## The problem it solves

A shapefile is a set of files that have to agree with one another:

| File | Holds | Required |
| --- | --- | --- |
| `.shp` | The geometry | Yes |
| `.shx` | A fixed-width index into the `.shp` | Expected by most software |
| `.dbf` | Attributes, in the dBase III format | Yes |
| `.prj` | The coordinate system, as ESRI WKT | Strongly recommended |
| `.cpg` | The `.dbf`'s character encoding | Recommended |

Writing them by hand in JavaScript is fiddly. Writing them *slightly* wrong
produces files that open in QGIS and break in ArcGIS, or that load with the right
shapes and quietly corrupted attributes.

## What it handles for you

**dBase column widths are measured, not guessed.** The `dbase` crate silently
crops any value that overruns its declared column. A guessed width turns
`-123456789.125` into `-1234567` — still a valid number, just the wrong one.
This package makes a pass over your data first and sizes each column to the
widest value actually present.

**Polygon holes are re-nested on read.** A shapefile stores every ring of every
polygon in one flat list, marked only as outer or inner. Turning that back into
GeoJSON means working out which exterior each hole belongs to. Pairing them in
order is the easy approach and it is wrong; this reader does a point-in-polygon
test and picks the smallest containing ring, so two adjacent donuts keep their
own holes.

**Ring winding is corrected in both directions.** Shapefiles wind exterior rings
clockwise; RFC 7946 wants counter-clockwise with holes reversed.

**Field names are truncated and de-duplicated.** dBase caps names at 11 bytes, so
`measurement_one` and `measurement_two` both become `measurement`. The second is
given a suffix, and the full original-to-written mapping comes back in
[`fields`](/reference/index/interfaces/ShapefileParts) so you can report renames
rather than discover them later.

**Ragged properties are padded.** `dbase` treats a record that omits a declared
field as a hard error, not a null, so every row is filled out before it is
written.

**Features with no geometry are skipped, and counted.** Writing an attribute row
with no shape would desynchronise the `.shp` and `.dbf` record numbering, which
is exactly the kind of corruption that surfaces months later.

## What it does not do

It is not a projection engine — it writes the `.prj` you ask for, but it will not
reproject your coordinates. Pair it with [proj4js](https://github.com/proj4js/proj4js)
if you need that.

See [Known limits](/guide/limits) for the full list.

## Next

- [Getting started](/guide/getting-started) — install and first conversion
- [Writing shapefiles](/guide/writing)
- [Reading shapefiles](/guide/reading)
- [API reference](/reference/)
