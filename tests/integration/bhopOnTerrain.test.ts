// Integration test: the real terrain generator + World + movement + strafe bot, exactly as the game wires them.
// Global context: unit tests use idealised floors; this checks that the spawn plaza really is a flat bhop arena,
// that the player never ends up inside a block, and that strafe-jumping gains speed on generated terrain.
import { Vector3 } from 'three'; // Vector math.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { DIST_EPSILON, UNITS_PER_BLOCK } from '../../src/physics/constants'; // Units.
import { cvarsFromPreset } from '../../src/physics/cvars'; // Presets.
import { isStuck, playerMove } from '../../src/physics/movement'; // Movement.
import { createPlayerState, horizontalSpeed } from '../../src/physics/player'; // State.
import { StrafeBot } from '../../src/physics/strafeBot'; // Bot.
import { TerrainGenerator } from '../../src/world/terrain'; // Real terrain.
import { World } from '../../src/world/world'; // Real world.

describe('bunnyhopping on generated terrain', () => {
  it('gains speed on the spawn plaza without ever getting stuck', () => {
    const world = new World(new TerrainGenerator(1337)); // Default seed.
    const cvars = cvarsFromPreset('css_bhop'); // Default preset.
    const spawnZ = world.surfaceZ(0, 0) * UNITS_PER_BLOCK + DIST_EPSILON; // Stand on the plaza.
    const player = createPlayerState(new Vector3(UNITS_PER_BLOCK / 2, UNITS_PER_BLOCK / 2, spawnZ)); // Centre of block (0, 0).
    const bot = new StrafeBot({ mode: 'optimal', direction: 1, jumpMode: 'hold' }); // Auto-bhop strafer.
    let jumps = 0; // Hop count.
    for (let tick = 0; tick < 300; tick++) {
      if (playerMove(world, player, bot.nextCmd(player, cvars), cvars).jumped) jumps++; // 3 s of play.
      expect(isStuck(world, player)).toBe(false); // Never inside a block.
    }
    expect(jumps).toBeGreaterThanOrEqual(4); // Hopping happened.
    expect(horizontalSpeed(player)).toBeGreaterThan(400); // Well above the 250 u/s run speed.
  });
});
