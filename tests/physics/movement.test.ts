// Tests for src/physics/movement.ts — the port of Source's CGameMovement::FullWalkMove and helpers.
// Global context: these pin the behaviours that make CS:S bunnyhopping what it is: capped ground speed, friction only
// on ground ticks, a jump on the landing tick skipping friction, air acceleration limited by the 30 u/s projected cap
// (so speed comes from strafing, not from holding W), anti-pogo, the 110% bhop clamp and the per-axis velocity clamp.
// Every expected value is derived independently here (hand recurrences / closed forms), not by calling the code under test.
import { Vector3 } from 'three'; // Vector math.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { DIST_EPSILON, JUMP_IMPULSE } from '../../src/physics/constants'; // Physical constants.
import { cvarsFromPreset, type Cvars } from '../../src/physics/cvars'; // Presets.
import { playerMove } from '../../src/physics/movement'; // Unit under test.
import { createPlayerState, emptyCmd, horizontalSpeed, IN_JUMP, type PlayerState, type UserCmd } from '../../src/physics/player';
import { StrafeBot } from '../../src/physics/strafeBot'; // Optimal strafer used for the closed-form check.
import { TestWorld } from '../helpers/worlds'; // Exact geometry.

/** Player standing on TestWorld's floor (surface z = 0), already grounded. */
function grounded(vx = 0, vy = 0): PlayerState {
  const player = createPlayerState(new Vector3(0, 0, DIST_EPSILON)); // Resting DIST_EPSILON above the surface.
  player.onGround = true; // As if a previous tick had categorised it.
  player.velocity.set(vx, vy, 0); // Initial horizontal speed.
  return player;
}

/** Player high in the air (no floor below) so every tick is an air tick. */
function airborne(vx = 0, vy = 0): PlayerState {
  const player = createPlayerState(new Vector3(0, 0, 1e6)); // Far above everything.
  player.velocity.set(vx, vy, 0); // Initial horizontal speed.
  return player;
}

/** Command with the given fields set on top of an empty command. */
function cmd(fields: Partial<UserCmd>): UserCmd {
  return { ...emptyCmd(), ...fields }; // Defaults: no move, no buttons, yaw 0.
}

describe('ground movement', () => {
  it('accelerates to exactly sv_maxspeed (250) and never exceeds it', () => {
    for (const preset of ['css_bhop', 'css_vanilla'] as const) {
      const cvars = cvarsFromPreset(preset); // Both tick rates.
      const player = grounded(); // From rest.
      let maxSeen = 0; // Highest speed observed.
      for (let tick = 0; tick < 400; tick++) {
        playerMove(new TestWorld(), player, cmd({ forwardmove: 400 }), cvars); // Hold W.
        maxSeen = Math.max(maxSeen, horizontalSpeed(player)); // Track the peak.
      }
      expect(maxSeen).toBeLessThanOrEqual(250 + 1e-9); // Ground speed is capped at maxspeed.
      expect(horizontalSpeed(player)).toBeCloseTo(250, 9); // And reaches it.
    }
  });

  it('decelerates by Source friction: v -= max(v, stopspeed) * friction * dt, snapping to 0 below 1 u/s', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // dt = 0.015.
    const player = grounded(250); // Running at full speed, then release all keys.
    let expected = 250; // Independent recurrence.
    for (let tick = 0; tick < 200; tick++) {
      if (expected >= 0.1) expected = Math.max(expected - Math.max(expected, cvars.sv_stopspeed) * cvars.sv_friction * cvars.tick_interval, 0); // Friction().
      if (expected < 1) expected = 0; // WalkMove: spd < 1 => velocity cleared.
      playerMove(new TestWorld(), player, emptyCmd(), cvars); // Simulate one tick.
      expect(horizontalSpeed(player)).toBeCloseTo(expected, 9); // Same value every tick.
    }
    expect(horizontalSpeed(player)).toBe(0); // Fully stopped.
  });
});

describe('jumping', () => {
  it('adds sqrt(2*800*57) and follows Source split gravity (apex from an independent per-tick sum)', () => {
    for (const dt of [0.015, 0.01]) {
      const cvars: Cvars = { ...cvarsFromPreset('css_vanilla'), tick_interval: dt }; // Tick length under test.
      const g = cvars.sv_gravity; // 800.
      const player = grounded(); // Standing still.
      playerMove(new TestWorld(), player, cmd({ buttons: IN_JUMP }), cvars); // Jump tick.
      expect(player.velocity.z).toBeCloseTo(JUMP_IMPULSE - 1.5 * g * dt, 9); // Start/jump/finish half-gravity steps.
      // Oracle: jump tick = -g dt/2, +J, -g dt/2, move, -g dt/2; later ticks = -g dt/2, move, -g dt/2.
      let vz = -0.5 * g * dt + JUMP_IMPULSE - 0.5 * g * dt; // Velocity used for the jump tick's move.
      let z = vz * dt; // Height after the jump tick.
      vz -= 0.5 * g * dt; // Final half step of the jump tick.
      let apex = z; // Track maximum.
      while (vz > -1000) {
        vz -= 0.5 * g * dt; // StartGravity.
        z += vz * dt; // Move.
        vz -= 0.5 * g * dt; // FinishGravity.
        apex = Math.max(apex, z); // Peak height.
      }
      let simApex = player.origin.z - DIST_EPSILON; // Simulated height above the start.
      for (let tick = 0; tick < 200; tick++) {
        playerMove(new TestWorld(), player, emptyCmd(), cvars); // Fall back down.
        simApex = Math.max(simApex, player.origin.z - DIST_EPSILON); // Peak height.
      }
      expect(simApex).toBeCloseTo(apex, 9); // Matches the oracle exactly.
      expect(apex).toBeGreaterThan(52); // Clears a 1-block (40 u) ledge comfortably...
      expect(apex).toBeLessThan(JUMP_HEIGHT_LIMIT); // ...but stays below the continuous-time 57 u.
      expect(player.onGround).toBe(true); // Landed again.
    }
  });

  it('does not pogo: holding jump without sv_autobunnyhopping jumps only once', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // Auto-bhop off.
    const player = grounded(); // On the floor.
    let jumps = 0; // Ground -> air transitions caused by jumping.
    for (let tick = 0; tick < 300; tick++) if (playerMove(new TestWorld(), player, cmd({ buttons: IN_JUMP }), cvars).jumped) jumps++; // Hold.
    expect(jumps).toBe(1); // Must release and press again.
  });

  it('re-jumps on every landing when sv_autobunnyhopping is on', () => {
    const cvars = cvarsFromPreset('css_bhop'); // Auto-bhop on.
    const player = grounded(); // On the floor.
    let jumps = 0; // Count.
    for (let tick = 0; tick < 300; tick++) if (playerMove(new TestWorld(), player, cmd({ buttons: IN_JUMP }), cvars).jumped) jumps++; // Hold.
    expect(jumps).toBeGreaterThanOrEqual(3); // 3 s of holding = several hops.
  });
});

describe('bunnyhopping', () => {
  it('keeps speed exactly when the jump lands on the landing tick (friction skipped)', () => {
    for (const preset of ['css_bhop', 'css_vanilla'] as const) {
      const cvars = cvarsFromPreset(preset); // Hold-jump (auto) or perfectly timed presses (vanilla).
      const player = grounded(250); // Running speed.
      let jumps = 0; // Hop count.
      for (let tick = 0; tick < 500; tick++) {
        const buttons = preset === 'css_bhop' || player.onGround ? IN_JUMP : 0; // Vanilla: press only on landing ticks.
        if (playerMove(new TestWorld(), player, cmd({ buttons }), cvars).jumped) jumps++; // Simulate.
      }
      expect(jumps).toBeGreaterThanOrEqual(5); // Several landings happened.
      expect(horizontalSpeed(player)).toBeCloseTo(250, 9); // No friction was ever applied.
    }
  });

  it('loses exactly one friction step per landing when the jump comes one tick late', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // dt = 0.015, friction 4.
    const player = grounded(250); // Running.
    playerMove(new TestWorld(), player, emptyCmd(), cvars); // One ground tick without jumping (the "late" tick).
    playerMove(new TestWorld(), player, cmd({ buttons: IN_JUMP }), cvars); // Jump on the next tick: no friction.
    expect(horizontalSpeed(player)).toBeCloseTo(250 * (1 - cvars.sv_friction * cvars.tick_interval), 9); // 250 * 0.94.
  });

  it('gains nothing in the air from holding W only (30 u/s projected cap)', () => {
    const cvars = cvarsFromPreset('css_bhop'); // Huge air accel...
    const fast = airborne(250); // Already moving forward.
    for (let tick = 0; tick < 300; tick++) playerMove(new TestWorld(false), fast, cmd({ forwardmove: 400 }), cvars); // Hold W.
    expect(horizontalSpeed(fast)).toBeCloseTo(250, 9); // ...but no gain along the velocity.
    const slow = airborne(); // From rest in the air.
    for (let tick = 0; tick < 300; tick++) playerMove(new TestWorld(false), slow, cmd({ forwardmove: 400 }), cvars); // Hold W.
    expect(horizontalSpeed(slow)).toBeCloseTo(30, 9); // Reaches exactly the air speed cap.
  });

  it('matches the closed-form optimal air-strafe gain |v_n|^2 = |v_0|^2 + n*g (jwchong strafing theory)', () => {
    const cases = [
      { dt: 0.01, airaccel: 1000 }, // k = 2500 >= 30: g = L^2.
      { dt: 0.01, airaccel: 1 }, // k = 2.5 < 30: g = k(2L - k).
      { dt: 0.0078125, airaccel: 10 }, // 128 tick, k = 19.53 < 30.
    ];
    for (const { dt, airaccel } of cases) {
      const cvars: Cvars = { ...cvarsFromPreset('css_bhop'), tick_interval: dt, sv_airaccelerate: airaccel }; // Case cvars.
      const L = cvars.sv_airspeedcap; // 30.
      const k = airaccel * cvars.sv_maxspeed * dt; // Max speed added per tick by AirAccelerate.
      const gain = k >= L ? L * L : k * (2 * L - k); // Closed-form |v|^2 gain per tick.
      const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'none' }); // Optimal right-strafe, no jumping.
      const player = airborne(250); // v0 = 250 u/s.
      const n = 400; // Ticks simulated.
      for (let tick = 0; tick < n; tick++) playerMove(new TestWorld(false), player, bot.nextCmd(player, cvars), cvars); // Strafe.
      const expected = 250 * 250 + n * gain; // Closed form.
      expect(Math.abs(horizontalSpeed(player) ** 2 - expected) / expected).toBeLessThan(1e-9); // Agreement to 1e-9.
    }
  });
});

describe('speed limits', () => {
  it('clamps speed to 1.1 * maxspeed on jump when sv_enablebunnyhopping is 0', () => {
    const vanilla = cvarsFromPreset('css_vanilla'); // Clamp on.
    const capped = grounded(400); // Faster than 275 on the ground.
    playerMove(new TestWorld(), capped, cmd({ buttons: IN_JUMP }), vanilla); // Jump.
    expect(horizontalSpeed(capped)).toBeLessThanOrEqual(275 + 1e-9); // Clamped (3D length includes a tiny vz).
    expect(horizontalSpeed(capped)).toBeGreaterThan(274.9); // But not further.
    const free = grounded(400); // Same start...
    playerMove(new TestWorld(), free, cmd({ buttons: IN_JUMP }), { ...vanilla, sv_enablebunnyhopping: true }); // ...clamp off.
    expect(horizontalSpeed(free)).toBeCloseTo(400, 9); // Untouched.
  });

  it('clamps each velocity axis to +-sv_maxvelocity and clears NaN', () => {
    const cvars = cvarsFromPreset('css_bhop'); // sv_maxvelocity 3500.
    const player = airborne(5000, -5000); // Beyond the limit on two axes.
    playerMove(new TestWorld(false), player, emptyCmd(), cvars); // One tick.
    expect(player.velocity.x).toBe(3500); // Clamped high.
    expect(player.velocity.y).toBe(-3500); // Clamped low.
    const broken = airborne(Number.NaN, 0); // Corrupted state.
    playerMove(new TestWorld(false), broken, emptyCmd(), cvars); // One tick.
    expect(broken.velocity.x).toBe(0); // NaN replaced by 0.
  });
});

/** Upper bound for the discrete apex: the continuous-time jump height (57 u). */
const JUMP_HEIGHT_LIMIT = 57;
