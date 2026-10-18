// Tests for src/world/raycast.ts — voxel traversal used to pick the block under the crosshair.
// Global context: breaking needs the first solid block along the view ray; placing needs the face normal to put
// the new block on the correct side; reach is limited like Minecraft (~5 blocks).
import { describe, expect, it } from 'vitest'; // Vitest API.
import { BlockId } from '../../src/world/blocks'; // Block ids.
import { raycastBlock } from '../../src/world/raycast'; // Unit under test.
import { World, type ChunkGenerator } from '../../src/world/world'; // Block source.

const empty: ChunkGenerator = { generateChunk: () => undefined }; // All-air generator.

describe('raycastBlock', () => {
  it('hits the first solid block and reports the entered face normal', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(3, 0, 10, BlockId.STONE); // Target in front.
    world.setBlock(5, 0, 10, BlockId.STONE); // Farther block behind it.
    const hit = raycastBlock(world, [0.5, 0.5, 10.5], [1, 0, 0], 10); // Look along +x.
    expect(hit?.block).toEqual([3, 0, 10]); // Nearest block.
    expect(hit?.normal).toEqual([-1, 0, 0]); // Entered through its -x face.
    expect(hit?.distance).toBeCloseTo(2.5, 9); // From x = 0.5 to the face at x = 3.
  });

  it('works downwards onto a floor (normal +z) and diagonally', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(0, 0, 4, BlockId.DIRT); // Floor block.
    expect(raycastBlock(world, [0.5, 0.5, 7.2], [0, 0, -1], 10)?.normal).toEqual([0, 0, 1]); // Top face.
    world.setBlock(2, 2, 7, BlockId.DIRT); // Diagonal target.
    const d = Math.SQRT1_2; // 45 degrees in the x/y plane.
    expect(raycastBlock(world, [0.5, 0.5, 7.5], [d, d, 0], 10)?.block).toEqual([2, 2, 7]); // Found through cell corners.
  });

  it('returns null beyond reach', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(9, 0, 10, BlockId.STONE); // Far block.
    expect(raycastBlock(world, [0.5, 0.5, 10.5], [1, 0, 0], 5)).toBeNull(); // 8.5 blocks away > reach 5.
  });
});
