# Known limits

Most of these come from the shapefile format itself rather than this package.

## Format limits

**One geometry type per file.** Split mixed data into several files, one per
type.

**`GeometryCollection` cannot be represented.** It is rejected rather than
silently flattened.

**Field names are capped at 11 bytes.** Check `parts.fields` to see what was
renamed.

**Character columns are capped at 254 bytes.** Longer strings are truncated on a
character boundary, never mid-codepoint.

**A `.shp` cannot exceed 2 GB.** The header stores its length in 16-bit words as
a signed 32-bit integer. Very large exports need splitting.

**No topology, no styling, no nested attributes.** Objects and arrays are
JSON-encoded into text columns.

## Limits of this package

**`Multipatch` is read-only.** Triangle strips and fans are expanded into a
`MultiPolygon`, which is lossy but preserves the surface. Writing is not
supported.

**Text is always trimmed on read.** dBase pads character columns to a fixed
width; the underlying reader strips that padding and offers no way to keep it.

**Measures are dropped by default.** GeoJSON has no place for them. Pass
`includeM: true` to receive them as a trailing ordinate.

**No reprojection.** The `.prj` you ask for is written verbatim; coordinates are
never transformed. Use [proj4js](https://github.com/proj4js/proj4js) for that.

**No streaming.** Everything is held in memory. Large datasets are limited by the
WebAssembly heap — see [Troubleshooting](/guide/troubleshooting).

**Memo fields are not written.** They can be read.

## Deliberate design choices

These look like limits but are decisions:

**An unknown EPSG code throws.** Silently omitting the `.prj` produces data that
looks fine until someone opens it in the wrong coordinate system.

**Features with no geometry are dropped, not written as null shapes.** Keeps the
`.shp` and `.dbf` record numbering aligned.

**Attribute-less input gets a synthetic `FID` column.** A `.dbf` with zero
columns is rejected by many readers.

**Numeric columns are sized from the data.** A guessed width would let `dbase`
silently crop values into different numbers.
