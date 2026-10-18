// Vite plugin that adds a POST /__log endpoint to the dev and preview servers.
// The browser game batches its log lines there (src/logging/httpSink.ts); this plugin appends them to
// logs/game_<session>.log and echoes each line to the terminal running `npm run dev`, so logs are visible live in the
// terminal and persisted with timestamps, as the project logging rules require.
// Plugin API: configureServer / configurePreviewServer hooks (https://vite.dev/guide/api-plugin.html#configureserver),
// whose `server.middlewares` is a Connect app (https://github.com/senchalabs/connect#use-middleware).
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'; // Sync appends keep line order (low volume: ~4 batches/s).
import { join, resolve } from 'node:path'; // Path helpers for the logs folder.
import type { IncomingMessage, ServerResponse } from 'node:http'; // Types of the Connect middleware arguments.
import type { Plugin } from 'vite'; // Vite plugin type.

/** URL path of the endpoint; must equal LOG_ENDPOINT in src/logging/httpSink.ts. */
export const LOG_ENDPOINT = '/__log';
/** Session ids look like 20261018_171500_ab12; anything else is rejected (prevents path traversal). */
const SESSION_PATTERN = /^\d{8}_\d{6}_[a-z0-9]{4}$/;
/** Maximum accepted request body (1 MiB) so a buggy client cannot fill the disk in one request. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Maximum size of one session's log file (50 MiB); further batches get 413. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * True for requests from the game's own origin, or with no Origin header (sendBeacon, curl). Browsers attach Origin to
 * cross-site POSTs, and Vite's CORS handling does not block "simple" text/plain POSTs, so this check stops other
 * websites from writing into (and forging lines in) the logs that `npm run e2e` uses as its oracle.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true; // Same-origin beacons/fetches may omit it; non-browser clients too.
  try {
    return new URL(origin).host === host; // Must match the Host the server was addressed with.
  } catch {
    return false; // "null" or malformed origins.
  }
}

/** Replace C0/C1 control characters (ESC, BEL, ...) except tab with "?" so log lines cannot drive the terminal. */
export function sanitizeLine(line: string): string {
  return line.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, '?'); // Keeps the tab character (0x09).
}

/** True when `value` is a well-formed session id. */
export function isValidSessionId(value: string | null): value is string {
  return value !== null && SESSION_PATTERN.test(value); // Regex is anchored, so "../" can never pass.
}

/** Absolute log file path for a session inside `logsDir`. */
export function logFileFor(logsDir: string, session: string): string {
  return join(logsDir, `game_${session}.log`); // One file per page load.
}

/** Split a newline-delimited body into non-empty lines (accepts LF and CRLF). */
export function splitLines(body: string): string[] {
  return body.split(/\r?\n/).filter((line) => line.length > 0); // Drop blank lines from trailing newlines.
}

/** Read the request body as UTF-8 text, refusing bodies larger than MAX_BODY_BYTES. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []; // Raw chunks as they stream in.
    let size = 0; // Running byte count.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length; // Track size before buffering more.
      if (size > MAX_BODY_BYTES) {
        reject(new Error('log body too large')); // Abort oversize uploads.
        req.destroy(); // Stop reading from the socket.
        return;
      }
      chunks.push(chunk); // Keep the chunk.
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8'))); // Whole body decoded once.
    req.on('error', reject); // Propagate socket errors.
  });
}

/** Build the Connect middleware that handles POST /__log?session=<id> (exported for tests). */
export function createMiddleware(logsDir: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = new URL(req.url ?? '', 'http://localhost'); // Base is irrelevant; we only need path + query.
    if (url.pathname !== LOG_ENDPOINT) return next(); // Not ours: let Vite handle it.
    if (req.method !== 'POST') {
      res.statusCode = 405; // Method Not Allowed.
      res.end();
      return;
    }
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
      res.statusCode = 403; // Forbidden: another website is posting.
      res.end();
      return;
    }
    const session = url.searchParams.get('session'); // Client-chosen id.
    if (!isValidSessionId(session)) {
      res.statusCode = 400; // Bad Request: refuse anything that could escape logs/.
      res.end();
      return;
    }
    readBody(req)
      .then((body) => {
        const lines = splitLines(body).map(sanitizeLine); // Individual lines, control characters neutralised.
        const file = logFileFor(logsDir, session); // This session's file.
        if (existsSync(file) && statSync(file).size + body.length > MAX_FILE_BYTES) {
          res.statusCode = 413; // Session file is full.
          res.end();
          return;
        }
        if (lines.length > 0) {
          appendFileSync(file, `${lines.join('\n')}\n`, 'utf8'); // Persist, untruncated.
          for (const line of lines) process.stdout.write(`[browser ${session}] ${line}\n`); // Live terminal echo.
        }
        res.statusCode = 204; // No Content: success without a body.
        res.end();
      })
      .catch(() => {
        res.statusCode = 413; // Payload Too Large (or read error).
        res.end();
      });
  };
}

/** The plugin: registers the middleware on both `vite` (dev) and `vite preview` servers. */
export function logFilePlugin(rootDir: string = process.cwd()): Plugin {
  const logsDir = resolve(rootDir, 'logs'); // <repo>/logs, gitignored.
  return {
    name: 'bhopcraft-log-file', // Shown in Vite's plugin diagnostics.
    configureServer(server) {
      mkdirSync(logsDir, { recursive: true }); // Create logs/ on first start.
      server.middlewares.use(createMiddleware(logsDir)); // Dev server hook.
    },
    configurePreviewServer(server) {
      mkdirSync(logsDir, { recursive: true }); // Same for `vite preview`.
      server.middlewares.use(createMiddleware(logsDir)); // Preview server hook.
    },
  };
}
