"""Ranking/probability metrics and draw-by-draw expanding-window backtests."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import mean, pstdev
from typing import Any, Sequence

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .config import Loto649Config
from .domain import Draw, dataset_hash
from .features import FeatureBuilder
from .prediction import StrategyOutput, baseline_outputs, calibrate_sum_to_six, normalize_scores
from .statistics import NUMBER_PROBABILITY, POOL


def _ndcg(ranking: Sequence[int], actual: set[int], k: int) -> float:
    gains = [1.0 if number in actual else 0.0 for number in ranking[:k]]
    dcg = sum(gain / math.log2(index + 2) for index, gain in enumerate(gains))
    ideal = sum(1.0 / math.log2(index + 2) for index in range(min(k, len(actual))))
    return dcg / ideal if ideal else 0.0


def _calibration_error(probabilities: np.ndarray, targets: np.ndarray, bins: int = 10) -> tuple[float, list[dict[str, Any]]]:
    edges = np.linspace(0, 1, bins + 1)
    error = 0.0
    curve = []
    for index in range(bins):
        if index == bins - 1:
            mask = (probabilities >= edges[index]) & (probabilities <= edges[index + 1])
        else:
            mask = (probabilities >= edges[index]) & (probabilities < edges[index + 1])
        count = int(np.count_nonzero(mask))
        if count == 0:
            continue
        confidence = float(np.mean(probabilities[mask]))
        observed = float(np.mean(targets[mask]))
        error += count / len(probabilities) * abs(confidence - observed)
        curve.append({
            "bin_lower": round(float(edges[index]), 4),
            "bin_upper": round(float(edges[index + 1]), 4),
            "count": count,
            "mean_probability": round(confidence, 8),
            "observed_rate": round(observed, 8),
        })
    return error, curve


def evaluate_prediction(
    ranking_scores: Sequence[float],
    actual_numbers: Sequence[int],
    probabilities: Sequence[float] | None = None,
) -> dict[str, Any]:
    normalized = normalize_scores(ranking_scores)
    probs = calibrate_sum_to_six(normalized + 0.05) if probabilities is None else np.asarray(probabilities, dtype=float)
    if probs.shape != (POOL,):
        raise ValueError("Prediction evaluation requires exactly 49 probabilities")
    actual = {int(number) for number in actual_numbers}
    if len(actual) != 6 or any(number < 1 or number > 49 for number in actual):
        raise ValueError("Evaluation target must contain exactly six unique numbers from 1..49")
    ranking = sorted(range(1, POOL + 1), key=lambda number: (-float(normalized[number - 1]), number))
    rank_by_number = {number: rank for rank, number in enumerate(ranking, start=1)}
    hits_6 = len(set(ranking[:6]).intersection(actual))
    hits_10 = len(set(ranking[:10]).intersection(actual))
    target = np.asarray([1.0 if number in actual else 0.0 for number in range(1, POOL + 1)])
    clipped = np.clip(probs, 1e-9, 1 - 1e-9)
    ece, curve = _calibration_error(probs, target)
    actual_ranks = sorted(rank_by_number[number] for number in actual)
    return {
        "hits_at_6": hits_6,
        "precision_at_6": round(hits_6 / 6, 8),
        "recall_at_6": round(hits_6 / 6, 8),
        "hits_at_10": hits_10,
        "precision_at_10": round(hits_10 / 10, 8),
        "recall_at_10": round(hits_10 / 6, 8),
        "mean_reciprocal_rank": round(1 / actual_ranks[0], 8),
        "ndcg_at_6": round(_ndcg(ranking, actual, 6), 8),
        "ndcg_at_10": round(_ndcg(ranking, actual, 10), 8),
        "average_rank_of_winning_numbers": round(mean(actual_ranks), 8),
        "ranks_of_winning_numbers": actual_ranks,
        "brier_score": round(float(np.mean((probs - target) ** 2)), 10),
        "log_loss": round(float(-np.mean(target * np.log(clipped) + (1 - target) * np.log(1 - clipped))), 10),
        "calibration_error": round(ece, 10),
        "calibration_curve": curve,
        "top_6": ranking[:6],
        "top_10": ranking[:10],
    }


def evaluate_snapshot(snapshot: dict[str, Any], draw: Draw) -> dict[str, Any]:
    if snapshot.get("target_draw_date") != draw.draw_date.isoformat():
        raise ValueError("Prediction target date does not match the actual draw date")
    created_at = datetime.fromisoformat(str(snapshot["created_at"]).replace("Z", "+00:00"))
    if created_at >= draw.fetched_at:
        raise ValueError("Prediction snapshot was not created before the result became available")
    metrics = evaluate_prediction(snapshot["scores_1_49"], draw.numbers, snapshot["scores_1_49"])
    return {
        "evaluation_version": "649-evaluation-v2",
        "prediction_id": snapshot["prediction_id"],
        "target_draw_date": draw.draw_date.isoformat(),
        "prediction_created_at": snapshot["created_at"],
        "evaluated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "actual_numbers": list(draw.numbers),
        "metrics": metrics,
    }


def _aggregate(evaluations: Sequence[dict[str, Any]]) -> dict[str, Any]:
    if not evaluations:
        return {}
    metric_names = (
        "hits_at_6", "precision_at_6", "recall_at_6", "hits_at_10", "precision_at_10",
        "recall_at_10", "mean_reciprocal_rank", "ndcg_at_6", "ndcg_at_10",
        "average_rank_of_winning_numbers", "brier_score", "log_loss", "calibration_error",
    )
    aggregate = {
        name: round(mean(float(item[name]) for item in evaluations), 10)
        for name in metric_names
    }
    aggregate["draws"] = len(evaluations)
    distribution = Counter(int(item["hits_at_6"]) for item in evaluations)
    aggregate["ticket_hit_distribution"] = {
        str(hits): {"count": distribution[hits], "rate": round(distribution[hits] / len(evaluations), 8)}
        for hits in range(7)
    }
    return aggregate


class WalkForwardEvaluator:
    def __init__(self, config: Loto649Config, feature_builder: FeatureBuilder | None = None) -> None:
        self.config = config
        self.features = feature_builder or FeatureBuilder(config)

    def run(
        self,
        draws: Sequence[Draw],
        maximum_draws: int | None = None,
        random_strategies: int | None = None,
        seed: int | None = None,
    ) -> dict[str, Any]:
        ordered = sorted(draws, key=lambda item: item.draw_date)
        settings = self.config.section("backtest")
        minimum = int(settings["minimum_history"])
        count = int(maximum_draws if maximum_draws is not None else settings["draws"])
        first_target = max(minimum, len(ordered) - max(1, count))
        while first_target < len(ordered) and ordered[first_target - 1].draw_date >= ordered[first_target].draw_date:
            first_target += 1
        if len(ordered) <= first_target:
            raise ValueError(f"Not enough history for walk-forward evaluation (need more than {minimum} draws)")
        base_seed = int(seed if seed is not None else settings["seed"])
        frozen_model: Pipeline | None = None
        model_protocol: dict[str, Any]
        try:
            x_train, y_train, train_metadata = self.features.training_dataset(
                ordered[:first_target],
                maximum_targets=int(self.config.section("ml")["training_draw_limit"]),
            )
            frozen_model = Pipeline([
                ("scale", StandardScaler()),
                ("classifier", LogisticRegression(
                    C=0.35,
                    max_iter=600,
                    random_state=base_seed,
                    solver="lbfgs",
                )),
            ])
            frozen_model.fit(x_train, y_train)
            model_protocol = {
                "status": "ready",
                "training_rows": len(x_train),
                "training_targets": len({item["target_date"] for item in train_metadata}),
                "training_end_date": max(str(item["target_date"]) for item in train_metadata),
                "first_test_date": ordered[first_target].draw_date.isoformat(),
                "rule": "model fitted once before the test range; every test feature frame expands using only prior draws",
            }
        except ValueError as exc:
            model_protocol = {"status": "unavailable", "reason": str(exc)}
        by_strategy: dict[str, list[dict[str, Any]]] = defaultdict(list)
        by_year: dict[str, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
        draw_records = []
        evaluated_targets: list[Draw] = []
        for target_index in range(first_target, len(ordered)):
            target = ordered[target_index]
            if ordered[target_index - 1].draw_date >= target.draw_date:
                continue
            frame = self.features.build_for_target(ordered, target_index)
            if frame.history_end_date >= target.draw_date:
                raise AssertionError("Walk-forward feature frame contains target/future information")
            outputs = baseline_outputs(frame, base_seed, target.draw_date.isoformat())
            if frozen_model is not None:
                probabilities = frozen_model.predict_proba(frame.matrix())[:, 1]
                outputs["sklearn_logistic_frozen"] = StrategyOutput(
                    "sklearn_logistic_frozen",
                    normalize_scores(probabilities),
                    calibrate_sum_to_six(probabilities),
                )
            record = {
                "target_date": target.draw_date.isoformat(),
                "history_end_date": frame.history_end_date.isoformat(),
                "actual_numbers": list(target.numbers),
                "strategies": {},
            }
            for name, output in outputs.items():
                evaluated = evaluate_prediction(output.ranking_scores, target.numbers, output.probabilities)
                by_strategy[name].append(evaluated)
                by_year[name][target.draw_date.year].append(evaluated)
                record["strategies"][name] = {
                    "hits_at_6": evaluated["hits_at_6"],
                    "ndcg_at_10": evaluated["ndcg_at_10"],
                    "brier_score": evaluated["brier_score"],
                }
            draw_records.append(record)
            evaluated_targets.append(target)
        metrics = {name: _aggregate(items) for name, items in by_strategy.items()}
        stability = {
            name: [
                {"year": year, **_aggregate(items)}
                for year, items in sorted(years.items())
            ]
            for name, years in by_year.items()
        }
        comparisons = self._compare_to_random(
            evaluated_targets,
            metrics,
            int(random_strategies if random_strategies is not None else settings["random_strategies"]),
            base_seed,
        )
        return {
            "backtest_version": "649-walk-forward-v3",
            "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "dataset_version": dataset_hash(ordered),
            "feature_version": self.config.feature_version,
            "mode": "draw_by_draw_expanding_window",
            "minimum_history": minimum,
            "first_target_date": ordered[first_target].draw_date.isoformat(),
            "last_target_date": ordered[-1].draw_date.isoformat(),
            "evaluated_draws": len(draw_records),
            "seed": base_seed,
            "strategies": metrics,
            "strategy_families": {
                "required_baselines": ["random_uniform", "frequency_only", "recent_frequency", "hot", "cold", "overdue", "balanced", "monte_carlo"],
                "statistical_composite": ["statistics"],
                "feature_ablation_order": [
                    "frequency_only", "ablation_frequency_gap", "ablation_frequency_gap_pair",
                    "ablation_frequency_gap_pair_mc", "ablation_frequency_gap_pair_mc_drift", "statistics",
                ],
                "tabular_model": ["sklearn_logistic_frozen"] if frozen_model is not None else [],
            },
            "model_protocols": {"sklearn_logistic_frozen": model_protocol},
            "year_stability": stability,
            "random_comparisons": comparisons,
            "draw_records": draw_records,
            "conclusion": "Baseline differences are out-of-sample estimates; they may still be random variation.",
        }

    @staticmethod
    def _compare_to_random(
        targets: Sequence[Draw],
        strategy_metrics: dict[str, dict[str, Any]],
        n_random: int,
        seed: int,
    ) -> dict[str, Any]:
        runs = max(100, min(int(n_random), 10000))
        rng = np.random.default_rng(seed)
        actual_sets = [set(draw.numbers) for draw in targets]
        random_means = np.empty(runs, dtype=float)
        for simulation in range(runs):
            total_hits = 0
            for actual in actual_sets:
                ticket = set((rng.choice(POOL, size=6, replace=False) + 1).tolist())
                total_hits += len(ticket.intersection(actual))
            random_means[simulation] = total_hits / max(1, len(actual_sets))
        null_mean = float(np.mean(random_means))
        null_std = float(np.std(random_means))
        result = {}
        for name, metrics in strategy_metrics.items():
            value = float(metrics["hits_at_6"])
            result[name] = {
                "metric": "mean_hits_at_6",
                "model_value": round(value, 8),
                "random_strategies": runs,
                "random_mean": round(null_mean, 8),
                "random_95_interval": [round(float(np.quantile(random_means, 0.025)), 8), round(float(np.quantile(random_means, 0.975)), 8)],
                "percentile": round(float(np.mean(random_means <= value)), 8),
                "empirical_p_value": round((int(np.count_nonzero(random_means >= value)) + 1) / (runs + 1), 8),
                "effect_size": round((value - null_mean) / null_std, 8) if null_std else 0.0,
            }
        return result
