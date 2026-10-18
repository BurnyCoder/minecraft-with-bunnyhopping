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
