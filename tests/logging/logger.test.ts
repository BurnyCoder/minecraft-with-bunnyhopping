// Tests for src/logging/logger.ts — the timestamped, multi-sink logger used by the game, the dev server and experiments.
// Global context: the project rule is "every important event goes to a timestamped log file and the terminal, never truncated",
// so these tests pin the line format, level filtering and the no-truncation guarantee.
import { describe, expect, it } from 'vitest'; // Vitest test API: https://vitest.dev/api/
import { configureLogging, createLogger, formatRecord, type LogRecord } from '../../src/logging/logger'; // Unit under test.

describe('formatRecord', () => {
  it('renders [ISO timestamp] [LEVEL] [module] message', () => {
    const record: LogRecord = { ts: '2026-10-18T17:00:00.000Z', level: 'info', module: 'world', message: 'chunk ready' }; // Fixed input.
    expect(formatRecord(record)).toBe('[2026-10-18T17:00:00.000Z] [INFO] [world] chunk ready'); // Exact line layout.
  });

  it('appends structured data as JSON after the message', () => {
    const record: LogRecord = { ts: 't', level: 'warn', module: 'm', message: 'x', data: { a: 1, b: [2, 3] } }; // With data payload.
    expect(formatRecord(record)).toBe('[t] [WARN] [m] x {"a":1,"b":[2,3]}'); // Data serialised compactly on the same line.
  });
});

describe('createLogger', () => {
  it('drops records below the configured level and forwards the rest to every sink', () => {
    const a: string[] = []; // Lines captured by sink A.
    const b: string[] = []; // Lines captured by sink B.
    configureLogging({ level: 'info', sinks: [(line) => a.push(line), (line) => b.push(line)] }); // Two sinks, info threshold.
    const log = createLogger('test'); // Module-scoped logger.
    log.debug('hidden'); // Below threshold -> dropped.
    log.info('shown'); // At threshold -> kept.
    log.error('also shown'); // Above threshold -> kept.
    expect(a).toHaveLength(2); // Debug line filtered out.
    expect(b).toEqual(a); // Every sink receives identical lines.
    expect(a[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[INFO\] \[test\] shown$/); // Real ISO timestamp is stamped.
  });

  it('never truncates long messages', () => {
    const lines: string[] = []; // Captured output.
    configureLogging({ level: 'debug', sinks: [(line) => lines.push(line)] }); // Capture everything.
    const long = 'x'.repeat(100_000); // 100k characters, far longer than any console default.
    createLogger('big').info(long); // Log it.
    expect(lines[0].endsWith(long)).toBe(true); // Whole message survives intact.
  });
});
