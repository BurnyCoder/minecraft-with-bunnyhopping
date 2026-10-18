// Tests for ducking in src/physics/movement.ts (Source Duck/FinishDuck/CanUnduck/FinishUnDuck, made instant).
// Global context: CS:S ducking shrinks the hull from 62 to 45 u, slows movement to 34%, and in the air raises the feet by
// 17 u while the head stays put (crouch-jumping reaches higher). Unducking needs free space for the standing hull.
import { Vector3 } from 'three'; // Vector math.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { eyePosition } from '../../src/game/interaction'; // Eye height helper.
import { DIST_EPSILON } from '../../src/physics/constants'; // Surface gap.
import { cvarsFromPreset } from '../../src/physics/cvars'; // Presets.
import { playerMove } from '../../src/physics/movement'; // Unit under test.
import { createPlayerState, emptyCmd, horizontalSpeed, IN_DUCK, IN_JUMP, type UserCmd } from '../../src/physics/player';
import { TestWorld } from '../helpers/worlds'; // Exact geometry.

/** Command helper. */
const cmd = (fields: Partial<UserCmd>): UserCmd => ({ ...emptyCmd(), ...fields }); // Defaults + overrides.

describe('ducking', () => {
  it('walks at 34% of the clamped move speed while ducked (250 * 0.34 = 85 u/s)', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // Any preset.
    const player = createPlayerState(new Vector3(0, 0, DIST_EPSILON)); // On the floor.
    player.onGround = true;
    for (let tick = 0; tick < 400; tick++) playerMove(new TestWorld(), player, cmd({ forwardmove: 400, buttons: IN_DUCK }), cvars); // Duck-walk.
    expect(player.ducked).toBe(true); // Hull switched.
    expect(horizontalSpeed(player)).toBeCloseTo(85, 6); // CheckParameters clamp, then duck crop.
  });

  it('raises the feet by 17 u when ducking in the air, keeping the eye where it was', () => {
    const cvars = cvarsFromPreset('css_bhop'); // Any preset.
    const player = createPlayerState(new Vector3(0, 0, 500)); // Mid-air, far from anything.
    const world = new TestWorld(false); // No floor.
    const eyeBefore = eyePosition(player).z + 0; // Standing eye height.
    const originBefore = player.origin.z; // Feet before.
    playerMove(world, player, cmd({ buttons: IN_DUCK }), cvars); // Duck this tick.
    const fall = player.velocity.z * cvars.tick_interval; // Gravity moved us a little too (vz after the tick).
    expect(player.ducked).toBe(true); // Ducked.
    expect(player.origin.z - originBefore).toBeGreaterThan(16); // Feet lifted by ~17 u (minus one tick of falling).
    expect(Math.abs(eyePosition(player).z - eyeBefore)).toBeLessThan(Math.abs(fall) + 1e-9); // Eye only moved by the fall.
  });

  it('crouch-jumps higher than a standing jump (feet tucked in the air)', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // Vanilla.
    const apex = (duck: boolean): number => {
      const player = createPlayerState(new Vector3(0, 0, DIST_EPSILON)); // On the floor.
      player.onGround = true;
      let top = 0; // Highest feet position.
      for (let tick = 0; tick < 120; tick++) {
        const buttons = (tick === 0 ? IN_JUMP : 0) | (duck && tick > 0 ? IN_DUCK : 0); // Jump, then hold duck.
        playerMove(new TestWorld(), player, cmd({ buttons }), cvars);
        top = Math.max(top, player.origin.z); // Track the feet.
      }
      return top;
    };
    expect(apex(true) - apex(false)).toBeCloseTo(17, 0); // CS:S crouch-jump bonus (62 - 45 = 17 u).
  });

  it('reports a landing when releasing duck in the air puts the feet on the floor', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // Vanilla.
    const player = createPlayerState(new Vector3(0, 0, 18)); // Ducked, 18 u above the floor (unduck lowers the feet 17 u).
    player.ducked = true;
    const events = playerMove(new TestWorld(), player, emptyCmd(), cvars); // Release duck.
    expect(player.onGround).toBe(true); // Feet now within 2 u of the floor.
    expect(events.landed).toBe(true); // Reported as a landing.
  });

  it('stays ducked in the air when the standing hull would not fit, then stands up after landing', () => {
    const cvars = cvarsFromPreset('css_vanilla'); // Vanilla.
    const player = createPlayerState(new Vector3(0, 0, 10)); // Ducked, 10 u above the floor.
    player.ducked = true;
    playerMove(new TestWorld(), player, emptyCmd(), cvars); // Release duck: unducking would put the feet 7 u below the floor.
    expect(player.ducked).toBe(true); // Blocked: CanUnduck failed.
    for (let tick = 0; tick < 30; tick++) playerMove(new TestWorld(), player, emptyCmd(), cvars); // Fall and land.
    expect(player.onGround).toBe(true); // Landed.
    expect(player.ducked).toBe(false); // Stood up on the ground (62 u of free space).
  });
});
