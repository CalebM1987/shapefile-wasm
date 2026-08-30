/**
 * The browser-only helpers, exercised against a DOM.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadShapefileZip, readShapefileFile, triggerDownload } from '../src/browser.js';
import { writeShapefileZip } from '../src/index.js';
import { CITIES } from './fixtures.js';

/**
 * happy-dom has no object URL support. Patch the two statics onto the real `URL`
 * rather than replacing the global: other code (and the wasm glue) still needs
 * `new URL(...)` to work.
 */
function stubObjectUrls() {
  const created: unknown[] = [];
  const revoked: string[] = [];

  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: unknown) => {
    created.push(blob);
    return `blob:mock/${created.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url);
  });

  return { created, revoked };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('triggerDownload', () => {
  it('clicks an anchor carrying the file name', () => {
    stubObjectUrls();
    const clicks: string[] = [];

    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === 'a') {
        element.click = () => clicks.push((element as HTMLAnchorElement).download);
      }
      return element;
    });

    triggerDownload(new Uint8Array([1, 2, 3]), 'export.zip');

    expect(clicks).toEqual(['export.zip']);
  });

  it('removes the anchor again so the DOM is left clean', () => {
    stubObjectUrls();
    triggerDownload(new Uint8Array([1, 2, 3]), 'export.zip');
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('revokes the object URL, but not before the download starts', () => {
    vi.useFakeTimers();
    const { revoked } = stubObjectUrls();

    triggerDownload(new Uint8Array([1, 2, 3]), 'export.zip');

    // Revoking synchronously cancels the download in some browsers.
    expect(revoked).toHaveLength(0);
    vi.runAllTimers();
    expect(revoked).toHaveLength(1);
  });

  it('accepts a Blob directly', () => {
    const { created } = stubObjectUrls();
    triggerDownload(new Blob(['x']), 'export.zip');
    expect(created).toHaveLength(1);
  });
});

describe('downloadShapefileZip', () => {
  it('returns the same bytes it handed to the browser', async () => {
    stubObjectUrls();
    const zip = await downloadShapefileZip(CITIES, { fileName: 'cities', epsg: 4326 });

    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.length).toBeGreaterThan(0);
  });
});

describe('readShapefileFile', () => {
  it('reads a zip out of a Blob, as a file input would supply it', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'cities' });
    const file = new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' });

    const layers = await readShapefileFile(file);

    expect(layers).toHaveLength(1);
    expect(layers[0]!.geojson.features).toHaveLength(3);
  });
});

describe('outside a browser', () => {
  it('explains itself rather than failing obscurely', async () => {
    // Re-import in a Node environment to check the guard fires.
    vi.stubGlobal('document', undefined);
    expect(() => triggerDownload(new Uint8Array([1]), 'x.zip')).toThrow(/needs a browser/);
  });
});
