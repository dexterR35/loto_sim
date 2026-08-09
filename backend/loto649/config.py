"""Validated central configuration for the Loto 6/49 upgrade."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = ROOT / "config" / "loto649.json"


@dataclass(frozen=True)
class Loto649Config:
    raw: dict[str, Any]
    path: Path

    @property
    def pool(self) -> int:
        return int(self.raw["game"]["numbers"])

    @property
    def pick(self) -> int:
        return int(self.raw["game"]["draw_size"])

    @property
    def seed(self) -> int:
        return int(self.raw["statistics"]["random_seed"])

    @property
    def rolling_windows(self) -> tuple[int, ...]:
        return tuple(int(value) for value in self.raw["statistics"]["rolling_windows"])

    @property
    def feature_version(self) -> str:
        return str(self.raw["features"]["version"])

    @property
    def prediction_version(self) -> str:
        return str(self.raw["prediction"]["version"])

    def section(self, name: str) -> dict[str, Any]:
        value = self.raw.get(name)
        if not isinstance(value, dict):
            raise KeyError(f"Missing configuration section: {name}")
        return value


def _validate(raw: dict[str, Any]) -> None:
    required = {"game", "source", "statistics", "features", "ml", "training", "prediction", "backtest"}
    missing = sorted(required.difference(raw))
    if missing:
        raise ValueError(f"Missing Loto 6/49 configuration sections: {', '.join(missing)}")
    game = raw["game"]
    if int(game.get("numbers", 0)) != 49 or int(game.get("draw_size", 0)) != 6:
        raise ValueError("This upgrade is intentionally restricted to Loto 6/49")
    weekdays = [int(value) for value in game.get("draw_weekdays", [])]
    if not weekdays or len(set(weekdays)) != len(weekdays) or any(value < 0 or value > 6 for value in weekdays):
        raise ValueError("draw_weekdays must contain unique Python weekday values from 0 through 6")
    source = raw["source"]
    if not str(source.get("url", "")).startswith("https://"):
        raise ValueError("The official source URL must use HTTPS")
    if float(source.get("timeout_seconds", 0)) <= 0 or int(source.get("retries", -1)) < 0:
        raise ValueError("Source timeout must be positive and retries cannot be negative")
    statistics = raw["statistics"]
    alpha = float(statistics.get("alpha", 0))
    fdr_alpha = float(statistics.get("fdr_alpha", 0))
    if not 0 < alpha < 1 or not 0 < fdr_alpha < 1:
        raise ValueError("alpha and fdr_alpha must be between zero and one")
    windows = [int(value) for value in statistics.get("rolling_windows", [])]
    if not windows or windows != sorted(set(windows)) or any(value <= 0 for value in windows):
        raise ValueError("rolling_windows must contain unique positive values in ascending order")
    monte_carlo_runs = int(statistics.get("monte_carlo_runs", -1))
    monte_carlo_max = int(statistics.get("monte_carlo_max_runs", -1))
    if monte_carlo_runs < 0 or monte_carlo_max < monte_carlo_runs or monte_carlo_max > 10000:
        raise ValueError("Monte Carlo runs must satisfy 0 <= routine runs <= max runs <= 10000")
    ml = raw["ml"]
    if int(ml.get("training_draw_limit", 0)) <= 0 or int(ml.get("validation_draws", 0)) < 20:
        raise ValueError("ML training_draw_limit must be positive and validation_draws must be at least 20")
    lookbacks = [int(value) for value in ml.get("lstm_lookbacks", [])]
    if not lookbacks or any(value not in {10, 25, 50, 100} for value in lookbacks):
        raise ValueError("lstm_lookbacks must use the audited 10/25/50/100 windows")
    training = raw["training"]
    if int(training.get("minimum_new_draws_for_full_retrain", 0)) < 1:
        raise ValueError("minimum_new_draws_for_full_retrain must be at least one")
    for key in ("minimum_ndcg_improvement", "maximum_brier_degradation", "maximum_period_ndcg_regression"):
        if float(training.get(key, -1)) < 0:
            raise ValueError(f"{key} cannot be negative")
    empirical_p = float(training.get("maximum_random_empirical_p_value", 0))
    if not 0 < empirical_p <= 1:
        raise ValueError("maximum_random_empirical_p_value must be in (0, 1]")
    weights = raw["prediction"].get("weights", {})
    if not weights or any(float(value) < 0 for value in weights.values()) or sum(float(value) for value in weights.values()) <= 0:
        raise ValueError("prediction weights must contain at least one positive value")


def load_config(path: Path | str | None = None) -> Loto649Config:
    config_path = Path(path) if path else DEFAULT_CONFIG_PATH
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Loto 6/49 configuration must be a JSON object")
    _validate(raw)
    return Loto649Config(raw=raw, path=config_path)
