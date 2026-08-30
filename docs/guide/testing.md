# Testing

```bash
npm test
```

Runs the Rust tests, then a full build, then the TypeScript suite.

## Running them individually

```bash
npm run test:rust      # cargo test
npm run test:ts        # vitest run
npm run test:watch     # vitest, watch mode
npm run test:coverage  # vitest with a v8 coverage report
```

The TypeScript suites import from `src/`, so no build is needed while iterating.
`test/package.test.ts` is the exception — it imports the built `dist/` and skips
itself when `dist/` is absent.

## What is covered

| File | Covers |
| --- | --- |
| `rust/*.rs` (`#[cfg(test)]`) | Conversion rules, schema inference, field naming, ring nesting |
| `test/write.test.ts` | File structure, header fields, schema inference, error messages |
| `test/roundtrip.test.ts` | Write-then-read equivalence across geometry, attributes and encodings |
| `test/zip.test.ts` | Archive contents, multi-layer and nested archives, pollution |
| `test/projections.test.ts` | The registry, lazy table loading, `.prj` resolution |
| `test/browser.test.ts` | DOM helpers under happy-dom |
| `test/wasm.test.ts` | Init lifecycle, the `/slim` entry, memory behaviour |
| `test/package.test.ts` | The built package and every declared entry point |

## Round-trips are the real test

`test/roundtrip.test.ts` writes bytes and reads them straight back. Without
binary fixtures from other software, that is the only real evidence that what
this package emits is what a reader understands.

Some of them are deliberately adversarial. This one would pass even if holes were
paired with exteriors by index, so the fixture puts two donuts 100 units apart
and asserts each hole came back attached to its *own* square:

```ts
for (const polygon of geometry.coordinates) {
  expect(polygon).toHaveLength(2);
  const exteriorX = polygon[0][0][0];
  const holeX = polygon[1][0][0];
  expect(Math.abs(exteriorX - holeX)).toBeLessThan(50);
}
```

## Byte-level assertions

Structural tests check the actual bytes rather than trusting the writer:

```ts
// 9994, big-endian, at byte 0 — the shapefile magic number.
expect(readInt32BE(parts.shp, 0)).toBe(9994);

// Byte 24 is the file length in 16-bit words.
expect(readInt32BE(parts.shp, 24) * 2).toBe(parts.shp.length);

// The .shx is a 100-byte header plus one 8-byte entry per record.
expect(parts.shx.length).toBe(100 + 3 * 8);
```

## Writing a new test

Fixtures live in `test/fixtures.ts`. Prefer adding to the round-trip suite:
assert on the GeoJSON that comes back, not on intermediate state.

```ts
import { describe, expect, it } from 'vitest';
import { readShapefile, writeShapefile } from '../src/index.js';

it('preserves the thing I care about', async () => {
  const parts = await writeShapefile(input);
  const output = await readShapefile({ shp: parts.shp, dbf: parts.dbf });

  expect(output.features[0].properties.value).toBe(expected);
});
```

For Rust-side logic, a unit test in the relevant module is faster and gives a
better failure message than reaching through WebAssembly.

## Coverage

```bash
npm run test:coverage
```

Generated sources and `src/types.ts` are excluded — the first is machine-written,
the second is types only.
