# Configuration reference

All configuration is optional. Precedence, highest first:
1. In-game console (`) — live changes; movement cvars and sensitivity only.
2. URL query parameters.
3. `.env` (`VITE_*` keys; template: [.env.example](../.env.example)).
4. Built-in defaults (`src/config.ts`, `src/physics/cvars.ts`).

Invalid values are rejected with a logged warning; the default (or the previous value) is kept.

## General settings

| `.env` key | URL | default | range | meaning |
|---|---|---|---|---|
| `VITE_PRESET` | `?preset=` | `css_bhop` | `css_bhop`, `css_vanilla` | movement preset |
| `VITE_SEED` | `?seed=` | 1337 | 32-bit integer | terrain seed (edits are saved per seed) |
| `VITE_RENDER_DISTANCE` | `?rd=` | 6 | 2–16 | view radius in chunks |
| `VITE_FOV` | — | 90 | 60–130 | horizontal FOV at 4:3 (Hor+) |
| `VITE_SENSITIVITY` | — | 2 | 0.01–50 | CS:S sensitivity |
| `VITE_LOG_LEVEL` | `?log=` | `info` | debug, info, warn, error | minimum log level (`debug` adds one line per jump) |
| — | `?autoplay=` | 0 | 0–3600 s | scripted verification run |

## Movement cvars
Each key is `VITE_` + the cvar name upper-cased (`.env`), or the plain name (console).

| cvar | css_bhop | css_vanilla | range |
|---|---|---|---|
| `tick_interval` | 0.01 | 0.015 | 0.001–0.1 s |
| `sv_gravity` | 800 | 800 | 0–10000 |
| `sv_accelerate` | 5 | 5 | 0–1000 |
| `sv_airaccelerate` | 1000 | 10 | 0–100000 |
| `sv_friction` | 4 | 4 | 0–100 |
| `sv_stopspeed` | 75 | 75 | 0–10000 |
| `sv_maxspeed` | 250 | 250 | 1–10000 |
| `sv_maxvelocity` | 3500 | 3500 | 1–1000000 |
| `sv_enablebunnyhopping` | 1 | 0 | 0/1 (true/false) |
| `sv_autobunnyhopping` | 1 | 0 | 0/1 |
| `sv_airspeedcap` | 30 | 30 | 0–100000 (for experiments; Source hardcodes 30) |

## Console commands
- `help`, `cvarlist`
- `<cvar>` (print) and `<cvar> <value>` (set)
- `preset <name>` (overwrite all cvars)
- `sensitivity [value]`
- `world_reset` (clear saved edits for this seed and reload)

## Storage
Block edits are saved in `localStorage` under `bhopcraft:edits:<seed>` as a JSON array of [x, y, z, blockId]. They are
written 1 s after the last edit and validated on load.
