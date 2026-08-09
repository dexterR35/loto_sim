from __future__ import annotations

import math
import unittest

from loto649.statistics import (
    NUMBER_PROBABILITY,
    PAIR_PROBABILITY,
    StatisticalEngine,
    benjamini_hochberg,
    run_null_simulation,
)

from .helpers import make_draws, test_config


class StatisticalEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.draws = make_draws(180)
        cls.report = StatisticalEngine(test_config(15)).build(cls.draws)

    def test_observed_expected_and_global_chi_square(self) -> None:
        self.assertEqual(len(self.report["numbers"]), 49)
        expected = len(self.draws) * 6 / 49
        self.assertAlmostEqual(self.report["numbers"][0]["expected"], expected, places=4)
        contribution_sum = sum(row["chi_contribution"] for row in self.report["numbers"])
        self.assertAlmostEqual(contribution_sum, self.report["global_tests"]["chi_square"], places=4)

    def test_pair_probability_is_combinatorial(self) -> None:
        expected_probability = math.comb(47, 4) / math.comb(49, 6)
        self.assertAlmostEqual(PAIR_PROBABILITY, expected_probability)
        self.assertEqual(len(self.report["pairs"]), math.comb(49, 2))
        self.assertAlmostEqual(self.report["pairs"][0]["expected"], len(self.draws) * expected_probability, places=6)

    def test_bh_adjustment_is_monotone_in_sorted_order(self) -> None:
        raw = [0.04, 0.001, 0.02, 0.8]
        adjusted = benjamini_hochberg(raw)
        ordered = sorted(zip(raw, adjusted))
        self.assertEqual(len(adjusted), len(raw))
        self.assertTrue(all(left[1] <= right[1] for left, right in zip(ordered, ordered[1:])))
        self.assertTrue(all(adjusted[index] >= raw[index] for index in range(len(raw))))

    def test_seeded_null_simulation_is_reproducible_and_without_replacement(self) -> None:
        first = run_null_simulation(80, 42.0, 2.5, 12, 77)
        second = run_null_simulation(80, 42.0, 2.5, 12, 77)
        self.assertEqual(first, second)
        self.assertIn("without replacement", first["selection_mechanism"])
        self.assertEqual(first["n_simulations"], 12)
        self.assertEqual(first["simulation_version"], "uniform-without-replacement-v2")
        self.assertIn("maximum_pair_absolute_residual", first)
        self.assertIn("maximum_current_gap", first)

    def test_gap_warning_does_not_claim_due_numbers(self) -> None:
        for row in self.report["numbers"]:
            self.assertIn("does not make", row["recency"]["warning"])
            self.assertGreaterEqual(row["recency"]["gap_percentile"], 0)
            self.assertLessEqual(row["recency"]["gap_percentile"], 1)
        self.assertAlmostEqual(NUMBER_PROBABILITY, 6 / 49)
        self.assertIn("gap_tests", self.report)
        self.assertTrue(all("adjusted_p_value" in row["recency"] for row in self.report["numbers"]))

    def test_draw_patterns_are_compared_with_theoretical_nulls(self) -> None:
        patterns = self.report["draw_patterns"]
        self.assertEqual(patterns["sum"]["theoretical_mean"], 150.0)
        self.assertIn("p_value", patterns["odd_count_uniform_test"])
        self.assertIn("p_value", patterns["low_1_24_uniform_test"])
        self.assertIn("spread", patterns)


if __name__ == "__main__":
    unittest.main()
