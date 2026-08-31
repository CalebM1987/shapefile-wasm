<script setup lang="ts">
import { computed } from 'vue';

import { useLayers } from '../composables/useLayers';
import {
  LAYOUTS,
  PROJECTIONS,
  useShapefileExport,
} from '../composables/useShapefileExport';

const { selected } = useLayers();
const { options, busy, error, result, canExport, exportSelected } = useShapefileExport();

const activeHint = computed(
  () => LAYOUTS.find((layout) => layout.value === options.layout)?.hint ?? '',
);

/** A sketch of the archive, so the layout choice is concrete. */
const preview = computed<string[]>(() => {
  const names = selected.value.map((layer) => layer.name);
  if (names.length === 0) return ['(nothing selected)'];

  const root = options.folder.trim() ? `${options.folder.trim()}/` : '';
  const prj = options.epsg > 0 ? ['prj'] : [];

  if (options.layout === 'nested') {
    return names.map((name) => `${root}${name}.zip`);
  }

  const extensions = ['shp', 'shx', 'dbf', 'cpg', ...prj];

  if (options.layout === 'folders') {
    return names.flatMap((name) => [
      `${root}${name}/`,
      ...extensions.map((ext) => `  ${name}.${ext}`),
    ]);
  }

  return names.flatMap((name) => extensions.map((ext) => `${root}${name}.${ext}`));
});
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2>Export to shapefile</h2>
    </header>

    <label class="field">
      <span class="field__label">Archive name</span>
      <input v-model="options.fileName" type="text" placeholder="shapefiles" />
    </label>

    <fieldset class="field">
      <legend class="field__label">Layout</legend>
      <div class="choices">
        <label v-for="layout in LAYOUTS" :key="layout.value" class="choice">
          <input v-model="options.layout" type="radio" :value="layout.value" />
          <span>{{ layout.label }}</span>
        </label>
      </div>
      <p class="hint">{{ activeHint }}</p>
    </fieldset>

    <label class="field">
      <span class="field__label">Projection</span>
      <select v-model.number="options.epsg">
        <option v-for="projection in PROJECTIONS" :key="projection.value" :value="projection.value">
          {{ projection.label }}
        </option>
      </select>
      <p class="hint">
        Written to the <code>.prj</code>. Coordinates are not reprojected — the file records
        which system they are already in.
      </p>
    </label>

    <label class="field">
      <span class="field__label">Top-level folder <em>(optional)</em></span>
      <input v-model="options.folder" type="text" placeholder="e.g. 2026-08-30-export" />
    </label>

    <div class="field">
      <span class="field__label">Archive contents</span>
      <pre class="preview">{{ preview.join('\n') }}</pre>
    </div>

    <button type="button" class="primary" :disabled="!canExport" @click="exportSelected">
      {{ busy ? 'Building…' : `Export ${selected.length} layer${selected.length === 1 ? '' : 's'}` }}
    </button>

    <p v-if="error" class="alert alert--error">{{ error }}</p>

    <div v-if="result" class="results">
      <h3>Wrote {{ result.length }} layer{{ result.length === 1 ? '' : 's' }}</h3>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Type</th>
            <th>Features</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="layer in result" :key="layer.name">
            <td>{{ layer.name }}</td>
            <td>{{ layer.parts.shapeType }}</td>
            <td>{{ layer.parts.featureCount }}</td>
          </tr>
        </tbody>
      </table>

      <template v-for="layer in result" :key="`${layer.name}-renames`">
        <p
          v-for="field in layer.parts.fields.filter((f) => f.source !== f.name)"
          :key="field.source"
          class="alert alert--note"
        >
          <strong>{{ layer.name }}:</strong> “{{ field.source }}” was written as
          “{{ field.name }}” — dBase caps field names at 11 bytes.
        </p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.choices {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
}

.preview {
  margin: 0;
  padding: 0.6rem 0.7rem;
  background: var(--code-bg);
  border: 1px solid var(--edge);
  border-radius: 8px;
  font-size: 0.75rem;
  line-height: 1.5;
  max-height: 170px;
  overflow: auto;
  white-space: pre;
}

.results table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.results th,
.results td {
  text-align: left;
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--edge);
}

.results h3 {
  font-size: 0.85rem;
  margin: 0.75rem 0 0.4rem;
}
</style>
