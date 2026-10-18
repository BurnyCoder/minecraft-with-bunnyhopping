// Tests for src/world/world.ts — the lazy chunk store that physics, rendering and block interaction all share.
// Global context: blocks are addressed by global integer coordinates (including negatives); chunk boundaries must be
// invisible to callers, edits must survive chunk unload/regeneration, and border edits must notify neighbour chunks
// so their meshes get rebuilt.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { BlockId } from '../../src/world/blocks'; // Block ids.
import { CHUNK_HEIGHT } from '../../src/world/chunk'; // World height.
import { World, type ChunkGenerator } from '../../src/world/world'; // Unit under test.

/** Generator that produces only air, so tests control every block. */
const empty: ChunkGenerator = { generateChunk: () => undefined }; // Leaves the zeroed array untouched.

describe('World', () => {
  it('reads back blocks set across chunk borders and negative coordinates', () => {
    const world = new World(empty); // Blank world.
    const spots: [number, number, number][] = [[0, 0, 5], [15, 15, 5], [16, 0, 5], [-1, -1, 5], [-17, 33, 63]]; // Border/negative cells.
    spots.forEach(([x, y, z], i) => world.setBlock(x, y, z, (i % 9) + 1)); // Distinct ids.
    spots.forEach(([x, y, z], i) => expect(world.getBlock(x, y, z)).toBe((i % 9) + 1)); // Same ids back.
    expect(world.getBlock(1, 0, 5)).toBe(BlockId.AIR); // Untouched neighbour stays air.
  });

  it('treats z < 0 as solid bedrock and z >= height as air', () => {
    const world = new World(empty); // Blank world.
    expect(world.isSolid(3, 3, -1)).toBe(true); // Cannot fall out of the world.
    expect(world.getBlock(3, 3, CHUNK_HEIGHT)).toBe(BlockId.AIR); // Sky above the ceiling.
    expect(world.setBlock(3, 3, CHUNK_HEIGHT, BlockId.STONE)).toBe(false); // Out of range: rejected.
  });

  it('keeps edits when a chunk is unloaded and regenerated', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(40, -40, 10, BlockId.BRICKS); // Edit.
    world.unloadChunk(2, -3); // Drop the chunk holding (40, -40).
    expect(world.hasChunk(2, -3)).toBe(false); // Really unloaded.
    expect(world.getBlock(40, -40, 10)).toBe(BlockId.BRICKS); // Regenerated with the edit applied.
  });

  it('exports and re-imports edits (negative coordinates included) into a fresh world', () => {
    const world = new World(empty); // Blank world.
    const edits: [number, number, number, BlockId][] = [[-1, -1, 0, BlockId.STONE], [-17, 33, 63, BlockId.SAND], [40, -40, 10, BlockId.AIR]]; // Mixed cells.
    for (const [x, y, z, id] of edits) world.setBlock(x, y, z, id); // Apply.
    const exported = world.exportEdits(); // Global tuples.
    expect([...exported].sort()).toEqual([...edits].sort()); // Same set back.
    const fresh = new World(empty); // New session.
    fresh.importEdits(exported); // Load before generation.
    for (const [x, y, z, id] of edits) expect(fresh.getBlock(x, y, z)).toBe(id); // Applied on generation.
    expect(fresh.getBlock(-1, -1, 1)).toBe(BlockId.AIR); // Nothing leaks into other cells.
  });

  it('notifies listeners with every chunk whose mesh an edit affects', () => {
    const world = new World(empty); // Blank world.
    const touched: string[] = []; // Chunk keys reported.
    world.onChunkChanged((cx, cy) => touched.push(`${cx},${cy}`)); // Subscribe.
    world.setBlock(16, 31, 2, BlockId.STONE); // Local (0, 15): borders chunks (0,1) and (1,2).
    expect(touched.sort()).toEqual(['0,1', '1,1', '1,2'].sort()); // Own chunk + the two neighbours sharing faces.
  });

  it('finds the surface height for spawning', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(5, 5, 0, BlockId.BEDROCK); // Floor...
    world.setBlock(5, 5, 7, BlockId.STONE); // ...and a higher block.
    expect(world.surfaceZ(5, 5)).toBe(8); // First free z above the top block.
  });
});
