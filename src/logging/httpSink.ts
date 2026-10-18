// Browser log sink that batches formatted lines and POSTs them to the Vite dev-server log endpoint (server/logPlugin.ts),
// which appends them to logs/game_<session>.log and echoes them to the terminal in real time.
// Global context: a browser page cannot write files itself, so this sink is how the game's logs reach disk.
// When the page is served statically (no dev server), the first failed POST disables the sink and the console sink
// remains the only output.
// APIs: fetch keepalive (https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#keepalive) and
// navigator.sendBeacon for the final flush on page hide (https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon).
import type { LogSink } from './logger'; // Sink signature shared by all outputs.

/** Endpoint path served by the dev-server plugin; must match LOG_ENDPOINT in server/logPlugin.ts. */
export const LOG_ENDPOINT = '/__log';

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
  let disabled = false; // Set after the first network failure (static hosting has no endpoint).

  const flush = (useBeacon: boolean): void => {
    if (disabled || buffer.length === 0) return; // Nothing to do.
    const body = buffer.join('\n'); // Newline-delimited lines; the server splits them again.
    buffer = []; // Clear before sending so re-entrant logs start a new batch.
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })); // Survives page unload.
      return; // Beacon is fire-and-forget.
    }
    fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true }) // Async POST.
      .then((response) => {
        if (!response.ok) disabled = true; // 404 etc. means no log plugin is running: stop trying.
      })
      .catch(() => {
        disabled = true; // Network error: same reasoning.
      });
  };

  setInterval(() => flush(false), flushMs); // Periodic batching keeps request count low (4/s by default).
  addEventListener('pagehide', () => flush(true)); // Final flush when the tab closes or navigates away.

  return (line) => {
    if (!disabled) buffer.push(line); // Queue the full, untruncated line.
  };
}
