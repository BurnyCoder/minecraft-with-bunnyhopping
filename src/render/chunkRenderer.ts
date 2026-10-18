// Chunk streaming and mesh management: keeps a three.js Mesh for every chunk within the render distance of the player,
// builds missing meshes nearest-first under a per-frame time budget, rebuilds edited chunks, and frees far chunks.
// Global context: called once per frame from game/loop.ts. The world generates chunk data lazily, so this module only
// decides WHICH chunks get geometry; mesher.ts builds the arrays and this module uploads them as BufferGeometry
// (https://threejs.org/docs/#api/en/core/BufferGeometry). The time budget keeps frame rate stable while bhopping
// into new terrain at high speed.
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, type Scene, type Texture } from 'three'; // three.js.
import type { Logger } from '../logging/logger'; // Logging.
import { CHUNK_SIZE, chunkKey } from '../world/chunk'; // Chunk size + keys.
import { buildChunkMesh } from '../world/mesher'; // Geometry arrays.
import type { World } from '../world/world'; // Block store.

/** Rolling statistics for the 1 Hz log line. */
export interface ChunkStats {
  meshes: number; // Chunks with geometry.
  loadedChunks: number; // Chunks with block data in memory.
  built: number; // Meshes built since the last stats() call.
  avgBuildMs: number; // Mean build time over those builds.
}

/** Streams chunk meshes around the player. */
export class ChunkRenderer {
  private readonly meshes = new Map<string, Mesh | null>(); // null = chunk meshed but empty (all air).
  private readonly dirty = new Set<string>(); // Meshed chunks that need a rebuild.
  private readonly material: MeshBasicMaterial; // Shared by all chunks: atlas * vertex shade, with fog.
  private built = 0; // Builds since last stats().
  private buildMs = 0; // Time spent in those builds.

  constructor(
    private readonly scene: Scene,
    private readonly world: World,
    atlas: Texture,
    private readonly renderDistance: number, // Radius in chunks.
    private readonly log: Logger,
  ) {
    this.material = new MeshBasicMaterial({ map: atlas, vertexColors: true }); // Unlit: shading is baked per face.
    world.onChunkChanged((cx, cy) => {
      const key = chunkKey(cx, cy); // Changed chunk.
      if (this.meshes.has(key)) this.dirty.add(key); // Only rebuild chunks that have geometry.
    });
  }

  /** Build/rebuild/free chunks around block column (bx, by), spending at most `budgetMs` on mesh builds. */
  update(bx: number, by: number, budgetMs: number): void {
    const start = performance.now(); // Budget clock.
    const pcx = Math.floor(bx / CHUNK_SIZE); // Player chunk x.
    const pcy = Math.floor(by / CHUNK_SIZE); // Player chunk y.
    for (const key of this.dirty) {
      const [cx, cy] = key.split(',').map(Number); // Decode.
      this.build(cx, cy); // Edits first: the player is looking at them.
      this.dirty.delete(key); // Done.
      if (performance.now() - start > budgetMs) return; // Out of time.
    }
    const r = this.renderDistance; // Radius.
    const missing: [number, number, number][] = []; // [distance^2, cx, cy].
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r && !this.meshes.has(chunkKey(pcx + dx, pcy + dy))) missing.push([dx * dx + dy * dy, pcx + dx, pcy + dy]); // Circle.
    missing.sort((a, b) => a[0] - b[0]); // Nearest first.
    for (const [, cx, cy] of missing) {
      this.build(cx, cy); // At least one per frame (checked after building).
      if (performance.now() - start > budgetMs) break; // Budget spent.
    }
    this.evict(pcx, pcy); // Free far chunks.
  }

  /** (Re)build the mesh of chunk (cx, cy). */
  private build(cx: number, cy: number): void {
    const t0 = performance.now(); // Timing.
    const key = chunkKey(cx, cy); // Map key.
    this.dispose(key); // Remove an old mesh, if any.
    const data = buildChunkMesh(this.world, cx, cy); // CPU geometry.
    let mesh: Mesh | null = null; // Empty chunks get no Mesh.
    if (data.faceCount > 0) {
      const geometry = new BufferGeometry(); // GPU geometry.
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3)); // xyz.
      geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2)); // Atlas uv.
      geometry.setAttribute('color', new BufferAttribute(data.colors, 3)); // Face shade.
      geometry.setIndex(new BufferAttribute(data.indices, 1)); // Triangles.
      geometry.computeBoundingSphere(); // For frustum culling.
      mesh = new Mesh(geometry, this.material); // Drawable.
      mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, 0); // Chunk origin in blocks.
      mesh.matrixAutoUpdate = false; // Static: compute the matrix once.
      mesh.updateMatrix();
      this.scene.add(mesh); // Show.
    }
    this.meshes.set(key, mesh); // Remember (even when empty).
    this.built++; // Stats.
    this.buildMs += performance.now() - t0;
  }

  /** Remove chunk meshes outside radius + 1 and world data outside radius + 3 (hysteresis avoids thrashing). */
  private evict(pcx: number, pcy: number): void {
    const keep = (this.renderDistance + 1) ** 2; // Mesh keep radius^2.
    for (const key of this.meshes.keys()) {
      const [cx, cy] = key.split(',').map(Number); // Decode.
      if ((cx - pcx) ** 2 + (cy - pcy) ** 2 > keep) {
        this.dispose(key); // Free GPU memory.
        this.meshes.delete(key); // Forget.
        this.dirty.delete(key);
      }
    }
    const keepData = (this.renderDistance + 3) ** 2; // Data keep radius^2.
    for (const [cx, cy] of this.world.loadedChunks()) if ((cx - pcx) ** 2 + (cy - pcy) ** 2 > keepData) this.world.unloadChunk(cx, cy); // Edits survive in the world.
  }

  /** Detach and free the mesh stored under `key`. */
  private dispose(key: string): void {
    const mesh = this.meshes.get(key); // Current mesh.
    if (!mesh) return; // None or empty.
    this.scene.remove(mesh); // Stop drawing.
    mesh.geometry.dispose(); // Free GPU buffers (material is shared, keep it).
  }

  /** Statistics since the previous call (resets the build counters). */
  stats(): ChunkStats {
    const result: ChunkStats = {
      meshes: [...this.meshes.values()].filter((m) => m !== null).length, // Non-empty meshes.
      loadedChunks: [...this.world.loadedChunks()].length, // Data in memory.
      built: this.built, // Builds in the interval.
      avgBuildMs: this.built > 0 ? Number((this.buildMs / this.built).toFixed(2)) : 0, // Mean build time.
    };
    this.built = 0; // Reset interval counters.
    this.buildMs = 0;
    if (result.avgBuildMs > 8) this.log.warn('slow chunk meshing', result); // Flag regressions.
    return result;
  }
}
