/** Writing GeoJSON out: file structure, schema inference and error handling. */
import { describe, expect, it } from 'vitest';

import { writeShapefile } from '../src/index.js';
import { CITIES, DONUT, ROUTE, readInt32BE, readInt32LE } from './fixtures.js';

describe('shapefile structure', () => {
  it('produces .shp and .shx with the shapefile magic number', async () => {
    const parts = await writeShapefile(CITIES);

    // 9994, big-endian, at byte 0 of both files.
    expect(readInt32BE(parts.shp, 0)).toBe(9994);
    expect(readInt32BE(parts.shx, 0)).toBe(9994);
  });

  it('writes a file length in the header that matches the actual bytes', async () => {
    const parts = await writeShapefile(CITIES);

    // Byte 24 is the file length in 16-bit words, big-endian.
    expect(readInt32BE(parts.shp, 24) * 2).toBe(parts.shp.length);
    expect(readInt32BE(parts.shx, 24) * 2).toBe(parts.shx.length);
  });

  it('writes an .shx with one 8-byte entry per record', async () => {
    const parts = await writeShapefile(CITIES);
    expect(parts.shx.length).toBe(100 + 3 * 8);
  });

  it('records the shape type in the header', async () => {
    const parts = await writeShapefile(CITIES);
    // Byte 32 is the shape type, little-endian. 1 is Point.
    expect(readInt32LE(parts.shp, 32)).toBe(1);
    expect(parts.shapeType).toBe('Point');
  });

  it('reports the bounding box of the data', async () => {
    const parts = await writeShapefile(CITIES);
    expect(parts.bbox).toEqual([-122.4194, 37.7749, -74.006, 44.9778]);
  });

  it('always writes UTF-8 and says so in the .cpg', async () => {
    const parts = await writeShapefile(CITIES);
    expect(parts.cpg).toBe('UTF-8');
  });
});

describe('geometry type resolution', () => {
  it.each([
    ['Point', { type: 'Point', coordinates: [0, 0] }, 'Point'],
    ['MultiPoint', { type: 'MultiPoint', coordinates: [[0, 0]] }, 'Multipoint'],
    [
      'LineString',
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      'Polyline',
    ],
    [
      'Polygon',
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      'Polygon',
    ],
  ])('maps GeoJSON %s to shapefile %s', async (_name, geometry, expected) => {
    const parts = await writeShapefile(geometry as never);
    expect(parts.shapeType).toBe(expected);
  });

  it('promotes mixed Point and MultiPoint to a single Multipoint file', async () => {
    const parts = await writeShapefile([
      { type: 'Point', coordinates: [0, 0] },
      {
        type: 'MultiPoint',
        coordinates: [
          [1, 1],
          [2, 2],
        ],
      },
    ] as never);

    expect(parts.shapeType).toBe('Multipoint');
    expect(parts.featureCount).toBe(2);
  });

  it('rejects genuinely incompatible geometry types', async () => {
    await expect(
      writeShapefile([
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      ] as never),
    ).rejects.toThrow(/single geometry type/);
  });

  it('honours an explicit shapeType over inference', async () => {
    const parts = await writeShapefile(CITIES, { shapeType: 'multipoint' });
    expect(parts.shapeType).toBe('Multipoint');
  });
});

describe('dimension handling', () => {
  it('defaults to 2D when coordinates carry only x and y', async () => {
    const parts = await writeShapefile(CITIES);
    expect(parts.dimensions).toBe('xy');
    expect(parts.shapeType).toBe('Point');
  });

  it('detects a third ordinate as Z', async () => {
    const parts = await writeShapefile({
      type: 'Point',
      coordinates: [1, 2, 3],
    } as never);
    expect(parts.dimensions).toBe('xyz');
    expect(parts.shapeType).toBe('PointZ');
  });

  it('detects a fourth ordinate as a measure', async () => {
    const parts = await writeShapefile({
      type: 'Point',
      coordinates: [1, 2, 3, 4],
    } as never);
    expect(parts.dimensions).toBe('xyzm');
  });

  it('can read the third ordinate as a measure instead of Z', async () => {
    const parts = await writeShapefile({ type: 'Point', coordinates: [1, 2, 3] } as never, {
      dimensions: 'xym',
    });
    expect(parts.dimensions).toBe('xym');
    expect(parts.shapeType).toBe('PointM');
  });

  it('can be forced back down to 2D, dropping Z', async () => {
    const parts = await writeShapefile({ type: 'Point', coordinates: [1, 2, 3] } as never, {
      dimensions: 'xy',
    });
    expect(parts.dimensions).toBe('xy');
    expect(parts.shapeType).toBe('Point');
  });

  it('uses the richest coordinate in the set, not the first', async () => {
    const parts = await writeShapefile([
      { type: 'Point', coordinates: [0, 0] },
      { type: 'Point', coordinates: [1, 1, 5] },
    ] as never);
    expect(parts.dimensions).toBe('xyz');
  });
});

describe('.dbf schema inference', () => {
  it('assigns a dBase type per property', async () => {
    const { fields } = await writeShapefile(CITIES);

    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ['name', 'character'],
      ['pop', 'numeric'],
      ['coastal', 'logical'],
    ]);
  });

  it('preserves the order properties first appeared in', async () => {
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { zebra: 1, apple: 2, mango: 3 },
    } as never);

    expect(fields.map((f) => f.name)).toEqual(['zebra', 'apple', 'mango']);
  });

  it('sizes character fields to the longest observed value', async () => {
    const { fields } = await writeShapefile(CITIES);
    expect(fields[0]!.width).toBe('San Francisco'.length);
  });

  it('sizes numeric fields to fit the widest value without cropping it', async () => {
    // dBase silently crops values that overrun their field, so the width has to
    // be derived from the data rather than guessed.
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { big: -123456789.125 },
    } as never);

    const field = fields[0]!;
    expect(field.type).toBe('numeric');
    expect(field.decimals).toBe(3);
    expect(field.width).toBeGreaterThanOrEqual('-123456789.125'.length);
  });

  it('falls back to text when a property holds more than one type', async () => {
    const { fields } = await writeShapefile([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { mixed: 1 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { mixed: 'text' },
      },
    ] as never);

    expect(fields[0]!.type).toBe('character');
  });

  it('serialises nested values rather than dropping them', async () => {
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { tags: ['a', 'b'] },
    } as never);

    expect(fields[0]!.type).toBe('character');
  });

  it('truncates field names to the 11-byte dBase limit', async () => {
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { a_very_long_property_name: 1 },
    } as never);

    expect(fields[0]!.source).toBe('a_very_long_property_name');
    expect(fields[0]!.name).toBe('a_very_long');
  });

  it('keeps truncated names unique', async () => {
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {
        measurement_one: 1,
        measurement_two: 2,
        measurement_three: 3,
      },
    } as never);

    const names = fields.map((f) => f.name);
    expect(new Set(names).size).toBe(3);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(11);
    }
  });

  it('prefixes names that would start with a digit', async () => {
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { '2020_pop': 1 },
    } as never);

    expect(fields[0]!.name).toMatch(/^[A-Za-z]/);
  });

  it('invents an FID column when there are no properties at all', async () => {
    // A .dbf with zero columns is rejected by many GIS readers.
    const { fields } = await writeShapefile({
      type: 'Point',
      coordinates: [0, 0],
    } as never);

    expect(fields).toHaveLength(1);
    expect(fields[0]!.name).toBe('FID');
  });

  it('respects maxFieldLength', async () => {
    const { fields } = await writeShapefile({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { note: 'x'.repeat(200) },
    } as never);
    expect(fields[0]!.width).toBe(200);

    const capped = await writeShapefile(
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { note: 'x'.repeat(200) },
      } as never,
      { maxFieldLength: 50 },
    );
    expect(capped.fields[0]!.width).toBe(50);
  });
});

describe('input handling', () => {
  it('accepts a FeatureCollection', async () => {
    expect((await writeShapefile(CITIES)).featureCount).toBe(3);
  });

  it('accepts a lone Feature', async () => {
    expect((await writeShapefile(DONUT)).featureCount).toBe(1);
  });

  it('accepts a bare geometry', async () => {
    expect((await writeShapefile(ROUTE.geometry as never)).featureCount).toBe(1);
  });

  it('accepts an array of features', async () => {
    expect((await writeShapefile(CITIES.features)).featureCount).toBe(3);
  });

  it('accepts a GeoJSON string, skipping a JS-side parse', async () => {
    expect((await writeShapefile(JSON.stringify(CITIES))).featureCount).toBe(3);
  });

  it('skips features with null geometry and counts them', async () => {
    const parts = await writeShapefile({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: null, properties: { name: 'nowhere' } },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: { name: 'somewhere' },
        },
      ],
    } as never);

    expect(parts.featureCount).toBe(1);
    expect(parts.skippedCount).toBe(1);
    // The .shx must agree, or the .shp and .dbf would be misaligned.
    expect(parts.shx.length).toBe(100 + 8);
  });

  it('treats missing properties as null rather than failing', async () => {
    // dbase errors on a record that omits a declared field, so ragged input has
    // to be padded before it reaches the writer.
    const parts = await writeShapefile([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { a: 1 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { b: 'two' },
      },
    ] as never);

    expect(parts.fields).toHaveLength(2);
    expect(parts.featureCount).toBe(2);
  });
});

describe('error reporting', () => {
  it('refuses to write an empty collection', async () => {
    await expect(
      writeShapefile({ type: 'FeatureCollection', features: [] }),
    ).rejects.toThrow(/no writable features/);
  });

  it('rejects a line with fewer than two coordinates', async () => {
    await expect(
      writeShapefile({ type: 'LineString', coordinates: [[0, 0]] } as never),
    ).rejects.toThrow(/at least 2 coordinates/);
  });

  it('rejects a polygon ring with fewer than three coordinates', async () => {
    await expect(
      writeShapefile({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      } as never),
    ).rejects.toThrow(/at least 3 coordinates/);
  });

  it('rejects GeometryCollection, which a shapefile cannot express', async () => {
    await expect(
      writeShapefile({
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [0, 0] }],
      } as never),
    ).rejects.toThrow(/GeometryCollection/);
  });

  it('names the offending feature index', async () => {
    await expect(
      writeShapefile([
        { type: 'Point', coordinates: [0, 0] },
        { type: 'Point', coordinates: [1] },
      ] as never),
    ).rejects.toThrow(/feature 1/);
  });

  it('reports a malformed coordinate rather than producing garbage', async () => {
    await expect(
      writeShapefile({ type: 'Point', coordinates: ['a', 'b'] } as never),
    ).rejects.toThrow(/not a number/);
  });
});
