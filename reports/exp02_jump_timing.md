# Experiment 2 — How much speed does imperfect scroll-wheel jump timing cost?

Author: Libor Burian (independent researcher). Code: `experiments/exp02-jump-timing.ts`, analysis: `analysis/`.

## Pre-registration (written 2026-10-18 16:42 UTC, committed before any experiment run)

### Question
Without auto-bhop, CS:S players spam the mouse wheel so that jump is pressed on the first ground tick. Source's
anti-pogo rule only allows a jump if jump was *not* held on the previous tick. How much speed is retained per landing
as a function of how often jump pulses arrive? Does the movement port behave exactly as the anti-pogo + friction
model predicts?

### Model and prediction
Each tick carries a jump pulse independently with probability q (scroll-spam density). A landing ends tick 0. On
each later tick t ≥ 1 that starts on the ground, the jump succeeds iff pulse_t ∧ ¬pulse_{t−1}; otherwise the tick is
a ground tick that multiplies speed by r = 1 − μτ (μ = `sv_friction`, no movement keys on ground ticks, speed above
`sv_stopspeed`). K, the number of ground ticks before the jump, follows a two-state Markov chain on the previous
pulse. Solving it gives:

- f0 = q / (1 − (1 − q)·r) (previous tick had no pulse),
- f1 = (1 − q)·r·f0 / (1 − q·r) (previous tick had a pulse),
- **E[r^K] = (1 − q)·f0 + q·f1.**

Derived predictions: the retention is maximal at q = 0.5 and symmetric under q ↔ 1 − q.

### Setup
- Settings: τ = 0.015 s (66.67 tick), `sv_airaccelerate 10` (vanilla), `sv_autobunnyhopping 0`. `sv_enablebunnyhopping`
  is set to 1 to remove the 275 u/s clamp, which would otherwise confound the speed measurement.
- Flat floor; start grounded at (250, 0) u/s.
- In the air, the optimal strafe bot steers. On ground ticks no movement keys are pressed, so friction is the only
  effect.
- Pulses are i.i.d. Bernoulli(q) per tick from a seeded `alea` PRNG.
- q ∈ {0.1, 0.25, 0.5, 0.75}. Each run lasts 60 s simulated, about 80 landings.

### Primary metric and hypothesis H2
- **Metric:** per run, the mean over landings of retention = (speed after the successful jump tick) / (speed at the
  end of the landing tick). Across seeds: mean with a 95% t-interval.
- **H2:** the across-seed mean equals E[r^K].
- **Falsified if:** for any q, the Bonferroni-corrected interval (α = 0.05/4, i.e. 98.75% t-interval) excludes
  E[r^K].

### Sample size (power analysis)
- **Pilot:** 10 seeds per q (seeds 1000–1009), used only to estimate the across-seed SD s of the per-run mean
  retention.
- **Confirmatory n:** n = ⌈(t₀.₉₉₃₇₅,₉ · s / 0.002)²⌉, clamped to [30, 200], so the corrected CI half-width is about
  0.002 or less.
- **Confirmatory seeds:** 0 … n−1, disjoint from the pilot seeds.

### Secondary (descriptive)
Final horizontal speed after 60 s (mean ± 95% CI) per q, compared with the deterministic auto-bhop run (perfect timing).

### Analysis plan
Table of predicted vs measured retention with CIs; figure of retention vs q (theory curve + measured CIs). No data are
excluded. Analyses beyond those listed are labelled post-hoc.

---

## Results (run 2026-10-18 16:47–16:49 UTC, after the pre-registration commit `3a69dc7`)

Data: `reports/data/exp02_pilot.json`, `exp02_power.json`, `exp02_confirm.json`. Statistics and figure:
`analysis/analyze.py` → `reports/data/results_summary.json` and `reports/figures/fig5_jump_timing.png`.

### Power analysis
- Pilot SDs of the per-run mean retention: 0.0345 (q = 0.1), 0.0182 (0.25), 0.0118 (0.5), 0.0185 (0.75), with
  t₀.₉₉₃₇₅,₉ = 3.111.
- The pre-registered formula asks for more than 200 runs for every q, so n was clamped to **200 per q** (seeds 0–199).
- With n = 200, the corrected half-widths are 0.0058, 0.0031, 0.0021 and 0.0034. The 0.002 precision target was **not
  reached** at the cap; this is reported, not hidden.

### H2: anti-pogo + friction model — **not falsified**

| q | runs | landings/run | predicted E[r^K] | measured mean | 95% CI | 98.75% CI (Bonferroni) | contains prediction | final speed (u/s), mean [95% CI] |
|---|---|---|---|---|---|---|---|---|
| 0.1 | 200 | 68.0 | 0.6451 | 0.6404 | [0.6358, 0.6449] | [0.6346, 0.6461] | yes | 220.5 [208.3, 232.8] |
| 0.25 | 200 | 75.6 | 0.8308 | 0.8306 | [0.8282, 0.8330] | [0.8275, 0.8337] | yes | 348.2 [337.8, 358.6] |
| 0.5 | 200 | 77.6 | 0.8900 | 0.8915 | [0.8899, 0.8931] | [0.8894, 0.8936] | yes | 432.7 [422.1, 443.3] |
| 0.75 | 200 | 75.7 | 0.8308 | 0.8308 | [0.8281, 0.8335] | [0.8274, 0.8342] | yes | 354.4 [343.8, 364.9] |

Auto-bhop baseline with the same cvars (perfect timing): 1894.6 u/s after 60 s.

**Interpretation:**
- All four Bonferroni-corrected intervals contain the pre-registered prediction, so the port's anti-pogo and friction
  behave as the model says.
- The derived predictions hold too: retention peaks at q = 0.5 and is symmetric in q ↔ 1 − q (0.8306 vs 0.8308 for
  q = 0.25 vs 0.75).
- Practically: even ideal random scroll-spam (q = 0.5) keeps only 89% of speed per landing at 66.67 tick. After 60 s
  that leaves 433 u/s against 1895 u/s with auto-bhop. Under this model, jump timing, not strafing, is the main
  limit on speed without auto-bhop.

**Borderline point (post-hoc, untested):**
- At q = 0.1 the *uncorrected* 95% CI [0.6358, 0.6449] narrowly excludes 0.6451, and the mean sits 0.0047 below the
  prediction.
- A candidate explanation is the model's assumption that speed stays above `sv_stopspeed` (75 u/s). At q = 0.1, long
  waits (E[K] ≈ 1/(q(1−q)) ≈ 11 ticks) at low speeds (mean final speed 220 u/s) can push speed below 75 u/s. There,
  Source friction removes a constant 75·μ·τ = 4.5 u/s per tick, which is more than the proportional 6%. That would lower
  retention below r^K.
- This explanation was formed after seeing the data and has not been tested.

### Limitations
- The pulse model (i.i.d. Bernoulli per tick) is a simplification of real scroll wheels, which emit bursts of notches.
- No movement keys are pressed on ground ticks, to keep friction the only effect. Real players also strafe on those
  ticks.
