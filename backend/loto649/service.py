"""Application service orchestrating data, statistics, training, evaluation, and snapshots."""

from __future__ import annotations

import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Sequence

from .config import Loto649Config, load_config
from .domain import Draw, dataset_hash
from .evaluation import WalkForwardEvaluator, evaluate_snapshot
from .features import FeatureBuilder
from .models import ExperimentalTorchRanker, TemporalSklearnTrainer, audit_legacy_models
from .prediction import build_prediction_snapshot
from .registry import ModelRegistry
from .reports import ReportStore
from .repository import HistoryRepository
from .source import LotoSource, OfficialLotoRoSource, ResultNotPublished
from .statistics import StatisticalEngine, compare_periods


ReloadCallback = Callable[[], None]
ExternalScoreProvider = Callable[[Sequence[Draw]], tuple[dict[str, Sequence[float]], dict[str, str]]]


class Loto649Service:
    def __init__(
        self,
        data_dir: Path | str,
        config: Loto649Config | None = None,
        reload_callback: ReloadCallback | None = None,
        external_score_provider: ExternalScoreProvider | None = None,
    ) -> None:
        self.data_dir = Path(data_dir)
        self.config = config or load_config()
        self.repository = HistoryRepository(self.data_dir)
        self.reports = ReportStore(self.data_dir)
        self.registry = ModelRegistry(self.data_dir)
        self.features = FeatureBuilder(self.config)
        self.statistics_engine = StatisticalEngine(self.config)
        self.evaluator = WalkForwardEvaluator(self.config, self.features)
        self.trainer = TemporalSklearnTrainer(self.data_dir, self.config, self.registry, self.features)
        self.torch_ranker = ExperimentalTorchRanker(self.data_dir, self.config)
        self.reload_callback = reload_callback
        self.external_score_provider = external_score_provider
        self._lock = threading.RLock()
        self._draws: list[Draw] | None = None
        self._mtime = -1
        self._statistical: dict[str, Any] | None = None

    def draws(self, force: bool = False) -> list[Draw]:
        current_mtime = self.repository.history_mtime_ns()
        with self._lock:
            if force or self._draws is None or current_mtime != self._mtime:
                self._draws = self.repository.load_draws()
                self._mtime = current_mtime
                self._statistical = None
            return list(self._draws)

    def latest(self) -> dict[str, Any]:
        draws = self.draws()
        if not draws:
            raise ValueError("No validated Loto 6/49 history is available")
        return self._public_draw(draws[-1])

    @staticmethod
    def _public_draw(draw: Draw) -> dict[str, Any]:
        return {
            **draw.as_dict(),
            "draw_date_iso": draw.draw_date.isoformat(),
            "drawn_numbers": list(draw.numbers),
        }

    def history(self, limit: int = 100, offset: int = 0, year: int | None = None) -> dict[str, Any]:
        all_draws = list(reversed(self.draws()))
        years = sorted({draw.draw_date.year for draw in all_draws}, reverse=True)
        if year is not None:
            all_draws = [draw for draw in all_draws if draw.draw_date.year == year]
        limit = max(1, min(int(limit), 1000))
        offset = max(0, int(offset))
        return {
            "game": "6din49",
            "draws": [self._public_draw(draw) for draw in all_draws[offset:offset + limit]],
            "total": len(all_draws),
            "limit": limit,
            "offset": offset,
            "years": years,
        }

    def statistical_report(
        self,
        refresh: bool = False,
        n_simulations: int | None = None,
        seed: int | None = None,
    ) -> dict[str, Any]:
        draws = self.draws()
        version = dataset_hash(draws)
        expected_runs = int(
            n_simulations if n_simulations is not None else self.config.section("statistics")["monte_carlo_runs"]
        )
        with self._lock:
            if (
                not refresh
                and self._statistical
                and self._statistical.get("dataset_version") == version
                and int(self._statistical.get("configuration", {}).get("n_simulations", -1)) == expected_runs
            ):
                return self._statistical
            if not refresh and n_simulations is None and seed is None:
                cached = self.reports.load_statistical(version)
                if cached and int(cached.get("configuration", {}).get("n_simulations", -1)) == expected_runs:
                    self._statistical = cached
                    return cached
            report = self.statistics_engine.build(draws, n_simulations=n_simulations, seed=seed)
            self.reports.save_statistical(report)
            self.reports.log("statistics_rebuilt", dataset_version=version, draw_count=len(draws))
            self._statistical = report
            return report

    def statistics_summary(self, refresh: bool = False) -> dict[str, Any]:
        report = self.statistical_report(refresh=refresh)
        numbers = sorted(report["numbers"], key=lambda item: (-abs(item["standardized_residual"]), item["number"]))
        pairs = report["pairs"]
        latest_prediction = self.latest_prediction(create_if_missing=False)
        return {
            "game": "6din49",
            "label": "Loto 6/49",
            "dataset_version": report["dataset_version"],
            "generated_at": report["generated_at"],
            "draw_count": report["draw_count"],
            "date_range": report["date_range"],
            "latest_draw": self.latest(),
            "next_scheduled_update": self.next_scheduled_draw(self.draws()[-1].draw_date).isoformat(),
            "update_policy": "Scheduled checks retry; an empty/unpublished result is never inserted.",
            "global_tests": report["global_tests"],
            "entropy": report["entropy"],
            "drift": report["drift"],
            "monte_carlo_null": report["monte_carlo_null"],
            "top_number_deviations": numbers[:10],
            "top_pair_deviations": pairs[:10],
            "significant_numbers_adjusted": sum(item["significant_adjusted"] for item in report["numbers"]),
            "significant_pairs_adjusted": sum(item["significant_adjusted"] for item in pairs),
            "prediction": {
                "prediction_id": latest_prediction.get("prediction_id"),
                "target_draw_date": latest_prediction.get("target_draw_date"),
                "model_version": latest_prediction.get("model_version"),
                "top_6": latest_prediction.get("top_6", []),
                "uncertainty": latest_prediction.get("uncertainty", {}),
            } if latest_prediction else None,
            "levels": report["levels"],
            "warnings": report["warnings"],
        }

    def number_statistics(self) -> dict[str, Any]:
        report = self.statistical_report()
        prediction = self.latest_prediction(create_if_missing=False) or {}
        predicted = {item["number"]: item for item in prediction.get("ranking", [])}
        rows = []
        for item in report["numbers"]:
            scored = predicted.get(item["number"], {})
            rows.append({
                **item,
                "prediction_rank": scored.get("rank"),
                "modeled_probability": scored.get("modeled_probability"),
                "prediction_confidence": scored.get("confidence"),
                "scores": scored.get("scores", {}),
            })
        return {
            "game": "6din49",
            "draw_count": report["draw_count"],
            "dataset_version": report["dataset_version"],
            "numbers": rows,
            "p_value_preference": "adjusted_p_value",
        }

    def number_detail(self, number: int) -> dict[str, Any]:
        number = int(number)
        if number < 1 or number > 49:
            raise ValueError("number must be between 1 and 49")
        report = self.statistical_report()
        details = next(item for item in report["numbers"] if item["number"] == number)
        prediction = self.latest_prediction(create_if_missing=False) or {}
        predicted = next((item for item in prediction.get("ranking", []) if item["number"] == number), {})
        relationships = [item for item in report["pairs"] if number in item["pair"]]
        history = [self._public_draw(draw) for draw in reversed(self.draws()) if number in draw.numbers]
        return {
            **details,
            "game": "6din49",
            "draw_count": report["draw_count"],
            "dataset_version": report["dataset_version"],
            "prediction": predicted,
            "model_version": prediction.get("model_version"),
            "relationships": relationships[:20],
            "history": history,
            "history_count": len(history),
            "interpretation": {
                "descriptive": "Observed values summarize the past.",
                "inference": "Adjusted p-values account for the family of number tests.",
                "prediction": "Model factors are non-causal and only meaningful when validated out of sample.",
            },
        }

    def pair_statistics(
        self,
        number: int | None = None,
        limit: int = 100,
        offset: int = 0,
        sort: str = "deviation",
    ) -> dict[str, Any]:
        if number is not None and not 1 <= int(number) <= 49:
            raise ValueError("number must be between 1 and 49")
        items = list(self.statistical_report()["pairs"])
        if number is not None:
            items = [item for item in items if int(number) in item["pair"]]
        if sort == "observed":
            items.sort(key=lambda item: (-item["observed"], item["pair"]))
        elif sort == "significance":
            items.sort(key=lambda item: (item["adjusted_p_value"], -abs(item["standardized_residual"])))
        elif sort != "deviation":
            raise ValueError("sort must be deviation, observed, or significance")
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        return {
            "game": "6din49",
            "pair_probability_per_draw": 30 / (49 * 48),
            "total": len(items),
            "limit": limit,
            "offset": offset,
            "pairs": items[offset:offset + limit],
        }

    def tests(self) -> dict[str, Any]:
        report = self.statistical_report()
        return {
            "dataset_version": report["dataset_version"],
            "global_tests": report["global_tests"],
            "drift": report["drift"],
            "gap_tests": report["gap_tests"],
            "autocorrelation": report["autocorrelation"],
            "entropy": report["entropy"],
            "draw_patterns": report["draw_patterns"],
            "monte_carlo_null": report["monte_carlo_null"],
            "triple_summary": report["triples"],
            "warnings": report["warnings"],
        }

    def compare(self, start_a: date, end_a: date, start_b: date, end_b: date) -> dict[str, Any]:
        return compare_periods(self.draws(), start_a, end_a, start_b, end_b)

    def next_scheduled_draw(self, after: date) -> date:
        weekdays = {int(value) for value in self.config.section("game")["draw_weekdays"]}
        candidate = after + timedelta(days=1)
        for _ in range(8):
            if candidate.weekday() in weekdays:
                return candidate
            candidate += timedelta(days=1)
        raise AssertionError("Invalid draw weekday configuration")

    def create_prediction(self, target: date | None = None, freeze: bool = True) -> dict[str, Any]:
        draws = self.draws()
        if not draws:
            raise ValueError("Cannot predict without validated history")
        target_date = target or self.next_scheduled_draw(draws[-1].draw_date)
        if target_date <= draws[-1].draw_date:
            raise ValueError("Prediction target must be later than the history end date")
        existing = self.reports.prediction_for_date(target_date)
        current_version = dataset_hash(draws)
        if existing and existing.get("dataset_version") == current_version:
            evaluation = self.reports.evaluation_for(str(existing["prediction_id"]))
            return {**existing, "evaluation": evaluation, "snapshot_status": "immutable"}
        frame = self.features.build_for_next(draws, target_date=target_date)
        outputs, versions, model_explanations = self.trainer.predict_champion(frame)
        if self.external_score_provider:
            external_outputs, external_versions = self.external_score_provider(draws)
            outputs.update(external_outputs)
            versions.update(external_versions)
        champion = self.registry.champion()
        ensemble_weights = champion.get("ensemble_weights") if champion else None
        snapshot = build_prediction_snapshot(
            frame,
            target_date,
            self.config,
            outputs,
            versions,
            ensemble_weights,
            model_explanations,
        )
        if freeze:
            self.reports.freeze_prediction(snapshot)
            self.reports.log(
                "prediction_created",
                prediction_id=snapshot["prediction_id"],
                target_draw_date=snapshot["target_draw_date"],
                dataset_version=snapshot["dataset_version"],
            )
            snapshot["snapshot_status"] = "immutable"
        else:
            snapshot["snapshot_status"] = "ephemeral_not_saved"
        return snapshot

    def latest_prediction(self, create_if_missing: bool = False) -> dict[str, Any] | None:
        latest = self.reports.latest_prediction()
        last_draw = self.draws()[-1] if self.draws() else None
        if latest:
            evaluation = self.reports.evaluation_for(str(latest["prediction_id"]))
            enriched = {**latest, "evaluation": evaluation, "snapshot_status": "immutable"}
            if last_draw and date.fromisoformat(str(latest["target_draw_date"])) > last_draw.draw_date:
                return enriched
            if not create_if_missing:
                return enriched
        if create_if_missing:
            return self.create_prediction(freeze=False)
        return latest

    def prediction_history(self, limit: int = 50) -> dict[str, Any]:
        snapshots = self.reports.prediction_history(limit)
        return {
            "predictions": [
                {**snapshot, "evaluation": self.reports.evaluation_for(str(snapshot["prediction_id"]))}
                for snapshot in snapshots
            ],
            "total": len(snapshots),
        }

    def backtest(
        self,
        refresh: bool = False,
        maximum_draws: int | None = None,
        random_strategies: int | None = None,
        seed: int | None = None,
    ) -> dict[str, Any]:
        version = dataset_hash(self.draws())
        if not refresh and maximum_draws is None and random_strategies is None and seed is None:
            cached = self.reports.latest_backtest()
            if cached and cached.get("dataset_version") == version:
                return cached
        self.reports.log("backtest_started", dataset_version=version)
        report = self.evaluator.run(self.draws(), maximum_draws, random_strategies, seed)
        self.reports.save_backtest(report)
        self.reports.log("backtest_completed", dataset_version=version, draws=report["evaluated_draws"])
        return report

    @staticmethod
    def backtest_summary(report: dict[str, Any]) -> dict[str, Any]:
        if not report.get("strategies"):
            return report
        keys = (
            "backtest_version", "created_at", "dataset_version", "feature_version", "mode",
            "minimum_history", "first_target_date", "last_target_date", "evaluated_draws", "seed",
            "strategies", "strategy_families", "model_protocols", "random_comparisons", "conclusion",
        )
        return {
            **{key: report[key] for key in keys if key in report},
            "full_report_persisted": True,
            "omitted_from_response": ["draw_records", "year_stability"],
        }

    def latest_backtest(self) -> dict[str, Any]:
        cached = self.reports.latest_backtest()
        if cached is not None:
            return self.backtest_summary(cached)
        return {
            "status": "not_generated",
            "message": "No persisted backtest report exists. Run the protected POST endpoint or CLI command.",
            "evaluated_draws": 0,
            "first_target_date": None,
            "last_target_date": None,
            "seed": None,
            "strategies": {},
            "random_comparisons": {},
            "conclusion": "Generate a report through the protected admin endpoint or loto649_pipeline.py backtest.",
        }

    def train(self) -> dict[str, Any]:
        if not bool(self.config.section("ml").get("enabled", True)):
            raise RuntimeError("Loto 6/49 ML training is disabled by configuration")
        self.reports.log("training_started", dataset_version=dataset_hash(self.draws()))
        result = self.trainer.train_candidate(self.draws())
        availability = self.torch_ranker.available()
        if availability.get("enabled"):
            if availability.get("available"):
                try:
                    experiment = self.torch_ranker.train(self.draws(), self.features)
                    existing = self.registry.get(str(experiment["model_id"]))
                    if existing is None:
                        record = self.registry.register({
                            "model_id": experiment["model_id"],
                            "model_type": experiment["model_type"],
                            "training_end_date": experiment["training_end_date"],
                            "dataset_hash": experiment["dataset_hash"],
                            "feature_version": experiment["feature_version"],
                            "hyperparameters": experiment["hyperparameters"],
                            "seed": experiment["seed"],
                            "validation_metrics": experiment["validation_metrics"],
                            "backtest_metrics": experiment["validation_metrics"],
                            "validation_range": experiment["validation_range"],
                            "artifact_path": str(Path(experiment["artifact_path"]).relative_to(self.data_dir.parent.parent)),
                            "leakage_audit": experiment["leakage_audit"],
                            "status": "candidate",
                        })
                        existing = self.registry.set_status(
                            str(experiment["model_id"]),
                            "rejected",
                            "Experimental PyTorch artifact retained; promotion requires the common frozen-range backtest protocol.",
                        )
                    result["pytorch_experiment"] = {**experiment, "registry": existing}
                except Exception as exc:
                    result["pytorch_experiment"] = {"status": "failed", "error": str(exc)}
            else:
                result["pytorch_experiment"] = {"status": "unavailable", "reason": availability.get("reason")}
        if result.get("reused"):
            event = "training_reused"
        elif result.get("promotion") == "promoted":
            event = "candidate_promoted"
        else:
            event = "candidate_rejected"
        self.reports.log(event, model_id=result.get("model", {}).get("model_id"), reason=result.get("model", {}).get("status_reason"))
        self.reports.log(
            "training_completed",
            model_id=result.get("model", {}).get("model_id"),
            promotion=result.get("promotion"),
            pytorch_status=result.get("pytorch_experiment", {}).get("status") if result.get("pytorch_experiment") else "disabled",
        )
        return result

    def models(self) -> dict[str, Any]:
        registered = self.registry.list()
        return {
            "champion": self.registry.champion(),
            "registered": registered,
            "legacy_audits": audit_legacy_models(self.data_dir),
            "pytorch": self.torch_ranker.available(),
            "policy": self.config.section("training"),
            "last_training_date": max((item.get("created_at", "") for item in registered), default=None),
        }

    def update(self, source: LotoSource | None = None, dry_run: bool = False, train: bool | None = None) -> dict[str, Any]:
        with self._lock:
            adapter = source or OfficialLotoRoSource(self.config)
            history = self.draws(force=True)
            latest_date = history[-1].draw_date if history else None
            self.reports.log("update_started", latest_draw_date=latest_date.isoformat() if latest_date else None)
            try:
                fetched = adapter.fetch_since(latest_date)
            except ResultNotPublished as exc:
                self.reports.log("scrape_failure", reason=str(exc), result_published=False)
                return {"status": "result_not_published", "updated": False, "message": str(exc)}
            except Exception as exc:
                self.reports.log(
                    "scrape_failure",
                    reason=str(exc),
                    error_type=type(exc).__name__,
                    result_published=None,
                )
                return {"status": "source_error", "updated": False, "error": str(exc), "error_type": type(exc).__name__}
            self.reports.log("scrape_success", fetched=len(fetched))
            if not fetched:
                self.reports.log("duplicate_draw", latest_draw_date=latest_date.isoformat() if latest_date else None)
                return {"status": "already_up_to_date", "updated": False, "new_draws": []}
            evaluations = []
            for draw in fetched:
                snapshot = self.reports.prediction_for_date(draw.draw_date)
                if snapshot:
                    existing_evaluation = self.reports.evaluation_for(str(snapshot["prediction_id"]))
                    if existing_evaluation is not None:
                        if (
                            existing_evaluation.get("target_draw_date") != draw.draw_date.isoformat()
                            or set(existing_evaluation.get("actual_numbers", [])) != set(draw.numbers)
                        ):
                            raise ValueError("Persisted evaluation conflicts with the fetched official draw")
                        evaluations.append(existing_evaluation)
                        continue
                    evaluation = evaluate_snapshot(snapshot, draw)
                    evaluations.append(evaluation)
                    if not dry_run:
                        self.reports.save_evaluation(evaluation)
                        self.reports.log("prediction_evaluated", prediction_id=snapshot["prediction_id"], target_draw_date=draw.draw_date.isoformat())
            if dry_run:
                return {
                    "status": "dry_run",
                    "updated": False,
                    "validated_draws": [draw.as_dict() for draw in fetched],
                    "evaluations": evaluations,
                }
            inserted = self.repository.insert_many(fetched)
            if not inserted:
                return {"status": "already_up_to_date", "updated": False, "new_draws": []}
            self.reports.log("new_draw_detected", count=len(inserted), dates=[draw.draw_date.isoformat() for draw in inserted])
            self.draws(force=True)
            if self.reload_callback:
                self.reload_callback()
            statistical = self.statistical_report(refresh=True)
            training_result = None
            training_settings = self.config.section("training")
            should_train = (
                bool(training_settings["retrain_after_new_draw"])
                and len(inserted) >= int(training_settings["minimum_new_draws_for_full_retrain"])
                and bool(self.config.section("ml").get("enabled", True))
            ) if train is None else bool(train)
            if should_train:
                try:
                    training_result = self.train()
                except Exception as exc:  # A failed challenger must not roll back a valid official draw.
                    training_result = {"status": "failed", "error": str(exc)}
                    self.reports.log("candidate_rejected", reason=str(exc))
            prediction = self.create_prediction(freeze=bool(self.config.section("prediction")["save_snapshot"]))
            return {
                "status": "updated",
                "updated": True,
                "new_draws": [draw.as_dict() for draw in inserted],
                "evaluations": evaluations,
                "statistics": {
                    "dataset_version": statistical["dataset_version"],
                    "global_tests": statistical["global_tests"],
                },
                "training": training_result,
                "prediction": {
                    "prediction_id": prediction["prediction_id"],
                    "target_draw_date": prediction["target_draw_date"],
                    "top_6": prediction["top_6"],
                },
            }
