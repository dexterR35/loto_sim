#!/usr/bin/env python3
"""Operate the automatic, reproducible Loto 6/49 pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from loto649.config import load_config  # noqa: E402
from loto649.service import Loto649Service  # noqa: E402


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Loto 6/49 statistical and prediction pipeline")
    command.add_argument("--data-dir", type=Path, default=ROOT / "data" / "lottery")
    command.add_argument("--config", type=Path, default=ROOT / "config" / "loto649.json")
    subparsers = command.add_subparsers(dest="command", required=True)

    update = subparsers.add_parser("update", help="Fetch official draws and run the post-draw pipeline")
    update.add_argument("--dry-run", action="store_true", help="Fetch and validate without writing")
    update.add_argument("--no-train", action="store_true", help="Skip challenger training for this run")

    statistics = subparsers.add_parser("statistics", help="Rebuild the complete statistical report")
    statistics.add_argument("--simulations", type=int)
    statistics.add_argument("--seed", type=int)

    predict = subparsers.add_parser("predict", help="Create the next immutable prediction snapshot")
    predict.add_argument("--target-date", type=date.fromisoformat)
    predict.add_argument("--ephemeral", action="store_true", help="Print without freezing a snapshot")

    backtest = subparsers.add_parser("backtest", help="Run expanding-window baseline comparison")
    backtest.add_argument("--draws", type=int)
    backtest.add_argument("--random-strategies", type=int)
    backtest.add_argument("--seed", type=int)
    backtest.add_argument("--cached", action="store_true", help="Print the latest persisted summary without recomputing")

    subparsers.add_parser("train", help="Train and temporally validate a Challenger")
    subparsers.add_parser("models", help="Show Champion/Challenger registry and legacy audits")
    return command


def compact_statistics(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "report_version": report["report_version"],
        "dataset_version": report["dataset_version"],
        "draw_count": report["draw_count"],
        "date_range": report["date_range"],
        "global_tests": report["global_tests"],
        "monte_carlo_null": report["monte_carlo_null"],
        "adjusted_number_signals": sum(item["significant_adjusted"] for item in report["numbers"]),
        "adjusted_pair_signals": sum(item["significant_adjusted"] for item in report["pairs"]),
    }


def main() -> int:
    args = parser().parse_args()
    service = Loto649Service(args.data_dir, config=load_config(args.config))
    if args.command == "update":
        result = service.update(dry_run=args.dry_run, train=False if args.no_train else None)
    elif args.command == "statistics":
        result = compact_statistics(
            service.statistical_report(refresh=True, n_simulations=args.simulations, seed=args.seed)
        )
    elif args.command == "predict":
        result = service.create_prediction(target=args.target_date, freeze=not args.ephemeral)
    elif args.command == "backtest":
        if args.cached:
            result = service.latest_backtest()
        else:
            report = service.backtest(
                refresh=True,
                maximum_draws=args.draws,
                random_strategies=args.random_strategies,
                seed=args.seed,
            )
            result = service.backtest_summary(report)
    elif args.command == "train":
        result = service.train()
    else:
        result = service.models()
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, default=str))
    return 2 if result.get("status") == "source_error" else 0


if __name__ == "__main__":
    raise SystemExit(main())
