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

## Results (run 2026-10-18 16:45–16:47 UTC, after the pre-registration commit `3a69dc7`)

Data: `reports/data/exp01_results.json`. Statistics and figures: `analysis/analyze.py` → `reports/data/results_summary.json`
and `reports/figures/fig1–fig4`. Logs: `logs/experiments_*.log`, `logs/analysis_*.log`.

### H1: closed-form agreement — **supported**
- The worst relative error in |v|² over all 16 conditions and all ticks is **9.4 × 10⁻¹⁵**. That is 5 orders of
  magnitude below the 1e-9 pass threshold and close to float64 rounding (2.2 × 10⁻¹⁶ per operation, accumulated over
  up to 1280 ticks).
- No condition had a ground (friction) tick: auto-bhop re-jumped on every landing.
- A repeat run of the 100 tick / A = 1000 condition gave a bit-identical final speed (981.0708435174295 u/s): the
  simulation is deterministic.

| tick rate | sv_airaccelerate | k/L | g (u²/s² per tick) | air ticks | final speed (u/s) | predicted (u/s) | max rel. error |
|---|---|---|---|---|---|---|---|
| 33.33 | 1 | 0.250 | 393.75 | 333 | 440.021 | 440.021 | 3.7e-15 |
| 33.33 | 10 / 100 / 1000 | 2.5 / 25 / 250 | 900.00 | 333 | 601.831 | 601.831 | 1.7e-15 |
| 66.67 | 1 | 0.125 | 210.94 | 667 | 450.772 | 450.772 | 4.4e-15 |
| 66.67 | 10 / 100 / 1000 | 1.25 / 12.5 / 125 | 900.00 | 667 | 814.125 | 814.125 | 2.1e-15 |
| 100 | 1 | 0.083 | 143.75 | 1000 | 454.148 | 454.148 | 7.7e-15 |
| 100 | 10 | 0.833 | 875.00 | 1000 | 968.246 | 968.246 | 5.5e-15 |
| 100 | 100 / 1000 | 8.33 / 83.3 | 900.00 | 1000 | 981.071 | 981.071 | 2.1e-15 |
| 128 | 1 | 0.065 | 113.37 | 1280 | 455.650 | 455.650 | 9.4e-15 |
| 128 | 10 | 0.651 | 790.41 | 1280 | 1036.445 | 1036.445 | 4.9e-15 |
| 128 | 100 / 1000 | 6.51 / 65.1 | 900.00 | 1280 | 1102.044 | 1102.044 | 2.1e-15 |

Rows with identical outcomes are merged (full table: `reports/data/tables.md`).

**What this means:**
- Once k ≥ L, air acceleration no longer matters. A = 10, 100 and 1000 give identical speeds at 33–67 tick, because
  the 30 u/s projected cap, not A, limits each tick.
- The tick rate then sets the gain per second (900·tickrate u²/s³), so under this model a higher tick rate gives
  faster bhop: after 10 s of optimal strafing, 981 u/s at 100 tick vs 814 u/s at 66.67 tick.
- Figure 2 shows the transition at k = L.

### Interventions (H2)

| intervention | pre-registered prediction | measured | verdict |
|---|---|---|---|
| (1) no strafing, W only | speed stays 250 (1e-9) | max deviation from 250: **0** | supported |
| (2) 30 u/s cap removed | each axis hits 3500 within 2 ticks | run 1: speed stayed exactly 250 | **falsified as stated** (see deviation D1) |
| (3) jump one tick late | ×0.96 per landing; final < perfect | ratio per landing in [0.96 − 3e-16, 0.96 + 2e-16] over 13 landings; final 745.8 vs 981.1 u/s | supported |
| (4a) clamp: speed at the end of each jump tick ≤ 275 | ≤ 275 | max 276.62 u/s | **falsified as stated** (see deviation D2) |
| (4b) clamp: run maximum ≤ √(275² + N_max·g) | ≤ 378.319 (N_max = 75) | 378.307 | supported |

Removing friction from landings (perfect vs late jump) and removing strafing (W only) are the two causal
interventions that switch the speed gain on and off. Each matches its predicted size exactly (Figure 3, left).

### Deviations from the pre-registration (all disclosed)
- **D1, an instrument error in the prediction and in the bot.** The prediction for (2) and the bot both used L = 1e9.
  In Source's AirAccelerate, wishspd = min(wishspeed, cap), so the effective limit is L = min(cap, wishspeed) = 250 u/s
  (jwchong's definition).
  - With L = 1e9 the bot steered straight along its velocity (θ = 0). The projected room was then
    250 − 250 = 0, so it gained nothing. That is the run-1 result above, kept in
    `reports/data/exp01_results_run1_bot_cap_bug.json`.
  - After fixing `StrafeBot` and `optimalGainPerTick` to use min(cap, wishspeed) (unit test added), the **post-hoc**
    prediction is |v_n| = 250·√(n+1). It matched exactly: 250, 353.553, 433.013, 500, 559.017, 612.372 u/s, ….
    The per-axis `sv_maxvelocity` clamp (3500) was first reached at tick 226 (Figure 3, right).
  - The fix cannot affect the confirmatory grid, because there min(30, 250) = 30. The grid results and the exploratory
    sweep were byte-identical before and after.
- **D2, a derivation error in prediction (4a).** CS:S applies the clamp inside CheckJumpButton, before that same
  tick's AirMove. A tick of optimal strafing then adds √(275² + 30²) − 275 ≈ 1.6 u/s, so the end-of-tick speed is about
  276.6 u/s. That matches the measured 276.62 u/s (post-hoc explanation).
- **D3, an arithmetic slip in the pre-registration text.** The k/L range is 0.065–250, not 0.008–250: k = 0.0078125·250·1
  = 1.95, and k/L = 0.065. The condition grid itself was run exactly as specified.

### Exploratory: human-like constant turn rate (not confirmatory)

| ω (°/s) | 0 | 90 | 180 | 360 | 540 | 720 | 1080 |
|---|---|---|---|---|---|---|---|
| A = 10 | 251.8 | 664.5 | 791.1 | 380.9 | 251.9 | 201.4 | 161.9 |
| A = 100 and A = 1000 (identical) | 251.8 | 664.6 | 896.5 | 857.1 | 632.3 | 477.7 | 318.8 |

Speed after 10 s at 100 tick (u/s):
- A constant mouse speed has a sweet spot near 180 °/s at this tick rate.
- Turning too fast drops below the 250 u/s run speed.
- Higher air acceleration widens the useful range of turn rates.
- Hypothesis for future work: the optimal ω scales with tick rate and speed. This was not tested.

### Limitations
- The physics is checked against theory, not against recordings from the real CS:S binary. Agreement with theory
  implies agreement with CS:S only insofar as CS:S follows the same documented algorithm.
- Collision (40 u blocks, no slopes or steps) is simpler than Source BSP collision, and float64 differs from Source's
  float32.
