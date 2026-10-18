// Browser log sink that batches formatted lines and POSTs them to the Vite dev-server log endpoint (server/logPlugin.ts),
// which appends them to logs/game_<session>.log and echoes them to the terminal in real time.
// Global context: a browser page cannot write files itself, so this sink is how the game's logs reach disk.
// When the page is served statically (no dev server), a 404/405/501 answer disables the sink and the console sink
// remains the only output (GitHub Pages answers POST with 405; Python's http.server with 501). Other failures
// (dev-server restart, network blips) only warn once and later batches keep flowing.
// Batches are split below 60 kB because keepalive fetch and sendBeacon bodies are limited to 64 KiB.
// APIs: fetch keepalive (https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#keepalive) and
// navigator.sendBeacon for the final flush on page hide (https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon).
import type { LogSink } from './logger'; // Sink signature shared by all outputs.

/** Endpoint path served by the dev-server plugin; must match LOG_ENDPOINT in server/logPlugin.ts. */
export const LOG_ENDPOINT = '/__log';
/** Max bytes per request body (keepalive fetch / sendBeacon allow 64 KiB in total). */
const MAX_BATCH_BYTES = 60_000;
/** Answers meaning "this server has no log endpoint", permanent per RFC 9110 §15.5.5, §15.5.6, §15.6.2
 * (https://www.rfc-editor.org/rfc/rfc9110#name-status-codes): Not Found, Method Not Allowed, Not Implemented. */
const NO_ENDPOINT_STATUSES = [404, 405, 501];

/** Group lines into newline-joined bodies of at most `maxBytes` UTF-8 bytes (a longer single line is sent alone). */
export function splitBatches(lines: readonly string[], maxBytes: number): string[] {
  const encoder = new TextEncoder(); // UTF-8 byte counting.
  const batches: string[] = []; // Output bodies.
  let current: string[] = []; // Lines of the batch being built.
  let size = 0; // Its byte size including newlines.
  for (const line of lines) {
    const bytes = encoder.encode(line).length + 1; // Line plus its newline.
    if (current.length > 0 && size + bytes > maxBytes) {
      batches.push(current.join('\n')); // Close the full batch.
      current = [];
      size = 0;
    }
    current.push(line); // Add (alone if it is oversized).
    size += bytes;
  }
  if (current.length > 0) batches.push(current.join('\n')); // Last partial batch.
  return batches;
}

/** Build a per-page-load session id like 20261018_171500_ab12 (sortable timestamp + random suffix). */
export function createSessionId(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0'); // Two-digit zero padding.
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`; // Local time, sortable.
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0'); // 4 base-36 chars to separate same-second tabs.
  return `${stamp}_${suffix}`; // Matches SESSION_PATTERN in server/logPlugin.ts.
}

/** Create the batching HTTP sink. Lines are flushed every `flushMs` and once more when the page is hidden. */
export function createHttpSink(sessionId: string, flushMs = 250): LogSink {
  const url = `${LOG_ENDPOINT}?session=${encodeURIComponent(sessionId)}`; // Session decides the log file name.
  let buffer: string[] = []; // Lines waiting to be sent.
  let disabled = false; // Set when the server says the endpoint does not exist (static hosting).
  let warned = false; // Other failures are reported once in the console.

  const failed = (reason: string): void => {
    if (!warned) console.warn(`log upload failed (${reason}); retrying with later batches`); // Visible once in devtools.
    warned = true;
  };

  const flush = (useBeacon: boolean): void => {
    if (disabled || buffer.length === 0) return; // Nothing to do.
    const bodies = splitBatches(buffer, MAX_BATCH_BYTES); // Respect the 64 KiB keepalive/beacon limit.
    buffer = []; // Clear before sending so re-entrant logs start a new batch.
    for (const body of bodies) {
      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })); // Survives page unload.
        continue; // Beacon is fire-and-forget.
      }
      fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true }) // Async POST.
        .then((response) => {
          if (NO_ENDPOINT_STATUSES.includes(response.status)) disabled = true; // No log plugin here: stop trying.
          else if (!response.ok) failed(`HTTP ${response.status}`); // E.g. 413: keep going with later batches.
        })
        .catch((error) => failed(String(error))); // Dev server restarting etc.
    }
  };

  setInterval(() => flush(false), flushMs); // Periodic batching keeps request count low (4/s by default).
  addEventListener('pagehide', () => flush(true)); // Final flush when the tab closes or navigates away.

  return (line) => {
    if (!disabled) buffer.push(line); // Queue the full, untruncated line.
  };
}
