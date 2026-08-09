from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from loto649.domain import Draw
from loto649.evaluation import evaluate_snapshot
from loto649.reports import ReportStore
from loto649.repository import DrawConflictError, HistoryRepository
from loto649.service import Loto649Service

from .helpers import make_draws, test_config, write_history


class FakeSource:
    def __init__(self, draws):
        self.draws = draws

    def fetch_latest_649(self):
        return self.draws[-1]

    def fetch_since(self, after, through=None):
        return [draw for draw in self.draws if after is None or draw.draw_date > after]


class FailingSource:
    def fetch_since(self, after, through=None):
        raise TimeoutError("official source timed out")


class PersistencePipelineTests(unittest.TestCase):
    def test_repository_is_idempotent_and_preserves_same_day_special_draws(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            first = make_draws(2)
            write_history(data_dir, first)
            repository = HistoryRepository(data_dir)
            duplicate = first[-1]
            self.assertFalse(repository.insert(duplicate))
            special = Draw(
                draw_date=duplicate.draw_date,
                numbers=tuple(reversed(make_draws(1, seed=99)[0].numbers)),
                source="https://official.example/results",
                fetched_at=datetime.now(timezone.utc),
                official_id="special-same-day",
            )
            self.assertTrue(repository.insert(special))
            persisted = repository.load_draws()
            self.assertEqual(len(persisted), 3)
            same_day = [draw for draw in persisted if draw.draw_date == duplicate.draw_date]
            self.assertEqual(len({draw.official_id for draw in same_day}), 2)
            self.assertIn("special-same-day", {draw.official_id for draw in same_day})
            correction = Draw(
                draw_date=duplicate.draw_date,
                numbers=tuple(make_draws(1, seed=1234)[0].numbers),
                source="https://official.example/results",
                fetched_at=datetime.now(timezone.utc),
                official_id="special-same-day",
            )
            with self.assertRaises(DrawConflictError):
                repository.insert(correction)

    def test_prediction_snapshot_is_immutable_and_evaluation_is_separate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = ReportStore(Path(directory))
            snapshot = {
                "prediction_id": "immutable-1",
                "target_draw_date": "2026-08-09",
                "created_at": "2026-08-08T18:00:00+00:00",
                "scores_1_49": [6 / 49] * 49,
            }
            path = store.freeze_prediction(snapshot)
            before = path.read_text(encoding="utf-8")
            store.freeze_prediction(snapshot)
            evaluation = {"prediction_id": "immutable-1", "actual_numbers": [1, 2, 3, 4, 5, 6]}
            store.save_evaluation(evaluation)
            self.assertEqual(path.read_text(encoding="utf-8"), before)
            self.assertEqual(store.evaluation_for("immutable-1"), evaluation)
            changed = {**snapshot, "scores_1_49": [0.1] * 49}
            with self.assertRaisesRegex(ValueError, "Immutable"):
                store.freeze_prediction(changed)

    def test_update_evaluates_previous_snapshot_then_persists_and_predicts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            history = make_draws(45)
            write_history(data_dir, history)
            service = Loto649Service(data_dir, config=test_config(5, minimum_history=20))
            next_date = service.next_scheduled_draw(history[-1].draw_date)
            snapshot = service.create_prediction(target=next_date, freeze=True)
            fetched = datetime.now(timezone.utc) + timedelta(minutes=2)
            new_draw = Draw(
                draw_date=next_date,
                numbers=tuple(make_draws(1, seed=404)[0].numbers),
                source="https://official.example/results",
                fetched_at=fetched,
                official_id=f"official-{next_date.isoformat()}",
            )
            result = service.update(source=FakeSource([new_draw]), train=False)
            self.assertTrue(result["updated"])
            self.assertEqual(len(result["evaluations"]), 1)
            self.assertIsNotNone(service.reports.evaluation_for(snapshot["prediction_id"]))
            self.assertEqual(service.latest()["draw_date"], next_date.isoformat())
            self.assertGreater(service.latest_prediction(create_if_missing=False)["target_draw_date"], next_date.isoformat())
            second = service.update(source=FakeSource([new_draw]), train=False)
            self.assertEqual(second["status"], "already_up_to_date")

    def test_update_retry_reuses_an_existing_immutable_evaluation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            history = make_draws(45)
            write_history(data_dir, history)
            service = Loto649Service(data_dir, config=test_config(5, minimum_history=20))
            next_date = service.next_scheduled_draw(history[-1].draw_date)
            snapshot = service.create_prediction(target=next_date, freeze=True)
            new_draw = Draw(
                draw_date=next_date,
                numbers=tuple(make_draws(1, seed=505)[0].numbers),
                source="https://official.example/results",
                fetched_at=datetime.now(timezone.utc) + timedelta(minutes=2),
                official_id=f"official-{next_date.isoformat()}",
            )
            frozen = evaluate_snapshot(snapshot, new_draw)
            service.reports.save_evaluation(frozen)
            result = service.update(source=FakeSource([new_draw]), train=False)
            self.assertTrue(result["updated"])
            self.assertEqual(result["evaluations"], [frozen])
            self.assertEqual(service.reports.evaluation_for(snapshot["prediction_id"]), frozen)

    def test_source_failure_is_logged_without_mutating_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            history = make_draws(35)
            history_path = write_history(data_dir, history)
            before = history_path.read_bytes()
            service = Loto649Service(data_dir, config=test_config(2, minimum_history=20))
            result = service.update(source=FailingSource(), train=False)
            self.assertEqual(result["status"], "source_error")
            self.assertFalse(result["updated"])
            self.assertEqual(history_path.read_bytes(), before)
            log = next((data_dir / "reports" / "loto649" / "logs").glob("*.jsonl")).read_text()
            self.assertIn('"event": "scrape_failure"', log)
            self.assertIn('"error_type": "TimeoutError"', log)


if __name__ == "__main__":
    unittest.main()
