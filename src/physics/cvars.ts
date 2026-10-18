// Tunable movement "cvars" (console variables, named as in Source) and the two built-in presets.
// Global context: src/config.ts picks a preset from .env/URL and applies VITE_* overrides through CVAR_SCHEMA;
// movement.ts reads the resulting Cvars every tick; the in-game console (later step) edits the same object at runtime;
// experiments/ sweep these values. Units: Hammer units (u) and seconds.
// Sources for the values: Source SDK 2013 cvar defaults, Momentum Mod CGameModeBase/CGameMode_Bhop::SetGameModeVars
// (mp/src/game/shared/momentum/mom_system_gamemode.cpp) and the Valve Developer Community "Bunnyhop" and "Sv_friction" pages.
import { AIR_SPEED_CAP } from './constants'; // Default for the ablation-only sv_airspeedcap knob.

/** All movement tunables. Boolean cvars are stored as booleans (Source uses 0/1). */
export interface Cvars {
  tick_interval: number; // Seconds per simulation tick (Source -tickrate 66 => 0.015, 100 => 0.01).
  sv_gravity: number; // Downward acceleration, u/s^2.
  sv_accelerate: number; // Ground acceleration factor (per second, multiplied by wishspeed).
  sv_airaccelerate: number; // Air acceleration factor; the key bhop knob.
  sv_friction: number; // Ground friction factor.
  sv_stopspeed: number; // Below this speed friction acts as if moving at stopspeed (quick stops).
  sv_maxspeed: number; // Player run speed (CS:S knife: 250 u/s).
  sv_maxvelocity: number; // Per-axis velocity clamp (CheckVelocity).
  sv_enablebunnyhopping: boolean; // false => clamp speed to 1.1 * maxspeed (cvar added to CS:S 2010-08-17); applied on jump, TF2-style.
  sv_autobunnyhopping: boolean; // true => holding jump re-jumps on landing (CS:S since 2025-02-18).
  sv_airspeedcap: number; // Air speed cap (30 in Source); exposed only so experiments can ablate it.
}

/** Names of the built-in presets. */
export type PresetName = 'css_bhop' | 'css_vanilla';

/** Stock CS:S server values (66.67 tick, sv_airaccelerate 10, bhop speed cap on, jumps must be timed). */
const CSS_VANILLA: Cvars = {
  tick_interval: 0.015, // Source default tick interval (66.67 Hz) [MOM CGameModeBase GetIntervalPerTick 0.015].
  sv_gravity: 800, // Source default.
  sv_accelerate: 5, // [MOM CGameModeBase: sv_accelerate 5].
  sv_airaccelerate: 10, // CS:S default sv_airaccelerate 10.
  sv_friction: 4, // [VDC Sv_friction: "sv_friction 4 (Counter-Strike: Source)"].
  sv_stopspeed: 75, // [MOM CGameModeBase: sv_stopspeed 75].
  sv_maxspeed: 250, // CS:S knife run speed (player m_flMaxspeed).
  sv_maxvelocity: 3500, // Source default sv_maxvelocity [MOM CGameModeBase: 3500].
  sv_enablebunnyhopping: false, // Default 0 since 2010-08-17 [VDC Bunnyhop].
  sv_autobunnyhopping: false, // Default 0 [VDC Bunnyhop].
  sv_airspeedcap: AIR_SPEED_CAP, // 30.
};

/** Bhop-server style, like Momentum Mod's Bhop mode: 100 tick, sv_airaccelerate 1000, no cap, auto-bhop. */
const CSS_BHOP: Cvars = {
  ...CSS_VANILLA, // Same base physics...
  tick_interval: 0.01, // [MOM CGameMode_Bhop GetIntervalPerTick 0.01] (100 tick).
  sv_airaccelerate: 1000, // [MOM CGameMode_Bhop::SetGameModeVars: sv_airaccelerate 1000].
  sv_enablebunnyhopping: true, // No 110% clamp.
  sv_autobunnyhopping: true, // [MOM CGameMode_Bhop PlayerHasAutoBhop() true].
};

/** Preset table looked up by name. */
export const PRESETS: Readonly<Record<PresetName, Readonly<Cvars>>> = { css_bhop: CSS_BHOP, css_vanilla: CSS_VANILLA };

/** True when `name` is one of the built-in presets. */
export function isPresetName(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESETS, name); // Own-property check avoids prototype keys like "toString".
}

/** Validation rule per cvar, used by config parsing (.env VITE_<NAME>) and the in-game console. */
export type CvarRule = { kind: 'number'; min: number; max: number } | { kind: 'boolean' };

/** Schema of every cvar: name -> allowed range/type. Keys match the Cvars interface exactly. */
export const CVAR_SCHEMA: Readonly<Record<keyof Cvars, CvarRule>> = {
  tick_interval: { kind: 'number', min: 0.001, max: 0.1 }, // 10..1000 tick.
  sv_gravity: { kind: 'number', min: 0, max: 10000 },
  sv_accelerate: { kind: 'number', min: 0, max: 1000 },
  sv_airaccelerate: { kind: 'number', min: 0, max: 100000 },
  sv_friction: { kind: 'number', min: 0, max: 100 },
  sv_stopspeed: { kind: 'number', min: 0, max: 10000 },
  sv_maxspeed: { kind: 'number', min: 1, max: 10000 },
  sv_maxvelocity: { kind: 'number', min: 1, max: 1000000 },
  sv_enablebunnyhopping: { kind: 'boolean' },
  sv_autobunnyhopping: { kind: 'boolean' },
  sv_airspeedcap: { kind: 'number', min: 0, max: 100000 },
};

/** Parse one raw string for cvar `name`. Returns undefined when invalid (caller decides how to report it). */
export function parseCvarValue(name: keyof Cvars, raw: string): number | boolean | undefined {
  const rule = CVAR_SCHEMA[name]; // Validation rule.
  const text = raw.trim().toLowerCase(); // Normalise "TRUE", " 1 " etc.
  if (rule.kind === 'boolean') {
    if (text === '1' || text === 'true') return true; // Source-style 1 or JSON-style true.
    if (text === '0' || text === 'false') return false; // Source-style 0 or false.
    return undefined; // Anything else is invalid.
  }
  const value = Number(text); // Numeric parse.
  return Number.isFinite(value) && value >= rule.min && value <= rule.max ? value : undefined; // Range check.
}

/** Copy of a preset so callers can mutate their own cvars without touching the shared table. */
export function cvarsFromPreset(name: PresetName): Cvars {
  return { ...PRESETS[name] }; // Shallow copy is enough: all fields are primitives.
}
