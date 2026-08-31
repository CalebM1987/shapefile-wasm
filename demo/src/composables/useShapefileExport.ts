import { computed, reactive, ref } from 'vue';
import { writeLayers, zipLayers, type ArchiveLayout, type WrittenLayer } from '@crmackey/shapefile-wasm';
import { triggerDownload } from '@crmackey/shapefile-wasm/browser';

import { useLayers } from './useLayers';

/** The three archive shapes, with the guidance the docs give for each. */
export const LAYOUTS: Array<{ value: ArchiveLayout; label: string; hint: string }> = [
  {
    value: 'flat',
    label: 'Flat',
    hint: 'Every layer at the archive root. What desktop GIS opens most readily.',
  },
  {
    value: 'folders',
    label: 'Folders',
    hint: 'One directory per layer. Easier to read when there are many.',
  },
  {
    value: 'nested',
    label: 'Nested zips',
    hint: 'One inner .zip per layer, for uploaders wanting a single shapefile each.',
  },
];

/** A handful of codes, to show the projection option doing something. */
export const PROJECTIONS = [
  { value: 4326, label: 'EPSG:4326 — WGS 84' },
  { value: 3857, label: 'EPSG:3857 — Web Mercator' },
  { value: 26918, label: 'EPSG:26918 — NAD83 / UTM 18N' },
  { value: 0, label: 'No .prj' },
];

export function useShapefileExport() {
  const { selected } = useLayers();

  const options = reactive({
    layout: 'flat' as ArchiveLayout,
    epsg: 4326,
    fileName: 'central-park',
    folder: '',
  });

  const busy = ref(false);
  const error = ref<string>();
  /** What the last export produced, for the results panel. */
  const result = ref<WrittenLayer[]>();

  const canExport = computed(() => selected.value.length > 0 && !busy.value);

  async function exportSelected(): Promise<void> {
    error.value = undefined;
    result.value = undefined;

    if (selected.value.length === 0) {
      error.value = 'Select at least one layer to export.';
      return;
    }

    busy.value = true;

    try {
      // Two steps rather than writeLayersZip, so the per-layer detail — feature
      // counts, inferred shape type, any field renames — can be shown.
      const written = await writeLayers(
        selected.value.map((layer) => ({
          name: layer.name,
          geojson: layer.geojson,
          ...(options.epsg > 0 ? { epsg: options.epsg } : {}),
        })),
      );

      const zip = zipLayers(written, {
        layout: options.layout,
        ...(options.folder.trim() ? { folder: options.folder.trim() } : {}),
      });

      const base = options.fileName.trim() || 'shapefiles';
      triggerDownload(zip, `${base}.zip`);

      result.value = written;
    } catch (cause) {
      // Errors from the package name the layer and the reason; surface both.
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy.value = false;
    }
  }

  return { options, busy, error, result, canExport, exportSelected };
}
