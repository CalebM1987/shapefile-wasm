/** Packing several shapefiles into one archive. */
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';

import { readShapefileZip, writeLayers, writeLayersZip, zipLayers } from '../src/index.js';
import type { LayerInput } from '../src/index.js';
import { CITIES, DONUT, ROUTE } from './fixtures.js';

const decoder = new TextDecoder();

/** A utility network: points, lines and polygons, which cannot share one file. */
const NETWORK: LayerInput[] = [
  { name: 'StormManholes', geojson: CITIES },
  { name: 'StormPipes', geojson: ROUTE },
  { name: 'Basins', geojson: DONUT },
];

function entries(zip: Uint8Array): string[] {
  return Object.keys(unzipSync(zip)).sort();
}

describe('flat layout', () => {
  it('puts every layer at the root', async () => {
    const zip = await writeLayersZip(NETWORK);

    expect(entries(zip)).toEqual([
      'Basins.cpg',
      'Basins.dbf',
      'Basins.shp',
      'Basins.shx',
      'StormManholes.cpg',
      'StormManholes.dbf',
      'StormManholes.shp',
      'StormManholes.shx',
      'StormPipes.cpg',
      'StormPipes.dbf',
      'StormPipes.shp',
      'StormPipes.shx',
    ]);
  });

  it('is the default', async () => {
    const implicit = await writeLayersZip(NETWORK);
    const explicit = await writeLayersZip(NETWORK, { layout: 'flat' });

    expect(entries(implicit)).toEqual(entries(explicit));
  });

  it('includes a .prj per layer when a projection is given', async () => {
    const zip = await writeLayersZip(NETWORK, { epsg: 4326 });

    expect(entries(zip).filter((name) => name.endsWith('.prj'))).toEqual([
      'Basins.prj',
      'StormManholes.prj',
      'StormPipes.prj',
    ]);
  });
});

describe('folders layout', () => {
  it('gives each layer its own folder, named after it', async () => {
    const zip = await writeLayersZip(NETWORK, { layout: 'folders' });
    const names = entries(zip);

    expect(names).toContain('StormManholes/StormManholes.shp');
    expect(names).toContain('StormPipes/StormPipes.shp');
    expect(names).toContain('Basins/Basins.dbf');
  });

  it('keeps every component beside its own layer', async () => {
    const zip = await writeLayersZip(NETWORK, { layout: 'folders' });

    for (const name of entries(zip)) {
      const [folder, file] = name.split('/');
      expect(file!.startsWith(folder!)).toBe(true);
    }
  });
});

describe('nested layout', () => {
  it('produces one inner zip per layer', async () => {
    const zip = await writeLayersZip(NETWORK, { layout: 'nested' });

    expect(entries(zip)).toEqual(['Basins.zip', 'StormManholes.zip', 'StormPipes.zip']);
  });

  it('makes each inner zip a complete, standalone shapefile', async () => {
    const zip = await writeLayersZip(NETWORK, { layout: 'nested', epsg: 4326 });
    const inner = unzipSync(zip)['StormManholes.zip']!;

    expect(Object.keys(unzipSync(inner)).sort()).toEqual([
      'StormManholes.cpg',
      'StormManholes.dbf',
      'StormManholes.prj',
      'StormManholes.shp',
      'StormManholes.shx',
    ]);

    // And it reads back on its own, which is the point of this layout.
    const layers = await readShapefileZip(inner);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.geojson.features).toHaveLength(3);
  });
});

describe('the folder option', () => {
  it('wraps a flat archive in a top-level folder', async () => {
    const zip = await writeLayersZip(NETWORK, { folder: 'storm-network' });

    for (const name of entries(zip)) {
      expect(name.startsWith('storm-network/')).toBe(true);
    }
  });

  it('combines with the folders layout', async () => {
    const zip = await writeLayersZip(NETWORK, { folder: 'export', layout: 'folders' });

    expect(entries(zip)).toContain('export/StormPipes/StormPipes.shp');
  });

  it('combines with the nested layout', async () => {
    const zip = await writeLayersZip(NETWORK, { folder: 'export', layout: 'nested' });

    expect(entries(zip)).toEqual([
      'export/Basins.zip',
      'export/StormManholes.zip',
      'export/StormPipes.zip',
    ]);
  });
});

describe('per-layer options', () => {
  it('applies shared options to every layer', async () => {
    const written = await writeLayers(NETWORK, { epsg: 4326 });

    for (const layer of written) {
      expect(layer.parts.prj).toMatch(/GCS_WGS_1984/);
    }
  });

  it('lets a layer override the shared projection', async () => {
    const written = await writeLayers(
      [
        { name: 'Wgs', geojson: CITIES },
        { name: 'Custom', geojson: CITIES, wkt: 'PROJCS["Site Grid"]' },
      ],
      { epsg: 4326 },
    );

    expect(written[0]!.parts.prj).toMatch(/GCS_WGS_1984/);
    expect(written[1]!.parts.prj).toBe('PROJCS["Site Grid"]');
  });

  it('lets a layer override shared write options', async () => {
    const written = await writeLayers(
      [
        { name: 'Auto', geojson: CITIES },
        { name: 'Forced', geojson: CITIES, shapeType: 'multipoint' },
      ],
      { dimensions: 'xy' },
    );

    expect(written[0]!.parts.shapeType).toBe('Point');
    expect(written[1]!.parts.shapeType).toBe('Multipoint');
  });

  it('accepts prj as an alias for wkt', async () => {
    // So a layer straight out of readShapefileZip can be passed back in.
    const written = await writeLayers([
      { name: 'FromRead', geojson: CITIES, prj: 'PROJCS["Round Trip"]' },
    ]);

    expect(written[0]!.parts.prj).toBe('PROJCS["Round Trip"]');
  });
});

describe('round-tripping', () => {
  it('reads back every layer it wrote', async () => {
    const zip = await writeLayersZip(NETWORK, { epsg: 4326 });
    const layers = await readShapefileZip(zip);

    expect(layers.map((l) => l.name)).toEqual(['Basins', 'StormManholes', 'StormPipes']);
    expect(layers.find((l) => l.name === 'StormManholes')!.geojson.features).toHaveLength(3);
    expect(layers.find((l) => l.name === 'StormPipes')!.geojson.features[0]!.geometry!.type).toBe(
      'MultiLineString',
    );
  });

  it('reads back a folders layout', async () => {
    const zip = await writeLayersZip(NETWORK, { layout: 'folders' });
    const layers = await readShapefileZip(zip);

    expect(layers.map((l) => l.name)).toEqual(['Basins', 'StormManholes', 'StormPipes']);
  });

  it('accepts what readShapefileZip returned, unmodified', async () => {
    const original = await writeLayersZip(NETWORK, { epsg: 4326 });
    const read = await readShapefileZip(original);

    // ShapefileLayer already has `name`, `geojson` and `prj`.
    const repacked = await writeLayersZip(read, { layout: 'folders' });
    const again = await readShapefileZip(repacked);

    expect(again.map((l) => l.name)).toEqual(['Basins', 'StormManholes', 'StormPipes']);
    expect(again[1]!.prj).toMatch(/GCS_WGS_1984/);
  });
});

describe('writeLayers reports per-layer detail', () => {
  it('returns metadata for each layer', async () => {
    const written = await writeLayers(NETWORK);

    expect(written.map((l) => l.name)).toEqual(['StormManholes', 'StormPipes', 'Basins']);
    expect(written.map((l) => l.parts.shapeType)).toEqual(['Point', 'Polyline', 'Polygon']);
    expect(written[0]!.parts.featureCount).toBe(3);
  });

  it('reports the original name alongside the sanitised one', async () => {
    const written = await writeLayers([{ name: 'Storm Pipes 2024', geojson: ROUTE }]);

    expect(written[0]!.source).toBe('Storm Pipes 2024');
    expect(written[0]!.name).toBe('Storm_Pipes_2024');
  });

  it('can be packed separately with zipLayers', async () => {
    const written = await writeLayers(NETWORK, { epsg: 4326 });
    const zip = zipLayers(written, { layout: 'folders' });

    expect(entries(zip)).toContain('Basins/Basins.prj');
  });
});

describe('names', () => {
  it('sanitises characters that break on Windows', async () => {
    const zip = await writeLayersZip([{ name: 'storm: pipes?', geojson: ROUTE }]);

    for (const name of entries(zip)) {
      expect(name).not.toMatch(/[<>:"|?*]/);
    }
  });

  it('leaves hyphens alone — they are legal in a filename', async () => {
    const zip = await writeLayersZip([{ name: 'storm-pipes', geojson: ROUTE }]);
    expect(entries(zip)).toContain('storm-pipes.shp');
  });

  it('rejects two layers that resolve to the same name', async () => {
    // A space and a colon both become an underscore, so these collide even
    // though they were written differently. In a flat archive the second would
    // silently overwrite the first.
    await expect(
      writeLayersZip([
        { name: 'storm pipes', geojson: ROUTE },
        { name: 'storm:pipes', geojson: ROUTE },
      ]),
    ).rejects.toThrow(/both resolve to "storm_pipes"/);
  });

  it('rejects exact duplicates', async () => {
    await expect(
      writeLayersZip([
        { name: 'Pipes', geojson: ROUTE },
        { name: 'Pipes', geojson: ROUTE },
      ]),
    ).rejects.toThrow(/Give them distinct names/);
  });

  it('rejects an empty name', async () => {
    await expect(writeLayersZip([{ name: '   ', geojson: ROUTE }])).rejects.toThrow(
      /needs a non-empty name/,
    );
  });
});

describe('errors', () => {
  it('names the layer that failed', async () => {
    await expect(
      writeLayersZip([
        { name: 'Good', geojson: CITIES },
        { name: 'Bad', geojson: { type: 'FeatureCollection', features: [] } },
      ]),
    ).rejects.toThrow(/layer "Bad"/);
  });

  it('keeps the underlying reason in the message', async () => {
    await expect(
      writeLayersZip([{ name: 'Empty', geojson: { type: 'FeatureCollection', features: [] } }]),
    ).rejects.toThrow(/no writable features/);
  });

  it('preserves the original error as the cause', async () => {
    await expect(
      writeLayersZip([{ name: 'Empty', geojson: { type: 'FeatureCollection', features: [] } }]),
    ).rejects.toMatchObject({ cause: expect.any(Error) });
  });

  it('rejects an empty batch', async () => {
    await expect(writeLayersZip([])).rejects.toThrow(/at least one layer/);
  });

  it('rejects packing an empty batch', () => {
    expect(() => zipLayers([])).toThrow(/at least one layer/);
  });

  it('fails the whole batch rather than dropping a layer silently', async () => {
    // A partial archive that looks complete is worse than a failed export.
    await expect(
      writeLayersZip([
        { name: 'Points', geojson: CITIES },
        {
          name: 'Mixed',
          geojson: [
            { type: 'Point', coordinates: [0, 0] },
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
          ] as never,
        },
      ]),
    ).rejects.toThrow(/layer "Mixed"/);
  });
});

describe('compression', () => {
  it('honours the level', async () => {
    const stored = await writeLayersZip(NETWORK, { level: 0 });
    const packed = await writeLayersZip(NETWORK, { level: 9 });

    expect(packed.length).toBeLessThan(stored.length);
  });

  it('writes UTF-8 into every .cpg', async () => {
    const zip = await writeLayersZip(NETWORK);
    const files = unzipSync(zip);

    for (const name of Object.keys(files).filter((n) => n.endsWith('.cpg'))) {
      expect(decoder.decode(files[name])).toBe('UTF-8');
    }
  });
});
