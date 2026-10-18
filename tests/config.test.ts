// Tests for src/config.ts — turns .env values (VITE_* keys) plus URL query overrides into a validated GameConfig.
// Global context: every tunable (seed, render distance, mouse sensitivity, movement preset...) flows through this parser,
// so bad values must fall back to defaults with a warning instead of breaking the game.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { DEFAULT_CONFIG, parseConfig } from '../src/config'; // Unit under test.

describe('parseConfig', () => {
  it('returns defaults for an empty environment', () => {
    const config = parseConfig({}, new URLSearchParams()); // Nothing set anywhere.
    expect(config).toMatchObject(DEFAULT_CONFIG); // Every field equals its default.
    expect(config.warnings).toEqual([]); // Nothing to warn about.
  });

  it('reads typed values from VITE_* keys', () => {
    const config = parseConfig(
      { VITE_SEED: '42', VITE_RENDER_DISTANCE: '4', VITE_FOV: '100', VITE_SENSITIVITY: '1.5', VITE_LOG_LEVEL: 'debug' },
      new URLSearchParams(),
    ); // Values as Vite exposes them (strings).
    expect(config.seed).toBe(42); // Integer parsed.
    expect(config.renderDistance).toBe(4); // Integer parsed.
    expect(config.fovDeg).toBe(100); // Number parsed.
    expect(config.sensitivity).toBe(1.5); // Float parsed.
    expect(config.logLevel).toBe('debug'); // Enum parsed.
  });

  it('lets URL query parameters override .env values', () => {
    const config = parseConfig({ VITE_SEED: '42' }, new URLSearchParams('seed=7&autoplay=20')); // ?seed wins over .env.
    expect(config.seed).toBe(7); // Query override applied.
    expect(config.autoplaySeconds).toBe(20); // Autoplay only comes from the URL.
  });

  it('falls back to defaults with a warning for invalid or out-of-range values', () => {
    const config = parseConfig({ VITE_RENDER_DISTANCE: '999', VITE_FOV: 'wide', VITE_LOG_LEVEL: 'loud' }, new URLSearchParams());
    expect(config.renderDistance).toBe(DEFAULT_CONFIG.renderDistance); // Out of range -> default.
    expect(config.fovDeg).toBe(DEFAULT_CONFIG.fovDeg); // Not a number -> default.
    expect(config.logLevel).toBe(DEFAULT_CONFIG.logLevel); // Unknown level -> default.
    expect(config.warnings).toHaveLength(3); // One warning per rejected value.
  });
});
