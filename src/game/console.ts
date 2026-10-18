// CS:S-style developer console: press ` (backquote) to open, type commands such as "sv_airaccelerate 100",
// "preset css_vanilla", "cvarlist", "sensitivity 1.5", "world_reset", "help".
// Global context: runCommand() is pure and unit-tested; DevConsole is the small DOM panel around it. Cvars are edited
// in place on the live object the game loop reads every tick (the loop also picks up tick_interval changes), and
// values are validated with the same CVAR_SCHEMA as the .env overrides in config.ts.
import type { Logger } from '../logging/logger'; // Command log.
import { CVAR_SCHEMA, isPresetName, parseCvarValue, PRESETS, type Cvars } from '../physics/cvars'; // Cvar table.
import type { InputState } from './input'; // Sensitivity.

/** What console commands may change. */
export interface ConsoleTarget {
  cvars: Cvars; // Live movement cvars.
  input: InputState; // Mouse sensitivity.
  resetWorld(): void; // Clear saved edits and reload.
}

/** Help text lines. */
const HELP = [
  'commands: help | cvarlist | <cvar> | <cvar> <value> | preset css_bhop|css_vanilla | sensitivity [value] | world_reset',
  'example: sv_airaccelerate 100   (booleans take 1/0)',
];

/** Execute one console line and return the output lines. */
export function runCommand(line: string, target: ConsoleTarget): string[] {
  const [name = '', value, ...rest] = line.trim().split(/\s+/); // "cmd arg".
  if (name === '') return []; // Empty line.
  if (rest.length > 0) return [`too many arguments: ${line}`]; // Every command takes at most one value.
  if (name === 'help') return HELP; // Usage.
  if (name === 'cvarlist') return Object.entries(target.cvars).map(([k, v]) => `${k} = ${String(v)}`); // All values.
  if (name === 'world_reset') {
    target.resetWorld(); // Clears edits and reloads.
    return ['world edits cleared'];
  }
  if (name === 'sensitivity') {
    if (value === undefined) return [`sensitivity = ${target.input.sensitivity}`]; // Query.
    const s = Number(value); // Parse.
    if (!Number.isFinite(s) || s <= 0 || s > 50) return [`invalid sensitivity: ${value}`]; // Range check.
    target.input.sensitivity = s; // Apply.
    return [`sensitivity = ${s}`];
  }
  if (name === 'preset') {
    if (value === undefined || !isPresetName(value)) return [`unknown preset: ${value ?? ''} (css_bhop | css_vanilla)`]; // Validate.
    Object.assign(target.cvars, PRESETS[value]); // Overwrite in place: the loop keeps its reference.
    return [`preset ${value} applied`];
  }
  if (Object.prototype.hasOwnProperty.call(CVAR_SCHEMA, name)) {
    const key = name as keyof Cvars; // Known cvar.
    if (value === undefined) return [`${key} = ${String(target.cvars[key])}`]; // Query.
    const parsed = parseCvarValue(key, value); // Typed + range-checked.
    if (parsed === undefined) return [`invalid value for ${key}: ${value}`]; // Reject.
    (target.cvars as unknown as Record<string, number | boolean>)[key] = parsed; // Apply.
    return [`${key} = ${String(parsed)}`];
  }
  return [`unknown command: ${name} (try help)`]; // Anything else.
}

/** DOM console panel: a text input plus a scrolling output log. */
export class DevConsole {
  private readonly panel: HTMLDivElement; // Container.
  private readonly output: HTMLDivElement; // Past lines.
  private readonly field: HTMLInputElement; // Command entry.

  constructor(container: HTMLElement, private readonly target: ConsoleTarget, private readonly log: Logger) {
    this.panel = document.createElement('div'); // Panel element.
    this.panel.style.cssText = 'position:fixed;left:0;right:0;top:0;max-height:40%;display:none;flex-direction:column;background:#000c;color:#ddd;font:13px ui-monospace,Consolas,monospace;z-index:10'; // Top drop-down like CS:S.
    this.output = document.createElement('div'); // Output area.
    this.output.style.cssText = 'overflow-y:auto;padding:6px 8px;white-space:pre-wrap;flex:1';
    this.field = document.createElement('input'); // Command line.
    this.field.style.cssText = 'background:#111;color:#fff;border:0;border-top:1px solid #444;padding:6px 8px;font:inherit;outline:none';
    this.field.placeholder = 'type help'; // Hint.
    this.panel.append(this.output, this.field); // Assemble.
    container.appendChild(this.panel);
    this.field.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this.submit(); // Run the line.
      if (e.code === 'Backquote' || e.code === 'Escape') {
        e.preventDefault(); // Do not type the backquote.
        this.toggle(false); // Close.
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && e.target !== this.field) {
        e.preventDefault(); // Keep the character out of the field.
        this.toggle(true); // Open.
      }
    });
    this.print(HELP); // Usage on first open.
  }

  /** Show or hide the console; opening releases the mouse so the text field gets the keyboard. */
  toggle(open: boolean): void {
    this.panel.style.display = open ? 'flex' : 'none'; // Visibility.
    if (open) {
      document.exitPointerLock(); // Free the cursor.
      this.field.focus(); // Type straight away.
    } else this.field.blur(); // Give keys back to the game.
  }

  /** Execute the typed line. */
  private submit(): void {
    const line = this.field.value; // Command text.
    this.field.value = ''; // Clear for the next one.
    const result = runCommand(line, this.target); // Execute.
    this.print([`] ${line}`, ...result]); // Echo + output, CS:S style.
    this.log.info('console command', { line, result }); // Keep a record in the log file.
  }

  /** Append lines to the output (textContent: never interpreted as HTML). */
  private print(lines: readonly string[]): void {
    for (const text of lines) {
      const row = document.createElement('div'); // One line.
      row.textContent = text;
      this.output.appendChild(row);
    }
    this.output.scrollTop = this.output.scrollHeight; // Follow the newest line.
  }
}
