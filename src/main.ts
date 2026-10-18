// BhopCraft entry point: the single top-level wrapper that runs the game's phases in order.
// Global context: each phase is a small, clearly named function imported from its own module; this file only wires
// them together so the startup sequence reads top to bottom:
//   loadConfig -> initLogging -> createRenderer -> createWorld -> spawnPlayer -> createHud -> bindInput -> startGameLoop
// See README.md ("What happens when you run it") for the data flow between these phases.
import { loadConfig } from './config'; // Phase 1: .env + URL -> GameConfig.
import { Autoplay } from './game/autoplay'; // Optional scripted verification run.
import { DevConsole } from './game/console'; // CS:S-style ` console.
import { bindDomInput, InputState } from './game/input'; // Phase 7: keyboard/mouse.
import { BlockInteraction } from './game/interaction'; // Break/place.
import { startGameLoop, type GameContext } from './game/loop'; // Phase 8: frame loop.
import { browserStore, editsKey } from './game/persistence'; // Saved edits (for world_reset).
import { respawn, spawnPlayer } from './game/spawn'; // Phase 5: player on the plaza.
import { createWorld } from './game/worldSetup'; // Phase 4: world, textures, chunk streaming.
import { createLogger } from './logging/logger'; // Module loggers.
import { initLogging } from './logging/setup'; // Phase 2: console + log-file sinks.
import { createRenderer } from './render/scene'; // Phase 3: WebGL renderer + camera.
import { Hud } from './ui/hud'; // Phase 6: overlay.

/** Run all startup phases. Errors are logged and shown instead of failing silently. */
function main(): void {
  const config = loadConfig(); // Phase 1: read and validate configuration.
  const log = initLogging(config); // Phase 2: start logging (file + terminal + console).
  log.info('BhopCraft starting', { preset: config.preset, cvars: config.cvars, seed: config.seed, renderDistance: config.renderDistance }); // Full config.
  try {
    const container = document.getElementById('app')!; // Page root from index.html.
    const view = createRenderer(container, config.fovDeg, config.renderDistance); // Phase 3.
    const { world, atlasCanvas, chunks, highlight } = createWorld(config, view.scene, createLogger('world')); // Phase 4.
    const player = spawnPlayer(world); // Phase 5.
    const hud = new Hud(container, atlasCanvas, 'BhopCraft'); // Phase 6.
    const interaction = new BlockInteraction(world); // Block editing.
    const input = new InputState(config.sensitivity); // Input accumulator.
    const autoplay = config.autoplaySeconds > 0 ? new Autoplay(config.autoplaySeconds, interaction, createLogger('autoplay')) : null; // Verification mode.
    const ctx: GameContext = { config, cvars: config.cvars, world, player, input, interaction, autoplay, view, chunks, highlight, hud, log, teleported: false }; // Shared context.
    const blockLog = createLogger('blocks'); // Edit events.
    bindDomInput(view.renderer.domElement, input, {
      onBreak: () => {
        const hit = interaction.breakBlock(player, input.yaw, input.pitch); // Remove target.
        if (hit) blockLog.info('block broken', { at: hit.block }); // Log edits.
      },
      onPlace: () => {
        const at = interaction.placeBlock(player, input.yaw, input.pitch); // Add selected block.
        if (at) blockLog.info('block placed', { at, block: interaction.selectedBlock }); // Log edits.
      },
      onSelectSlot: (slot) => {
        interaction.selectSlot(slot); // Change selection...
        hud.selectSlot(interaction.selectedSlot); // ...and show it.
      },
      onRespawn: () => {
        respawn(world, player); // Back to the plaza.
        ctx.teleported = true; // Skip interpolation this frame.
        log.info('respawned');
      },
      onLockChange: (locked) => hud.setOverlay(!locked && !autoplay?.active), // Overlay while not playing.
    }); // Phase 7.
    hud.setOverlay(!autoplay); // Autoplay needs no click.
    new DevConsole(container, {
      cvars: config.cvars, // Live cvars (the loop reads them every tick).
      input, // Sensitivity.
      resetWorld: () => {
        browserStore()?.removeItem(editsKey(config.seed)); // Forget saved edits...
        location.reload(); // ...and regenerate the pristine world.
      },
    }, createLogger('console')); // ` opens it.
    if (import.meta.env.DEV) (window as unknown as { __bhopcraft: GameContext }).__bhopcraft = ctx; // Dev-only hook for scripted visual checks (stripped from production builds).
    startGameLoop(ctx); // Phase 8.
  } catch (error) {
    log.error('startup failed', { error: String(error), stack: (error as Error).stack }); // Full error in logs.
    document.body.insertAdjacentText('beforeend', `BhopCraft failed to start: ${String(error)}`); // Visible message.
  }
}

main(); // Vite loads this module once per page.
