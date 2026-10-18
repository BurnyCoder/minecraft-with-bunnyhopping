// Voxel ray traversal (Amanatides & Woo, "A Fast Voxel Traversal Algorithm for Ray Tracing", Eurographics 1987):
// step from cell to cell along the ray, always crossing the nearest cell boundary next, until a solid block is hit.
// Global context: game/interaction.ts casts the view ray (in block units) to find the block to break, and uses the
// entered face normal to know where a new block goes; render/highlight.ts outlines the same block.
// Adapted from the three.js manual VoxelWorld.intersectRay (MIT, https://threejs.org/manual/#en/voxel-geometry),
// changed to take a direction + max distance and to test solidity through the block table.
import { BLOCKS } from './blocks'; // Solidity lookup.
import type { BlockSource } from './mesher'; // Read-only block access.

/** A ray hit: block coordinates, outward normal of the face that was entered, and distance along the ray (blocks). */
export interface RayHit {
  block: [number, number, number]; // Integer block coordinates.
  normal: [number, number, number]; // Face normal (zero vector if the ray started inside a block).
  distance: number; // Distance from the origin to the entry point.
}

/** Cast from `origin` along unit vector `dir` for at most `maxDistance` blocks; null if nothing solid is hit. */
export function raycastBlock(world: BlockSource, origin: readonly number[], dir: readonly number[], maxDistance: number): RayHit | null {
  const cell = origin.map(Math.floor); // Current cell [ix, iy, iz].
  const step = dir.map((d) => (d > 0 ? 1 : -1)); // Direction of travel per axis.
  const tDelta = dir.map((d) => Math.abs(1 / d)); // Ray length to cross one cell per axis (Infinity if d = 0).
  const tMax = origin.map((o, i) => {
    const dist = step[i] > 0 ? cell[i] + 1 - o : o - cell[i]; // Distance to the first boundary along axis i.
    return tDelta[i] < Infinity ? tDelta[i] * dist : Infinity; // Ray length to reach it.
  });
  let t = 0; // Distance travelled.
  let stepped = -1; // Axis crossed last (-1 = still in the start cell).
  while (t <= maxDistance) {
    if (BLOCKS[world.getBlock(cell[0], cell[1], cell[2])].solid) {
      const normal: [number, number, number] = [0, 0, 0]; // Entered face normal...
      if (stepped >= 0) normal[stepped] = -step[stepped]; // ...points back along the last step.
      return { block: [cell[0], cell[1], cell[2]], normal, distance: t };
    }
    const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2; // Nearest boundary.
    cell[axis] += step[axis]; // Enter the next cell.
    t = tMax[axis]; // Distance at that boundary.
    tMax[axis] += tDelta[axis]; // Next boundary on this axis.
    stepped = axis; // Remember for the normal.
  }
  return null; // Out of reach.
}
