# Movement physics (CS:S port)

How `src/physics/` reproduces Counter-Strike: Source movement, where each rule comes from, and where it deliberately
differs. Verification results are in [reports/](../reports/experiments_summary.md); the README has the short version.

## Frame of reference
- Source frame: x/y horizontal, **z up**, right-handed, Hammer units (u). The player origin is the bottom centre of the
  hull.
- Voxels share the frame: block (bx, by, bz) spans [40·bx, 40·bx + 40] u on each axis.
- Rendering uses the same axes, in block units, with `camera.up = (0, 0, 1)`. No coordinate conversion exists anywhere.
- View angles are in degrees:
  - **Yaw:** 0 = +x, counter-clockwise positive.
  - **Pitch:** positive looks down, clamped to ±89.
  - Mouse: yaw −= dx·0.022·sensitivity, pitch += dy·0.022·sensitivity.

## One tick: `playerMove()` (`src/physics/movement.ts`)

| step | function | Source reference | effect |
|---|---|---|---|
| 1 | `checkParameters` | `CheckParameters` (gamemovement.cpp L981) | clamp (forwardmove, sidemove) to `sv_maxspeed`; then ×0.34 while ducking (Momentum `HandleDuckingSpeedCrop`) |
| 2 | `duck` | `Duck`/`FinishDuck`/`CanUnduck`/`FinishUnDuck` (L4074–4253) | instant hull switch 62 ↔ 45 u; in the air the feet move ±17 u; unduck only if the standing hull fits |
| 3 | `startGravity` | `StartGravity` (L1246) | vz −= g·τ/2, then per-axis `checkVelocity` |
| 4 | `checkJumpButton` | `CheckJumpButton` (L2352) | if grounded and jump not held last tick (or auto-bhop): optional 110% clamp, vz += √(2·800·57), finish gravity |
| 5 | `friction` | `Friction` (L1610) | ground only: v −= max(v, stopspeed)·friction·τ |
| 6 | `walkMove` / `airMove` | `WalkMove` (L1893) / `AirMove` (L1751) | `accelerate` or `airAccelerate` (wishspd capped at 30), then `tryPlayerMove`; walk also does `stayOnGround` |
| 7 | `categorizePosition` | `CategorizePosition` (L3794) | vz > 140 → airborne; else grounded if a block lies within 2 u below (landing zeroes vz) |
| 8 | `finishGravity` | `FinishGravity` (L1682) | vz −= g·τ/2; if grounded vz = 0 |
| 9 | — | `FinishMove` (L1197) | oldButtons = buttons (anti-pogo memory) |

Line numbers refer to `src/game/shared/gamemovement.cpp` in the 2025 tree of
[ValveSoftware/source-sdk-2013](https://github.com/ValveSoftware/source-sdk-2013). The code is reimplemented, not copied.

**Why bhop works:** step 4 runs before step 5. A jump on the first ground tick sets the player airborne, so friction is
skipped and the tick uses `airMove`. In `airAccelerate`, the *room* (30 − v·wishdir) is capped at 30 u/s while the
*amount* (A·wishspeed·τ) uses the full 250 u/s. Keeping the wish direction nearly perpendicular to the velocity
(strafing while turning) therefore adds speed every tick.

## Collision (`src/physics/collision.ts`)
- **Sweep:** `traceHull` sweeps the player box through every block cell overlapping the swept volume, so even
  3500 u/s × 0.03 s = 105 u per tick cannot tunnel through a 40 u block. It finds the earliest slab entry, stopping
  `DIST_EPSILON` = 1/32 u (Source `coordsize.h`) before the face.
- **Slide:** `tryPlayerMove` repeats up to 4 bumps (Source `numbumps = 4`). On each hit it zeroes the velocity
  component along the hit axis. That equals `ClipVelocity` with overbounce 1, because every voxel face is axis-aligned.

## Constants

| constant | value | source |
|---|---|---|
| hull standing / ducked | 32×32×62 u / 32×32×45 u | VDC Dimensions page; Momentum `g_ViewVectorsMom` |
| eye height standing / ducked | 64 / 47 u | Momentum `g_ViewVectorsMom` |
| jump impulse | √(2·800·57) ≈ 301.993 u/s | Momentum `GetJumpFactor` |
| air speed cap | 30 u/s | SDK `GetAirSpeedCap()` |
| NON_JUMP_VELOCITY | 140 u/s | SDK `CategorizePosition` |
| ground probe / step size | 2 u / 18 u | SDK `CategorizePosition`; VDC Dimensions |
| duck speed multiplier | 0.34 | Momentum `DUCK_SPEED_MULTIPLIER` |
| bhop clamp factor | 1.1 × maxspeed | VDC Bunnyhop page (TF2 code uses 1.2) |
| cl_forwardspeed / cl_sidespeed | 400 u/s | Source defaults |
| 1 block | 40 u | design choice (player 1.55 blocks tall) |

Preset values (tick, airaccelerate, …) are in the [README](../README.md#movement-presets) and `src/physics/cvars.ts`.

## Deliberate deviations from Source
- **Instant duck.** Source animates ducking on the ground over time.
- **No `StepMove`.** Blocks (40 u) are taller than the 18 u step, so stairs-stepping never applies.
  `StayOnGround` is kept.
- **Not implemented:** water, ladders, base velocity (conveyors), surface friction (fixed at 1).
- **float64 arithmetic** instead of Source's float32.
- **No CS:S jump stamina.** We could not confirm vanilla CS:S stamina from public sources. Momentum Mod applies it only
  in its KZ mode.
- **Clamp placement.** The 110% clamp is applied on jump (TF2 `PreventBunnyJumping` placement). The Valve wiki only
  says the clamp limits air velocity.
- **Ducked jump.** A ducked jump sets vz = impulse (the SDK base behaviour).

## Strafe bot (`src/physics/strafeBot.ts`)
- **Optimal mode:** each tick the bot sets the yaw so that the wish direction makes angle θ with the velocity.
  - cos θ = (L − k)/|v| if L > k, else θ = 90°.
  - L = min(`sv_airspeedcap`, wishspeed); k = τ·wishspeed·A.
  - Formulas from [jwchong.com/hl/strafing.html](https://www.jwchong.com/hl/strafing.html).
- **`optimalGainPerTick`:** the matching closed form, g = L² if k ≥ L else k(2L − k).
- **Fixed-turn mode:** turns at a constant rate instead, like a person moving the mouse.
- **Shared by:** the tests, `?autoplay`, and the experiments.
