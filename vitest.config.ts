import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Most suites run against `src/` so there is no build step in the edit loop.
    // `test/package.test.ts` is the exception: it imports the built `dist/` to
    // check that the published entry points actually resolve.
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Instantiating the wasm module costs ~50ms and several suites do it.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Generated files are wasm-bindgen output and a base64 blob.
      exclude: ['src/generated/**', 'src/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
