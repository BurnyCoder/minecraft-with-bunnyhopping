// Tests for src/game/autoplay.ts — the scripted verification run (?autoplay=N) used to check the full game from logs.
// Global context: autoplay settles, places and breaks one block, then strafe-jumps with the optimal bot and finally logs
// measured vs closed-form speed. Here it runs headless on real terrain to make sure the script and its summary are sound.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { Autoplay } from '../../src/game/autoplay'; // Unit under test.
import { BlockInteraction } from '../../src/game/interaction'; // Block edits.
import { spawnPlayer } from '../../src/game/spawn'; // Spawn on the plaza.
import { configureLogging, createLogger } from '../../src/logging/logger'; // Silent logger.
import { cvarsFromPreset } from '../../src/physics/cvars'; // Presets.
import { playerMove } from '../../src/physics/movement'; // Physics.
import { TerrainGenerator } from '../../src/world/terrain'; // Terrain.
import { World } from '../../src/world/world'; // World.

describe('Autoplay', () => {
  it('edits a block, bunnyhops and reports speed matching the closed form on the flat plaza', () => {
    configureLogging({ level: 'error', sinks: [] }); // Keep test output quiet.
    const world = new World(new TerrainGenerator(1337)); // Default world.
    const cvars = cvarsFromPreset('css_bhop'); // Default preset.
    const player = spawnPlayer(world); // On the plaza.
    const autoplay = new Autoplay(6, new BlockInteraction(world), createLogger('autoplay')); // 6 s run.
    while (autoplay.active) {
      const wasOnGround = player.onGround; // Needed to classify the tick.
      const cmd = autoplay.nextCmd(player, cvars); // Scripted command.
      autoplay.record(player, playerMove(world, player, cmd, cvars), wasOnGround, cvars); // Simulate + observe.
    }
    const summary = autoplay.summary!; // Filled when the run ends.
    expect(summary.editCheck).toBe('passed'); // Place + break worked through the real raycast.
    expect(summary.jumps).toBeGreaterThan(5); // It hopped.
    expect(summary.walkTicksAfterStart).toBe(0); // Never touched the ground long enough for friction.
    expect(summary.finalSpeed).toBeGreaterThan(500); // Far above run speed.
    expect(Math.abs(summary.relativeError!)).toBeLessThan(1e-9); // Matches sqrt(v0^2 + n * 900).
  });
});
