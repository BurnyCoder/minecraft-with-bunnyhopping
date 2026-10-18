// Counter-Strike: Source player movement, one fixed tick at a time: a TypeScript reimplementation of the algorithms in
// Valve's public Source SDK 2013 CGameMovement (src/game/shared/gamemovement.cpp), using CS:S values and rules.
// Global context: game/loop.ts calls playerMove() once per tick with the player's UserCmd; tests, experiments and the
// autoplay bot call the very same function, so measured physics is exactly the physics you play.
// Why bunnyhopping works here (as in Source): fullWalkMove runs checkJumpButton BEFORE friction. A jump on the first
// tick on the ground clears the ground flag, so friction() is skipped and the tick uses airMove instead of walkMove.
// In the air, airAccelerate caps the added speed by the 30 u/s projection limit along the wish direction, but not the
// total speed. Turning the wish direction (strafing) therefore keeps adding speed.
// Line references below ([SDK Lnnnn]) point into src/game/shared/gamemovement.cpp of the 2025 SDK tree.
// Deliberate deviations (see docs/movement-physics.md): no StepMove (blocks are 40 u > 18 u step), no water/ladders,
// no base velocity, surface friction fixed at 1, float64 arithmetic.
import { Vector3 } from 'three'; // Vector math.
import { hullOverlapsSolid, traceHull, tryPlayerMove, type VoxelQuery } from './collision'; // World interaction.
import {
  BUNNYJUMP_MAX_SPEED_FACTOR,
  DUCK_HULL,
  GROUND_CHECK_DISTANCE,
  JUMP_IMPULSE,
  NON_JUMP_VELOCITY,
  STAND_HULL,
  STEP_SIZE,
  type Hull,
} from './constants'; // Fixed CS:S constants.
import type { Cvars } from './cvars'; // Tunables.
import { IN_JUMP, type PlayerState, type UserCmd } from './player'; // State + input.

const DEG2RAD = Math.PI / 180; // Degrees -> radians.

/** What happened during a tick (for HUD, logs and experiments). */
export interface TickEvents {
  jumped: boolean; // A jump was performed this tick.
  landed: boolean; // The player became grounded this tick.
}

/** Wish direction (unit, horizontal) and wish speed (u/s) derived from the command. */
interface Wish {
  dir: Vector3; // Unit vector or zero.
  speed: number; // Clamped to maxspeed.
}

/** Collision hull currently in use (ducked or standing). */
export function hullFor(state: PlayerState): Hull {
  return state.ducked ? DUCK_HULL : STAND_HULL; // Duck support arrives in a later step; ducked stays false until then.
}

/**
 * Horizontal forward/right basis for a yaw angle. Source AngleVectors gives forward = (cos y, sin y) and
 * right = (sin y, -cos y) with roll 0; WalkMove/AirMove zero their z and renormalise, which removes pitch [SDK L1767-1770].
 */
export function moveBasis(yawDeg: number): { forward: Vector3; right: Vector3 } {
  const yaw = yawDeg * DEG2RAD; // Radians.
  return {
    forward: new Vector3(Math.cos(yaw), Math.sin(yaw), 0), // Looking direction projected on the ground.
    right: new Vector3(Math.sin(yaw), -Math.cos(yaw), 0), // 90 degrees clockwise from forward (seen from above).
  };
}

/** CheckParameters: scale (forwardmove, sidemove) down so their length is at most maxspeed [SDK L981-1030]. */
export function checkParameters(cmd: UserCmd, cvars: Cvars): { fmove: number; smove: number } {
  let fmove = cmd.forwardmove; // Requested forward speed (keyboard: +-400).
  let smove = cmd.sidemove; // Requested side speed (keyboard: +-400).
  const spd2 = fmove * fmove + smove * smove; // Squared magnitude (upmove is always 0 here).
  const max = cvars.sv_maxspeed; // Player max speed (250).
  if (spd2 !== 0 && spd2 > max * max) {
    const ratio = max / Math.sqrt(spd2); // Uniform scale factor.
    fmove *= ratio; // E.g. W alone: 400 -> 250.
    smove *= ratio;
  }
  return { fmove, smove };
}

/** wishvel = forward * fmove + right * smove (z = 0); wishspeed clamped to maxspeed [SDK WalkMove L1940-1955, AirMove L1772-1786]. */
function wishFrom(fmove: number, smove: number, yawDeg: number, maxspeed: number): Wish {
  const { forward, right } = moveBasis(yawDeg); // Horizontal basis.
  const wishvel = forward.multiplyScalar(fmove).addScaledVector(right, smove); // Desired velocity.
  const length = wishvel.length(); // VectorNormalize returns the original length.
  const dir = length > 0 ? wishvel.divideScalar(length) : wishvel.set(0, 0, 0); // Unit direction (or zero).
  return { dir, speed: Math.min(length, maxspeed) }; // Clamp to server max speed.
}

/** Accelerate (ground): add speed along wishdir, but never beyond wishspeed in that direction [SDK L1820-1852]. */
export function accelerate(velocity: Vector3, wishdir: Vector3, wishspeed: number, accel: number, dt: number): void {
  const currentspeed = velocity.dot(wishdir); // Speed already going the wished way.
  const addspeed = wishspeed - currentspeed; // Room left until wishspeed.
  if (addspeed <= 0) return; // Already at/above wishspeed in that direction.
  const accelspeed = Math.min(accel * dt * wishspeed, addspeed); // accel * frametime * wishspeed * surfaceFriction(=1), capped.
  velocity.addScaledVector(wishdir, accelspeed); // Apply.
}

/**
 * AirAccelerate: like accelerate, but the "room left" uses wishspd capped at the air speed cap (30) while the
 * acceleration amount still uses the full wishspeed [SDK L1705-1746]. This asymmetry is what makes air strafing work.
 */
export function airAccelerate(velocity: Vector3, wishdir: Vector3, wishspeed: number, accel: number, dt: number, airCap: number): void {
  const wishspd = Math.min(wishspeed, airCap); // Cap speed (GetAirSpeedCap() = 30).
  const currentspeed = velocity.dot(wishdir); // "Veer" amount: projection of velocity on wishdir.
  const addspeed = wishspd - currentspeed; // Room left under the 30 u/s projected cap.
  if (addspeed <= 0) return; // Nothing to add.
  const accelspeed = Math.min(accel * wishspeed * dt, addspeed); // Uses the uncapped wishspeed, then capped by addspeed.
  velocity.addScaledVector(wishdir, accelspeed); // Apply.
}

/** Friction: bleed speed proportionally, but at least as if moving at sv_stopspeed [SDK L1610-1677]. Ground only. */
export function friction(state: PlayerState, cvars: Cvars, dt: number): void {
  const speed = state.velocity.length(); // Full 3D speed, as Source (vz is 0 on the ground anyway).
  if (speed < 0.1) return; // Too slow to matter.
  if (!state.onGround) return; // Air friction is zero in this codebase.
  const control = speed < cvars.sv_stopspeed ? cvars.sv_stopspeed : speed; // Bleed threshold.
  const drop = control * cvars.sv_friction * dt; // Speed removed this tick (surfaceFriction = 1).
  const newspeed = Math.max(speed - drop, 0); // Never reverse direction.
  if (newspeed !== speed) state.velocity.multiplyScalar(newspeed / speed); // Scale velocity.
}

/** CheckVelocity: clear NaN components and clamp each axis to +-sv_maxvelocity [SDK CheckVelocity L3060-3085]. */
export function checkVelocity(velocity: Vector3, maxvelocity: number): void {
  for (let i = 0; i < 3; i++) {
    let v = velocity.getComponent(i); // Axis value.
    if (Number.isNaN(v)) v = 0; // Source: "Got a NaN velocity" -> 0.
    velocity.setComponent(i, Math.max(-maxvelocity, Math.min(maxvelocity, v))); // Per-axis clamp.
  }
}

/** StartGravity: half of this tick's gravity before moving ("yes, this 0.5 looks wrong, but it's not") [SDK L1246-1265]. */
function startGravity(state: PlayerState, cvars: Cvars, dt: number): void {
  state.velocity.z -= cvars.sv_gravity * 0.5 * dt; // ent_gravity = 1.
  checkVelocity(state.velocity, cvars.sv_maxvelocity); // Source calls CheckVelocity here too.
}

/** FinishGravity: the other half after moving [SDK L1682-1698]. */
function finishGravity(state: PlayerState, cvars: Cvars, dt: number): void {
  state.velocity.z -= cvars.sv_gravity * dt * 0.5; // Second half step.
  checkVelocity(state.velocity, cvars.sv_maxvelocity); // Keep clamped.
}

/** PreventBunnyJumping: scale velocity so its length is at most 1.1 * maxspeed (TF2 tf_gamemovement.cpp L1092-1112 pattern). */
function preventBunnyJumping(state: PlayerState, maxspeed: number): void {
  const maxscaledspeed = BUNNYJUMP_MAX_SPEED_FACTOR * maxspeed; // 275 u/s for the knife.
  const spd = state.velocity.length(); // Current 3D speed.
  if (spd <= maxscaledspeed) return; // Under the limit.
  state.velocity.multiplyScalar(maxscaledspeed / spd); // Crop proportionally.
}

/**
 * CheckJumpButton: jump if grounded and the button was not already held last tick (anti-pogo), unless auto-bhop is on
 * [SDK L2352-2524; auto-bhop as in Momentum Mod CheckJumpButton "else if (!HasAutoBhop()) return false"].
 */
function checkJumpButton(state: PlayerState, cvars: Cvars, dt: number): boolean {
  if (!state.onGround) {
    state.oldButtons |= IN_JUMP; // "No more effect": in the air, mark jump as held [SDK L2393-2397].
    return false;
  }
  if (state.oldButtons & IN_JUMP && !cvars.sv_autobunnyhopping) return false; // "don't pogo stick" [SDK L2405-2406].
  if (!cvars.sv_enablebunnyhopping) preventBunnyJumping(state, cvars.sv_maxspeed); // CS:S 2010 speed clamp.
  state.onGround = false; // SetGroundEntity(NULL): in the air now [SDK L2418].
  if (state.ducked) state.velocity.z = JUMP_IMPULSE; // Ducked jump sets vz [SDK L2450-2459].
  else state.velocity.z += JUMP_IMPULSE; // Standing jump adds to vz [SDK L2460-2463].
  finishGravity(state, cvars, dt); // Jump tick applies the second half-gravity here [SDK L2495].
  state.oldButtons |= IN_JUMP; // "don't jump again until released" [SDK L2521].
  return true;
}

/**
 * CategorizePosition: grounded if a block lies within 2 u below the hull and we are not rising faster than 140 u/s.
 * Landing zeroes vz, as SetGroundEntity does [SDK L3794-3870, L3611-3650]. All voxel floors are flat (normal z = 1 >= 0.7).
 */
function categorizePosition(world: VoxelQuery, state: PlayerState): boolean {
  const wasOnGround = state.onGround; // To report landings.
  if (state.velocity.z > NON_JUMP_VELOCITY) {
    state.onGround = false; // "Shooting up really fast. Definitely not on ground."
    return false;
  }
  const trace = traceHull(world, state.origin, hullFor(state), new Vector3(0, 0, -GROUND_CHECK_DISTANCE)); // Probe down 2 u.
  state.onGround = trace.axis === 2; // Hit a floor (only z planes can block a pure -z sweep).
  if (state.onGround) state.velocity.z = 0; // SetGroundEntity: mv->m_vecVelocity.z = 0.
  return state.onGround && !wasOnGround; // Landed this tick.
}

/** StayOnGround: snap down onto a floor within STEP_SIZE after walking [SDK L1857-1888] (voxels need no up-trace). */
function stayOnGround(world: VoxelQuery, state: PlayerState): void {
  const down = new Vector3(0, 0, -STEP_SIZE); // Probe up to 18 u below.
  const trace = traceHull(world, state.origin, hullFor(state), down); // Sweep down.
  if (trace.axis === 2 && trace.fraction > 0 && trace.fraction < 1) state.origin.z += down.z * trace.fraction; // Snap.
}

/** WalkMove: ground acceleration then slide-move (Source tries a direct move first; tryPlayerMove covers both) [SDK L1893-2018]. */
function walkMove(world: VoxelQuery, state: PlayerState, wish: Wish, cvars: Cvars, dt: number): void {
  state.velocity.z = 0; // "Set pmove velocity" [SDK L1958].
  accelerate(state.velocity, wish.dir, wish.speed, cvars.sv_accelerate, dt); // Ground accel.
  state.velocity.z = 0; // Accelerate cannot add vertical speed on the ground [SDK L1960].
  if (state.velocity.length() < 1) {
    state.velocity.set(0, 0, 0); // "spd < 1.0f": stop completely [SDK L1967-1973].
    return;
  }
  tryPlayerMove(world, state, hullFor(state), dt); // Move and slide along walls (StepMove skipped: blocks > step).
  stayOnGround(world, state); // Keep feet on the floor [SDK L2017].
}

/** AirMove: air acceleration (with the 30 u/s projected cap) then slide-move [SDK L1751-1797]. */
function airMove(world: VoxelQuery, state: PlayerState, wish: Wish, cvars: Cvars, dt: number): void {
  airAccelerate(state.velocity, wish.dir, wish.speed, cvars.sv_airaccelerate, dt, cvars.sv_airspeedcap); // Strafe gain.
  tryPlayerMove(world, state, hullFor(state), dt); // Move and collide.
}

/**
 * One full movement tick: CheckParameters, FullWalkMove (land/air branch), FinishMove.
 * Order inside FullWalkMove follows [SDK L2023-2129] for the not-in-water case.
 */
export function playerMove(world: VoxelQuery, state: PlayerState, cmd: UserCmd, cvars: Cvars): TickEvents {
  const dt = cvars.tick_interval; // Fixed tick length.
  const { fmove, smove } = checkParameters(cmd, cvars); // Clamp the move vector to maxspeed.
  const events: TickEvents = { jumped: false, landed: false }; // Filled below.
  startGravity(state, cvars, dt); // First half of gravity.
  if (cmd.buttons & IN_JUMP) events.jumped = checkJumpButton(state, cvars, dt); // Jump before friction: the bhop window.
  else state.oldButtons &= ~IN_JUMP; // Released: next press can jump [SDK L2088].
  if (state.onGround) {
    state.velocity.z = 0; // No vertical speed on the ground.
    friction(state, cvars, dt); // Only ground ticks lose speed.
  }
  checkVelocity(state.velocity, cvars.sv_maxvelocity); // Validate.
  const wish = wishFrom(fmove, smove, cmd.viewYaw, cvars.sv_maxspeed); // Desired direction/speed.
  if (state.onGround) walkMove(world, state, wish, cvars, dt); // Ground branch.
  else airMove(world, state, wish, cvars, dt); // Air branch (includes the jump tick).
  events.landed = categorizePosition(world, state); // Update grounded flag.
  checkVelocity(state.velocity, cvars.sv_maxvelocity); // Validate again.
  finishGravity(state, cvars, dt); // Second half of gravity.
  if (state.onGround) state.velocity.z = 0; // "If we are on ground, no downward velocity."
  state.oldButtons = cmd.buttons; // FinishMove: m_nOldButtons = m_nButtons [SDK L1199].
  return events;
}

/** True if the player box at its current origin is inside a block (used by spawn/teleport sanity checks). */
export function isStuck(world: VoxelQuery, state: PlayerState): boolean {
  return hullOverlapsSolid(world, state.origin, hullFor(state)); // Any overlap means stuck.
}
