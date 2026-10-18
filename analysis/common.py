"""Shared paths and logging for the analysis scripts (power.py, analyze.py, build_paper.py).

Global context: the TypeScript experiments write JSON into reports/data/; these Python scripts (run with uv) read it,
compute statistics and figures, and build the PDF paper. Logging goes to the terminal and to
logs/analysis_<timestamp>.log with timestamps, matching the project-wide logging convention.
"""

import logging  # Standard library logging: https://docs.python.org/3/library/logging.html
import time  # Timestamp for the log file name.
from pathlib import Path  # Paths.

ROOT = Path(__file__).resolve().parent.parent  # Repository root.
DATA = ROOT / "reports" / "data"  # Experiment outputs.
FIGURES = ROOT / "reports" / "figures"  # Generated figures.
LOGS = ROOT / "logs"  # Log folder (gitignored).

LOGS.mkdir(exist_ok=True)  # Ensure logs/ exists.
_logger = logging.getLogger("analysis")  # One logger for all scripts.
if not _logger.handlers:  # Configure once per process.
    _formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] [analysis] %(message)s")  # Same layout as the TS logger.
    for handler in (logging.StreamHandler(), logging.FileHandler(LOGS / f"analysis_{time.strftime('%Y%m%d_%H%M%S')}.log", encoding="utf8")):
        handler.setFormatter(_formatter)  # Timestamped lines.
        _logger.addHandler(handler)  # Terminal + file.
    _logger.setLevel(logging.INFO)  # Info and above.


def log(message: str) -> None:
    """Log one info line (never truncated)."""
    _logger.info(message)
