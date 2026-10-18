// three.js renderer, scene and first-person camera in the game's z-up frame.
// Global context: phase "createRenderer" of src/main.ts. The scene is rendered in block units (1 unit = 1 block = 40 u),
// with camera.up = +z, so world, physics and rendering share axes and no axis conversion exists anywhere.
// The CS:S field of view is defined horizontally at 4:3 ("Hor+": wider screens see more), so the vertical FOV is fixed:
// vfov = 2 * atan(tan(hfov / 2) * 3 / 4); hfov 90 gives 73.74 degrees.
// three.js: WebGLRenderer, PerspectiveCamera, Fog, Object3D.up + lookAt (https://threejs.org/docs/).
import { Color, Fog, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'; // Rendering primitives.
import { CHUNK_SIZE } from '../world/chunk'; // Fog distance in chunks.
import { UNITS_PER_BLOCK } from '../physics/constants'; // Hammer units per block.
import { viewDirection } from '../game/interaction'; // Source AngleVectors forward.

/** Sky / fog colour. */
const SKY = 0x87b5ff;

/** Everything the rest of the game needs from the renderer. */
export interface RenderContext {
  renderer: WebGLRenderer; // WebGL renderer.
  scene: Scene; // Root scene.
  camera: PerspectiveCamera; // First-person camera.
  placeCamera(eyeUnits: Vector3, yawDeg: number, pitchDeg: number): void; // Position from Hammer units + Source angles.
  render(): void; // Draw one frame.
}

/** Vertical FOV for a CS:S horizontal FOV defined at 4:3. */
export function verticalFov(horizontalFovDeg: number): number {
  const half = (horizontalFovDeg * Math.PI) / 360; // Half angle in radians.
  return (2 * Math.atan(Math.tan(half) * (3 / 4)) * 180) / Math.PI; // Degrees.
}

/** Create the renderer inside `container` and keep it sized to the window. */
export function createRenderer(container: HTMLElement, fovDeg: number, renderDistanceChunks: number): RenderContext {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // Prefer the dGPU.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Sharp on HiDPI but bounded cost.
  renderer.setSize(window.innerWidth, window.innerHeight); // Fill the window.
  container.appendChild(renderer.domElement); // Insert the canvas.
  const scene = new Scene(); // Root.
  scene.background = new Color(SKY); // Sky colour.
  const viewBlocks = renderDistanceChunks * CHUNK_SIZE; // Visible radius in blocks.
  scene.fog = new Fog(SKY, viewBlocks * 0.55, viewBlocks * 0.95); // Hide chunk pop-in at the edge.
  const camera = new PerspectiveCamera(verticalFov(fovDeg), window.innerWidth / window.innerHeight, 0.02, viewBlocks * 1.5); // Near 0.8 u.
  camera.up.set(0, 0, 1); // z is up in this world.
  const target = new Vector3(); // Scratch look-at point.
  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight; // New aspect (Hor+ keeps vertical FOV).
    camera.updateProjectionMatrix(); // Apply.
    renderer.setSize(window.innerWidth, window.innerHeight); // Resize canvas.
  };
  window.addEventListener('resize', resize); // Track window size.
  return {
    renderer,
    scene,
    camera,
    placeCamera(eyeUnits, yawDeg, pitchDeg) {
      camera.position.copy(eyeUnits).divideScalar(UNITS_PER_BLOCK); // Hammer units -> blocks.
      const [dx, dy, dz] = viewDirection(yawDeg, pitchDeg); // Unit forward vector.
      camera.lookAt(target.set(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz)); // Orient (up = +z).
    },
    render() {
      renderer.render(scene, camera); // Draw.
    },
  };
}
