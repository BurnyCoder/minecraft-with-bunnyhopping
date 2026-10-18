// Air-strafe "bot": produces the UserCmd a perfect (TAS-like) strafer would send each tick, or a human-like strafer that
// turns the mouse at a constant rate.
// Global context: the same bot drives (1) the closed-form physics tests, (2) the experiments in experiments/, and
// (3) the in-game ?autoplay=N verification mode. Every consumer measures the real movement code, and no bot logic is
// duplicated between them.
// Theory: with L = sv_airspeedcap (30), M = wishspeed (250), A = sv_airaccelerate, tau = tick length,
// k = tau*M*A, the speed-maximising angle theta between velocity and wish direction is
//   cos(theta) = (L - k) / |v|   if L - k > 0  (else theta = 90 degrees),
// which gives |v'|^2 = |v|^2 + k(2L - k), or |v|^2 + L^2 when k >= L.
// Source: J. W. Chong, "Half-Life Physics Reference: Strafing", eqs. 6.5-6.7, https://www.jwchong.com/hl/strafing.html
import { SIDE_SPEED, FORWARD_SPEED } from './constants'; // Keyboard move magnitudes.
import type { Cvars } from './cvars'; // Tunables (air accel, maxspeed, tick).
import { IN_JUMP, horizontalSpeed, type PlayerState, type UserCmd } from './player'; // Command + state types.

const RAD2DEG = 180 / Math.PI; // Radians -> degrees.

/** Wish speed of a full side strafe (CheckParameters clamps the 400 u/s keyboard move to maxspeed). */
function strafeWishSpeed(cvars: Cvars): number {
  return Math.min(SIDE_SPEED, cvars.sv_maxspeed); // 250 u/s with the knife.
}

/**
 * Effective projected-speed limit L = min(sv_airspeedcap, wishspeed): AirAccelerate caps wishspd at the air speed cap,
 * which can only lower it (jwchong's L for air movement). With the default cap 30 < 250 this is 30.
 */
export function effectiveAirCap(cvars: Cvars): number {
  return Math.min(cvars.sv_airspeedcap, strafeWishSpeed(cvars)); // u/s.
}

/** Max speed one air tick can add: k = k_e * tau * wishspeed * airaccelerate (jwchong's k_e tau M A; k_e = m_surfaceFriction). */
function accelPerTick(cvars: Cvars, surfaceFriction: number): number {
  return surfaceFriction * cvars.tick_interval * strafeWishSpeed(cvars) * cvars.sv_airaccelerate; // u/s.
}

/**
 * Closed-form gain in squared horizontal speed per optimally strafed air tick (jwchong eq. 6.6):
 * g = L^2 if k >= L, else k(2L - k), with k from accelPerTick (k_e = Source m_surfaceFriction: 1, or 0.25 after a tick
 * spent rising slowly) and L = effectiveAirCap.
 */
export function optimalGainPerTick(cvars: Cvars, surfaceFriction = 1): number {
  const L = effectiveAirCap(cvars); // 30 u/s normally.
  const k = accelPerTick(cvars, surfaceFriction); // Max speed added this tick.
  return k >= L ? L * L : k * (2 * L - k); // (u/s)^2 per tick.
}

/** When the bot presses jump: always (auto-bhop servers), only on ground ticks (perfect timing), or never. */
export type JumpMode = 'hold' | 'onGround' | 'none';

/** Bot behaviour settings. */
export interface StrafeBotOptions {
  mode: 'optimal' | 'fixedTurn'; // Optimal angle each tick, or constant mouse turn rate.
  direction: 1 | -1; // +1 strafe right (D, turning right), -1 strafe left (A, turning left).
  jumpMode: JumpMode; // Jump timing policy.
  turnRateDegPerSec?: number; // fixedTurn only: yaw change per second (degrees).
}

/** Stateful bot (fixedTurn mode remembers its yaw between ticks). */
export class StrafeBot {
  private yaw: number; // Current view yaw in degrees.

  constructor(private readonly options: StrafeBotOptions, initialYaw = 0) {
    this.yaw = initialYaw; // Starting view direction.
  }

  /** Build this tick's command from the current state (call once per tick, before playerMove). */
  nextCmd(state: PlayerState, cvars: Cvars): UserCmd {
    const speed = horizontalSpeed(state); // Current ground-plane speed.
    const jump = this.options.jumpMode === 'hold' || (this.options.jumpMode === 'onGround' && state.onGround); // Jump policy.
    if (state.onGround && speed < 0.9 * cvars.sv_maxspeed) {
      return { forwardmove: FORWARD_SPEED, sidemove: 0, buttons: 0, viewYaw: this.yaw, viewPitch: 0 }; // Run up to speed first.
    }
    if (this.options.mode === 'fixedTurn') this.yaw -= this.options.direction * (this.options.turnRateDegPerSec ?? 0) * cvars.tick_interval; // Turn like a mouse.
    else this.yaw = this.optimalYaw(state, cvars, speed); // Exact best angle.
    return {
      forwardmove: 0, // Pure side strafe (classic A/D strafing).
      sidemove: this.options.direction * SIDE_SPEED, // +400 right / -400 left.
      buttons: jump ? IN_JUMP : 0, // Jump bit.
      viewYaw: this.yaw, // Where the "mouse" points.
      viewPitch: 0, // Pitch does not affect movement.
    };
  }

  /** View yaw that puts the sidemove wish direction at the optimal angle theta from the velocity. */
  private optimalYaw(state: PlayerState, cvars: Cvars, speed: number): number {
    if (speed < 1e-9) return this.yaw; // No velocity direction yet: keep looking ahead.
    const k = accelPerTick(cvars, state.surfaceFriction); // Max speed this tick's AirAccelerate can add.
    const L = effectiveAirCap(cvars); // Projected-speed limit (30 u/s normally).
    const cosTheta = L - k > 0 ? Math.min(1, (L - k) / speed) : 0; // jwchong eq. 6.5 (cases 1 and 2).
    const theta = Math.acos(cosTheta) * RAD2DEG; // Angle between velocity and wishdir, degrees.
    const velAngle = Math.atan2(state.velocity.y, state.velocity.x) * RAD2DEG; // Velocity heading.
    // Right strafe: wishdir = right(yaw) has heading yaw - 90, and we want heading velAngle - theta => yaw = velAngle - theta + 90.
    // Left strafe: wishdir = -right(yaw) has heading yaw + 90, and we want velAngle + theta => yaw = velAngle + theta - 90.
    return this.options.direction === 1 ? velAngle - theta + 90 : velAngle + theta - 90; // Degrees.
  }
}
