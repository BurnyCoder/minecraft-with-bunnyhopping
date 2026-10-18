// Fixed-timestep accumulator: converts variable frame times into a whole number of fixed physics ticks per frame,
// plus an interpolation factor for smooth rendering between the last two tick states.
// Global context: game/loop.ts asks advance(frameSeconds) each animation frame and runs that many playerMove() ticks,
// so movement (and therefore bhop speed gain) is identical at 30, 60 or 240 fps, as on a Source server's tickrate.
// Pattern: Glenn Fiedler, "Fix Your Timestep!" (https://gafferongames.com/post/fix_your_timestep/), including a cap on
// simulated time per frame that avoids the "spiral of death" after long stalls (tab switches, GC pauses). The cap is in
// seconds, not ticks, so high tick rates (down to tick_interval 0.001) still run in real time.

/** Accumulates real time and hands out fixed ticks. */
export class FixedStepper {
  private accumulator = 0; // Unsimulated real time, seconds.

  constructor(
    public tickInterval: number, // Seconds per tick (cvars.tick_interval); public so the console can change it live.
    private readonly maxFrameSeconds: number, // Most simulated time per frame (backlog beyond it is dropped).
  ) {}

  /** Add a frame's duration; return how many ticks to simulate now. */
  advance(frameSeconds: number): number {
    this.accumulator += Math.max(0, frameSeconds); // Ignore negative clock jumps.
    const maxTicks = Math.max(1, Math.floor(this.maxFrameSeconds / this.tickInterval + 1e-9)); // Cap in ticks for this tick rate.
    let ticks = Math.floor(this.accumulator / this.tickInterval + 1e-9); // Whole ticks available (epsilon absorbs float error).
    if (ticks > maxTicks) {
      ticks = maxTicks; // Cap the work...
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
