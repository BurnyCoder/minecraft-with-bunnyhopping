// Tests for the DOM-free part of src/game/input.ts: turning held keys, mouse motion and wheel notches into UserCmds.
// Global context: CS:S players bind jump to the mouse wheel ("bind mwheeldown +jump"); each notch must press jump for
// exactly one tick (so anti-pogo allows the next jump), even if the notch happens on a frame where no tick runs.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { InputState } from '../../src/game/input'; // Unit under test.
import { IN_JUMP } from '../../src/physics/player'; // Button bit.

describe('InputState', () => {
  it('maps WASD to Source forward/side moves of +-400', () => {
    const input = new InputState(2); // Sensitivity 2.
    input.setKey('KeyW', true); // Forward.
    input.setKey('KeyD', true); // Right.
    const cmd = input.buildCmd(); // One tick.
    expect(cmd.forwardmove).toBe(400); // cl_forwardspeed.
    expect(cmd.sidemove).toBe(400); // cl_sidespeed, positive = right.
    input.setKey('KeyW', false); // Release W...
    input.setKey('KeyS', true); // ...hold S.
    expect(input.buildCmd().forwardmove).toBe(-400); // Backwards.
  });

  it('latches a wheel notch until exactly one tick consumes it', () => {
    const input = new InputState(2); // Fresh state.
    input.wheel(); // Notch between ticks.
    expect(input.buildCmd().buttons & IN_JUMP).toBe(IN_JUMP); // First tick sees the press...
    expect(input.buildCmd().buttons & IN_JUMP).toBe(0); // ...the next tick sees it released.
    input.setKey('Space', true); // Held space bar.
    expect(input.buildCmd().buttons & IN_JUMP).toBe(IN_JUMP); // Held jump every tick.
    expect(input.buildCmd().buttons & IN_JUMP).toBe(IN_JUMP);
  });

  it('turns mouse counts into Source angles: yaw -= dx*0.022*sens, pitch += dy*0.022*sens, pitch clamped to 89', () => {
    const input = new InputState(2); // 0.044 degrees per count.
    input.look(100, 0); // Mouse right.
    expect(input.yaw).toBeCloseTo(360 - 4.4, 9); // Turning right lowers Source yaw (wrapped into [0, 360)).
    input.look(0, 10_000); // Far down.
    expect(input.pitch).toBe(89); // Clamped (cl_pitchdown 89).
  });
});
