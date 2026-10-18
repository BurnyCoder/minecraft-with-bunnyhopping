# Experiment 1 — Does the port reproduce Source air-strafing theory, and what causes the speed gain?

Author: Libor Burian (independent researcher). Code: `experiments/exp01-strafe-theory.ts`, analysis: `analysis/`.

## Pre-registration (written 2026-10-18 16:42 UTC, committed before any experiment run)

### Question
Does the TypeScript port of Source `CGameMovement` (`src/physics/movement.ts`), running through the full tick pipeline
(gravity split, jump check, friction, air move, swept collision, ground categorisation), follow the closed-form
optimal air-strafing dynamics? Which mechanisms are causally responsible for the speed gain?

### Background and prediction
Let L = `sv_airspeedcap` (30 u/s), M = wish speed (250 u/s after CheckParameters clamps the 400 u/s side move),
A = `sv_airaccelerate`, τ = tick interval, and k = τ·M·A. J. W. Chong's strafing theory
(https://www.jwchong.com/hl/strafing.html, eqs. 6.5–6.7) gives the optimal per-tick gain in squared speed:
g = L² if k ≥ L, otherwise g = k(2L − k). After n air ticks this gives |v_n|² = |v_0|² + n·g.

### Setup (confirmatory)
- Flat infinite floor (all blocks with z < 0 solid). Player starts grounded with horizontal velocity (250, 0) u/s.
- Bot: `StrafeBot` optimal right strafe, jump held. Settings `sv_autobunnyhopping 1`, `sv_enablebunnyhopping 1`; other
  cvars from `css_bhop`. Every tick is therefore an air tick: jump ticks skip friction, and landing ticks are air
  ticks. Simulated duration: T = 10 s.
- Grid: τ ∈ {0.03, 0.015, 0.01, 0.0078125} s × A ∈ {1, 10, 100, 1000}, 16 conditions spanning k/L from 0.008
  (A = 1, τ = 0.0078125) to 250 (A = 1000, τ = 0.03).
- The simulation is deterministic float64, so there are no seeds. Repeat runs must be bit-identical, and this is
  checked.

### Primary metric and hypothesis H1
- **Metric:** the maximum relative error over all ticks, |v_n² − (v_0² + n·g)| / (v_0² + n·g), for each condition.
- **H1:** the error is < 1e-9 in all 16 conditions.
- **Falsified if:** any condition exceeds 1e-6. That would mean a mechanism in the port (or the theory's
  assumptions) differs.

### Causal interventions (confirmatory, τ = 0.01, A = 1000, T = 10 s)
1. **No strafing:** hold W, no sidemove, jump held. Predicted: speed stays exactly 250 (to 1e-9), because the
   projected room 30 − 250 is negative.
2. **No 30 u/s cap** (`sv_airspeedcap` = 1e9; the bot's optimum becomes θ = 0). Predicted: each axis reaches the
   `sv_maxvelocity` clamp (3500 u/s) within 2 ticks.
3. **Late jump:** one ground tick with no input before every re-jump. Predicted: every landing multiplies speed by
   exactly 1 − `sv_friction`·τ = 0.96, and final speed is lower than with perfect jumps.
4. **Bhop clamp** (`sv_enablebunnyhopping 0`). Predicted: horizontal speed at the end of every jump tick
   ≤ 1.1·250 = 275 u/s, so the run's maximum speed ≤ √(275² + N_max·g), where N_max is the longest observed hop in
   ticks.

### Exploratory (not confirmatory; reported as such)
Human-like fixed turn rate ω ∈ {0, 90, 180, 360, 540, 720, 1080} °/s × A ∈ {10, 100, 1000} at τ = 0.01. Report the
final speed after 10 s. No hypothesis is pre-specified.

### Analysis plan
- Report the per-condition max relative error (table), and plot speed vs time against the closed form.
- Plot the measured per-tick gain normalised by L² against k/L, with the theory curve.
- Report the intervention outcomes against their predictions.
- No data are excluded.

---

## Results (run 3, 2026-10-18 17:25 UTC; pre-registration commit `3a69dc7`; see the revision history below)

Data: `reports/data/exp01_results.json`. Statistics and figures: `analysis/analyze.py` → `reports/data/results_summary.json`
and `reports/figures/fig1–fig4`. Logs: `logs/experiments_*.log`, `logs/analysis_*.log`.

### H1: closed-form agreement — **supported**
- **Oracle used.** The closed form is applied tick by tick with that tick's Source surface-friction factor k_e. Source
  sets `m_surfaceFriction` = 0.25 after a tick spent airborne and rising at 0 < vz ≤ 140 u/s, and AirAccelerate
  multiplies by it. This is the k_e in jwchong's k = k_e·τ·M·A. See deviation D4 for why the oracle has this form.
- **Result.** The worst relative error in |v|² over all 16 conditions and all ticks is **1.0 × 10⁻¹⁴**, 5 orders of
  magnitude below the 1e-9 threshold.
- **Other checks.** No condition had a ground (friction) tick. A repeat run of 100 tick / A = 1000 was bit-identical
  (final speed 981.0708435174295 u/s).

| tick rate | sv_airaccelerate | k/L | g at k_e = 1 / 0.25 (u²/s² per tick) | air ticks | of which k_e = 0.25 | final speed (u/s) | predicted (u/s) | max rel. error |
|---|---|---|---|---|---|---|---|---|
| 33.33 | 1 | 0.250 | 393.75 / 108.98 | 333 | 84 | 411.945 | 411.945 | 3.0e-15 |
| 33.33 | 10 | 2.500 | 900.00 / 773.44 | 333 | 84 | 592.932 | 592.932 | 1.6e-15 |
| 33.33 | 100 / 1000 | 25 / 250 | 900.00 / 900.00 | 333 | 84 | 601.831 | 601.831 | 1.7e-15 |
| 66.67 | 1 | 0.125 | 210.94 / 55.37 | 667 | 166 | 421.155 | 421.155 | 6.6e-15 |
| 66.67 | 10 | 1.250 | 900.00 / 474.61 | 667 | 166 | 769.536 | 769.536 | 2.8e-15 |
| 66.67 | 100 / 1000 | 12.5 / 125 | 900.00 / 900.00 | 667 | 166 | 814.125 | 814.125 | 2.1e-15 |
| 100 | 1 | 0.083 | 143.75 / 37.11 | 1000 | 232 | 426.039 | 426.039 | 1.0e-14 |
| 100 | 10 | 0.833 | 875.00 / 335.94 | 1000 | 232 | 901.353 | 901.353 | 6.3e-15 |
| 100 | 100 / 1000 | 8.33 / 83.3 | 900.00 / 900.00 | 1000 | 232 | 981.071 | 981.071 | 2.1e-15 |
| 128 | 1 | 0.065 | 113.37 / 29.06 | 1280 | 310 | 426.004 | 426.004 | 1.0e-14 |
| 128 | 10 | 0.651 | 790.41 / 269.13 | 1280 | 310 | 955.313 | 955.313 | 4.7e-15 |
| 128 | 100 / 1000 | 6.51 / 65.1 | 900.00 / 900.00 | 1280 | 310 | 1102.044 | 1102.044 | 2.1e-15 |

Rows with identical outcomes are merged (full table: `reports/data/tables.md`).

**What this means:**
- About 23–25% of air ticks (the slow part of each rise) run at k_e = 0.25.
- When even the quartered k is at least 30 (A ≥ 100 here), A no longer matters, and speed is set by the tick rate:
  981 u/s at 100 tick vs 814 u/s at 66.67 tick after 10 s of optimal strafing.
- With vanilla `sv_airaccelerate 10`, the quartered ticks cost speed: 769.5 vs 814.1 u/s at 66.67 tick.
- Figure 2 shows the measured mean gain per tick between the k_e = 1 and k_e = 0.25 curves, exactly where the
  per-tick closed form puts it.

### Interventions (H2), 100 tick / A = 1000
These are unaffected by D4, because k/4 = 625 > 30.

| intervention | pre-registered prediction | measured | verdict |
|---|---|---|---|
| (1) no strafing, W only | speed stays 250 (1e-9) | max deviation from 250: **0** | supported |
| (2) 30 u/s cap removed | each axis hits 3500 within 2 ticks | run 1: speed stayed exactly 250 | **falsified as stated** (D1) |
| (3) jump one tick late | ×0.96 per landing; final < perfect | ratio per landing in [0.96 − 3e-16, 0.96 + 2e-16] over 13 landings; final 745.8 vs 981.1 u/s | supported |
| (4a) clamp: end-of-jump-tick speed ≤ 275 | ≤ 275 | max 276.62 u/s | **falsified as stated** (D2) |
| (4b) clamp: run maximum ≤ √(275² + N_max·g) | ≤ 378.319 (N_max = 75) | 378.307 | supported |

Friction-free landings (perfect vs late jump) and strafing (W only) switch the gain on and off, each by exactly the
predicted amount (Figure 3, left).

### Deviations from the pre-registration (all disclosed)
- **D1, an instrument error (bot and prediction for intervention 2).** Both used L = 1e9 instead of Source's effective
  L = min(cap, wishspeed) = 250.
  - Run 1 showed no gain; that data is kept in `exp01_results_run1_bot_cap_bug.json`.
  - After the fix, the post-hoc prediction 250·√(n+1) matched exactly (250, 353.553, 433.013, 500, …).
  - The per-axis clamp of 3500 binds from tick 226 (Figure 3, right).
- **D2, a derivation error (4a).** The clamp runs inside CheckJumpButton, before that tick's AirMove adds about
  1.6 u/s. That predicts about 276.6 u/s; 276.62 u/s was measured (post-hoc).
- **D3, an arithmetic slip in the pre-registration text.** The lowest k/L is 0.065, not 0.008.
- **D4, a port defect found by the code review after run 2, which changes the system under test.**
  - Source's CategorizePosition sets `m_surfaceFriction` = 0.25 when no ground is found while rising (SDK
    gamemovement.cpp L3800, L3872–3877). AirAccelerate, Accelerate and Friction multiply by it.
  - Runs 1–2 left this out, and so did the run-2 oracle. The port and the oracle agreed with each other (max error
    9.4e-15) but not with Source.
  - The port now implements the rule (`movement.ts` `categorizePosition`, with unit tests). The bot and the oracle use
    the per-tick k_e, as jwchong's formula allows.
  - Conditions with A·M·τ/4 < 30 (A ≤ 10 in this grid) changed. Run-2 data is kept in `*_run2_before_surface_friction.*`.
  - **Lesson:** an oracle derived from the same mental model as the implementation cannot catch shared omissions. Only
    an independent read of the reference source (here, the code review) did.

### Exploratory: human-like constant turn rate (not confirmatory)

| ω (°/s) | 0 | 90 | 180 | 360 | 540 | 720 | 1080 |
|---|---|---|---|---|---|---|---|
| A = 10 | 251.8 | 623.1 | 436.1 | 255.8 | 227.7 | 148.3 | 128.6 |
| A = 100 and A = 1000 (identical) | 251.8 | 664.6 | 896.5 | 857.1 | 632.3 | 477.7 | 318.8 |

Speed after 10 s at 100 tick (u/s):
- A constant mouse speed has a sweet spot: about 90 °/s at A = 10 and about 180 °/s at A ≥ 100.
- Turning too fast drops below the 250 u/s run speed.
- Low air acceleration narrows the useful range further once quartered ticks are modelled.
- Hypothesis for future work: the optimal ω scales with tick rate, speed and A. This was not tested.

### Revision history

| run | date (UTC) | port / instrument | key numbers |
|---|---|---|---|
| 1 | 16:45 | bot used L = cap (D1) | grid as run 2; no-cap intervention: no gain |
| 2 | 16:47 | bot fixed; port without the 0.25 air surface-friction rule | max error 9.4e-15 vs an oracle sharing the omission; 66.67 tick A = 10: 814.125 u/s |
| 3 | 17:25 | port implements the rule (D4); oracle per-tick k_e | max error 1.0e-14; 66.67 tick A = 10: 769.536 u/s; A ≥ 100 rows and all interventions unchanged |

### Limitations
- The physics is checked against theory and against our reading of the public SDK, not against recordings from the
  CS:S binary. D4 shows that such readings can miss rules.
- Collision (40 u blocks, no slopes or steps) is simpler than Source BSP collision, and float64 differs from Source's
  float32.
