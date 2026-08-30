# Projections

The `.prj` file records the coordinate system as ESRI WKT. Without one, software
has to guess — and usually guesses WGS 84.

## By EPSG code

```ts
await writeShapefileZip(data, { fileName: 'parcels', epsg: 26915 });
```

Four codes are compiled into the main bundle:

| Code | System |
| --- | --- |
| `4326` | WGS 84 |
| `4269` | NAD83 |
| `6318` | NAD83 (2011) |
| `3857` | WGS 84 / Pseudo-Mercator |

Beyond those, a bundled table of **116 definitions** — US UTM zones, NAD83 State
Plane, and the global basics — is imported automatically the first time you name
a code that is not already loaded.

You do not have to do anything to enable it, and bundlers keep it out of your
initial chunk because it is a dynamic import.

## Loading the table eagerly

[`getProjection`](/reference/index/functions/getProjection) is synchronous, so it
only sees what is already loaded. Force the table in if you want to query it:

```ts
import { loadProjectionTable, getProjection } from '@crmackey/shapefile-wasm';

await loadProjectionTable();
getProjection(26915); // 'PROJCS["NAD_1983_UTM_Zone_15N", ... ]'
```

## Custom definitions

For a local grid, an in-house system, or anything without an EPSG code:

```ts
import { registerProjections } from '@crmackey/shapefile-wasm';

registerProjections({
  900914: 'PROJCS["Hennepin County Grid", ... ]',
});

await writeShapefileZip(data, { epsg: 900914 });
```

Registered definitions also **override** built-in ones, which is useful when your
organisation standardises on a particular WKT spelling.

For a one-off, skip the registry:

```ts
await writeShapefileZip(data, { wkt: 'PROJCS["Site Grid", ... ]' });
```

`wkt` always beats `epsg`.

## Unknown codes throw

```ts
await writeShapefileZip(data, { epsg: 999999 });
// Error: EPSG:999999 is not in the projection table. Supply the definition
// yourself with registerProjections({ 999999: '<esri wkt>' }), or pass the
// WKT directly via { wkt }.
```

This is deliberate. Silently omitting the `.prj` produces data that looks
completely fine until someone opens it in the wrong coordinate system — a much
worse failure than an export that stops and tells you.

## Where the definitions come from

They are scraped from [epsg.io](https://epsg.io) at authoring time by
`npm run projections`, written into `src/generated/projections.ts`, and
**committed**.

The published package never makes a network request. A `.prj` fetched at runtime
can fail quietly and leave an export with no projection at all, and builds should
not depend on a free service staying reachable.

To add codes, edit the `CODES` list in `scripts/fetch-projections.mjs` and re-run
`npm run projections`.

## Fetching from epsg.io

For a code outside the bundled table, `fetchProjection` looks one up at runtime
using the native `fetch`:

```ts
import { fetchProjection, writeShapefileZip } from '@crmackey/shapefile-wasm';

const wkt = await fetchProjection(2027);
await writeShapefileZip(data, { fileName: 'parcels', wkt });
```

Fetch once and register it, and every later export is offline again:

```ts
import { fetchProjection, registerProjections } from '@crmackey/shapefile-wasm';

registerProjections({ 2027: await fetchProjection(2027) });
await writeShapefileZip(data, { epsg: 2027 });
```

### Formats

| Value | URL | What it is |
| --- | --- | --- |
| `esri-wkt` *(default)* | `epsg.io/<code>.esriwkt` | What a `.prj` expects, and what ArcGIS reads most reliably |
| `wkt` | `epsg.io/<code>.wkt` | OGC WKT 1. Widely understood, carries `AUTHORITY` nodes |
| `wkt2` | `epsg.io/<code>.wkt2` | ISO 19162 WKT 2. The modern standard; older GIS cannot read it |

```ts
const wkt2 = await fetchProjection(26915, { format: 'wkt2' });
```

::: warning Only esri-wkt belongs in a .prj
WKT 2 is the better standard, but a `.prj` containing it will confuse a lot of
GIS software. Use `wkt2` for display or for handing to another library — not for
`registerProjections`.
:::

### Failure handling

Every failure throws an `Error` that names what went wrong:

| Situation | Message |
| --- | --- |
| Code does not exist | `epsg.io returned 404 Not Found for EPSG:999999` |
| Service unreachable | `could not reach https://epsg.io … usually CORS or an offline network` |
| Timed out | `the request for EPSG:4326 timed out after 10000ms` |
| Aborted by the caller | `the request for EPSG:4326 was aborted` |
| A proxy answered instead | `the body is not a projection … check for a proxy` |

The original failure is preserved on `cause`.

That last one is worth knowing about: on a corporate network a captive portal or
proxy can answer with its own page and a 200 status. Writing that HTML into a
`.prj` fails silently until someone opens the file in a GIS, so the body is
checked as well as the status.

### Options

```ts
await fetchProjection(26915, {
  format: 'esri-wkt',      // default
  timeoutMs: 10_000,       // default; 0 disables
  signal: controller.signal,
  baseUrl: 'https://epsg.io',   // a mirror, or a CORS proxy
  fetch: customFetch,      // for tests or a custom agent
});
```

::: tip Browser use
This is a cross-origin request. epsg.io sends permissive CORS headers, but if
your Content Security Policy restricts `connect-src`, add `https://epsg.io` to
it. Behind a strict proxy, point `baseUrl` at your own mirror.
:::

## What this does not do

It writes the `.prj` you ask for. It does not reproject coordinates — pair it
with [proj4js](https://github.com/proj4js/proj4js) if the numbers themselves need
converting.
