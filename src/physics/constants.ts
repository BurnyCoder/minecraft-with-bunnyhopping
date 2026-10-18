// Fixed physical constants of the Counter-Strike: Source player, in Source "Hammer units" (u, ~1 inch) and seconds.
// Global context: these never change at runtime (unlike the tunable cvars in cvars.ts). The movement code
// (movement.ts), collision (collision.ts), renderer (camera height) and HUD all import them from here.
// Sources:
//   [SDK]  Valve Source SDK 2013, src/game/shared/gamemovement.cpp and .h (github.com/ValveSoftware/source-sdk-2013)
//   [MOM]  Momentum Mod CS:S-style movement, mp/src/game/shared/momentum/{mom_gamemovement.cpp,mom_gamerules.cpp,
//          mom_system_gamemode.cpp} (github.com/momentum-mod/game)
//   [VDC]  Valve Developer Community, "Dimensions (Half-Life 2 and Counter-Strike: Source)" and "Bunnyhop" pages.

/** Size of one voxel block in Hammer units. 40 u makes the CS:S player 0.8 x 0.8 x 1.55 blocks (Minecraft: 0.6 x 1.8). */
export const UNITS_PER_BLOCK = 40;

/** CS:S jump height used to derive the impulse: vz += sqrt(2 * 800 * 57) [MOM GetJumpFactor: sqrtf(57 * 2 * 800)]. */
export const JUMP_HEIGHT = 57;
/** Upward speed added by a jump, ~301.993 u/s. CS:S hardcodes 800 here, so it does not follow sv_gravity [MOM]. */
export const JUMP_IMPULSE = Math.sqrt(2 * 800 * JUMP_HEIGHT);

/** Above this upward speed the player cannot be grounded [SDK CategorizePosition: #define NON_JUMP_VELOCITY 140.0f]. */
export const NON_JUMP_VELOCITY = 140;
/** Ground probe distance below the hull [SDK CategorizePosition: flOffset = 2.0f]. */
export const GROUND_CHECK_DISTANCE = 2;
/** Max step height, used by StayOnGround's downward snap [VDC Dimensions: "Ground Obstacle Height ... 18"]. */
export const STEP_SIZE = 18;
/** Gap kept between the hull and any surface after a collision [SDK src/public/coordsize.h: DIST_EPSILON (0.03125)]. */
export const DIST_EPSILON = 0.03125;
/** Collision iterations per move [SDK TryPlayerMove: int numbumps = 4]. */
export const MAX_BUMPS = 4;
/** Air acceleration only adds speed up to this projected value [SDK gamemovement.h GetAirSpeedCap(): return 30.f]. */
export const AIR_SPEED_CAP = 30;

/** Keyboard move magnitudes: cl_forwardspeed / cl_sidespeed default 400 in Source; clamped to maxspeed later. */
export const FORWARD_SPEED = 400;
export const SIDE_SPEED = 400;
/** CS:S ducking slows the commanded move to 34% [MOM mom_gamemovement.cpp: #define DUCK_SPEED_MULTIPLIER 0.34f]. */
export const DUCK_SPEED_MULTIPLIER = 0.34;
/** With sv_enablebunnyhopping 0, a jump clamps speed to 110% of maxspeed [VDC Bunnyhop page; TF2 PreventBunnyJumping pattern]. */
export const BUNNYJUMP_MAX_SPEED_FACTOR = 1.1;

/** Axis-aligned player box relative to the origin (origin = bottom centre), as [x, y, z] mins/maxs. */
export interface Hull {
  mins: readonly [number, number, number]; // Lower corner offset.
  maxs: readonly [number, number, number]; // Upper corner offset.
}
/** Standing CS:S hull 32 x 32 x 62 [MOM g_ViewVectorsMom; VDC: "CS:S Player collision height (standing) 62"]. */
export const STAND_HULL: Hull = { mins: [-16, -16, 0], maxs: [16, 16, 62] };
/** Ducked CS:S hull 32 x 32 x 45 [MOM g_ViewVectorsMom; VDC: "CS:S Player collision height (crouched) 45"]. */
export const DUCK_HULL: Hull = { mins: [-16, -16, 0], maxs: [16, 16, 45] };
/** Eye height above the origin, standing / ducked [MOM g_ViewVectorsMom: eye (0,0,64), duck view (0,0,47)]. */
export const VIEW_OFFSET_STAND = 64;
export const VIEW_OFFSET_DUCK = 47;

/** Degrees of view rotation per raw mouse count before the sensitivity multiplier (Source m_yaw / m_pitch default 0.022). */
export const M_YAW = 0.022;
export const M_PITCH = 0.022;
/** Pitch limit in degrees (Source cl_pitchup / cl_pitchdown default 89). */
export const PITCH_LIMIT = 89;
