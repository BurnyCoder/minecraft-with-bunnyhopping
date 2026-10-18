// Autoplay verification mode (?autoplay=N): a scripted run of the real game, checked from the logs.
// Timeline: settle for 0.3 s, place and then break one block in front of the player (exercises raycast, interaction and
// remeshing), then strafe-jump with the optimal StrafeBot until N seconds have passed. At the end it logs a summary:
// jumps, max/final speed, and the speed predicted by the closed-form strafing theory
// (|v|^2 = |v0|^2 + n * g per air tick, jwchong.com/hl/strafing.html), with the relative error.
// Global context: game/loop.ts asks this object for commands instead of the keyboard while active. The same script runs
// headless in tests/game/autoplay.test.ts, so in-browser logs can be compared with a known-good result.
import type { Logger } from '../logging/logger'; // Logging.
import type { Cvars } from '../physics/cvars'; // Tunables.
import type { TickEvents } from '../physics/movement'; // Per-tick events.
import { emptyCmd, horizontalSpeed, type PlayerState, type UserCmd } from '../physics/player'; // Commands/state.
import { StrafeBot } from '../physics/strafeBot'; // Optimal strafer.
import type { BlockInteraction } from './interaction'; // Block edits.

/** Final report of an autoplay run (also logged). */
export interface AutoplaySummary {
  seconds: number; // Simulated duration.
  editCheck: 'passed' | 'failed'; // Place + break round trip.
  jumps: number; // Jumps performed.
  maxSpeed: number; // Peak horizontal speed, u/s.
  finalSpeed: number; // Horizontal speed at the end, u/s.
  airTicks: number; // Air-move ticks since strafing started.
  walkTicksAfterStart: number; // Ground ticks (friction) after strafing started; 0 for perfect bhops.
  startSpeed: number; // Speed before the first strafing air tick.
  predictedSpeed: number | null; // Closed form (only meaningful with sv_enablebunnyhopping 1 and no collisions).
  relativeError: number | null; // (final - predicted) / predicted.
}

/** Scripted driver; feed it every tick while `active`. */
export class Autoplay {
  summary: AutoplaySummary | null = null; // Set when the run ends.
  private elapsed = 0; // Simulated seconds.
  private edited = false; // Edit check done?
  private editCheck: 'passed' | 'failed' = 'failed'; // Result of the edit check.
  private bot: StrafeBot | null = null; // Created when strafing starts.
  private startSpeed: number | null = null; // Speed at the first air tick.
  private preSpeed = 0; // Speed before the current tick.
  private airTicks = 0; // Air ticks since start.
  private walkTicks = 0; // Ground ticks since start.
  private jumps = 0; // Jumps.
  private maxSpeed = 0; // Peak speed.
  private lastCmd: UserCmd = emptyCmd(); // For the camera.

  constructor(
    private readonly seconds: number, // Run length.
    private readonly interaction: BlockInteraction, // Block edit API.
    private readonly log: Logger, // Output.
  ) {
    log.info('autoplay started', { seconds }); // Mark the start in the log.
  }

  /** True until the run has finished. */
  get active(): boolean {
    return this.summary === null; // Summary marks the end.
  }

  /** View angles of the last command (the camera follows the bot). */
  get view(): { yaw: number; pitch: number } {
    return { yaw: this.lastCmd.viewYaw, pitch: this.lastCmd.viewPitch }; // Degrees.
  }

  /** Command for the next tick (call before playerMove). */
  nextCmd(state: PlayerState, cvars: Cvars): UserCmd {
    this.preSpeed = horizontalSpeed(state); // Speed before this tick's move.
    let cmd = emptyCmd(); // Default: stand still, look along +x.
    if (this.elapsed >= 0.3 && !this.edited) this.runEditCheck(state); // Once, after settling.
    else if (this.edited) {
      this.bot ??= new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: cvars.sv_autobunnyhopping ? 'hold' : 'onGround' }); // Jump policy per preset.
      cmd = this.bot.nextCmd(state, cvars); // Strafe-jump.
    }
    this.lastCmd = cmd; // Camera follows.
    return cmd;
  }

  /** Place a block on the floor ahead, then break it again; both must hit the same cell. */
  private runEditCheck(state: PlayerState): void {
    this.edited = true; // Only once.
    const placed = this.interaction.placeBlock(state, 0, 60); // Look 60 degrees down along +x.
    const broken = this.interaction.breakBlock(state, 0, 60); // Same view: the new block is now the target.
    const ok = placed !== null && broken !== null && broken.block.every((v, i) => v === placed[i]); // Round trip.
    this.editCheck = ok ? 'passed' : 'failed'; // Record.
    this.log.info(`autoplay edit check ${this.editCheck}`, { placed, broken: broken?.block ?? null }); // Report.
  }

  /** Observe the result of a tick (call after playerMove). */
  record(state: PlayerState, events: TickEvents, wasOnGround: boolean, cvars: Cvars): void {
    this.elapsed += cvars.tick_interval; // Advance the script clock.
    if (events.jumped) this.jumps++; // Count hops.
    const speed = horizontalSpeed(state); // After this tick.
    this.maxSpeed = Math.max(this.maxSpeed, speed); // Peak.
    const airTick = events.jumped || !wasOnGround; // The tick used AirMove.
    if (this.bot !== null) {
      if (airTick && this.startSpeed === null) this.startSpeed = this.preSpeed; // First strafing air tick.
      if (this.startSpeed !== null) {
        if (airTick) this.airTicks++; // Closed-form step.
        else this.walkTicks++; // Friction tick: the prediction no longer applies.
      }
    }
    if (this.elapsed >= this.seconds) this.finish(speed, cvars); // Time is up.
  }

  /** Build and log the summary. */
  private finish(finalSpeed: number, cvars: Cvars): void {
    const L = cvars.sv_airspeedcap; // 30.
    const k = cvars.tick_interval * cvars.sv_maxspeed * cvars.sv_airaccelerate; // Max air accel per tick.
    const gain = k >= L ? L * L : k * (2 * L - k); // |v|^2 gain per optimal air tick.
    const v0 = this.startSpeed ?? 0; // Start speed.
    const valid = cvars.sv_enablebunnyhopping && this.walkTicks === 0 && this.startSpeed !== null; // Prediction preconditions.
    const predicted = valid ? Math.sqrt(v0 * v0 + this.airTicks * gain) : null; // Closed form.
    this.summary = {
      seconds: Number(this.elapsed.toFixed(4)),
      editCheck: this.editCheck,
      jumps: this.jumps,
      maxSpeed: this.maxSpeed,
      finalSpeed,
      airTicks: this.airTicks,
      walkTicksAfterStart: this.walkTicks,
      startSpeed: v0,
      predictedSpeed: predicted,
      relativeError: predicted === null ? null : (finalSpeed - predicted) / predicted,
    };
    this.log.info('autoplay finished', this.summary); // The line to inspect in logs/game_*.log.
  }
}
