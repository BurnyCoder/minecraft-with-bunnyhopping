// BhopCraft entry point: the single top-level wrapper that runs the game's phases in order.
// Global context: each phase is a small, clearly named function imported from its own module; this file only wires
// them together so the startup sequence reads top to bottom:
//   loadConfig -> initLogging -> (createRenderer -> createWorld -> spawnPlayer -> createHud -> bindInput -> startGameLoop)
// The bracketed phases are added by later build steps (see README.md "Data flow").
import { loadConfig } from './config'; // Phase 1: .env + URL -> GameConfig.
import { initLogging } from './logging/setup'; // Phase 2: console + log-file sinks.

/** Run all startup phases. Errors are logged (and shown) instead of failing silently. */
function main(): void {
  const config = loadConfig(); // Phase 1: read and validate configuration.
  const log = initLogging(config); // Phase 2: start logging (file + terminal + console).
  log.info('BhopCraft starting', { preset: config.preset, seed: config.seed, renderDistance: config.renderDistance }); // Startup summary.
}

main(); // Vite loads this module once per page.
