// Game configuration: parses .env values (Vite exposes VITE_* keys on import.meta.env) and URL query overrides
// into one validated, typed GameConfig object.
// Global context: src/main.ts calls loadConfig() as its first phase; every other phase receives the resulting object, so
// no module reads environment variables or the URL on its own.
// Vite env handling: https://vite.dev/guide/env-and-mode.html (only VITE_-prefixed keys reach client code).
import { parseLogLevel, type LogLevel } from './logging/logger'; // Shared log-level parsing.
import { CVAR_SCHEMA, cvarsFromPreset, isPresetName, parseCvarValue, type Cvars, type PresetName } from './physics/cvars'; // Movement tunables.

/** Fully parsed configuration. `warnings` lists every rejected value so main.ts can log them once logging is up. */
export interface GameConfig {
  preset: PresetName; // Movement preset name (css_bhop | css_vanilla).
  cvars: Cvars; // Movement cvars: the preset plus any VITE_<CVAR_NAME> overrides (e.g. VITE_SV_AIRACCELERATE).
  seed: number; // World generation seed (same seed => same terrain).
  renderDistance: number; // View radius in chunks around the player.
  fovDeg: number; // CS:S-style horizontal FOV at a 4:3 aspect (default 90); widened Hor+ on wider screens.
  sensitivity: number; // CS:S "sensitivity" multiplier; yaw delta = mouse counts * 0.022 * sensitivity degrees.
  logLevel: LogLevel; // Minimum level written to the console and log files.
  autoplaySeconds: number; // >0 runs the strafe bot for that many seconds (verification mode); 0 = normal play.
  warnings: string[]; // Human-readable notes about values that fell back to defaults.
}

/** Defaults used when a key is missing or invalid (the committed .env.example documents the same values). */
export const DEFAULT_CONFIG: Omit<GameConfig, 'warnings' | 'cvars'> = {
  preset: 'css_bhop', // Bhop-server style by default (user choice).
  seed: 1337, // Arbitrary fixed seed for a reproducible default world.
  renderDistance: 6, // 13x13 chunks visible; a balance of view distance and meshing cost.
  fovDeg: 90, // CS:S default_fov is 90 (horizontal at 4:3).
  sensitivity: 2, // A common CS:S sensitivity value.
  logLevel: 'info', // Lifecycle events without per-tick noise.
  autoplaySeconds: 0, // Normal play.
};

/** Map of raw string values, e.g. import.meta.env. */
export type EnvSource = Record<string, string | undefined>;

/** Numeric validation rules for one key. */
interface NumberRule {
  min: number; // Inclusive lower bound.
  max: number; // Inclusive upper bound.
  integer?: boolean; // Require a whole number.
}

/** Parse `raw` as a number within `rule`; on failure push a warning and return `fallback`. */
function readNumber(raw: string | undefined, key: string, fallback: number, rule: NumberRule, warnings: string[]): number {
  if (raw === undefined || raw.trim() === '') return fallback; // Missing key: silent default.
  const value = Number(raw); // Number("1.5") = 1.5, Number("wide") = NaN.
  const valid = Number.isFinite(value) && value >= rule.min && value <= rule.max && (!rule.integer || Number.isInteger(value));
  if (valid) return value; // Accepted.
  warnings.push(`${key}=${raw} is invalid (expected ${rule.integer ? 'an integer' : 'a number'} in [${rule.min}, ${rule.max}]); using ${fallback}`);
  return fallback; // Rejected: keep the game playable.
}

/** Look up a value: URL query parameter (if `queryKey` given and present) wins over the .env key. */
function pick(env: EnvSource, envKey: string, query: URLSearchParams, queryKey?: string): string | undefined {
  const fromQuery = queryKey === undefined ? null : query.get(queryKey); // ?seed=7 style override.
  return fromQuery ?? env[envKey]; // Fall back to the .env value.
}

/** Pure parser (unit-tested): environment + query string -> GameConfig. */
export function parseConfig(env: EnvSource, query: URLSearchParams): GameConfig {
  const warnings: string[] = []; // Collected problems.
  const d = DEFAULT_CONFIG; // Short alias.
  const rawLevel = pick(env, 'VITE_LOG_LEVEL', query, 'log'); // Level string, if any.
  const logLevel = parseLogLevel(rawLevel, d.logLevel); // Unknown names -> default.
  if (rawLevel !== undefined && rawLevel !== logLevel) warnings.push(`VITE_LOG_LEVEL=${rawLevel} is unknown; using ${logLevel}`);
  const rawPreset = pick(env, 'VITE_PRESET', query, 'preset'); // Requested movement preset.
  const preset = rawPreset !== undefined && isPresetName(rawPreset) ? rawPreset : d.preset; // Only known presets.
  if (rawPreset !== undefined && rawPreset !== preset) warnings.push(`VITE_PRESET=${rawPreset} is unknown; using ${preset}`);
  return {
    preset, // Validated above.
    cvars: readCvars(preset, env, warnings), // Preset values + VITE_<CVAR> overrides.
    seed: readNumber(pick(env, 'VITE_SEED', query, 'seed'), 'VITE_SEED', d.seed, { min: -2147483648, max: 2147483647, integer: true }, warnings),
    renderDistance: readNumber(pick(env, 'VITE_RENDER_DISTANCE', query, 'rd'), 'VITE_RENDER_DISTANCE', d.renderDistance, { min: 2, max: 16, integer: true }, warnings),
    fovDeg: readNumber(pick(env, 'VITE_FOV', query), 'VITE_FOV', d.fovDeg, { min: 60, max: 130 }, warnings),
    sensitivity: readNumber(pick(env, 'VITE_SENSITIVITY', query), 'VITE_SENSITIVITY', d.sensitivity, { min: 0.01, max: 50 }, warnings),
    logLevel, // Parsed above.
    autoplaySeconds: readNumber(query.get('autoplay') ?? undefined, 'autoplay', d.autoplaySeconds, { min: 0, max: 3600 }, warnings),
    warnings, // Logged by main.ts after logging is configured.
  };
}

/** Start from the preset and apply every valid VITE_<CVAR_NAME> override (e.g. VITE_SV_AIRACCELERATE=100). */
function readCvars(preset: PresetName, env: EnvSource, warnings: string[]): Cvars {
  const cvars = cvarsFromPreset(preset); // Mutable copy of the preset.
  for (const name of Object.keys(CVAR_SCHEMA) as (keyof Cvars)[]) {
    const key = `VITE_${name.toUpperCase()}`; // sv_airaccelerate -> VITE_SV_AIRACCELERATE.
    const raw = env[key]; // Raw .env value, if any.
    if (raw === undefined || raw.trim() === '') continue; // Not overridden.
    const value = parseCvarValue(name, raw); // Typed + range-checked.
    if (value === undefined) warnings.push(`${key}=${raw} is invalid; keeping ${String(cvars[name])}`); // Reject.
    else (cvars as unknown as Record<string, number | boolean>)[name] = value; // Accept (types match by schema).
  }
  return cvars;
}

/** Browser entry: read Vite's import.meta.env and the page URL. */
export function loadConfig(): GameConfig {
  return parseConfig(import.meta.env as unknown as EnvSource, new URLSearchParams(location.search)); // Vite injects env at build time.
}
