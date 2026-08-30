/**
 * WebAssembly lifecycle.
 *
 * The main entry point registers a loader that supplies the wasm binary inlined
 * as base64, so `import` then call works with no bundler configuration in the
 * browser, in Node, and in workers. The `/slim` entry point omits that blob and
 * requires an explicit {@link init} call, which is the better trade when you can
 * serve the `.wasm` as a separate, streamable asset.
 */
import initWasm, * as bindings from './generated/bindings.js';

type Bindings = typeof bindings;

/** Anything `init` will accept as a source for the wasm binary. */
export type WasmSource =
  | string
  | URL
  | Response
  | ArrayBuffer
  | Uint8Array
  | WebAssembly.Module;

let pending: Promise<Bindings> | null = null;
let ready = false;
let fallbackLoader: (() => Promise<WasmSource>) | null = null;

/**
 * Registers the source used when {@link init} is called with no argument.
 * The main entry point calls this; `/slim` does not.
 *
 * @internal
 */
export function setFallbackLoader(loader: () => Promise<WasmSource>): void {
  fallbackLoader = loader;
}

/**
 * Compiles and instantiates the WebAssembly module.
 *
 * Every public API calls this for you, so reach for it directly only to control
 * *when* the roughly 50 ms cost is paid — during a splash screen rather than on
 * a user's first click — or to point at a `.wasm` you serve yourself.
 *
 * Safe to call repeatedly: the first call wins and later callers await the same
 * instantiation. A failed attempt is not cached, so a transient network error
 * can be retried.
 *
 * Required before anything else when using `@crmackey/shapefile-wasm/slim`,
 * which ships without the inlined binary.
 *
 * @param source Where to get the binary: a URL string or `URL`, a `Response`, an
 *   `ArrayBuffer`/`Uint8Array` of bytes, or an already-compiled
 *   `WebAssembly.Module`. Omit it on the package root to use the inlined binary.
 * @returns Resolves once the module is ready to use.
 *
 * @throws {Error} If no binary is available — the usual cause is importing
 *   `/slim` and calling `init()` with no argument — or if compilation fails.
 *
 * @example Warm the module up ahead of time
 * ```ts
 * await init();
 * ```
 *
 * @example Serve the binary as its own asset (smaller, streams while compiling)
 * ```ts
 * import { init } from '@crmackey/shapefile-wasm/slim';
 * import wasmUrl from '@crmackey/shapefile-wasm/wasm?url';
 *
 * await init(wasmUrl);
 * ```
 */
export async function init(source?: WasmSource): Promise<void> {
  await load(source);
}

/** Resolves the bindings, instantiating on first use. @internal */
export async function load(source?: WasmSource): Promise<Bindings> {
  if (!pending) {
    pending = instantiate(source).then(
      (result) => {
        ready = true;
        return result;
      },
      (error) => {
        // A failed instantiation must not be cached, or every later call would
        // reject with a stale error and no way to retry.
        pending = null;
        throw error;
      },
    );
  }
  return pending;
}

async function instantiate(source?: WasmSource): Promise<Bindings> {
  const resolved = source ?? (await fallbackLoader?.());

  if (resolved === undefined) {
    throw new Error(
      'shapefile-wasm: no WebAssembly binary available. The "/slim" entry point ' +
        'requires init(urlOrBytes) before any other call, or import the package ' +
        'root to use the inlined binary.',
    );
  }

  await initWasm({ module_or_path: resolved });
  return bindings;
}

/**
 * Whether the WebAssembly module has finished instantiating.
 *
 * `false` while an {@link init} call is still in flight, so this reports genuine
 * readiness rather than "has anyone started loading it".
 *
 * @returns `true` once conversions will run without waiting on a compile.
 *
 * @example Show a spinner only when the module still has to load
 * ```ts
 * if (!isReady()) showSpinner();
 * await init();
 * hideSpinner();
 * ```
 */
export function isReady(): boolean {
  return ready;
}
