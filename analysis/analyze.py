"""Statistics, hypothesis checks and figures for Experiments 1 and 2.

Inputs: reports/data/exp01_results.json, exp02_pilot.json, exp02_power.json, exp02_confirm.json (written by the
TypeScript experiments). Outputs:
  - reports/data/results_summary.json : every number quoted in the reports and the paper,
  - reports/data/tables.md            : markdown tables (pasted into the reports),
  - reports/figures/*.png             : figures (matplotlib, 150 dpi).
Global context: stage 4 of `npm run experiments`. Hypotheses and thresholds follow the pre-registrations in
reports/exp01_strafe_theory.md and reports/exp02_jump_timing.md; anything else is labelled post-hoc.
APIs: scipy.stats.t (https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.t.html),
matplotlib pyplot (https://matplotlib.org/stable/api/pyplot_summary.html).
"""

import json  # Data files.

import matplotlib  # Plotting backend selection.

matplotlib.use("Agg")  # Headless rendering to PNG files.
import matplotlib.pyplot as plt  # noqa: E402  Plotting API.
import numpy as np  # noqa: E402  Numerics.
from scipy import stats  # noqa: E402  t quantiles.

from common import DATA, FIGURES, log  # noqa: E402  Paths + logger.

L = 30.0  # Air speed cap, u/s.
M = 250.0  # Strafe wish speed, u/s.
V0 = 250.0  # Start speed, u/s.


def gain(k: np.ndarray) -> np.ndarray:
    """Closed-form |v|^2 gain per tick, g(k) = L^2 if k >= L else k (2L - k) (jwchong eq. 6.6)."""
    return np.where(k >= L, L * L, k * (2 * L - k))


def expected_retention(q: np.ndarray, r: float) -> np.ndarray:
    """Pre-registered Markov-chain prediction E[r^K] for pulse probability q and per-ground-tick factor r."""
    f0 = q / (1 - (1 - q) * r)  # Previous tick had no pulse.
    f1 = (1 - q) * r * f0 / (1 - q * r)  # Previous tick had a pulse.
    return (1 - q) * f0 + q * f1


def t_interval(x: np.ndarray, confidence: float) -> tuple[float, float, float]:
    """Mean and two-sided t confidence interval (lo, hi) of sample x."""
    mean = float(np.mean(x))  # Sample mean.
    half = float(stats.t.ppf(0.5 + confidence / 2, df=len(x) - 1) * np.std(x, ddof=1) / np.sqrt(len(x)))  # Half-width.
    return mean, mean - half, mean + half


def exp01(summary: dict, tables: list[str]) -> None:
    """Experiment 1: closed-form grid (H1), interventions, exploratory sweep; figures 1-4."""
    d = json.loads((DATA / "exp01_results.json").read_text(encoding="utf8"))  # Results.
    grid = d["grid"]  # 16 conditions.
    worst = max(row["maxRelError"] for row in grid)  # H1 statistic.
    summary["exp01"] = {"maxRelErrorAll": worst, "h1Pass": worst < 1e-9, "h1Falsified": worst > 1e-6, "deterministic": d["deterministic"]}
    log(f"exp01 H1: worst max relative error {worst:.3e} (pass < 1e-9: {worst < 1e-9})")
    tables.append("### Experiment 1 — closed-form grid (T = 10 s, start 250 u/s)\n")
    tables.append("| tick rate | sv_airaccelerate | k/L | g (u²/s² per tick) | air ticks | final speed (u/s) | predicted (u/s) | max rel. error |")
    tables.append("|---|---|---|---|---|---|---|---|")
    for row in grid:
        predicted = np.sqrt(V0**2 + row["airTicks"] * row["gainPerTick"])  # Closed form at the end.
        tables.append(f"| {row['tickRate']:.2f} | {row['airaccel']} | {row['kOverL']:.3f} | {row['gainPerTick']:.2f} | {row['airTicks']} | {row['finalSpeed']:.3f} | {predicted:.3f} | {row['maxRelError']:.1e} |")
    iv = d["interventions"]  # Interventions.
    summary["exp01"]["interventions"] = {k: {kk: vv for kk, vv in v.items() if kk != "trace"} for k, v in iv.items()}

    FIGURES.mkdir(parents=True, exist_ok=True)  # Output folder.
    # Figure 1: speed vs time, measured (markers) vs closed form (lines), A = 1000 at four tick rates + A = 1 at 100 tick.
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    for row in [r for r in grid if r["airaccel"] == 1000] + [r for r in grid if r["airaccel"] == 1 and r["tickRate"] == 100]:
        step = round(0.1 / row["tau"])  # Trace sampling stride (ticks).
        n = np.arange(len(row["trace"])) * step  # Tick index of each sample.
        t = n * row["tau"]  # Seconds.
        label = f"{row['tickRate']:.0f} tick, aa {row['airaccel']}"
        line = ax.plot(t, np.sqrt(V0**2 + n * row["gainPerTick"]), lw=1)[0]  # Theory.
        ax.plot(t[::5], np.array(row["trace"])[::5], "o", ms=3, color=line.get_color(), label=label)  # Measured.
    ax.set_xlabel("time in the air (s)")
    ax.set_ylabel("horizontal speed (u/s)")
    ax.set_ylim(0, None)
    ax.set_title("Optimal strafing: measured (dots) vs closed form (lines)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES / "fig1_speed_vs_time.png", dpi=150)
    plt.close(fig)

    # Figure 2: measured gain per tick vs k/L, against g(k)/L^2.
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    kl = np.logspace(-2.5, 2.6, 400)  # k/L range.
    ax.plot(kl, gain(kl * L) / L**2, color="black", lw=1, label="theory g(k)/L²")
    measured = [((r["finalSpeed"] ** 2 - V0**2) / r["airTicks"]) / L**2 for r in grid]  # Empirical gain per tick.
    ax.scatter([r["kOverL"] for r in grid], measured, s=18, color="tab:red", zorder=3, label="measured (16 conditions)")
    ax.set_xscale("log")
    ax.set_xlabel("k / L  (k = τ·M·A, L = 30 u/s)")
    ax.set_ylabel("|v|² gain per tick / L²")
    ax.set_ylim(0, 1.1)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES / "fig2_gain_vs_k.png", dpi=150)
    plt.close(fig)

    # Figure 3: interventions at 100 tick, aa 1000 (left), and the no-cap run vs its closed form (right).
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(9.6, 3.8))
    t = np.arange(len(iv["perfect"]["trace"])) * 0.1  # Traces are sampled every 10 ticks = 0.1 s.
    for key, label in [("perfect", "perfect bhop"), ("lateJump", "jump 1 tick late"), ("bhopClamp", "110% clamp (vanilla)"), ("noStrafe", "no strafing (W only)")]:
        a1.plot(t, iv[key]["trace"], label=label, lw=1.2)
    a1.set_xlabel("time (s)")
    a1.set_ylabel("horizontal speed (u/s)")
    a1.set_ylim(0, None)
    a1.set_title("Interventions (100 tick, aa 1000)")
    a1.legend(fontsize=8)
    nc = np.array(iv["noAirCap"]["trace"])  # No-cap trace.
    tn = np.arange(len(nc)) * 0.1
    t_clamp = iv["noAirCap"]["ticksToClamp"] * 0.01  # First tick where one velocity axis hits sv_maxvelocity.
    a2.plot(tn, nc, label="measured", lw=1.2)
    tt = np.linspace(0, t_clamp, 200)  # Theory only where no clamp acts.
    a2.plot(tt, 250 * np.sqrt(1 + tt * 100), "--", color="black", lw=1, label="theory 250·√(n+1) (L = min(cap, 250))")
    a2.axhline(3500, color="grey", lw=0.8, ls=":", label="sv_maxvelocity 3500 (per axis)")
    a2.axvline(t_clamp, color="grey", lw=0.8, ls="--")
    a2.set_xlabel("time (s)")
    a2.set_ylabel("horizontal speed (u/s)")
    a2.set_ylim(0, None)
    a2.set_title("30 u/s cap removed (post-hoc)")
    a2.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES / "fig3_interventions.png", dpi=150)
    plt.close(fig)

    # Figure 4: exploratory fixed turn rate.
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    styles = {10: ("o-", "sv_airaccelerate 10"), 100: ("s--", "sv_airaccelerate 100"), 1000: ("x:", "sv_airaccelerate 1000 (identical to 100)")}  # Distinct styles: 100 and 1000 overlap exactly.
    for A in sorted({r["airaccel"] for r in d["fixedTurn"]}):
        rows = [r for r in d["fixedTurn"] if r["airaccel"] == A]
        fmt, label = styles[A]
        ax.plot([r["omega"] for r in rows], [r["finalSpeed"] for r in rows], fmt, ms=5, label=label)
    ax.axhline(250, color="grey", lw=0.8, ls=":")
    ax.set_xlabel("constant turn rate ω (°/s)")
    ax.set_ylabel("speed after 10 s (u/s)")
    ax.set_ylim(0, None)
    ax.set_title("Exploratory: human-like constant turning (100 tick)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES / "fig4_fixed_turn.png", dpi=150)
    plt.close(fig)
    summary["exp01"]["fixedTurn"] = d["fixedTurn"]


def exp02(summary: dict, tables: list[str]) -> None:
    """Experiment 2: retention vs q with corrected CIs (H2), final speeds; figure 5."""
    d = json.loads((DATA / "exp02_confirm.json").read_text(encoding="utf8"))  # Confirmatory runs.
    power = json.loads((DATA / "exp02_power.json").read_text(encoding="utf8"))  # Sample sizes.
    cv = d["cvars"]  # Experiment cvars.
    r = 1 - cv["sv_friction"] * cv["tick_interval"]  # Per-ground-tick factor (0.94).
    rows = []
    for q in sorted({run["q"] for run in d["runs"]}):
        x = np.array([run["meanRetention"] for run in d["runs"] if run["q"] == q])  # Per-run means.
        speeds = np.array([run["finalSpeed"] for run in d["runs"] if run["q"] == q])  # Final speeds.
        pred = float(expected_retention(np.array(q), r))  # Prediction.
        mean, lo95, hi95 = t_interval(x, 0.95)  # 95% CI.
        _, lo_b, hi_b = t_interval(x, 1 - 0.05 / 4)  # Bonferroni-corrected CI.
        s_mean, s_lo, s_hi = t_interval(speeds, 0.95)  # Final speed CI.
        rows.append({"q": q, "n": len(x), "pred": pred, "mean": mean, "ci95": [lo95, hi95], "ciBonf": [lo_b, hi_b], "contains": lo_b <= pred <= hi_b,
                     "sd": float(np.std(x, ddof=1)), "finalSpeed": s_mean, "finalSpeedCi95": [s_lo, s_hi], "landingsPerRun": float(np.mean([run["landings"] for run in d["runs"] if run["q"] == q]))})
        log(f"exp02 q={q}: mean {mean:.4f} [{lo_b:.4f}, {hi_b:.4f}] (Bonferroni), predicted {pred:.4f}, contains={lo_b <= pred <= hi_b}")
    summary["exp02"] = {"r": r, "rows": rows, "h2Falsified": not all(row["contains"] for row in rows), "autobhopFinalSpeed": d["autobhopFinalSpeed"], "power": power}
    tables.append("\n### Experiment 2 — per-landing retention vs pulse probability q (60 s runs)\n")
    tables.append("| q | runs | predicted E[r^K] | measured mean | 95% CI | 98.75% CI (Bonferroni) | contains prediction | final speed (u/s), mean [95% CI] |")
    tables.append("|---|---|---|---|---|---|---|---|")
    for row in rows:
        tables.append(f"| {row['q']} | {row['n']} | {row['pred']:.4f} | {row['mean']:.4f} | [{row['ci95'][0]:.4f}, {row['ci95'][1]:.4f}] | [{row['ciBonf'][0]:.4f}, {row['ciBonf'][1]:.4f}] | {'yes' if row['contains'] else '**no**'} | {row['finalSpeed']:.1f} [{row['finalSpeedCi95'][0]:.1f}, {row['finalSpeedCi95'][1]:.1f}] |")
    tables.append(f"\nAuto-bhop baseline (perfect timing, same cvars): final speed {d['autobhopFinalSpeed']:.1f} u/s.")

    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    qq = np.linspace(0.01, 0.99, 300)  # Theory curve domain.
    ax.plot(qq, expected_retention(qq, r), color="black", lw=1, label="pre-registered prediction E[r^K]")
    ax.errorbar([row["q"] for row in rows], [row["mean"] for row in rows],
                yerr=[[row["mean"] - row["ciBonf"][0] for row in rows], [row["ciBonf"][1] - row["mean"] for row in rows]],
                fmt="o", ms=4, capsize=3, color="tab:red", label="measured mean, 98.75% CI (n = 200 runs each)")
    ax.set_xlabel("jump pulse probability per tick, q")
    ax.set_ylabel("speed retained per landing")
    ax.set_ylim(0, 1)
    ax.set_title("Scroll-wheel timing vs Source anti-pogo (66.67 tick)")
    ax.legend(fontsize=8, loc="lower center")
    fig.tight_layout()
    fig.savefig(FIGURES / "fig5_jump_timing.png", dpi=150)
    plt.close(fig)


def main() -> None:
    """Run both analyses and write the summary, tables and figures."""
    summary: dict = {}
    tables: list[str] = []
    exp01(summary, tables)
    exp02(summary, tables)
    (DATA / "results_summary.json").write_text(json.dumps(summary, indent=1) + "\n", encoding="utf8")  # All numbers.
    (DATA / "tables.md").write_text("\n".join(tables) + "\n", encoding="utf8")  # Markdown tables.
    log("wrote reports/data/results_summary.json, reports/data/tables.md and reports/figures/*.png")


if __name__ == "__main__":
    main()
