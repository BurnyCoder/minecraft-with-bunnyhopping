// Experiment 1 (pre-registered in reports/exp01_strafe_theory.md): closed-form strafing check across tick intervals and
// air acceleration, causal interventions on the bhop mechanism, and an exploratory fixed-turn-rate sweep.
// Global context: run via `npm run experiments` (experiments/run-all.ts). Writes reports/data/exp01_*.json; the
// analysis scripts in analysis/ turn them into tables and figures for the reports and the paper.
import type { Logger } from '../src/logging/logger'; // Logging.
import { emptyCmd, IN_JUMP } from '../src/physics/player'; // Commands.
import { cvarsFromPreset, type Cvars } from '../src/physics/cvars'; // Presets.
import { optimalGainPerTick, StrafeBot } from '../src/physics/strafeBot'; // Bot + closed form.
import { FLAT_FLOOR, groundedPlayer, simulate, writeData } from './common'; // Helpers.

const DURATION_S = 10; // Simulated seconds per run (pre-registered).
const V0 = 250; // Start speed, u/s.
const TAUS = [0.03, 0.015, 0.01, 0.0078125]; // Tick intervals (33.3, 66.7, 100, 128 tick).
const AIRACCELS = [1, 10, 100, 1000]; // sv_airaccelerate values.

/** Base cvars for this experiment: css_bhop (autobhop, no clamp) with a given tick and air accel. */
function cvarsFor(tau: number, airaccel: number, extra: Partial<Cvars> = {}): Cvars {
  return { ...cvarsFromPreset('css_bhop'), tick_interval: tau, sv_airaccelerate: airaccel, ...extra }; // Override.
}

/**
 * One optimal-strafe run; returns the speed trace, the closed-form trace and the max relative error between them.
 * The closed form is summed tick by tick with that tick's Source surface-friction factor k_e (1, or 0.25 after a tick
 * spent rising slowly in the air), i.e. |v_n|^2 = |v_0|^2 + sum g(k_e,i * k) (jwchong eq. 6.6 with k = k_e tau M A).
 */
function optimalRun(cvars: Cvars): { trace: number[]; predictedTrace: number[]; maxRelError: number; airTicks: number; groundTicks: number; quarteredTicks: number } {
  const player = groundedPlayer(V0); // Start state.
  const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'hold' }); // Optimal right strafe.
  const trace: number[] = [V0]; // Measured speed per tick (index = tick).
  const predictedTrace: number[] = [V0]; // Closed-form speed per tick.
  let predictedSq = V0 * V0; // Closed-form |v|^2.
  let ke = 1; // Surface-friction factor the current tick uses.
  let maxRelError = 0; // Worst deviation.
  let airTicks = 0; // AirMove ticks.
  let groundTicks = 0; // WalkMove ticks (should be 0).
  let quarteredTicks = 0; // Air ticks with k_e = 0.25.
  const ticks = Math.round(DURATION_S / cvars.tick_interval); // Ticks in the run.
  simulate(FLAT_FLOOR, player, cvars, ticks, (p) => {
    ke = p.surfaceFriction; // Set by the previous tick's categorizePosition.
    return bot.nextCmd(p, cvars);
  }, (r) => {
    if (r.events.jumped || !r.wasOnGround) {
      airTicks++; // Air tick: closed-form step with this tick's k_e.
      if (ke < 1) quarteredTicks++;
      predictedSq += optimalGainPerTick(cvars, ke);
    } else groundTicks++; // Friction tick (none expected with auto-bhop).
    maxRelError = Math.max(maxRelError, Math.abs(r.speedAfter ** 2 - predictedSq) / predictedSq); // Relative error in |v|^2.
    trace.push(r.speedAfter); // Record.
    predictedTrace.push(Math.sqrt(predictedSq));
  });
  return { trace, predictedTrace, maxRelError, airTicks, groundTicks, quarteredTicks };
}

/** Run every part of Experiment 1 and write the data files. */
export function runExp01(log: Logger): void {
  // Part A: closed-form grid (H1).
  const grid = [];
  for (const tau of TAUS) {
    for (const A of AIRACCELS) {
      const cvars = cvarsFor(tau, A); // Condition cvars.
      const run = optimalRun(cvars); // Simulate.
      const k = tau * 250 * A; // Per-tick accel bound.
      const row = { tau, tickRate: 1 / tau, airaccel: A, kOverL: k / 30, gainPerTick: optimalGainPerTick(cvars), gainPerTickQuartered: optimalGainPerTick(cvars, 0.25), airTicks: run.airTicks, groundTicks: run.groundTicks, quarteredTicks: run.quarteredTicks, finalSpeed: run.trace.at(-1)!, predictedFinalSpeed: run.predictedTrace.at(-1)!, maxRelError: run.maxRelError };
      const every = (_: number, i: number): boolean => i % Math.round(0.1 / tau) === 0; // Sample every ~0.1 s for figures.
      grid.push({ ...row, trace: run.trace.filter(every), predictedTrace: run.predictedTrace.filter(every) });
      log.info('exp01 grid condition', row); // Full row in the log.
    }
  }
  const repeat = optimalRun(cvarsFor(0.01, 1000)); // Determinism check: same condition twice.
  const original = grid.find((r) => r.tau === 0.01 && r.airaccel === 1000)!; // Earlier run.
  const deterministic = repeat.trace.at(-1) === original.finalSpeed; // Bit-identical final speed?
  log.info('exp01 determinism check', { deterministic, a: original.finalSpeed, b: repeat.trace.at(-1) });

  // Part B: causal interventions at tau = 0.01, A = 1000 (H2 a-d).
  const base = cvarsFor(0.01, 1000); // Intervention baseline.
  const ticks = Math.round(DURATION_S / base.tick_interval); // 1000 ticks.
  const interventions: Record<string, unknown> = {};
  const perfect = optimalRun(base); // Reference: perfect optimal bhop.
  interventions.perfect = { finalSpeed: perfect.trace.at(-1), trace: perfect.trace.filter((_, i) => i % 10 === 0) };
  {
    const player = groundedPlayer(V0); // (a) No strafing: W + jump only.
    const trace: number[] = [V0];
    simulate(FLAT_FLOOR, player, base, ticks, () => ({ ...emptyCmd(), forwardmove: 400, buttons: IN_JUMP }), (r) => trace.push(r.speedAfter));
    interventions.noStrafe = { finalSpeed: trace.at(-1), maxDeviationFrom250: Math.max(...trace.map((v) => Math.abs(v - 250))), trace: trace.filter((_, i) => i % 10 === 0) };
  }
  {
    const cvars = { ...base, sv_airspeedcap: 1e9 }; // (b) Remove the 30 u/s projected cap.
    const player = groundedPlayer(V0);
    const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'hold' }); // Bot adapts (theta -> 0).
    const trace: number[] = [V0];
    const vx: number[] = [V0];
    simulate(FLAT_FLOOR, player, cvars, ticks, (p) => bot.nextCmd(p, cvars), (r) => {
      trace.push(r.speedAfter);
      vx.push(Math.abs(player.velocity.x)); // Per-axis component (clamp acts per axis).
    });
    interventions.noAirCap = { speedAfterTicks: trace.slice(0, 6), maxAxisSpeed: Math.max(...vx), ticksToClamp: vx.findIndex((v) => v >= 3500 - 1e-9), trace: trace.filter((_, i) => i % 10 === 0) };
  }
  {
    const player = groundedPlayer(V0); // (c) Late jump: one empty ground tick before each re-jump.
    const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'hold' });
    const trace: number[] = [V0];
    const lateRatios: number[] = []; // Speed ratio across each late ground tick.
    let groundStreak = 0; // Consecutive ticks started on the ground.
    simulate(FLAT_FLOOR, player, base, ticks, (p) => {
      groundStreak = p.onGround ? groundStreak + 1 : 0; // Count ground ticks.
      if (p.onGround && groundStreak === 1 && p.velocity.lengthSq() > 0 && trace.length > 1) return emptyCmd(); // First ground tick: no input (late).
      return bot.nextCmd(p, base); // Otherwise optimal (jump held).
    }, (r) => {
      if (r.wasOnGround && !r.events.jumped) lateRatios.push(r.speedAfter / r.speedBefore); // Friction-only tick.
      trace.push(r.speedAfter);
    });
    interventions.lateJump = { finalSpeed: trace.at(-1), landings: lateRatios.length, ratioMin: Math.min(...lateRatios), ratioMax: Math.max(...lateRatios), predictedRatio: 1 - base.sv_friction * base.tick_interval, trace: trace.filter((_, i) => i % 10 === 0) };
  }
  {
    const cvars = { ...base, sv_enablebunnyhopping: false }; // (d) CS:S 110% bhop clamp on.
    const player = groundedPlayer(V0);
    const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'hold' });
    const trace: number[] = [V0];
    const jumpTickEnd: number[] = []; // Speed at the end of each jump tick.
    const hopLengths: number[] = []; // Air ticks per hop.
    let hop = 0; // Current hop length.
    simulate(FLAT_FLOOR, player, cvars, ticks, (p) => bot.nextCmd(p, cvars), (r) => {
      if (r.events.jumped) {
        if (hop > 0) hopLengths.push(hop); // Close the previous hop.
        hop = 0;
        jumpTickEnd.push(r.speedAfter); // Speed right after the clamped jump tick.
      }
      if (r.events.jumped || !r.wasOnGround) hop++; // Air tick of the current hop.
      trace.push(r.speedAfter);
    });
    const nMax = Math.max(...hopLengths); // Longest hop.
    interventions.bhopClamp = {
      maxSpeed: Math.max(...trace), maxJumpTickEndSpeed: Math.max(...jumpTickEnd), longestHopTicks: nMax,
      preregBoundJumpTick: 275, preregBoundRun: Math.sqrt(275 ** 2 + nMax * optimalGainPerTick(cvars)),
      trace: trace.filter((_, i) => i % 10 === 0),
    };
  }
  log.info('exp01 interventions', Object.fromEntries(Object.entries(interventions).map(([k, v]) => [k, { ...(v as object), trace: undefined }])));

  // Part C (exploratory): fixed turn rate.
  const turn = [];
  for (const A of [10, 100, 1000]) {
    for (const omega of [0, 90, 180, 360, 540, 720, 1080]) {
      const cvars = cvarsFor(0.01, A); // 100 tick.
      const player = groundedPlayer(V0);
      const bot = new StrafeBot({ mode: 'fixedTurn', direction: 1, jumpMode: 'hold', turnRateDegPerSec: omega }, 0); // Start yaw 0.
      let final = V0;
      simulate(FLAT_FLOOR, player, cvars, ticks, (p) => bot.nextCmd(p, cvars), (r) => (final = r.speedAfter));
      turn.push({ airaccel: A, omega, finalSpeed: final });
    }
  }
  log.info('exp01 exploratory fixed-turn sweep', { rows: turn });
  writeData('exp01_results.json', { durationS: DURATION_S, v0: V0, grid, deterministic, interventions, fixedTurn: turn }); // All results.
}
