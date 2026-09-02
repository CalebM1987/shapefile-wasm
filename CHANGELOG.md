# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0](https://github.com/CalebM1987/shapefile-wasm/compare/v0.1.0...v0.1.0) (2026-09-02)


### Features

* add browser download and file input helpers ([bdcbc23](https://github.com/CalebM1987/shapefile-wasm/commit/bdcbc23519e75c01fac2e5d1226f79116d8f3ba1))
* **demo:** add an interactive demo and publish it with the docs ([b04e8f6](https://github.com/CalebM1987/shapefile-wasm/commit/b04e8f68b16cd25aee08d1954c0888e3ff175e70))
* look up projections from epsg.io ([19e00ed](https://github.com/CalebM1987/shapefile-wasm/commit/19e00ed4d995a104de7b6a6af77046cdbbcc3afb))
* pack several shapefiles into one archive ([3dd3154](https://github.com/CalebM1987/shapefile-wasm/commit/3dd31541afe5c82cd08a3caf600de6fe932e7f8c))
* read shapefiles back into GeoJSON ([ef92125](https://github.com/CalebM1987/shapefile-wasm/commit/ef921250f1a56940e2e1fe583c2e6e19c827b10f))
* resolve projections for the .prj file ([bda4d10](https://github.com/CalebM1987/shapefile-wasm/commit/bda4d10ae9b4e649f807c89bc8c3ef24815c5da7))
* write shapefiles from GeoJSON ([93b26dc](https://github.com/CalebM1987/shapefile-wasm/commit/93b26dca931a59b4edffc7e9abefa2872b0d6591))


### Bug fixes

* **ci:** install wasm-pack in the docs workflow ([bf7abef](https://github.com/CalebM1987/shapefile-wasm/commit/bf7abefd0752d3bc343468df2fa1787d7eb69b4c))
* correct the GitHub owner in every URL ([a9929b5](https://github.com/CalebM1987/shapefile-wasm/commit/a9929b5ec6640c2e544f7dc79603955f2814048e))
* **docs:** serve the Rust reference through a real page ([3157b15](https://github.com/CalebM1987/shapefile-wasm/commit/3157b155ccd546bf95dbb3f0512ac3dc67c443ab))
* **read:** descend into nested archives ([0ff05f2](https://github.com/CalebM1987/shapefile-wasm/commit/0ff05f2bfea1a2da9110c67a09f02a47c810910b))


### Documentation

* add the documentation site and contributor guide ([a7df5bf](https://github.com/CalebM1987/shapefile-wasm/commit/a7df5bf2652092cca2c18773f342150887ef4aa7))
* corrected broken link to docs ([3c3de11](https://github.com/CalebM1987/shapefile-wasm/commit/3c3de118effa4665fe5a3975410867f838a38aca))


### CI

* add build, release and publish automation ([3a6dbe0](https://github.com/CalebM1987/shapefile-wasm/commit/3a6dbe038bfa8500228a4959692c7c8f41c481fc))

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
