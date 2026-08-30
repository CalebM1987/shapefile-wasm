# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

Initial release.

### Added

- `writeShapefile` and `writeShapefileZip` — GeoJSON to shapefile components or
  a zipped bundle.
- `readShapefile` and `readShapefileZip` — shapefile components or an archive
  back to GeoJSON.
- `zipParts` for packaging components generated separately.
- Full geometry support: point, multipoint, polyline and polygon families, in
  2D, 3D, and with M measures.
- `.dbf` schema inference with column widths measured from the data, field-name
  truncation and de-duplication, and a reported mapping.
- Polygon hole re-nesting and RFC 7946 winding correction on read.
- Legacy `.dbf` code page support on read (`cp1252`, `cp437`, `cp850` and
  others), driven by the `.cpg`.
- Projection registry with four built-in EPSG codes and 116 more loaded on
  demand; `registerProjections`, `getProjection`, `registeredProjections`,
  `loadProjectionTable`.
- `/browser` entry point with `downloadShapefileZip`, `readShapefileFile` and
  `triggerDownload`.
- `/slim` entry point for serving the `.wasm` as a separate asset.
- Multi-layer and nested-folder archive reading.
- `writeLayersZip`, `writeLayers` and `zipLayers` for packing several
  shapefiles into one archive, with `flat`, `folders` and `nested` layouts.
- `fetchProjection` for looking up a definition from epsg.io at runtime, in
  `esri-wkt`, `wkt` or `wkt2`.
