// Tests for src/logging/httpSink.ts: the pure batching helper and the sink's give-up rule on static hosting.
// Global context: browsers cap keepalive fetch / sendBeacon bodies at 64 KiB, so log batches must be split below that;
// and on a static host (GitHub Pages answers POST with 405) the sink must stop posting so the game logs to the console only.
import { afterEach, describe, expect, it, vi } from 'vitest'; // Vitest API (fake timers + global stubs: https://vitest.dev/api/vi.html).
import { createHttpSink, splitBatches } from '../../src/logging/httpSink'; // Units under test.
import type { LogRecord } from '../../src/logging/logger'; // Second sink argument (unused by the HTTP sink).

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

describe('createHttpSink', () => {
  const record: LogRecord = { ts: '2026-10-18T00:00:00.000Z', level: 'info', module: 'test', message: 'x' }; // Dummy record.

  /** Create a sink whose fetch always answers `status`; log one line per flush period and return the fetch mock. */
  async function postTwice(status: number): Promise<ReturnType<typeof vi.fn>> {
    vi.useFakeTimers(); // Drive the sink's setInterval by hand.
    const fetchMock = vi.fn(async () => new Response(null, { status })); // Server stand-in (Node has the Fetch API Response).
    vi.stubGlobal('fetch', fetchMock); // The sink calls the global fetch.
    vi.stubGlobal('addEventListener', vi.fn()); // Node has no window-level addEventListener (pagehide hook).
    const sink = createHttpSink('20261018_000000_abcd', 250); // 250 ms flush period.
    sink('first', record); // Queue a line...
    await vi.advanceTimersByTimeAsync(250); // ...flush it and let the response promise settle.
    sink('second', record); // Queue another line after the first answer.
    await vi.advanceTimersByTimeAsync(1000); // Several more flush periods.
    return fetchMock;
  }

  afterEach(() => {
    vi.useRealTimers(); // Drop the sink's fake interval.
    vi.unstubAllGlobals(); // Restore fetch/addEventListener.
  });

  it.each([404, 405, 501])('stops posting after a %i answer (no log endpoint: static hosting)', async (status) => {
    expect(await postTwice(status)).toHaveBeenCalledTimes(1); // Only the first batch was attempted.
  });

  it('keeps posting after a transient 500 answer', async () => {
    expect(await postTwice(500)).toHaveBeenCalledTimes(2); // The later batch still went out.
  });
});
