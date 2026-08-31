import { computed, ref } from 'vue';
import bbox from '@turf/bbox';
import type { FeatureCollection } from '@crmackey/shapefile-wasm';

import { detectKind, type LayerKind, type MapLayer } from '../types';
import { PARK_LANDMARKS, PARK_TRAILS, PARK_ZONES } from '../data/samples';

/** Colours cycle through this palette as layers are added. */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2'];

const KIND_COLOR: Record<LayerKind, string> = {
  point: '#2563eb',
  line: '#d97706',
  polygon: '#16a34a',
};

/**
 * The layer registry: everything on the map, and what is selected for export.
 *
 * Deliberately a singleton created at module scope. The map, the export panel
 * and the drop zone all read and write the same list, and passing it through
 * props would mean threading it through every component.
 */
const layers = ref<MapLayer[]>([]);
let counter = 0;

function nextId(name: string): string {
  counter += 1;
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${counter}`;
}

export function useLayers() {
  /** Adds a layer, deriving its geometry kind and colour. */
  function addLayer(
    name: string,
    geojson: FeatureCollection,
    origin: MapLayer['origin'] = 'imported',
  ): MapLayer {
    const kind = detectKind(geojson);

    const layer: MapLayer = {
      id: nextId(name),
      name,
      geojson,
      kind,
      color:
        origin === 'sample'
          ? KIND_COLOR[kind]
          : (PALETTE[layers.value.length % PALETTE.length] ?? PALETTE[0]!),
      visible: true,
      selected: true,
      origin,
    };

    layers.value.push(layer);
    return layer;
  }

  function removeLayer(id: string): void {
    layers.value = layers.value.filter((layer) => layer.id !== id);
  }

  function clearImported(): void {
    layers.value = layers.value.filter((layer) => layer.origin === 'sample');
  }

  /** Loads the three Central Park samples. Idempotent. */
  function loadSamples(): void {
    if (layers.value.some((layer) => layer.origin === 'sample')) return;

    addLayer('ParkLandmarks', PARK_LANDMARKS, 'sample');
    addLayer('ParkTrails', PARK_TRAILS, 'sample');
    addLayer('ParkZones', PARK_ZONES, 'sample');
  }

  /**
   * The bounding box of the given layers as `[west, south, east, north]`.
   *
   * Returns null when there is nothing to measure, so callers can skip the
   * camera move rather than fly to NaN.
   */
  function boundsOf(subset: MapLayer[] = layers.value): [number, number, number, number] | null {
    const withFeatures = subset.filter((layer) => layer.geojson.features.length > 0);
    if (withFeatures.length === 0) return null;

    const merged: FeatureCollection = {
      type: 'FeatureCollection',
      features: withFeatures.flatMap((layer) => layer.geojson.features),
    };

    const [west, south, east, north] = bbox(merged as never);

    // A single point produces a zero-area box, which some fitBounds
    // implementations dislike. Pad it slightly.
    if (west === east && south === north) {
      const pad = 0.002;
      return [west - pad, south - pad, east + pad, north + pad];
    }

    return [west, south, east, north];
  }

  const selected = computed(() => layers.value.filter((layer) => layer.selected));
  const featureCount = computed(() =>
    layers.value.reduce((total, layer) => total + layer.geojson.features.length, 0),
  );

  return {
    layers,
    selected,
    featureCount,
    addLayer,
    removeLayer,
    clearImported,
    loadSamples,
    boundsOf,
  };
}
