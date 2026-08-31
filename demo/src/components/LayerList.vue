<script setup lang="ts">
import { useLayers } from '../composables/useLayers';
import type { MapLayer } from '../types';

const emit = defineEmits<{ zoom: [layer: MapLayer]; zoomAll: [] }>();

const { layers, removeLayer } = useLayers();

const KIND_LABEL = { point: 'Point', line: 'Line', polygon: 'Polygon' } as const;

function toggleAll(selected: boolean): void {
  for (const layer of layers.value) layer.selected = selected;
}
</script>

<template>
  <section class="panel">
    <header class="panel__header">
      <h2>Layers</h2>
      <div class="panel__actions">
        <button type="button" class="link" @click="toggleAll(true)">All</button>
        <button type="button" class="link" @click="toggleAll(false)">None</button>
      </div>
    </header>

    <p v-if="layers.length === 0" class="empty">No layers loaded.</p>

    <ul v-else class="layers">
      <li v-for="layer in layers" :key="layer.id" class="layer">
        <label class="layer__select">
          <input v-model="layer.selected" type="checkbox" />
          <span class="swatch" :style="{ background: layer.color }" aria-hidden="true" />
          <span class="layer__name">{{ layer.name }}</span>
        </label>

        <div class="layer__meta">
          <span class="badge">{{ KIND_LABEL[layer.kind] }}</span>
          <span class="count">{{ layer.geojson.features.length }} features</span>
          <span v-if="layer.origin === 'imported'" class="badge badge--imported">imported</span>
        </div>

        <div class="layer__controls">
          <button
            type="button"
            class="icon"
            :title="layer.visible ? 'Hide on map' : 'Show on map'"
            :aria-pressed="layer.visible"
            @click="layer.visible = !layer.visible"
          >
            {{ layer.visible ? '👁' : '🚫' }}
          </button>
          <button type="button" class="icon" title="Zoom to layer" @click="emit('zoom', layer)">
            ⤢
          </button>
          <button
            v-if="layer.origin === 'imported'"
            type="button"
            class="icon icon--danger"
            title="Remove layer"
            @click="removeLayer(layer.id)"
          >
            ✕
          </button>
        </div>
      </li>
    </ul>

    <button v-if="layers.length > 0" type="button" class="secondary" @click="emit('zoomAll')">
      Zoom to all layers
    </button>
  </section>
</template>

<style scoped>
.layers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}

.layer {
  border: 1px solid var(--edge);
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
  background: var(--surface);
  display: grid;
  gap: 0.4rem;
}

.layer__select {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: 600;
}

.layer__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex: none;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.15);
}

.layer__meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--muted);
  flex-wrap: wrap;
}

.badge {
  background: var(--chip);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-weight: 600;
}

.badge--imported {
  background: #dbeafe;
  color: #1d4ed8;
}

.layer__controls {
  display: flex;
  gap: 0.25rem;
}
</style>
