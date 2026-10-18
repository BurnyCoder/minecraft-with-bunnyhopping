// Phase "createWorld": the seeded World, the block texture atlas, the chunk streamer and the block highlight.
// Global context: called from src/main.ts after the renderer exists. Pre-builds the chunks around spawn before the first
// frame so the player never spawns into an empty void, and logs how long that took.
import type { Scene } from 'three'; // three.js scene type.
import type { GameConfig } from '../config'; // Seed + render distance.
import type { Logger } from '../logging/logger'; // Logging.
import { ChunkRenderer } from '../render/chunkRenderer'; // Chunk streaming.
import { BlockHighlight } from '../render/highlight'; // Selection box.
import { createBlockAtlas } from '../render/textures'; // Procedural textures.
import { TerrainGenerator } from '../world/terrain'; // Terrain generator.
import { World } from '../world/world'; // Block store.
import { attachPersistence, browserStore } from './persistence'; // Saved block edits.

/** Objects created by this phase. */
export interface WorldSetup {
  world: World; // Blocks.
  atlasCanvas: HTMLCanvasElement; // Atlas image (HUD icons).
  chunks: ChunkRenderer; // Mesh streaming.
  highlight: BlockHighlight; // Target outline.
}

/** Create the world and render its spawn area. */
export function createWorld(config: GameConfig, scene: Scene, log: Logger): WorldSetup {
  const world = new World(new TerrainGenerator(config.seed)); // Seeded, lazily generated.
  attachPersistence(world, browserStore(), config.seed, log); // Load saved edits before any chunk is generated.
  const atlas = createBlockAtlas(); // Paint textures.
  const chunks = new ChunkRenderer(scene, world, atlas.texture, config.renderDistance, log); // Streamer.
  const t0 = performance.now(); // Timing.
  chunks.update(0, 0, 10_000); // Build every chunk in view of spawn now (generous budget, once).
  log.info('spawn area meshed', { ms: Math.round(performance.now() - t0), ...chunks.stats() }); // Startup cost.
  return { world, atlasCanvas: atlas.canvas, chunks, highlight: new BlockHighlight(scene) };
}
