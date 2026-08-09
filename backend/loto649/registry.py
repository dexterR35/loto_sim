"""File-backed experiment and Champion/Challenger model registry."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VALID_STATUSES = {"candidate", "production", "rejected", "archived"}


class ModelRegistry:
    def __init__(self, data_dir: Path | str) -> None:
        self.root = Path(data_dir) / "model_registry" / "loto649"
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "registry.json"
        self.events_path = self.root / "events.jsonl"
        self._lock = threading.RLock()

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"version": 1, "models": []}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, payload: dict[str, Any]) -> None:
        fd, temp_name = tempfile.mkstemp(prefix=".registry-", suffix=".json", dir=self.root)
        os.close(fd)
        temp_path = Path(temp_name)
        try:
            with temp_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

    def _event(self, event: str, model_id: str, **context: Any) -> None:
        item = {
            "timestamp": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "event": event,
            "model_id": model_id,
            **context,
        }
        with self.events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n")

    def list(self) -> list[dict[str, Any]]:
        return sorted(self._read()["models"], key=lambda item: str(item.get("created_at", "")), reverse=True)

    def champion(self) -> dict[str, Any] | None:
        return next((item for item in self.list() if item.get("status") == "production"), None)

    def get(self, model_id: str) -> dict[str, Any] | None:
        return next((item for item in self.list() if item.get("model_id") == model_id), None)

    def register(self, record: dict[str, Any]) -> dict[str, Any]:
        model_id = str(record.get("model_id", "")).strip()
        status = str(record.get("status", "candidate"))
        if not model_id:
            raise ValueError("model_id is required")
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid model status: {status}")
        with self._lock:
            payload = self._read()
            if any(item.get("model_id") == model_id for item in payload["models"]):
                raise ValueError(f"Model already registered: {model_id}")
            normalized = {
                "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "status": status,
                **record,
            }
            payload["models"].append(normalized)
            self._write(payload)
            self._event("model_registered", model_id, status=status)
            return normalized

    def update_metadata(self, model_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        forbidden = {"model_id", "created_at", "status"}.intersection(fields)
        if forbidden:
            raise ValueError(f"Immutable registry fields cannot be updated: {', '.join(sorted(forbidden))}")
        with self._lock:
            payload = self._read()
            target = None
            for item in payload["models"]:
                if item.get("model_id") == model_id:
                    item.update(fields)
                    item["metadata_updated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                    target = item
                    break
            if target is None:
                raise KeyError(f"Unknown model: {model_id}")
            self._write(payload)
            self._event(
                "model_metadata_updated",
                model_id,
                updated_fields=sorted(fields),
            )
            return target

    def set_status(self, model_id: str, status: str, reason: str) -> dict[str, Any]:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid model status: {status}")
        with self._lock:
            payload = self._read()
            target = None
            if status == "production":
                for item in payload["models"]:
                    if item.get("status") == "production" and item.get("model_id") != model_id:
                        item["status"] = "archived"
                        item["status_reason"] = f"Replaced by {model_id}"
            for item in payload["models"]:
                if item.get("model_id") == model_id:
                    item["status"] = status
                    item["status_reason"] = reason
                    item["status_updated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                    target = item
                    break
            if target is None:
                raise KeyError(f"Unknown model: {model_id}")
            self._write(payload)
            self._event("model_status_changed", model_id, status=status, reason=reason)
            return target
