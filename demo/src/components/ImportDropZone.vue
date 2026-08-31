<script setup lang="ts">
import { useShapefileImport } from '../composables/useShapefileImport';
import type { MapLayer } from '../types';

const emit = defineEmits<{ imported: [layers: MapLayer[]] }>();

const {
  dragging,
  busy,
  error,
  lastImported,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
} = useShapefileImport((layers) => emit('imported', layers));
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2>Import a shapefile</h2>
    </header>

    <div
      class="dropzone"
      :class="{ 'dropzone--active': dragging, 'dropzone--busy': busy }"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <p class="dropzone__icon" aria-hidden="true">🗂</p>

      <p class="dropzone__text">
        <template v-if="busy">Reading…</template>
        <template v-else-if="dragging">Drop to load</template>
        <template v-else>Drag a zipped shapefile here</template>
      </p>

      <label class="secondary as-button">
        Choose a .zip
        <input type="file" accept=".zip,application/zip" multiple @change="onFileInput" />
      </label>

      <p class="hint">
        The <code>.shp</code>, <code>.dbf</code> and <code>.prj</code> have to travel together, so
        the archive is the unit. One zip can hold several layers.
      </p>
    </div>

    <p v-if="error" class="alert alert--error">{{ error }}</p>

    <p v-else-if="lastImported.length > 0" class="alert alert--ok">
      Loaded {{ lastImported.join(', ') }}
    </p>
  </section>
</template>

<style scoped>
.dropzone {
  border: 2px dashed var(--edge-strong);
  border-radius: 10px;
  padding: 1.1rem 0.9rem;
  text-align: center;
  display: grid;
  gap: 0.5rem;
  justify-items: center;
  transition: border-color 120ms, background 120ms;
}

.dropzone--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone--busy {
  opacity: 0.65;
  pointer-events: none;
}

.dropzone__icon {
  font-size: 1.6rem;
  margin: 0;
}

.dropzone__text {
  margin: 0;
  font-weight: 600;
}

.as-button {
  cursor: pointer;
}

.as-button input {
  display: none;
}
</style>
