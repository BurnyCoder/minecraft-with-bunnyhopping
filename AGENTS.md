# AGENTS.md — notes for coding agents working on BhopCraft

User-facing docs are in README.md and docs/. This file covers working rules and pitfalls.

## Layout rules
- `src/main.ts` is the only top-level wrapper; it calls named phases in order. Add startup work as a new phase module
  (like `game/worldSetup.ts`), not inline.
- `src/config.ts` is the only place that reads `.env` (`import.meta.env`) or the URL.
- `src/physics/` and `src/world/` must stay DOM-free and engine-free. Tests, experiments and autoplay depend on running
  them in Node.
- Movement cvars live in one mutable `Cvars` object (the console edits it in place). Do not copy it.
- Closed-form strafing maths lives only in `physics/strafeBot.ts` (`optimalGainPerTick`, `effectiveAirCap`).
  Unit tests recompute it independently on purpose (they are the oracle).

## Commands
- `npm test` — unit + integration tests (Node).
- `npm run typecheck` — type check.
- `npm run e2e -- --seconds 6 [--preset css_vanilla]` — full game in headless Chrome. Screenshots go to
  `logs/screenshots/`.
- `npm run experiments` — needs `uv sync` first. Regenerates `reports/data`, figures and `paper.pdf`; results must stay
  byte-identical.

## Conventions
- Log through `createLogger(module)` (TS) or `analysis/common.log` (Python); never truncate. Log events and 1 Hz
  `status` summaries, not every tick (per-jump lines are `debug`).
- Comment each file, function and non-trivial line with its local purpose, global context and source links (SDK line
  numbers, wiki pages, docs).
- Tests first (TDD); run `npm test` and `npm run typecheck` before committing; run `npm run e2e` after touching the
  game client.
- Never commit `.env`, `logs/` or credentials.
- One feature branch + PR per functional unit; merge with `gh pr merge --merge`. CI runs typecheck, tests and e2e.

## Experiments (scientific hygiene)
- Write hypotheses, metrics, thresholds and sample sizes into `reports/expNN_*.md` and commit them *before* running.
- Never edit a pre-registration section afterwards. Append results and list every deviation (D1, D2, …).
- Label post-hoc analyses as such, and keep superseded data files instead of overwriting them.

## Pitfalls seen so far
- **Hidden in-app browser pane** pauses `requestAnimationFrame`, so the game appears frozen at its first frame. Use
  `npm run e2e` or a puppeteer script for automated checks.
- **Dev-only hook:** `window.__bhopcraft` (dev builds only) exposes the `GameContext` for scripted visual checks
  (aim the camera, place blocks).
- **Strafe theory's L** is min(`sv_airspeedcap`, wishspeed), not the cap alone (see reports/exp01, deviation D1).
- **Python on Windows** writes CRLF; `.gitattributes` normalises to LF. Prefer the Edit tool for TypeScript changes.
- **TypeScript 7 + `verbatimModuleSyntax`:** use `import type` for type-only imports. Use a plain `enum` (not
  `const enum`) for cross-file enums.
- **Chrome headless on GPU-less Linux CI** needs `--enable-unsafe-swiftshader`. CI runs at ~18 fps, which is fine:
  physics is tick-based.
