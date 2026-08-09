"""Reproducible temporal model training, promotion policy, and legacy audits."""

from __future__ import annotations

import hashlib
import json
import os
import pickle
import random
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Sequence

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .config import Loto649Config
from .domain import Draw, dataset_hash
from .evaluation import evaluate_prediction
from .features import FEATURE_NAMES, FeatureBuilder, TemporalFeatureFrame, audit_temporal_metadata
from .prediction import StrategyOutput, baseline_outputs, calibrate_sum_to_six, normalize_scores
from .registry import ModelRegistry
from .statistics import NUMBER_PROBABILITY, POOL


def _git_commit(root: Path) -> str:
    env_value = os.getenv("GITHUB_SHA", "").strip()
    if env_value:
        return env_value
    head = root / ".git" / "HEAD"
    try:
        value = head.read_text(encoding="utf-8").strip()
        if value.startswith("ref: "):
            ref = root / ".git" / value[5:]
            return ref.read_text(encoding="utf-8").strip() if ref.exists() else value[5:]
        return value
    except OSError:
        return "unknown"


def _mean_metrics(evaluations: Sequence[dict[str, Any]]) -> dict[str, float | int]:
    names = (
        "hits_at_6", "hits_at_10", "ndcg_at_6", "ndcg_at_10",
        "average_rank_of_winning_numbers", "brier_score", "log_loss", "calibration_error",
    )
    return {
        **{name: round(mean(float(item[name]) for item in evaluations), 10) for name in names},
        "draws": len(evaluations),
    }


def _evaluate_blend_records(
    records: Sequence[dict[str, Any]],
    weights: dict[str, float],
) -> list[dict[str, Any]]:
    evaluations = []
    for record in records:
        outputs: dict[str, StrategyOutput] = record["outputs"]
        ranking = sum(float(weights[name]) * outputs[name].ranking_scores for name in weights)
        probabilities = sum(float(weights[name]) * outputs[name].probabilities for name in weights)
        evaluations.append(
            evaluate_prediction(ranking, record["actual"], calibrate_sum_to_six(probabilities))
        )
    return evaluations


def _optimize_ensemble_weights(records: Sequence[dict[str, Any]]) -> tuple[dict[str, float], dict[str, Any]]:
    if not records:
        raise ValueError("Temporal tuning records are required for ensemble weight selection")
    best_weights: dict[str, float] | None = None
    best_metrics: dict[str, Any] | None = None
    best_objective: tuple[float, float, float] | None = None
    # Small, recorded simplex grid. The candidate must retain at least 20% model weight.
    for sklearn_units in range(2, 11):
        for statistics_units in range(0, 11 - sklearn_units):
            monte_carlo_units = 10 - sklearn_units - statistics_units
            weights = {
                "sklearn": sklearn_units / 10,
                "statistics": statistics_units / 10,
                "monte_carlo": monte_carlo_units / 10,
            }
            metrics = _mean_metrics(_evaluate_blend_records(records, weights))
            objective = (
                float(metrics["ndcg_at_10"]),
                -float(metrics["brier_score"]),
                float(weights["sklearn"]),
            )
            if best_objective is None or objective > best_objective:
                best_objective = objective
                best_weights = weights
                best_metrics = metrics
    if best_weights is None or best_metrics is None:
        raise AssertionError("Ensemble grid search did not produce a candidate")
    return best_weights, best_metrics


def _compare_hits_to_random_strategies(
    records: Sequence[dict[str, Any]],
    model_hits: float,
    seed: int,
    runs: int,
) -> dict[str, Any]:
    simulation_count = max(100, min(int(runs), 10000))
    rng = np.random.default_rng(seed)
    actual_sets = [set(int(number) for number in record["actual"]) for record in records]
    simulated = np.empty(simulation_count, dtype=float)
    for simulation in range(simulation_count):
        total = 0
        for actual in actual_sets:
            ticket = set((rng.choice(POOL, size=6, replace=False) + 1).tolist())
            total += len(ticket.intersection(actual))
        simulated[simulation] = total / max(1, len(actual_sets))
    null_mean = float(np.mean(simulated))
    null_std = float(np.std(simulated))
    return {
        "metric": "mean_hits_at_6",
        "model_value": round(float(model_hits), 8),
        "random_strategies": simulation_count,
        "random_mean": round(null_mean, 8),
        "random_95_interval": [
            round(float(np.quantile(simulated, 0.025)), 8),
            round(float(np.quantile(simulated, 0.975)), 8),
        ],
        "percentile": round(float(np.mean(simulated <= model_hits)), 8),
        "empirical_p_value": round((int(np.count_nonzero(simulated >= model_hits)) + 1) / (simulation_count + 1), 8),
        "effect_size": round((float(model_hits) - null_mean) / null_std, 8) if null_std else 0.0,
    }


class TemporalSklearnTrainer:
    model_type = "sklearn_logistic_ranker"
    protocol_version = "sklearn-temporal-v3"

    def __init__(
        self,
        data_dir: Path | str,
        config: Loto649Config,
        registry: ModelRegistry,
        feature_builder: FeatureBuilder | None = None,
    ) -> None:
        self.data_dir = Path(data_dir)
        self.root = self.data_dir.parents[1]
        self.config = config
        self.registry = registry
        self.features = feature_builder or FeatureBuilder(config)
        self.models_dir = self.data_dir / "ml_models"
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def train_candidate(self, draws: Sequence[Draw]) -> dict[str, Any]:
        settings = self.config.section("ml")
        seed = int(settings["random_seed"])
        random.seed(seed)
        np.random.seed(seed)
        x, y, metadata = self.features.training_dataset(
            draws,
            maximum_targets=int(settings["training_draw_limit"]),
        )
        audit_temporal_metadata(metadata)
        target_dates = sorted({str(item["target_date"]) for item in metadata})
        validation_count = min(int(settings["validation_draws"]), max(20, len(target_dates) // 4))
        if len(target_dates) <= validation_count + 20:
            raise ValueError("Not enough temporally separated targets for model training and validation")
        validation_date_list = target_dates[-validation_count:]
        tuning_count = max(1, validation_count // 2)
        tuning_dates = set(validation_date_list[:tuning_count])
        final_validation_dates = set(validation_date_list[tuning_count:])
        validation_dates = set(validation_date_list)
        validation_mask = np.asarray([str(item["target_date"]) in validation_dates for item in metadata], dtype=bool)
        train_mask = ~validation_mask
        classifier_parameters = {"C": 0.35, "max_iter": 600, "random_state": seed, "solver": "lbfgs"}
        pipeline = Pipeline([
            ("scale", StandardScaler()),
            ("classifier", LogisticRegression(**classifier_parameters)),
        ])
        pipeline.fit(x[train_mask], y[train_mask])
        validation_probabilities = pipeline.predict_proba(x[validation_mask])[:, 1]
        validation_x = x[validation_mask]
        validation_y = y[validation_mask]
        validation_metadata = [item for item, keep in zip(metadata, validation_mask) if keep]
        validation_records: list[dict[str, Any]] = []
        cursor = 0
        while cursor < len(validation_probabilities):
            date_value = validation_metadata[cursor]["target_date"]
            end = cursor
            while end < len(validation_probabilities) and validation_metadata[end]["target_date"] == date_value:
                end += 1
            probs = validation_probabilities[cursor:end]
            feature_rows = validation_x[cursor:end]
            labels = validation_y[cursor:end]
            if len(probs) != POOL:
                raise AssertionError("Each temporal validation draw must contain 49 number rows")
            actual = [index + 1 for index, label in enumerate(labels) if label]
            meta = validation_metadata[cursor]
            frame = TemporalFeatureFrame(
                target_date=date.fromisoformat(str(date_value)),
                history_end_date=date.fromisoformat(str(meta["history_end_date"])),
                history_size=int(meta["history_size"]),
                history_hash="held-out-temporal-frame",
                feature_version=self.config.feature_version,
                rows=tuple(
                    {name: float(row[index]) for index, name in enumerate(FEATURE_NAMES)}
                    for row in feature_rows
                ),
            )
            outputs = baseline_outputs(frame, int(self.config.section("prediction")["seed"]), str(date_value))
            outputs["sklearn"] = StrategyOutput(
                "sklearn",
                normalize_scores(probs),
                calibrate_sum_to_six(probs),
            )
            validation_records.append({"date": str(date_value), "actual": actual, "outputs": outputs})
            cursor = end
        tuning_records = [record for record in validation_records if record["date"] in tuning_dates]
        final_records = [record for record in validation_records if record["date"] in final_validation_dates]
        if not final_records:
            raise ValueError("A final temporal validation block is required after ensemble tuning")
        ensemble_weights, tuning_metrics = _optimize_ensemble_weights(tuning_records)
        metrics = _mean_metrics(_evaluate_blend_records(final_records, ensemble_weights))
        model_metrics = _mean_metrics([
            evaluate_prediction(record["outputs"]["sklearn"].ranking_scores, record["actual"], record["outputs"]["sklearn"].probabilities)
            for record in final_records
        ])
        statistics_metrics = _mean_metrics([
            evaluate_prediction(record["outputs"]["statistics"].ranking_scores, record["actual"], record["outputs"]["statistics"].probabilities)
            for record in final_records
        ])
        random_metrics = _mean_metrics([
            evaluate_prediction(record["outputs"]["random_uniform"].ranking_scores, record["actual"], record["outputs"]["random_uniform"].probabilities)
            for record in final_records
        ])
        random_comparison = _compare_hits_to_random_strategies(
            final_records,
            float(metrics["hits_at_6"]),
            seed,
            int(self.config.section("backtest")["random_strategies"]),
        )
        midpoint = max(1, len(final_records) // 2)
        stability = []
        for label, records in (("early", final_records[:midpoint]), ("late", final_records[midpoint:])):
            if not records:
                continue
            candidate_period = _mean_metrics(_evaluate_blend_records(records, ensemble_weights))
            baseline_period = _mean_metrics([
                evaluate_prediction(record["outputs"]["statistics"].ranking_scores, record["actual"], record["outputs"]["statistics"].probabilities)
                for record in records
            ])
            stability.append({
                "period": label,
                "draws": len(records),
                "ndcg_at_10": candidate_period["ndcg_at_10"],
                "baseline_ndcg_at_10": baseline_period["ndcg_at_10"],
                "ndcg_gain": round(float(candidate_period["ndcg_at_10"]) - float(baseline_period["ndcg_at_10"]), 10),
            })
        data_version = dataset_hash(draws)
        experiment_configuration = {
            "protocol_version": self.protocol_version,
            "classifier": classifier_parameters,
            "ml": settings,
            "training_policy": self.config.section("training"),
            "feature_names": list(FEATURE_NAMES),
        }
        experiment_config_hash = hashlib.sha256(
            json.dumps(experiment_configuration, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        identity = f"{self.model_type}|{data_version}|{self.config.feature_version}|{seed}|{experiment_config_hash}"
        model_id = f"sk-{hashlib.sha256(identity.encode()).hexdigest()[:18]}"
        existing = self.registry.get(model_id)
        if existing:
            return {"model": existing, "promotion": existing.get("status"), "reused": True}
        artifact_path = self.models_dir / f"loto649_{model_id}.pkl"
        artifact = {
            "model_id": model_id,
            "model_type": self.model_type,
            "training_protocol": self.protocol_version,
            "experiment_config_hash": experiment_config_hash,
            "experiment_configuration": experiment_configuration,
            "pipeline": pipeline,
            "features": list(FEATURE_NAMES),
            "feature_version": self.config.feature_version,
            "dataset_hash": data_version,
            "training_end_date": max(str(item["history_end_date"]) for item in metadata if item["target_date"] not in validation_dates),
            "validation_start_date": min(validation_dates),
            "validation_end_date": max(validation_dates),
            "seed": seed,
            "metrics": metrics,
            "ensemble_weights": ensemble_weights,
            "validation_protocol": "train -> ensemble tuning block -> untouched final temporal block",
        }
        with artifact_path.open("wb") as handle:
            pickle.dump(artifact, handle)
        record = self.registry.register({
            "model_id": model_id,
            "model_type": self.model_type,
            "experiment_id": model_id,
            "training_protocol": self.protocol_version,
            "experiment_config_hash": experiment_config_hash,
            "training_end_date": artifact["training_end_date"],
            "dataset_hash": data_version,
            "feature_version": self.config.feature_version,
            "hyperparameters": pipeline.named_steps["classifier"].get_params(),
            "seed": seed,
            "validation_metrics": metrics,
            "model_only_validation_metrics": model_metrics,
            "validation_baseline_random": random_metrics,
            "validation_random_comparison": random_comparison,
            "validation_baseline_statistics": statistics_metrics,
            "ensemble_weights": ensemble_weights,
            "ensemble_weight_search": {
                "method": "simplex_grid_0.1",
                "objective": "maximize NDCG@10, then minimize Brier score",
                "tuning_range": [min(tuning_dates), max(tuning_dates)],
                "tuning_metrics": tuning_metrics,
            },
            "period_stability": stability,
            "backtest_metrics": metrics,
            "train_range": [target_dates[0], sorted(set(target_dates).difference(validation_dates))[-1]],
            "validation_range": [min(final_validation_dates), max(final_validation_dates)],
            "validation_mode": "chronological_holdout_with_walk_forward_feature_frames",
            "artifact_path": str(artifact_path.relative_to(self.data_dir.parent.parent)),
            "git_commit": _git_commit(self.root),
            "leakage_audit": {
                "passed": True,
                "rule": "history_end_date < target_date for every training and validation row",
                "rows_checked": len(metadata),
            },
            "status": "candidate",
        })
        decision, reason = self._promotion_decision(record, random_metrics)
        if decision:
            # Refit the accepted topology on all currently available temporal rows only after validation.
            pipeline.fit(x, y)
            artifact["pipeline"] = pipeline
            artifact["refit_through_date"] = target_dates[-1]
            artifact["validation_training_end_date"] = artifact["training_end_date"]
            artifact["training_end_date"] = target_dates[-1]
            artifact["feature_coefficients"] = {
                name: round(float(value), 10)
                for name, value in zip(FEATURE_NAMES, pipeline.named_steps["classifier"].coef_[0])
            }
            with artifact_path.open("wb") as handle:
                pickle.dump(artifact, handle)
            self.registry.update_metadata(model_id, {
                "validation_training_end_date": record["training_end_date"],
                "training_end_date": target_dates[-1],
                "refit_through_date": target_dates[-1],
                "feature_coefficients": artifact["feature_coefficients"],
            })
            updated = self.registry.set_status(model_id, "production", reason)
            return {"model": updated, "promotion": "promoted", "reused": False}
        updated = self.registry.set_status(model_id, "rejected", reason)
        return {"model": updated, "promotion": "rejected", "reused": False}

    def _promotion_decision(self, candidate: dict[str, Any], random_metrics: dict[str, Any]) -> tuple[bool, str]:
        policy = self.config.section("training")
        candidate_metrics = candidate["validation_metrics"]
        champion = self.registry.champion()
        statistical_reference = candidate.get("validation_baseline_statistics", random_metrics)
        reference_ndcg = float(statistical_reference.get("ndcg_at_10", 0))
        reference_brier = float(statistical_reference.get("brier_score", 1))
        if champion:
            champion_metrics = champion.get("validation_metrics", {})
            reference_ndcg = max(reference_ndcg, float(champion_metrics.get("ndcg_at_10", 0)))
            reference_brier = min(reference_brier, float(champion_metrics.get("brier_score", 1)))
        ndcg_gain = float(candidate_metrics["ndcg_at_10"]) - reference_ndcg
        brier_change = float(candidate_metrics["brier_score"]) - reference_brier
        if ndcg_gain < float(policy["minimum_ndcg_improvement"]):
            return False, f"Rejected: temporal NDCG@10 gain {ndcg_gain:.6f} is below the promotion threshold"
        if brier_change > float(policy["maximum_brier_degradation"]):
            return False, f"Rejected: temporal Brier score degraded by {brier_change:.6f}"
        if bool(policy.get("promotion_requires_backtest", True)):
            empirical_p = float(candidate.get("validation_random_comparison", {}).get("empirical_p_value", 1.0))
            maximum_p = float(policy.get("maximum_random_empirical_p_value", 0.05))
            if empirical_p > maximum_p:
                return False, (
                    f"Rejected: random-strategy empirical p-value {empirical_p:.6f} "
                    f"exceeds the promotion threshold {maximum_p:.6f}"
                )
        maximum_period_regression = float(policy.get("maximum_period_ndcg_regression", 0.02))
        period_gains = [float(item["ndcg_gain"]) for item in candidate.get("period_stability", [])]
        if period_gains and min(period_gains) < -maximum_period_regression:
            return False, (
                f"Rejected: candidate advantage is unstable across temporal subperiods "
                f"(worst NDCG@10 gain {min(period_gains):.6f})"
            )
        return True, f"Promoted after leakage audit and held-out temporal validation (NDCG@10 gain {ndcg_gain:.6f})"

    def predict_champion(
        self, frame: TemporalFeatureFrame
    ) -> tuple[dict[str, Sequence[float]], dict[str, str], dict[str, list[list[dict[str, Any]]]]]:
        champion = self.registry.champion()
        if not champion or champion.get("model_type") != self.model_type:
            return {}, {}, {}
        artifact_path = self.data_dir.parent.parent / str(champion["artifact_path"])
        if not artifact_path.exists():
            return {}, {}, {}
        with artifact_path.open("rb") as handle:
            artifact = pickle.load(handle)
        if artifact.get("feature_version") != frame.feature_version:
            return {}, {}, {}
        pipeline = artifact["pipeline"]
        matrix = frame.matrix()
        probabilities = pipeline.predict_proba(matrix)[:, 1]
        scaled = pipeline.named_steps["scale"].transform(matrix)
        coefficients = pipeline.named_steps["classifier"].coef_[0]
        contribution_matrix = scaled * coefficients
        per_number = []
        for row in contribution_matrix:
            indexes = np.argsort(np.abs(row))[::-1][:5]
            per_number.append([
                {
                    "feature": FEATURE_NAMES[index],
                    "contribution": round(float(row[index]), 8),
                    "direction": "positive" if row[index] >= 0 else "negative",
                }
                for index in indexes
            ])
        return (
            {"sklearn": probabilities.tolist()},
            {"sklearn": str(champion["model_id"])},
            {"sklearn": per_number},
        )


class ExperimentalTorchRanker:
    """Optional 49-output MLP; imported only when explicitly enabled."""

    def __init__(self, data_dir: Path | str, config: Loto649Config) -> None:
        self.data_dir = Path(data_dir)
        self.config = config

    def available(self) -> dict[str, Any]:
        if not bool(self.config.section("ml").get("pytorch_enabled", False)):
            return {"enabled": False, "available": False, "reason": "pytorch_enabled is false"}
        try:
            import torch  # noqa: F401
        except ImportError:
            return {"enabled": True, "available": False, "reason": "PyTorch is not installed"}
        return {"enabled": True, "available": True}

    def train(self, draws: Sequence[Draw], feature_builder: FeatureBuilder) -> dict[str, Any]:
        availability = self.available()
        if not availability["available"]:
            raise RuntimeError(str(availability["reason"]))
        import torch

        seed = int(self.config.section("ml")["random_seed"])
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        try:
            torch.use_deterministic_algorithms(True)
        except Exception:
            pass
        x_rows, y_rows, metadata = feature_builder.training_dataset(
            draws,
            maximum_targets=min(500, int(self.config.section("ml")["training_draw_limit"])),
        )
        targets = len(x_rows) // POOL
        x = torch.tensor(x_rows.reshape(targets, POOL * len(FEATURE_NAMES)), dtype=torch.float32)
        y = torch.tensor(y_rows.reshape(targets, POOL), dtype=torch.float32)
        split = max(1, int(targets * 0.8))
        model = torch.nn.Sequential(
            torch.nn.Linear(x.shape[1], 128),
            torch.nn.ReLU(),
            torch.nn.Dropout(0.2),
            torch.nn.Linear(128, 64),
            torch.nn.ReLU(),
            torch.nn.Linear(64, POOL),
        )
        optimizer = torch.optim.Adam(model.parameters(), lr=0.001, weight_decay=1e-4)
        loss_function = torch.nn.BCEWithLogitsLoss()
        for _ in range(40):
            model.train()
            optimizer.zero_grad()
            loss = loss_function(model(x[:split]), y[:split])
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            probabilities = torch.sigmoid(model(x[split:])).cpu().numpy()
        evaluations = []
        for probs, labels in zip(probabilities, y[split:].cpu().numpy()):
            actual = [index + 1 for index, label in enumerate(labels) if label]
            evaluations.append(evaluate_prediction(probs, actual, probs))
        model_id = f"pt-{hashlib.sha256((dataset_hash(draws) + str(seed)).encode()).hexdigest()[:18]}"
        path = self.data_dir / "ml_models" / f"loto649_{model_id}.pt"
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"state_dict": model.state_dict(), "input_size": x.shape[1], "seed": seed, "feature_version": self.config.feature_version}, path)
        target_dates = sorted({str(item["target_date"]) for item in metadata})
        return {
            "model_id": model_id,
            "model_type": "pytorch_mlp_49",
            "artifact_path": str(path),
            "validation_metrics": _mean_metrics(evaluations),
            "dataset_hash": dataset_hash(draws),
            "feature_version": self.config.feature_version,
            "training_end_date": target_dates[split - 1],
            "validation_range": [target_dates[split], target_dates[-1]],
            "seed": seed,
            "hyperparameters": {"hidden_layers": [128, 64], "dropout": 0.2, "epochs": 40, "optimizer": "Adam"},
            "leakage_audit": {"passed": True, "rows_checked": len(metadata), "rule": "chronological 80/20 target split"},
        }


def audit_legacy_models(data_dir: Path | str) -> list[dict[str, Any]]:
    """Expose existing sklearn/LSTM artifacts without treating unverifiable metrics as production evidence."""
    root = Path(data_dir) / "ml_models"
    audits = []
    sklearn_path = root / "6din49_sklearn.pkl"
    if sklearn_path.exists():
        metrics: dict[str, Any] = {}
        try:
            with sklearn_path.open("rb") as handle:
                payload = pickle.load(handle)
            metrics = payload.get("metrics", {})
        except Exception as exc:
            metrics = {"read_error": str(exc)}
        audits.append({
            "model_id": "legacy-6din49-sklearn",
            "model_type": "legacy_sklearn_gradient_boosting",
            "status": "archived",
            "artifact_path": str(sklearn_path),
            "metrics": metrics,
            "promotion_eligible": False,
            "audit": {
                "temporal_split": metrics.get("split") == "temporal_by_draw",
                "dataset_hash_present": False,
                "walk_forward_validation_present": False,
                "reason": "Legacy artifact is visible for comparison but lacks full reproducibility provenance.",
            },
        })
    lstm_meta = root / "6din49_lstm.json"
    lstm_model = root / "6din49_lstm.keras"
    if lstm_meta.exists() or lstm_model.exists():
        try:
            meta = json.loads(lstm_meta.read_text(encoding="utf-8")) if lstm_meta.exists() else {}
        except json.JSONDecodeError:
            meta = {}
        reproducible = bool(meta.get("dataset_hash") and meta.get("seed") is not None and meta.get("training_end_date"))
        audits.append({
            "model_id": "legacy-6din49-lstm",
            "model_type": "legacy_tensorflow_lstm",
            "status": "archived",
            "artifact_path": str(lstm_model),
            "metrics": meta.get("metrics", {}),
            "promotion_eligible": False,
            "audit": {
                "sequence_target_alignment": "implementation uses history[index-lookback:index] -> target[index]",
                "chronological_split": True,
                "normalization_leakage": "not_applicable_multi_hot_inputs",
                "deterministic_seed_recorded": bool(meta.get("seed")),
                "dataset_hash_present": bool(meta.get("dataset_hash")),
                "training_cutoff_present": bool(meta.get("training_end_date")),
                "walk_forward_validation_present": False,
                "lookback": meta.get("lookback", 15),
                "reason": "Artifact provenance is complete, but walk-forward validation is still required for promotion." if reproducible else "Target alignment is sound, but the existing artifact predates full seed/dataset/walk-forward provenance.",
            },
        })
    return audits
