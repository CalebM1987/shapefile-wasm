/**
 * Browser-only helpers, kept out of the main entry point so the package stays
 * importable from Node, workers and SSR without touching `document`.
 *
 * ```ts
 * import { writeShapefileZip } from '@crmackey/shapefile-wasm';
 * import { downloadShapefileZip } from '@crmackey/shapefile-wasm/browser';
 * ```
 */
import { writeShapefileZip } from './write.js';
import { readShapefileZip } from './read.js';
import type { GeoJsonInput, ReadOptions, ShapefileLayer, ZipOptions } from './types.js';

/**
 * Prompts the browser to save `data` under `fileName`.
 *
 * Creates a temporary object URL and clicks a hidden anchor, then cleans both up.
 * The URL is revoked on the next tick rather than immediately, because revoking
 * synchronously cancels the download in some browsers.
 *
 * @param data The bytes to save. A `Uint8Array` is copied into a fresh buffer
 *   first, since a view into WebAssembly memory may cover more than it appears
 *   to and `Blob` would capture the whole thing.
 * @param fileName Name offered in the save dialog, extension included.
 * @param mimeType Content type for the blob. Defaults to `application/zip`.
 *
 * @throws {Error} Outside a browser — in Node, write the bytes with
 *   `fs.writeFile` instead.
 *
 * @example
 * ```ts
 * const zip = await writeShapefileZip(data, { fileName: 'parcels' });
 * triggerDownload(zip, 'parcels.zip');
 * ```
 */
export function triggerDownload(
  data: Uint8Array | Blob,
  fileName: string,
  mimeType = 'application/zip',
): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(
      'shapefile-wasm: triggerDownload needs a browser. In Node, write the bytes ' +
        'to disk with fs.writeFile instead.',
    );
  }

  const blob =
    data instanceof Blob
      ? data
      : // Copy into a fresh ArrayBuffer: a Uint8Array view of wasm memory may be
        // a partial view of a larger buffer, and Blob would take all of it.
        new Blob([data.slice().buffer as ArrayBuffer], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoking synchronously can cancel the download in some browsers; one turn of
  // the event loop is enough for the navigation to have started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Converts GeoJSON to a zipped shapefile and saves it to the user's downloads.
 *
 * A convenience wrapper over {@link writeShapefileZip} and
 * {@link triggerDownload}. The bytes come back too, so the same archive can be
 * uploaded or cached without building it a second time.
 *
 * @param geojson The GeoJSON to convert. See `writeShapefile`.
 * @param options Everything `writeShapefileZip` takes. `fileName` names both the
 *   downloaded archive and the files inside it.
 * @returns The zip archive as bytes.
 *
 * @throws {Error} Outside a browser, or for any reason `writeShapefileZip`
 *   throws — mixed geometry types, an unresolvable EPSG code, and so on.
 *
 * @example
 * ```ts
 * button.addEventListener('click', async () => {
 *   await downloadShapefileZip(featureCollection, {
 *     fileName: 'survey-points',
 *     epsg: 26915,
 *   });
 * });
 * ```
 */
export async function downloadShapefileZip(
  geojson: GeoJsonInput | string,
  options: ZipOptions = {},
): Promise<Uint8Array> {
  const zip = await writeShapefileZip(geojson, options);
  const base = options.fileName?.replace(/\.zip$/i, '') || 'shapefile';
  triggerDownload(zip, `${base}.zip`);
  return zip;
}

/**
 * Reads a zipped shapefile straight from a `File` or `Blob`.
 *
 * Takes what an `<input type="file">`, a drop event, or the File System Access
 * API hands you, and returns every layer the archive contains.
 *
 * @param file The archive, as a `File` from a picker or any `Blob`.
 * @param options Decoding settings passed through to `readShapefileZip`.
 * @returns One entry per layer in the archive, sorted by name.
 *
 * @throws {Error} If the file is not a readable zip, or holds no `.shp`.
 *
 * @example
 * ```ts
 * input.addEventListener('change', async () => {
 *   const file = input.files?.[0];
 *   if (!file) return;
 *
 *   const layers = await readShapefileFile(file);
 *   for (const layer of layers) {
 *     map.addSource(layer.name, { type: 'geojson', data: layer.geojson });
 *   }
 * });
 * ```
 */
export async function readShapefileFile(
  file: File | Blob,
  options: ReadOptions = {},
): Promise<ShapefileLayer[]> {
  const buffer = await file.arrayBuffer();
  return readShapefileZip(new Uint8Array(buffer), options);
}
