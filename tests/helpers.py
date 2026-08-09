from __future__ import annotations

import copy
import csv
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from loto649.config import Loto649Config, load_config
from loto649.domain import Draw


CSV_FIELDS = [
    "row_id", "game", "game_label", "draw_index", "draw_date_iso", "draw_date_raw",
    "year", "quarter", "month", "month_name", "day", "weekday", "weekday_name", "iso_week",
    "drawn_numbers", "drawn_numbers_csv", "drawn_numbers_sorted_csv",
    "number_1", "number_2", "number_3", "number_4", "number_5", "number_6",
    "number_count", "unique_count", "number_sum", "number_min", "number_max", "number_span",
    "odd_count", "even_count", "low_count", "high_count", "consecutive_pairs",
    "category_count", "category_data_json", "has_prize_data", "raw_cells_json", "source_url", "rag_text",
]


def make_draws(count: int, seed: int = 42, start: date = date(2019, 1, 1)) -> list[Draw]:
    rng = random.Random(seed)
    fetched = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        Draw(
            draw_date=start + timedelta(days=index * 3),
            numbers=tuple(rng.sample(range(1, 50), 6)),
            source="https://official.example/results",
            fetched_at=fetched,
            official_id=f"fixture-{index + 1}",
        )
        for index in range(count)
    ]


def write_history(directory: Path, draws: list[Draw]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "lottery_history.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for index, draw in enumerate(draws, start=1):
            writer.writerow(draw.to_history_row(index, CSV_FIELDS))
    return path


def test_config(monte_carlo_runs: int = 20, minimum_history: int = 30) -> Loto649Config:
    base = load_config()
    raw = copy.deepcopy(base.raw)
    raw["statistics"]["monte_carlo_runs"] = monte_carlo_runs
    raw["features"]["minimum_history"] = minimum_history
    raw["backtest"]["minimum_history"] = minimum_history
    raw["backtest"]["draws"] = 20
    raw["backtest"]["random_strategies"] = 100
    raw["ml"]["training_draw_limit"] = 100
    raw["ml"]["validation_draws"] = 20
    return Loto649Config(raw=raw, path=base.path)
