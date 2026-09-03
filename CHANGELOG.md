# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3](https://github.com/CalebM1987/shapefile-wasm/compare/v0.1.2...v0.1.3) (2026-09-03)


### Bug fixes

* **ci:** dispatch the publish workflow instead of calling it ([8e68fb0](https://github.com/CalebM1987/shapefile-wasm/commit/8e68fb07cdbf3f1bffa6777b7fb3e0e33ab0a17d))

## [0.1.2](https://github.com/CalebM1987/shapefile-wasm/compare/v0.1.1...v0.1.2) (2026-09-03)


### Bug fixes

* **ci:** call the publish workflow from release-please ([0850ccb](https://github.com/CalebM1987/shapefile-wasm/commit/0850ccb11f9e8426c14a4d8767486e230314f7e3))

## [0.1.1](https://github.com/CalebM1987/shapefile-wasm/compare/v0.1.0...v0.1.1) (2026-09-03)


### Bug fixes

* correct the GitHub owner in every URL ([a9929b5](https://github.com/CalebM1987/shapefile-wasm/commit/a9929b5ec6640c2e544f7dc79603955f2814048e))


### Documentation

* add llms.txt for AI tooling ([ba5a2a8](https://github.com/CalebM1987/shapefile-wasm/commit/ba5a2a8fcc9da7f97d9596aa66cf708af320a161))
* corrected broken link to docs ([3c3de11](https://github.com/CalebM1987/shapefile-wasm/commit/3c3de118effa4665fe5a3975410867f838a38aca))

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
