"""Domain types and canonical serialization for Loto 6/49 draws."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Iterable


ROMANIAN_MONTHS = (
    "",
    "ianuarie",
    "februarie",
    "martie",
    "aprilie",
    "mai",
    "iunie",
    "iulie",
    "august",
    "septembrie",
    "octombrie",
    "noiembrie",
    "decembrie",
)
ROMANIAN_WEEKDAYS = ("luni", "marti", "miercuri", "joi", "vineri", "sambata", "duminica")
WEEKDAY_PREFIX = ("Lu", "Ma", "Mi", "Jo", "Vi", "Sa", "Du")


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


@dataclass(frozen=True)
class Draw:
    draw_date: date
    numbers: tuple[int, ...]
    source: str
    fetched_at: datetime
    official_id: str | None = None
    source_hash: str | None = None
    game: str = "6din49"

    def __post_init__(self) -> None:
        if self.game != "6din49":
            raise ValueError("The upgraded pipeline only accepts game=6din49")
        normalized = tuple(int(value) for value in self.numbers)
        if len(normalized) != 6:
            raise ValueError("A Loto 6/49 draw must contain exactly six numbers")
        if len(set(normalized)) != 6:
            raise ValueError("A Loto 6/49 draw cannot contain duplicate numbers")
        if any(value < 1 or value > 49 for value in normalized):
            raise ValueError("Loto 6/49 numbers must be between 1 and 49")
        if not isinstance(self.draw_date, date):
            raise ValueError("draw_date must be a valid date")
        if not self.source.strip():
            raise ValueError("A draw must include its source URL")
        fetched = self.fetched_at
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        object.__setattr__(self, "numbers", normalized)
        object.__setattr__(self, "fetched_at", fetched.astimezone(timezone.utc).replace(microsecond=0))
        if not self.source_hash:
            canonical = f"{self.game}|{self.draw_date.isoformat()}|{','.join(map(str, normalized))}|{self.source}"
            object.__setattr__(self, "source_hash", hashlib.sha256(canonical.encode("utf-8")).hexdigest())

    @property
    def key(self) -> str:
        return f"{self.game}:{self.draw_date.isoformat()}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.official_id or self.key,
            "official_id": self.official_id,
            "game": self.game,
            "draw_date": self.draw_date.isoformat(),
            "numbers": list(self.numbers),
            "source": self.source,
            "source_hash": self.source_hash,
            "fetched_at": self.fetched_at.isoformat(),
        }

    @classmethod
    def from_history_row(cls, row: dict[str, Any]) -> Draw:
        raw_numbers = row.get("drawn_numbers", [])
        if isinstance(raw_numbers, str):
            try:
                raw_numbers = json.loads(raw_numbers)
            except json.JSONDecodeError:
                raw_numbers = [part for part in raw_numbers.split(",") if part.strip()]
        fetched_raw = str(row.get("fetched_at") or "").strip()
        fetched = datetime.fromisoformat(fetched_raw.replace("Z", "+00:00")) if fetched_raw else utc_now()
        return cls(
            game=str(row.get("game", "6din49")),
            draw_date=date.fromisoformat(str(row.get("draw_date_iso") or row.get("draw_date"))),
            numbers=tuple(int(value) for value in raw_numbers),
            source=str(row.get("source_url") or row.get("source") or "historical-csv"),
            source_hash=str(row.get("source_hash") or "") or None,
            fetched_at=fetched,
            official_id=str(row.get("official_id") or row.get("row_id") or "") or None,
        )

    def to_history_row(self, draw_index: int, fields: Iterable[str]) -> dict[str, str]:
        values = list(self.numbers)
        sorted_values = sorted(values)
        iso = self.draw_date.isocalendar()
        low_count = sum(value <= 24 for value in values)
        consecutive = sum(1 for left, right in zip(sorted_values, sorted_values[1:]) if right - left == 1)
        raw_date = f"{WEEKDAY_PREFIX[self.draw_date.weekday()]}, {self.draw_date.day} {ROMANIAN_MONTHS[self.draw_date.month]} {self.draw_date.year}"
        base: dict[str, Any] = {
            "row_id": f"6din49-{self.draw_date.isoformat()}-{draw_index:05d}",
            "game": "6din49",
            "game_label": "Loto 6/49",
            "draw_index": draw_index,
            "draw_date_iso": self.draw_date.isoformat(),
            "draw_date_raw": raw_date,
            "year": self.draw_date.year,
            "quarter": (self.draw_date.month - 1) // 3 + 1,
            "month": self.draw_date.month,
            "month_name": ROMANIAN_MONTHS[self.draw_date.month],
            "day": self.draw_date.day,
            "weekday": self.draw_date.isoweekday(),
            "weekday_name": ROMANIAN_WEEKDAYS[self.draw_date.weekday()],
            "iso_week": iso.week,
            "drawn_numbers": json.dumps(values, separators=(",", ":")),
            "drawn_numbers_csv": ",".join(map(str, values)),
            "drawn_numbers_sorted_csv": ",".join(map(str, sorted_values)),
            "number_count": 6,
            "unique_count": 6,
            "number_sum": sum(values),
            "number_min": min(values),
            "number_max": max(values),
            "number_span": max(values) - min(values),
            "odd_count": sum(value % 2 for value in values),
            "even_count": sum(value % 2 == 0 for value in values),
            "low_count": low_count,
            "high_count": 6 - low_count,
            "consecutive_pairs": consecutive,
            "category_count": 0,
            "category_data_json": "{}",
            "has_prize_data": 0,
            "raw_cells_json": json.dumps([raw_date, *map(str, values)], ensure_ascii=False, separators=(",", ":")),
            "source_url": self.source,
            "rag_text": (
                f"game=Loto 6/49 | date={self.draw_date.isoformat()} | raw_date={raw_date} | "
                f"numbers={','.join(map(str, values))} | source=official"
            ),
        }
        for index, number in enumerate(values, start=1):
            base[f"number_{index}"] = number
        return {field: str(base.get(field, "")) for field in fields}


def dataset_hash(draws: Iterable[Draw]) -> str:
    digest = hashlib.sha256()
    for draw in sorted(draws, key=lambda item: (item.draw_date, item.numbers)):
        digest.update(draw.draw_date.isoformat().encode("ascii"))
        digest.update(b":")
        digest.update(",".join(map(str, draw.numbers)).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()
