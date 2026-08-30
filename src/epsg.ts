/**
 * Optional client for [epsg.io](https://epsg.io), for looking up a coordinate
 * system definition at runtime.
 *
 * This is the one part of the package that touches the network, and it is
 * opt-in: nothing calls it for you. The bundled projection table in
 * `./projections.ts` stays the default precisely so that an export never
 * depends on a third-party service being reachable.
 *
 * Reach for this when you need a code outside the bundled table and would
 * rather fetch it than vendor it — then cache the result, or register it with
 * `registerProjections` so the lookup happens once.
 */

/**
 * Which flavour of WKT to ask for.
 *
 * - `esri-wkt` — what a `.prj` file expects, and what ArcGIS reads most
 *   reliably. The default.
 * - `wkt` — OGC WKT 1. Widely understood, more verbose, carries `AUTHORITY`
 *   nodes that some ESRI software dislikes.
 * - `wkt2` — ISO 19162 WKT 2. The modern standard, and the most precise, but
 *   older GIS software cannot read it.
 */
export type ProjectionFormat = 'wkt' | 'wkt2' | 'esri-wkt';

/** Format to the extension epsg.io serves it under. */
const EXTENSIONS: Record<ProjectionFormat, string> = {
  wkt: 'wkt',
  wkt2: 'wkt2',
  // The odd one out — no hyphen in the URL.
  'esri-wkt': 'esriwkt',
};

/**
 * Keywords a WKT document can begin with, across all three formats.
 *
 * epsg.io answers an unknown code with a 404, so the status check catches that
 * case on its own. This is the fallback for the cases it does not catch: a
 * captive portal or corporate proxy returning its own 200 page, a mirror that
 * signals errors differently, or an endpoint that changes shape later. Getting
 * an HTML login page written into a `.prj` is a particularly annoying failure,
 * because nothing complains until a GIS opens the file.
 */
const WKT_KEYWORDS = [
  // WKT 1 and ESRI WKT
  'PROJCS',
  'GEOGCS',
  'GEOCCS',
  'COMPD_CS',
  'VERT_CS',
  'LOCAL_CS',
  // WKT 2
  'PROJCRS',
  'GEOGCRS',
  'GEODCRS',
  'BOUNDCRS',
  'COMPOUNDCRS',
  'VERTCRS',
  'ENGCRS',
  'PARAMETRICCRS',
  'TIMECRS',
  'DERIVEDPROJCRS',
];

/** Options for {@link fetchProjection}. */
export interface FetchProjectionOptions {
  /** Which WKT flavour to request. Defaults to `'esri-wkt'`, for a `.prj`. */
  format?: ProjectionFormat;
  /** Abort the request early. Combined with `timeoutMs` if both are given. */
  signal?: AbortSignal;
  /** Give up after this many milliseconds. Defaults to 10000. Pass 0 to disable. */
  timeoutMs?: number;
  /** Override the service origin — a mirror, or a proxy that adds CORS headers. */
  baseUrl?: string;
  /** Substitute for `globalThis.fetch`, for tests or a custom agent. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Fetches a coordinate system definition from epsg.io.
 *
 * Uses the native `fetch`, so it works unchanged in the browser, in Node 18+,
 * and in workers.
 *
 * @param epsg The EPSG code, e.g. `26915`. Must be a positive integer.
 * @param options Format, timeout, and overrides.
 * @returns The definition as text, trimmed.
 *
 * @throws {Error} If the code does not exist (epsg.io answers with a 404), the
 *   service is unreachable, the request times out or is aborted, or the response
 *   is not WKT. Every message names which of those it was.
 *
 * @example Fetch a projection and use it directly
 * ```ts
 * const wkt = await fetchProjection(2027);
 * await writeShapefileZip(data, { fileName: 'parcels', wkt });
 * ```
 *
 * @example Fetch once, then register it so later calls are offline
 * ```ts
 * import { fetchProjection, registerProjections } from '@crmackey/shapefile-wasm';
 *
 * registerProjections({ 2027: await fetchProjection(2027) });
 * await writeShapefileZip(data, { epsg: 2027 });
 * ```
 *
 * @example Ask for a different flavour
 * ```ts
 * const wkt2 = await fetchProjection(4326, { format: 'wkt2' });
 * ```
 *
 * @remarks
 * Only `'esri-wkt'` belongs in a `.prj`. WKT 2 is the better standard, but a
 * `.prj` containing it will confuse a lot of GIS software — so do not register
 * a WKT 2 string for use as a projection file.
 *
 * In a browser this is a cross-origin request. epsg.io does send permissive CORS
 * headers, but if your page's Content Security Policy restricts `connect-src`,
 * add `https://epsg.io` to it.
 */
export async function fetchProjection(
  epsg: number,
  options: FetchProjectionOptions = {},
): Promise<string> {
  if (!Number.isInteger(epsg) || epsg <= 0) {
    throw new Error(
      `shapefile-wasm: an EPSG code must be a positive integer, received ${JSON.stringify(epsg)}.`,
    );
  }

  const format = options.format ?? 'esri-wkt';
  const extension = EXTENSIONS[format];
  if (extension === undefined) {
    throw new Error(
      `shapefile-wasm: unknown projection format ${JSON.stringify(format)}. ` +
        `Expected one of ${Object.keys(EXTENSIONS).join(', ')}.`,
    );
  }

  const base = (options.baseUrl ?? 'https://epsg.io').replace(/\/+$/, '');
  const url = `${base}/${epsg}.${extension}`;
  const doFetch = options.fetch ?? globalThis.fetch;

  if (typeof doFetch !== 'function') {
    throw new Error(
      'shapefile-wasm: no global fetch available. Use Node 18+, or pass one via ' +
        'the `fetch` option.',
    );
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const signal = combineSignals(options.signal, timeoutMs);

  let response: Response;
  try {
    response = await doFetch(url, {
      // text/plain is what every one of these endpoints actually serves.
      headers: { accept: 'text/plain, */*' },
      redirect: 'follow',
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // An abort could be the caller's signal or our own timeout; say which.
    if (isAbort(cause)) {
      if (options.signal?.aborted) {
        throw new Error(`shapefile-wasm: the request for EPSG:${epsg} was aborted.`, { cause });
      }
      throw new Error(
        `shapefile-wasm: the request for EPSG:${epsg} timed out after ${timeoutMs}ms.`,
        { cause },
      );
    }
    throw new Error(
      `shapefile-wasm: could not reach ${base} to look up EPSG:${epsg}. ` +
        `${describe(cause)} In a browser this is usually CORS or an offline network.`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new Error(
      `shapefile-wasm: ${base} returned ${response.status} ${response.statusText} ` +
        `for EPSG:${epsg}.`,
    );
  }

  const body = (await response.text()).trim();

  // A 200 that is not WKT means something answered other than epsg.io — a proxy
  // or a captive portal — or a mirror that reports errors its own way.
  if (!looksLikeWkt(body)) {
    throw new Error(
      `shapefile-wasm: ${base} returned a ${response.status} for EPSG:${epsg}, but the ` +
        'body is not a projection. Something other than epsg.io probably answered ' +
        'the request — check for a proxy, or for a mirror that reports errors differently.',
    );
  }

  return body;
}

/** True when `body` opens with a recognised WKT keyword. */
function looksLikeWkt(body: string): boolean {
  if (body.length === 0) return false;

  // Keyword, then optional whitespace, then the opening bracket.
  const match = /^([A-Z_]+)\s*\[/.exec(body);
  if (!match?.[1]) return false;

  return WKT_KEYWORDS.includes(match[1]);
}

/**
 * Merges the caller's signal with a timeout.
 *
 * `AbortSignal.any` is not in Node 18, so fall back to whichever single signal
 * is available rather than failing outright.
 */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const timeout =
    timeoutMs > 0 && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  if (!signal) return timeout;
  if (!timeout) return signal;

  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return AbortSignal.any([signal, timeout]);
  }

  // Older runtime: the caller's signal is the one they asked for.
  return signal;
}

function isAbort(cause: unknown): boolean {
  return (
    cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')
  );
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}.`;
  return String(cause);
}
