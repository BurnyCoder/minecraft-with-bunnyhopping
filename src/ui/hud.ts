// DOM heads-up display over the WebGL canvas: crosshair, bhop speedometer, hotbar, debug line and the start overlay.
// Global context: phase "createHud" of src/main.ts. game/loop.ts pushes numbers into it every frame (throttled here
// to ~20 Hz of DOM writes); input events toggle the overlay and the selected hotbar slot. The speedometer shows
// horizontal speed in Hammer units per second, like the speed HUD of CS:S bhop servers.
import { BLOCKS, HOTBAR } from '../world/blocks'; // Hotbar block names.
import { tileOrigin, ATLAS_HEIGHT, ATLAS_WIDTH, TILE_PIXELS } from '../world/atlas'; // Icon cropping from the atlas.
import { tileIndex, type Tile } from '../world/blocks'; // Tile lookup.

/** Values shown each frame. */
export interface HudFrame {
  speed: number; // Horizontal speed, u/s.
  fps: number; // Frames per second.
  info: string; // Debug line (position, preset, ...).
}

/** Inline stylesheet (kept here so the HUD is one self-contained module). */
const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;color:#fff;text-shadow:0 1px 2px #000;font:14px ui-monospace,Consolas,monospace}
#hud .crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%)}
#hud .crosshair:before,#hud .crosshair:after{content:"";position:absolute;background:#fff;mix-blend-mode:difference}
#hud .crosshair:before{left:8px;top:0;width:2px;height:18px}#hud .crosshair:after{left:0;top:8px;width:18px;height:2px}
#hud .speed{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);font-size:28px;font-weight:700}
#hud .speed small{font-size:14px;font-weight:400;opacity:.8}
#hud .info{position:absolute;left:8px;top:8px;white-space:pre;opacity:.9}
#hud .hotbar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:4px;padding:4px;background:#0006;border-radius:4px}
#hud .slot{width:40px;height:40px;border:2px solid #0008;image-rendering:pixelated;background-repeat:no-repeat;position:relative}
#hud .slot.active{border-color:#fff}
#hud .slot span{position:absolute;left:2px;top:0;font-size:11px}
#hud .name{position:absolute;left:50%;bottom:72px;transform:translateX(-50%);opacity:.9}
#hud .overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0009;gap:6px;text-align:center}
#hud .overlay h1{margin:0 0 8px;font-size:40px}
#hud .overlay.hidden{display:none}
`;

/** Help text on the start overlay. */
const HELP = [
  'Click to play',
  'WASD move · Space hold-jump · Mouse wheel = jump (CS:S style) · Ctrl/C duck',
  'Strafe-jump: hold A (or D) and turn the mouse the same way while in the air',
  'LMB break · RMB place · 1-9 select block · R respawn · F fullscreen · ` console · Esc release mouse',
];

/** The HUD: build once, then call frame() each animation frame. */
export class Hud {
  private readonly root: HTMLDivElement; // #hud container.
  private readonly speedEl: HTMLDivElement; // Speedometer.
  private readonly infoEl: HTMLDivElement; // Debug text.
  private readonly nameEl: HTMLDivElement; // Selected block name.
  private readonly overlay: HTMLDivElement; // Click-to-play overlay.
  private readonly slots: HTMLDivElement[] = []; // Hotbar slots.
  private lastWrite = 0; // Time of the last DOM text update (ms).

  constructor(container: HTMLElement, atlas: HTMLCanvasElement, title: string) {
    const style = document.createElement('style'); // Inline CSS.
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div'); // Root element.
    this.root.id = 'hud';
    this.root.innerHTML = `<div class="crosshair"></div><div class="speed"></div><div class="info"></div><div class="name"></div><div class="hotbar"></div><div class="overlay"></div>`; // Static skeleton (no user data).
    container.appendChild(this.root); // On top of the canvas.
    this.speedEl = this.root.querySelector('.speed')!; // Element handles.
    this.infoEl = this.root.querySelector('.info')!;
    this.nameEl = this.root.querySelector('.name')!;
    this.overlay = this.root.querySelector('.overlay')!;
    const heading = document.createElement('h1'); // Title.
    heading.textContent = title;
    this.overlay.appendChild(heading);
    for (const line of HELP) {
      const p = document.createElement('div'); // One help line (textContent: no HTML injection).
      p.textContent = line;
      this.overlay.appendChild(p);
    }
    const icons = atlas.toDataURL(); // Atlas image for slot icons.
    const scale = 40 / TILE_PIXELS; // 16 px tile -> 40 px slot.
    HOTBAR.forEach((id, i) => {
      const slot = document.createElement('div'); // Slot box.
      slot.className = 'slot';
      const [ox, oy] = tileOrigin(tileIndex(BLOCKS[id].tiles.side as Tile)); // Side texture as icon.
      slot.style.backgroundImage = `url(${icons})`; // Whole atlas...
      slot.style.backgroundSize = `${ATLAS_WIDTH * scale}px ${ATLAS_HEIGHT * scale}px`; // ...scaled...
      slot.style.backgroundPosition = `${-ox * scale}px ${-oy * scale}px`; // ...shifted to the tile.
      const label = document.createElement('span'); // Key number.
      label.textContent = String(i + 1);
      slot.appendChild(label);
      this.root.querySelector('.hotbar')!.appendChild(slot);
      this.slots.push(slot);
    });
    this.selectSlot(0); // Initial selection.
  }

  /** Highlight hotbar slot `index` and show the block name. */
  selectSlot(index: number): void {
    this.slots.forEach((slot, i) => slot.classList.toggle('active', i === index)); // One active slot.
    this.nameEl.textContent = BLOCKS[HOTBAR[index]].name; // Selected block name.
  }

  /** Show the overlay when the mouse is not captured (and not in autoplay). */
  setOverlay(visible: boolean): void {
    this.overlay.classList.toggle('hidden', !visible); // CSS toggle.
  }

  /** Update numbers; DOM writes are throttled to 20 Hz to keep layout work negligible. */
  frame(values: HudFrame, nowMs: number): void {
    if (nowMs - this.lastWrite < 50) return; // Throttle.
    this.lastWrite = nowMs;
    this.speedEl.innerHTML = `${Math.round(values.speed)} <small>u/s</small>`; // Numbers only: safe markup.
    this.infoEl.textContent = `${Math.round(values.fps)} fps\n${values.info}`; // Plain text.
  }
}
