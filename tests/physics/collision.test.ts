// Tests for src/physics/collision.ts — swept player-box collision against voxel blocks (Source TryPlayerMove analogue).
// Global context: every movement tick ends in tryPlayerMove; wrong collision would let players clip into blocks,
// tunnel through walls at bhop speeds, or snag on floor seams and lose speed.
// Geometry: 1 block = 40 u; TestWorld's floor surface is z = 0; the standing hull spans x/y +-16 and z 0..62.
import { Vector3 } from 'three'; // Vector math.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { hullOverlapsSolid, traceHull, tryPlayerMove } from '../../src/physics/collision'; // Units under test.
import { DIST_EPSILON, STAND_HULL } from '../../src/physics/constants'; // Hull + surface gap.
import { cvarsFromPreset } from '../../src/physics/cvars'; // Presets (ledge test).
import { playerMove } from '../../src/physics/movement'; // Full tick (ledge test).
import { createPlayerState, emptyCmd } from '../../src/physics/player'; // Player factory + neutral command.
import { TestWorld } from '../helpers/worlds'; // Exact test geometry.

describe('traceHull', () => {
  it('reports no hit in empty space', () => {
    const trace = traceHull(new TestWorld(false), new Vector3(0, 0, 100), STAND_HULL, new Vector3(500, -300, 200)); // Free path.
    expect(trace.fraction).toBe(1); // Full move allowed.
    expect(trace.axis).toBe(-1); // No plane hit.
  });

  it('stops DIST_EPSILON short of a wall face', () => {
    const world = new TestWorld().add(2, 0, 0).add(2, 0, 1); // Wall occupying x in [80, 120] at the player's height.
    const trace = traceHull(world, new Vector3(0, 20, DIST_EPSILON), STAND_HULL, new Vector3(100, 0, 0)); // Hull front at x=16.
    expect(trace.axis).toBe(0); // Hit an x-facing plane.
    expect(trace.fraction).toBeCloseTo((80 - 16 - DIST_EPSILON) / 100, 12); // Gap of 64 u minus epsilon.
  });
});

describe('tryPlayerMove', () => {
  it('stops at a wall without penetrating and zeroes the blocked velocity component', () => {
    const world = new TestWorld().add(2, 0, 0).add(2, 0, 1); // Wall at x = 80.
    const player = createPlayerState(new Vector3(0, 20, DIST_EPSILON)); // Standing just above the floor.
    player.velocity.set(1000, 0, 0); // Running at the wall.
    tryPlayerMove(world, player, STAND_HULL, 0.1); // Would travel 100 u without the wall.
    expect(player.origin.x).toBeCloseTo(80 - 16 - DIST_EPSILON, 9); // Flush against the wall (minus the gap).
    expect(player.velocity.x).toBe(0); // ClipVelocity on an x plane removes vx entirely.
    expect(hullOverlapsSolid(world, player.origin, STAND_HULL)).toBe(false); // Never inside a block.
  });

  it('slides along a wall keeping the tangential velocity', () => {
    const world = new TestWorld(); // Floor only...
    for (let by = -10; by <= 10; by++) world.add(2, by, 0).add(2, by, 1); // ...plus a long wall at x = 80.
    const player = createPlayerState(new Vector3(60, 0, DIST_EPSILON)); // Close to the wall.
    player.velocity.set(1000, 500, 0); // Diagonal into the wall.
    tryPlayerMove(world, player, STAND_HULL, 0.1); // 100 u in x (blocked), 50 u in y (free).
    expect(player.origin.y).toBeCloseTo(50, 9); // Full tangential travel.
    expect(player.velocity.y).toBe(500); // Tangential speed untouched.
  });

  it('lands on a floor at z = DIST_EPSILON and zeroes vz', () => {
    const player = createPlayerState(new Vector3(0, 0, 30)); // 30 u above the floor.
    player.velocity.set(0, 0, -1000); // Falling fast.
    tryPlayerMove(new TestWorld(), player, STAND_HULL, 0.1); // Would fall 100 u.
    expect(player.origin.z).toBeCloseTo(DIST_EPSILON, 9); // Resting on the floor surface.
    expect(player.velocity.z).toBe(0); // Vertical speed removed.
  });

  it('does not tunnel through a one-block wall at sv_maxvelocity', () => {
    const world = new TestWorld().add(3, 0, 0).add(3, 0, 1); // Thin wall at x in [120, 160].
    const player = createPlayerState(new Vector3(0, 20, DIST_EPSILON)); // Start before the wall.
    player.velocity.set(3500, 0, 0); // Maximum velocity.
    tryPlayerMove(world, player, STAND_HULL, 0.1); // 350 u per tick: far more than the 40 u wall thickness.
    expect(player.origin.x).toBeCloseTo(120 - 16 - DIST_EPSILON, 9); // Stopped at the near face.
  });

  it('bonks the head on a ceiling', () => {
    const world = new TestWorld().add(0, 0, 2); // Block at z in [80, 120] above the player.
    const player = createPlayerState(new Vector3(0, 0, DIST_EPSILON)); // Standing; head at z = 62.
    player.velocity.set(0, 0, 500); // Moving up.
    tryPlayerMove(world, player, STAND_HULL, 0.1); // Would rise 50 u.
    expect(player.origin.z).toBeCloseTo(80 - 62 - DIST_EPSILON, 9); // Head just under the ceiling.
    expect(player.velocity.z).toBe(0); // Upward speed removed.
  });

  it('stops at an outside corner when moving diagonally into it, without entering the block', () => {
    const world = new TestWorld().add(2, 2, 0).add(2, 2, 1); // Single pillar spanning x, y in [80, 120].
    const player = createPlayerState(new Vector3(40, 40, DIST_EPSILON)); // Hull x, y in [24, 56], diagonal to the pillar.
    player.velocity.set(1000, 1000, 0); // Straight at the corner.
    tryPlayerMove(world, player, STAND_HULL, 0.1); // Would move 100 u on each axis.
    expect(hullOverlapsSolid(world, player.origin, STAND_HULL)).toBe(false); // Never inside the pillar.
    expect(player.velocity.x === 0 || player.velocity.y === 0).toBe(true); // One axis was clipped by a face.
  });

  it('collides correctly at negative coordinates', () => {
    const world = new TestWorld().add(-3, -1, 0).add(-3, -1, 1); // Wall block spanning x in [-120, -80].
    const player = createPlayerState(new Vector3(-20, -20, DIST_EPSILON)); // Hull x in [-36, -4].
    player.velocity.set(-1000, 0, 0); // Moving towards -x.
    tryPlayerMove(world, player, STAND_HULL, 0.1); // Would travel 100 u.
    expect(player.origin.x).toBeCloseTo(-80 + 16 + DIST_EPSILON, 9); // Hull min stops 1/32 u past the face at x = -80.
    expect(player.velocity.x).toBe(0); // Blocked component removed.
  });

  it('walks off a ledge taller than the step size and falls instead of snapping down', () => {
    const world = new TestWorld(); // Floor at z = 0...
    for (let bx = -2; bx <= 0; bx++) world.add(bx, 0, 0); // ...plus a 1-block (40 u) platform ending at x = 40.
    const cvars = cvarsFromPreset('css_vanilla'); // Any preset.
    const player = createPlayerState(new Vector3(20, 20, 40 + DIST_EPSILON)); // Standing on the platform.
    player.onGround = true;
    let left = false; // Has the player left the ground?
    for (let tick = 0; tick < 40; tick++) {
      playerMove(world, player, { ...emptyCmd(), forwardmove: 400 }, cvars); // Walk towards +x.
      if (!player.onGround) left = true;
    }
    expect(left).toBe(true); // Became airborne at the edge (40 u > 18 u StayOnGround reach).
    expect(player.origin.z).toBeCloseTo(DIST_EPSILON, 6); // Landed on the floor below.
  });

  it('runs across a floor made of many blocks without snagging on seams', () => {
    const player = createPlayerState(new Vector3(0, 0, DIST_EPSILON)); // On the floor.
    player.velocity.set(700, 0, 0); // Fast horizontal run.
    for (let tick = 0; tick < 100; tick++) tryPlayerMove(new TestWorld(), player, STAND_HULL, 0.01); // 1 s of movement.
    expect(player.origin.x).toBeCloseTo(700, 6); // Full 700 u covered.
    expect(player.velocity.x).toBe(700); // No speed lost on block boundaries.
  });
});
