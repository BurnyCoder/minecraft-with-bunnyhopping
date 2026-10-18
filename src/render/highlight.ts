// Wireframe outline around the block under the crosshair (Minecraft's selection box).
// Global context: game/loop.ts updates it every frame from the same raycast that break/place use, so the outline
// always shows exactly the block a click would affect.
// three.js: EdgesGeometry + LineSegments (https://threejs.org/docs/#api/en/geometries/EdgesGeometry).
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, type Scene } from 'three'; // Primitives.

/** A unit-cube outline that can be moved onto any block. */
export class BlockHighlight {
  private readonly lines: LineSegments; // The outline object.

  constructor(scene: Scene) {
    const box = new BoxGeometry(1.004, 1.004, 1.004); // Slightly larger than a block to avoid z-fighting.
    this.lines = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: 0x111111 })); // 12 dark edges.
    box.dispose(); // EdgesGeometry copied what it needs.
    this.lines.visible = false; // Hidden until something is targeted.
    scene.add(this.lines); // Part of the world scene.
  }

  /** Show the outline on block `b` (block coordinates), or hide it when `b` is null. */
  set(b: readonly number[] | null): void {
    this.lines.visible = b !== null; // Toggle.
    if (b !== null) this.lines.position.set(b[0] + 0.5, b[1] + 0.5, b[2] + 0.5); // Box geometry is centred.
  }
}
