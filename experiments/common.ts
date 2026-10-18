// Shared helpers for the movement experiments (experiments/exp01-*.ts, exp02-*.ts).
// Global context: experiments run the game's own physics (src/physics) headless in Node, so measured behaviour is
// exactly the shipped behaviour. This module provides the flat test floor, a simulation loop, data output to
// reports/data/, and logging (terminal + logs/experiments_<timestamp>.log).
import { mkdirSync, writeFileSync } from 'node:fs'; // Data files.
import { join } from 'node:path'; // Paths.
import { Vector3 } from 'three'; // Vector math.
import { configureLogging, consoleSink, createLogger, type Logger } from '../src/logging/logger'; // Project logger.
import { createFileSink, fileTimestamp } from '../src/logging/nodeFileSink'; // File sink.
import type { VoxelQuery } from '../src/physics/collision'; // World interface.
import { DIST_EPSILON } from '../src/physics/constants'; // Surface gap.
import type { Cvars } from '../src/physics/cvars'; // Tunables.
import { playerMove, type TickEvents } from '../src/physics/movement'; // The movement port.
import { createPlayerState, horizontalSpeed, type PlayerState, type UserCmd } from '../src/physics/player'; // State.

/** Infinite flat floor: every block with z < 0 is solid, so the floor surface is z = 0. */
export const FLAT_FLOOR: VoxelQuery = { isSolid: (_x, _y, z) => z < 0 };

/** Output folder for experiment data. */
export const DATA_DIR = join(process.cwd(), 'reports', 'data');

/** Configure logging once per process; returns a module logger. */
export function experimentLogger(module: string): Logger {
  configureLogging({ level: 'info', sinks: [consoleSink, createFileSink(join(process.cwd(), 'logs', `experiments_${fileTimestamp()}.log`))] }); // Terminal + file.
  return createLogger(module);
}

/** Write a JSON file into reports/data (pretty-printed for diffs). */
export function writeData(name: string, data: unknown): string {
  mkdirSync(DATA_DIR, { recursive: true }); // Ensure folder.
  const path = join(DATA_DIR, name); // Target file.
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`, 'utf8'); // One value per line-ish, still compact.
  return path;
}

/** A grounded player at the origin moving along +x at `speed` u/s. */
export function groundedPlayer(speed: number): PlayerState {
  const player = createPlayerState(new Vector3(0, 0, DIST_EPSILON)); // On the floor surface.
  player.onGround = true; // Already categorised.
  player.velocity.set(speed, 0, 0); // Initial run speed.
  return player;
}

/** Per-tick observation passed to simulation callbacks. */
export interface TickRecord {
  tick: number; // 1-based tick index.
  speedBefore: number; // Horizontal speed before the tick.
  speedAfter: number; // Horizontal speed after the tick.
  wasOnGround: boolean; // Grounded at tick start.
  events: TickEvents; // Jump/landing flags.
}

/** Run `ticks` ticks with commands from `cmdFor`, calling `observe` after each tick. */
export function simulate(world: VoxelQuery, player: PlayerState, cvars: Cvars, ticks: number, cmdFor: (p: PlayerState, tick: number) => UserCmd, observe: (r: TickRecord) => void): void {
  for (let tick = 1; tick <= ticks; tick++) {
    const speedBefore = horizontalSpeed(player); // Pre-tick speed.
    const wasOnGround = player.onGround; // Pre-tick ground state.
    const events = playerMove(world, player, cmdFor(player, tick), cvars); // One movement tick.
    observe({ tick, speedBefore, speedAfter: horizontalSpeed(player), wasOnGround, events }); // Report.
  }
}
