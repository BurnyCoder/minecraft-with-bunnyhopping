// End-to-end check of the whole game in a real browser: starts the Vite dev server (with the log-file plugin), opens
// the game in headless Chrome with ?autoplay=N, saves screenshots during the run, waits for the "autoplay finished"
// line in logs/game_<session>.log, and validates it. Usage: npm run e2e -- [--seconds 10] [--preset css_bhop|css_vanilla]
// Global context: the in-app browser pane pauses requestAnimationFrame while hidden, so automated verification needs a
// browser we control. The page's own logs are the test oracle, as they would be for a person checking after playing.
// Screenshots land in logs/screenshots/ for visual inspection (terrain, textures, HUD, face winding).
// APIs: Vite createServer (https://vite.dev/guide/api-javascript.html#createserver) and puppeteer-core driving an
// installed Chrome/Edge without downloading a browser (https://pptr.dev/guides/installation#installing-puppeteer-core).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'; // Log polling.
import { tmpdir } from 'node:os'; // Throwaway Chrome profile location.
import { join } from 'node:path'; // Paths.
import { parseArgs } from 'node:util'; // CLI flags (https://nodejs.org/api/util.html#utilparseargsconfig).
import puppeteer from 'puppeteer-core'; // Browser automation over the DevTools protocol.
import { createServer } from 'vite'; // Programmatic dev server.
import { configureLogging, consoleSink, createLogger } from '../src/logging/logger'; // Project logger.
import { createFileSink, fileTimestamp } from '../src/logging/nodeFileSink'; // Log file sink.

/** E2E port, distinct from the interactive dev server (5173) so both can run at once. */
const PORT = 5199;
const LOGS = join(process.cwd(), 'logs'); // Where the dev-server plugin writes game logs.

/** Find a Chrome/Chromium/Edge executable: CHROME_PATH, then common install locations. */
function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH, // Explicit override.
    'C:/Program Files/Google/Chrome/Application/chrome.exe', // Windows Chrome.
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', // Windows Edge.
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS.
    '/usr/bin/google-chrome', // Linux (preinstalled on GitHub ubuntu runners).
    '/usr/bin/chromium',
  ];
  const found = candidates.find((path) => path !== undefined && existsSync(path)); // First existing file.
  if (found === undefined) throw new Error('No Chrome found; set CHROME_PATH'); // Cannot run without a browser.
  return found;
}

/** Newest game log created after `since` (ms epoch), or null. */
function newestLog(since: number): string | null {
  if (!existsSync(LOGS)) return null; // Plugin not started yet.
  const files = readdirSync(LOGS)
    .filter((name) => name.startsWith('game_') && name.endsWith('.log')) // Browser session logs only.
    .map((name) => join(LOGS, name))
    .filter((path) => statSync(path).birthtimeMs >= since - 1000); // Created by this run.
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null; // Most recent.
}

/** Sleep helper. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Run the check; returns the process exit code. */
async function main(): Promise<number> {
  const { values } = parseArgs({ options: { seconds: { type: 'string', default: '10' }, preset: { type: 'string', default: 'css_bhop' } } }); // Flags.
  const stamp = fileTimestamp(); // Names this run's artefacts.
  configureLogging({ level: 'info', sinks: [consoleSink, createFileSink(join(LOGS, `e2e_${stamp}.log`))] }); // Terminal + file.
  const log = createLogger('e2e'); // Script logger.
  const seconds = Number(values.seconds); // Autoplay duration.
  const shots = join(LOGS, 'screenshots'); // Screenshot folder.
  mkdirSync(shots, { recursive: true }); // Ensure it exists.
  const started = Date.now(); // To find this run's log file.
  const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'warn' }); // Uses vite.config.ts (log plugin included).
  await server.listen(); // Serve the game.
  const url = `http://localhost:${PORT}/?autoplay=${seconds}&preset=${values.preset}`; // Autoplay page.
  const executablePath = findChrome(); // Browser binary.
  log.info('launching headless browser', { executablePath, url }); // What we run.
  const browser = await puppeteer.launch({
    executablePath, // Installed Chrome/Edge.
    headless: true, // Chrome's new headless mode (real rendering, rAF at 60 Hz).
    userDataDir: join(tmpdir(), 'bhopcraft-e2e-profile'), // Never touch the user's real profile.
    defaultViewport: { width: 1280, height: 720 }, // Deterministic viewport.
    args: ['--enable-unsafe-swiftshader'], // Allow software WebGL on GPU-less CI machines.
  });
  const pageErrors: string[] = []; // Uncaught exceptions / console errors in the page.
  try {
    const page = await browser.newPage(); // One tab.
    page.on('pageerror', (error) => pageErrors.push(String(error))); // Uncaught exceptions.
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text()); // console.error output (includes WebGL errors).
    });
    await page.goto(url, { waitUntil: 'load' }); // Start the game.
    const deadline = Date.now() + (seconds + 40) * 1000; // Generous timeout (startup + run).
    const shotTimes = [1.5, seconds / 2, seconds - 0.5].map((s) => Date.now() + s * 1000); // When to capture.
    while (Date.now() < deadline) {
      await sleep(250); // Poll four times per second.
      while (shotTimes.length > 0 && Date.now() >= shotTimes[0]) {
        const path = join(shots, `e2e_${stamp}_${values.preset}_${(shotTimes.length === 3 ? 'start' : shotTimes.length === 2 ? 'mid' : 'end')}.png`) as `${string}.png`; // File name.
        await page.screenshot({ path }); // Capture what the player sees.
        log.info('screenshot saved', { path });
        shotTimes.shift(); // Next one.
      }
      const file = newestLog(started); // This run's log.
      if (file === null) continue; // Not created yet.
      const text = readFileSync(file, 'utf8'); // Whole log.
      const line = text.split('\n').find((l) => l.includes('autoplay finished')); // Summary line.
      if (line === undefined) continue; // Still running.
      const summary = JSON.parse(line.slice(line.indexOf('{'))); // Structured payload.
      const errors = text.split('\n').filter((l) => l.includes('[ERROR]')); // Error lines in the game log.
      const statuses = text.split('\n').filter((l) => l.includes('] status ')); // 1 Hz lines.
      const problems: string[] = []; // Failed checks.
      if (summary.editCheck !== 'passed') problems.push('block place/break check failed'); // Interaction broken.
      if (summary.walkTicksAfterStart !== 0) problems.push('friction ticks during bhop'); // Timing broken.
      if (summary.relativeError !== null && Math.abs(summary.relativeError) > 1e-6) problems.push(`speed deviates from closed form by ${summary.relativeError}`); // Physics broken.
      if (errors.length > 0) problems.push(`${errors.length} ERROR lines in the game log`); // Runtime errors.
      if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join(' | ')}`); // Browser-side errors.
      if (statuses.length === 0) problems.push('no status lines (game loop not running?)'); // Loop dead.
      log.info('autoplay summary', { logFile: file, statusLines: statuses.length, ...summary }); // Report.
      if (problems.length > 0) log.error('e2e FAILED', { problems });
      else log.info('e2e PASSED');
      return problems.length > 0 ? 1 : 0; // Exit code.
    }
    log.error('e2e FAILED: timed out waiting for "autoplay finished"', { pageErrors }); // Never finished.
    return 1;
  } finally {
    await browser.close(); // Close Chrome.
    await server.close(); // Stop Vite.
  }
}

main().then((code) => process.exit(code)); // Propagate the result to npm / CI.
