import type { FeatureCollection } from '@crmackey/shapefile-wasm';

/** The geometry families the demo styles differently on the map. */
export type LayerKind = 'point' | 'line' | 'polygon';

/** A layer the user can see, toggle, export, or have imported for them. */
export interface MapLayer {
  /** Stable id, also used for the MapLibre source and layer ids. */
  id: string;
  /** Display name, and the base name used inside an exported archive. */
  name: string;
  geojson: FeatureCollection;
  kind: LayerKind;
  /** Hex colour used for the map styling and the legend swatch. */
  color: string;
  /** Drawn on the map. */
  visible: boolean;
  /** Included in the next export. */
  selected: boolean;
  /** Where it came from, so imported layers can be told apart. */
  origin: 'sample' | 'imported';
}

/** Whatever `geojson` we are handed, reduced to one of our three kinds. */
export function detectKind(geojson: FeatureCollection): LayerKind {
  const type = geojson.features.find((feature) => feature.geometry)?.geometry?.type;

  switch (type) {
    case 'LineString':
    case 'MultiLineString':
      return 'line';
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon';
    default:
      return 'point';
  }
}
