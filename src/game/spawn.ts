// Spawning: place the player on the spawn plaza (block column (0, 0)) and reset their motion.
// Global context: phase "spawnPlayer" of src/main.ts, and the R key (respawn) during play. The plaza is generated perfectly
// flat by world/terrain.ts, so spawning there always starts the player on bunnyhop-friendly ground.
import { Vector3 } from 'three'; // Vector math.
import { DIST_EPSILON, UNITS_PER_BLOCK } from '../physics/constants'; // Units and surface gap.
import { createPlayerState, type PlayerState } from '../physics/player'; // Player state.
import type { World } from '../world/world'; // Terrain height lookup.

/** Spawn position in Hammer units: centre of block column (0, 0), feet just above its surface. */
export function spawnPoint(world: World): Vector3 {
  const surface = world.surfaceZ(0, 0); // First free z above the plaza.
  return new Vector3(UNITS_PER_BLOCK / 2, UNITS_PER_BLOCK / 2, surface * UNITS_PER_BLOCK + DIST_EPSILON); // Bottom-centre of the hull.
}

/** Create the player at the spawn point. */
export function spawnPlayer(world: World): PlayerState {
  return createPlayerState(spawnPoint(world)); // At rest; the first tick categorises ground.
}

/** Move an existing player back to spawn and stop all motion. */
export function respawn(world: World, state: PlayerState): void {
  state.origin.copy(spawnPoint(world)); // Teleport.
  state.velocity.set(0, 0, 0); // Stand still.
  state.onGround = false; // Re-categorised next tick.
}
