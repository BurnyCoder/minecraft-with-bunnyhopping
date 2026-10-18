// Block types: numeric ids stored in chunk arrays, plus per-type properties (name, solidity, texture atlas tiles).
// Global context: terrain.ts writes these ids, world.ts answers isSolid() for physics, mesher.ts looks up atlas tiles,
// render/textures.ts paints one 16x16 tile per Tile name, and the HUD hotbar lists the placeable types.

/** Block ids (Uint8 in chunk storage). 0 must stay AIR so freshly zeroed arrays are empty. */
export enum BlockId {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  SAND = 4,
  LOG = 5,
  LEAVES = 6,
  PLANKS = 7,
  COBBLESTONE = 8,
  BRICKS = 9,
  BEDROCK = 10,
}

/** Texture atlas tiles, in atlas order (index = position in the atlas grid, row-major). */
export const TILES = [
  'grass_top', // 0
  'grass_side', // 1
  'dirt', // 2
  'stone', // 3
  'sand', // 4
  'log_top', // 5
  'log_side', // 6
  'leaves', // 7
  'planks', // 8
  'cobblestone', // 9
  'bricks', // 10
  'bedrock', // 11
] as const;
/** Name of one atlas tile. */
export type Tile = (typeof TILES)[number];

/** Static properties of a block type. */
export interface BlockDef {
  name: string; // Display name (HUD hotbar).
  solid: boolean; // Collides with the player and hides neighbouring faces.
  breakable: boolean; // Can be removed with the left mouse button.
  tiles: { top: Tile; side: Tile; bottom: Tile }; // Atlas tile per face kind.
}

/** Shortcut for blocks that use one tile on every face. */
const same = (tile: Tile) => ({ top: tile, side: tile, bottom: tile });

/** Block table indexed by BlockId. */
export const BLOCKS: readonly BlockDef[] = [
  { name: 'Air', solid: false, breakable: false, tiles: same('dirt') }, // 0: never rendered.
  { name: 'Grass', solid: true, breakable: true, tiles: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } }, // 1
  { name: 'Dirt', solid: true, breakable: true, tiles: same('dirt') }, // 2
  { name: 'Stone', solid: true, breakable: true, tiles: same('stone') }, // 3
  { name: 'Sand', solid: true, breakable: true, tiles: same('sand') }, // 4
  { name: 'Log', solid: true, breakable: true, tiles: { top: 'log_top', side: 'log_side', bottom: 'log_top' } }, // 5
  { name: 'Leaves', solid: true, breakable: true, tiles: same('leaves') }, // 6: opaque ("fast graphics" style).
  { name: 'Planks', solid: true, breakable: true, tiles: same('planks') }, // 7
  { name: 'Cobblestone', solid: true, breakable: true, tiles: same('cobblestone') }, // 8
  { name: 'Bricks', solid: true, breakable: true, tiles: same('bricks') }, // 9
  { name: 'Bedrock', solid: true, breakable: false, tiles: same('bedrock') }, // 10: unbreakable world floor.
];

/** Blocks offered in the hotbar, keys 1-9 in this order. */
export const HOTBAR: readonly BlockId[] = [
  BlockId.GRASS,
  BlockId.DIRT,
  BlockId.STONE,
  BlockId.SAND,
  BlockId.LOG,
  BlockId.LEAVES,
  BlockId.PLANKS,
  BlockId.COBBLESTONE,
  BlockId.BRICKS,
];

/** Atlas index of a tile name. */
export function tileIndex(tile: Tile): number {
  return TILES.indexOf(tile); // Small list: linear search is fine (mesher caches per block anyway).
}
