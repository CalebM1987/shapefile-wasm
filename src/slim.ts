/**
 * The same API as the package root, without the inlined WebAssembly binary.
 *
 * Use this when you can serve the `.wasm` as its own asset: it is roughly a
 * third smaller than the base64 form and the browser can compile it while it
 * streams. You must call {@link init} before anything else.
 *
 * ```ts
 * import { init, writeShapefileZip } from '@crmackey/shapefile-wasm/slim';
 * import wasmUrl from '@crmackey/shapefile-wasm/shapefile_wasm_bg.wasm?url';
 *
 * await init(wasmUrl);
 * const zip = await writeShapefileZip(featureCollection, { epsg: 4326 });
 * ```
 *
 * In Node, hand it the bytes:
 *
 * ```ts
 * import { readFile } from 'node:fs/promises';
 * await init(await readFile(require.resolve('@crmackey/shapefile-wasm/wasm')));
 * ```
 */
export * from './api.js';
