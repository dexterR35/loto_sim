#!/usr/bin/env python3
"""Vector retrieval (RAG-style) over lottery draw history.

Stores normalized draw embeddings in a local numpy index — no external vector DB
required for ~10k draws. Augments ML predictions with similar-draw context.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

EXTRA_DIMS = 4  # sum_norm, span_norm, odd_ratio, decade_spread


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


class DrawVectorStore:
    def __init__(self, data_dir: Path, game_configs: dict[str, dict[str, Any]]) -> None:
        self.data_dir = data_dir
        self.vectors_dir = data_dir / "vectors"
        self.vectors_dir.mkdir(parents=True, exist_ok=True)
        self.game_configs = game_configs
        self._cache: dict[str, dict[str, Any]] = {}

    def embed_draw(self, numbers: list[int], pool: int, pick: int) -> np.ndarray:
        """Multi-hot + profile features, L2-normalized for cosine similarity."""
        vec = np.zeros(pool + EXTRA_DIMS, dtype=np.float32)
        selected = sorted({n for n in numbers if 1 <= n <= pool})[:pick]
        for number in selected:
            vec[number - 1] = 1.0
        if selected:
            low, high = min(selected), max(selected)
            span = max(1, high - low)
            vec[pool] = sum(selected) / (pick * pool)
            vec[pool + 1] = span / pool
            vec[pool + 2] = sum(1 for n in selected if n % 2 == 1) / len(selected)
            decades = {(n - 1) // 10 for n in selected}
            vec[pool + 3] = len(decades) / 5.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec

    def index_path(self, game: str) -> Path:
        return self.vectors_dir / f"{game}_index.npz"
    def meta_path(self, game: str) -> Path:
        return self.vectors_dir / f"{game}_meta.json"

    def build_index(self, game: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        config = self.game_configs[game]
        pool, pick = config["pool"], config["pick"]
        vectors: list[np.ndarray] = []
        meta: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            nums = as_ints(row.get("drawn_numbers", []))[:pick]
            vectors.append(self.embed_draw(nums, pool, pick))
            meta.append({
                "index": index,
                "draw_date_raw": row.get("draw_date_raw", ""),
                "draw_date_iso": row.get("draw_date_iso", ""),
                "drawn_numbers": nums,
                "year": row.get("year"),
            })
        matrix = np.stack(vectors) if vectors else np.zeros((0, pool + EXTRA_DIMS), dtype=np.float32)
        np.savez_compressed(self.index_path(game), vectors=matrix)
        self.meta_path(game).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        payload = {"game": game, "draws": len(meta), "dimensions": int(matrix.shape[1]) if len(meta) else 0}
        self._cache[game] = {"matrix": matrix, "meta": meta, **payload}
        return payload

    def load_index(self, game: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        if game in self._cache:
            return self._cache[game]
        path = self.index_path(game)
        meta_path = self.meta_path(game)
        if not path.exists() or not meta_path.exists():
            return self.build_index(game, rows)
        matrix = np.load(path)["vectors"]
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if len(meta) != len(rows):
            return self.build_index(game, rows)
        payload = {"game": game, "draws": len(meta), "dimensions": int(matrix.shape[1]), "matrix": matrix, "meta": meta}
        self._cache[game] = payload
        return payload

    def _cosine_search(
        self,
        game: str,
        rows: list[dict[str, Any]],
        query: np.ndarray,
        top_k: int = 15,
        exclude_last: int = 0,
    ) -> list[dict[str, Any]]:
        index = self.load_index(game, rows)
        matrix = index["matrix"]
        meta = index["meta"]
        if len(matrix) == 0:
            return []
        scores = matrix @ query
        limit = max(0, len(scores) - exclude_last)
        if limit <= 0:
            return []
        ranked = np.argsort(scores[:limit])[::-1][:top_k]
        results = []
        for rank, idx in enumerate(ranked, start=1):
            item = dict(meta[int(idx)])
            item["similarity"] = round(float(scores[int(idx)]), 4)
            item["rank"] = rank
            results.append(item)
        return results

    def similar_to_numbers(
        self,
        game: str,
        rows: list[dict[str, Any]],
        numbers: list[int],
        top_k: int = 15,
    ) -> list[dict[str, Any]]:
        config = self.game_configs[game]
        query = self.embed_draw(numbers, config["pool"], config["pick"])
        return self._cosine_search(game, rows, query, top_k=top_k, exclude_last=0)

    def similar_to_recent_context(
        self,
        game: str,
        rows: list[dict[str, Any]],
        window: int = 5,
        top_k: int = 20,
    ) -> list[dict[str, Any]]:
        """RAG context: mean embedding of last N draws → similar historical windows."""
        config = self.game_configs[game]
        pool, pick = config["pool"], config["pick"]
        if len(rows) < window + 1:
            return []
        recent = rows[-window:]
        vectors = [
            self.embed_draw(as_ints(r.get("drawn_numbers", []))[:pick], pool, pick)
            for r in recent
        ]
        query = np.mean(np.stack(vectors), axis=0)
        norm = np.linalg.norm(query)
        if norm > 0:
            query /= norm
        return self._cosine_search(game, rows, query, top_k=top_k, exclude_last=window)

    def retrieval_weights(
        self,
        game: str,
        rows: list[dict[str, Any]],
        numbers: list[int] | None = None,
        top_k: int = 25,
    ) -> dict[int, float]:
        """Aggregate number frequencies from similar draws (RAG augmentation)."""
        config = self.game_configs[game]
        pool, pick = config["pool"], config["pick"]
        if numbers:
            similar = self.similar_to_numbers(game, rows, numbers, top_k=top_k)
        else:
            similar = self.similar_to_recent_context(game, rows, top_k=top_k)
        counts: dict[int, float] = {n: 0.0 for n in range(1, pool + 1)}
        for item in similar:
            weight = float(item.get("similarity", 0.5))
            for number in as_ints(item.get("drawn_numbers", []))[:pick]:
                if 1 <= number <= pool:
                    counts[number] += weight
        max_count = max(counts.values()) or 1.0
        return {n: max(0.001, counts[n] / max_count) for n in range(1, pool + 1)}

    def rag_report(
        self,
        game: str,
        rows: list[dict[str, Any]],
        numbers: list[int] | None = None,
    ) -> dict[str, Any]:
        index = self.load_index(game, rows)
        similar = (
            self.similar_to_numbers(game, rows, numbers, top_k=12)
            if numbers
            else self.similar_to_recent_context(game, rows, top_k=12)
        )
        weights = self.retrieval_weights(game, rows, numbers=numbers)
        top_retrieved = sorted(
            [{"number": n, "weight": round(w, 4)} for n, w in weights.items()],
            key=lambda item: item["weight"],
            reverse=True,
        )[:12]
        return {
            "game": game,
            "indexed_draws": index["draws"],
            "vector_dimensions": index["dimensions"],
            "storage": str(self.vectors_dir),
            "method": "cosine similarity on multi-hot + profile embeddings (local numpy index)",
            "query": numbers or "recent_5_draw_context",
            "similar_draws": similar,
            "retrieval_top_numbers": top_retrieved,
        }
