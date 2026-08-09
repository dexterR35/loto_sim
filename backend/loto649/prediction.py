"""Baseline strategies, calibrated ensemble ranking, explanations, and tickets."""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Mapping, Sequence

import numpy as np

from .config import Loto649Config
from .features import TemporalFeatureFrame
from .statistics import NUMBER_PROBABILITY, POOL


@dataclass(frozen=True)
class StrategyOutput:
    name: str
    ranking_scores: np.ndarray
    probabilities: np.ndarray


def normalize_scores(values: Sequence[float]) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if array.shape != (POOL,):
        raise ValueError("Every strategy must produce exactly 49 scores")
    if not np.all(np.isfinite(array)):
        raise ValueError("Strategy scores must be finite")
    lower, upper = float(array.min()), float(array.max())
    if math.isclose(lower, upper):
        return np.full(POOL, 0.5, dtype=float)
    return (array - lower) / (upper - lower)


def calibrate_sum_to_six(values: Sequence[float]) -> np.ndarray:
    """Convert positive ranking weights to bounded marginals summing to six."""
    array = np.asarray(values, dtype=float)
    if array.shape != (POOL,):
        raise ValueError("Probability calibration requires 49 values")
    array = np.maximum(array, 1e-9)
    probabilities = array / array.sum() * 6.0
    # Water-fill any values over one while preserving the exact expected draw size.
    for _ in range(POOL):
        over = probabilities > 0.999
        if not np.any(over):
            break
        overflow = float(np.sum(probabilities[over] - 0.999))
        probabilities[over] = 0.999
        under = ~over
        if not np.any(under):
            break
        weights = probabilities[under]
        probabilities[under] += overflow * weights / max(1e-12, float(weights.sum()))
    return probabilities


def baseline_outputs(frame: TemporalFeatureFrame, seed: int, salt: str = "") -> dict[str, StrategyOutput]:
    rows = frame.rows
    rng = np.random.default_rng(int(hashlib.sha256(f"{seed}:{salt}".encode()).hexdigest()[:16], 16))
    full = np.asarray([row["freq_full"] for row in rows], dtype=float)
    recent = np.asarray([row["freq_50"] for row in rows], dtype=float)
    hot = np.asarray([row["hot_score"] for row in rows], dtype=float)
    cold = np.asarray([row["cold_score"] for row in rows], dtype=float)
    overdue = np.asarray([row["gap_percentile"] for row in rows], dtype=float)
    trend = np.asarray([row["trend_score"] for row in rows], dtype=float)
    pair = np.asarray([row["pair_recent_strength"] for row in rows], dtype=float)
    ewma = np.asarray([row["ewma_frequency"] for row in rows], dtype=float)
    statistics = 0.25 * normalize_scores(full) + 0.30 * normalize_scores(recent) + 0.20 * normalize_scores(trend) + 0.15 * normalize_scores(pair) + 0.10 * normalize_scores(ewma)
    balanced = 0.30 * normalize_scores(recent) + 0.22 * normalize_scores(full) + 0.18 * normalize_scores(overdue) + 0.16 * normalize_scores(pair) + 0.14 * normalize_scores(trend)
    monte_carlo = np.maximum(1e-6, balanced + rng.normal(0, 0.015, POOL))
    ablation_frequency_gap = 0.72 * normalize_scores(full) + 0.28 * normalize_scores(overdue)
    ablation_frequency_gap_pair = 0.58 * normalize_scores(full) + 0.22 * normalize_scores(overdue) + 0.20 * normalize_scores(pair)
    ablation_frequency_gap_pair_mc = 0.50 * normalize_scores(full) + 0.18 * normalize_scores(overdue) + 0.17 * normalize_scores(pair) + 0.15 * normalize_scores(monte_carlo)
    ablation_frequency_gap_pair_mc_drift = 0.43 * normalize_scores(full) + 0.16 * normalize_scores(overdue) + 0.16 * normalize_scores(pair) + 0.13 * normalize_scores(monte_carlo) + 0.12 * normalize_scores(trend)
    uniform_ranking = rng.random(POOL)
    raw: dict[str, np.ndarray] = {
        "random_uniform": uniform_ranking,
        "frequency_only": full,
        "recent_frequency": recent,
        "hot": hot,
        "cold": cold,
        "overdue": overdue,
        "balanced": balanced,
        "monte_carlo": monte_carlo,
        "statistics": statistics,
        "ablation_frequency_gap": ablation_frequency_gap,
        "ablation_frequency_gap_pair": ablation_frequency_gap_pair,
        "ablation_frequency_gap_pair_mc": ablation_frequency_gap_pair_mc,
        "ablation_frequency_gap_pair_mc_drift": ablation_frequency_gap_pair_mc_drift,
    }
    outputs = {}
    for name, scores in raw.items():
        normalized = normalize_scores(scores)
        probabilities = (
            np.full(POOL, NUMBER_PROBABILITY, dtype=float)
            if name == "random_uniform"
            else calibrate_sum_to_six(normalized + 0.05)
        )
        outputs[name] = StrategyOutput(name=name, ranking_scores=normalized, probabilities=probabilities)
    return outputs


def _weighted_sample_without_replacement(probabilities: Sequence[float], count: int, rng: random.Random) -> list[int]:
    available = list(range(1, POOL + 1))
    selected = []
    weights = {number: max(float(probabilities[number - 1]), 1e-9) for number in available}
    for _ in range(count):
        total = sum(weights[number] for number in available)
        target = rng.random() * total
        upto = 0.0
        choice = available[-1]
        for number in available:
            upto += weights[number]
            if upto >= target:
                choice = number
                break
        selected.append(choice)
        available.remove(choice)
    return sorted(selected)


def generate_recommended_sets(probabilities: Sequence[float], seed: int) -> list[dict[str, Any]]:
    ranking = sorted(range(1, POOL + 1), key=lambda number: (-float(probabilities[number - 1]), number))
    rng = random.Random(seed)
    tickets: list[dict[str, Any]] = [{"strategy": "top_6", "numbers": sorted(ranking[:6])}]
    seen = {tuple(sorted(ranking[:6]))}
    for _ in range(3):
        numbers = _weighted_sample_without_replacement(probabilities, 6, rng)
        key = tuple(numbers)
        if key not in seen:
            seen.add(key)
            tickets.append({"strategy": "weighted_sampling", "numbers": numbers})
    attempts = 0
    while len(tickets) < 8 and attempts < 300:
        attempts += 1
        numbers = _weighted_sample_without_replacement(probabilities, 6, rng)
        key = tuple(numbers)
        if key in seen:
            continue
        maximum_overlap = max(len(set(numbers).intersection(ticket["numbers"])) for ticket in tickets)
        if maximum_overlap > 3:
            continue
        seen.add(key)
        tickets.append({"strategy": "diversified", "numbers": numbers, "maximum_prior_overlap": maximum_overlap})
    return tickets


def _factor_explanations(row: Mapping[str, Any], model_scores: Mapping[str, float]) -> tuple[list[str], list[str]]:
    positive = []
    negative = []
    if float(row["freq_50"]) > NUMBER_PROBABILITY:
        positive.append("recent frequency above its long-run uniform rate")
    else:
        negative.append("recent frequency below its long-run uniform rate")
    if float(row["trend_score"]) >= 0.6:
        positive.append("positive recent-versus-long trend")
    elif float(row["trend_score"]) <= 0.4:
        negative.append("weak recent-versus-long trend")
    if float(row["pair_recent_strength"]) >= 0.6:
        positive.append("recent pair co-occurrence strength")
    if float(row["gap_percentile"]) >= 0.8:
        positive.append("large historical gap (experimental feature, not a due rule)")
    values = list(model_scores.values())
    if len(values) >= 2 and np.std(values) <= 0.10:
        positive.append("ensemble ranking consensus")
    elif len(values) >= 2 and np.std(values) >= 0.25:
        negative.append("high model disagreement")
    if not positive:
        positive.append("no single dominant positive factor")
    if not negative:
        negative.append("historical signals remain weak and non-causal")
    return positive[:4], negative[:4]


def build_prediction_snapshot(
    frame: TemporalFeatureFrame,
    target_draw_date: date,
    config: Loto649Config,
    model_outputs: Mapping[str, Sequence[float]] | None = None,
    model_versions: Mapping[str, str] | None = None,
    ensemble_weights: Mapping[str, float] | None = None,
    model_feature_contributions: Mapping[str, Sequence[Sequence[Mapping[str, Any]]]] | None = None,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    seed = int(config.section("prediction")["seed"])
    baselines = baseline_outputs(frame, seed, target_draw_date.isoformat())
    available: dict[str, StrategyOutput] = {
        "statistics": baselines["statistics"],
        "monte_carlo": baselines["monte_carlo"],
    }
    for name, values in (model_outputs or {}).items():
        if name not in {"sklearn", "lstm", "pytorch"}:
            continue
        normalized = normalize_scores(values)
        available[name] = StrategyOutput(name, normalized, calibrate_sum_to_six(normalized + 0.05))
    source_weights = ensemble_weights or config.section("prediction")["weights"]
    configured_weights = {name: float(value) for name, value in source_weights.items()}
    active_weights = {name: configured_weights.get(name, 0.0) for name in available}
    total_weight = sum(active_weights.values())
    if total_weight <= 0:
        active_weights = {name: 1 / len(available) for name in available}
    else:
        active_weights = {name: value / total_weight for name, value in active_weights.items()}
    final_scores = sum(active_weights[name] * output.ranking_scores for name, output in available.items())
    final_probabilities = sum(active_weights[name] * output.probabilities for name, output in available.items())
    final_probabilities = calibrate_sum_to_six(final_probabilities)
    ordered_numbers = sorted(range(1, POOL + 1), key=lambda number: (-float(final_scores[number - 1]), number))
    rank_by_number = {number: rank for rank, number in enumerate(ordered_numbers, start=1)}
    per_number_disagreement = np.std(np.stack([output.ranking_scores for output in available.values()]), axis=0) if len(available) > 1 else np.full(POOL, 0.35)
    global_disagreement = float(np.mean(per_number_disagreement))
    disagreement_label = "high" if global_disagreement >= 0.22 else "medium" if global_disagreement >= 0.11 else "low"
    confidence_label = "low" if len(available) < 3 or global_disagreement >= 0.22 else "medium" if global_disagreement >= 0.10 else "high"
    ranking = []
    for number in ordered_numbers:
        index = number - 1
        row = frame.rows[index]
        scores = {name: round(float(output.ranking_scores[index]), 6) for name, output in available.items()}
        contributions = {name: round(active_weights[name] * float(output.ranking_scores[index]), 6) for name, output in available.items()}
        positive, negative = _factor_explanations(row, scores)
        stability = max(0.0, 1 - float(per_number_disagreement[index]) / 0.35)
        ranking.append({
            "rank": rank_by_number[number],
            "number": number,
            "final_score": round(float(final_scores[index]), 6),
            "modeled_probability": round(float(final_probabilities[index]), 8),
            "confidence": round(stability, 6),
            "confidence_label": "high" if stability >= 0.72 and len(available) >= 3 else "medium" if stability >= 0.45 else "low",
            "scores": scores,
            "blend_contributions": contributions,
            "model_feature_contributions": {
                name: list(values[index])
                for name, values in (model_feature_contributions or {}).items()
                if len(values) == POOL
            },
            "main_positive_factors": positive,
            "main_negative_factors": negative,
            "explanation_is_approximate": any(name in scores for name in {"lstm", "pytorch"}),
        })
    timestamp = (created_at or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    prediction_configuration = {
        "prediction": config.section("prediction"),
        "feature_version": config.feature_version,
        "active_weights": {name: round(value, 12) for name, value in sorted(active_weights.items())},
        "model_versions": {
            name: (model_versions or {}).get(name, "builtin")
            for name in sorted(available)
        },
    }
    config_fingerprint = hashlib.sha256(
        json.dumps(prediction_configuration, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    identity = "|".join([
        target_draw_date.isoformat(),
        frame.history_hash,
        config.prediction_version,
        config.feature_version,
        str(seed),
        config_fingerprint,
    ])
    prediction_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return {
        "prediction_id": prediction_id,
        "target_draw_date": target_draw_date.isoformat(),
        "target_date_is_scheduled": True,
        "created_at": timestamp.isoformat(),
        "history_end_date": frame.history_end_date.isoformat(),
        "model_version": config.prediction_version,
        "model_versions": {name: (model_versions or {}).get(name, "builtin") for name in available},
        "dataset_version": frame.history_hash,
        "feature_version": frame.feature_version,
        "config_fingerprint": config_fingerprint,
        "seed": seed,
        "active_weights": {name: round(value, 6) for name, value in active_weights.items()},
        "scores_1_49": [round(float(final_probabilities[number - 1]), 8) for number in range(1, POOL + 1)],
        "ranking_1_49": ordered_numbers,
        "ranking": ranking,
        "top_6": ordered_numbers[:6],
        "top_10": ordered_numbers[:10],
        "top_15": ordered_numbers[:15],
        "recommended_sets": generate_recommended_sets(final_probabilities, seed),
        "uncertainty": {
            "ensemble_disagreement": disagreement_label,
            "mean_model_score_std": round(global_disagreement, 8),
            "prediction_confidence": confidence_label,
            "meaning": "Confidence describes model stability/consensus, not the chance of winning.",
        },
        "config": {
            "feature_history_size": frame.history_size,
            "top_k": config.section("prediction")["top_k"],
            "prediction_configuration": prediction_configuration,
            "weight_source": "champion_temporal_tuning" if ensemble_weights else "configured_baseline",
        },
        "disclaimer": "Experimental statistical ranking only. Romanian Loto 6/49 draws are random and no score guarantees a future result.",
    }
