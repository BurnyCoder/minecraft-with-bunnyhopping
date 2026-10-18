// Tests for src/game/interaction.ts — Minecraft-style block breaking/placing from the player's eye.
// Global context: the view ray starts at the CS:S eye (origin + 64 u) and is cast in block units; placing must never
// put a block inside the player's hull (that would trap them), and bedrock must stay unbreakable.
import { Vector3 } from 'three'; // Vector math.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { BlockInteraction, blockIntersectsHull } from '../../src/game/interaction'; // Unit under test.
import { DIST_EPSILON, STAND_HULL, UNITS_PER_BLOCK } from '../../src/physics/constants'; // Units and hull.
import { createPlayerState } from '../../src/physics/player'; // Player factory.
import { BlockId } from '../../src/world/blocks'; // Block ids.
import { World, type ChunkGenerator } from '../../src/world/world'; // Block store.

const floorOnly: ChunkGenerator = {
  generateChunk: (_cx, _cy, out) => out.fill(BlockId.STONE, 0, 16 * 16 * 10), // Solid stone z = 0..9, surface z = 10.
};

/** Player standing on the floor at the centre of block column (0, 0). */
function player() {
  const p = createPlayerState(new Vector3(UNITS_PER_BLOCK / 2, UNITS_PER_BLOCK / 2, 10 * UNITS_PER_BLOCK + DIST_EPSILON)); // On top of z = 9.
  p.onGround = true; // Standing.
  return p;
}

describe('blockIntersectsHull', () => {
  it('detects a block overlapping the player box but not one merely touching it', () => {
    const origin = new Vector3(20, 20, 400 + DIST_EPSILON); // Hull x/y in [4, 36], z in [400, 462].
    expect(blockIntersectsHull([0, 0, 10], origin, STAND_HULL)).toBe(true); // Block the feet stand in.
    expect(blockIntersectsHull([0, 0, 11], origin, STAND_HULL)).toBe(true); // Block at head height.
    expect(blockIntersectsHull([1, 0, 10], origin, STAND_HULL)).toBe(false); // Neighbour column: x >= 40 > 36.
    expect(blockIntersectsHull([0, 0, 9], origin, STAND_HULL)).toBe(false); // Floor block below the feet.
  });
});

describe('BlockInteraction', () => {
  it('breaks the targeted block and places on the face that was hit', () => {
    const world = new World(floorOnly); // Flat stone floor.
    const interaction = new BlockInteraction(world); // Unit under test.
    const p = player(); // Standing at (0, 0).
    expect(interaction.breakBlock(p, 0, 60)?.block).toEqual([1, 0, 9]); // Looking 60 deg down along +x hits the floor ahead.
    expect(world.getBlock(1, 0, 9)).toBe(BlockId.AIR); // Removed.
    interaction.selectSlot(8); // Bricks.
    const placed = interaction.placeBlock(p, 0, 60); // Same view now hits the block below the hole.
    expect(placed).not.toBeNull(); // Something was placed...
    expect(world.getBlock(...placed!)).toBe(BlockId.BRICKS); // ...with the selected block type.
  });

  it('refuses to place a block inside the player and to break bedrock', () => {
    const world = new World(floorOnly); // Flat floor.
    const interaction = new BlockInteraction(world); // Unit under test.
    const p = player(); // Standing at (0, 0).
    expect(interaction.placeBlock(p, 0, 89)).toBeNull(); // Straight down: the new block would be where the feet are.
    world.setBlock(2, 0, 10, BlockId.BEDROCK); // Bedrock pillar ahead at eye level...
    world.setBlock(2, 0, 11, BlockId.BEDROCK);
    expect(interaction.breakBlock(p, 0, 0)).toBeNull(); // ...cannot be broken.
    expect(world.getBlock(2, 0, 11)).toBe(BlockId.BEDROCK); // Still there.
  });
});
