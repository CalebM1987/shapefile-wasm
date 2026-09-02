<script setup lang="ts">
import { onMounted, ref } from 'vue';

import LayerList from './components/LayerList.vue';
import ExportPanel from './components/ExportPanel.vue';
import ImportDropZone from './components/ImportDropZone.vue';
import { useLayers } from './composables/useLayers';
import { useMapLibre } from './composables/useMapLibre';
import type { MapLayer } from './types';

const mapContainer = ref<HTMLElement>();

const { layers, featureCount, loadSamples, boundsOf } = useLayers();
const { initialize, fitBounds } = useMapLibre(mapContainer, layers);

onMounted(() => {
  loadSamples();
  initialize();
  // The map fits once it has laid out; the samples are already registered.
  requestAnimationFrame(() => fitBounds(boundsOf()));
});

function zoomTo(layer: MapLayer): void {
  fitBounds(boundsOf([layer]));
}

function zoomToAll(): void {
  fitBounds(boundsOf());
}

/** Imported layers are the interesting thing on screen, so go to them. */
function onImported(imported: MapLayer[]): void {
  fitBounds(boundsOf(imported));
}
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <header class="brand">
        <h1>shapefile-wasm</h1>
        <p>
          ESRI Shapefiles in the browser, from GeoJSON. Rust compiled to WebAssembly — no server
          round-trip.
        </p>
        <p class="stats">
          {{ layers.length }} layer{{ layers.length === 1 ? '' : 's' }} · {{ featureCount }} features
        </p>
      </header>

      <LayerList @zoom="zoomTo" @zoom-all="zoomToAll" />
      <ExportPanel />
      <ImportDropZone @imported="onImported" />

      <footer class="foot">
        <a href="https://github.com/CalebM1987/shapefile-wasm">Source</a>
        ·
        <a href="https://www.npmjs.com/package/@crmackey/shapefile-wasm">npm</a>
      </footer>
    </aside>

    <main ref="mapContainer" class="map" aria-label="Map"></main>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100%;
}

.sidebar {
  overflow-y: auto;
  border-right: 1px solid var(--edge);
  background: var(--bg);
  padding: 1rem;
  display: grid;
  gap: 1rem;
  align-content: start;
}

.brand h1 {
  font-size: 1.05rem;
  margin: 0 0 0.35rem;
  letter-spacing: -0.01em;
}

.brand p {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.5;
}

.stats {
  margin-top: 0.4rem !important;
  font-variant-numeric: tabular-nums;
}

.map {
  position: relative;
  min-height: 0;
}

.foot {
  font-size: 0.78rem;
  color: var(--muted);
}

@media (max-width: 860px) {
  .app {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 55vh;
  }

  .sidebar {
    order: 2;
    border-right: none;
    border-top: 1px solid var(--edge);
  }

  .map {
    order: 1;
    min-height: 45vh;
  }
}
</style>
