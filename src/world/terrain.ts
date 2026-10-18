// Procedural terrain: seeded 2D simplex-noise fBm heightmap, Minecraft-like block layers, a flat spawn plaza and trees.
// Global context: world.ts calls generateChunk() lazily whenever a chunk is first touched (by rendering, physics or
// raycasts). Generation is a pure function of (seed, cx, cy), so unloaded chunks regenerate identically, and player
// edits are re-applied on top by world.ts.
// Libraries: simplex-noise createNoise2D with a seeded PRNG (https://github.com/jwagner/simplex-noise.js#usage — "alea"
// is the PRNG its README recommends), and alea (https://github.com/coverslide/node-alea).
// fBm (fractional Brownian motion) = sum of octaves with doubling frequency and halving amplitude
// (e.g. https://thebookofshaders.com/13/).
import alea from 'alea'; // Seedable PRNG returning floats in [0, 1).
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise'; // 2D simplex noise in [-1, 1].
import { BlockId } from './blocks'; // Block ids.
import { CHUNK_HEIGHT, CHUNK_SIZE, localIndex } from './chunk'; // Chunk layout.

/** Radius (blocks) of the perfectly flat spawn plaza: uneven block edges stop bunnyhops, so spawn gets a flat arena. */
export const PLAZA_RADIUS = 24;
/** Width (blocks) of the smooth blend from the plaza back to natural terrain. */
const PLAZA_BLEND = 24;
/** Mean terrain surface height (blocks above bedrock). */
const BASE_HEIGHT = 20;
/** Height variation amplitude (blocks); kept gentle so the world stays runnable. */
const AMPLITUDE = 9;
/** Horizontal feature size: frequency of the first octave (1 / blocks). */
const FREQUENCY = 1 / 110;
/** Number of fBm octaves. */
const OCTAVES = 4;
/** Columns at or below this height get sand instead of grass (beach-like lowlands). */
const SAND_LEVEL = 14;
/** Probability that an eligible column grows a tree. */
const TREE_CHANCE = 0.012;

/** Hermite smoothstep from 0 (x <= e0) to 1 (x >= e1). */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); // Normalise and clamp.
  return t * t * (3 - 2 * t); // Cubic ease.
}

/** Deterministic terrain generator for one world seed. */
export class TerrainGenerator {
  private readonly noise: NoiseFunction2D; // Seeded simplex noise.

  constructor(private readonly seed: number) {
    this.noise = createNoise2D(alea(seed)); // Same seed -> same permutation table -> same terrain.
  }

  /** Surface height (z of the top terrain block) at block column (bx, by). */
  heightAt(bx: number, by: number): number {
    let sum = 0; // fBm accumulator.
    let amp = 1; // Octave amplitude.
    let freq = FREQUENCY; // Octave frequency.
    let norm = 0; // Sum of amplitudes, to normalise into [-1, 1].
    for (let o = 0; o < OCTAVES; o++) {
      sum += amp * this.noise(bx * freq, by * freq); // Add octave.
      norm += amp; // Track total weight.
      amp *= 0.5; // Persistence 0.5.
      freq *= 2; // Lacunarity 2.
    }
    const natural = BASE_HEIGHT + AMPLITUDE * (sum / norm); // Natural terrain height.
    const dist = Math.hypot(bx, by); // Distance from the spawn column.
    const blend = smoothstep(PLAZA_RADIUS, PLAZA_RADIUS + PLAZA_BLEND, dist); // 0 inside the plaza, 1 far away.
    return Math.round(BASE_HEIGHT + (natural - BASE_HEIGHT) * blend); // Plaza = exactly BASE_HEIGHT.
  }

  /** Fill `out` (zeroed, CHUNK_VOLUME long) with the blocks of chunk (cx, cy). */
  generateChunk(cx: number, cy: number, out: Uint8Array): void {
    const heights = new Int32Array(CHUNK_SIZE * CHUNK_SIZE); // Surface height per local column.
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = this.heightAt(cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y); // World column height.
        heights[x + CHUNK_SIZE * y] = h; // Remember for trees.
        out[localIndex(x, y, 0)] = BlockId.BEDROCK; // Unbreakable floor at z = 0.
        for (let z = 1; z <= h; z++) {
          const depth = h - z; // Blocks below the surface.
          out[localIndex(x, y, z)] = depth === 0 ? (h <= SAND_LEVEL ? BlockId.SAND : BlockId.GRASS) : depth <= 3 ? (h <= SAND_LEVEL ? BlockId.SAND : BlockId.DIRT) : BlockId.STONE; // Layers.
        }
      }
    }
    this.plantTrees(cx, cy, out, heights); // Decorate.
  }

  /** Place small oak-like trees fully inside the chunk (no cross-chunk writes), never on the plaza or on sand. */
  private plantTrees(cx: number, cy: number, out: Uint8Array, heights: Int32Array): void {
    const random = alea(`${this.seed}:${cx}:${cy}`); // Per-chunk deterministic stream.
    for (let y = 2; y < CHUNK_SIZE - 2; y++) {
      for (let x = 2; x < CHUNK_SIZE - 2; x++) {
        if (random() >= TREE_CHANCE) continue; // Most columns stay empty.
        const h = heights[x + CHUNK_SIZE * y]; // Ground height.
        if (out[localIndex(x, y, h)] !== BlockId.GRASS) continue; // Trees only on grass.
        if (Math.hypot(cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y) < PLAZA_RADIUS + PLAZA_BLEND) continue; // Keep the arena clear.
        const trunk = 4 + Math.floor(random() * 2); // 4-5 logs.
        if (h + trunk + 2 >= CHUNK_HEIGHT) continue; // Must fit under the world ceiling.
        for (let z = h + 1; z <= h + trunk; z++) out[localIndex(x, y, z)] = BlockId.LOG; // Trunk.
        for (let dz = trunk - 1; dz <= trunk + 1; dz++) {
          const r = dz === trunk + 1 ? 1 : 2; // Canopy radius: 2 below, 1 at the top.
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) === r && Math.abs(dy) === r && r === 2) continue; // Round off canopy corners.
              const i = localIndex(x + dx, y + dy, h + dz); // Leaf cell.
              if (out[i] === BlockId.AIR) out[i] = BlockId.LEAVES; // Do not overwrite the trunk.
            }
        }
      }
    }
  }
}
