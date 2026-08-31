import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue';
import maplibregl, { Map as MapLibreMap, Popup } from 'maplibre-gl';

import type { MapLayer } from '../types';

/**
 * A basemap that needs no API key.
 *
 * OpenStreetMap raster tiles are fine for a demo; anything with real traffic
 * should use a provider, per the OSM tile usage policy.
 */
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/**
 * Owns the MapLibre instance and keeps it in sync with the layer registry.
 *
 * The map is held in a `shallowRef`: it is a large mutable object with its own
 * internal state, and making it deeply reactive would be both pointless and
 * slow.
 */
export function useMapLibre(container: Ref<HTMLElement | undefined>, layers: Ref<MapLayer[]>) {
  const map = shallowRef<MapLibreMap>();
  const ready = ref(false);

  function initialize(): void {
    if (!container.value || map.value) return;

    const instance = new MapLibreMap({
      container: container.value,
      style: STYLE,
      center: [-73.9691, 40.7794],
      zoom: 13,
      attributionControl: { compact: true },
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    instance.on('load', () => {
      ready.value = true;
      syncLayers();
    });

    map.value = instance;
  }

  /** MapLibre layer ids derived from a registry id. */
  function idsFor(layer: MapLayer): string[] {
    switch (layer.kind) {
      case 'polygon':
        return [`${layer.id}-fill`, `${layer.id}-outline`];
      case 'line':
        return [`${layer.id}-line`];
      default:
        return [`${layer.id}-circle`];
    }
  }

  function addToMap(instance: MapLibreMap, layer: MapLayer): void {
    instance.addSource(layer.id, { type: 'geojson', data: layer.geojson as never });

    if (layer.kind === 'polygon') {
      instance.addLayer({
        id: `${layer.id}-fill`,
        type: 'fill',
        source: layer.id,
        paint: { 'fill-color': layer.color, 'fill-opacity': 0.35 },
      });
      instance.addLayer({
        id: `${layer.id}-outline`,
        type: 'line',
        source: layer.id,
        paint: { 'line-color': layer.color, 'line-width': 2 },
      });
    } else if (layer.kind === 'line') {
      instance.addLayer({
        id: `${layer.id}-line`,
        type: 'line',
        source: layer.id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': layer.color, 'line-width': 3 },
      });
    } else {
      instance.addLayer({
        id: `${layer.id}-circle`,
        type: 'circle',
        source: layer.id,
        paint: {
          'circle-radius': 7,
          'circle-color': layer.color,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    for (const id of idsFor(layer)) {
      instance.on('click', id, (event) => showPopup(instance, event));
      instance.on('mouseenter', id, () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', id, () => {
        instance.getCanvas().style.cursor = '';
      });
    }
  }

  function showPopup(instance: MapLibreMap, event: maplibregl.MapLayerMouseEvent): void {
    const feature = event.features?.[0];
    if (!feature) return;

    const rows = Object.entries(feature.properties ?? {})
      .map(
        ([key, value]) =>
          `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`,
      )
      .join('');

    new Popup({ closeButton: true, maxWidth: '320px' })
      .setLngLat(event.lngLat)
      .setHTML(`<table class="popup">${rows || '<tr><td>No attributes</td></tr>'}</table>`)
      .addTo(instance);
  }

  /** Adds, removes and toggles map layers to match the registry. */
  function syncLayers(): void {
    const instance = map.value;
    if (!instance || !ready.value) return;

    const wanted = new Set(layers.value.map((layer) => layer.id));

    // Remove sources the registry no longer has. Reading them off the style
    // means an imported layer that is dropped really does disappear.
    for (const sourceId of Object.keys(instance.getStyle().sources)) {
      if (sourceId !== 'osm' && !wanted.has(sourceId)) {
        for (const styleLayer of instance.getStyle().layers) {
          if ('source' in styleLayer && styleLayer.source === sourceId) {
            instance.removeLayer(styleLayer.id);
          }
        }
        instance.removeSource(sourceId);
      }
    }

    for (const layer of layers.value) {
      if (!instance.getSource(layer.id)) {
        addToMap(instance, layer);
      }
      for (const id of idsFor(layer)) {
        if (instance.getLayer(id)) {
          instance.setLayoutProperty(id, 'visibility', layer.visible ? 'visible' : 'none');
        }
      }
    }
  }

  /** Eases the camera to a `[west, south, east, north]` box. */
  function fitBounds(bounds: [number, number, number, number] | null): void {
    if (!map.value || !bounds) return;

    map.value.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 64, duration: 900, maxZoom: 17 },
    );
  }

  watch(layers, syncLayers, { deep: true });

  onBeforeUnmount(() => {
    map.value?.remove();
    map.value = undefined;
    ready.value = false;
  });

  return { map, ready, initialize, fitBounds, syncLayers };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
