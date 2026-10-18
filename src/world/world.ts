// The voxel world: an unbounded, lazily generated map of chunks with global block get/set and an edit overlay.
// Global context: implements physics' VoxelQuery (isSolid) for collision, and serves mesher.ts, raycast.ts and block
// interaction. Any chunk touched for the first time is generated synchronously (one chunk is ~16k bytes and takes about
// a millisecond), so a fast bunnyhopper can never fall into an unloaded hole. Player edits are kept in a separate map
// so unloaded chunks regenerate with them, and so they can be saved (localStorage, a later step).
import type { VoxelQuery } from '../physics/collision'; // Interface used by the movement code.
import { BLOCKS, BlockId } from './blocks'; // Block table.
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, chunkCoord, chunkKey, localCoord, localIndex, type Chunk } from './chunk'; // Layout.

/** Anything that can fill a zeroed chunk array (TerrainGenerator, or a stub in tests). */
export interface ChunkGenerator {
  generateChunk(cx: number, cy: number, out: Uint8Array): void;
}

/** Callback fired when a chunk's contents (and so its mesh) changed. */
export type ChunkListener = (cx: number, cy: number) => void;

/** Key of a block edit. */
function blockKey(bx: number, by: number, bz: number): string {
  return `${bx},${by},${bz}`; // Unique for integers.
}

/** Lazily generated chunk world. */
export class World implements VoxelQuery {
  private readonly chunks = new Map<string, Chunk>(); // Loaded chunks.
  private readonly edits = new Map<string, BlockId>(); // Player changes, re-applied on (re)generation.
  private readonly listeners: ChunkListener[] = []; // Mesh-invalidation subscribers.

  constructor(private readonly generator: ChunkGenerator) {}

  /** Chunk (cx, cy), generating it (and applying edits) on first access. */
  getChunk(cx: number, cy: number): Chunk {
    const key = chunkKey(cx, cy); // Map key.
    let chunk = this.chunks.get(key); // Already loaded?
    if (chunk === undefined) {
      chunk = { cx, cy, blocks: new Uint8Array(CHUNK_VOLUME) }; // Zeroed = air.
      this.generator.generateChunk(cx, cy, chunk.blocks); // Terrain.
      this.applyEdits(chunk); // Player changes on top.
      this.chunks.set(key, chunk); // Cache.
    }
    return chunk;
  }

  /** Re-apply stored edits that fall inside `chunk`. */
  private applyEdits(chunk: Chunk): void {
    if (this.edits.size === 0) return; // Fast path.
    for (const [key, id] of this.edits) {
      const [bx, by, bz] = key.split(',').map(Number); // Decode key.
      if (chunkCoord(bx) === chunk.cx && chunkCoord(by) === chunk.cy) chunk.blocks[localIndex(localCoord(bx), localCoord(by), bz)] = id; // Inside: apply.
    }
  }

  /** True if chunk (cx, cy) is currently in memory. */
  hasChunk(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy)); // Map lookup.
  }

  /** Forget chunk (cx, cy) (it regenerates identically, edits included, on next access). */
  unloadChunk(cx: number, cy: number): void {
    this.chunks.delete(chunkKey(cx, cy)); // Free memory.
  }

  /** Block id at global coordinates. Below the world is bedrock, above it is air. */
  getBlock(bx: number, by: number, bz: number): BlockId {
    if (bz < 0) return BlockId.BEDROCK; // Solid underworld: nobody falls out.
    if (bz >= CHUNK_HEIGHT) return BlockId.AIR; // Open sky.
    const chunk = this.getChunk(chunkCoord(bx), chunkCoord(by)); // Owning chunk.
    return chunk.blocks[localIndex(localCoord(bx), localCoord(by), bz)]; // Stored id.
  }

  /** VoxelQuery for physics: is the block solid? */
  isSolid(bx: number, by: number, bz: number): boolean {
    return BLOCKS[this.getBlock(bx, by, bz)].solid; // Table lookup.
  }

  /** Set a block; returns false when outside the vertical range. Notifies listeners about affected chunks. */
  setBlock(bx: number, by: number, bz: number, id: BlockId): boolean {
    if (bz < 0 || bz >= CHUNK_HEIGHT) return false; // Out of range.
    const cx = chunkCoord(bx); // Owning chunk x.
    const cy = chunkCoord(by); // Owning chunk y.
    const lx = localCoord(bx); // Local x.
    const ly = localCoord(by); // Local y.
    this.getChunk(cx, cy).blocks[localIndex(lx, ly, bz)] = id; // Write.
    this.edits.set(blockKey(bx, by, bz), id); // Remember for regeneration / saving.
    this.notify(cx, cy); // Own chunk mesh changed.
    if (lx === 0) this.notify(cx - 1, cy); // Faces shared with the -x neighbour.
    if (lx === CHUNK_SIZE - 1) this.notify(cx + 1, cy); // +x neighbour.
    if (ly === 0) this.notify(cx, cy - 1); // -y neighbour.
    if (ly === CHUNK_SIZE - 1) this.notify(cx, cy + 1); // +y neighbour.
    return true;
  }

  /** Subscribe to chunk change notifications (renderer remeshing). */
  onChunkChanged(listener: ChunkListener): void {
    this.listeners.push(listener); // Keep it.
  }

  /** Call every listener for chunk (cx, cy). */
  private notify(cx: number, cy: number): void {
    for (const listener of this.listeners) listener(cx, cy); // Fan out.
  }

  /** Lowest z above the highest solid block in column (bx, by) — where a player can stand. */
  surfaceZ(bx: number, by: number): number {
    for (let z = CHUNK_HEIGHT - 1; z >= 0; z--) if (this.isSolid(bx, by, z)) return z + 1; // Scan down.
    return 0; // Empty column: stand on the bedrock underworld.
  }

  /** All edits as [x, y, z, id] tuples (for persistence). */
  exportEdits(): [number, number, number, BlockId][] {
    return [...this.edits].map(([key, id]) => [...(key.split(',').map(Number) as [number, number, number]), id]); // Decode.
  }

  /** Load edits (before chunks are generated, e.g. at startup). */
  importEdits(edits: readonly [number, number, number, BlockId][]): void {
    for (const [bx, by, bz, id] of edits) this.edits.set(blockKey(bx, by, bz), id); // Store; applied on generation.
  }
}
