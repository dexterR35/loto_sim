from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

import server
from loto649.repository import HistoryRepository
from loto649.service import Loto649Service

from .helpers import make_draws, test_config, write_history


class Loto649ApiContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        data_dir = Path(self.temporary.name)
        write_history(data_dir, make_draws(55))
        self.service = Loto649Service(data_dir, config=test_config(3, minimum_history=25))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_all_required_routes_are_registered(self) -> None:
        paths = {route.path for route in server.app.routes}
        required = {
            "/api/649/latest",
            "/api/649/history",
            "/api/649/statistics",
            "/api/649/statistics/numbers",
            "/api/649/statistics/numbers/{number}",
            "/api/649/statistics/pairs",
            "/api/649/statistics/tests",
            "/api/649/prediction/latest",
            "/api/649/predictions/history",
            "/api/649/models",
            "/api/649/backtest",
            "/api/649/target-simulation",
            "/api/649/update",
            "/api/649/train",
        }
        self.assertTrue(required.issubset(paths))

    def test_latest_draw_and_prediction_schema(self) -> None:
        self.service.create_prediction(freeze=True)
        with patch.object(server, "LOTO649", self.service):
            latest = server.api_649_latest()
            prediction = server.api_649_prediction_latest()
        self.assertEqual(len(latest["drawn_numbers"]), 6)
        self.assertEqual(len(prediction["scores_1_49"]), 49)
        self.assertEqual(len(prediction["ranking_1_49"]), 49)
        self.assertAlmostEqual(sum(prediction["scores_1_49"]), 6.0, places=6)
        self.assertLess(prediction["history_end_date"], prediction["target_draw_date"])

    def test_prediction_get_does_not_create_an_untracked_snapshot(self) -> None:
        with patch.object(server, "LOTO649", self.service):
            with self.assertRaises(HTTPException) as raised:
                server.api_649_prediction_latest()
        self.assertEqual(raised.exception.status_code, 404)
        prediction_dir = Path(self.temporary.name) / "reports" / "loto649" / "predictions"
        self.assertEqual(list(prediction_dir.glob("*.json")), [])

    def test_number_range_is_enforced_at_the_api_boundary(self) -> None:
        with patch.object(server, "LOTO649", self.service):
            with self.assertRaisesRegex(ValueError, "between 1 and 49"):
                server.api_649_statistics_number(0)
            with self.assertRaisesRegex(ValueError, "between 1 and 49"):
                server.api_649_statistics_number(50)

    def test_backtest_get_is_cache_only(self) -> None:
        with patch.object(server, "LOTO649", self.service):
            response = server.api_649_backtest()
        self.assertEqual(response["status"], "not_generated")
        self.assertEqual(response["strategies"], {})

    def test_admin_jobs_are_disabled_without_a_token(self) -> None:
        with patch.dict(
            os.environ,
            {"LOTO649_ADMIN_TOKEN": "", "LOTO649_ALLOW_UNAUTHENTICATED_ADMIN": ""},
            clear=False,
        ):
            with self.assertRaises(HTTPException) as raised:
                server.require_loto649_admin(None)
        self.assertEqual(raised.exception.status_code, 503)

    def test_legacy_api_cache_reloads_after_atomic_history_update(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir = root / "data" / "lottery"
            draws = make_draws(3)
            write_history(data_dir, [draws[0], draws[0], draws[1]])
            with patch.object(server, "ROOT", root):
                data = server.LotoData(data_dir)
                self.assertEqual(data.draw_history("6din49", 10)["total"], 2)
                self.assertEqual(data.draw_history("6din49", 1)["draws"][0]["draw_date_iso"], draws[1].draw_date.isoformat())
                self.assertTrue(HistoryRepository(data_dir).insert(draws[2]))
                self.assertTrue(data.refresh_if_history_changed())
                latest = data.draw_history("6din49", 1)["draws"][0]
                analysis = data.number_analysis("6din49")
            self.assertEqual(latest["draw_date_iso"], draws[2].draw_date.isoformat())
            self.assertEqual(analysis["latest"]["draw_date_iso"], draws[2].draw_date.isoformat())
            self.assertEqual(analysis["draws"], 3)
            by_number = {item["number"]: item for item in analysis["numbers"]}
            for number in draws[2].numbers:
                self.assertEqual(by_number[number]["draws_since_seen"], 0)
            self.assertFalse(data.refresh_if_history_changed())


if __name__ == "__main__":
    unittest.main()
