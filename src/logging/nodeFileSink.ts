// Node-only log sink that appends each formatted line to a file (used by experiments/*.ts run with tsx).
// Global context: the browser reaches disk through httpSink.ts + server/logPlugin.ts; Node scripts write directly with
// this sink. It lives in its own module so browser bundles never import node:fs.
// API: fs.appendFileSync / fs.mkdirSync (https://nodejs.org/api/fs.html#fsappendfilesyncpath-data-options).
import { appendFileSync, mkdirSync } from 'node:fs'; // Synchronous appends keep line order exact.
import { dirname } from 'node:path'; // Parent directory of the log file.
import type { LogSink } from './logger'; // Shared sink signature.

/** Create a sink that appends `line + "\n"` to `filePath`, creating parent folders first. */
export function createFileSink(filePath: string): LogSink {
  mkdirSync(dirname(filePath), { recursive: true }); // Ensure logs/ exists (no error if it already does).
  return (line) => appendFileSync(filePath, `${line}\n`, 'utf8'); // One line per record, never truncated.
}

/** Timestamp string for log file names, e.g. 20261018_171500 (local time, sortable). */
export function fileTimestamp(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0'); // Two-digit zero padding.
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
