from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from loto649.features import FeatureBuilder
from loto649.models import TemporalSklearnTrainer
from loto649.registry import ModelRegistry

from .helpers import make_draws, test_config


class ModelRegistryTests(unittest.TestCase):
    def test_candidate_has_temporal_audit_and_deterministic_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            config = test_config(5, minimum_history=30)
            registry = ModelRegistry(data_dir)
            trainer = TemporalSklearnTrainer(data_dir, config, registry, FeatureBuilder(config))
            draws = make_draws(105)
            result = trainer.train_candidate(draws)
            record = result["model"]
            self.assertTrue(record["leakage_audit"]["passed"])
            self.assertIn(record["status"], {"production", "rejected"})
            self.assertEqual(record["seed"], config.section("ml")["random_seed"])
            self.assertIn("ndcg_at_10", record["validation_metrics"])
            self.assertEqual(record["validation_mode"], "chronological_holdout_with_walk_forward_feature_frames")
            self.assertAlmostEqual(sum(record["ensemble_weights"].values()), 1.0)
            self.assertIn("tuning_range", record["ensemble_weight_search"])
            self.assertTrue(record["period_stability"])
            self.assertEqual(record["validation_random_comparison"]["random_strategies"], 100)
            self.assertIn("empirical_p_value", record["validation_random_comparison"])
            if record["status"] == "production":
                self.assertIn("validation_training_end_date", record)
                self.assertEqual(record["training_end_date"], record["refit_through_date"])
            repeated = trainer.train_candidate(draws)
            self.assertTrue(repeated["reused"])
            self.assertEqual(repeated["model"]["model_id"], record["model_id"])
            with self.assertRaisesRegex(ValueError, "Immutable"):
                registry.update_metadata(record["model_id"], {"status": "production"})


if __name__ == "__main__":
    unittest.main()
