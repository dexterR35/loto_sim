#!/usr/bin/env python3
"""Train LSTM models on scraped lottery archive data."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "lottery"
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ml_engine import MLEngine  # noqa: E402
from server import GAME_CONFIGS, load_jsonl  # noqa: E402


def load_game_rows(game: str) -> list[dict]:
    rows = [row for row in load_jsonl(DATA_DIR / "archive_results.jsonl") if row.get("game") == game]
    rows.sort(key=lambda item: item.get("draw_date_iso", ""))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Train LSTM lottery prediction models")
    parser.add_argument("--game", default="6din49", choices=list(GAME_CONFIGS.keys()))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--all", action="store_true", help="Train LSTM for every supported game")
    args = parser.parse_args()

    engine = MLEngine(DATA_DIR, GAME_CONFIGS)
    games = list(GAME_CONFIGS.keys()) if args.all else [args.game]
    reports = []
    for game in games:
        rows = load_game_rows(game)
        if len(rows) < 16:
            print(f"skip {game}: only {len(rows)} draws (need 16+)")
            continue
        print(f"training LSTM for {game} on {len(rows)} draws...")
        payload = engine.train_lstm(game, rows, epochs=args.epochs)
        reports.append({
            "game": game,
            "metrics": payload.get("metrics", {}),
            "chart_path": payload.get("chart_path"),
        })
        print(json.dumps(reports[-1], indent=2))

    if not reports:
        print("no models trained")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
