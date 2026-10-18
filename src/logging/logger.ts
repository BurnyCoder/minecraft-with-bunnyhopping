// Timestamped, level-filtered logger with pluggable output sinks.
// Global context: every module (game client, physics, world streaming, experiments) logs through this one API so that
// all events end up as identical "[ISO] [LEVEL] [module] message" lines both in the terminal and in logs/*.log files.
// The browser wires a console sink + an HTTP sink (posted to the Vite dev-server log plugin, server/logPlugin.ts);
// Node scripts wire a console sink + a file sink (src/logging/nodeFileSink.ts). This file has no DOM or Node imports,
// so it runs unchanged in both environments.
// Design follows the common "logger + transports" pattern (e.g. winston transports: https://github.com/winstonjs/winston#transports).

/** Severity levels in increasing order of importance (same ordering as the browser console API). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric rank per level so filtering is a single integer comparison. */
const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }; // Gaps leave room for future levels.

/** One log event before formatting. `data` is optional structured context serialised as JSON. */
export interface LogRecord {
  ts: string; // ISO-8601 UTC timestamp, e.g. 2026-10-18T17:00:00.000Z (Date.prototype.toISOString).
  level: LogLevel; // Severity of the event.
  module: string; // Short name of the emitting subsystem (e.g. "world", "physics").
  message: string; // Human-readable text, never truncated.
  data?: unknown; // Optional machine-readable payload.
}

/** A sink receives the fully formatted line plus the raw record (for sinks that want structure, e.g. console levels). */
export type LogSink = (line: string, record: LogRecord) => void;

/** Process-wide logging state: active threshold and the list of sinks. */
const state: { level: LogLevel; sinks: LogSink[] } = { level: 'info', sinks: [] }; // Defaults until configureLogging runs.

/** Replace the global level/sinks. Called once at startup by the game (src/main.ts) or by a Node script. */
export function configureLogging(options: { level: LogLevel; sinks: LogSink[] }): void {
  state.level = options.level; // New threshold applies immediately to every existing logger.
  state.sinks = [...options.sinks]; // Copy so callers cannot mutate our list afterwards.
}

/** Render a record as one line: [ts] [LEVEL] [module] message {json}. Pure function, unit-tested. */
export function formatRecord(record: LogRecord): string {
  const head = `[${record.ts}] [${record.level.toUpperCase()}] [${record.module}] ${record.message}`; // Fixed-order prefix.
  return record.data === undefined ? head : `${head} ${safeJson(record.data)}`; // Append JSON payload only when present.
}

/** JSON.stringify that never throws (cyclic structures or BigInt degrade to a marker instead of crashing the game). */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value); // Normal path: compact JSON on one line.
  } catch (error) {
    return `"<unserialisable: ${String(error)}>"`; // Fallback keeps the log line valid and explains why.
  }
}

/** Module-scoped logger facade; one per subsystem, e.g. `const log = createLogger('world')`. */
export interface Logger {
  debug(message: string, data?: unknown): void; // Verbose diagnostics (off by default).
  info(message: string, data?: unknown): void; // Normal lifecycle events.
  warn(message: string, data?: unknown): void; // Recoverable problems.
  error(message: string, data?: unknown): void; // Failures.
}

/** Create a logger that stamps every record with `module` and the current time. */
export function createLogger(module: string): Logger {
  const emit = (level: LogLevel, message: string, data?: unknown): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[state.level]) return; // Below threshold: skip all formatting work.
    const record: LogRecord = { ts: new Date().toISOString(), level, module, message, data }; // Timestamp at emit time.
    const line = formatRecord(record); // Format once, share with all sinks.
    for (const sink of state.sinks) sink(line, record); // Fan out (console, file, HTTP...).
  };
  return {
    debug: (message, data) => emit('debug', message, data), // Bind each level to the shared emitter.
    info: (message, data) => emit('info', message, data),
    warn: (message, data) => emit('warn', message, data),
    error: (message, data) => emit('error', message, data),
  };
}

/** Sink that prints to the JS console using the matching console method (works in browsers and Node). */
export const consoleSink: LogSink = (line, record) => {
  const method = record.level === 'debug' ? 'debug' : record.level; // console.debug/info/warn/error all exist.
  console[method](line); // Browser devtools / Node terminal show the full line.
};

/** Parse a user-supplied level string, falling back to `fallback` for anything unknown. */
export function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  return value !== undefined && value in LEVEL_RANK ? (value as LogLevel) : fallback; // Only accept the four known names.
}
