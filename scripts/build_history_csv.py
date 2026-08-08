#!/usr/bin/env python3
"""Build the standalone lottery history CSV used by the API."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "lottery" / "archive_results.csv"
DEFAULT_OUTPUT = ROOT / "data" / "lottery" / "lottery_history.csv"

MONTH_NAMES = {
    1: "ianuarie",
    2: "februarie",
    3: "martie",
    4: "aprilie",
    5: "mai",
    6: "iunie",
    7: "iulie",
    8: "august",
    9: "septembrie",
    10: "octombrie",
    11: "noiembrie",
    12: "decembrie",
}

WEEKDAY_NAMES = {
    1: "luni",
    2: "marti",
    3: "miercuri",
    4: "joi",
    5: "vineri",
    6: "sambata",
    7: "duminica",
}

GAME_ORDER = {"6din49": 0, "noroc": 1, "5din40": 2, "joker": 3}
CATEGORY_LABELS = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "1", "2", "3", "4", "5", "N+3", "N-3")
CATEGORY_SLUGS = {
    "I": "i",
    "II": "ii",
    "III": "iii",
    "IV": "iv",
    "V": "v",
    "VI": "vi",
    "VII": "vii",
    "VIII": "viii",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "N+3": "n_plus_3",
    "N-3": "n_minus_3",
}

BASE_FIELDS = [
    "row_id",
    "game",
    "game_label",
    "draw_index",
    "draw_date_iso",
    "draw_date_raw",
    "year",
    "quarter",
    "month",
    "month_name",
    "day",
    "weekday",
    "weekday_name",
    "iso_week",
    "drawn_numbers",
    "drawn_numbers_csv",
    "drawn_numbers_sorted_csv",
    "number_1",
    "number_2",
    "number_3",
    "number_4",
    "number_5",
    "number_6",
    "joker_number",
    "noroc_code",
    "digit_1",
    "digit_2",
    "digit_3",
    "digit_4",
    "digit_5",
    "digit_6",
    "digit_7",
    "number_count",
    "unique_count",
    "number_sum",
    "number_min",
    "number_max",
    "number_span",
    "odd_count",
    "even_count",
    "low_count",
    "high_count",
    "consecutive_pairs",
    "fond_castiguri",
    "fond_castiguri_value",
    "category_count",
    "category_data_json",
]

CATEGORY_FIELDS = [
    f"cat_{CATEGORY_SLUGS[label]}_{suffix}"
    for label in CATEGORY_LABELS
    for suffix in ("wins", "wins_value", "prize", "prize_value", "report", "report_value")
]

CSV_FIELDS = BASE_FIELDS + CATEGORY_FIELDS + ["has_prize_data", "raw_cells_json", "source_url", "rag_text"]


def parse_json(value: str, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def parse_int(value: Any) -> int | None:
    text = re.sub(r"[^\d-]", "", str(value or ""))
    if not text or text == "-":
        return None
    try:
        return int(text)
    except ValueError:
        return None


def parse_decimal_ro(value: Any) -> str:
    text = str(value or "").strip().replace("\xa0", " ")
    if not text or text == "-":
        return ""
    text = re.sub(r"(?i)\b(lei|ron|rol)\b", "", text)
    text = re.sub(r"[^0-9,.-]", "", text)
    if not re.search(r"\d", text):
        return ""
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif text.count(".") > 1:
        text = text.replace(".", "")
    try:
        return f"{float(text):.2f}"
    except ValueError:
        return ""


def as_draw_numbers(value: Any) -> list[int | str]:
    if not isinstance(value, list):
        return []
    out: list[int | str] = []
    for item in value:
        text = str(item).strip()
        if text:
            out.append(int(text) if text.isdigit() and len(text) < 7 else text)
    return out


def numeric_numbers(values: list[int | str]) -> list[int]:
    out: list[int] = []
    for value in values:
        try:
            out.append(int(value))
        except (TypeError, ValueError):
            continue
    return out


def normalized_category_data(value: Any) -> dict[str, dict[str, str]]:
    if not isinstance(value, dict):
        return {}
    categories: dict[str, dict[str, str]] = {}
    for label, payload in value.items():
        if isinstance(payload, dict):
            categories[str(label)] = {
                "numar_castiguri": str(payload.get("numar_castiguri", "") or ""),
                "valoare_castig": str(payload.get("valoare_castig", "") or ""),
                "report": str(payload.get("report", "") or ""),
            }
    return categories


def date_parts(value: str) -> dict[str, str | int]:
    try:
        draw_date = datetime.fromisoformat(value).date()
    except ValueError:
        return {field: "" for field in ("year", "quarter", "month", "month_name", "day", "weekday", "weekday_name", "iso_week")}
    weekday = draw_date.isoweekday()
    return {
        "year": draw_date.year,
        "quarter": ((draw_date.month - 1) // 3) + 1,
        "month": draw_date.month,
        "month_name": MONTH_NAMES[draw_date.month],
        "day": draw_date.day,
        "weekday": weekday,
        "weekday_name": WEEKDAY_NAMES[weekday],
        "iso_week": draw_date.isocalendar().week,
    }


def number_features(game: str, numbers: list[int]) -> dict[str, str | int]:
    if not numbers:
        return {
            "number_count": 0,
            "unique_count": 0,
            "number_sum": "",
            "number_min": "",
            "number_max": "",
            "number_span": "",
            "odd_count": 0,
            "even_count": 0,
            "low_count": 0,
            "high_count": 0,
            "consecutive_pairs": 0,
        }
    midpoint = {"5din40": 20, "joker": 22.5, "noroc": 4.5}.get(game, 24.5)
    ordered = sorted(numbers)
    return {
        "number_count": len(numbers),
        "unique_count": len(set(numbers)),
        "number_sum": sum(numbers),
        "number_min": min(numbers),
        "number_max": max(numbers),
        "number_span": max(numbers) - min(numbers),
        "odd_count": sum(1 for number in numbers if number % 2 == 1),
        "even_count": sum(1 for number in numbers if number % 2 == 0),
        "low_count": sum(1 for number in numbers if number <= midpoint),
        "high_count": sum(1 for number in numbers if number > midpoint),
        "consecutive_pairs": sum(1 for left, right in zip(ordered, ordered[1:]) if right == left + 1),
    }


def build_rag_text(source: dict[str, str], numbers_csv: str, categories: dict[str, dict[str, str]]) -> str:
    parts = [
        f"game={source.get('game_label') or source.get('game')}",
        f"date={source.get('draw_date_iso')}",
        f"raw_date={source.get('draw_date_raw')}",
        f"numbers={numbers_csv}",
    ]
    if source.get("joker_number"):
        parts.append(f"joker={source['joker_number']}")
    if source.get("fond_castiguri"):
        parts.append(f"fond_castiguri={source['fond_castiguri']}")
    category_parts = []
    for label in CATEGORY_LABELS:
        payload = categories.get(label)
        if payload:
            category_parts.append(
                f"{label}: wins {payload.get('numar_castiguri') or '-'}, "
                f"prize {payload.get('valoare_castig') or '-'}, report {payload.get('report') or '-'}"
            )
    if category_parts:
        parts.append("categories=[" + "; ".join(category_parts) + "]")
    return " | ".join(part for part in parts if part)


def build_rows(source_rows: list[dict[str, str]], min_year: int, max_year: int) -> list[dict[str, str]]:
    counters: dict[str, int] = defaultdict(int)
    output: list[dict[str, str]] = []
    sorted_rows = sorted(
        source_rows,
        key=lambda row: (
            GAME_ORDER.get(row.get("game", ""), 99),
            row.get("draw_date_iso", ""),
            row.get("drawn_numbers", ""),
            row.get("joker_number", ""),
        ),
    )

    for source in sorted_rows:
        parts = date_parts(source.get("draw_date_iso", ""))
        try:
            year = int(parts["year"])
        except (TypeError, ValueError):
            continue
        if year < min_year or year > max_year:
            continue

        game = source.get("game", "")
        counters[game] += 1
        drawn = as_draw_numbers(parse_json(source.get("drawn_numbers", ""), []))
        numbers = numeric_numbers(drawn)
        numbers_csv = ",".join(str(value) for value in drawn)
        categories = normalized_category_data(parse_json(source.get("category_data", "") or source.get("category_data_json", ""), {}))
        raw_cells = parse_json(source.get("raw_cells", "") or source.get("raw_cells_json", ""), [])
        row = {field: "" for field in CSV_FIELDS}
        row.update(
            {
                "row_id": f"{game}-{source.get('draw_date_iso', '')}-{counters[game]:05d}",
                "game": game,
                "game_label": source.get("game_label", ""),
                "draw_index": str(counters[game]),
                "draw_date_iso": source.get("draw_date_iso", ""),
                "draw_date_raw": source.get("draw_date_raw", ""),
                "drawn_numbers": json.dumps(drawn, ensure_ascii=False, separators=(",", ":")),
                "drawn_numbers_csv": numbers_csv,
                "drawn_numbers_sorted_csv": ",".join(str(value) for value in sorted(numbers)) if numbers else numbers_csv,
                "joker_number": source.get("joker_number", ""),
                "fond_castiguri": source.get("fond_castiguri", ""),
                "fond_castiguri_value": parse_decimal_ro(source.get("fond_castiguri", "")),
                "category_count": str(len(categories)),
                "category_data_json": json.dumps(categories, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                "raw_cells_json": json.dumps(raw_cells, ensure_ascii=False, separators=(",", ":")),
                "source_url": source.get("source_url", ""),
            }
        )
        for key, value in parts.items():
            row[key] = str(value)
        for key, value in number_features(game, numbers).items():
            row[key] = str(value)
        for index, value in enumerate(drawn[:6], start=1):
            row[f"number_{index}"] = str(value)
        if game == "noroc":
            code = re.sub(r"\D", "", numbers_csv).zfill(7)[-7:]
            row["noroc_code"] = code
            for index, digit in enumerate(code[:7], start=1):
                row[f"digit_{index}"] = digit

        has_prize_data = False
        for label in CATEGORY_LABELS:
            payload = categories.get(label, {})
            slug = CATEGORY_SLUGS[label]
            wins = payload.get("numar_castiguri", "")
            prize = payload.get("valoare_castig", "")
            report = payload.get("report", "")
            row[f"cat_{slug}_wins"] = wins
            row[f"cat_{slug}_wins_value"] = str(parse_int(wins) or "")
            row[f"cat_{slug}_prize"] = prize
            row[f"cat_{slug}_prize_value"] = parse_decimal_ro(prize)
            row[f"cat_{slug}_report"] = report
            row[f"cat_{slug}_report_value"] = parse_decimal_ro(report)
            if row[f"cat_{slug}_prize_value"] or row[f"cat_{slug}_report_value"]:
                has_prize_data = True
        row["has_prize_data"] = "1" if has_prize_data else "0"
        row["rag_text"] = build_rag_text(source, numbers_csv, categories)
        output.append(row)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the standalone lottery history CSV.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-year", type=int, default=1993)
    parser.add_argument("--max-year", type=int, default=2026)
    args = parser.parse_args()

    input_path = args.input
    if not input_path.exists() and input_path == DEFAULT_INPUT and DEFAULT_OUTPUT.exists():
        input_path = DEFAULT_OUTPUT
    with input_path.open(encoding="utf-8", newline="") as handle:
        rows = build_rows(list(csv.DictReader(handle)), args.min_year, args.max_year)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
