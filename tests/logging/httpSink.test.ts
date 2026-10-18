// Tests for the pure batching helper of src/logging/httpSink.ts.
// Global context: browsers cap keepalive fetch / sendBeacon bodies at 64 KiB, so log batches must be split below that.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { splitBatches } from '../../src/logging/httpSink'; // Unit under test.

describe('splitBatches', () => {
  it('keeps every line, in order, with each batch under the byte limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(100)}`); // ~110 bytes each.
    const batches = splitBatches(lines, 1000); // Small limit for the test.
    expect(batches.flatMap((b) => b.split('\n'))).toEqual(lines); // Nothing lost or reordered.
    for (const b of batches) expect(new TextEncoder().encode(b).length).toBeLessThanOrEqual(1000); // Under the limit.
  });

  it('sends an oversized single line on its own rather than dropping it', () => {
    const big = 'y'.repeat(5000); // Larger than the limit.
    expect(splitBatches(['a', big, 'b'], 1000)).toEqual(['a', big, 'b']); // Isolated, not lost.
  });
});
