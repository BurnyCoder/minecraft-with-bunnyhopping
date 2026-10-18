// Tests for the command interpreter of src/game/console.ts — the CS:S-style developer console (toggle with `).
// Global context: players tune movement live ("sv_airaccelerate 100", "preset css_vanilla") like on a CS:S server; values
// must be validated against the same schema as .env overrides so the console cannot break the physics.
import { describe, expect, it } from 'vitest'; // Vitest API.
import { runCommand, type ConsoleTarget } from '../../src/game/console'; // Unit under test.
import { InputState } from '../../src/game/input'; // Sensitivity holder.
import { cvarsFromPreset } from '../../src/physics/cvars'; // Presets.

/** Fresh console target. */
function target(): ConsoleTarget & { resets: number } {
  const t = { cvars: cvarsFromPreset('css_bhop'), input: new InputState(2), resets: 0, resetWorld: () => void t.resets++ }; // Counts resets.
  return t;
}

describe('runCommand', () => {
  it('prints and sets cvars with validation', () => {
    const t = target(); // css_bhop.
    expect(runCommand('sv_airaccelerate', t)).toEqual(['sv_airaccelerate = 1000']); // Query.
    runCommand('sv_airaccelerate 100', t); // Set.
    expect(t.cvars.sv_airaccelerate).toBe(100); // Applied.
    runCommand('sv_autobunnyhopping 0', t); // Boolean, Source style.
    expect(t.cvars.sv_autobunnyhopping).toBe(false); // Applied.
    expect(runCommand('sv_gravity -1', t)[0]).toMatch(/invalid/); // Out of range rejected...
    expect(t.cvars.sv_gravity).toBe(800); // ...and unchanged.
  });

  it('switches presets in place and adjusts sensitivity', () => {
    const t = target(); // css_bhop.
    runCommand('preset css_vanilla', t); // Switch.
    expect(t.cvars.tick_interval).toBe(0.015); // Same object now holds vanilla values.
    expect(t.cvars.sv_airaccelerate).toBe(10);
    runCommand('sensitivity 1.25', t); // Mouse.
    expect(t.input.sensitivity).toBe(1.25); // Applied.
    expect(runCommand('preset quake', t)[0]).toMatch(/unknown preset/); // Unknown preset rejected.
  });

  it('lists cvars, answers help, resets the world, and reports unknown commands', () => {
    const t = target(); // Fresh.
    expect(runCommand('cvarlist', t).length).toBe(Object.keys(t.cvars).length); // One line per cvar.
    expect(runCommand('help', t).join(' ')).toMatch(/cvarlist/); // Help mentions commands.
    runCommand('world_reset', t); // Clear edits.
    expect(t.resets).toBe(1); // Callback fired.
    expect(runCommand('noclip', t)[0]).toMatch(/unknown command/); // Not supported.
  });
});
