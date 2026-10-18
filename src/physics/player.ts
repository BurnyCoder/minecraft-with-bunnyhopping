// Player simulation state and the per-tick input command ("usercmd"), modelled on Source's CMoveData / CUserCmd.
// Global context: the game loop (game/loop.ts) builds one UserCmd per tick from keyboard/mouse input (or the strafe
// bot builds it), movement.ts's playerMove() consumes it and mutates PlayerState. Coordinates: Source frame,
// x/y horizontal, z up, Hammer units; origin is the bottom centre of the player box.
import { Vector3 } from 'three'; // three.js vector math (pure JS, works in Node): https://threejs.org/docs/#api/en/math/Vector3

/** Button bits, same values as Source src/game/shared/in_buttons.h (IN_JUMP = 1 << 1, IN_DUCK = 1 << 2). */
export const IN_JUMP = 1 << 1;
export const IN_DUCK = 1 << 2;

/** One tick of player intent: movement axes, held buttons and view angles (degrees, Source convention). */
export interface UserCmd {
  forwardmove: number; // +forward / -back, in u/s (keyboard gives +-400, cl_forwardspeed).
  sidemove: number; // +right / -left, in u/s (keyboard gives +-400, cl_sidespeed).
  buttons: number; // Bitmask of IN_* flags held this tick.
  viewYaw: number; // Degrees, 0 = +x, 90 = +y (counter-clockwise seen from above).
  viewPitch: number; // Degrees, positive looks down (Source convention), limited to +-89.
}

/** Simulation state carried between ticks. */
export interface PlayerState {
  origin: Vector3; // Bottom-centre position of the hull, u.
  velocity: Vector3; // u/s.
  onGround: boolean; // Source "ground entity != NULL".
  ducked: boolean; // Fully ducked (uses DUCK_HULL); always false until the duck step is implemented.
  oldButtons: number; // Buttons of the previous tick (Source m_nOldButtons), used for "don't pogo stick".
  surfaceFriction: number; // Source m_surfaceFriction: 1 normally, 0.25 after a tick spent rising slowly in the air.
}

/** Fresh player at `origin`, at rest and airborne (categorizePosition decides grounding on the first tick). */
export function createPlayerState(origin: Vector3): PlayerState {
  return { origin: origin.clone(), velocity: new Vector3(), onGround: false, ducked: false, oldButtons: 0, surfaceFriction: 1 }; // Own copies.
}

/** A neutral command: no movement, no buttons, looking along +x. */
export function emptyCmd(): UserCmd {
  return { forwardmove: 0, sidemove: 0, buttons: 0, viewYaw: 0, viewPitch: 0 }; // All zeros.
}

/** Horizontal (x/y) speed in u/s — what bhop speedometers display. */
export function horizontalSpeed(state: PlayerState): number {
  return Math.hypot(state.velocity.x, state.velocity.y); // Ignores vertical velocity.
}
