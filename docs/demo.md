---
title: Live demo
---

<script setup>
// The app is a separate build staged into the site, so its URL has to carry the
// docs base. A literal "/app/..." would break on GitHub Pages, which serves the
// site from /<repo>/.
import { withBase } from 'vitepress'
const appUrl = withBase('/app/index.html')
</script>

# Live demo

<div class="demo-frame">
  <iframe
    :src="appUrl"
    title="shapefile-wasm interactive demo"
    loading="lazy"
    allow="clipboard-write"
  ></iframe>
</div>

<p style="text-align:center">
  <a :href="appUrl" target="_blank" rel="noreferrer">Open the demo in a new tab →</a>
</p>

Everything below happens in your browser. There is no server: the GeoJSON is
converted to shapefile bytes by the WebAssembly module, zipped with `fflate`, and
handed to the browser's download machinery.

## What to try

**Export the sample layers.** Three layers around Central Park — points, lines
and polygons. A shapefile holds one geometry type, which is exactly why three
layers produce three sets of files. Switch the **layout** to see how the archive
is arranged:

| Layout | Produces |
| --- | --- |
| Flat | `ParkTrails.shp`, `ParkZones.shp`, … all at the root |
| Folders | `ParkTrails/ParkTrails.shp`, … |
| Nested zips | `ParkTrails.zip`, `ParkZones.zip`, … |

**Then drag the archive you just downloaded back onto the drop zone.** It reads
back and zooms to the features — including the nested layout, which is an
archive of archives.

**Watch the field names.** `restricted_access` is 17 characters and dBase caps
field names at 11 bytes, so the export reports what it was renamed to. That
mapping is returned to you rather than left to be discovered in a GIS later.

## The code behind it

The demo is a Vite + Vue 3 app using the Composition API. The whole export is
this:

```ts
import { writeLayers, zipLayers } from '@crmackey/shapefile-wasm';
import { triggerDownload } from '@crmackey/shapefile-wasm/browser';

const written = await writeLayers(
  selected.value.map((layer) => ({
    name: layer.name,
    geojson: layer.geojson,
    epsg: 4326,
  })),
);

const zip = zipLayers(written, { layout: options.layout });
triggerDownload(zip, 'central-park.zip');
```

And the import, from a dropped `File`:

```ts
import { readShapefileFile } from '@crmackey/shapefile-wasm/browser';

const layers = await readShapefileFile(file);
for (const layer of layers) {
  map.addSource(layer.name, { type: 'geojson', data: layer.geojson });
}
```

The source is in [`demo/`](https://github.com/CalebM1987/shapefile-wasm/tree/main/demo).

<style>
.demo-frame {
  position: relative;
  width: 100%;
  height: min(78vh, 720px);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  margin: 1.5rem 0 0.75rem;
  background: var(--vp-c-bg-alt);
}

.demo-frame iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
