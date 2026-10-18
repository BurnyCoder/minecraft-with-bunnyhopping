# BhopCraft — a browser Minecraft clone with Counter-Strike: Source bunnyhopping

BhopCraft is a Minecraft-style voxel game that runs in the browser (TypeScript + Three.js). Its player movement is a
port of the Counter-Strike: Source movement code, so bunnyhopping and air-strafing work the way they do in CS:S.

> **Status:** project scaffold (config, logging, tooling). Movement, world and rendering are being added in steps;
> this README is updated with each one.

## Install and run

Requirements: Node.js ≥ 20.19 (tested with 24.13) and npm. For the analysis/report scripts: [uv](https://docs.astral.sh/uv/).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

Then open <http://localhost:5173>. Browser log lines are written to `logs/game_<session>.log` and echoed in the terminal.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload and the log-file endpoint |
| `npm test` | Unit tests (Vitest, Node) |
| `npm run typecheck` | TypeScript type check |
| `npm run build` | Type check + static production build into `dist/` |

## Configuration

All settings are optional `VITE_*` keys in `.env` (template: [.env.example](.env.example)). Invalid values fall back to
defaults and are logged as warnings. URL parameters override `.env`: `?preset=`, `?seed=`, `?rd=` (render distance),
`?log=`, `?autoplay=<seconds>`.

## Technologies

TypeScript, [Three.js](https://threejs.org/), [Vite](https://vite.dev/), [Vitest](https://vitest.dev/),
[simplex-noise](https://github.com/jwagner/simplex-noise.js) + [alea](https://github.com/coverslide/node-alea),
Python + uv (analysis and report PDF only).

## License

MIT — see [LICENSE](LICENSE).
