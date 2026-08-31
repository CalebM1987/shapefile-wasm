import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    // The package is linked with `file:..`, so let Vite resolve it from source
    // rather than pre-bundling a copy that goes stale on every rebuild.
    exclude: ['@crmackey/shapefile-wasm'],
  },
  build: {
    // The wasm binary ships base64-inlined, which trips the default warning.
    chunkSizeWarningLimit: 1200,
  },
});
