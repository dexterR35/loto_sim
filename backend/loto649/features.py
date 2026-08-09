"""Temporal feature construction with an explicit no-future-data contract."""

from __future__ import annotations

import itertools
import math
from collections import Counter
from dataclasses import dataclass
from datetime import date
from statistics import mean
from typing import Any, Sequence

import numpy as np

from .config import Loto649Config
from .domain import Draw, dataset_hash
from .statistics import NUMBER_PROBABILITY, PAIR_PROBABILITY, POOL, percentile_rank


FEATURE_NAMES = (
    "number_norm",
    "freq_full",
    "freq_10",
    "freq_25",
    "freq_50",
    "freq_100",
    "freq_250",
    "freq_500",
    "gap_current",
    "gap_norm",
    "gap_mean",
    "gap_percentile",
    "hot_score",
    "cold_score",
    "trend_score",
    "pair_strength",
    "pair_recent_strength",
    "chi_contribution_history",
    "drift_score",
    "ewma_frequency",
    "draw_count_history",
    "rolling_entropy",
    "frequency_dispersion",
    "pair_dispersion",
    "recent_vs_long_term_divergence",
)


@dataclass(frozen=True)
class TemporalFeatureFrame:
    target_date: date | None
    history_end_date: date
    history_size: int
    history_hash: str
    feature_version: str
    rows: tuple[dict[str, Any], ...]

    def matrix(self) -> np.ndarray:
        return np.asarray([[float(row[name]) for name in FEATURE_NAMES] for row in self.rows], dtype=np.float64)


def _normalized(values: Sequence[float]) -> list[float]:
    if not values:
        return []
    lower, upper = min(values), max(values)
    if math.isclose(lower, upper):
        return [0.5] * len(values)
    return [(value - lower) / (upper - lower) for value in values]


def _entropy(counts: Sequence[int]) -> float:
    total = sum(counts)
    if total <= 0:
        return 0.0
    probabilities = np.asarray(counts, dtype=float) / total
    return float(-np.sum(probabilities * np.log2(probabilities + 1e-15)) / math.log2(POOL))


def _js_from_rates(left: Sequence[float], right: Sequence[float]) -> float:
    p = np.asarray(left, dtype=float) + 1e-12
    q = np.asarray(right, dtype=float) + 1e-12
    p /= p.sum()
    q /= q.sum()
    midpoint = 0.5 * (p + q)
    return float(0.5 * np.sum(p * np.log2(p / midpoint)) + 0.5 * np.sum(q * np.log2(q / midpoint)))


class FeatureBuilder:
    def __init__(self, config: Loto649Config) -> None:
        self.config = config

    def build_for_target(self, draws: Sequence[Draw], target_index: int) -> TemporalFeatureFrame:
        if target_index <= 0 or target_index >= len(draws):
            raise ValueError("target_index must point to a draw with at least one preceding draw")
        ordered = sorted(draws, key=lambda item: item.draw_date)
        target = ordered[target_index]
        history = ordered[:target_index]
        if history[-1].draw_date > target.draw_date:
            raise AssertionError("Feature history must end before the target draw")
        return self.build_for_next(history, target_date=target.draw_date)

    def build_for_next(self, history: Sequence[Draw], target_date: date | None = None) -> TemporalFeatureFrame:
        ordered = sorted(history, key=lambda item: item.draw_date)
        if not ordered:
            raise ValueError("At least one historical draw is required to build features")
        if target_date is not None and ordered[-1].draw_date >= target_date:
            raise AssertionError("No target or future draw may be included in its feature history")
        draw_count = len(ordered)
        counts = Counter(number for draw in ordered for number in draw.numbers)
        positions = {number: [] for number in range(1, POOL + 1)}
        pair_counts: Counter[tuple[int, int]] = Counter()
        recent_pair_counts: Counter[tuple[int, int]] = Counter()
        for index, draw in enumerate(ordered):
            for number in draw.numbers:
                positions[number].append(index)
            for pair in itertools.combinations(sorted(draw.numbers), 2):
                pair_counts[pair] += 1
                if index >= max(0, draw_count - 100):
                    recent_pair_counts[pair] += 1
        full_rates = [counts[number] / draw_count for number in range(1, POOL + 1)]
        recent = ordered[-50:]
        recent_counts = Counter(number for draw in recent for number in draw.numbers)
        recent_rates = [recent_counts[number] / max(1, len(recent)) for number in range(1, POOL + 1)]
        rolling_entropy = _entropy([recent_counts[number] for number in range(1, POOL + 1)])
        frequency_dispersion = float(np.std(full_rates) / NUMBER_PROBABILITY)
        pair_values = list(pair_counts.values())
        pair_dispersion = float(np.std(pair_values) / max(1e-12, mean(pair_values))) if pair_values else 0.0
        recent_divergence = _js_from_rates(recent_rates, full_rates)
        gap_values = []
        raw_hot = []
        raw_trend = []
        raw_pair = []
        raw_pair_recent = []
        last_numbers = set(ordered[-1].numbers)
        expected_pair = draw_count * PAIR_PROBABILITY
        recent_pair_expected = len(ordered[-100:]) * PAIR_PROBABILITY
        for number in range(1, POOL + 1):
            indexes = positions[number]
            current_gap = draw_count - 1 - indexes[-1] if indexes else draw_count
            gap_values.append(float(current_gap))
            rate_50 = recent_counts[number] / max(1, len(recent))
            raw_hot.append(rate_50)
            raw_trend.append(rate_50 - full_rates[number - 1])
            mates = [mate for mate in last_numbers if mate != number]
            raw_pair.append(
                mean(pair_counts[tuple(sorted((number, mate)))] / max(expected_pair, 1e-12) for mate in mates)
                if mates else 1.0
            )
            raw_pair_recent.append(
                mean(recent_pair_counts[tuple(sorted((number, mate)))] / max(recent_pair_expected, 1e-12) for mate in mates)
                if mates else 1.0
            )
        hot_scores = _normalized(raw_hot)
        trend_scores = _normalized(raw_trend)
        pair_scores = _normalized(raw_pair)
        pair_recent_scores = _normalized(raw_pair_recent)
        gap_scores = _normalized(gap_values)
        expected = draw_count * NUMBER_PROBABILITY
        alpha = 2 / (int(self.config.section("features").get("ewma_span", 25)) + 1)
        rows = []
        for number in range(1, POOL + 1):
            indexes = positions[number]
            intervals = [right - left - 1 for left, right in zip(indexes, indexes[1:])]
            current_gap = int(gap_values[number - 1])
            ewma = NUMBER_PROBABILITY
            for draw in ordered:
                ewma = alpha * (1.0 if number in draw.numbers else 0.0) + (1 - alpha) * ewma

            def frequency(window: int) -> float:
                subset = ordered[-window:]
                return sum(number in draw.numbers for draw in subset) / max(1, len(subset))

            full_rate = full_rates[number - 1]
            rows.append({
                "number": number,
                "number_norm": number / POOL,
                "freq_full": full_rate,
                "freq_10": frequency(10),
                "freq_25": frequency(25),
                "freq_50": frequency(50),
                "freq_100": frequency(100),
                "freq_250": frequency(250),
                "freq_500": frequency(500),
                "gap_current": current_gap,
                "gap_norm": current_gap / max(1, draw_count),
                "gap_mean": mean(intervals) if intervals else current_gap,
                "gap_percentile": percentile_rank(intervals, current_gap),
                "hot_score": hot_scores[number - 1],
                "cold_score": 1 - hot_scores[number - 1],
                "trend_score": trend_scores[number - 1],
                "pair_strength": pair_scores[number - 1],
                "pair_recent_strength": pair_recent_scores[number - 1],
                "chi_contribution_history": (counts[number] - expected) ** 2 / max(expected, 1e-12),
                "drift_score": abs(raw_trend[number - 1]) / NUMBER_PROBABILITY,
                "ewma_frequency": ewma,
                "draw_count_history": draw_count,
                "rolling_entropy": rolling_entropy,
                "frequency_dispersion": frequency_dispersion,
                "pair_dispersion": pair_dispersion,
                "recent_vs_long_term_divergence": recent_divergence,
                "history_end_date": ordered[-1].draw_date.isoformat(),
                "target_date": target_date.isoformat() if target_date else None,
            })
        return TemporalFeatureFrame(
            target_date=target_date,
            history_end_date=ordered[-1].draw_date,
            history_size=draw_count,
            history_hash=dataset_hash(ordered),
            feature_version=self.config.feature_version,
            rows=tuple(rows),
        )

    def training_dataset(
        self,
        draws: Sequence[Draw],
        minimum_history: int | None = None,
        maximum_targets: int | None = None,
    ) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
        ordered = sorted(draws, key=lambda item: item.draw_date)
        minimum = int(minimum_history or self.config.section("features")["minimum_history"])
        start = max(1, minimum)
        if maximum_targets is not None:
            start = max(start, len(ordered) - int(maximum_targets))
        matrices = []
        labels = []
        metadata = []
        for target_index in range(start, len(ordered)):
            if ordered[target_index - 1].draw_date >= ordered[target_index].draw_date:
                # Same-day special draws have no verifiable publication order, so skip them as ML targets.
                continue
            frame = self.build_for_target(ordered, target_index)
            target_numbers = set(ordered[target_index].numbers)
            matrices.append(frame.matrix())
            labels.append(np.asarray([1 if number in target_numbers else 0 for number in range(1, POOL + 1)], dtype=np.int8))
            metadata.extend({
                "number": number,
                "target_index": target_index,
                "target_date": ordered[target_index].draw_date.isoformat(),
                "history_end_date": frame.history_end_date.isoformat(),
                "history_size": frame.history_size,
            } for number in range(1, POOL + 1))
        if not matrices:
            raise ValueError(f"Not enough draws for temporal training (need more than {minimum})")
        x = np.concatenate(matrices, axis=0)
        y = np.concatenate(labels, axis=0)
        audit_temporal_metadata(metadata)
        return x, y, metadata


def audit_temporal_metadata(metadata: Sequence[dict[str, Any]]) -> None:
    if not metadata:
        raise AssertionError("Temporal dataset metadata is required for leakage auditing")
    for row in metadata:
        history_end = date.fromisoformat(str(row["history_end_date"]))
        target = date.fromisoformat(str(row["target_date"]))
        if history_end >= target:
            raise AssertionError(
                f"Data leakage: history ends {history_end.isoformat()} for target {target.isoformat()}"
            )
