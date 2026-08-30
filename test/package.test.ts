/**
 * Checks the built package rather than the source: that every entry point in
 * `package.json` resolves, and that the compiled output behaves.
 *
 * Requires `npm run build` first. Skipped automatically when `dist/` is absent
 * so the fast source-only loop still works.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CITIES } from './fixtures.js';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const built = existsSync(DIST);

describe.skipIf(!built)('the built package', () => {
  it('exposes the documented API from the root entry point', async () => {
    const pkg = await import('../dist/index.js');

    for (const name of [
      'init',
      'isReady',
      'writeShapefile',
      'writeShapefileZip',
      'zipParts',
      'readShapefile',
      'readShapefileZip',
      'registerProjections',
      'getProjection',
      'registeredProjections',
    ]) {
      expect(typeof pkg[name as keyof typeof pkg], `${name} should be exported`).toBe(
        'function',
      );
    }
  });

  it('round-trips through the compiled output', async () => {
    const { writeShapefileZip, readShapefileZip } = await import('../dist/index.js');

    const zip = await writeShapefileZip(CITIES, { fileName: 'cities', epsg: 4326 });
    const layers = await readShapefileZip(zip);

    expect(layers[0]!.geojson.features).toHaveLength(3);
  });

  it('ships the browser helpers separately from the core', async () => {
    const browser = await import('../dist/browser.js');
    expect(typeof browser.triggerDownload).toBe('function');
    expect(typeof browser.downloadShapefileZip).toBe('function');
    expect(typeof browser.readShapefileFile).toBe('function');
  });

  it('ships the projection table on its own subpath', async () => {
    const { epsgProjections } = await import('../dist/generated/projections.js');
    expect(Object.keys(epsgProjections).length).toBeGreaterThan(100);
  });

  it('declares every entry point it ships', async () => {
    const pkg = JSON.parse(
      await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    );

    for (const [subpath, target] of Object.entries(pkg.exports as Record<string, unknown>)) {
      const file = typeof target === 'string' ? target : (target as { default: string }).default;
      const resolved = fileURLToPath(new URL(`../${file}`, import.meta.url));
      expect(existsSync(resolved), `${subpath} -> ${file} should exist`).toBe(true);
    }
  });

  it('ships type declarations alongside the JavaScript', async () => {
    for (const file of ['index', 'slim', 'browser', 'read', 'write', 'types']) {
      expect(existsSync(`${DIST}/${file}.d.ts`), `${file}.d.ts should exist`).toBe(true);
    }
  });

  it('carries the wasm-bindgen glue that tsc does not emit', () => {
    expect(existsSync(`${DIST}/generated/bindings.js`)).toBe(true);
    expect(existsSync(`${DIST}/generated/wasm-inline.js`)).toBe(true);
  });
});
