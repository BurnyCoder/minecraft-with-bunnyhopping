// Browser logging bootstrap: wires the console sink and the dev-server HTTP sink, then reports config warnings.
// Global context: this is phase 2 of src/main.ts; after it runs, every createLogger() call writes to the browser
// console, the `npm run dev` terminal and logs/game_<session>.log at the same time.
import type { GameConfig } from '../config'; // Parsed configuration (level + warnings).
import { createHttpSink, createSessionId } from './httpSink'; // Batched POST to /__log.
import { configureLogging, consoleSink, createLogger, type Logger } from './logger'; // Core logger.

/** Configure sinks for this page load and return the top-level "main" logger. */
export function initLogging(config: GameConfig): Logger {
  const sessionId = createSessionId(); // Names this page load's log file.
  configureLogging({ level: config.logLevel, sinks: [consoleSink, createHttpSink(sessionId)] }); // Console + file.
  const log = createLogger('main'); // Logger for lifecycle events.
  log.info('logging initialised', { sessionId, logFile: `logs/game_${sessionId}.log`, level: config.logLevel }); // Where to look.
  for (const warning of config.warnings) log.warn(warning); // Surface rejected .env/URL values.
  return log; // Caller keeps using it.
}
