// Swept axis-aligned box collision between the player hull and the voxel world, in Source units (z up).
// Global context: replaces Source's BSP traces (TracePlayerBBox) and TryPlayerMove for a world made only of
// axis-aligned 40 u blocks. Every surface normal is +-x, +-y or +-z, so Source's ClipVelocity(overbounce = 1) reduces to
// zeroing one velocity component, and the multi-plane crease logic of TryPlayerMove reduces to repeating the sweep.
// Algorithm: for each solid cell overlapping the swept box, compute the slab entry/exit times per axis (Minkowski /
// "swept AABB" test, see https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/swept-aabb-collision-detection-and-response-r3084/),
// keep the earliest entry, and stop DIST_EPSILON short of the face as Source's CM_ClipBoxToBrush does.
// Sources: [SDK] src/game/shared/gamemovement.cpp TryPlayerMove (numbumps = 4, ClipVelocity), src/public/coordsize.h DIST_EPSILON.
import { Vector3 } from 'three'; // Vector math.
import { DIST_EPSILON, MAX_BUMPS, UNITS_PER_BLOCK, type Hull } from './constants'; // Geometry constants.
import type { PlayerState } from './player'; // Mutated by tryPlayerMove.

/** What physics needs from the world: is the block at integer block coordinates solid? (z is up.) */
export interface VoxelQuery {
  isSolid(bx: number, by: number, bz: number): boolean;
}

/** Result of a sweep: fraction of `delta` that can be travelled, and which axis the blocking plane faces (-1 = none). */
export interface TraceResult {
  fraction: number; // 0..1.
  axis: -1 | 0 | 1 | 2; // 0 = x plane, 1 = y plane, 2 = z plane.
}

/** Component i (0, 1, 2) of a vector, so the per-axis loops below stay generic. */
function comp(v: Vector3, i: number): number {
  return i === 0 ? v.x : i === 1 ? v.y : v.z; // Vector3 also has getComponent(), this avoids its bounds check.
}

/**
 * Sweep `hull` placed at `origin` along `delta` (u) and return the first blocking hit.
 * Broadphase: every block overlapping the union of the start and end boxes (so fast moves cannot skip a block).
 * Narrowphase: per-cell slab test; a cell blocks only if the boxes overlap on all three axes at the same time.
 */
export function traceHull(world: VoxelQuery, origin: Vector3, hull: Hull, delta: Vector3): TraceResult {
  const lo = [0, 0, 0]; // Start box minimum corner.
  const hi = [0, 0, 0]; // Start box maximum corner.
  const d = [delta.x, delta.y, delta.z]; // Movement per axis.
  const first = [0, 0, 0]; // First block index of the broadphase range per axis.
  const last = [0, 0, 0]; // Last block index of the broadphase range per axis.
  for (let i = 0; i < 3; i++) {
    lo[i] = comp(origin, i) + hull.mins[i]; // World-space box min.
    hi[i] = comp(origin, i) + hull.maxs[i]; // World-space box max.
    const sweepLo = Math.min(lo[i], lo[i] + d[i]); // Swept box covers start and end positions.
    const sweepHi = Math.max(hi[i], hi[i] + d[i]);
    first[i] = Math.floor(sweepLo / UNITS_PER_BLOCK); // Lowest block index touched.
    last[i] = Math.floor(sweepHi / UNITS_PER_BLOCK); // Highest block index touched (a face exactly on a boundary is harmless).
  }

  let best: TraceResult = { fraction: 1, axis: -1 }; // No hit yet.
  for (let bx = first[0]; bx <= last[0]; bx++) {
    for (let by = first[1]; by <= last[1]; by++) {
      for (let bz = first[2]; bz <= last[2]; bz++) {
        if (!world.isSolid(bx, by, bz)) continue; // Air never blocks.
        const hit = sweepAgainstCell([bx, by, bz], lo, hi, d); // Exact time of impact with this block, if any.
        if (hit !== null && hit.fraction < best.fraction) best = hit; // Keep the earliest impact.
      }
    }
  }
  return best;
}

/** Slab test of the moving box [lo, hi] + t*d (t in [0, 1]) against block `cell`. Returns null when it never blocks. */
function sweepAgainstCell(cell: number[], lo: number[], hi: number[], d: number[]): TraceResult | null {
  let entry = -Infinity; // Latest axis entry time = time the boxes start overlapping on all axes.
  let exit = Infinity; // Earliest axis exit time.
  let axis: -1 | 0 | 1 | 2 = -1; // Axis whose slab is entered last (the blocking face).
  let gap = 0; // Distance to that face along its axis at t = 0.
  for (let i = 0; i < 3; i++) {
    const cellLo = cell[i] * UNITS_PER_BLOCK; // Block min along axis i.
    const cellHi = cellLo + UNITS_PER_BLOCK; // Block max along axis i.
    if (d[i] === 0) {
      if (hi[i] <= cellLo || lo[i] >= cellHi) return null; // Separated on a non-moving axis: never touches.
      continue; // Overlapping on this axis for the whole move: no constraint.
    }
    const near = d[i] > 0 ? cellLo - hi[i] : lo[i] - cellHi; // Signed distance to the face we approach (>= 0 if outside).
    const far = d[i] > 0 ? cellHi - lo[i] : hi[i] - cellLo; // Distance until we pass completely through.
    const speed = Math.abs(d[i]); // Travel along this axis for t = 1.
    const tEnter = near / speed; // Time the slabs start overlapping.
    const tExit = far / speed; // Time they stop overlapping.
    if (tEnter > entry) {
      entry = tEnter; // This axis is now the binding one.
      axis = i as 0 | 1 | 2; // Remember the face orientation.
      gap = near; // Distance to that face.
    }
    exit = Math.min(exit, tExit); // Overlap interval shrinks.
  }
  if (axis === -1) return null; // Already overlapping on every axis without moving into it (start-solid): ignore.
  if (entry >= exit || entry > 1 || exit <= 0) return null; // No common overlap time inside this move.
  if (gap < -DIST_EPSILON) return null; // Started embedded along the entry axis: let the player move out.
  const fraction = Math.max(0, (gap - DIST_EPSILON) / Math.abs(d[axis])); // Stop DIST_EPSILON before the face.
  return { fraction: Math.min(fraction, 1), axis }; // Clamp for safety.
}

/**
 * Move the player by velocity * dt, sliding along blocks (Source TryPlayerMove with axis-aligned planes).
 * Each bump: sweep, advance to the impact point, zero the velocity component normal to the hit plane, repeat with the
 * remaining time. At most MAX_BUMPS iterations, like Source.
 */
export function tryPlayerMove(world: VoxelQuery, state: PlayerState, hull: Hull, dt: number): void {
  let timeLeft = dt; // Seconds of motion still to apply.
  const delta = new Vector3(); // Reused scratch vector.
  for (let bump = 0; bump < MAX_BUMPS && timeLeft > 0; bump++) {
    if (state.velocity.lengthSq() === 0) break; // Nothing to move.
    delta.copy(state.velocity).multiplyScalar(timeLeft); // Remaining displacement.
    const trace = traceHull(world, state.origin, hull, delta); // First obstacle on the way.
    state.origin.addScaledVector(delta, trace.fraction); // Advance as far as allowed.
    if (trace.axis === -1) break; // Whole move done.
    state.velocity.setComponent(trace.axis, 0); // ClipVelocity, overbounce 1, axis-aligned normal => drop that component.
    timeLeft -= timeLeft * trace.fraction; // Time not yet used.
  }
}

/** True when `hull` at `origin` intersects any solid block (used for unduck checks and block placement). */
export function hullOverlapsSolid(world: VoxelQuery, origin: Vector3, hull: Hull): boolean {
  const lo = [origin.x + hull.mins[0], origin.y + hull.mins[1], origin.z + hull.mins[2]]; // Box min.
  const hi = [origin.x + hull.maxs[0], origin.y + hull.maxs[1], origin.z + hull.maxs[2]]; // Box max.
  const b0 = lo.map((v) => Math.floor(v / UNITS_PER_BLOCK)); // First block per axis.
  const b1 = hi.map((v) => Math.ceil(v / UNITS_PER_BLOCK) - 1); // Last block per axis (open upper bound).
  for (let bx = b0[0]; bx <= b1[0]; bx++)
    for (let by = b0[1]; by <= b1[1]; by++)
      for (let bz = b0[2]; bz <= b1[2]; bz++) if (world.isSolid(bx, by, bz)) return true; // Any solid cell overlaps.
  return false;
}
