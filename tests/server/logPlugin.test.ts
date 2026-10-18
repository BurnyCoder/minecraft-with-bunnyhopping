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

describe('request hardening', () => {
  it('allows same-origin or origin-less requests and rejects other origins', async () => {
    const { isAllowedOrigin } = await import('../../server/logPlugin'); // Unit under test.
    expect(isAllowedOrigin(undefined, 'localhost:5173')).toBe(true); // sendBeacon / curl without Origin.
    expect(isAllowedOrigin('http://localhost:5173', 'localhost:5173')).toBe(true); // The game itself.
    expect(isAllowedOrigin('https://evil.example', 'localhost:5173')).toBe(false); // Cross-site POST.
    expect(isAllowedOrigin('not a url', 'localhost:5173')).toBe(false); // Garbage.
  });

  it('strips terminal control and escape characters before echoing or writing', async () => {
    const { sanitizeLine } = await import('../../server/logPlugin'); // Unit under test.
    expect(sanitizeLine('ok\u001b]52;c;ZXZpbA==\u0007done\ttab')).toBe('ok?]52;c;ZXZpbA==?done\ttab'); // OSC 52 neutralised, tab kept.
  });

  it('answers 403 to a cross-origin POST without touching the log file', async () => {
    const { createMiddleware } = await import('../../server/logPlugin'); // Middleware factory.
    const { mkdtempSync, readdirSync } = await import('node:fs'); // Temp folder.
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { EventEmitter } = await import('node:events'); // Minimal request stand-in.
    const dir = mkdtempSync(join(tmpdir(), 'bhopcraft-log-')); // Isolated logs folder.
    const req = Object.assign(new EventEmitter(), { url: '/__log?session=20261018_171500_ab12', method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost:5173' } });
    const res = { statusCode: 200, end: () => undefined }; // Captures the status.
    createMiddleware(dir)(req as never, res as never, () => undefined); // Handle.
    expect(res.statusCode).toBe(403); // Forbidden.
    expect(readdirSync(dir)).toEqual([]); // Nothing written.
  });
});
