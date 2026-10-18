"""Power analysis for Experiment 2 (pre-registered in reports/exp02_jump_timing.md).

Reads the pilot runs (reports/data/exp02_pilot.json, seeds 1000-1009 per q), estimates the across-seed standard
deviation s of the per-run mean retention, and sets the confirmatory sample size per q to
    n = ceil((t_{0.99375, 9} * s / 0.002)^2), clamped to [30, 200],
so that the Bonferroni-corrected (alpha = 0.05 / 4) t-interval half-width is about 0.002 or less.
Writes reports/data/exp02_power.json, which experiments/run-all.ts --stage exp02-confirm reads.
Global context: the second stage of `npm run experiments`; statistics use scipy.stats.t
(https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.t.html).
"""

import json  # Read/write data files.
import math  # ceil.
from pathlib import Path  # Paths.

import numpy as np  # Sample statistics.
from scipy import stats  # Student t quantiles.

from common import DATA, log  # Shared paths + logger.

TARGET_HALF_WIDTH = 0.002  # Pre-registered precision target (absolute retention units).
ALPHA = 0.05 / 4  # Bonferroni over the four q values.
N_MIN, N_MAX = 30, 200  # Pre-registered clamp.


def main() -> None:
    """Compute n per q from the pilot data and save it."""
    pilot = json.loads((DATA / "exp02_pilot.json").read_text(encoding="utf8"))  # Pilot results.
    result = {"alpha": ALPHA, "targetHalfWidth": TARGET_HALF_WIDTH, "n": {}, "pilotSd": {}, "tQuantile": {}}
    for q in sorted({run["q"] for run in pilot["runs"]}):  # Each pulse probability.
        means = np.array([r["meanRetention"] for r in pilot["runs"] if r["q"] == q])  # Per-run means.
        s = float(np.std(means, ddof=1))  # Sample SD (n - 1 denominator).
        t = float(stats.t.ppf(1 - ALPHA / 2, df=len(means) - 1))  # Two-sided corrected quantile, df = 9.
        n = min(N_MAX, max(N_MIN, math.ceil((t * s / TARGET_HALF_WIDTH) ** 2)))  # Required runs, clamped.
        key = str(q).rstrip("0").rstrip(".") if "." in str(q) else str(q)  # Match JS String(q) ("0.5", "0.25").
        result["n"][key], result["pilotSd"][key], result["tQuantile"][key] = n, s, t
        log(f"q={q}: pilot sd={s:.5f}, t={t:.4f} -> n={n}")
    (DATA / "exp02_power.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf8")  # Save.


if __name__ == "__main__":
    main()
