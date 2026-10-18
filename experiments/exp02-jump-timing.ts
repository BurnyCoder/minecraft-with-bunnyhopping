// Experiment 2 (pre-registered in reports/exp02_jump_timing.md): random scroll-wheel jump pulses vs Source anti-pogo.
// Each tick carries a jump pulse with probability q (seeded alea PRNG). We measure the speed retained per landing and
// compare with the Markov-chain prediction E[r^K] (computed in analysis/ with the same formula as the pre-registration).
// Global context: run in stages by `npm run experiments`: pilot (seeds 1000-1009), power analysis (analysis/power.py),
// confirmatory (seeds 0..n-1). Writes reports/data/exp02_<stage>.json.
import alea from 'alea'; // Seeded PRNG (https://github.com/coverslide/node-alea).
import type { Logger } from '../src/logging/logger'; // Logging.
import { cvarsFromPreset, type Cvars } from '../src/physics/cvars'; // Presets.
import { emptyCmd, IN_JUMP } from '../src/physics/player'; // Commands.
import { StrafeBot } from '../src/physics/strafeBot'; // Air strafing.
import { FLAT_FLOOR, groundedPlayer, simulate, writeData } from './common'; // Helpers.

const DURATION_S = 60; // Simulated seconds per run (pre-registered).
export const QS = [0.1, 0.25, 0.5, 0.75]; // Pulse probabilities per tick (pre-registered).

/** Vanilla timing (66.67 tick, airaccel 10, no autobhop) without the 275 u/s clamp (removes a confound). */
export const EXP02_CVARS: Cvars = { ...cvarsFromPreset('css_vanilla'), sv_enablebunnyhopping: true };

/** One run: returns per-landing retention ratios and the final speed. */
export function jumpTimingRun(q: number, seed: number, cvars: Cvars = EXP02_CVARS): { retentions: number[]; groundTicks: number[]; finalSpeed: number } {
  const random = alea(`exp02:${q}:${seed}`); // Independent stream per (q, seed).
  const player = groundedPlayer(250); // Start at run speed.
  const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'none' }); // Steering only; jumps come from pulses.
  const retentions: number[] = []; // r^K per landing.
  const groundTicks: number[] = []; // K per landing.
  let landedSpeed: number | null = null; // Speed at the end of the landing tick.
  let k = 0; // Ground ticks since landing.
  let final = 250; // Last speed.
  const ticks = Math.round(DURATION_S / cvars.tick_interval); // 4000 ticks.
  simulate(FLAT_FLOOR, player, cvars, ticks, (p) => {
    const pulse = random() < q; // Bernoulli(q) jump pulse this tick.
    if (p.onGround) return { ...emptyCmd(), viewYaw: 0, buttons: pulse ? IN_JUMP : 0 }; // Ground: no movement keys, friction only.
    const cmd = bot.nextCmd(p, cvars); // Air: optimal strafe.
    return { ...cmd, buttons: pulse ? IN_JUMP : 0 }; // Pulse state carried into anti-pogo.
  }, (r) => {
    if (r.events.landed) {
      landedSpeed = r.speedAfter; // Landing tick ended on the ground.
      k = 0;
    } else if (r.wasOnGround && !r.events.jumped) k++; // A friction tick.
    if (r.events.jumped && landedSpeed !== null) {
      retentions.push(r.speedAfter / landedSpeed); // Jump tick has no keys and no friction: ratio = r^K.
      groundTicks.push(k);
      landedSpeed = null;
    }
    final = r.speedAfter;
  });
  return { retentions, groundTicks, finalSpeed: final };
}

/** Run all q values for the given seeds and write reports/data/exp02_<stage>.json. */
export function runExp02(stage: 'pilot' | 'confirm', seeds: Record<string, number[]>, log: Logger): void {
  const runs = [];
  for (const q of QS) {
    for (const seed of seeds[String(q)]) {
      const run = jumpTimingRun(q, seed); // Simulate.
      const mean = run.retentions.reduce((a, b) => a + b, 0) / run.retentions.length; // Per-run mean retention.
      runs.push({ q, seed, landings: run.retentions.length, meanRetention: mean, meanGroundTicks: run.groundTicks.reduce((a, b) => a + b, 0) / run.groundTicks.length, finalSpeed: run.finalSpeed });
    }
    const qs = runs.filter((r) => r.q === q); // This q's runs.
    log.info(`exp02 ${stage} q=${q}`, { runs: qs.length, meanOfMeans: qs.reduce((a, r) => a + r.meanRetention, 0) / qs.length, landingsPerRun: qs[0]?.landings });
  }
  const perfect = jumpTimingRun(1, 0, { ...EXP02_CVARS, sv_autobunnyhopping: true }); // Baseline: autobhop = perfect timing (q irrelevant).
  writeData(`exp02_${stage}.json`, { stage, durationS: DURATION_S, cvars: EXP02_CVARS, runs, autobhopFinalSpeed: perfect.finalSpeed }); // Data.
}
