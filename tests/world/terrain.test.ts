// Tests for src/world/terrain.ts — seeded procedural terrain (simplex fBm heights, layers, spawn plaza, trees).
// Global context: generation must be a pure function of (seed, chunk) so chunks can be unloaded and regenerated
// identically, and the spawn plaza must be flat because uneven block edges stop bunnyhops dead.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { BlockId } from '../../src/world/blocks'; // Block ids.
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, localIndex } from '../../src/world/chunk'; // Chunk layout.
import { PLAZA_RADIUS, TerrainGenerator } from '../../src/world/terrain'; // Unit under test.

/** Generate one chunk's block array. */
function chunk(seed: number, cx: number, cy: number): Uint8Array {
  const out = new Uint8Array(CHUNK_VOLUME); // Zeroed = air.
  new TerrainGenerator(seed).generateChunk(cx, cy, out); // Fill it.
  return out;
}

/** Height of the highest non-air block in local column (x, y), or -1. */
function topZ(blocks: Uint8Array, x: number, y: number): number {
  for (let z = CHUNK_HEIGHT - 1; z >= 0; z--) if (blocks[localIndex(x, y, z)] !== BlockId.AIR) return z; // Scan down.
  return -1;
}

describe('TerrainGenerator', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(chunk(1, 3, -2)).toEqual(chunk(1, 3, -2)); // Same inputs -> identical bytes.
    expect(chunk(1, 3, -2)).not.toEqual(chunk(2, 3, -2)); // Different seed -> different terrain.
  });

  it('puts bedrock at z = 0 and a grass/dirt/stone column under every non-tree surface', () => {
    const blocks = chunk(7, 5, 5); // Away from the plaza.
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        expect(blocks[localIndex(x, y, 0)]).toBe(BlockId.BEDROCK); // Unbreakable floor.
        const surface = new TerrainGenerator(7).heightAt(5 * CHUNK_SIZE + x, 5 * CHUNK_SIZE + y); // Terrain surface z.
        expect([BlockId.GRASS, BlockId.SAND]).toContain(blocks[localIndex(x, y, surface)]); // Top layer.
        expect(blocks[localIndex(x, y, surface - 4)]).toBe(BlockId.STONE); // Stone below the dirt layers.
      }
    }
  });

  it('keeps every column within world height with room above for trees', () => {
    for (const [cx, cy] of [[0, 0], [10, -7], [-30, 22]]) {
      const blocks = chunk(99, cx, cy); // Several regions.
      for (let x = 0; x < CHUNK_SIZE; x++) for (let y = 0; y < CHUNK_SIZE; y++) expect(topZ(blocks, x, y)).toBeLessThan(CHUNK_HEIGHT - 1); // Never hits the ceiling.
    }
  });

  it('flattens a spawn plaza of PLAZA_RADIUS blocks around the origin', () => {
    const gen = new TerrainGenerator(1234); // Any seed.
    const h = gen.heightAt(0, 0); // Plaza height.
    for (let bx = -PLAZA_RADIUS; bx <= PLAZA_RADIUS; bx += 3)
      for (let by = -PLAZA_RADIUS; by <= PLAZA_RADIUS; by += 3)
        if (bx * bx + by * by <= PLAZA_RADIUS * PLAZA_RADIUS) expect(gen.heightAt(bx, by)).toBe(h); // Perfectly flat.
  });
});
