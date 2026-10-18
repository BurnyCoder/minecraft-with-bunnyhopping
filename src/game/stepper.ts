// Fixed-timestep accumulator: converts variable frame times into a whole number of fixed physics ticks per frame,
// plus an interpolation factor for smooth rendering between the last two tick states.
// Global context: game/loop.ts asks advance(frameSeconds) each animation frame and runs that many playerMove() ticks,
// so movement (and therefore bhop speed gain) is identical at 30, 60 or 240 fps, as on a Source server's tickrate.
// Pattern: Glenn Fiedler, "Fix Your Timestep!" (https://gafferongames.com/post/fix_your_timestep/), including the
// max-steps cap that avoids the "spiral of death" after long stalls (tab switches, GC pauses).

/** Accumulates real time and hands out fixed ticks. */
export class FixedStepper {
  private accumulator = 0; // Unsimulated real time, seconds.

  constructor(
    public tickInterval: number, // Seconds per tick (cvars.tick_interval); public so the console can change it live.
    private readonly maxTicksPerFrame: number, // Safety cap per frame.
  ) {}

  /** Add a frame's duration; return how many ticks to simulate now. */
  advance(frameSeconds: number): number {
    this.accumulator += Math.max(0, frameSeconds); // Ignore negative clock jumps.
    let ticks = Math.floor(this.accumulator / this.tickInterval + 1e-9); // Whole ticks available (epsilon absorbs float error).
    if (ticks > this.maxTicksPerFrame) {
      ticks = this.maxTicksPerFrame; // Cap the work...
      this.accumulator = ticks * this.tickInterval; // ...and drop the backlog beyond it.
    }
    this.accumulator = Math.max(0, this.accumulator - ticks * this.tickInterval); // Consume simulated time.
    return ticks;
  }

  /** Fraction of a tick already elapsed beyond the last simulated tick (0..1), for render interpolation. */
  get alpha(): number {
    return Math.min(1, this.accumulator / this.tickInterval); // Normalised remainder.
  }
}
