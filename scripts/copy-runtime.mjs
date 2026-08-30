/**
 * Copies the hand-written JavaScript that `tsc` will not emit for.
 *
 * `src/generated/bindings.js` is wasm-bindgen output paired with its own
 * `.d.ts`, so TypeScript type-checks against it but treats it as a declaration
 * only and emits nothing. The runtime file has to be placed in `dist/` by hand.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FROM = resolve(HERE, '../src/generated');
const TO = resolve(HERE, '../dist/generated');

await mkdir(TO, { recursive: true });
await copyFile(resolve(FROM, 'bindings.js'), resolve(TO, 'bindings.js'));
await copyFile(resolve(FROM, 'bindings.d.ts'), resolve(TO, 'bindings.d.ts'));

console.log('copied wasm-bindgen glue into dist/generated');
