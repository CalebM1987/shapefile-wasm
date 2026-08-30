/**
 * Write-then-read tests. These are the strongest correctness signal available
 * without shipping binary fixtures: they prove the bytes we emit are the bytes
 * a reader understands.
 */
import { describe, expect, it } from 'vitest';

import { readShapefile, writeShapefile } from '../src/index.js';
import type { FeatureCollection, GeoJsonInput } from '../src/types.js';
import { CITIES, DONUT, ROUTE, TWO_DONUTS, signedArea } from './fixtures.js';

async function roundTrip(
  input: GeoJsonInput,
  options: Parameters<typeof writeShapefile>[1] = {},
  readOptions: Parameters<typeof readShapefile>[1] = {},
): Promise<FeatureCollection> {
  const parts = await writeShapefile(input, options);
  return readShapefile({ shp: parts.shp, dbf: parts.dbf, cpg: parts.cpg }, readOptions);
}

describe('attributes', () => {
  it('preserves strings, numbers and booleans', async () => {
    const output = await roundTrip(CITIES);
    const properties = output.features[0]!.properties!;

    expect(properties.name).toBe('San Francisco');
    expect(properties.pop).toBe(873965);
    expect(properties.coastal).toBe(true);
  });

  it('preserves property order', async () => {
    const output = await roundTrip({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { zebra: 1, apple: 2, mango: 3 },
    } as never);

    expect(Object.keys(output.features[0]!.properties!)).toEqual(['zebra', 'apple', 'mango']);
  });

  it('trims the padding dBase adds to fixed-width text', async () => {
    const output = await roundTrip([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { name: 'ab' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { name: 'a considerably longer value' },
      },
    ] as never);

    expect(output.features[0]!.properties!.name).toBe('ab');
  });

  it('does not leave padding on short values in a wide column', async () => {
    // The column is sized to the longest value, so short ones are stored padded
    // out to that width. Trimming is unconditional in the underlying reader.
    const output = await roundTrip([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { name: 'ab' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { name: 'a considerably longer value' },
      },
    ] as never);

    expect(output.features[0]!.properties!.name).toBe('ab');
    expect(output.features[1]!.properties!.name).toBe('a considerably longer value');
  });

  it('survives non-ASCII text through the UTF-8 .dbf', async () => {
    const output = await roundTrip({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { name: 'Ærøskøbing', note: '日本語', emoji: '🛰' },
    } as never);

    const properties = output.features[0]!.properties!;
    expect(properties.name).toBe('Ærøskøbing');
    expect(properties.note).toBe('日本語');
    expect(properties.emoji).toBe('🛰');
  });

  it('keeps fractional precision', async () => {
    const output = await roundTrip({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { ratio: 0.123456789 },
    } as never);

    expect(output.features[0]!.properties!.ratio).toBeCloseTo(0.123456789, 9);
  });

  it('round-trips negative and zero values', async () => {
    const output = await roundTrip({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { below: -42.5, zero: 0 },
    } as never);

    expect(output.features[0]!.properties!.below).toBe(-42.5);
    expect(output.features[0]!.properties!.zero).toBe(0);
  });

  it('represents a missing value as null, not as an empty string', async () => {
    const output = await roundTrip([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { count: 1 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: {},
      },
    ] as never);

    expect(output.features[1]!.properties!.count).toBeNull();
  });
});

describe('geometry', () => {
  it('round-trips point coordinates exactly', async () => {
    const output = await roundTrip(CITIES);
    expect(output.features[0]!.geometry).toEqual({
      type: 'Point',
      coordinates: [-122.4194, 37.7749],
    });
  });

  it('keeps a single-part line as a LineString', async () => {
    const output = await roundTrip({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    } as never);

    expect(output.features[0]!.geometry!.type).toBe('LineString');
  });

  it('keeps a multi-part line as a MultiLineString', async () => {
    const output = await roundTrip(ROUTE);
    const geometry = output.features[0]!.geometry as { type: string; coordinates: unknown[] };

    expect(geometry.type).toBe('MultiLineString');
    expect(geometry.coordinates).toHaveLength(2);
  });

  it('preserves a polygon hole', async () => {
    const output = await roundTrip(DONUT);
    const geometry = output.features[0]!.geometry as { type: string; coordinates: number[][][] };

    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates).toHaveLength(2);
  });

  it('attaches each hole to the ring that actually contains it', async () => {
    // A shapefile stores rings in one flat list with no nesting, so the reader
    // has to work out which exterior each hole belongs to.
    const output = await roundTrip(TWO_DONUTS);
    const geometry = output.features[0]!.geometry as {
      type: string;
      coordinates: number[][][][];
    };

    expect(geometry.type).toBe('MultiPolygon');
    expect(geometry.coordinates).toHaveLength(2);

    for (const polygon of geometry.coordinates) {
      expect(polygon).toHaveLength(2);
      const exteriorX = polygon[0]![0]![0]!;
      const holeX = polygon[1]![0]![0]!;
      // The two squares are 100 units apart; a mis-assigned hole is obvious.
      expect(Math.abs(exteriorX - holeX)).toBeLessThan(50);
    }
  });

  it('returns rings in RFC 7946 winding order', async () => {
    // GeoJSON wants exteriors counter-clockwise and holes clockwise; shapefiles
    // use the opposite convention, so the reader rewinds them.
    const output = await roundTrip(DONUT);
    const rings = (output.features[0]!.geometry as { coordinates: number[][][] }).coordinates;

    expect(signedArea(rings[0]!)).toBeGreaterThan(0);
    expect(signedArea(rings[1]!)).toBeLessThan(0);
  });

  it('closes polygon rings', async () => {
    const output = await roundTrip(DONUT);
    const rings = (output.features[0]!.geometry as { coordinates: number[][][] }).coordinates;

    for (const ring of rings) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it('collapses a MultiPolygon into one record and back', async () => {
    const output = await roundTrip(TWO_DONUTS);
    expect(output.features).toHaveLength(1);
  });

  it('round-trips a multipoint', async () => {
    const output = await roundTrip({
      type: 'MultiPoint',
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    } as never);

    const geometry = output.features[0]!.geometry as { type: string; coordinates: number[][] };
    expect(geometry.type).toBe('MultiPoint');
    expect(geometry.coordinates).toHaveLength(3);
  });
});

describe('dimensions', () => {
  it('preserves Z', async () => {
    const output = await roundTrip({ type: 'Point', coordinates: [1, 2, 3.5] } as never);
    expect(output.features[0]!.geometry).toEqual({
      type: 'Point',
      coordinates: [1, 2, 3.5],
    });
  });

  it('drops M by default, because GeoJSON has no measures', async () => {
    const output = await roundTrip({ type: 'Point', coordinates: [1, 2, 3, 4] } as never);
    const coordinates = (output.features[0]!.geometry as { coordinates: number[] }).coordinates;

    expect(coordinates).toEqual([1, 2, 3]);
  });

  it('emits M as a fourth ordinate when asked', async () => {
    const output = await roundTrip(
      { type: 'Point', coordinates: [1, 2, 3, 4] } as never,
      {},
      { includeM: true },
    );
    const coordinates = (output.features[0]!.geometry as { coordinates: number[] }).coordinates;

    expect(coordinates).toEqual([1, 2, 3, 4]);
  });

  it('preserves Z along a line', async () => {
    const output = await roundTrip({
      type: 'LineString',
      coordinates: [
        [0, 0, 10],
        [1, 1, 20],
      ],
    } as never);

    expect((output.features[0]!.geometry as { coordinates: number[][] }).coordinates).toEqual([
      [0, 0, 10],
      [1, 1, 20],
    ]);
  });
});

describe('reading without a .dbf', () => {
  it('returns geometry with empty properties', async () => {
    const parts = await writeShapefile(CITIES);
    const output = await readShapefile({ shp: parts.shp });

    expect(output.features).toHaveLength(3);
    expect(output.features[0]!.geometry!.type).toBe('Point');
    expect(output.features[0]!.properties).toEqual({});
  });
});

describe('scale', () => {
  it('handles a few thousand features without losing any', async () => {
    const features = Array.from({ length: 2500 }, (_, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [i / 100, -i / 100] },
      properties: { index: i, label: `point-${i}` },
    }));

    const parts = await writeShapefile({ type: 'FeatureCollection', features } as never);
    expect(parts.featureCount).toBe(2500);

    const output = await readShapefile({ shp: parts.shp, dbf: parts.dbf });
    expect(output.features).toHaveLength(2500);
    expect(output.features[2499]!.properties!.index).toBe(2499);
    expect(output.features[2499]!.properties!.label).toBe('point-2499');
  });
});
