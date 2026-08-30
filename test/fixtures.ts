/** Shared GeoJSON fixtures. Kept small and explicit so failures are readable. */
import type { Feature, FeatureCollection } from '../src/types.js';

/** Three cities with a string, a number and a boolean attribute each. */
export const CITIES: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
      properties: { name: 'San Francisco', pop: 873965, coastal: true },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
      properties: { name: 'New York', pop: 8336817, coastal: true },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-93.265, 44.9778] },
      properties: { name: 'Minneapolis', pop: 429954, coastal: false },
    },
  ],
};

/** A square with a square hole punched out of the middle. */
export const DONUT: Feature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [3, 3],
        [3, 6],
        [6, 6],
        [6, 3],
        [3, 3],
      ],
    ],
  },
  properties: { label: 'donut' },
};

/** Two disjoint squares, each with its own hole, given far apart on purpose. */
export const TWO_DONUTS: Feature = {
  type: 'Feature',
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [2, 4],
          [4, 4],
          [4, 2],
          [2, 2],
        ],
      ],
      [
        [
          [100, 100],
          [110, 100],
          [110, 110],
          [100, 110],
          [100, 100],
        ],
        [
          [102, 102],
          [102, 104],
          [104, 104],
          [104, 102],
          [102, 102],
        ],
      ],
    ],
  },
  properties: { label: 'pair' },
};

/** A two-part line. */
export const ROUTE: Feature = {
  type: 'Feature',
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      [
        [5, 5],
        [6, 6],
      ],
    ],
  },
  properties: { road: 'MN-7', lanes: 2 },
};

/** Shoelace formula. Positive means counter-clockwise. */
export function signedArea(ring: number[][]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    total += (b[0]! - a[0]!) * (b[1]! + a[1]!);
  }
  return -total;
}

/** Reads a big-endian 32-bit integer, the byte order shapefile headers use. */
export function readInt32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, false);
}

/** Reads a little-endian 32-bit integer, the byte order shapefile records use. */
export function readInt32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);
}
