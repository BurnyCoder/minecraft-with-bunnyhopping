// Chunk mesher: turns a chunk's blocks into one face-culled triangle mesh (positions, atlas UVs, shade colours, indices).
// Global context: render/chunkRenderer.ts uploads the arrays into a three.js BufferGeometry. Only faces between a solid
// block and a non-solid neighbour are emitted, so buried faces never reach the GPU. Neighbours in adjacent chunks are
// read through the world, so chunk borders are culled correctly too.
// Based on the three.js manual "Voxel(Minecraft Like) Geometry" generateGeometryDataForCell and its faces table
// (MIT, https://threejs.org/manual/#en/voxel-geometry, manual/examples/voxel-geometry-culled-faces-ui.html). That
// table is y-up; we rotate it into this project's z-up frame with (X, Y, Z) -> (X, 1 - Z, Y), a proper rotation plus
// a translation inside the unit cube, so triangle winding (counter-clockwise from outside) is preserved.
import { BLOCKS, BlockId, tileIndex, type Tile } from './blocks'; // Block properties and atlas tiles.
import { tileUV } from './atlas'; // Atlas UV helper.
import { CHUNK_HEIGHT, CHUNK_SIZE, localIndex, type Chunk } from './chunk'; // Chunk dimensions.

/** Read-only block access (the World implements it); used by raycast.ts. */
export interface BlockSource {
  getBlock(bx: number, by: number, bz: number): BlockId;
}

/** Chunk access the mesher needs (the World implements it, generating chunks on demand). */
export interface ChunkSource {
  getChunk(cx: number, cy: number): Chunk;
}

/** Padded copy dimensions: the chunk plus a one-block border on every side (z border = bedrock below, air above). */
const PAD = CHUNK_SIZE + 2; // 18 cells along x and y.
const PAD_H = CHUNK_HEIGHT + 2; // 66 cells along z.

/** Index into the padded array for local coordinates in [-1, 16] x [-1, 16] x [-1, 64]. */
function padIndex(x: number, y: number, z: number): number {
  return x + 1 + PAD * (y + 1 + PAD * (z + 1)); // Shift by one so -1 maps to 0.
}

/**
 * Copy chunk (cx, cy) and the facing edge columns of its 4 horizontal neighbours into one padded array, so the mesh loop
 * reads neighbours by plain indexing instead of ~115k world lookups (measured: ~11 ms -> ~1-2 ms per chunk).
 * Diagonal neighbours are never needed: face culling only looks along the 6 axis directions.
 */
function paddedBlocks(world: ChunkSource, cx: number, cy: number): Uint8Array {
  const out = new Uint8Array(PAD * PAD * PAD_H); // Zero = air (covers the z = 64 ceiling border).
  const own = world.getChunk(cx, cy).blocks; // This chunk.
  const west = world.getChunk(cx - 1, cy).blocks; // -x neighbour (its local x = 15 touches our x = -1).
  const east = world.getChunk(cx + 1, cy).blocks; // +x neighbour (its x = 0 touches our x = 16).
  const south = world.getChunk(cx, cy - 1).blocks; // -y neighbour.
  const north = world.getChunk(cx, cy + 1).blocks; // +y neighbour.
  for (let z = 0; z < CHUNK_HEIGHT; z++) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      out[padIndex(-1, i, z)] = west[localIndex(CHUNK_SIZE - 1, i, z)]; // West border column.
      out[padIndex(CHUNK_SIZE, i, z)] = east[localIndex(0, i, z)]; // East border column.
      out[padIndex(i, -1, z)] = south[localIndex(i, CHUNK_SIZE - 1, z)]; // South border row.
      out[padIndex(i, CHUNK_SIZE, z)] = north[localIndex(i, 0, z)]; // North border row.
      for (let x = 0; x < CHUNK_SIZE; x++) out[padIndex(x, i, z)] = own[localIndex(x, i, z)]; // Interior row (y = i).
    }
  }
  for (let y = -1; y <= CHUNK_SIZE; y++) for (let x = -1; x <= CHUNK_SIZE; x++) out[padIndex(x, y, -1)] = BlockId.BEDROCK; // Solid below z = 0.
  return out;
}

/** Geometry arrays for one chunk, in chunk-local block units (the renderer offsets the mesh by the chunk origin). */
export interface ChunkMeshData {
  positions: Float32Array; // xyz per vertex.
  uvs: Float32Array; // uv per vertex (atlas space).
  colors: Float32Array; // rgb shade per vertex.
  indices: Uint32Array; // Triangle list.
  faceCount: number; // Quads emitted (for logs and tests).
}

/** One cube face in the original three.js manual (y-up) table: direction, 4 corners with unit-cube positions and tile UVs. */
interface FaceDef {
  dir: [number, number, number]; // Outward normal.
  corners: { pos: [number, number, number]; uv: [number, number] }[]; // Quad corners (two triangles: 0-1-2, 2-1-3).
}

/** The three.js manual VoxelWorld.faces table, verbatim apart from formatting (y-up; uvRow dropped, we pick tiles per kind). */
const THREE_MANUAL_FACES: FaceDef[] = [
  { dir: [-1, 0, 0], corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] }, // left
  { dir: [1, 0, 0], corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] }, // right
  { dir: [0, -1, 0], corners: [{ pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] }, // bottom
  { dir: [0, 1, 0], corners: [{ pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] }, // top
  { dir: [0, 0, -1], corners: [{ pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] }, // back
  { dir: [0, 0, 1], corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] }, // front
];

/** Face kind decides which tile (top/side/bottom) a block shows. */
type FaceKind = 'top' | 'side' | 'bottom';

/** A face rotated into the z-up frame, with its kind and a fixed brightness (Minecraft-style directional shading). */
interface ZUpFace {
  dir: [number, number, number]; // Outward normal, z-up.
  corners: { pos: [number, number, number]; uv: [number, number] }[]; // Rotated corners, same order (winding kept).
  kind: FaceKind; // Tile selector.
  shade: number; // Vertex colour multiplier.
}

/** Rotate y-up -> z-up: (X, Y, Z) -> (X, 1 - Z, Y) for positions and (X, -Z, Y) for directions. */
const FACES: ZUpFace[] = THREE_MANUAL_FACES.map(({ dir, corners }) => {
  const zDir: [number, number, number] = [dir[0], -dir[2], dir[1]]; // Rotated normal.
  const kind: FaceKind = zDir[2] === 1 ? 'top' : zDir[2] === -1 ? 'bottom' : 'side'; // Up, down or horizontal.
  const shade = kind === 'top' ? 1 : kind === 'bottom' ? 0.5 : zDir[0] !== 0 ? 0.8 : 0.65; // Fake sun from above/x.
  return { dir: zDir, kind, shade, corners: corners.map(({ pos, uv }) => ({ pos: [pos[0], 1 - pos[2], pos[1]] as [number, number, number], uv })) };
});

/** Atlas tile index per block id and face kind, precomputed once. */
const TILE_LOOKUP = BLOCKS.map((def) => ({
  top: tileIndex(def.tiles.top as Tile), // Tile for +z faces.
  side: tileIndex(def.tiles.side as Tile), // Tile for horizontal faces.
  bottom: tileIndex(def.tiles.bottom as Tile), // Tile for -z faces.
}));

/** Solidity per block id as a flat lookup (avoids object property reads in the hot loop). */
const SOLID = Uint8Array.from(BLOCKS, (def) => (def.solid ? 1 : 0));
/** Padded-array index offset of each face's neighbour. */
const NEIGHBOUR_OFFSET = FACES.map(({ dir }) => dir[0] + PAD * (dir[1] + PAD * dir[2])); // dx + PAD*(dy + PAD*dz).

/** Build the mesh of chunk (cx, cy). The four neighbour chunks are generated on demand for border culling. */
export function buildChunkMesh(world: ChunkSource, cx: number, cy: number): ChunkMeshData {
  const positions: number[] = []; // Growable buffers, converted to typed arrays at the end.
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const cells = paddedBlocks(world, cx, cy); // Chunk + 1-block border.
  let faceCount = 0; // Quads emitted.
  for (let z = 0; z < CHUNK_HEIGHT; z++) {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const p = padIndex(x, y, z); // Padded index of this cell.
        const id = cells[p]; // This cell's block.
        if (SOLID[id] === 0) continue; // Air has no faces.
        for (let f = 0; f < FACES.length; f++) {
          if (SOLID[cells[p + NEIGHBOUR_OFFSET[f]]] === 1) continue; // Hidden face: skip.
          const face = FACES[f]; // Face definition.
          const first = positions.length / 3; // Index of this quad's first vertex.
          const tile = TILE_LOOKUP[id][face.kind]; // Texture tile.
          for (const { pos, uv } of face.corners) {
            positions.push(x + pos[0], y + pos[1], z + pos[2]); // Local corner position.
            uvs.push(...tileUV(tile, uv[0], uv[1])); // Atlas coordinates.
            colors.push(face.shade, face.shade, face.shade); // Grey shade (multiplies the texture).
          }
          indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3); // Same triangle order as the manual.
          faceCount++; // Count it.
        }
      }
    }
  }
  return {
    positions: new Float32Array(positions), // GPU-friendly typed arrays.
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    faceCount,
  };
}
