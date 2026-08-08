#!/usr/bin/env python3
"""FastAPI backend for CSV-backed lottery history, ML, and RAG APIs."""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import os
import random
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "lottery"
DIST_DIR = ROOT / "dist"
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

ML_MODULE_PATH = BACKEND_DIR / "ml_engine.py"
VECTOR_MODULE_PATH = BACKEND_DIR / "vector_store.py"

GAME_CONFIGS: dict[str, dict[str, Any]] = {
    "6din49": {"label": "Loto 6/49", "pool": 49, "pick": 6, "joker_pool": 0},
    "5din40": {"label": "Loto 5/40", "pool": 40, "pick": 6, "joker_pool": 0},
    "joker": {"label": "Joker", "pool": 45, "pick": 5, "joker_pool": 20},
    "noroc": {"label": "Noroc", "pool": 10, "pick": 7, "joker_pool": 0},
}

LIVE_GAME_ORDER = ("6din49", "noroc", "5din40", "joker")

STRATEGIES = {
    "balanced": "Balanced signal mix",
    "hot": "Hot numbers",
    "cold": "Cold numbers",
    "overdue": "Long-time-not-seen",
    "monte_carlo": "Monte Carlo simulation",
    "ml_sklearn": "scikit-learn gradient boosting",
    "ml_lstm": "LSTM sequence neural network",
}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def parse_json_field(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    try:
        return json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return default


def coerce_int_field(row: dict[str, Any], field: str) -> None:
    value = row.get(field)
    if value in (None, ""):
        return
    try:
        row[field] = int(value)
    except (TypeError, ValueError):
        pass


def load_history_csv(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    rows: list[dict[str, Any]] = []
    flat_rows: list[dict[str, str]] = []
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        for flat in reader:
            clean_flat = {key: value or "" for key, value in flat.items()}
            parsed: dict[str, Any] = dict(clean_flat)
            drawn = parse_json_field(clean_flat.get("drawn_numbers"), [])
            if not drawn and clean_flat.get("drawn_numbers_csv"):
                drawn = [part.strip() for part in clean_flat["drawn_numbers_csv"].split(",") if part.strip()]
            parsed["drawn_numbers"] = drawn
            parsed["category_data"] = parse_json_field(
                clean_flat.get("category_data_json") or clean_flat.get("category_data"), {}
            )
            parsed["raw_cells"] = parse_json_field(
                clean_flat.get("raw_cells_json") or clean_flat.get("raw_cells"), []
            )
            for field in (
                "year",
                "draw_index",
                "quarter",
                "month",
                "day",
                "weekday",
                "iso_week",
                "number_count",
                "unique_count",
                "odd_count",
                "even_count",
                "low_count",
                "high_count",
                "consecutive_pairs",
            ):
                coerce_int_field(parsed, field)
            rows.append(parsed)
            flat_rows.append(clean_flat)
    return rows, flat_rows, fields


def load_history_data(data_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str], str]:
    csv_path = data_dir / "lottery_history.csv"
    if csv_path.exists():
        rows, flat_rows, fields = load_history_csv(csv_path)
        return rows, flat_rows, fields, str(csv_path.relative_to(ROOT))
    legacy_path = data_dir / "archive_results.jsonl"
    rows = load_jsonl(legacy_path)
    return rows, [], [], str(legacy_path.relative_to(ROOT))


def parse_date(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return datetime.min


def as_ints(values: Any) -> list[int]:
    if not isinstance(values, list):
        return []
    out: list[int] = []
    for value in values:
        try:
            out.append(int(value))
        except (TypeError, ValueError):
            continue
    return out


class LotoData:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.history_path = data_dir / "lottery_history.csv"
        self.archive_rows, self.flat_rows, self.csv_fields, self.data_source = load_history_data(data_dir)
        self.by_game: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in self.archive_rows:
            game = row.get("game")
            if game in GAME_CONFIGS:
                self.by_game[game].append(row)
        for rows in self.by_game.values():
            rows.sort(key=lambda item: parse_date(item.get("draw_date_iso", "")))
        self._stats_cache: dict[str, dict[str, Any]] = {}
        self._ml: Any | None = None
        self._ml_error: str | None = None
        self._vectors: Any | None = None
        self._vectors_error: str | None = None
        self._live_snapshot = self.load_live_snapshot()

    def ml_status(self) -> dict[str, Any]:
        models_dir = self.data_dir / "ml_models"
        available_models = sorted(path.name for path in models_dir.glob("*") if path.is_file()) if models_dir.exists() else []
        status: dict[str, Any] = {
            "enabled": ML_MODULE_PATH.exists() and self._ml_error is None,
            "status": "loaded" if self._ml is not None else "lazy",
            "loaded": self._ml is not None,
            "runtime_training": os.getenv("ALLOW_RUNTIME_TRAINING", "").lower() in {"1", "true", "yes"},
            "available_models": available_models,
        }
        if self._ml_error:
            status["error"] = self._ml_error
        if self._ml is not None:
            status.update(self._ml.available())
        return status

    def get_ml(self) -> Any:
        if self._ml is not None:
            return self._ml
        if not ML_MODULE_PATH.exists():
            raise RuntimeError("ML engine module is not available")
        try:
            from ml_engine import MLEngine

            self._ml = MLEngine(self.data_dir, GAME_CONFIGS)
            self._ml_error = None
            return self._ml
        except Exception as exc:
            self._ml_error = str(exc)
            raise RuntimeError("ML dependencies are not available. Run: pip install -r backend/requirements.txt") from exc

    def get_vectors(self, required: bool = True) -> Any | None:
        if self._vectors is not None:
            return self._vectors
        if not VECTOR_MODULE_PATH.exists():
            if required:
                raise RuntimeError("Vector store module is not available")
            return None
        try:
            from vector_store import DrawVectorStore

            self._vectors = DrawVectorStore(self.data_dir, GAME_CONFIGS)
            self._vectors_error = None
            return self._vectors
        except Exception as exc:
            self._vectors_error = str(exc)
            if required:
                raise RuntimeError("Vector store dependencies are not available") from exc
            return None

    def load_live_snapshot(self) -> dict[str, dict[str, str]]:
        path = self.data_dir / "pages.jsonl"
        if not path.exists():
            return {}
        try:
            with path.open(encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    row = json.loads(line)
                    url = row.get("url", "").rstrip("/")
                    if url.endswith("noroc-chior.ro"):
                        lines = [part.strip() for part in row.get("text", "").splitlines() if part.strip()]
                        return self.parse_live_snapshot(lines)
        except (OSError, json.JSONDecodeError, ValueError):
            return {}
        return {}

    def parse_live_snapshot(self, lines: list[str]) -> dict[str, dict[str, str]]:
        markers = {
            "latest": "Cea mai recenta extragere:",
            "report": "Report Cat 1:",
            "next": "Urmatoarea extragere:",
        }
        indexes = {key: lines.index(label) for key, label in markers.items() if label in lines}
        if len(indexes) != len(markers):
            return {}

        latest_dates = lines[indexes["latest"] + 1 : indexes["latest"] + 1 + len(LIVE_GAME_ORDER)]
        reports = lines[indexes["report"] + 1 : indexes["report"] + 1 + len(LIVE_GAME_ORDER)]
        next_dates = lines[indexes["next"] + 1 : indexes["next"] + 1 + len(LIVE_GAME_ORDER)]

        snapshot: dict[str, dict[str, str]] = {}
        for index, game in enumerate(LIVE_GAME_ORDER):
            snapshot[game] = {
                "latest_draw_raw": latest_dates[index] if index < len(latest_dates) else "",
                "report_cat1": reports[index] if index < len(reports) else "",
                "next_draw_raw": next_dates[index] if index < len(next_dates) else "",
            }
        return snapshot

    def summary(self) -> dict[str, Any]:
        games = []
        for game, config in GAME_CONFIGS.items():
            rows = self.by_game.get(game, [])
            years = sorted({int(row.get("year", 0)) for row in rows if row.get("year")})
            latest = rows[-1] if rows else None
            live = self._live_snapshot.get(game, {})
            games.append({
                "key": game,
                "label": config["label"],
                "draws": len(rows),
                "first_year": years[0] if years else None,
                "last_year": years[-1] if years else None,
                "latest": self.public_draw(latest) if latest else None,
                "next_draw_raw": live.get("next_draw_raw", ""),
                "report_cat1": live.get("report_cat1", ""),
            })
        return {
            "name": "loto-gpt",
            "archive_rows": len(self.archive_rows),
            "data_dir": str(self.data_dir.relative_to(ROOT)),
            "data_source": self.data_source,
            "csv_fields": len(self.csv_fields),
            "games": games,
            "strategies": [{"key": key, "label": label} for key, label in STRATEGIES.items()],
            "ml": self.ml_status(),
        }

    def public_draw(self, row: dict[str, Any] | None) -> dict[str, Any] | None:
        if not row:
            return None
        return {
            "row_id": row.get("row_id", ""),
            "game": row.get("game"),
            "game_label": row.get("game_label"),
            "draw_index": row.get("draw_index", ""),
            "year": row.get("year"),
            "quarter": row.get("quarter", ""),
            "month": row.get("month", ""),
            "month_name": row.get("month_name", ""),
            "day": row.get("day", ""),
            "weekday": row.get("weekday", ""),
            "weekday_name": row.get("weekday_name", ""),
            "iso_week": row.get("iso_week", ""),
            "draw_date_raw": row.get("draw_date_raw"),
            "draw_date_iso": row.get("draw_date_iso"),
            "drawn_numbers": row.get("drawn_numbers", []),
            "drawn_numbers_csv": row.get("drawn_numbers_csv", ""),
            "drawn_numbers_sorted_csv": row.get("drawn_numbers_sorted_csv", ""),
            "joker_number": row.get("joker_number", ""),
            "noroc_code": row.get("noroc_code", ""),
            "fond_castiguri": row.get("fond_castiguri", ""),
            "fond_castiguri_value": row.get("fond_castiguri_value", ""),
            "category_data": row.get("category_data", {}),
            "raw_cells": row.get("raw_cells", []),
            "source_url": row.get("source_url", ""),
            "rag_text": row.get("rag_text", ""),
        }

    def draws(self, game: str, limit: int = 50, year: int | None = None) -> list[dict[str, Any]]:
        rows = list(reversed(self.by_game.get(game, [])))
        if year:
            rows = [row for row in rows if int(row.get("year", 0)) == year]
        return [self.public_draw(row) for row in rows[: max(1, min(limit, 500))] if row]

    def draw_history(self, game: str, limit: int = 50, offset: int = 0, year: int | None = None) -> dict[str, Any]:
        all_rows = self.by_game.get(game, [])
        years = sorted({int(row.get("year", 0)) for row in all_rows if row.get("year")}, reverse=True)
        rows = list(reversed(all_rows))
        if year:
            rows = [row for row in rows if int(row.get("year", 0)) == year]
        total = len(rows)
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        return {
            "draws": [self.public_draw(row) for row in rows[offset: offset + limit] if row],
            "total": total,
            "years": years,
            "limit": limit,
            "offset": offset,
        }



    def dataset(self) -> dict[str, Any]:
        games = []
        for game, rows in self.by_game.items():
            dates = [str(row.get("draw_date_iso", "")) for row in rows if row.get("draw_date_iso")]
            years = sorted({int(row.get("year", 0)) for row in rows if row.get("year")})
            games.append({
                "game": game,
                "label": GAME_CONFIGS.get(game, {}).get("label", game),
                "rows": len(rows),
                "first_date": dates[0] if dates else None,
                "last_date": dates[-1] if dates else None,
                "first_year": years[0] if years else None,
                "last_year": years[-1] if years else None,
            })
        return {
            "source": self.data_source,
            "csv_path": str(self.history_path.relative_to(ROOT)) if self.history_path.exists() else "",
            "rows": len(self.archive_rows),
            "fields": self.csv_fields,
            "field_count": len(self.csv_fields),
            "games": sorted(games, key=lambda item: LIVE_GAME_ORDER.index(item["game"]) if item["game"] in LIVE_GAME_ORDER else 99),
            "standalone": self.history_path.exists(),
        }

    def flat_history(
        self,
        game: str | None = None,
        limit: int = 100,
        offset: int = 0,
        year: int | None = None,
        month: int | None = None,
        q: str | None = None,
    ) -> dict[str, Any]:
        rows = list(reversed(self.flat_rows))
        if game:
            rows = [row for row in rows if row.get("game") == game]
        if year:
            rows = [row for row in rows if row.get("year") == str(year)]
        if month:
            rows = [row for row in rows if row.get("month") == str(month)]
        if q:
            needle = q.lower()
            rows = [
                row for row in rows
                if needle in row.get("rag_text", "").lower()
                or needle in row.get("drawn_numbers_csv", "").lower()
                or needle in row.get("draw_date_raw", "").lower()
            ]
        total = len(rows)
        limit = max(1, min(limit, 5000))
        offset = max(0, offset)
        return {
            "rows": rows[offset: offset + limit],
            "total": total,
            "limit": limit,
            "offset": offset,
            "fields": self.csv_fields,
            "source": self.data_source,
        }

    def rag_text_search(self, q: str, game: str | None = None, limit: int = 20) -> dict[str, Any]:
        needle = q.strip().lower()
        if not needle:
            return {"query": q, "matches": [], "total": 0, "source": self.data_source}
        matches = []
        for row in reversed(self.archive_rows):
            if game and row.get("game") != game:
                continue
            text = str(row.get("rag_text", ""))
            haystack = " ".join([
                text,
                str(row.get("drawn_numbers_csv", "")),
                str(row.get("draw_date_raw", "")),
                str(row.get("draw_date_iso", "")),
            ]).lower()
            if needle not in haystack:
                continue
            item = self.public_draw(row)
            item["match_text"] = text[:600]
            matches.append(item)
            if len(matches) >= max(1, min(limit, 200)):
                break
        return {"query": q, "matches": matches, "total": len(matches), "source": self.data_source}

    def stats(self, game: str) -> dict[str, Any]:
        if game in self._stats_cache:
            return self._stats_cache[game]
        rows = self.by_game.get(game, [])
        config = GAME_CONFIGS[game]
        pool = list(range(1, config["pool"] + 1))
        counts: Counter[int] = Counter()
        joker_counts: Counter[int] = Counter()
        by_year: Counter[int] = Counter()
        last_seen: dict[int, int] = {}
        pair_counts: Counter[tuple[int, int]] = Counter()

        for index, row in enumerate(rows):
            by_year[int(row.get("year", 0))] += 1
            if game == "noroc":
                code = "".join(str(value) for value in row.get("drawn_numbers", []))
                for digit in code:
                    if digit.isdigit():
                        counts[int(digit)] += 1
                continue
            nums = as_ints(row.get("drawn_numbers", []))[: config["pick"]]
            for number in nums:
                counts[number] += 1
                last_seen[number] = index
            for pair in itertools.combinations(sorted(set(nums)), 2):
                pair_counts[pair] += 1
            joker = row.get("joker_number")
            if str(joker).isdigit():
                joker_counts[int(joker)] += 1

        latest_index = max(len(rows) - 1, 0)
        number_space = range(10) if game == "noroc" else pool
        frequency = [
            {"number": number, "count": counts[number], "share": counts[number] / max(1, len(rows))}
            for number in number_space
        ]
        frequency.sort(key=lambda item: (-item["count"], item["number"]))
        cold = sorted(frequency, key=lambda item: (item["count"], item["number"]))
        overdue = []
        if game != "noroc":
            for number in pool:
                gap = latest_index - last_seen.get(number, -1)
                overdue.append({"number": number, "draws_since_seen": gap})
            overdue.sort(key=lambda item: (-item["draws_since_seen"], item["number"]))
        joker_frequency = []
        if config.get("joker_pool"):
            joker_frequency = [
                {"number": number, "count": joker_counts[number]}
                for number in range(1, config["joker_pool"] + 1)
            ]
            joker_frequency.sort(key=lambda item: (-item["count"], item["number"]))

        pair_leaders = [{"pair": list(pair), "count": count} for pair, count in pair_counts.most_common(20)]
        result = {
            "game": game,
            "label": config["label"],
            "draws": len(rows),
            "latest": self.public_draw(rows[-1]) if rows else None,
            "frequency": frequency,
            "hot": frequency[:12],
            "cold": cold[:12],
            "overdue": overdue[:12],
            "joker_frequency": joker_frequency,
            "pair_leaders": pair_leaders,
            "by_year": [{"year": year, "draws": count} for year, count in sorted(by_year.items()) if year],
        }
        self._stats_cache[game] = result
        return result

    def number_analysis(self, game: str) -> dict[str, Any]:
        rows = self.by_game.get(game, [])
        config = GAME_CONFIGS[game]
        pool = config["pool"]
        pick = config["pick"]
        stats = self.stats(game)
        count_by = {item["number"]: int(item.get("count", 0)) for item in stats.get("frequency", [])}
        cold_set = {item["number"] for item in stats.get("cold", [])[:12]}
        hot_set = {item["number"] for item in stats.get("hot", [])[:12]}
        overdue_by = {item["number"]: int(item.get("draws_since_seen", 0)) for item in stats.get("overdue", [])}

        by_number_year: dict[int, Counter[int]] = {number: Counter() for number in range(1, pool + 1)}
        by_number_month: dict[int, Counter[int]] = {number: Counter() for number in range(1, pool + 1)}
        last_draw: dict[int, dict[str, Any]] = {}
        recent_counts: Counter[int] = Counter()
        recent_rows = rows[-50:] if len(rows) > 50 else rows

        for row in rows:
            year = int(row.get("year", 0) or 0)
            month = int(row.get("month", 0) or 0)
            numbers = set(as_ints(row.get("drawn_numbers", []))[:pick])
            for number in numbers:
                if 1 <= number <= pool:
                    if year:
                        by_number_year[number][year] += 1
                    if month:
                        by_number_month[number][month] += 1
                    last_draw[number] = self.public_draw(row)

        for row in recent_rows:
            for number in set(as_ints(row.get("drawn_numbers", []))[:pick]):
                if 1 <= number <= pool:
                    recent_counts[number] += 1

        max_count = max(count_by.values() or [1])
        max_recent = max(recent_counts.values() or [1])
        max_gap = max(overdue_by.values() or [1])
        years = sorted({int(row.get("year", 0)) for row in rows if row.get("year")})
        month_names = [
            "ian", "feb", "mar", "apr", "mai", "iun",
            "iul", "aug", "sep", "oct", "noi", "dec",
        ]

        numbers = []
        for number in range(1, pool + 1):
            count = count_by.get(number, 0)
            gap = overdue_by.get(number, len(rows))
            recent = recent_counts[number]
            frequency_score = count / max(1, max_count)
            recent_score = recent / max(1, max_recent)
            overdue_score = gap / max(1, max_gap)
            score = round(100 * (0.50 * frequency_score + 0.25 * recent_score + 0.25 * overdue_score), 2)
            if number in hot_set:
                signal = "hot"
            elif number in cold_set:
                signal = "cold"
            elif gap >= max(12, max_gap * 0.60):
                signal = "overdue"
            else:
                signal = "neutral"

            numbers.append({
                "number": number,
                "count": count,
                "recent_count": recent,
                "score": score,
                "share": round(count / max(1, len(rows)) * 100, 2),
                "draws_since_seen": gap,
                "signal": signal,
                "last_draw": last_draw.get(number),
                "by_year": [
                    {"year": year, "count": by_number_year[number][year]}
                    for year in reversed(years)
                ],
                "by_month": [
                    {"month": month, "label": month_names[month - 1], "count": by_number_month[number][month]}
                    for month in range(1, 13)
                ],
            })

        numbers.sort(key=lambda item: (-item["score"], item["number"]))
        return {
            "game": game,
            "label": config["label"],
            "draws": len(rows),
            "pool": pool,
            "pick": pick,
            "years": years,
            "numbers": numbers,
            "joker_frequency": stats.get("joker_frequency", []),
        }

    def score_components(self, game: str, nums: list[int]) -> dict[str, float]:
        stats = self.stats(game)
        count_by = {item["number"]: item["count"] for item in stats["frequency"]}
        overdue_by = {item["number"]: item["draws_since_seen"] for item in stats.get("overdue", [])}
        max_count = max(count_by.values() or [1])
        max_gap = max(overdue_by.values() or [1])
        pool = GAME_CONFIGS[game]["pool"]
        hot = sum(count_by.get(number, 0) / max_count for number in nums) / max(1, len(nums))
        overdue = sum(overdue_by.get(number, 0) / max_gap for number in nums) / max(1, len(nums))
        span = (max(nums) - min(nums)) / pool if nums else 0.0
        odd_balance = 1 - abs(sum(number % 2 for number in nums) - len(nums) / 2) / max(1, len(nums) / 2)
        pair_map = {tuple(item["pair"]): item["count"] for item in stats.get("pair_leaders", [])}
        pairs = list(itertools.combinations(sorted(nums), 2))
        pair_score = 0.0
        if pairs:
            max_pair = max(pair_map.values() or [1])
            pair_score = sum(pair_map.get(pair, 0) / max_pair for pair in pairs) / len(pairs)
        cold = 1 - hot
        total = round(100 * (0.36 * hot + 0.28 * overdue + 0.14 * span + 0.12 * odd_balance + 0.10 * pair_score), 2)
        return {
            "total": total,
            "hot": round(hot * 100, 2),
            "cold": round(cold * 100, 2),
            "overdue": round(overdue * 100, 2),
            "pair_strength": round(pair_score * 100, 2),
            "spread": round(span * 100, 2),
            "balance": round(odd_balance * 100, 2),
        }

    def ticket_score(self, game: str, nums: list[int]) -> float:
        return self.score_components(game, nums)["total"]

    def normalize_selection(self, game: str, numbers: list[int], joker: int | None = None, system: bool = False) -> tuple[list[int], int | None]:
        config = GAME_CONFIGS[game]
        selected = sorted({int(number) for number in numbers if 1 <= int(number) <= config["pool"]})
        max_numbers = config["pool"] if system else config["pick"]
        if len(selected) < 1:
            raise ValueError(f"Select between 1 and {max_numbers} numbers from 1 to {config['pool']}")
        if len(selected) > max_numbers:
            raise ValueError(f"Too many numbers. Maximum for {config['label']} is {max_numbers}")
        joker_value = None
        if game == "joker":
            if joker is not None and 1 <= int(joker) <= config["joker_pool"]:
                joker_value = int(joker)
        return selected, joker_value

    def last_draw_for_number(self, game: str, number: int) -> tuple[str, str]:
        rows = self.by_game.get(game, [])
        for row in reversed(rows):
            if number in as_ints(row.get("drawn_numbers", [])):
                return str(row.get("draw_date_raw", "")), str(row.get("draw_date_iso", ""))
        return "", ""

    def number_breakdown(self, game: str, numbers: list[int]) -> list[dict[str, Any]]:
        stats = self.stats(game)
        count_by = {item["number"]: item for item in stats["frequency"]}
        overdue_by = {item["number"]: item["draws_since_seen"] for item in stats.get("overdue", [])}
        hot_set = {item["number"] for item in stats.get("hot", [])[:12]}
        cold_set = {item["number"] for item in stats.get("cold", [])[:12]}
        rows = []
        for number in numbers:
            freq = count_by.get(number, {"count": 0, "share": 0})
            gap = overdue_by.get(number, 0)
            last_raw, last_iso = self.last_draw_for_number(game, number)
            if number in hot_set:
                signal = "hot"
            elif number in cold_set:
                signal = "cold"
            elif gap >= 12:
                signal = "overdue"
            else:
                signal = "neutral"
            rows.append({
                "number": number,
                "count": freq.get("count", 0),
                "share": round(float(freq.get("share", 0)) * 100, 2),
                "draws_since_seen": gap,
                "last_draw_date_raw": last_raw,
                "last_draw_date_iso": last_iso,
                "signal": signal,
            })
        return rows

    def line_profile(self, game: str, numbers: list[int], joker: int | None = None) -> dict[str, Any]:
        selected, joker_value = self.normalize_selection(game, numbers, joker)
        components = self.score_components(game, selected)
        decades: Counter[int] = Counter()
        for number in selected:
            decades[(number - 1) // 10] += 1
        return {
            "numbers": selected,
            "joker": joker_value,
            "score": components["total"],
            "components": components,
            "number_breakdown": self.number_breakdown(game, selected),
            "profile": {
                "sum": sum(selected),
                "average": round(sum(selected) / len(selected), 2),
                "odd_count": sum(1 for number in selected if number % 2 == 1),
                "even_count": sum(1 for number in selected if number % 2 == 0),
                "span": max(selected) - min(selected) if selected else 0,
                "low": min(selected) if selected else None,
                "high": max(selected) if selected else None,
                "decades": [{"decade": key, "count": value} for key, value in sorted(decades.items())],
            },
        }

    def match_weight(self, hits: int, joker_hit: bool = False) -> float:
        weights = {0: 0.0, 1: 0.05, 2: 0.35, 3: 1.0, 4: 3.0, 5: 6.0, 6: 10.0}
        return weights.get(hits, 0.0) + (2.5 if joker_hit else 0.0)

    def monte_carlo_backtest(self, game: str, numbers: list[int], joker: int | None, simulations: int, seed: int | None = None) -> dict[str, Any]:
        selected, joker_value = self.normalize_selection(game, numbers, joker)
        rows = self.by_game.get(game, [])
        if not rows:
            return {"simulations": 0, "expected_match_score": 0.0, "distribution": []}
        config = GAME_CONFIGS[game]
        rng = random.Random(seed)
        sample_size = max(150, min(int(simulations), 1200))
        distribution: Counter[str] = Counter()
        total_score = 0.0
        for _ in range(sample_size):
            row = rows[rng.randrange(len(rows))]
            drawn = set(as_ints(row.get("drawn_numbers", []))[: config["pick"]])
            hits = len(drawn.intersection(selected))
            joker_hit = False
            if game == "joker" and joker_value is not None and str(row.get("joker_number", "")).isdigit():
                joker_hit = int(row.get("joker_number")) == joker_value
            key = f"{hits}+J" if joker_hit else str(hits)
            distribution[key] += 1
            total_score += self.match_weight(hits, joker_hit)
        return {
            "simulations": sample_size,
            "expected_match_score": round(total_score / sample_size, 4),
            "distribution": [
                {"match": key, "count": count, "rate": round(count / sample_size * 100, 2)}
                for key, count in sorted(distribution.items(), key=lambda item: item[0])
            ],
        }

    def calculate(self, game: str, numbers: list[int], joker: int | None = None, simulations: int = 2500) -> dict[str, Any]:
        if game == "noroc":
            return self.calculate_noroc(numbers)
        profile = self.line_profile(game, numbers, joker)
        backtest = self.monte_carlo_backtest(game, profile["numbers"], profile.get("joker"), simulations)
        history_draws = len(self.by_game.get(game, []))
        return {
            "game": game,
            "label": GAME_CONFIGS[game]["label"],
            "history_draws": history_draws,
            **profile,
            "backtest": backtest,
            "algorithm": {
                "name": "history-based composite score",
                "based_on": "lottery_history.csv draw history",
                "history_draws": history_draws,
                "weights": {
                    "hot": 0.36,
                    "overdue": 0.28,
                    "spread": 0.14,
                    "balance": 0.12,
                    "pair_strength": 0.10,
                },
            },
        }

    def calculate_noroc(self, numbers: list[int] | str) -> dict[str, Any]:
        if isinstance(numbers, str):
            code = re.sub(r"\D", "", numbers).zfill(7)[-7:]
        else:
            code = "".join(str(value) for value in numbers)
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
        if len(code) != 7:
            raise ValueError("Noroc code must contain 7 digits")
        rows = self.by_game.get("noroc", [])
        positional: list[Counter[str]] = [Counter() for _ in range(7)]
        for row in rows:
            row_code = "".join(str(value) for value in row.get("drawn_numbers", []))
            row_code = re.sub(r"\D", "", row_code).zfill(7)[-7:]
            for index, digit in enumerate(row_code):
                positional[index][digit] += 1
        breakdown = []
        total = 0.0
        for index, digit in enumerate(code):
            count = positional[index][digit]
            max_count = max(positional[index].values() or [1])
            share = count / max(1, len(rows))
            total += share
            breakdown.append({
                "position": index + 1,
                "digit": digit,
                "count": count,
                "share": round(share * 100, 2),
                "signal": "hot" if count >= max_count * 0.85 else "cold" if count <= max_count * 0.4 else "neutral",
            })
        return {
            "game": "noroc",
            "label": "Noroc",
            "history_draws": len(rows),
            "code": code,
            "score": round(total / 7 * 100, 2),
            "number_breakdown": breakdown,
            "profile": {"positions": 7},
            "algorithm": {"name": "history-based positional digit scoring", "history_draws": len(rows)},
        }

    def line_profile_system(self, game: str, numbers: list[int], joker: int | None = None) -> dict[str, Any]:
        selected, joker_value = self.normalize_selection(game, numbers, joker, system=True)
        components = self.score_components(game, selected[: GAME_CONFIGS[game]["pick"]])
        decades: Counter[int] = Counter()
        for number in selected:
            decades[(number - 1) // 10] += 1
        return {
            "numbers": selected,
            "joker": joker_value,
            "score": components["total"],
            "components": components,
            "number_breakdown": self.number_breakdown(game, selected),
            "profile": {
                "sum": sum(selected),
                "average": round(sum(selected) / len(selected), 2),
                "odd_count": sum(1 for number in selected if number % 2 == 1),
                "even_count": sum(1 for number in selected if number % 2 == 0),
                "span": max(selected) - min(selected) if selected else 0,
                "low": min(selected) if selected else None,
                "high": max(selected) if selected else None,
                "decades": [{"decade": key, "count": value} for key, value in sorted(decades.items())],
            },
        }

    def analyze(self, game: str, numbers: list[int], joker: int | None = None, limit: int = 80, simulations: int = 2500, include_ml: bool = False) -> dict[str, Any]:
        if game == "noroc":
            calc = self.calculate_noroc(numbers)
            return {**calc, "histogram": [], "match_rates": [], "matches": [], "matches_by_count": {}, "total_draws": len(self.by_game.get("noroc", []))}
        config = GAME_CONFIGS[game]
        system_mode = len({int(number) for number in numbers if 1 <= int(number) <= config["pool"]}) > config["pick"]
        profile = self.line_profile_system(game, numbers, joker) if system_mode else self.line_profile(game, numbers, joker)
        selected = profile["numbers"]
        joker_value = profile.get("joker")
        rows = list(reversed(self.by_game.get(game, [])))
        histogram: Counter[str] = Counter()
        matches = []
        matches_by_count: dict[str, list[dict[str, Any]]] = {str(i): [] for i in range(1, config["pick"] + 1)}
        best_match = None
        per_level_limit = max(10, min(limit, 200))
        for row in rows:
            drawn = set(as_ints(row.get("drawn_numbers", []))[: config["pick"]])
            hit_count = len(drawn.intersection(selected))
            joker_hit = False
            if game == "joker" and joker_value is not None and str(row.get("joker_number", "")).isdigit():
                joker_hit = int(row.get("joker_number")) == joker_value
            key = f"{hit_count}+J" if joker_hit else str(hit_count)
            histogram[key] += 1
            if hit_count >= 2 or joker_hit:
                item = self.public_draw(row)
                item["matched_numbers"] = sorted(drawn.intersection(selected))
                item["match_count"] = hit_count
                item["joker_match"] = joker_hit
                matches.append(item)
                bucket = matches_by_count.get(str(hit_count))
                if bucket is not None and len(bucket) < per_level_limit:
                    bucket.append(item)
            if best_match is None or hit_count > best_match["match_count"] or (hit_count == best_match["match_count"] and joker_hit and not best_match.get("joker_match")):
                best_match = {
                    "draw": self.public_draw(row),
                    "match_count": hit_count,
                    "joker_match": joker_hit,
                    "matched_numbers": sorted(drawn.intersection(selected)),
                }
        total_draws = len(rows)
        match_rates = [
            {
                "match": key,
                "count": count,
                "rate": round(count / max(1, total_draws) * 100, 2),
            }
            for key, count in sorted(histogram.items(), key=lambda item: item[0])
        ]
        backtest = self.monte_carlo_backtest(game, selected[: config["pick"]], joker_value, simulations)
        result = {
            "game": game,
            "label": config["label"],
            "history_draws": total_draws,
            **profile,
            "total_draws": total_draws,
            "histogram": match_rates,
            "match_rates": match_rates,
            "best_match": best_match,
            "backtest": backtest,
            "matches": matches[: max(1, min(limit, 300))],
            "matches_by_count": matches_by_count,
            "algorithm": {
                "name": "history-based full archive scan + monte carlo backtest",
                "based_on": "lottery_history.csv draw history",
                "archive_draws": total_draws,
                "history_draws": total_draws,
                "simulations": backtest["simulations"],
            },
        }
        if include_ml and game == "6din49" and len(rows) >= 30:
            try:
                ml_engine = self.get_ml()
                ml_payload = ml_engine.predict_detailed(game, list(self.by_game.get(game, [])))
                rag_block = None
                vector_store = self.get_vectors(required=False)
                if vector_store:
                    rag_block = vector_store.rag_report(game, list(self.by_game.get(game, [])), numbers=selected)
                result["ml"] = {
                    "models": ml_payload.get("models"),
                    "top_numbers": ml_payload.get("top_numbers", [])[:12],
                    "line_score": ml_engine.score_line_ml(selected, ml_payload.get("predictions", [])),
                    "features": ml_payload.get("features"),
                    "training_note": ml_payload.get("training_note"),
                    "device": ml_payload.get("device"),
                }
                if rag_block:
                    result["rag"] = {
                        "similar_draws": rag_block.get("similar_draws", [])[:8],
                        "retrieval_top_numbers": rag_block.get("retrieval_top_numbers", [])[:8],
                        "indexed_draws": rag_block.get("indexed_draws"),
                        "method": rag_block.get("method"),
                    }
            except Exception as exc:
                result["ml"] = {"status": "error", "error": str(exc)}
        return result

    def generate(self, game: str, strategy: str, ticket_count: int, seed: int | None = None, simulations: int = 2500) -> dict[str, Any]:
        if game == "noroc":
            if strategy in {"ml_sklearn", "ml_lstm"}:
                return self.generate_ml(game, strategy, ticket_count, seed)
            return self.generate_noroc(strategy, ticket_count, seed)
        if strategy in {"ml_sklearn", "ml_lstm"}:
            return self.generate_ml(game, strategy, ticket_count, seed)
        strategy = strategy if strategy in STRATEGIES else "balanced"
        rng = random.Random(seed)
        config = GAME_CONFIGS[game]
        pool = list(range(1, config["pool"] + 1))
        pick = config["pick"]
        weights = self.strategy_weights(game, strategy)
        tickets = []
        seen: set[tuple[int, ...]] = set()
        total = max(200, min(int(simulations), 5000))

        if strategy == "monte_carlo":
            candidate_target = max(ticket_count * 30, min(total, 700))
            shortlist_size = max(ticket_count * 8, min(candidate_target, 80))
            backtest_sims = max(150, min(500, total // 4))
            candidates: list[tuple[float, list[int], int | None]] = []
            candidate_seen: set[tuple[int, ...]] = set()
            attempts = 0
            while len(candidates) < candidate_target and attempts < candidate_target * 5:
                attempts += 1
                nums = weighted_sample(pool, weights, pick, rng)
                key = tuple(nums)
                if key in candidate_seen:
                    continue
                candidate_seen.add(key)
                joker = None
                if game == "joker":
                    joker_stats = self.stats(game).get("joker_frequency", [])
                    joker_weights = {item["number"]: item["count"] + 1 for item in joker_stats}
                    joker = weighted_choice(list(range(1, config["joker_pool"] + 1)), joker_weights, rng)
                candidates.append((self.ticket_score(game, nums), nums, joker))

            rescored: list[tuple[float, list[int], int | None]] = []
            candidates.sort(key=lambda item: item[0], reverse=True)
            for composite, nums, joker in candidates[:shortlist_size]:
                backtest = self.monte_carlo_backtest(game, nums, joker, backtest_sims, rng.randint(0, 2_000_000_000))
                score = round(0.55 * backtest["expected_match_score"] * 10 + 0.45 * composite, 2)
                rescored.append((score, nums, joker))

            rescored.sort(key=lambda item: item[0], reverse=True)
            for score, nums, joker in rescored:
                key = tuple(nums)
                if key in seen:
                    continue
                seen.add(key)
                tickets.append(self.ticket_payload(game, nums, score, strategy, rng, joker=joker))
                if len(tickets) >= ticket_count:
                    break
        else:
            attempts = 0
            while len(tickets) < ticket_count and attempts < ticket_count * 80:
                attempts += 1
                nums = weighted_sample(pool, weights, pick, rng)
                key = tuple(nums)
                if key in seen:
                    continue
                seen.add(key)
                tickets.append(self.ticket_payload(game, nums, self.ticket_score(game, nums), strategy, rng))

        history_draws = len(self.by_game.get(game, []))
        return {
            "game": game,
            "strategy": strategy,
            "strategy_label": STRATEGIES[strategy],
            "history_draws": history_draws,
            "tickets": tickets,
            "simulations": total if strategy == "monte_carlo" else None,
            "algorithm": self.algorithm_meta(strategy),
            "source": "history-based: local draw archive + statistical/simulation methods",
            "disclaimer": "Lottery draws are random. This is analysis and generation, not a guaranteed prediction.",
        }

    def generate_ml(self, game: str, strategy: str, ticket_count: int, seed: int | None = None) -> dict[str, Any]:
        ml_engine = self.get_ml()
        model_type = "sklearn" if strategy == "ml_sklearn" else "lstm"
        rng = random.Random(seed)
        rows = self.by_game.get(game, [])
        min_draws = 16 if model_type == "lstm" else 30
        if len(rows) < min_draws:
            raise ValueError(f"Not enough draw history for ML training ({len(rows)} rows, need {min_draws})")
        result = ml_engine.generate_tickets(
            game,
            rows,
            model_type,
            ticket_count,
            seed,
            self.ticket_score,
            self.ticket_payload,
            weighted_sample,
            weighted_choice,
            rng,
        )
        history_draws = len(rows)
        return {
            "game": game,
            "strategy": strategy,
            "strategy_label": STRATEGIES[strategy],
            "history_draws": history_draws,
            "tickets": result["tickets"],
            "simulations": None,
            "algorithm": result["algorithm"],
            "top_probabilities": result.get("top_probabilities", []),
            "source": "machine learning on CSV draw archive (pandas + scikit-learn + TensorFlow LSTM)",
            "disclaimer": "Lottery draws are random. ML finds patterns in history; it cannot guarantee future results.",
        }

    def ml_report(self, game: str) -> dict[str, Any]:
        ml_engine = self.get_ml()
        rows = self.by_game.get(game, [])
        return ml_engine.model_report(game, rows)

    def ml_predict(self, game: str, numbers: list[int] | None = None) -> dict[str, Any]:
        ml_engine = self.get_ml()
        rows = self.by_game.get(game, [])
        if len(rows) < 30:
            raise ValueError(f"Not enough draw history for ML ({len(rows)} rows, need 30)")
        payload = ml_engine.predict_detailed(game, rows)
        vector_store = self.get_vectors(required=False)
        if vector_store and game != "noroc":
            rag = vector_store.rag_report(game, rows, numbers=numbers or None)
            rag_weights = vector_store.retrieval_weights(game, rows, numbers=numbers or None)
            payload["rag"] = rag
            # Blend RAG retrieval into final probabilities (35% RAG + 65% ML)
            for item in payload.get("predictions", []):
                n = item["number"]
                rag_w = rag_weights.get(n, 0.001)
                ml_b = item.get("probability_blend", 0.001)
                item["probability_rag"] = round(rag_w, 4)
                item["probability_final"] = round(0.35 * rag_w + 0.65 * ml_b, 4)
            payload["predictions"].sort(key=lambda x: x.get("probability_final", 0), reverse=True)
            for rank, item in enumerate(payload["predictions"], start=1):
                item["rank"] = rank
            payload["top_numbers"] = payload["predictions"][:15]
            payload["blend_note"] = "final = 35% RAG retrieval + 65% ML (sklearn/LSTM)"
        return payload

    def rag_similar(self, game: str, numbers: list[int] | None = None, limit: int = 12) -> dict[str, Any]:
        vector_store = self.get_vectors(required=True)
        rows = self.by_game.get(game, [])
        if not rows:
            raise ValueError("No draw history")
        return vector_store.rag_report(game, rows, numbers=numbers or None)

    def algorithm_meta(self, strategy: str) -> dict[str, Any]:
        if strategy == "ml_sklearn":
            return {
                "name": "scikit-learn gradient boosting",
                "steps": [
                    "Engineer rolling frequency and gap features with pandas",
                    "Train per-number classifiers on archive transitions",
                    "Rank generated tickets by predicted appearance probability",
                ],
            }
        if strategy == "ml_lstm":
            return {
                "name": "LSTM sequence neural network",
                "steps": [
                    "Encode last 15 draws as multi-hot number sequences",
                    "Train stacked LSTM layers on historical draw transitions",
                    "Sample tickets from predicted next-draw probabilities",
                ],
            }
        if strategy == "monte_carlo":
            return {
                "name": "Monte Carlo archive backtest",
                "steps": [
                    "Build weighted candidate lines from archive signals",
                    "Bootstrap historical draws to estimate match yield",
                    "Rank tickets by blended backtest + composite score",
                ],
            }
        if strategy == "hot":
            return {"name": "Hot frequency weighting", "signal": "high draw frequency"}
        if strategy == "cold":
            return {"name": "Cold frequency weighting", "signal": "low draw frequency"}
        if strategy == "overdue":
            return {"name": "Overdue gap weighting", "signal": "long absence from results"}
        return {
            "name": "Balanced composite weighting",
            "weights": {"hot": 0.44, "overdue": 0.38, "cold": 0.18},
        }

    def generate_noroc(self, strategy: str, ticket_count: int, seed: int | None) -> dict[str, Any]:
        rng = random.Random(seed)
        rows = self.by_game.get("noroc", [])
        positional: list[Counter[str]] = [Counter() for _ in range(7)]
        for row in rows:
            code = "".join(str(value) for value in row.get("drawn_numbers", []))
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
            for index, digit in enumerate(code):
                positional[index][digit] += 1
        tickets = []
        seen = set()
        for _ in range(max(1, min(ticket_count, 20)) * 25):
            code = ""
            for index in range(7):
                digits = list("0123456789")
                counts = positional[index]
                if strategy == "cold":
                    max_count = max(counts.values() or [1])
                    weights = {int(d): max_count + 1 - counts[d] for d in digits}
                else:
                    weights = {int(d): counts[d] + 1 for d in digits}
                code += str(weighted_choice([int(d) for d in digits], weights, rng))
            if code in seen:
                continue
            seen.add(code)
            tickets.append({"code": code, "score": round(sum(positional[i][d] for i, d in enumerate(code)) / max(1, len(rows)), 4)})
            if len(tickets) >= ticket_count:
                break
        return {
            "game": "noroc",
            "strategy": strategy,
            "strategy_label": STRATEGIES.get(strategy, strategy),
            "tickets": tickets,
            "source": "historical Noroc digit archive",
            "disclaimer": "Lottery draws are random. This is analysis and generation, not a guaranteed prediction.",
        }

    def strategy_weights(self, game: str, strategy: str) -> dict[int, float]:
        stats = self.stats(game)
        config = GAME_CONFIGS[game]
        pool = list(range(1, config["pool"] + 1))
        count_by = {item["number"]: item["count"] for item in stats["frequency"]}
        overdue_by = {item["number"]: item["draws_since_seen"] for item in stats.get("overdue", [])}
        max_count = max(count_by.values() or [1])
        max_gap = max(overdue_by.values() or [1])
        weights: dict[int, float] = {}
        for number in pool:
            hot = (count_by.get(number, 0) + 1) / (max_count + 1)
            cold = (max_count + 1 - count_by.get(number, 0)) / (max_count + 1)
            overdue = (overdue_by.get(number, 0) + 1) / (max_gap + 1)
            if strategy == "hot":
                value = hot
            elif strategy == "cold":
                value = cold
            elif strategy == "overdue":
                value = overdue
            elif strategy == "monte_carlo":
                value = 0.42 * hot + 0.38 * overdue + 0.2 * cold
            else:
                value = 0.44 * hot + 0.38 * overdue + 0.18 * cold
            weights[number] = max(value, 0.001)
        return weights

    def ticket_payload(self, game: str, nums: list[int], score: float, strategy: str, rng: random.Random, joker: int | None = None) -> dict[str, Any]:
        components = self.score_components(game, nums)
        payload = {
            "numbers": nums,
            "score": score,
            "strategy": strategy,
            "components": components,
        }
        if game == "joker":
            if joker is None:
                joker_stats = self.stats(game).get("joker_frequency", [])
                weights = {item["number"]: item["count"] + 1 for item in joker_stats}
                joker = weighted_choice(list(range(1, GAME_CONFIGS[game]["joker_pool"] + 1)), weights, rng)
            payload["joker"] = joker
            backtest = self.monte_carlo_backtest(game, nums, joker, 300, rng.randint(0, 2_000_000_000))
            payload["backtest_score"] = backtest["expected_match_score"]
        return payload


DATA = LotoData(DATA_DIR)


def weighted_choice(items: list[int], weights: dict[int, float], rng: random.Random) -> int:
    total = sum(max(weights.get(item, 1.0), 0.001) for item in items)
    target = rng.random() * total
    upto = 0.0
    for item in items:
        upto += max(weights.get(item, 1.0), 0.001)
        if upto >= target:
            return item
    return items[-1]


def weighted_sample(items: list[int], weights: dict[int, float], count: int, rng: random.Random) -> list[int]:
    available = list(items)
    selected: list[int] = []
    for _ in range(min(count, len(available))):
        choice = weighted_choice(available, weights, rng)
        selected.append(choice)
        available.remove(choice)
    return sorted(selected)


def json_response(handler: SimpleHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def error_response(handler: SimpleHTTPRequestHandler, message: str, status: int = 400) -> None:
    json_response(handler, {"error": message}, status)


class LotoHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("api " + format % args + "\n")

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed.path, parse_qs(parsed.query))
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            error_response(self, "Not found", 404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            error_response(self, "Invalid JSON", 400)
            return
        self.handle_api_post(parsed.path, payload)

    def handle_api_get(self, path: str, query: dict[str, list[str]]) -> None:
        try:
            if path == "/api/health":
                json_response(self, {"ok": True, "app": "loto-gpt"})
            elif path == "/api/summary":
                json_response(self, DATA.summary())
            elif path == "/api/stats":
                game = self.require_game(query.get("game", ["6din49"])[0])
                json_response(self, DATA.stats(game))
            elif path == "/api/number-analysis":
                game = self.require_game(query.get("game", ["6din49"])[0])
                json_response(self, DATA.number_analysis(game))
            elif path == "/api/draws":
                game = self.require_game(query.get("game", ["6din49"])[0])
                limit = int(query.get("limit", ["50"])[0])
                offset = int(query.get("offset", ["0"])[0])
                year_value = query.get("year", [""])[0]
                year = int(year_value) if year_value else None
                json_response(self, DATA.draw_history(game, limit, offset, year))
            elif path == "/api/ml":
                game = self.require_game(query.get("game", ["6din49"])[0])
                json_response(self, DATA.ml_report(game))
            elif path == "/api/ml/predict":
                game = self.require_game(query.get("game", ["6din49"])[0])
                numbers_raw = query.get("numbers", [""])[0]
                numbers = [int(n) for n in re.findall(r"\d+", numbers_raw)] if numbers_raw else None
                json_response(self, DATA.ml_predict(game, numbers))
            elif path == "/api/rag/similar":
                game = self.require_game(query.get("game", ["6din49"])[0])
                numbers_raw = query.get("numbers", [""])[0]
                numbers = [int(n) for n in re.findall(r"\d+", numbers_raw)] if numbers_raw else None
                json_response(self, DATA.rag_similar(game, numbers))
            else:
                error_response(self, "Unknown API route", 404)
        except Exception as exc:
            error_response(self, str(exc), 400)

    def handle_api_post(self, path: str, payload: dict[str, Any]) -> None:
        try:
            if path == "/api/generate":
                game = self.require_game(str(payload.get("game", "6din49")))
                strategy = str(payload.get("strategy", "balanced"))
                strategy = strategy if strategy in STRATEGIES else "balanced"
                ticket_count = max(1, min(int(payload.get("ticket_count", 6)), 20))
                seed = payload.get("seed")
                seed_value = int(seed) if seed not in (None, "") else None
                simulations = int(payload.get("simulations", 2500))
                json_response(self, DATA.generate(game, strategy, ticket_count, seed_value, simulations))
            elif path == "/api/analyze":
                game = self.require_game(str(payload.get("game", "6din49")))
                numbers = payload.get("numbers", [])
                if isinstance(numbers, str):
                    numbers = [int(part) for part in re.findall(r"\d+", numbers)]
                joker = payload.get("joker")
                joker_value = int(joker) if joker not in (None, "") else None
                simulations = int(payload.get("simulations", 2500))
                limit = int(payload.get("limit", 80))
                include_ml = truthy(payload.get("include_ml"))
                json_response(self, DATA.analyze(game, [int(n) for n in numbers], joker_value, limit=limit, simulations=simulations, include_ml=include_ml))
            elif path == "/api/calculate":
                game = self.require_game(str(payload.get("game", "6din49")))
                numbers = payload.get("numbers", [])
                if isinstance(numbers, str):
                    numbers = [int(part) for part in re.findall(r"\d+", numbers)] if game != "noroc" else numbers
                joker = payload.get("joker")
                joker_value = int(joker) if joker not in (None, "") else None
                simulations = int(payload.get("simulations", 2500))
                if game == "noroc":
                    raw = numbers if isinstance(numbers, str) else numbers
                    json_response(self, DATA.calculate(game, raw, simulations=simulations))
                else:
                    json_response(self, DATA.calculate(game, [int(n) for n in numbers], joker_value, simulations))
            elif path == "/api/ml/predict":
                game = self.require_game(str(payload.get("game", "6din49")))
                numbers = payload.get("numbers", [])
                if isinstance(numbers, str):
                    numbers = [int(n) for n in re.findall(r"\d+", numbers)]
                nums = [int(n) for n in numbers] if numbers else None
                json_response(self, DATA.ml_predict(game, nums))
            elif path == "/api/rag/similar":
                game = self.require_game(str(payload.get("game", "6din49")))
                numbers = payload.get("numbers", [])
                if isinstance(numbers, str):
                    numbers = [int(n) for n in re.findall(r"\d+", numbers)]
                nums = [int(n) for n in numbers] if numbers else None
                json_response(self, DATA.rag_similar(game, nums))
            else:
                error_response(self, "Unknown API route", 404)
        except Exception as exc:
            error_response(self, str(exc), 400)

    def require_game(self, game: str) -> str:
        if game not in GAME_CONFIGS:
            raise ValueError(f"Unknown game: {game}")
        return game

    def serve_static(self, request_path: str) -> None:
        if not DIST_DIR.exists():
            error_response(self, "Frontend build not found. Run npm run dev for Vite or npm run build first.", 404)
            return
        safe_name = request_path.lstrip("/")
        target = (DIST_DIR / safe_name).resolve()
        root = DIST_DIR.resolve()
        if not str(target).startswith(str(root)):
            error_response(self, "Forbidden", 403)
            return
        if request_path == "/" or not target.exists() or target.is_dir():
            target = DIST_DIR / "index.html"
        self.path = "/" + str(target.relative_to(DIST_DIR))
        self.directory = str(DIST_DIR)
        super().do_GET()


app = FastAPI(
    title="loto-gpt API",
    version="2.0.0",
    description="CSV-backed lottery history, ML, and local RAG API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(_request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


def require_game_key(game: str) -> str:
    if game not in GAME_CONFIGS:
        raise ValueError(f"Unknown game: {game}")
    return game


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def numbers_from_any(value: Any, game: str | None = None) -> list[int] | str:
    if isinstance(value, str):
        if game == "noroc":
            return value
        return [int(part) for part in re.findall(r"\d+", value)]
    if value is None:
        return []
    return [int(part) for part in value]


@app.get("/api/health")
def api_health() -> dict[str, Any]:
    return {"ok": True, "app": "loto-gpt", "backend": "fastapi", "data_source": DATA.data_source}


@app.get("/api/summary")
def api_summary() -> dict[str, Any]:
    return DATA.summary()


@app.get("/api/dataset")
def api_dataset() -> dict[str, Any]:
    return DATA.dataset()


@app.get("/api/history")
def api_history(
    game: str | None = None,
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    year: int | None = None,
    month: int | None = Query(None, ge=1, le=12),
    q: str | None = None,
) -> dict[str, Any]:
    if game:
        require_game_key(game)
    return DATA.flat_history(game=game, limit=limit, offset=offset, year=year, month=month, q=q)


@app.get("/api/export/csv")
def api_export_csv() -> FileResponse:
    if not DATA.history_path.exists():
        raise HTTPException(status_code=404, detail="lottery_history.csv not found")
    return FileResponse(DATA.history_path, media_type="text/csv", filename="lottery_history.csv")


@app.get("/api/stats")
def api_stats(game: str = "6din49") -> dict[str, Any]:
    return DATA.stats(require_game_key(game))


@app.get("/api/number-analysis")
def api_number_analysis(game: str = "6din49") -> dict[str, Any]:
    return DATA.number_analysis(require_game_key(game))


@app.get("/api/draws")
def api_draws(
    game: str = "6din49",
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    year: int | None = None,
) -> dict[str, Any]:
    return DATA.draw_history(require_game_key(game), limit, offset, year)


@app.get("/api/ml")
def api_ml(game: str = "6din49") -> dict[str, Any]:
    return DATA.ml_report(require_game_key(game))


@app.get("/api/ml/predict")
def api_ml_predict_get(game: str = "6din49", numbers: str = "") -> dict[str, Any]:
    parsed = [int(part) for part in re.findall(r"\d+", numbers)] if numbers else None
    return DATA.ml_predict(require_game_key(game), parsed)


@app.get("/api/rag/similar")
def api_rag_similar_get(game: str = "6din49", numbers: str = "") -> dict[str, Any]:
    parsed = [int(part) for part in re.findall(r"\d+", numbers)] if numbers else None
    return DATA.rag_similar(require_game_key(game), parsed)


@app.get("/api/rag/search")
def api_rag_search(q: str, game: str | None = None, limit: int = Query(20, ge=1, le=200)) -> dict[str, Any]:
    if game:
        require_game_key(game)
    return DATA.rag_text_search(q, game=game, limit=limit)


@app.post("/api/generate")
def api_generate(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    payload = payload or {}
    game = require_game_key(str(payload.get("game", "6din49")))
    strategy = str(payload.get("strategy", "balanced"))
    strategy = strategy if strategy in STRATEGIES else "balanced"
    ticket_count = max(1, min(int(payload.get("ticket_count", 6)), 20))
    seed = payload.get("seed")
    seed_value = int(seed) if seed not in (None, "") else None
    simulations = int(payload.get("simulations", 2500))
    return DATA.generate(game, strategy, ticket_count, seed_value, simulations)


@app.post("/api/analyze")
def api_analyze(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    payload = payload or {}
    game = require_game_key(str(payload.get("game", "6din49")))
    numbers = numbers_from_any(payload.get("numbers", []), game)
    joker = payload.get("joker")
    joker_value = int(joker) if joker not in (None, "") else None
    simulations = int(payload.get("simulations", 2500))
    limit = int(payload.get("limit", 80))
    include_ml = truthy(payload.get("include_ml"))
    return DATA.analyze(game, numbers if isinstance(numbers, list) else [int(n) for n in re.findall(r"\d+", numbers)], joker_value, limit=limit, simulations=simulations, include_ml=include_ml)


@app.post("/api/calculate")
def api_calculate(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    payload = payload or {}
    game = require_game_key(str(payload.get("game", "6din49")))
    numbers = numbers_from_any(payload.get("numbers", []), game)
    joker = payload.get("joker")
    joker_value = int(joker) if joker not in (None, "") else None
    simulations = int(payload.get("simulations", 2500))
    if game == "noroc":
        return DATA.calculate(game, numbers, simulations=simulations)
    return DATA.calculate(game, numbers if isinstance(numbers, list) else [], joker_value, simulations)


@app.post("/api/ml/predict")
def api_ml_predict_post(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    payload = payload or {}
    game = require_game_key(str(payload.get("game", "6din49")))
    numbers = numbers_from_any(payload.get("numbers", []), game)
    nums = numbers if isinstance(numbers, list) and numbers else None
    return DATA.ml_predict(game, nums)


@app.post("/api/rag/similar")
def api_rag_similar_post(payload: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    payload = payload or {}
    game = require_game_key(str(payload.get("game", "6din49")))
    numbers = numbers_from_any(payload.get("numbers", []), game)
    nums = numbers if isinstance(numbers, list) and numbers else None
    return DATA.rag_similar(game, nums)


if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/{request_path:path}", include_in_schema=False)
def serve_spa(request_path: str) -> FileResponse:
    if request_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Unknown API route")
    if not DIST_DIR.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")
    root = DIST_DIR.resolve()
    target = (DIST_DIR / request_path).resolve()
    if request_path and str(target).startswith(str(root)) and target.is_file():
        return FileResponse(target)
    return FileResponse(DIST_DIR / "index.html")


def main() -> int:
    parser = argparse.ArgumentParser(description="loto-gpt FastAPI server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    import uvicorn

    print(f"loto-gpt FastAPI running at http://{args.host}:{args.port}")
    print(f"loaded {len(DATA.archive_rows)} archive rows from {DATA.data_source}")
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
