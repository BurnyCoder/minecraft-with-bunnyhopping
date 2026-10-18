// Texture atlas layout shared by the mesher (UV coordinates) and the renderer (which paints the atlas canvas).
// Global context: all block textures live in one image so every chunk is a single draw call. Tiles are 16 x 16 pixels
// in an 8 x 2 grid. UVs are inset by half a texel to stop neighbouring tiles bleeding in at tile edges (a classic
// atlas artefact, see e.g. https://gamedev.stackexchange.com/questions/46963/how-to-avoid-texture-bleeding-in-a-texture-atlas).
// The v axis follows three.js texture conventions (flipY: v = 1 is the top row of the image), as in the three.js manual
// VoxelWorld UV formula: v = 1 - (row + 1 - uv.y) * tileSize / height (https://threejs.org/manual/#en/voxel-geometry).

/** Pixels per tile side. */
export const TILE_PIXELS = 16;
/** Tiles per atlas row. */
export const ATLAS_COLS = 8;
/** Tile rows in the atlas. */
export const ATLAS_ROWS = 2;
/** Atlas size in pixels. */
export const ATLAS_WIDTH = TILE_PIXELS * ATLAS_COLS;
export const ATLAS_HEIGHT = TILE_PIXELS * ATLAS_ROWS;

/** Half a texel, in pixels: the UV inset applied on every tile edge. */
const INSET = 0.5;

/** Atlas UV for corner (cu, cv) in {0, 1}^2 of tile `tile` (row-major index). Returns [u, v]. */
export function tileUV(tile: number, cu: number, cv: number): [number, number] {
  const col = tile % ATLAS_COLS; // Tile column.
  const row = Math.floor(tile / ATLAS_COLS); // Tile row (0 = top of the image).
  const px = col * TILE_PIXELS + INSET + cu * (TILE_PIXELS - 2 * INSET); // Pixel x inside the inset tile.
  const py = row * TILE_PIXELS + INSET + (1 - cv) * (TILE_PIXELS - 2 * INSET); // Pixel y from the image top (cv = 1 -> tile top).
  return [px / ATLAS_WIDTH, 1 - py / ATLAS_HEIGHT]; // Normalise; flip y into three.js v.
}

/** Top-left pixel of a tile in the atlas image (used when painting). */
export function tileOrigin(tile: number): [number, number] {
  return [(tile % ATLAS_COLS) * TILE_PIXELS, Math.floor(tile / ATLAS_COLS) * TILE_PIXELS]; // Column/row to pixels.
}
