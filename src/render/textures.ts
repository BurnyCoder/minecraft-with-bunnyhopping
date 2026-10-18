// Procedural 16 x 16 pixel-art block textures painted into one atlas canvas, wrapped as a three.js CanvasTexture.
// Global context: every chunk mesh samples this single texture (UVs from world/atlas.ts), and the HUD hotbar reuses the
// canvas for slot icons. Painting procedurally avoids shipping any third-party (e.g. Mojang) art; a fixed PRNG seed
// makes the textures identical on every load.
// three.js texture settings for crisp pixel art: NearestFilter, no mipmaps, sRGB colour space
// (https://threejs.org/docs/#api/en/textures/Texture and https://threejs.org/manual/#en/color-management).
import alea from 'alea'; // Seeded PRNG for repeatable noise.
import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three'; // Texture from a canvas.
import { ATLAS_HEIGHT, ATLAS_WIDTH, TILE_PIXELS, tileOrigin } from '../world/atlas'; // Atlas layout.
import { TILES, type Tile } from '../world/blocks'; // Tile names in atlas order.

/** RGB triple 0-255. */
type RGB = [number, number, number];
/** Pixel painter: local pixel (x, y) with y = 0 at the tile top, plus a seeded random source. */
type Painter = (x: number, y: number, rand: () => number) => RGB;

/** Base colour plus symmetric random brightness noise of +-amount. */
function noisy([r, g, b]: RGB, amount: number, rand: () => number): RGB {
  const n = (rand() * 2 - 1) * amount; // Same offset on all channels keeps the hue.
  return [r + n, g + n, b + n];
}

/** One painter per tile name. */
const PAINTERS: Record<Tile, Painter> = {
  grass_top: (_x, _y, r) => noisy([96, 160, 58], 18, r), // Green with speckles.
  grass_side: (x, y, r) => (y < 3 || (y === 3 && (x * 7) % 3 === 0) ? noisy([96, 160, 58], 14, r) : noisy([134, 96, 67], 16, r)), // Green fringe over dirt.
  dirt: (_x, _y, r) => noisy([134, 96, 67], 18, r), // Brown.
  stone: (_x, _y, r) => (r() < 0.08 ? noisy([95, 95, 95], 8, r) : noisy([128, 128, 128], 12, r)), // Grey with dark flecks.
  sand: (_x, _y, r) => noisy([219, 207, 160], 10, r), // Pale yellow.
  log_top: (x, y, r) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); // Square rings like Minecraft logs.
    return d > 6.5 ? noisy([100, 78, 48], 10, r) : Math.floor(d) % 2 === 0 ? noisy([168, 132, 82], 8, r) : noisy([140, 108, 66], 8, r); // Bark + rings.
  },
  log_side: (x, _y, r) => noisy(x % 4 === 0 ? [82, 64, 40] : [108, 84, 52], 10, r), // Vertical bark stripes.
  leaves: (_x, _y, r) => (r() < 0.2 ? noisy([38, 92, 30], 10, r) : noisy([62, 132, 46], 20, r)), // Dark holes in green.
  planks: (x, y, r) => (y % 4 === 3 || (x === ((y >> 2) % 2 === 0 ? 5 : 12) && y % 4 !== 3) ? noisy([112, 88, 52], 6, r) : noisy([164, 132, 80], 10, r)), // Boards + seams.
  cobblestone: (x, y, r) => {
    const edge = (x + 3 * (y >> 2)) % 5 === 0 || y % 4 === 0; // Irregular mortar grid.
    return edge ? noisy([78, 78, 78], 8, r) : noisy([136, 136, 136], 22, r); // Mortar vs stones.
  },
  bricks: (x, y, r) => {
    const row = y >> 2; // 4-pixel brick courses.
    const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7; // Horizontal + staggered vertical joints.
    return mortar ? noisy([196, 190, 180], 6, r) : noisy([150, 72, 56], 12, r); // Mortar vs brick.
  },
  bedrock: (_x, _y, r) => noisy(r() < 0.5 ? [60, 60, 60] : [105, 105, 105], 20, r), // High-contrast dark noise.
};

/** Paint the atlas canvas and return it with a ready-to-use three.js texture. */
export function createBlockAtlas(): { canvas: HTMLCanvasElement; texture: CanvasTexture } {
  const canvas = document.createElement('canvas'); // Off-screen canvas.
  canvas.width = ATLAS_WIDTH; // 128 px.
  canvas.height = ATLAS_HEIGHT; // 32 px.
  const ctx = canvas.getContext('2d'); // 2D drawing context.
  if (ctx === null) throw new Error('2D canvas context unavailable'); // Should never happen in supported browsers.
  TILES.forEach((tile, index) => {
    const rand = alea(`bhopcraft-texture-${tile}`); // Per-tile deterministic noise.
    const image = ctx.createImageData(TILE_PIXELS, TILE_PIXELS); // 16 x 16 RGBA buffer.
    for (let y = 0; y < TILE_PIXELS; y++) {
      for (let x = 0; x < TILE_PIXELS; x++) {
        const [r, g, b] = PAINTERS[tile](x, y, rand); // Pixel colour.
        const i = 4 * (x + TILE_PIXELS * y); // RGBA offset.
        image.data[i] = r; // Uint8ClampedArray clamps to 0..255 automatically.
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255; // Opaque.
      }
    }
    const [ox, oy] = tileOrigin(index); // Tile position in the atlas.
    ctx.putImageData(image, ox, oy); // Blit.
  });
  const texture = new CanvasTexture(canvas); // GPU texture from the canvas.
  texture.magFilter = NearestFilter; // Crisp texels up close.
  texture.minFilter = NearestFilter; // No blending between atlas tiles at a distance.
  texture.generateMipmaps = false; // Mipmaps would average neighbouring tiles (atlas bleeding).
  texture.colorSpace = SRGBColorSpace; // Canvas pixels are sRGB.
  return { canvas, texture };
}
