/**
 * The API shared by both entry points. The only difference between the package
 * root and `/slim` is whether the wasm binary comes bundled.
 */
export { init, isReady } from './wasm.js';
export type { WasmSource } from './wasm.js';

export { writeShapefile, writeShapefileZip, zipParts } from './write.js';
export { readShapefile, readShapefileZip } from './read.js';
export type { ShapefileSource } from './read.js';

export { writeLayers, writeLayersZip, zipLayers } from './layers.js';
export type {
  ArchiveLayout,
  LayerInput,
  WriteLayersOptions,
  WrittenLayer,
} from './layers.js';

export { fetchProjection } from './epsg.js';
export type { FetchProjectionOptions, ProjectionFormat } from './epsg.js';

export {
  registerProjections,
  getProjection,
  registeredProjections,
  loadProjectionTable,
} from './projections.js';

export type {
  Dimensions,
  Feature,
  FeatureCollection,
  FieldDescriptor,
  GeoJsonInput,
  Geometry,
  Position,
  ProjectionOptions,
  ReadOptions,
  ShapeFamily,
  ShapefileLayer,
  ShapefileParts,
  WriteOptions,
  ZipOptions,
} from './types.js';
