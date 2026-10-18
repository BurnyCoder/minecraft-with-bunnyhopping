// Saving player block edits per world seed, so a reload brings your builds back.
// Global context: terrain is a pure function of the seed (world/terrain.ts), so only the World's edit overlay is stored,
// as JSON under "bhopcraft:edits:<seed>" in localStorage. Writes are debounced after edits. Stored data is untrusted
// (stale versions, manual edits), so every entry is validated on load. Storage may be unavailable (private mode, quota,
// disabled site data), so every access is wrapped in try/catch and the game works without it.
// API: Web Storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
import type { Logger } from '../logging/logger'; // Logging.
import { BLOCKS, type BlockId } from '../world/blocks'; // Valid ids.
import { CHUNK_HEIGHT } from '../world/chunk'; // Valid z range.
import type { World } from '../world/world'; // Edit source.

/** The subset of the Storage interface used here (lets tests pass an in-memory fake). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One stored edit: block x, y, z and the new block id. */
type Edit = [number, number, number, BlockId];

/** Storage key for a seed. */
export function editsKey(seed: number): string {
  return `bhopcraft:edits:${seed}`; // Namespaced per seed.
}

/** True if `value` is a well-formed edit (integers, z inside the world, known block id). */
function isEdit(value: unknown): value is Edit {
  return (
    Array.isArray(value) && value.length === 4 && value.every(Number.isInteger) && // Four integers.
    value[2] >= 0 && value[2] < CHUNK_HEIGHT && value[3] >= 0 && value[3] < BLOCKS.length // In range.
  );
}

/** Load validated edits for `seed` ([] if none, corrupt, or storage unavailable). */
export function loadEdits(store: KeyValueStore, seed: number, log: Logger): Edit[] {
  try {
    const raw = store.getItem(editsKey(seed)); // Stored JSON, if any.
    if (raw === null) return []; // Nothing saved yet.
    const parsed: unknown = JSON.parse(raw); // May throw on corrupt data.
    if (!Array.isArray(parsed)) return []; // Wrong shape.
    const edits = parsed.filter(isEdit); // Keep only valid entries.
    if (edits.length !== parsed.length) log.warn('dropped invalid saved edits', { dropped: parsed.length - edits.length }); // Report.
    return edits;
  } catch (error) {
    log.warn('could not load saved edits', { error: String(error) }); // Corrupt JSON or blocked storage.
    return [];
  }
}

/** Save edits for `seed`; failures are logged, never thrown. */
export function saveEdits(store: KeyValueStore, seed: number, edits: readonly Edit[], log: Logger): void {
  try {
    store.setItem(editsKey(seed), JSON.stringify(edits)); // Compact JSON array.
  } catch (error) {
    log.warn('could not save edits', { error: String(error), count: edits.length }); // Quota or blocked storage.
  }
}

/** Browser localStorage, or null if accessing it throws (e.g. disabled site data). */
export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage; // Accessing the property itself can throw.
  } catch {
    return null; // Run without persistence.
  }
}

/** Load saved edits into `world` now, and save again 1 s after the last edit. */
export function attachPersistence(world: World, store: KeyValueStore | null, seed: number, log: Logger): void {
  if (store === null) {
    log.warn('localStorage unavailable; block edits will not be saved'); // Explain once.
    return;
  }
  const edits = loadEdits(store, seed, log); // Previous session's builds.
  world.importEdits(edits); // Applied as chunks generate.
  log.info('saved edits loaded', { count: edits.length, key: editsKey(seed) }); // Startup info.
  let timer: ReturnType<typeof setTimeout> | undefined; // Debounce timer (undefined = nothing pending).
  const save = (): void => {
    clearTimeout(timer); // Cancel any pending save...
    timer = undefined; // ...and mark nothing pending.
    saveEdits(store, seed, world.exportEdits(), log); // Write now.
  };
  world.onChunkChanged(() => {
    clearTimeout(timer); // Restart the countdown on every edit...
    timer = setTimeout(save, 1000); // ...and save once things settle.
  });
  globalThis.addEventListener?.('pagehide', () => {
    if (timer !== undefined) save(); // Reload/close within 1 s of an edit: flush instead of losing it.
  });
}
