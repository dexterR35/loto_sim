from __future__ import annotations

import math
import tempfile
import unittest
from pathlib import Path

from unittest.mock import patch
import server
from target_simulation import (
    UNIFORM_COMBINATIONS,
    exact_weighted_set_probability,
    simulate_target_models,
    validate_attempt_limit,
    validate_target,
)

from .helpers import make_draws, write_history


TARGET = [2, 5, 12, 20, 24, 40]


class TargetSimulationMathTests(unittest.TestCase):
    def test_uniform_probability_matches_exact_combination_space(self) -> None:
        weights = {number: 1.0 for number in range(1, 50)}
        probability = exact_weighted_set_probability(weights, TARGET)
        self.assertTrue(math.isclose(probability, 1 / UNIFORM_COMBINATIONS, rel_tol=1e-12))
        self.assertTrue(math.isclose(probability * UNIFORM_COMBINATIONS, 1.0, rel_tol=1e-12))

    def test_probability_is_scale_invariant_and_rewards_weighted_target(self) -> None:
        uniform = {number: 1.0 for number in range(1, 50)}
        weighted = {number: (5.0 if number in TARGET else 1.0) for number in range(1, 50)}
        scaled = {number: value * 17.0 for number, value in weighted.items()}
        target_probability = exact_weighted_set_probability(weighted, TARGET)
        self.assertGreater(target_probability, exact_weighted_set_probability(uniform, TARGET))
        self.assertTrue(
            math.isclose(target_probability, exact_weighted_set_probability(scaled, TARGET), rel_tol=1e-12)
        )

    def test_seeded_first_hit_is_reproducible(self) -> None:
        weights = {number: 1.0 for number in range(1, 50)}
        specs = [{"key": "random", "weights": weights}]
        first = simulate_target_models(TARGET, 1_000_000, specs, seed=649)
        second = simulate_target_models(TARGET, 1_000_000, specs, seed=649)
        row = first["results"][0]
        self.assertEqual(first, second)
        self.assertEqual(row["one_in"], UNIFORM_COMBINATIONS)
        self.assertEqual(row["attempts_run"], min(row["simulated_first_hit_attempt"], 1_000_000))
        self.assertEqual(row["reached"], row["simulated_first_hit_attempt"] <= 1_000_000)
        self.assertEqual(row["exact_hits_within_limit"] > 0, row["reached"])
        self.assertTrue(math.isclose(
            row["expected_hits_within_limit"],
            1_000_000 / UNIFORM_COMBINATIONS,
            rel_tol=1e-12,
        ))

    def test_legacy_64_bit_seed_is_preserved_exactly(self) -> None:
        weights = {number: 1.0 for number in range(1, 50)}
        legacy_seed = 1_415_084_687_678_846_500
        result = simulate_target_models(
            TARGET,
            100_000,
            [{"key": "random", "weights": weights}],
            seed=legacy_seed,
        )
        self.assertEqual(result["seed"], str(legacy_seed))

    def test_target_and_attempt_validation(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly 6 unique"):
            validate_target([1, 1, 2, 3, 4, 5])
        with self.assertRaisesRegex(ValueError, "between 1 and 49"):
            validate_target([1, 2, 3, 4, 5, 50])
        with self.assertRaisesRegex(ValueError, "Attempt limit"):
            validate_attempt_limit(0)


class TargetSimulationDataTests(unittest.TestCase):
    def test_data_service_uses_latest_draw_and_ensemble_weights(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir = root / "data" / "lottery"
            draws = make_draws(55)
            write_history(data_dir, draws)
            with patch.object(server, "ROOT", root):
                data = server.LotoData(data_dir)
            target = list(draws[-1].numbers)
            ensemble = {
                "prediction_id": "fixture-prediction",
                "target_draw_date": "2026-01-04",
                "history_end_date": draws[-1].draw_date.isoformat(),
                "model_version": "fixture-v1",
                "ranking": [
                    {"number": number, "modeled_probability": 0.25 if number in target else 0.10}
                    for number in range(1, 50)
                ],
            }

            result = data.target_simulation_649(
                target,
                attempt_limit=5_000_000,
                model_keys=["random", "balanced", "research_ensemble"],
                seed=42,
                ensemble_prediction=ensemble,
            )

        self.assertTrue(result["target_matches_latest_draw"])
        self.assertEqual(result["target_numbers"], sorted(target))
        self.assertEqual([row["key"] for row in result["results"]], [
            "random",
            "balanced",
            "research_ensemble",
        ])
        self.assertTrue(all(row["available"] for row in result["results"]))
        self.assertEqual(result["results"][0]["one_in"], UNIFORM_COMBINATIONS)
        self.assertEqual(
            result["results"][2]["details"]["prediction_id"],
            "fixture-prediction",
        )


if __name__ == "__main__":
    unittest.main()
