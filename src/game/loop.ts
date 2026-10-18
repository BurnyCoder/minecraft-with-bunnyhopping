// Phase "startGameLoop": the per-frame loop. Fixed physics ticks, interpolated camera, chunk streaming, HUD, rendering.
// Global context: the rest of the game only builds objects; this loop drives them. Every frame:
//   1. FixedStepper turns elapsed real time into N physics ticks (tick_interval from the cvars, e.g. 0.01 s = 100 tick).
//   2. Each tick: a UserCmd from the keyboard/mouse (or the autoplay bot) -> playerMove() (the CS:S movement port).
//   3. The camera eye is interpolated between the last two tick states (smooth at any fps), clamped below ceilings.
//   4. Chunks around the player are streamed within a 4 ms budget, the target block is outlined, and the HUD and scene are drawn.
//   5. Once per second a summary line is logged (fps, speed, position, chunk stats).
// three.js renderer.setAnimationLoop wraps requestAnimationFrame (https://threejs.org/docs/#api/en/renderers/WebGLRenderer.setAnimationLoop).
import { Vector3 } from 'three'; // Vector math.
import type { GameConfig } from '../config'; // Preset name for the HUD.
import type { Logger } from '../logging/logger'; // Logging.
import { UNITS_PER_BLOCK } from '../physics/constants'; // Units.
import type { Cvars } from '../physics/cvars'; // Live cvars.
import { playerMove } from '../physics/movement'; // Movement tick.
import { horizontalSpeed, type PlayerState, type UserCmd } from '../physics/player'; // State.
import type { ChunkRenderer } from '../render/chunkRenderer'; // Streaming.
import type { BlockHighlight } from '../render/highlight'; // Outline.
import type { RenderContext } from '../render/scene'; // Renderer.
import type { Hud } from '../ui/hud'; // HUD.
import type { World } from '../world/world'; // Blocks.
import type { Autoplay } from './autoplay'; // Scripted mode.
import type { InputState } from './input'; // Player input.
import { eyePosition, type BlockInteraction } from './interaction'; // Eye + targeting.
import { FixedStepper } from './stepper'; // Fixed timestep.

/** Everything the loop touches. `teleported` is set by respawn so interpolation does not streak across the map. */
export interface GameContext {
  config: GameConfig; // Static config.
  cvars: Cvars; // Live movement cvars.
  world: World; // Blocks.
  player: PlayerState; // Simulated player.
  input: InputState; // Keyboard/mouse.
  interaction: BlockInteraction; // Break/place.
  autoplay: Autoplay | null; // Verification mode, if requested.
  view: RenderContext; // Renderer + camera.
  chunks: ChunkRenderer; // Streaming.
  highlight: BlockHighlight; // Outline.
  hud: Hud; // Overlay.
  log: Logger; // Output.
  teleported: boolean; // Reset interpolation on the next frame.
}

/** Max physics ticks per frame (beyond that the simulation slows down instead of freezing the tab). */
const MAX_TICKS_PER_FRAME = 8;
/** Chunk mesh build budget per frame, milliseconds. */
const CHUNK_BUDGET_MS = 4;

/** Keep the camera out of a ceiling block: the CS:S eye (64 u) sits 2 u above the hull top (62 u). */
function clampEyeBelowCeiling(world: World, eye: Vector3): void {
  const bz = Math.floor(eye.z / UNITS_PER_BLOCK); // Block row of the eye.
  if (world.isSolid(Math.floor(eye.x / UNITS_PER_BLOCK), Math.floor(eye.y / UNITS_PER_BLOCK), bz)) eye.z = bz * UNITS_PER_BLOCK - 1.5; // Just below the ceiling face.
}

/** Start the animation loop. */
export function startGameLoop(ctx: GameContext): void {
  const { world, player, cvars, view, log } = ctx; // Short names.
  const stepper = new FixedStepper(cvars.tick_interval, MAX_TICKS_PER_FRAME); // Tick scheduler.
  const prevEye = eyePosition(player); // Eye at the previous tick.
  const curEye = prevEye.clone(); // Eye at the latest tick.
  const eye = new Vector3(); // Interpolated eye (scratch).
  let lastCmd: UserCmd | null = null; // For logging.
  let last = performance.now(); // Previous frame time.
  let frames = 0; // Frames since the last summary.
  let ticks = 0; // Ticks since the last summary.
  let jumps = 0; // Jumps since the last summary.
  let fps = 0; // Last measured frame rate.
  let busyMs = 0; // CPU time spent inside frames since the last summary (independent of browser throttling).
  let summaryAt = last + 1000; // Next 1 Hz log.
  log.info('game loop started', { tickRate: Math.round(1 / cvars.tick_interval), preset: ctx.config.preset }); // Lifecycle.

  view.renderer.setAnimationLoop(() => {
    const now = performance.now(); // Frame timestamp.
    stepper.tickInterval = cvars.tick_interval; // Follow live cvar changes (console).
    const n = stepper.advance((now - last) / 1000); // Ticks to run.
    last = now;
    if (ctx.teleported) {
      prevEye.copy(eyePosition(player)); // No interpolation across a teleport.
      curEye.copy(prevEye);
      ctx.teleported = false;
    }
    for (let i = 0; i < n; i++) {
      prevEye.copy(curEye); // Shift history.
      const wasOnGround = player.onGround; // For autoplay's tick classification.
      const autoplay = ctx.autoplay?.active ? ctx.autoplay : null; // Bot or player?
      const cmd = autoplay ? autoplay.nextCmd(player, cvars) : ctx.input.buildCmd(); // This tick's intent.
      const events = playerMove(world, player, cmd, cvars); // CS:S movement.
      autoplay?.record(player, events, wasOnGround, cvars); // Script bookkeeping.
      if (events.jumped) {
        jumps++; // Count for the summary.
        log.debug('jump', { speed: Math.round(horizontalSpeed(player)) }); // Per-jump detail at debug level only.
      }
      curEye.copy(eyePosition(player)); // New eye.
      lastCmd = cmd;
      ticks++;
    }
    eye.lerpVectors(prevEye, curEye, stepper.alpha); // Smooth between ticks.
    clampEyeBelowCeiling(world, eye); // Never render from inside a block.
    const angles = ctx.autoplay?.active ? ctx.autoplay.view : { yaw: ctx.input.yaw, pitch: ctx.input.pitch }; // Who looks.
    view.placeCamera(eye, angles.yaw, angles.pitch); // Camera.
    ctx.chunks.update(Math.floor(eye.x / UNITS_PER_BLOCK), Math.floor(eye.y / UNITS_PER_BLOCK), CHUNK_BUDGET_MS); // Streaming.
    ctx.highlight.set(ctx.interaction.target(player, angles.yaw, angles.pitch)?.block ?? null); // Outline target.
    const speed = horizontalSpeed(player); // Speedometer value.
    const p = player.origin; // Position (u).
    const info = `${Math.round(1 / cvars.tick_interval)} tick  aa ${cvars.sv_airaccelerate}  autobhop ${cvars.sv_autobunnyhopping ? 'on' : 'off'}  cap ${cvars.sv_enablebunnyhopping ? 'off' : 'on'}\npos ${(p.x / UNITS_PER_BLOCK).toFixed(1)} ${(p.y / UNITS_PER_BLOCK).toFixed(1)} ${(p.z / UNITS_PER_BLOCK).toFixed(1)}  ${player.onGround ? 'ground' : 'air'}${ctx.autoplay?.active ? '\nAUTOPLAY' : ''}`; // Debug line.
    ctx.hud.frame({ speed, fps, info }, now); // HUD.
    view.render(); // Draw.
    busyMs += performance.now() - now; // CPU cost of this frame (physics + streaming + render submission).
    frames++;
    if (now >= summaryAt) {
      fps = (frames * 1000) / (now - summaryAt + 1000); // Frames over the last ~second.
      log.info('status', { fps: Math.round(fps), frameCpuMs: Number((busyMs / Math.max(frames, 1)).toFixed(2)), ticks, jumps, speed: Math.round(speed), pos: [p.x, p.y, p.z].map((v) => Math.round(v)), onGround: player.onGround, buttons: lastCmd?.buttons ?? 0, ...ctx.chunks.stats() }); // 1 Hz summary.
      frames = 0; // Reset counters.
      busyMs = 0;
      ticks = 0;
      jumps = 0;
      summaryAt = now + 1000;
    }
  });
}
