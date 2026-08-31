import { ref } from 'vue';
import { readShapefileFile } from '@crmackey/shapefile-wasm/browser';

import { useLayers } from './useLayers';
import type { MapLayer } from '../types';

/**
 * Drag-and-drop and file-picker import of zipped shapefiles.
 *
 * One archive can hold several layers — points, lines and polygons cannot share
 * a file — so every import returns a list.
 */
export function useShapefileImport(onImported?: (layers: MapLayer[]) => void) {
  const { addLayer } = useLayers();

  const dragging = ref(false);
  const busy = ref(false);
  const error = ref<string>();
  const lastImported = ref<string[]>([]);

  // dragenter/dragleave fire for every child element, so a boolean flag
  // flickers. Counting them is the usual fix.
  let depth = 0;

  function onDragEnter(event: DragEvent): void {
    event.preventDefault();
    depth += 1;
    dragging.value = true;
  }

  function onDragOver(event: DragEvent): void {
    // Without this the browser navigates to the dropped file.
    event.preventDefault();
  }

  function onDragLeave(event: DragEvent): void {
    event.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging.value = false;
  }

  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    depth = 0;
    dragging.value = false;

    const files = Array.from(event.dataTransfer?.files ?? []);
    await importFiles(files);
  }

  async function importFiles(files: File[]): Promise<void> {
    error.value = undefined;
    lastImported.value = [];

    const archives = files.filter((file) => /\.zip$/i.test(file.name));

    if (archives.length === 0) {
      error.value =
        files.length > 0
          ? 'Drop a .zip containing a shapefile. The .shp, .dbf and .prj have to travel together.'
          : 'No files were dropped.';
      return;
    }

    busy.value = true;
    const added: MapLayer[] = [];

    try {
      for (const archive of archives) {
        // Each layer in the archive becomes its own map layer.
        const found = await readShapefileFile(archive);

        for (const layer of found) {
          added.push(addLayer(layer.name, layer.geojson));
          lastImported.value.push(layer.name);
        }
      }

      if (added.length > 0) onImported?.(added);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy.value = false;
    }
  }

  /** For the `<input type="file">` fallback. */
  async function onFileInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    await importFiles(Array.from(input.files ?? []));
    // Allow re-picking the same file.
    input.value = '';
  }

  return {
    dragging,
    busy,
    error,
    lastImported,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onFileInput,
    importFiles,
  };
}
