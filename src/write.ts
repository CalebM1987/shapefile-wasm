/** Writing GeoJSON out as shapefile components and zip archives. */
import { zipSync } from 'fflate';

import { load } from './wasm.js';
import { resolveProjection } from './projections.js';
import type {
  Dimensions,
  FieldDescriptor,
  GeoJsonInput,
  ShapefileParts,
  WriteOptions,
  ZipOptions,
} from './types.js';

/**
 * Converts GeoJSON into the raw components of a shapefile.
 *
 * A shapefile holds exactly one geometry type, so mixed input is rejected — with
 * the exception of `Point` and `MultiPoint`, which are promoted to a single
 * `Multipoint` file. `Polygon` and `MultiPolygon` share the `Polygon` type, as do
 * `LineString` and `MultiLineString` under `Polyline`.
 *
 * Dimensionality follows the coordinates: a third ordinate becomes Z and a
 * fourth becomes a measure. Override with {@link WriteOptions.dimensions}.
 *
 * The `.dbf` schema is inferred from the properties of every feature — column
 * types from the values seen, and column widths sized to the widest value, since
 * dBase silently crops anything that overruns its column. Property names are
 * truncated to the 11-byte dBase limit and de-duplicated; the mapping comes back
 * in {@link ShapefileParts.fields}.
 *
 * Features whose geometry is `null` are skipped and counted in
 * {@link ShapefileParts.skippedCount}; writing them would desynchronise the
 * `.shp` and `.dbf` record numbering.
 *
 * The WebAssembly module is instantiated on first use — no `init()` required.
 *
 * @param geojson A `FeatureCollection`, a single `Feature`, a bare geometry, an
 *   array of any of those, or a JSON string of the same. Passing a string skips
 *   a JavaScript-side parse.
 * @param options Geometry, schema and projection settings.
 * @returns The `.shp`, `.shx`, `.dbf` and `.cpg` bytes; the `.prj` text when a
 *   projection was given; and the resolved shape type, bounds and field map.
 *
 * @throws {Error} If the input mixes incompatible geometry types, holds no
 *   writable features, contains a malformed coordinate or a degenerate ring,
 *   uses `GeometryCollection`, or names an EPSG code that cannot be resolved.
 *
 * @example Write the components to disk
 * ```ts
 * const parts = await writeShapefile(featureCollection, { epsg: 4326 });
 * await writeFile('roads.shp', parts.shp);
 * await writeFile('roads.dbf', parts.dbf);
 * ```
 *
 * @example Report any property names that had to be renamed
 * ```ts
 * const { fields } = await writeShapefile(data);
 * for (const field of fields) {
 *   if (field.source !== field.name) {
 *     console.warn(`${field.source} was written as ${field.name}`);
 *   }
 * }
 * ```
 *
 * @see {@link writeShapefileZip} to get one archive instead of loose parts.
 */
export async function writeShapefile(
  geojson: GeoJsonInput | string,
  options: WriteOptions & { epsg?: number; wkt?: string } = {},
): Promise<ShapefileParts> {
  const wasm = await load();

  // Resolve the projection before doing any work, so an unknown EPSG code fails
  // immediately rather than after the geometry has been converted.
  const prj = await resolveProjection(options);

  const wasmOptions = {
    shapeType: options.shapeType,
    dimensions: options.dimensions,
    maxFieldLength: options.maxFieldLength,
  };

  const parts =
    typeof geojson === 'string'
      ? wasm.writeShapefileFromJson(geojson, wasmOptions)
      : wasm.writeShapefile(geojson, wasmOptions);

  try {
    const bbox = Array.from(parts.bbox) as [number, number, number, number];
    return {
      shp: parts.shp,
      shx: parts.shx,
      dbf: parts.dbf,
      cpg: parts.cpg,
      ...(prj !== undefined ? { prj } : {}),
      shapeType: parts.shapeType,
      dimensions: parts.dimensions as Exclude<Dimensions, 'auto'>,
      featureCount: parts.featureCount,
      skippedCount: parts.skippedCount,
      bbox,
      fields: parts.fields as FieldDescriptor[],
    };
  } finally {
    // The getters above copy their data out of linear memory, so the wasm-side
    // object can go as soon as we are done reading it.
    parts.free();
  }
}

/**
 * Converts GeoJSON into a zipped shapefile bundle.
 *
 * The archive holds `.shp`, `.shx`, `.dbf` and `.cpg`, plus a `.prj` when a
 * projection was given — the set of files a GIS expects to find together.
 *
 * Accepts the same input as {@link writeShapefile} and applies the same rules.
 *
 * @param geojson The GeoJSON to convert. See {@link writeShapefile}.
 * @param options Everything {@link writeShapefile} takes, plus `fileName` for
 *   the base name used inside the archive and `level` for the DEFLATE level.
 * @returns The zip archive as bytes — write it to disk, upload it, or pass it to
 *   `downloadShapefileZip` from `@crmackey/shapefile-wasm/browser`.
 *
 * @throws {Error} Everything {@link writeShapefile} throws.
 *
 * @example
 * ```ts
 * const zip = await writeShapefileZip(featureCollection, {
 *   fileName: 'stations',
 *   epsg: 26915,
 * });
 * await writeFile('stations.zip', zip);
 * ```
 */
export async function writeShapefileZip(
  geojson: GeoJsonInput | string,
  options: ZipOptions = {},
): Promise<Uint8Array> {
  const parts = await writeShapefile(geojson, options);
  return zipParts(parts, options);
}

/**
 * Packs already-generated components into a zip archive.
 *
 * Useful when you need the individual parts for something else as well and would
 * rather not run the conversion twice. Synchronous: by the time you hold a
 * {@link ShapefileParts}, the WebAssembly work is already done.
 *
 * @param parts The result of {@link writeShapefile}.
 * @param options `fileName` for the base name inside the archive (default
 *   `"shapefile"`), `level` for the DEFLATE level 0-9 (default `6`).
 * @returns The zip archive as bytes.
 *
 * @example
 * ```ts
 * const parts = await writeShapefile(data, { epsg: 4326 });
 * await uploadForPreview(parts.shp);
 * const zip = zipParts(parts, { fileName: 'parcels' });
 * ```
 */
export function zipParts(
  parts: ShapefileParts,
  options: Pick<ZipOptions, 'fileName' | 'level'> = {},
): Uint8Array {
  const base = sanitizeBaseName(options.fileName);
  const encoder = new TextEncoder();

  const archive: Record<string, Uint8Array> = {
    [`${base}.shp`]: parts.shp,
    [`${base}.shx`]: parts.shx,
    [`${base}.dbf`]: parts.dbf,
    [`${base}.cpg`]: encoder.encode(parts.cpg),
  };

  if (parts.prj) {
    archive[`${base}.prj`] = encoder.encode(parts.prj);
  }

  return zipSync(archive, { level: options.level ?? 6 });
}

/**
 * Strips any directory part and a trailing extension, and removes characters
 * that make trouble on Windows — the archive is likely to be unzipped there.
 *
 * @internal
 */
export function sanitizeBaseName(fileName?: string): string {
  if (!fileName) return 'shapefile';

  const withoutPath = fileName.split(/[/\\]/).pop() ?? fileName;
  const withoutExtension = withoutPath.replace(
    /\.(zip|shp|shx|dbf|prj|cpg|geojson|json)$/i,
    '',
  );
  // Characters Windows reserves, plus whitespace and control codes. The
  // archive is very likely to be unzipped on Windows, where a name that
  // contains a colon simply will not extract.
  const cleaned = withoutExtension.replace(/[\s<>:"|?*\\/\u0000-\u001f]/g, '_');

  return cleaned.length > 0 ? cleaned : 'shapefile';
}
