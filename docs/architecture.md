# Architecture

Module responsibilities and how data moves between them. The startup sequence and the architecture graph are in the
[README](../README.md#architecture); physics details are in [movement-physics.md](movement-physics.md).

## Layers
`physics/` and `world/` never import from `game/`, `render/` or `ui/`. `config.ts` imports only the preset table from
`physics/cvars.ts`.

| layer | folder | DOM/WebGL? | responsibility |
|---|---|---|---|
| config + logging | `src/config.ts`, `src/logging/` | no (except `httpSink`, `setup`) | validated settings; timestamped logs to console, terminal and file |
| physics | `src/physics/` | no | CS:S movement, swept voxel collision, presets, strafe bot |
| world | `src/world/` | no | block table, atlas layout, terrain, lazy chunk store, mesher, raycast |
| game logic | `src/game/` (`stepper`, `input` `InputState`, `interaction`, `autoplay`, `persistence`, `console` `runCommand`, `spawn`) | no | per-tick commands, block editing, scripted runs, saving, console commands |
| rendering + UI | `src/render/`, `src/ui/`, DOM parts of `src/game/` | yes | three.js scene, textures, chunk streaming, highlight, HUD, DOM input, console panel |
| wiring | `src/main.ts`, `src/game/loop.ts`, `src/game/worldSetup.ts` | yes | phases and the frame loop |

Everything above "rendering" runs in Node, which is why unit tests, experiments and the autoplay test all exercise the
same code that ships in the game.

## Key data structures
- **`PlayerState`** (`physics/player.ts`): origin, velocity, onGround, ducked, oldButtons. Mutated only by `playerMove`
  (and by respawn).
- **`UserCmd`:** forwardmove, sidemove, buttons, viewYaw, viewPitch. Built once per tick by `InputState.buildCmd()`
  or `Autoplay.nextCmd()`.
- **`Cvars`:** one live object shared by the loop, the console and the HUD (the console edits it in place).
- **`World`:**
  - `Map<"cx,cy", Chunk>`, where each chunk is a `Uint8Array(16·16·64)` indexed x + 16·(y + 16·z).
  - An edit overlay `Map<"x,y,z", BlockId>`.
  - Change listeners that fire for the edited chunk and any neighbour sharing the edited face.

## Frame loop (`src/game/loop.ts`)
1. **Ticks:** `FixedStepper.advance(frameSeconds)` decides how many ticks to run (at most 0.1 s of simulation per
   frame; a backlog beyond that is dropped).
2. **Per tick:** command → `playerMove` → events (jumped/landed) → eye history.
3. **Camera:** the eye is lerped by `stepper.alpha`, clamped below ceilings, then `placeCamera`.
4. **Streaming:** `ChunkRenderer.update` rebuilds dirty chunks first, then the nearest missing chunks within the
   radius, then evicts far chunks (meshes beyond R+1, data beyond R+3), all within 4 ms.
5. **Draw:** highlight raycast, HUD (DOM writes throttled to 20 Hz), render.
6. **1 Hz:** a `status` log line, including `frameErrors`.
7. **Errors:** an exception inside a frame is caught. The first one is logged with its stack, so a bug cannot freeze the
   picture silently. Uncaught errors and unhandled promise rejections also go to the log file.

## Performance (measured)
- **Meshing:** generating plus meshing a chunk takes ~0.8–1.0 ms (Node benchmark and in-game `avgBuildMs`).
  - It uses a padded copy of the chunk plus the four neighbour edges.
  - The first version read neighbours through `world.getBlock` at ~11 ms per chunk; the padded copy gave the same faces
    13× faster.
- **Per frame:** about 0.6–1.3 ms of CPU in headless Chrome (`frameCpuMs` in the status log).
- **Startup:** the 113 chunks around spawn are meshed in ~0.1 s.

## Logging and verification hooks
- **Browser log path:** `logging/httpSink.ts` batches lines (under 60 kB per request) to `POST /__log?session=<id>`.
  `server/logPlugin.ts` then:
  - rejects cross-origin posts (403),
  - validates the id with a regex,
  - caps bodies at 1 MiB and session files at 50 MiB,
  - replaces terminal control characters,
  - appends to `logs/game_<id>.log` and echoes to the terminal.
- **Dev hook:** in dev builds only, `window.__bhopcraft` exposes the `GameContext` for scripted visual checks.
- **E2E check:** `scripts/e2e.ts` starts Vite, drives headless Chrome with `?autoplay`, saves screenshots to
  `logs/screenshots/`, and treats the page's own session log (id taken from its console) as the oracle.
