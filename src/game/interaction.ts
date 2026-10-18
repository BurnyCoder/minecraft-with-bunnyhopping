// Minecraft-style block interaction: break the block under the crosshair, place the selected hotbar block on the face
// that was hit, choose hotbar slots.
// Global context: input.ts reports mouse clicks/digit keys, this module edits the World (which notifies the chunk
// renderer to remesh), and the HUD shows the selected slot. The view ray starts at the CS:S eye position
// (origin + 64 u) and is cast in block units through world/raycast.ts.
import { Vector3 } from 'three'; // Vector math.
import { UNITS_PER_BLOCK, VIEW_OFFSET_DUCK, VIEW_OFFSET_STAND, type Hull } from '../physics/constants'; // Units/eye heights.
import { hullFor } from '../physics/movement'; // Current hull (standing/ducked).
import type { PlayerState } from '../physics/player'; // Player state.
import { BLOCKS, BlockId, HOTBAR } from '../world/blocks'; // Block table + hotbar order.
import { raycastBlock, type RayHit } from '../world/raycast'; // Voxel traversal.
import type { World } from '../world/world'; // Block store.

/** Reach in blocks (Minecraft survival reach is about 4.5-5 blocks). */
export const REACH_BLOCKS = 5;
const DEG2RAD = Math.PI / 180; // Degrees -> radians.

/** Source AngleVectors forward: (cos p cos y, cos p sin y, -sin p), pitch positive = looking down. */
export function viewDirection(yawDeg: number, pitchDeg: number): [number, number, number] {
  const y = yawDeg * DEG2RAD; // Yaw radians.
  const p = pitchDeg * DEG2RAD; // Pitch radians.
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)]; // Unit vector.
}

/** Eye position in Hammer units (origin + view offset). */
export function eyePosition(state: PlayerState): Vector3 {
  return state.origin.clone().setZ(state.origin.z + (state.ducked ? VIEW_OFFSET_DUCK : VIEW_OFFSET_STAND)); // Eye above feet.
}

/** True if block `b` (block coords) overlaps the hull at `origin` (Hammer units). Touching faces do not count. */
export function blockIntersectsHull(b: readonly number[], origin: Vector3, hull: Hull): boolean {
  const o = [origin.x, origin.y, origin.z]; // Origin as array.
  for (let i = 0; i < 3; i++) {
    const lo = b[i] * UNITS_PER_BLOCK; // Block min.
    const hi = lo + UNITS_PER_BLOCK; // Block max.
    if (o[i] + hull.maxs[i] <= lo || o[i] + hull.mins[i] >= hi) return false; // Separated on this axis.
  }
  return true; // Overlaps on all three axes.
}

/** Break/place logic plus the selected hotbar slot. */
export class BlockInteraction {
  selectedSlot = 0; // Index into HOTBAR.

  constructor(private readonly world: World) {}

  /** Select hotbar slot 0-8 (ignored if out of range). */
  selectSlot(slot: number): void {
    if (slot >= 0 && slot < HOTBAR.length) this.selectedSlot = slot; // Valid slots only.
  }

  /** Block type currently selected. */
  get selectedBlock(): BlockId {
    return HOTBAR[this.selectedSlot]; // Hotbar lookup.
  }

  /** The block under the crosshair within reach, or null. */
  target(state: PlayerState, yaw: number, pitch: number): RayHit | null {
    const eye = eyePosition(state).divideScalar(UNITS_PER_BLOCK); // Eye in block units.
    return raycastBlock(this.world, [eye.x, eye.y, eye.z], viewDirection(yaw, pitch), REACH_BLOCKS); // Cast.
  }

  /** Remove the targeted block; returns the hit (null if nothing breakable is targeted). */
  breakBlock(state: PlayerState, yaw: number, pitch: number): RayHit | null {
    const hit = this.target(state, yaw, pitch); // What are we looking at?
    if (hit === null || !BLOCKS[this.world.getBlock(...hit.block)].breakable) return null; // Nothing, or bedrock.
    this.world.setBlock(...hit.block, BlockId.AIR); // Remove it.
    return hit;
  }

  /** Place the selected block against the targeted face; returns its coordinates or null if not allowed. */
  placeBlock(state: PlayerState, yaw: number, pitch: number): [number, number, number] | null {
    const hit = this.target(state, yaw, pitch); // Face under the crosshair.
    if (hit === null || hit.normal.every((n) => n === 0)) return null; // Nothing hit (or eye inside a block).
    const at: [number, number, number] = [hit.block[0] + hit.normal[0], hit.block[1] + hit.normal[1], hit.block[2] + hit.normal[2]]; // Adjacent cell.
    if (blockIntersectsHull(at, state.origin, hullFor(state))) return null; // Would trap the player.
    if (BLOCKS[this.world.getBlock(...at)].solid) return null; // Occupied (should not happen, but be safe).
    return this.world.setBlock(...at, this.selectedBlock) ? at : null; // Place (fails above the world ceiling).
  }
}
