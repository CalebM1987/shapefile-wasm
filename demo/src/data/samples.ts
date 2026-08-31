import type { FeatureCollection } from '@crmackey/shapefile-wasm';

/**
 * Three sample layers around Central Park, one per geometry family.
 *
 * A shapefile holds exactly one geometry type, which is the whole reason the
 * export produces three files rather than one — the demo is built around that
 * constraint deliberately.
 */

export const PARK_LANDMARKS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        id: 'POI_001',
        name: 'Belvedere Castle',
        amenity: 'visitor_center',
        elevation_m: 40,
      },
      geometry: { type: 'Point', coordinates: [-73.9691, 40.7794] },
    },
    {
      type: 'Feature',
      properties: {
        id: 'POI_002',
        name: 'Bethesda Fountain',
        amenity: 'fountain',
        elevation_m: 22,
      },
      geometry: { type: 'Point', coordinates: [-73.9711, 40.7737] },
    },
  ],
};

export const PARK_TRAILS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        id: 'TRL_101',
        name: 'Castle Trail Loop',
        surface: 'gravel',
        length_km: 1.2,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-73.9711, 40.7737],
          [-73.9705, 40.775],
          [-73.9691, 40.7794],
          [-73.97, 40.7805],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        id: 'TRL_102',
        name: 'Reservoir Loop Pathway',
        surface: 'asphalt',
        length_km: 2.5,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-73.9691, 40.7794],
          [-73.965, 40.782],
          [-73.962, 40.785],
        ],
      },
    },
  ],
};

export const PARK_ZONES: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        id: 'ZONE_201',
        name: 'The Great Lawn',
        landuse: 'recreation_ground',
        restricted_access: false,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-73.968, 40.78],
            [-73.964, 40.782],
            [-73.966, 40.7845],
            [-73.97, 40.7825],
            [-73.968, 40.78],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: {
        id: 'ZONE_202',
        name: 'The Lake',
        landuse: 'reservoir',
        restricted_access: true,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-73.973, 40.774],
            [-73.97, 40.775],
            [-73.971, 40.777],
            [-73.974, 40.7755],
            [-73.973, 40.774],
          ],
        ],
      },
    },
  ],
};
