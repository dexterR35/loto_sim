"""CSV-backed, idempotent persistence for the existing lottery archive."""

from __future__ import annotations

import csv
import io
import json
import os
import shutil
import tempfile
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Sequence

from .domain import Draw

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt


class DrawConflictError(ValueError):
    """Raised when the same game/date is observed with different numbers."""


def _metadata_key(game: str, draw_date: str, numbers: Sequence[int] | None = None) -> str:
    base = f"{game}:{draw_date}"
    if not numbers:
        return base
    normalized = ",".join(str(value) for value in sorted(int(number) for number in numbers))
    return f"{base}:{normalized}"


class HistoryRepository:
    """Use the established CSV as source of truth and a sidecar for fetch provenance."""

    def __init__(self, data_dir: Path | str) -> None:
        self.data_dir = Path(data_dir)
        self.csv_path = self.data_dir / "lottery_history.csv"
        self.metadata_path = self.data_dir / "loto649_draw_metadata.jsonl"
        self.lock_path = self.data_dir / ".loto649-history.lock"

    @contextmanager
    def _lock(self) -> Iterator[None]:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+b") as handle:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            else:
                handle.seek(0)
                if not handle.read(1):
                    handle.write(b"\0")
                    handle.flush()
                while True:
                    try:
                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        time.sleep(0.05)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                else:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

    def _metadata(self) -> dict[str, dict[str, Any]]:
        rows: dict[str, dict[str, Any]] = {}
        if not self.metadata_path.exists():
            return rows
        with self.metadata_path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                key = _metadata_key(
                    str(item.get("game", "6din49")),
                    str(item.get("draw_date", "")),
                    item.get("numbers") if isinstance(item.get("numbers"), list) else None,
                )
                rows[key] = item
        return rows

    def load_draws(self) -> list[Draw]:
        if not self.csv_path.exists():
            return []
        metadata = self._metadata()
        draws: list[Draw] = []
        identities: dict[str, Draw] = {}
        with self.csv_path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("game") != "6din49":
                    continue
                raw_numbers = row.get("drawn_numbers", "")
                try:
                    parsed_numbers = json.loads(raw_numbers) if isinstance(raw_numbers, str) else raw_numbers
                except json.JSONDecodeError:
                    parsed_numbers = [part for part in str(raw_numbers).split(",") if part.strip()]
                date_value = str(row.get("draw_date_iso", ""))
                meta = metadata.get(
                    _metadata_key("6din49", date_value, parsed_numbers),
                    metadata.get(_metadata_key("6din49", date_value), {}),
                )
                enriched: dict[str, Any] = dict(row)
                enriched.update({
                    "source_hash": meta.get("source_hash", ""),
                    "fetched_at": meta.get("fetched_at", ""),
                    "official_id": meta.get("official_id", ""),
                })
                draw = Draw.from_history_row(enriched)
                identity = f"{draw.draw_date.isoformat()}:{','.join(map(str, sorted(draw.numbers)))}"
                previous = identities.get(identity)
                if previous and set(previous.numbers) != set(draw.numbers):
                    raise DrawConflictError(f"Conflicting historical draw identity: {identity}")
                if previous is None:
                    identities[identity] = draw
                    draws.append(draw)
        return sorted(draws, key=lambda item: item.draw_date)

    def latest(self) -> Draw | None:
        draws = self.load_draws()
        return draws[-1] if draws else None

    def history_mtime_ns(self) -> int:
        return self.csv_path.stat().st_mtime_ns if self.csv_path.exists() else 0

    def insert(self, draw: Draw) -> bool:
        return bool(self.insert_many([draw]))

    def insert_many(self, incoming: Sequence[Draw]) -> list[Draw]:
        if not incoming:
            return []
        ordered = sorted(incoming, key=lambda item: item.draw_date)
        if len({(item.draw_date, tuple(sorted(item.numbers))) for item in ordered}) != len(ordered):
            raise ValueError("Incoming draw batch contains duplicate draw identities")
        with self._lock():
            existing = self.load_draws()
            by_date: dict[date, list[Draw]] = {}
            for item in existing:
                by_date.setdefault(item.draw_date, []).append(item)
            additions: list[Draw] = []
            for draw in ordered:
                same_date = by_date.get(draw.draw_date, [])
                if any(set(previous.numbers) == set(draw.numbers) for previous in same_date):
                    continue
                if draw.official_id and any(previous.official_id == draw.official_id for previous in same_date):
                    raise DrawConflictError(
                        f"Official draw {draw.official_id} conflicts with persisted numbers for {draw.draw_date.isoformat()}"
                    )
                additions.append(draw)
                by_date.setdefault(draw.draw_date, []).append(draw)
            if not additions:
                return []
            if not self.csv_path.exists():
                raise FileNotFoundError("lottery_history.csv is required as the primary historical dataset")

            with self.csv_path.open(encoding="utf-8", newline="") as handle:
                reader = csv.DictReader(handle)
                fields = list(reader.fieldnames or [])
            required = {"row_id", "game", "draw_index", "draw_date_iso", "drawn_numbers", "source_url"}
            if not required.issubset(fields):
                raise ValueError("lottery_history.csv does not have the expected archive schema")
            next_index = max(
                (int(item.official_id.rsplit("-", 1)[-1]) for item in existing if item.official_id and item.official_id.rsplit("-", 1)[-1].isdigit()),
                default=len(existing),
            ) + 1

            fd, temp_name = tempfile.mkstemp(prefix=".lottery-history-", suffix=".csv", dir=self.data_dir)
            os.close(fd)
            temp_path = Path(temp_name)
            try:
                shutil.copyfile(self.csv_path, temp_path)
                if temp_path.stat().st_size:
                    with temp_path.open("rb+") as raw:
                        raw.seek(-1, os.SEEK_END)
                        if raw.read(1) not in {b"\n", b"\r"}:
                            raw.write(b"\n")
                with temp_path.open("a", encoding="utf-8", newline="") as handle:
                    writer = csv.DictWriter(
                        handle,
                        fieldnames=fields,
                        extrasaction="ignore",
                        lineterminator="\n",
                    )
                    for offset, draw in enumerate(additions):
                        writer.writerow(draw.to_history_row(next_index + offset, fields))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp_path, self.csv_path)
            finally:
                if temp_path.exists():
                    temp_path.unlink()

            self._write_metadata(additions)
            return additions

    def _write_metadata(self, additions: Sequence[Draw]) -> None:
        existing = self._metadata()
        for draw in additions:
            existing[
                _metadata_key(draw.game, draw.draw_date.isoformat(), draw.numbers)
            ] = draw.as_dict()
        fd, temp_name = tempfile.mkstemp(prefix=".loto649-meta-", suffix=".jsonl", dir=self.data_dir)
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            with temp_path.open("w", encoding="utf-8") as handle:
                for key in sorted(existing):
                    handle.write(json.dumps(existing[key], ensure_ascii=False, sort_keys=True) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.metadata_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()


def history_row_for_draw(draw: Draw, draw_index: int, fields: Sequence[str]) -> str:
    """Return one CSV row; useful for adapters and focused persistence tests."""
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writerow(draw.to_history_row(draw_index, fields))
    return buffer.getvalue()
