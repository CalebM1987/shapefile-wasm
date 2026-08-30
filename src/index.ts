/**
 * Read and write ESRI Shapefiles in the browser, in Node, and in workers.
 *
 * This entry point bundles the WebAssembly binary as base64, so it works with no
 * bundler configuration and no separate asset to serve:
 *
 * ```ts
 * import { writeShapefileZip, readShapefileZip } from '@crmackey/shapefile-wasm';
 *
 * const zip = await writeShapefileZip(featureCollection, { epsg: 4326 });
 * const layers = await readShapefileZip(zip);
 * ```
 *
 * If you would rather serve the `.wasm` as its own streamable asset — worth it
 * for browser bundles, since base64 costs about a third in size and has to be
 * decoded before it can be compiled — use `@crmackey/shapefile-wasm/slim` and
 * call `init(url)` yourself.
 */
import { setFallbackLoader } from './wasm.js';

// Loaded lazily so the base64 blob is only paid for once something is actually
// converted, and never at all if the caller supplies their own binary.
setFallbackLoader(async () => {
  const { wasmBytes } = await import('./generated/wasm-inline.js');
  return wasmBytes();
});

export * from './api.js';
