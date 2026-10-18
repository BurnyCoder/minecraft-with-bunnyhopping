# Experiments summary — BhopCraft movement physics

Author: Libor Burian (independent researcher). Full write-ups: [exp01_strafe_theory.md](exp01_strafe_theory.md),
[exp02_jump_timing.md](exp02_jump_timing.md). Paper: [paper.md](paper.md) / [paper.pdf](paper.pdf).
To reproduce everything: `npm run experiments` (see the README).

## Key terms (plain language)

| term | meaning |
|---|---|
| Hammer unit (u) | Source engine distance unit, about 1 inch. One BhopCraft block is 40 u. |
| tick, tick rate | One fixed physics step. 100 tick = 100 steps per second (τ = 0.01 s). |
| cvar | A named server setting, e.g. `sv_airaccelerate`. |
| bunnyhop (bhop) | Jumping again on the exact tick you land, so ground friction never slows you. |
| air strafing | Holding A or D while turning the mouse the same way in the air; this adds speed sideways to your motion. |
| wish direction / wish speed | Where your keys + view ask to move, and how fast (250 u/s here). |
| air speed cap L | Source only lets air acceleration push your speed *along the wish direction* up to 30 u/s. Turning keeps that projection small, so speed keeps growing. |
| surface friction k_e | Source multiplies acceleration by `m_surfaceFriction`: 1 normally, 0.25 on the tick after you were rising slowly (0 < vz ≤ 140 u/s) in the air. It only matters when sv_airaccelerate is low. |
| `sv_airaccelerate` (A) | How quickly air acceleration acts. k = τ·250·A is the most speed one tick can add. |
| closed form | An exact formula: optimal strafing gives \|v\|² growing by g per tick, g = L² if k ≥ L, else k(2L − k). |
| anti-pogo | Source rule: holding jump does not jump again; it must be released for a tick first. |
| auto-bhop | A server setting that removes anti-pogo, so holding jump re-jumps every landing. |
| pre-registration | Writing hypotheses, metrics and pass/fail thresholds into the repo before running, so results cannot be cherry-picked. |
| 95% CI | Range that would contain the true mean in 95% of repeated experiments. |
| Bonferroni correction | Widening each CI when testing several hypotheses, so the overall false-alarm rate stays at 5%. |
| power analysis | Choosing the number of runs from a pilot so the CI is narrow enough. |

## Experiments at a glance

| id | question | setup | primary metric | result | verdict |
|---|---|---|---|---|---|
| 1 (H1) | Does the TypeScript port follow Source strafing theory exactly? | Optimal bot on a flat floor, 16 tick × airaccel conditions, 10 s, deterministic | max relative error of \|v\|² vs per-tick closed form | worst 1.0e-14 (threshold 1e-9) | supported (after the D4 port fix; see the report) |
| 1 (H2) | What causes the speed gain? | Interventions at 100 tick / A = 1000 | per-intervention prediction | no strafing → exactly 250 u/s; late jump → ×0.96 per landing; clamp bound holds | 3 supported, 2 predictions falsified as stated (derivation/instrument errors, disclosed and explained) |
| 1 (expl.) | How does a constant mouse turn rate do? | ω × A sweep | speed after 10 s | optimum ≈ 90 °/s (A = 10) or 180 °/s (A ≥ 100); too fast loses speed | exploratory |
| 2 (H2) | How much speed does random scroll-wheel timing keep? | Bernoulli(q) jump pulses, 66.67 tick, 200 runs × 4 q | mean retention per landing vs Markov prediction | all 4 Bonferroni CIs contain the prediction; best q = 0.5 keeps 89% per landing | not falsified |

## Movement "agents" and configurations studied

| agent / configuration | algorithm | objective | data | outcome (from the experiments) |
|---|---|---|---|---|
| Optimal strafe bot | sets view yaw each tick so the wish direction makes the speed-maximising angle θ with velocity, cos θ = (L − k)/\|v\| (or 90°), with k = k_e·τ·M·A | maximise speed | none (analytic controller) | reaches the closed form to 1e-14; 981 u/s after 10 s at 100 tick |
| Fixed-turn bot | holds D and turns the view at a constant ω | human-like strafing | none | best ω ≈ 180 °/s → 897 u/s (A ≥ 100) |
| W-only jumper | holds W and jump | baseline without strafing | none | exactly 250 u/s forever |
| Late jumper | one ground tick before each jump | friction ablation | none | ×0.96 per landing (100 tick) |
| Random-pulse jumper | jump pulse with probability q per tick, anti-pogo active | scroll-wheel model | 4 × 200 seeded runs | retention 0.64–0.89 per landing |
| `css_bhop` preset | 100 tick, A = 1000, auto-bhop, no clamp | bhop-server feel | — | default game preset |
| `css_vanilla` preset | 66.67 tick, A = 10, clamp at 275 u/s, timed jumps | stock CS:S | — | speed resets to ≤ 277 u/s each jump |

## Figures
- [fig1](figures/fig1_speed_vs_time.png) speed vs time, measured vs theory.
- [fig2](figures/fig2_gain_vs_k.png) gain per tick vs k/L.
- [fig3](figures/fig3_interventions.png) interventions.
- [fig4](figures/fig4_fixed_turn.png) constant-turn exploration.
- [fig5](figures/fig5_jump_timing.png) scroll timing.

## Lessons learned
- **Instrument bugs look like physics findings.** The no-cap intervention first showed no gain at all. The cause was
  the bot assuming L = cap rather than L = min(cap, wishspeed), not the movement code. It was found by comparing the
  result with the AirAccelerate source. The fix was verified with a new unit test, and the earlier run is kept as
  data.
- **Write predictions at the right granularity.** The clamp prediction ignored that the jump tick itself
  air-accelerates after the clamp. The run-level bound was right; the tick-level one was not.
- **An oracle built on the same assumptions as the code cannot catch their shared mistakes.**
  - Port and closed form first agreed to 9.4e-15, but both left out Source's 0.25 `m_surfaceFriction` rule for rising
    slowly in the air.
  - Only the code review, comparing the port with the SDK source line by line, found it.
  - Fixing it changed the 8 low-airaccelerate conditions (e.g. 814 → 770 u/s at 66.67 tick, A = 10). Both runs are
    kept.
- **Frame-rate independence holds.** The same 6 s autoplay run reached the identical final speed in headless Chrome on
  Windows (60 fps) and on a GPU-less Linux CI runner (~18 fps), because physics runs on fixed ticks.
