// Tests for src/game/stepper.ts — the fixed-timestep accumulator ("Fix Your Timestep") that decouples physics ticks
// from the display frame rate.
// Global context: CS:S physics is defined per tick (0.01 s or 0.015 s), so bhop gains must not depend on the monitor's
// refresh rate; the stepper decides how many ticks run each frame and the interpolation factor for rendering.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { FixedStepper } from '../../src/game/stepper'; // Unit under test.

describe('FixedStepper', () => {
  it('runs floor(accumulated / tick) ticks and keeps the remainder as interpolation alpha', () => {
    const stepper = new FixedStepper(0.01, 0.1); // 100 tick, at most 0.1 s of simulation per frame.
    expect(stepper.advance(0.025)).toBe(2); // 2.5 ticks of time -> 2 ticks...
    expect(stepper.alpha).toBeCloseTo(0.5, 9); // ...and half a tick left over.
    expect(stepper.advance(0.005)).toBe(1); // Remainder 0.005 + 0.005 = one more tick.
    expect(stepper.alpha).toBeCloseTo(0, 9); // Nothing left.
  });

  it('runs zero ticks on fast frames (144 Hz display, 100 tick server)', () => {
    const stepper = new FixedStepper(0.01, 0.1); // 100 tick.
    let total = 0; // Ticks run.
    for (let frame = 0; frame < 144; frame++) total += stepper.advance(1 / 144); // One second of frames.
    expect(total).toBe(100); // Exactly 100 ticks per second regardless of frame rate.
  });

  it('keeps real time at very high tick rates (1000 tick at 60 fps runs ~17 ticks per frame)', () => {
    const stepper = new FixedStepper(0.001, 0.1); // 1000 tick (the smallest tick_interval the cvar schema allows).
    let total = 0; // Ticks run.
    for (let frame = 0; frame < 60; frame++) total += stepper.advance(1 / 60); // One second at 60 fps.
    expect(total).toBeGreaterThanOrEqual(999); // No slow motion (float rounding may defer the very last tick).
  });

  it('caps simulated time per frame and drops the excess after a long stall (no spiral of death)', () => {
    const stepper = new FixedStepper(0.01, 0.1); // Cap: 0.1 s = 10 ticks.
    expect(stepper.advance(5)).toBe(10); // A 5 s hitch only runs 10 ticks...
    expect(stepper.alpha).toBeLessThan(1); // ...and does not keep a huge backlog.
  });
});
