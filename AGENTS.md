# AGENTS.md — notes for coding agents working on BhopCraft

## Layout
- `src/main.ts` — the only top-level wrapper; it calls named phases in order. Add new startup work as a new phase
  module, not inline code.
- `src/config.ts` — the only place that reads `.env` (`import.meta.env`) and URL parameters.
- `src/logging/` — `logger.ts` (no DOM/Node imports), `httpSink.ts` (browser → `/__log`), `nodeFileSink.ts`
  (Node scripts), `setup.ts` (browser bootstrap).
- `server/logPlugin.ts` — Vite plugin for `POST /__log?session=<id>`; session ids are regex-validated (path safety).
- `tests/` mirrors `src/` and `server/`; Vitest runs in the Node environment.

## Conventions
- Log through `createLogger(module)`; never truncate messages; log events and 1 Hz summaries, not every tick.
- Comment each file, function and non-trivial line with local purpose + global context, and link sources.
- Tests first (TDD). Run `npm test` and `npm run typecheck` before committing.
- Never commit `.env`, `logs/` or credentials.

## Workflow
- One feature branch + PR per functional unit; merge with `gh pr merge --merge`.
