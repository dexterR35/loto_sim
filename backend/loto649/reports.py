"""Versioned reports and immutable prediction/evaluation artifacts."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


def _json_default(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"Cannot serialize {type(value).__name__}")


class ReportStore:
    def __init__(self, data_dir: Path | str) -> None:
        self.root = Path(data_dir) / "reports" / "loto649"
        self._lock = threading.RLock()
        for name in ("statistical", "predictions", "evaluations", "backtests", "experiments", "logs"):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    def _atomic_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            with temp_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True, default=_json_default)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def save_statistical(self, report: dict[str, Any]) -> Path:
        version = str(report["dataset_version"])[:12]
        stamp = str(report["generated_at"])[:10]
        path = self.root / "statistical" / f"{stamp}-{version}.json"
        with self._lock:
            self._atomic_json(path, report)
            self._atomic_json(self.root / "statistical" / "latest.json", report)
        return path

    def load_statistical(self, dataset_version: str) -> dict[str, Any] | None:
        path = self.root / "statistical" / "latest.json"
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if payload.get("dataset_version") == dataset_version else None

    def freeze_prediction(self, snapshot: dict[str, Any]) -> Path:
        prediction_id = str(snapshot["prediction_id"])
        target = str(snapshot["target_draw_date"])
        path = self.root / "predictions" / f"{target}__{prediction_id}.json"
        encoded = json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True, default=_json_default) + "\n"
        with self._lock:
            try:
                with path.open("x", encoding="utf-8") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
            except FileExistsError:
                current = path.read_text(encoding="utf-8")
                if current != encoded:
                    raise ValueError(f"Immutable prediction snapshot already exists with different content: {prediction_id}")
        return path

    def prediction_for_date(self, target: date | str) -> dict[str, Any] | None:
        target_text = target.isoformat() if isinstance(target, date) else str(target)
        candidates = sorted((self.root / "predictions").glob(f"{target_text}__*.json"))
        if not candidates:
            return None
        return json.loads(candidates[-1].read_text(encoding="utf-8"))

    def latest_prediction(self) -> dict[str, Any] | None:
        candidates = sorted((self.root / "predictions").glob("*.json"))
        if not candidates:
            return None
        payloads = [json.loads(path.read_text(encoding="utf-8")) for path in candidates]
        return max(payloads, key=lambda item: (str(item.get("target_draw_date", "")), str(item.get("created_at", ""))))

    def prediction_history(self, limit: int = 50) -> list[dict[str, Any]]:
        candidates = sorted((self.root / "predictions").glob("*.json"), reverse=True)
        return [json.loads(path.read_text(encoding="utf-8")) for path in candidates[: max(1, min(limit, 500))]]

    def save_evaluation(self, evaluation: dict[str, Any]) -> Path:
        path = self.root / "evaluations" / f"{evaluation['prediction_id']}.json"
        encoded = json.dumps(
            evaluation,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            default=_json_default,
        ) + "\n"
        with self._lock:
            try:
                with path.open("x", encoding="utf-8") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
            except FileExistsError:
                current = path.read_text(encoding="utf-8")
                if current != encoded:
                    raise ValueError("An immutable prediction evaluation already exists with different data")
        return path

    def evaluation_for(self, prediction_id: str) -> dict[str, Any] | None:
        path = self.root / "evaluations" / f"{prediction_id}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def save_backtest(self, report: dict[str, Any]) -> Path:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = self.root / "backtests" / f"{stamp}-{str(report['dataset_version'])[:10]}.json"
        with self._lock:
            self._atomic_json(path, report)
            self._atomic_json(self.root / "backtests" / "latest.json", report)
        return path

    def latest_backtest(self) -> dict[str, Any] | None:
        path = self.root / "backtests" / "latest.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def log(self, event: str, **context: Any) -> None:
        payload = {
            "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "event": event,
            **context,
        }
        path = self.root / "logs" / f"{datetime.now(timezone.utc):%Y-%m}.jsonl"
        with self._lock, path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=_json_default) + "\n")
