// Player input: keyboard, raw mouse motion (Pointer Lock), mouse wheel and mouse buttons -> per-tick UserCmds.
// Global context: InputState is DOM-free and unit-tested; bindDomInput() connects it to browser events. game/loop.ts
// calls buildCmd() once per physics tick. View angles change on every mouse event (Source applies view angles every
// frame), while buttons and moves are sampled per tick.
// Browser APIs: Pointer Lock with raw input via { unadjustedMovement: true }
// (https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock), MouseEvent.movementX/Y,
// KeyboardEvent.code (layout-independent keys, https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code),
// WheelEvent, and the Keyboard Lock API in fullscreen to capture Ctrl+W and similar
// (https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API#keyboard_locking).
import { FORWARD_SPEED, M_PITCH, M_YAW, PITCH_LIMIT, SIDE_SPEED } from '../physics/constants'; // Source input constants.
import { IN_DUCK, IN_JUMP, type UserCmd } from '../physics/player'; // Command type and button bits.

/** Key codes per action (KeyboardEvent.code values; QWERTY positions on any layout). */
export const BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  duck: ['ControlLeft', 'KeyC'],
} as const;

/** DOM-free input accumulator. */
export class InputState {
  yaw = 0; // Source view yaw, degrees (0 = +x, counter-clockwise).
  pitch = 0; // Source view pitch, degrees (positive looks down).
  private readonly held = new Set<string>(); // Currently pressed key codes.
  private jumpPulse = false; // Wheel notch waiting for the next tick.

  constructor(public sensitivity: number) {} // CS:S "sensitivity" multiplier (public: console can change it).

  /** Record a key press/release. */
  setKey(code: string, down: boolean): void {
    if (down) this.held.add(code); // Remember held key.
    else this.held.delete(code); // Released.
  }

  /** Forget all held keys (e.g. when the window loses focus, so keys do not stick). */
  releaseAll(): void {
    this.held.clear(); // No key is held any more.
  }

  /** True if any key bound to `action` is held. */
  private isDown(action: keyof typeof BINDS): boolean {
    return BINDS[action].some((code) => this.held.has(code)); // Any binding counts.
  }

  /** A mouse-wheel notch: +jump for exactly one tick (CS:S "bind mwheeldown +jump"). */
  wheel(): void {
    this.jumpPulse = true; // Latched until buildCmd consumes it.
  }

  /** Apply raw mouse motion in counts: yaw -= dx * m_yaw * sens, pitch += dy * m_pitch * sens, pitch clamped to +-89. */
  look(dx: number, dy: number): void {
    this.yaw -= dx * M_YAW * this.sensitivity; // Mouse right => turn right => yaw decreases (counter-clockwise positive).
    this.yaw = ((this.yaw % 360) + 360) % 360; // Keep yaw in [0, 360) to avoid float growth.
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dy * M_PITCH * this.sensitivity)); // Mouse down => look down.
  }

  /** Build the command for one physics tick (consumes a pending wheel jump). */
  buildCmd(): UserCmd {
    const jump = this.isDown('jump') || this.jumpPulse; // Held space or a wheel notch.
    this.jumpPulse = false; // A notch lasts one tick only.
    return {
      forwardmove: (this.isDown('forward') ? FORWARD_SPEED : 0) - (this.isDown('back') ? FORWARD_SPEED : 0), // +-400.
      sidemove: (this.isDown('right') ? SIDE_SPEED : 0) - (this.isDown('left') ? SIDE_SPEED : 0), // +-400, right positive.
      buttons: (jump ? IN_JUMP : 0) | (this.isDown('duck') ? IN_DUCK : 0), // Button bits.
      viewYaw: this.yaw, // Current view.
      viewPitch: this.pitch,
    };
  }
}

/** One-shot actions the game reacts to (not part of UserCmd). */
export interface InputHandlers {
  onBreak(): void; // Left mouse button.
  onPlace(): void; // Right mouse button.
  onSelectSlot(slot: number): void; // Digit keys 1-9 -> slot 0-8.
  onRespawn(): void; // R key.
  onLockChange(locked: boolean): void; // Pointer lock gained/lost (HUD shows "click to play").
}

/** Connect browser events on `canvas` to `input` and `handlers`. Returns a function that removes the listeners. */
export function bindDomInput(canvas: HTMLCanvasElement, input: InputState, handlers: InputHandlers): () => void {
  let skipNextMove = false; // Chrome can report one huge delta right after locking; drop it.
  const locked = (): boolean => document.pointerLockElement === canvas; // Are we capturing the mouse?
  const requestLock = async (): Promise<void> => {
    try {
      await canvas.requestPointerLock({ unadjustedMovement: true }); // Raw mouse counts (no OS acceleration), like CS:S m_rawinput 1.
    } catch {
      await canvas.requestPointerLock(); // Browsers without raw input support: normal lock.
    }
  };
  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
    [canvas, 'click', () => {
      if (!locked()) void requestLock(); // First click captures the mouse.
    }],
    [document, 'pointerlockchange', () => {
      skipNextMove = locked(); // Ignore the first delta after locking.
      if (!locked()) input.releaseAll(); // Lost focus: release keys.
      handlers.onLockChange(locked()); // Update HUD.
    }],
    [document, 'mousemove', (e) => {
      if (!locked()) return; // Only steer while captured.
      if (skipNextMove) {
        skipNextMove = false; // Drop the spike.
        return;
      }
      const m = e as MouseEvent; // Typed event.
      input.look(m.movementX, m.movementY); // Raw counts -> angles.
    }],
    [document, 'mousedown', (e) => {
      if (!locked()) return; // Clicks before locking only lock.
      const button = (e as MouseEvent).button; // 0 = left, 2 = right.
      if (button === 0) handlers.onBreak(); // Break block.
      if (button === 2) handlers.onPlace(); // Place block.
    }],
    [document, 'contextmenu', (e) => e.preventDefault()], // No context menu on right click.
    [canvas, 'wheel', (e) => {
      e.preventDefault(); // Never scroll the page.
      if (locked()) input.wheel(); // Wheel = jump pulse.
    }, { passive: false }],
    [document, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // Typing in the console: not game input.
      const k = e as KeyboardEvent; // Typed event.
      if (k.code.startsWith('Digit') && k.code !== 'Digit0') handlers.onSelectSlot(Number(k.code.slice(5)) - 1); // 1-9.
      if (k.code === 'KeyR' && locked()) handlers.onRespawn(); // Respawn at the plaza.
      if (k.code === 'KeyF' && locked()) void toggleFullscreen(); // Fullscreen + keyboard lock.
      if (locked() && (k.code === 'Space' || k.ctrlKey)) k.preventDefault(); // Keep space/ctrl combos inside the game.
      input.setKey(k.code, true); // Track held key.
    }],
    [document, 'keyup', (e) => input.setKey((e as KeyboardEvent).code, false)], // Release.
    [window, 'blur', () => input.releaseAll()], // Alt-tab: no stuck keys.
    [window, 'beforeunload', (e) => {
      if (locked()) e.preventDefault(); // Ask before closing mid-game (e.g. accidental Ctrl+W while ducking).
    }],
  ];
  for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options); // Attach.
  return () => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener); // Detach.
  };
}

/** Enter/leave fullscreen; in fullscreen also lock system keys (Ctrl+W, Esc stays the exit key) where supported. */
async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen(); // Leave fullscreen.
    return;
  }
  await document.documentElement.requestFullscreen(); // Enter fullscreen.
  const keyboard = (navigator as Navigator & { keyboard?: { lock(keys?: string[]): Promise<void> } }).keyboard; // Chromium only.
  await keyboard?.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'Space']).catch(() => undefined); // Capture Ctrl+W etc.
}
