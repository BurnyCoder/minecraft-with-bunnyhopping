// The voxel world: an unbounded, lazily generated map of chunks with global block get/set and an edit overlay.
// Global context: implements physics' VoxelQuery (isSolid) for collision, and serves mesher.ts, raycast.ts and block
// interaction. Any chunk touched for the first time is generated synchronously (one chunk is ~16k bytes and takes about
// a millisecond), so a fast bunnyhopper can never fall into an unloaded hole. Player edits are kept in a separate map
// so unloaded chunks regenerate with them and can be saved (game/persistence.ts). Edits are indexed per chunk, so
// generating a chunk only touches that chunk's edits (a flat list made generation O(total edits) per chunk).
import type { VoxelQuery } from '../physics/collision'; // Interface used by the movement code.
import { BLOCKS, BlockId } from './blocks'; // Block table.
import { CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, chunkCoord, chunkKey, localCoord, localIndex, type Chunk } from './chunk'; // Layout.

/** Anything that can fill a zeroed chunk array (TerrainGenerator, or a stub in tests). */
export interface ChunkGenerator {
  generateChunk(cx: number, cy: number, out: Uint8Array): void;
}

/** Callback fired when a chunk's contents (and so its mesh) changed. */
export type ChunkListener = (cx: number, cy: number) => void;

/** Lazily generated chunk world. */
export class World implements VoxelQuery {
  private readonly chunks = new Map<string, Chunk>(); // Loaded chunks.
  private readonly edits = new Map<string, Map<number, BlockId>>(); // chunkKey -> (local index -> id), re-applied on (re)generation.
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

  /** Re-apply the stored edits of `chunk` (only this chunk's map is visited). */
  private applyEdits(chunk: Chunk): void {
    const own = this.edits.get(chunkKey(chunk.cx, chunk.cy)); // This chunk's edits, if any.
    if (own) for (const [index, id] of own) chunk.blocks[index] = id; // Local index -> block id.
  }

  /** Remember an edit in the per-chunk index. */
  private recordEdit(bx: number, by: number, bz: number, id: BlockId): void {
    const key = chunkKey(chunkCoord(bx), chunkCoord(by)); // Owning chunk.
    let own = this.edits.get(key); // Its edit map.
    if (own === undefined) this.edits.set(key, (own = new Map())); // First edit in this chunk.
    own.set(localIndex(localCoord(bx), localCoord(by), bz), id); // Latest edit wins.
  }

  /** True if chunk (cx, cy) is currently in memory. */
  hasChunk(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy)); // Map lookup.
  }

  /** Coordinates of every chunk currently in memory (Map iteration tolerates unloadChunk() during the loop). */
  *loadedChunks(): IterableIterator<[number, number]> {
    for (const chunk of this.chunks.values()) yield [chunk.cx, chunk.cy]; // Live view of the map.
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
    this.recordEdit(bx, by, bz, id); // Remember for regeneration / saving.
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

  /** All edits as global [x, y, z, id] tuples (for persistence). */
  exportEdits(): [number, number, number, BlockId][] {
    const out: [number, number, number, BlockId][] = []; // Flat list.
    for (const [key, own] of this.edits) {
      const [cx, cy] = key.split(',').map(Number); // Chunk coordinates.
      for (const [index, id] of own) {
        const x = index % CHUNK_SIZE; // Invert localIndex: x fastest...
        const y = Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE; // ...then y...
        const z = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE)); // ...then z.
        out.push([cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y, z, id]); // Global coordinates.
      }
    }
    return out;
  }

  /** Load edits (before chunks are generated, e.g. at startup). */
  importEdits(edits: readonly [number, number, number, BlockId][]): void {
    for (const [bx, by, bz, id] of edits) this.recordEdit(bx, by, bz, id); // Applied when each chunk generates.
  }
}
