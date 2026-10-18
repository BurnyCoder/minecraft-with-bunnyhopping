// Tests for the pure helpers of server/logPlugin.ts (the Vite dev-server endpoint that writes browser logs to disk).
// Global context: the endpoint accepts a client-chosen session id that becomes part of a file path, so it must reject
// anything that could escape the logs/ folder (path traversal).
import { describe, expect, it } from 'vitest'; // Vitest API.
import { isValidSessionId, logFileFor, splitLines } from '../../server/logPlugin'; // Units under test.
import { createSessionId } from '../../src/logging/httpSink'; // Client-side generator must satisfy the server check.

describe('isValidSessionId', () => {
  it('accepts ids produced by the client generator', () => {
    expect(isValidSessionId(createSessionId(new Date(2026, 9, 18, 17, 5, 9)))).toBe(true); // Round-trip contract.
  });

  it('rejects path traversal and junk', () => {
    for (const bad of ['../../etc/passwd', '20261018_171500_ab12/../x', '', 'a'.repeat(200), null]) {
      expect(isValidSessionId(bad)).toBe(false); // None of these may reach the filesystem.
    }
  });
});

describe('logFileFor / splitLines', () => {
  it('maps a session to logs/game_<session>.log', () => {
    expect(logFileFor('/repo/logs', '20261018_171500_ab12').replaceAll('\\', '/')).toBe('/repo/logs/game_20261018_171500_ab12.log');
  });

  it('splits a batched body into non-empty lines', () => {
    expect(splitLines('a\nb\r\n\nc\n')).toEqual(['a', 'b', 'c']); // Handles CRLF and blank lines.
  });
});
