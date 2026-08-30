# In the browser

Everything that touches the DOM lives in `@crmackey/shapefile-wasm/browser`,
so the core stays importable from Node, workers and SSR.

```ts
import {
  downloadShapefileZip,
  readShapefileFile,
  triggerDownload,
} from '@crmackey/shapefile-wasm/browser';
```

## Exporting to a download

```ts
exportButton.addEventListener('click', async () => {
  await downloadShapefileZip(featureCollection, {
    fileName: 'survey-points',
    epsg: 26915,
  });
});
```

The archive bytes are returned as well, so you can upload the same file without
building it twice:

```ts
const zip = await downloadShapefileZip(data, { fileName: 'parcels' });
await fetch('/api/archive', { method: 'POST', body: zip });
```

## Importing from a file picker

```ts
const input = document.querySelector('input[type=file]')!;

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  const layers = await readShapefileFile(file);

  for (const layer of layers) {
    map.addSource(layer.name, { type: 'geojson', data: layer.geojson });
  }
});
```

Works with a `File` from a picker, a `File` from a drop event, or any `Blob`.

### Drag and drop

```ts
dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (!file) return;

  const layers = await readShapefileFile(file);
});
```

## Saving arbitrary bytes

```ts
triggerDownload(bytes, 'export.zip');
triggerDownload(pngBytes, 'map.png', 'image/png');
```

It creates a temporary object URL, clicks a hidden anchor, removes it, and
revokes the URL on the next tick — revoking synchronously cancels the download in
some browsers.

Outside a browser it throws with a message pointing at `fs.writeFile`, rather
than failing in some confusing way.

## Keeping the UI responsive

Conversion is synchronous inside WebAssembly. A few thousand features is fast,
but a very large dataset will block the main thread. Move it to a worker:

::: code-group
```ts [worker.ts]
import { writeShapefileZip } from '@crmackey/shapefile-wasm';

self.onmessage = async (event) => {
  const zip = await writeShapefileZip(event.data.geojson, event.data.options);
  self.postMessage(zip, [zip.buffer]);
};
```
```ts [main.ts]
import { triggerDownload } from '@crmackey/shapefile-wasm/browser';

const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
});

worker.onmessage = (event) => triggerDownload(event.data, 'export.zip');
worker.postMessage({ geojson, options: { fileName: 'export', epsg: 4326 } });
```
:::

The core entry point works unmodified in a worker — no DOM, no configuration.

## Framework notes

**Next.js / SSR.** Import the core anywhere; import `/browser` only in client
components. The core never references `document` or `window`.

**Vite.** Nothing to configure for the root entry. For `/slim`, `?url` gives you
the asset URL as shown in [Entry points](/guide/entry-points).

**Content Security Policy.** WebAssembly compilation needs `'wasm-unsafe-eval'`
in your `script-src`. This is a distinct, narrower permission than
`'unsafe-eval'` and does not enable JavaScript `eval`.
