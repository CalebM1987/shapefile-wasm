/**
 * Packing several shapefiles into one archive.
 *
 * A shapefile holds exactly one geometry type, so a dataset that mixes points,
 * lines and polygons — a utility network, say — is inherently several files.
 * These helpers convert a batch in one call and lay the results out in whichever
 * shape the consumer on the other end expects.
 */
import { zipSync } from 'fflate';

import { sanitizeBaseName, writeShapefile } from './write.js';
import type {
  GeoJsonInput,
  ProjectionOptions,
  ShapefileParts,
  WriteOptions,
  ZipOptions,
} from './types.js';

/**
 * How the layers are arranged inside the archive.
 *
 * - `flat` — every layer's files side by side at the root:
 *   `StormManholes.shp`, `StormPipes.shp`, … The default, and what desktop GIS
 *   opens most readily.
 * - `folders` — one folder per layer, named after it:
 *   `StormManholes/StormManholes.shp`, … Easier to read when there are many
 *   layers, and still a single archive.
 * - `nested` — one `.zip` per layer inside the outer archive:
 *   `StormManholes.zip`, `StormPipes.zip`, … Use this when each layer has to be
 *   handed to something that expects an archive holding exactly one shapefile,
 *   which many web GIS uploaders do.
 */
export type ArchiveLayout = 'flat' | 'folders' | 'nested';

/** One layer to write into a multi-layer archive. */
export interface LayerInput extends WriteOptions, ProjectionOptions {
  /**
   * Base name for this layer's files. Sanitised the same way as `fileName`
   * elsewhere, and must stay unique across the batch once sanitised.
   */
  name: string;
  /**
   * The layer's geometry and attributes. Accepts everything
   * {@link writeShapefile} does, including a JSON string.
   */
  geojson: GeoJsonInput | string;
  /**
   * Alias for {@link ProjectionOptions.wkt}, so a layer returned by
   * `readShapefileZip` can be passed straight back in without renaming a field.
   * `wkt` wins if both are set.
   */
  prj?: string;
}

/** Settings for {@link writeLayersZip}. */
export interface WriteLayersOptions extends WriteOptions, ProjectionOptions {
  /** How to arrange the layers. Defaults to `'flat'`. */
  layout?: ArchiveLayout;
  /**
   * Wrap everything in a top-level folder — handy for a dated or job-numbered
   * export. Applied in every layout.
   */
  folder?: string;
  /** DEFLATE level, 0-9. Defaults to 6. */
  level?: ZipOptions['level'];
}

/** What one layer produced, alongside the name it was written under. */
export interface WrittenLayer {
  /** The sanitised name used inside the archive. */
  name: string;
  /** The name as supplied, before sanitising. */
  source: string;
  /** The generated components, plus what was inferred while writing them. */
  parts: ShapefileParts;
}

/**
 * Converts several GeoJSON inputs into a single zip archive.
 *
 * Per-layer options override the shared ones, so a common `epsg` can be set once
 * and a single layer can still opt out.
 *
 * @param layers The layers to write. Each needs a `name` and `geojson`.
 * @param options Shared write options, plus `layout`, `folder` and `level`.
 * @returns The zip archive as bytes.
 *
 * @throws {Error} If `layers` is empty, if two layers resolve to the same name,
 *   or if any layer fails to convert. A layer's failure names the layer, so a
 *   bad geometry in a batch of twenty is still traceable.
 *
 * @example A utility network as one archive
 * ```ts
 * const zip = await writeLayersZip(
 *   [
 *     { name: 'StormManholes', geojson: manholes },
 *     { name: 'StormPipes', geojson: pipes },
 *     { name: 'Basins', geojson: basins },
 *   ],
 *   { epsg: 26915, folder: 'storm-network' },
 * );
 * ```
 *
 * @example One inner zip per layer, for an uploader that wants them separately
 * ```ts
 * const zip = await writeLayersZip(layers, { layout: 'nested', epsg: 26915 });
 * ```
 *
 * @example Re-pack what you just read
 * ```ts
 * const layers = await readShapefileZip(incoming);
 * const repacked = await writeLayersZip(layers, { layout: 'folders' });
 * ```
 */
export async function writeLayersZip(
  layers: readonly LayerInput[],
  options: WriteLayersOptions = {},
): Promise<Uint8Array> {
  const written = await writeLayers(layers, options);
  return zipLayers(written, options);
}

/**
 * Converts several GeoJSON inputs, without packing them.
 *
 * Use this when you want the per-layer metadata — feature counts, field
 * renames, skipped features — and not just the bytes. Feed the result to
 * {@link zipLayers} when you are ready to pack it.
 *
 * @param layers The layers to write.
 * @param options Shared write options. `layout`, `folder` and `level` are
 *   ignored here; they matter only when packing.
 * @returns One entry per layer, in the order given.
 *
 * @throws {Error} If `layers` is empty, if two layers resolve to the same name,
 *   or if any layer fails to convert.
 *
 * @example Report on a batch before shipping it
 * ```ts
 * const written = await writeLayers(layers, { epsg: 26915 });
 *
 * for (const layer of written) {
 *   console.log(layer.name, layer.parts.shapeType, layer.parts.featureCount);
 *   if (layer.parts.skippedCount) {
 *     console.warn(`${layer.name}: skipped ${layer.parts.skippedCount}`);
 *   }
 * }
 *
 * const zip = zipLayers(written, { layout: 'folders' });
 * ```
 */
export async function writeLayers(
  layers: readonly LayerInput[],
  options: WriteLayersOptions = {},
): Promise<WrittenLayer[]> {
  if (layers.length === 0) {
    throw new Error('shapefile-wasm: writeLayers needs at least one layer.');
  }

  const names = resolveNames(layers);
  const written: WrittenLayer[] = [];

  // Sequential on purpose: the WebAssembly module is a single instance, so
  // running these concurrently would not overlap any real work.
  for (const [index, layer] of layers.entries()) {
    const name = names[index]!;

    try {
      const parts = await writeShapefile(layer.geojson, resolveOptions(layer, options));

      written.push({ name, source: layer.name, parts });
    } catch (cause) {
      // Without the layer name, a failure in a batch of twenty says nothing
      // about which one to go and look at.
      throw new Error(
        `shapefile-wasm: layer "${layer.name}" could not be written. ${describe(cause)}`,
        { cause },
      );
    }
  }

  return written;
}

/**
 * Packs already-converted layers into one archive.
 *
 * @param layers The result of {@link writeLayers}.
 * @param options `layout`, `folder` and `level`.
 * @returns The zip archive as bytes.
 *
 * @throws {Error} If `layers` is empty.
 */
export function zipLayers(
  layers: readonly WrittenLayer[],
  options: Pick<WriteLayersOptions, 'layout' | 'folder' | 'level'> = {},
): Uint8Array {
  if (layers.length === 0) {
    throw new Error('shapefile-wasm: zipLayers needs at least one layer.');
  }

  const layout = options.layout ?? 'flat';
  const level = options.level ?? 6;
  const root = options.folder ? `${sanitizeBaseName(options.folder)}/` : '';

  const archive: Record<string, Uint8Array> = {};

  for (const { name, parts } of layers) {
    if (layout === 'nested') {
      // Each layer becomes a self-contained archive. Store rather than deflate
      // the inner zips — their contents are already compressed, so a second
      // pass costs time and gains nothing.
      archive[`${root}${name}.zip`] = zipSync(componentsFor(name, parts), { level });
      continue;
    }

    const prefix = layout === 'folders' ? `${root}${name}/` : root;
    for (const [file, bytes] of Object.entries(componentsFor(name, parts))) {
      archive[`${prefix}${file}`] = bytes;
    }
  }

  return zipSync(archive, { level: layout === 'nested' ? 0 : level });
}

/**
 * Merges a layer's own settings over the shared ones.
 *
 * Absent keys are left out rather than set to `undefined`, which
 * `exactOptionalPropertyTypes` treats as a different thing from "not passed".
 */
function resolveOptions(
  layer: LayerInput,
  shared: WriteLayersOptions,
): WriteOptions & ProjectionOptions {
  const resolved: WriteOptions & ProjectionOptions = {};

  const shapeType = layer.shapeType ?? shared.shapeType;
  if (shapeType !== undefined) resolved.shapeType = shapeType;

  const dimensions = layer.dimensions ?? shared.dimensions;
  if (dimensions !== undefined) resolved.dimensions = dimensions;

  const maxFieldLength = layer.maxFieldLength ?? shared.maxFieldLength;
  if (maxFieldLength !== undefined) resolved.maxFieldLength = maxFieldLength;

  const epsg = layer.epsg ?? shared.epsg;
  if (epsg !== undefined) resolved.epsg = epsg;

  // `prj` is the field name a layer from readShapefileZip carries.
  const wkt = layer.wkt ?? layer.prj ?? shared.wkt;
  if (wkt !== undefined) resolved.wkt = wkt;

  return resolved;
}

/** The files that make up one shapefile, keyed by their name in the archive. */
function componentsFor(name: string, parts: ShapefileParts): Record<string, Uint8Array> {
  const encoder = new TextEncoder();

  const components: Record<string, Uint8Array> = {
    [`${name}.shp`]: parts.shp,
    [`${name}.shx`]: parts.shx,
    [`${name}.dbf`]: parts.dbf,
    [`${name}.cpg`]: encoder.encode(parts.cpg),
  };

  if (parts.prj) {
    components[`${name}.prj`] = encoder.encode(parts.prj);
  }

  return components;
}

/**
 * Sanitises every layer name and rejects collisions.
 *
 * Two different names can sanitise to the same thing — `"storm pipes"` and
 * `"storm-pipes"` both become `storm_pipes` — and in a flat archive the second
 * would silently overwrite the first. Losing a layer without a word is far worse
 * than refusing to build the file.
 */
function resolveNames(layers: readonly LayerInput[]): string[] {
  const seen = new Map<string, string>();

  return layers.map((layer, index) => {
    if (typeof layer.name !== 'string' || layer.name.trim() === '') {
      throw new Error(`shapefile-wasm: layer at index ${index} needs a non-empty name.`);
    }

    const name = sanitizeBaseName(layer.name);
    const previous = seen.get(name);

    if (previous !== undefined) {
      throw new Error(
        `shapefile-wasm: layers "${previous}" and "${layer.name}" both resolve to ` +
          `"${name}" inside the archive. Give them distinct names.`,
      );
    }

    seen.set(name, layer.name);
    return name;
  });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
