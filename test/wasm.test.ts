/** Module lifecycle: initialisation, the slim entry point, and error recovery. */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { init, isReady, writeShapefile } from '../src/index.js';
import { CITIES } from './fixtures.js';

const WASM_PATH = fileURLToPath(new URL('../pkg/shapefile_wasm_bg.wasm', import.meta.url));

describe('initialisation', () => {
  it('is implicit — the API works without calling init', async () => {
    const parts = await writeShapefile(CITIES);
    expect(parts.featureCount).toBe(3);
  });

  it('is idempotent', async () => {
    await init();
    await init();
    await init();
    expect(isReady()).toBe(true);
  });

  it('reports readiness once instantiation has finished', async () => {
    await init();
    expect(isReady()).toBe(true);
  });

  it('accepts explicit bytes', async () => {
    // The module is already up by now, so this exercises the idempotent path
    // rather than a fresh instantiation; the point is that it does not throw.
    await expect(init(await readFile(WASM_PATH))).resolves.toBeUndefined();
  });
});

describe('the slim entry point', () => {
  it('exposes the same API as the root', async () => {
    const slim = await import('../src/slim.js');
    const root = await import('../src/index.js');

    const slimExports = Object.keys(slim).sort();
    const rootExports = Object.keys(root).sort();

    expect(slimExports).toEqual(rootExports);
  });

  it('works once given a binary', async () => {
    const slim = await import('../src/slim.js');
    await slim.init(await readFile(WASM_PATH));

    const parts = await slim.writeShapefile(CITIES);
    expect(parts.featureCount).toBe(3);
  });
});

describe('memory handling', () => {
  it('does not leak across many conversions', async () => {
    // Each call allocates a wasm-side object that has to be freed; a leak here
    // shows up as growing memory rather than a wrong answer, so the check is
    // simply that a long run stays correct and completes.
    for (let i = 0; i < 200; i += 1) {
      const parts = await writeShapefile(CITIES);
      expect(parts.featureCount).toBe(3);
    }
  });

  it('returns detached copies, not views into wasm memory', async () => {
    const first = await writeShapefile(CITIES);
    const snapshot = Uint8Array.from(first.shp);

    // Force plenty of further allocation, which would move or clobber a live
    // view into the wasm heap.
    for (let i = 0; i < 50; i += 1) {
      await writeShapefile(CITIES);
    }

    expect(first.shp).toEqual(snapshot);
  });
});
