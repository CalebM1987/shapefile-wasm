/**
 * The epsg.io client.
 *
 * Every test injects a fake `fetch`, so the suite never touches the network —
 * a test that depends on a third-party service being up is a test that fails
 * for reasons unrelated to this package.
 *
 * The fixtures are real responses captured from epsg.io.
 */
import { describe, expect, it, vi } from 'vitest';

import { fetchProjection } from '../src/epsg.js';

const ESRI_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const WKT1 =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

const WKT2 =
  'GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"]],CS[ellipsoidal,2],ID["EPSG",4326]]';

/**
 * An HTML page returned with a 200. epsg.io itself answers an unknown code with
 * a 404, so this stands in for the cases the status check misses: a corporate
 * proxy or captive portal answering instead of the service.
 */
const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"/><title>EPSG.io</title></head>
  <body>Nothing found</body>
</html>`;

function respondWith(body: string, init: ResponseInit = {}) {
  return vi.fn(async () => new Response(body, { status: 200, ...init }));
}

describe('requesting the right URL', () => {
  it.each([
    ['esri-wkt', 'esriwkt'],
    ['wkt', 'wkt'],
    ['wkt2', 'wkt2'],
  ] as const)('maps format %s to the .%s extension', async (format, extension) => {
    const fetchMock = respondWith(ESRI_WKT);

    await fetchProjection(26915, { format, fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://epsg.io/26915.${extension}`);
  });

  it('defaults to esri-wkt, which is what a .prj wants', async () => {
    const fetchMock = respondWith(ESRI_WKT);

    await fetchProjection(4326, { fetch: fetchMock });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://epsg.io/4326.esriwkt');
  });

  it('honours a custom base URL, without doubling the slash', async () => {
    const fetchMock = respondWith(ESRI_WKT);

    await fetchProjection(4326, { baseUrl: 'https://mirror.example.com/', fetch: fetchMock });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://mirror.example.com/4326.esriwkt');
  });
});

describe('successful lookups', () => {
  it('returns the definition', async () => {
    const wkt = await fetchProjection(4326, { fetch: respondWith(ESRI_WKT) });
    expect(wkt).toBe(ESRI_WKT);
  });

  it('trims surrounding whitespace', async () => {
    const wkt = await fetchProjection(4326, { fetch: respondWith(`\n${ESRI_WKT}\n\n`) });
    expect(wkt).toBe(ESRI_WKT);
  });

  it.each([
    ['WKT 1', WKT1],
    ['WKT 2', WKT2],
    ['ESRI WKT', ESRI_WKT],
  ])('accepts %s', async (_label, body) => {
    await expect(fetchProjection(4326, { fetch: respondWith(body) })).resolves.toBe(body);
  });

  it('accepts a projected WKT 2 document', async () => {
    const projcrs = 'PROJCRS["NAD83 / UTM zone 15N",BASEGEOGCRS["NAD83"]]';
    await expect(
      fetchProjection(26915, { format: 'wkt2', fetch: respondWith(projcrs) }),
    ).resolves.toBe(projcrs);
  });
});

describe('unknown codes', () => {
  it('reports the 404 epsg.io returns for a code that does not exist', async () => {
    const fetchMock = vi.fn(
      async () => new Response(NOT_FOUND_PAGE, { status: 404, statusText: 'Not Found' }),
    );

    await expect(fetchProjection(999999, { fetch: fetchMock })).rejects.toThrow(
      /returned 404 Not Found for EPSG:999999/,
    );
  });
});

describe('responses that are not WKT', () => {
  // Defence in depth. A proxy or captive portal can answer with its own 200
  // page, and writing that into a .prj fails silently until a GIS opens it.
  it('rejects an HTML page served with a 200', async () => {
    await expect(
      fetchProjection(4326, { fetch: respondWith(NOT_FOUND_PAGE) }),
    ).rejects.toThrow(/body is not a projection/);
  });

  it('points at a proxy as the likely cause', async () => {
    await expect(fetchProjection(4326, { fetch: respondWith(NOT_FOUND_PAGE) })).rejects.toThrow(
      /check for a proxy/,
    );
  });

  it('rejects an empty body', async () => {
    await expect(fetchProjection(4326, { fetch: respondWith('   ') })).rejects.toThrow(
      /body is not a projection/,
    );
  });

  it('rejects a body that is not WKT at all', async () => {
    await expect(
      fetchProjection(4326, { fetch: respondWith('{"error":"nope"}') }),
    ).rejects.toThrow(/body is not a projection/);
  });

  it('rejects a bracketed keyword that is not a CRS type', async () => {
    await expect(
      fetchProjection(4326, { fetch: respondWith('SPHEROID["WGS_1984",6378137.0]') }),
    ).rejects.toThrow(/body is not a projection/);
  });
});

describe('failure modes', () => {
  it('reports an error status', async () => {
    const fetchMock = vi.fn(
      async () => new Response('upstream is unwell', { status: 503, statusText: 'Service Unavailable' }),
    );

    await expect(fetchProjection(4326, { fetch: fetchMock })).rejects.toThrow(/returned 503/);
  });

  it('reports an unreachable service, and hints at the usual cause', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchProjection(4326, { fetch: fetchMock })).rejects.toThrow(
      /could not reach https:\/\/epsg\.io/,
    );
    await expect(fetchProjection(4326, { fetch: fetchMock })).rejects.toThrow(/CORS/);
  });

  it('distinguishes a caller abort from a timeout', async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchMock = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });

    await expect(
      fetchProjection(4326, { fetch: fetchMock, signal: controller.signal }),
    ).rejects.toThrow(/was aborted/);
  });

  it('reports a timeout as a timeout', async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(
      fetchProjection(4326, { fetch: fetchMock, timeoutMs: 25 }),
    ).rejects.toThrow(/timed out after 25ms/);
  });

  it('preserves the original failure as the cause', async () => {
    const original = new TypeError('Failed to fetch');
    const fetchMock = vi.fn(async () => {
      throw original;
    });

    await expect(fetchProjection(4326, { fetch: fetchMock })).rejects.toMatchObject({
      cause: original,
    });
  });
});

describe('argument validation', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects %s as an EPSG code', async (code) => {
    await expect(fetchProjection(code, { fetch: respondWith(ESRI_WKT) })).rejects.toThrow(
      /positive integer/,
    );
  });

  it('rejects an unknown format', async () => {
    await expect(
      // Deliberately bypassing the type, since JavaScript callers can.
      fetchProjection(4326, { format: 'proj4' as never, fetch: respondWith(ESRI_WKT) }),
    ).rejects.toThrow(/unknown projection format/);
  });

  it('does not call fetch when the arguments are invalid', async () => {
    const fetchMock = respondWith(ESRI_WKT);
    await expect(fetchProjection(-1, { fetch: fetchMock })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('integrating with the projection registry', () => {
  it('produces a definition that can be registered and used', async () => {
    const { registerProjections, getProjection } = await import('../src/projections.js');

    const wkt = await fetchProjection(31370, { fetch: respondWith(ESRI_WKT) });
    registerProjections({ 31370: wkt });

    expect(getProjection(31370)).toBe(ESRI_WKT);
  });
});
