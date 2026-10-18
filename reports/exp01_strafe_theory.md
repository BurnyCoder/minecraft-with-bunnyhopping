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
