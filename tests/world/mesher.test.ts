// Tests for src/world/mesher.ts — face-culled chunk geometry (positions, atlas UVs, shade colours, indices).
// Global context: one mesh per chunk is what keeps rendering fast; faces between two solid blocks must be culled
// (including across chunk borders), and every triangle must wind counter-clockwise seen from outside, because three.js
// culls back faces by default (Material.side = FrontSide).
import { Vector3 } from 'three'; // Vector math.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { BlockId } from '../../src/world/blocks'; // Block ids.
import { buildChunkMesh } from '../../src/world/mesher'; // Unit under test.
import { World, type ChunkGenerator } from '../../src/world/world'; // Block source.

const empty: ChunkGenerator = { generateChunk: () => undefined }; // All-air generator.

/** Vertex i of a mesh as a Vector3. */
function vertex(positions: Float32Array, i: number): Vector3 {
  return new Vector3(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]); // xyz triple.
}

describe('buildChunkMesh', () => {
  it('emits 6 faces (24 vertices, 36 indices) for one isolated block', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(3, 4, 5, BlockId.STONE); // One block.
    const mesh = buildChunkMesh(world, 0, 0); // Chunk containing it.
    expect(mesh.faceCount).toBe(6); // Cube faces.
    expect(mesh.positions.length).toBe(24 * 3); // 4 vertices per face.
    expect(mesh.indices.length).toBe(36); // 2 triangles per face.
    expect(mesh.uvs.length).toBe(24 * 2); // One UV per vertex.
    expect(mesh.colors.length).toBe(24 * 3); // RGB shade per vertex.
  });

  it('culls the shared face between adjacent blocks, also across a chunk border', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(5, 5, 5, BlockId.STONE); // Two neighbours inside chunk (0, 0)...
    world.setBlock(6, 5, 5, BlockId.DIRT); // ...sharing one face each.
    expect(buildChunkMesh(world, 0, 0).faceCount).toBe(10); // 12 - 2 hidden.
    world.setBlock(15, 0, 5, BlockId.STONE); // Last column of chunk 0...
    world.setBlock(16, 0, 5, BlockId.STONE); // ...touching first column of chunk 1.
    expect(buildChunkMesh(world, 0, 0).faceCount).toBe(10 + 5); // Border face hidden in chunk 0.
    expect(buildChunkMesh(world, 1, 0).faceCount).toBe(5); // And in chunk 1.
  });

  it('winds every triangle counter-clockwise when seen from outside the block', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(8, 8, 8, BlockId.GRASS); // One block centred at (8.5, 8.5, 8.5) in local coords.
    const mesh = buildChunkMesh(world, 0, 0); // Its six faces.
    const centre = new Vector3(8.5, 8.5, 8.5); // Block centre.
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => vertex(mesh.positions, mesh.indices[t + k])); // Triangle corners.
      const normal = b.clone().sub(a).cross(c.clone().sub(a)); // Right-hand rule: CCW => normal towards viewer.
      const outward = a.clone().add(b).add(c).divideScalar(3).sub(centre); // Centre -> triangle centroid.
      expect(normal.dot(outward)).toBeGreaterThan(0); // Front face points away from the block.
    }
  });

  it('keeps UVs inside the atlas', () => {
    const world = new World(empty); // Blank world.
    world.setBlock(1, 1, 1, BlockId.LOG); // Block with distinct top/side tiles.
    for (const value of buildChunkMesh(world, 0, 0).uvs) {
      expect(value).toBeGreaterThan(0); // Inset keeps UVs strictly inside...
      expect(value).toBeLessThan(1); // ...the [0, 1] texture square.
    }
  });
});
