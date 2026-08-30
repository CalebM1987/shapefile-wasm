/** Reading shapefile components and zip archives back into GeoJSON. */
import { unzipSync } from 'fflate';

import { load } from './wasm.js';
import type { FeatureCollection, ReadOptions, ShapefileLayer } from './types.js';

/** The pieces of a shapefile to read. Only the `.shp` is required. */
export interface ShapefileSource {
  /** Contents of the `.shp`. The `.shx` is not needed. */
  shp: Uint8Array;
  /** Contents of the `.dbf`. Without it, features have empty properties. */
  dbf?: Uint8Array | undefined;
  /** Contents of the `.cpg`; decides how `.dbf` text is decoded. */
  cpg?: string | undefined;
  /** Contents of the `.prj`; surfaced as `wkt` on the result. */
  prj?: string | undefined;
}

/**
 * Reads shapefile components into a GeoJSON `FeatureCollection`.
 *
 * The `.shx` is not needed — it is only an index into the `.shp`, which this
 * reader walks sequentially.
 *
 * Shapefile polygons store their rings in one flat list with no nesting, so
 * holes are matched back to the ring that actually contains them (by point-in-
 * polygon test, choosing the smallest containing ring) and then rewound to
 * RFC 7946 winding order: exteriors counter-clockwise, holes clockwise.
 *
 * Single-part geometries come back as the simple GeoJSON type — `LineString`
 * rather than a one-element `MultiLineString`, and likewise for `Polygon`.
 *
 * `.dbf` text is decoded as UTF-8 unless the `.cpg` or `options.encoding` names
 * a legacy code page such as `cp1252`. dBase pads character columns to a fixed
 * width; that padding is always stripped.
 *
 * The WebAssembly module is instantiated on first use — no `init()` required.
 *
 * @param source The `.shp` bytes, and optionally the `.dbf`, `.cpg` and `.prj`.
 *   Without a `.dbf`, features come back with empty properties.
 * @param options Decoding settings. See {@link ReadOptions}.
 * @returns A `FeatureCollection`. When a `.prj` was supplied its text is carried
 *   on the non-standard `wkt` member, since GeoJSON has nowhere else to put it.
 *
 * @throws {Error} If the `.shp` is truncated, malformed, or holds a shape type
 *   this reader does not understand.
 *
 * @example
 * ```ts
 * const geojson = await readShapefile({
 *   shp: await readFile('roads.shp'),
 *   dbf: await readFile('roads.dbf'),
 *   prj: await readFile('roads.prj', 'utf8'),
 * });
 * ```
 *
 * @see {@link readShapefileZip} to read a whole archive at once.
 */
export async function readShapefile(
  source: ShapefileSource,
  options: ReadOptions = {},
): Promise<FeatureCollection> {
  const wasm = await load();

  return wasm.readShapefile(source.shp, source.dbf, {
    // An explicit option beats the .cpg, which is often absent or wrong.
    encoding: options.encoding ?? normalizeCpg(source.cpg),
    includeM: options.includeM ?? false,
    prj: source.prj,
  }) as FeatureCollection;
}

/**
 * Reads every shapefile inside a zip archive.
 *
 * Archives routinely hold more than one layer, and just as routinely nest them
 * in folders, so components are grouped by their full path minus extension.
 * `a/roads.shp` and `b/roads.shp` therefore stay separate layers.
 *
 * Each layer is decoded using its own `.cpg`, and carries its own `.prj`.
 * Directory entries, `__MACOSX/` resource forks and files with no matching
 * `.shp` are ignored.
 *
 * @param archive The zip file as bytes.
 * @param options Decoding settings. An explicit `encoding` here overrides the
 *   `.cpg` of every layer.
 * @returns One entry per layer, sorted by name.
 *
 * @throws {Error} If the archive cannot be unzipped, or holds no `.shp` at all.
 *
 * @example
 * ```ts
 * const layers = await readShapefileZip(bytes);
 * for (const layer of layers) {
 *   console.log(layer.name, layer.geojson.features.length, layer.prj);
 * }
 * ```
 *
 * @example Read an older archive written in a Windows code page
 * ```ts
 * const layers = await readShapefileZip(bytes, { encoding: 'cp1252' });
 * ```
 */
export async function readShapefileZip(
  archive: Uint8Array,
  options: ReadOptions = {},
): Promise<ShapefileLayer[]> {
  const files = unzipSync(archive);
  const decoder = new TextDecoder();

  // Group by path-without-extension so "roads.shp" and "roads.dbf" pair up, and
  // "a/roads.shp" stays distinct from "b/roads.shp".
  const groups = new Map<string, Record<string, Uint8Array>>();

  for (const [path, bytes] of Object.entries(files)) {
    // Directory entries and macOS resource forks.
    if (path.endsWith('/') || path.includes('__MACOSX/')) continue;

    const match = /^(.*)\.(shp|shx|dbf|prj|cpg)$/i.exec(path);
    if (!match?.[1] || !match[2]) continue;

    const stem = match[1];
    const group = groups.get(stem) ?? {};
    group[match[2].toLowerCase()] = bytes;
    groups.set(stem, group);
  }

  const layers: ShapefileLayer[] = [];

  for (const [stem, group] of groups) {
    // A .dbf or .prj with no .shp beside it is not a layer.
    if (!group.shp) continue;

    const cpg = group.cpg ? decoder.decode(group.cpg) : undefined;
    const prj = group.prj ? decoder.decode(group.prj).trim() : undefined;
    const encoding = options.encoding ?? normalizeCpg(cpg) ?? 'utf-8';

    layers.push({
      name: stem.split('/').pop() ?? stem,
      geojson: await readShapefile(
        { shp: group.shp, dbf: group.dbf, cpg, prj },
        { ...options, encoding },
      ),
      ...(prj ? { prj } : {}),
      encoding,
    });
  }

  if (layers.length === 0) {
    throw new Error('shapefile-wasm: the archive contains no .shp file.');
  }

  return layers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `.cpg` files hold a bare label with no agreed spelling — "UTF-8", "utf8",
 * "ISO-8859-1", or a raw code page number. Normalising here keeps the tolerance
 * in one place; the Rust side matches generously and falls back to UTF-8.
 */
function normalizeCpg(cpg?: string): string | undefined {
  if (!cpg) return undefined;
  // Strip a BOM and any trailing newline the file may carry.
  const cleaned = cpg.replace(/^﻿/, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
