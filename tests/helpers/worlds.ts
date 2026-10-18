// Tiny in-memory voxel worlds for physics tests (no terrain generator, no chunks).
// Global context: physics only needs the VoxelQuery interface (isSolid at block coordinates), so tests can build exact
// geometries — an infinite floor, a wall, a ceiling — and check movement against hand-computed answers.
import type { VoxelQuery } from '../../src/physics/collision'; // Interface the physics consumes.

/** World made of an infinite floor (every block with bz < 0, so the floor surface is z = 0) plus extra solid cells. */
export class TestWorld implements VoxelQuery {
  private readonly cells = new Set<string>(); // "x,y,z" keys of extra solid blocks.

  constructor(private readonly floor = true) {} // floor=false gives empty space (free fall forever).

  /** Mark block (bx, by, bz) solid; returns this for chaining. */
  add(bx: number, by: number, bz: number): this {
    this.cells.add(`${bx},${by},${bz}`); // String key is simple and fast enough for tests.
    return this;
  }

  /** VoxelQuery implementation. */
  isSolid(bx: number, by: number, bz: number): boolean {
    return (this.floor && bz < 0) || this.cells.has(`${bx},${by},${bz}`); // Floor or explicit block.
  }
}
