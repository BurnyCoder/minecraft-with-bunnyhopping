// Chunk storage: a 16 x 16 x 64 column of block ids in one Uint8Array, plus coordinate helpers.
// Global context: the world is an unbounded grid of chunks keyed by (cx, cy) in the horizontal plane; z (up) is limited
// to CHUNK_HEIGHT blocks. Block (bx, by, bz) lives in chunk (floor(bx/16), floor(by/16)) at local (bx mod 16, by mod 16, bz).
// Layout follows the three.js manual VoxelWorld cell indexing (https://threejs.org/manual/#en/voxel-geometry), with z as the slowest axis.

/** Horizontal chunk size in blocks (x and y). */
export const CHUNK_SIZE = 16;
/** Vertical world height in blocks (z in [0, CHUNK_HEIGHT)). */
export const CHUNK_HEIGHT = 64;
/** Blocks per chunk. */
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;

/** One loaded chunk. */
export interface Chunk {
  cx: number; // Chunk x index.
  cy: number; // Chunk y index.
  blocks: Uint8Array; // BlockId per cell, see localIndex().
}

/** Array index of local cell (x, y, z), each in range. x is fastest so one horizontal row is contiguous. */
export function localIndex(x: number, y: number, z: number): number {
  return x + CHUNK_SIZE * (y + CHUNK_SIZE * z); // z-major layers of 16x16.
}

/** Chunk index containing block coordinate `b` (works for negatives: floor division). */
export function chunkCoord(b: number): number {
  return Math.floor(b / CHUNK_SIZE); // -1 -> chunk -1, 15 -> chunk 0, 16 -> chunk 1.
}

/** Local coordinate of block `b` inside its chunk, always in [0, 16). */
export function localCoord(b: number): number {
  return ((b % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE; // Euclidean modulo (THREE.MathUtils.euclideanModulo equivalent).
}

/** Map key of a chunk. */
export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`; // Simple and unique for integers.
}
