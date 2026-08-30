/** The zip layer: what goes into an archive, and what comes back out of one. */
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';

import {
  readShapefileZip,
  writeShapefile,
  writeShapefileZip,
  zipParts,
} from '../src/index.js';
import { CITIES, DONUT, ROUTE } from './fixtures.js';

const decoder = new TextDecoder();

describe('writing archives', () => {
  it('includes every component', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'cities', epsg: 4326 });

    expect(Object.keys(unzipSync(zip)).sort()).toEqual([
      'cities.cpg',
      'cities.dbf',
      'cities.prj',
      'cities.shp',
      'cities.shx',
    ]);
  });

  it('omits the .prj when no projection was given', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'cities' });
    expect(Object.keys(unzipSync(zip))).not.toContain('cities.prj');
  });

  it('defaults the base name', async () => {
    const zip = await writeShapefileZip(CITIES);
    expect(Object.keys(unzipSync(zip))).toContain('shapefile.shp');
  });

  it('strips a directory and extension from fileName', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: '/tmp/exports/roads.zip' });
    expect(Object.keys(unzipSync(zip))).toContain('roads.shp');
  });

  it('replaces characters that are illegal on Windows', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'my roads: 2024?' });
    for (const name of Object.keys(unzipSync(zip))) {
      expect(name).not.toMatch(/[<>:"|?* ]/);
    }
  });

  it('writes UTF-8 into the .cpg so readers decode text correctly', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'cities' });
    expect(decoder.decode(unzipSync(zip)['cities.cpg'])).toBe('UTF-8');
  });

  it('honours the compression level', async () => {
    const stored = await writeShapefileZip(CITIES, { fileName: 'c', level: 0 });
    const packed = await writeShapefileZip(CITIES, { fileName: 'c', level: 9 });
    expect(packed.length).toBeLessThan(stored.length);
  });

  it('can zip parts that were generated separately', async () => {
    const parts = await writeShapefile(CITIES, { epsg: 4326 });
    const zip = zipParts(parts, { fileName: 'separate' });

    expect(Object.keys(unzipSync(zip)).sort()).toEqual([
      'separate.cpg',
      'separate.dbf',
      'separate.prj',
      'separate.shp',
      'separate.shx',
    ]);
  });
});

describe('reading archives', () => {
  it('reads back what it wrote', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'cities', epsg: 4326 });
    const layers = await readShapefileZip(zip);

    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe('cities');
    expect(layers[0]!.geojson.features).toHaveLength(3);
    expect(layers[0]!.encoding).toBe('UTF-8');
  });

  it('surfaces the .prj both on the layer and on the FeatureCollection', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'cities', epsg: 4326 });
    const [layer] = await readShapefileZip(zip);

    expect(layer!.prj).toMatch(/GCS_WGS_1984/);
    expect(layer!.geojson.wkt).toMatch(/GCS_WGS_1984/);
  });

  it('finds every layer in a multi-layer archive', async () => {
    const points = unzipSync(await writeShapefileZip(CITIES, { fileName: 'cities' }));
    const lines = unzipSync(await writeShapefileZip(ROUTE, { fileName: 'route' }));
    const areas = unzipSync(await writeShapefileZip(DONUT, { fileName: 'areas' }));

    const combined = zipSync({ ...points, ...lines, ...areas });
    const layers = await readShapefileZip(combined);

    expect(layers.map((l) => l.name)).toEqual(['areas', 'cities', 'route']);
  });

  it('handles layers nested in folders', async () => {
    const entries = unzipSync(await writeShapefileZip(CITIES, { fileName: 'cities' }));
    const nested = zipSync(
      Object.fromEntries(Object.entries(entries).map(([k, v]) => [`export/data/${k}`, v])),
    );

    const layers = await readShapefileZip(nested);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe('cities');
  });

  it('keeps same-named layers in different folders apart', async () => {
    const entries = unzipSync(await writeShapefileZip(CITIES, { fileName: 'data' }));
    const nested = zipSync({
      ...Object.fromEntries(Object.entries(entries).map(([k, v]) => [`a/${k}`, v])),
      ...Object.fromEntries(Object.entries(entries).map(([k, v]) => [`b/${k}`, v])),
    });

    const layers = await readShapefileZip(nested);
    expect(layers).toHaveLength(2);
  });

  it('ignores macOS resource forks', async () => {
    const entries = unzipSync(await writeShapefileZip(CITIES, { fileName: 'cities' }));
    const polluted = zipSync({
      ...entries,
      '__MACOSX/._cities.shp': new Uint8Array([0, 1, 2]),
      '.DS_Store': new Uint8Array([0]),
    });

    const layers = await readShapefileZip(polluted);
    expect(layers).toHaveLength(1);
  });

  it('ignores a .dbf with no .shp beside it', async () => {
    const entries = unzipSync(await writeShapefileZip(CITIES, { fileName: 'cities' }));
    const withOrphan = zipSync({ ...entries, 'orphan.dbf': entries['cities.dbf']! });

    const layers = await readShapefileZip(withOrphan);
    expect(layers.map((l) => l.name)).toEqual(['cities']);
  });

  it('reads a layer that has no .dbf', async () => {
    const entries = unzipSync(await writeShapefileZip(CITIES, { fileName: 'cities' }));
    delete entries['cities.dbf'];

    const [layer] = await readShapefileZip(zipSync(entries));
    expect(layer!.geojson.features).toHaveLength(3);
    expect(layer!.geojson.features[0]!.properties).toEqual({});
  });

  it('reports an archive with no shapefile in it', async () => {
    const bogus = zipSync({ 'readme.txt': new TextEncoder().encode('nothing here') });
    await expect(readShapefileZip(bogus)).rejects.toThrow(/no \.shp file/);
  });

  it('lets an explicit encoding override the .cpg', async () => {
    const entries = unzipSync(await writeShapefileZip(CITIES, { fileName: 'cities' }));
    entries['cities.cpg'] = new TextEncoder().encode('cp1252');

    const [layer] = await readShapefileZip(zipSync(entries), { encoding: 'utf-8' });
    expect(layer!.encoding).toBe('utf-8');
    expect(layer!.geojson.features[0]!.properties!.name).toBe('San Francisco');
  });
});
