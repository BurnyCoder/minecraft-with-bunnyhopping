// Tests for src/game/persistence.ts — saving and loading block edits per world seed (localStorage in the browser).
// Global context: terrain is regenerated from the seed, so only player edits need saving. Stored data is untrusted
// (it can be stale or hand-edited), so loading must validate it and never crash the game.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { editsKey, loadEdits, saveEdits, type KeyValueStore } from '../../src/game/persistence'; // Unit under test.
import { configureLogging, createLogger } from '../../src/logging/logger'; // Silent logger.
import { BlockId } from '../../src/world/blocks'; // Block ids.

/** In-memory Storage stand-in. */
function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>(); // Backing map.
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('edit persistence', () => {
  configureLogging({ level: 'error', sinks: [] }); // Quiet.
  const log = createLogger('test'); // Logger for the functions.

  it('round-trips edits under a per-seed key', () => {
    const store = memoryStore(); // Fake localStorage.
    const edits: [number, number, number, BlockId][] = [[1, 2, 3, BlockId.BRICKS], [-5, 40, 0, BlockId.AIR]]; // Two edits.
    saveEdits(store, 42, edits, log); // Save for seed 42.
    expect(store.data.has(editsKey(42))).toBe(true); // Stored under the seed's key.
    expect(loadEdits(store, 42, log)).toEqual(edits); // Same data back.
    expect(loadEdits(store, 7, log)).toEqual([]); // Other seeds are unaffected.
  });

  it('ignores corrupt or out-of-range data instead of crashing', () => {
    const store = memoryStore(); // Fake localStorage.
    store.setItem(editsKey(1), '{not json'); // Corrupt JSON.
    expect(loadEdits(store, 1, log)).toEqual([]); // Treated as no edits.
    store.setItem(editsKey(1), JSON.stringify([[1, 2, 3, 4], [1, 2, 'x', 4], [0, 0, 999, 1], [0, 0, 1, 250]])); // Mixed validity.
    expect(loadEdits(store, 1, log)).toEqual([[1, 2, 3, 4]]); // Only the valid entry survives.
  });

  it('survives a storage that throws (private browsing, quota)', () => {
    const throwing: KeyValueStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
    expect(loadEdits(throwing, 1, log)).toEqual([]); // No crash on read...
    expect(() => saveEdits(throwing, 1, [[0, 0, 1, BlockId.DIRT]], log)).not.toThrow(); // ...or on write.
  });
});
