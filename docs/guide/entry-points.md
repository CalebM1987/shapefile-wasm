# Entry points

The package ships several subpaths so you only pull in what you use.

| Import | Contents |
| --- | --- |
| `@crmackey/shapefile-wasm` | Core API, WebAssembly binary embedded |
| `@crmackey/shapefile-wasm/slim` | Same API, no embedded binary |
| `@crmackey/shapefile-wasm/browser` | DOM helpers: download, file input |
| `@crmackey/shapefile-wasm/projections` | The raw EPSG table |
| `@crmackey/shapefile-wasm/wasm` | The `.wasm` file itself |

## Root: zero configuration

```ts
import { writeShapefileZip } from '@crmackey/shapefile-wasm';
```

The binary is embedded as base64. Nothing to copy, nothing to serve, no bundler
plugin — it works the same in Vite, webpack, Next.js, plain Node and a worker.

The cost is roughly a third more bytes than the raw `.wasm`, plus a base64 decode
before compilation. The blob is behind a dynamic import, so it is only fetched
when you actually convert something.

## Slim: stream the binary

When you can serve the `.wasm` as its own asset, this is the better trade — it is
smaller and the browser compiles it while it downloads.

```ts
import { init, writeShapefileZip } from '@crmackey/shapefile-wasm/slim';
import wasmUrl from '@crmackey/shapefile-wasm/wasm?url'; // Vite

await init(wasmUrl);
const zip = await writeShapefileZip(data);
```

::: warning init() is required here
`/slim` has no binary to fall back on. Calling anything before `init()` throws
with an explanation.
:::

In Node, hand it bytes:

```ts
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { init } from '@crmackey/shapefile-wasm/slim';

const require = createRequire(import.meta.url);
await init(await readFile(require.resolve('@crmackey/shapefile-wasm/wasm')));
```

`init` accepts a URL string or `URL`, a `Response`, an `ArrayBuffer` or
`Uint8Array`, or an already-compiled `WebAssembly.Module`.

## Browser: DOM helpers

Kept separate so the core never touches `document` — which is what makes it safe
in Node, in workers, and during server-side rendering.

```ts
import { downloadShapefileZip } from '@crmackey/shapefile-wasm/browser';
```

See [In the browser](/guide/browser).

## Projections: the raw table

Normally unnecessary — the table loads on demand. Import it directly to bundle it
eagerly or to inspect it:

```ts
import { epsgProjections } from '@crmackey/shapefile-wasm/projections';

Object.keys(epsgProjections).length; // 116
```

## Controlling when the module loads

Instantiation costs roughly 50 ms. Pay it somewhere the user is already waiting:

```ts
import { init, isReady } from '@crmackey/shapefile-wasm';

// During app startup, behind a splash screen.
void init();

// Later, if you need to know.
if (!isReady()) showSpinner();
```

`init()` is idempotent — later calls await the same instantiation. A failure is
not cached, so a transient network error can be retried.
