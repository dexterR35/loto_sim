from __future__ import annotations

import unittest

import numpy as np

from loto649.evaluation import WalkForwardEvaluator, evaluate_prediction
from loto649.features import FEATURE_NAMES, FeatureBuilder, audit_temporal_metadata
from loto649.prediction import baseline_outputs, build_prediction_snapshot

from .helpers import make_draws, test_config


class TemporalFeatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.draws = make_draws(90)
        self.config = test_config(minimum_history=30)
        self.builder = FeatureBuilder(self.config)

    def test_target_features_end_before_target(self) -> None:
        frame = self.builder.build_for_target(self.draws, 50)
        self.assertLess(frame.history_end_date, self.draws[50].draw_date)
        self.assertEqual(frame.history_size, 50)
        self.assertEqual(frame.matrix().shape, (49, len(FEATURE_NAMES)))
        self.assertNotIn(self.draws[50].draw_date.isoformat(), {row["history_end_date"] for row in frame.rows})

    def test_training_targets_are_aligned_and_audited(self) -> None:
        x, y, metadata = self.builder.training_dataset(self.draws, minimum_history=70, maximum_targets=10)
        self.assertEqual(x.shape[0], 10 * 49)
        self.assertEqual(y.shape[0], 10 * 49)
        self.assertEqual(int(y.sum()), 10 * 6)
        audit_temporal_metadata(metadata)
        for draw_offset in range(10):
            start = draw_offset * 49
            labels = y[start:start + 49]
            target_numbers = {
                number for number, selected in enumerate(labels, start=1) if selected
            }
            self.assertEqual(target_numbers, set(self.draws[-10 + draw_offset].numbers))
            self.assertLess(metadata[start]["history_end_date"], metadata[start]["target_date"])

    def test_future_date_in_history_is_rejected(self) -> None:
        with self.assertRaisesRegex(AssertionError, "future"):
            self.builder.build_for_next(self.draws[:20], target_date=self.draws[10].draw_date)

    def test_prediction_has_49_reproducible_scores(self) -> None:
        frame = self.builder.build_for_next(self.draws)
        target = self.draws[-1].draw_date.replace(year=self.draws[-1].draw_date.year + 1)
        first = build_prediction_snapshot(frame, target, self.config)
        second = build_prediction_snapshot(frame, target, self.config, created_at=__import__("datetime").datetime.fromisoformat(first["created_at"]))
        self.assertEqual(first["prediction_id"], second["prediction_id"])
        self.assertEqual(first["scores_1_49"], second["scores_1_49"])
        self.assertEqual(len(first["ranking_1_49"]), 49)
        self.assertAlmostEqual(sum(first["scores_1_49"]), 6.0, places=6)

    def test_metrics_and_walk_forward_are_temporal(self) -> None:
        scores = np.arange(49, dtype=float)
        metrics = evaluate_prediction(scores, [44, 45, 46, 47, 48, 49])
        self.assertEqual(metrics["hits_at_6"], 6)
        self.assertEqual(metrics["recall_at_6"], 1.0)
        report = WalkForwardEvaluator(self.config).run(self.draws, maximum_draws=4, random_strategies=100)
        self.assertEqual(report["evaluated_draws"], 4)
        self.assertIn("random_uniform", report["strategies"])
        self.assertIn("monte_carlo", report["strategies"])
        self.assertIn("sklearn_logistic_frozen", report["strategies"])
        self.assertIn("ablation_frequency_gap_pair", report["strategies"])
        protocol = report["model_protocols"]["sklearn_logistic_frozen"]
        self.assertEqual(protocol["status"], "ready")
        self.assertLess(protocol["training_end_date"], protocol["first_test_date"])
        self.assertTrue(all(row["history_end_date"] < row["target_date"] for row in report["draw_records"]))


if __name__ == "__main__":
    unittest.main()
