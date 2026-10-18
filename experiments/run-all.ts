// Experiment runner: `tsx experiments/run-all.ts --stage <exp01|exp02-pilot|exp02-confirm>`.
// Global context: `npm run experiments` chains the stages with the Python analysis (uv):
// exp01 -> exp02-pilot -> analysis/power.py (sample size) -> exp02-confirm -> analysis/analyze.py -> analysis/build_paper.py.
import { existsSync, readFileSync } from 'node:fs'; // Power-analysis output.
import { join } from 'node:path'; // Paths.
import { parseArgs } from 'node:util'; // CLI flags.
import { DATA_DIR, experimentLogger } from './common'; // Logging + data dir.
import { runExp01 } from './exp01-strafe-theory'; // Experiment 1.
import { QS, runExp02 } from './exp02-jump-timing'; // Experiment 2.

const { values } = parseArgs({ options: { stage: { type: 'string' } } }); // Which stage.
const log = experimentLogger('experiments'); // Terminal + logs/experiments_*.log.
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i); // Seed lists.

if (values.stage === 'exp01') runExp01(log); // Deterministic experiment.
else if (values.stage === 'exp02-pilot') runExp02('pilot', Object.fromEntries(QS.map((q) => [String(q), range(1000, 10)])), log); // Pilot seeds 1000-1009.
else if (values.stage === 'exp02-confirm') {
  const powerFile = join(DATA_DIR, 'exp02_power.json'); // Written by analysis/power.py.
  if (!existsSync(powerFile)) throw new Error('run analysis/power.py first'); // Stage order matters.
  const power = JSON.parse(readFileSync(powerFile, 'utf8')) as { n: Record<string, number> }; // n per q.
  log.info('exp02 confirmatory sample sizes', power.n); // From the power analysis.
  runExp02('confirm', Object.fromEntries(QS.map((q) => [String(q), range(0, power.n[String(q)])])), log); // Seeds 0..n-1.
} else throw new Error('usage: --stage exp01 | exp02-pilot | exp02-confirm');
log.info('stage finished', { stage: values.stage });
