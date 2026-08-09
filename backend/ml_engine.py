#!/usr/bin/env python3
"""Machine-learning ticket generation for loto-gpt.

Scraped draw history is processed with pandas/numpy, then sequence models
(LSTM via TensorFlow/Keras) and scikit-learn classifiers predict number
probabilities for ticket generation.
"""

from __future__ import annotations

import hashlib
import json
import os
import pickle
import random
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import itertools

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

# Reduce TensorFlow log noise; without CUDA drivers TF automatically uses CPU.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

try:
    import tensorflow as tf
    from tensorflow import keras

    try:
        tf.config.set_visible_devices([], "GPU")
    except Exception:
        pass
    TF_AVAILABLE = True
    TF_DEVICE = "GPU" if tf.config.list_physical_devices("GPU") else "CPU"
except ImportError:
    TF_AVAILABLE = False
    TF_DEVICE = None

WINDOWS = (5, 15, 50)
LOOKBACK = 15
RUNTIME_TRAINING_ENABLED = os.getenv("ALLOW_RUNTIME_TRAINING", "").lower() in {"1", "true", "yes"}


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


def parse_date(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return datetime.min


class MLEngine:
    def __init__(self, data_dir: Path, game_configs: dict[str, dict[str, Any]]) -> None:
        self.data_dir = data_dir
        self.game_configs = game_configs
        self.models_dir = data_dir / "ml_models"
        self.charts_dir = data_dir / "ml_charts"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.charts_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, dict[str, Any]] = {}

    def available(self) -> dict[str, bool | str | None]:
        return {
            "pandas": True,
            "numpy": True,
            "sklearn": True,
            "tensorflow": TF_AVAILABLE,
            "lstm": TF_AVAILABLE,
            "matplotlib": True,
            "device": TF_DEVICE,
        }

    def draw_to_vector(self, drawn: list[int], pool: int) -> np.ndarray:
        vector = np.zeros(pool, dtype=np.float32)
        for number in drawn:
            if 1 <= number <= pool:
                vector[number - 1] = 1.0
        return vector

    def build_lstm_sequences(
        self, game: str, rows: list[dict[str, Any]], lookback: int = LOOKBACK
    ) -> tuple[np.ndarray, np.ndarray]:
        if lookback < 1:
            raise ValueError("lookback must be positive")
        config = self.game_configs[game]
        pool = config["pool"]
        pick = config["pick"]
        vectors = [
            self.draw_to_vector(as_ints(row.get("drawn_numbers", []))[:pick], pool)
            for row in rows
        ]
        matrix = np.stack(vectors)
        sequences: list[np.ndarray] = []
        targets: list[np.ndarray] = []
        for index in range(lookback, len(matrix)):
            sequences.append(matrix[index - lookback : index])
            targets.append(matrix[index])
        if not sequences:
            raise ValueError(f"Need at least {lookback + 1} draws for LSTM training")
        return np.stack(sequences), np.stack(targets)

    def build_noroc_lstm_sequences(
        self, rows: list[dict[str, Any]], lookback: int = LOOKBACK
    ) -> tuple[np.ndarray, np.ndarray]:
        import re

        if lookback < 1:
            raise ValueError("lookback must be positive")
        draws: list[np.ndarray] = []
        for row in rows:
            code = "".join(str(value) for value in row.get("drawn_numbers", []))
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
            vector = np.zeros(70, dtype=np.float32)
            for position, digit in enumerate(code):
                vector[position * 10 + int(digit)] = 1.0
            draws.append(vector)
        matrix = np.stack(draws)
        sequences: list[np.ndarray] = []
        targets: list[np.ndarray] = []
        for index in range(lookback, len(matrix)):
            sequences.append(matrix[index - lookback : index])
            targets.append(matrix[index])
        if not sequences:
            raise ValueError(f"Need at least {lookback + 1} Noroc draws for LSTM training")
        return np.stack(sequences), np.stack(targets)

    def build_number_dataset(self, game: str, rows: list[dict[str, Any]]) -> tuple[pd.DataFrame, pd.Series]:
        config = self.game_configs[game]
        pool = config["pool"]
        pick = config["pick"]
        records: list[dict[str, float | int]] = []
        labels: list[int] = []

        counts: Counter[int] = Counter()
        last_seen: dict[int, int] = {}
        window_hits: dict[int, list[int]] = defaultdict(list)
        pair_counts: Counter[tuple[int, int]] = Counter()
        last_drawn: set[int] = set()
        max_pair = 1

        for index, row in enumerate(rows):
            drawn = set(as_ints(row.get("drawn_numbers", []))[:pick])
            draw_date = parse_date(str(row.get("draw_date_iso", "")))
            month = draw_date.month if draw_date != datetime.min else 0
            weekday = draw_date.weekday() if draw_date != datetime.min else 0

            for number in range(1, pool + 1):
                recent = window_hits[number]
                freq_5 = sum(recent[-WINDOWS[0] :]) / WINDOWS[0]
                freq_15 = sum(recent[-WINDOWS[1] :]) / WINDOWS[1]
                freq_50 = sum(recent[-WINDOWS[2] :]) / WINDOWS[2]
                gap = index - last_seen.get(number, -1) if number in last_seen else index + 1
                pair_lift = 0.0
                if last_drawn:
                    pair_lift = sum(
                        pair_counts[tuple(sorted((number, mate)))]
                        for mate in last_drawn
                    ) / (max_pair * max(1, len(last_drawn)))
                records.append({
                    "number": number,
                    "number_norm": number / pool,
                    "draw_index": index,
                    "draw_progress": index / max(1, len(rows) - 1),
                    "freq_all": counts[number] / max(1, index),
                    "freq_5": freq_5,
                    "freq_15": freq_15,
                    "freq_50": freq_50,
                    "gap": gap,
                    "gap_norm": gap / max(1, index + 1),
                    "pair_lift": pair_lift / max_pair,
                    "month": month,
                    "weekday": weekday,
                    "odd": number % 2,
                    "decade": (number - 1) // 10,
                })
                labels.append(1 if number in drawn else 0)

            for pair in itertools.combinations(sorted(drawn), 2):
                pair_counts[pair] += 1
                max_pair = max(max_pair, pair_counts[pair])
            for number in range(1, pool + 1):
                window_hits[number].append(1 if number in drawn else 0)
            for number in drawn:
                counts[number] += 1
                last_seen[number] = index
            last_drawn = drawn

        frame = pd.DataFrame.from_records(records)
        return frame, pd.Series(labels, name="appeared")

    def build_noroc_dataset(self, rows: list[dict[str, Any]]) -> tuple[pd.DataFrame, pd.Series]:
        import re

        records: list[dict[str, float | int]] = []
        labels: list[int] = []
        positional: list[Counter[str]] = [Counter() for _ in range(7)]
        positional_gap: list[dict[str, int]] = [defaultdict(lambda: -1) for _ in range(7)]

        for index, row in enumerate(rows):
            code = "".join(str(value) for value in row.get("drawn_numbers", []))
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
            for position in range(7):
                digit = int(code[position])
                counter = positional[position]
                max_count = max(counter.values() or [1])
                for candidate in range(10):
                    gap = index - positional_gap[position].get(str(candidate), -1)
                    records.append({
                        "position": position,
                        "digit": candidate,
                        "draw_index": index,
                        "freq": counter[str(candidate)] / max(1, index),
                        "hot_rank": (max_count - counter[str(candidate)]) / max_count,
                        "gap": gap,
                        "gap_norm": gap / max(1, index + 1),
                    })
                    labels.append(1 if candidate == digit else 0)
                positional[position][code[position]] += 1
                positional_gap[position][code[position]] = index

        return pd.DataFrame.from_records(records), pd.Series(labels, name="appeared")

    def _feature_columns(self, frame: pd.DataFrame) -> list[str]:
        return [col for col in frame.columns if col not in {"number", "digit"}]

    def _save_chart(self, game: str, model_type: str, history: dict[str, list[float]]) -> str:
        path = self.charts_dir / f"{game}_{model_type}_training.png"
        plt.figure(figsize=(8, 4.5))
        for key, values in history.items():
            if values:
                plt.plot(values, label=key)
        plt.title(f"{game} {model_type} training")
        plt.xlabel("epoch" if model_type in {"lstm", "tensorflow"} else "iteration")
        plt.ylabel("metric")
        plt.legend()
        plt.tight_layout()
        plt.savefig(path, dpi=120)
        plt.close()
        return str(path)

    def train_sklearn(self, game: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        if game == "noroc":
            frame, labels = self.build_noroc_dataset(rows)
        else:
            frame, labels = self.build_number_dataset(game, rows)

        features = self._feature_columns(frame)
        # Temporal split by draw — no future leakage across train/test
        if "draw_index" in frame.columns and game != "noroc":
            draw_ids = sorted(frame["draw_index"].unique())
            split_at = max(1, int(len(draw_ids) * 0.8))
            train_draws = set(draw_ids[:split_at])
            train_mask = frame["draw_index"].isin(train_draws)
            test_mask = ~train_mask
            x_train, x_test = frame.loc[train_mask, features], frame.loc[test_mask, features]
            y_train, y_test = labels[train_mask], labels[test_mask]
        else:
            x_train, x_test, y_train, y_test = train_test_split(
                frame[features], labels, test_size=0.2, random_state=42, stratify=labels
            )

        model = GradientBoostingClassifier(
            random_state=42,
            learning_rate=0.08,
            max_depth=4,
            n_estimators=120,
        )
        model.fit(x_train, y_train)
        proba = model.predict_proba(x_test)[:, 1]
        auc = float(roc_auc_score(y_test, proba)) if len(set(y_test)) > 1 else 0.5
        staged_scores = [auc]
        chart_path = self._save_chart(game, "sklearn", {"val_auc": staged_scores})

        payload = {
            "model": model,
            "features": features,
            "game": game,
            "model_type": "sklearn",
            "metrics": {
                "roc_auc": round(auc, 4),
                "train_rows": len(x_train),
                "test_rows": len(x_test),
                "split": "temporal_by_draw",
            },
            "chart_path": chart_path,
        }
        model_path = self.models_dir / f"{game}_sklearn.pkl"
        with model_path.open("wb") as handle:
            pickle.dump(payload, handle)
        self._cache[f"{game}:sklearn"] = payload
        return payload

    def train_lstm(
        self,
        game: str,
        rows: list[dict[str, Any]],
        epochs: int = 30,
        lookback: int = LOOKBACK,
        seed: int = 649,
    ) -> dict[str, Any]:
        if not TF_AVAILABLE:
            raise RuntimeError("TensorFlow is not installed")
        if lookback not in {10, 15, 25, 50, 100}:
            raise ValueError("lookback must be one of 10, 15, 25, 50, or 100")
        if epochs < 1:
            raise ValueError("epochs must be positive")

        random.seed(seed)
        np.random.seed(seed)
        tf.keras.utils.set_random_seed(seed)
        try:
            tf.config.experimental.enable_op_determinism()
        except (AttributeError, RuntimeError):
            pass

        if game == "noroc":
            x, y = self.build_noroc_lstm_sequences(rows, lookback=lookback)
            output_size = 70
        else:
            x, y = self.build_lstm_sequences(game, rows, lookback=lookback)
            output_size = self.game_configs[game]["pool"]

        if len(x) < 10:
            raise ValueError("Need at least 10 sequences for a chronological train/validation split")
        x_train, x_val, y_train, y_val = train_test_split(x, y, test_size=0.2, random_state=42, shuffle=False)
        model = keras.Sequential([
            keras.layers.Input(shape=(lookback, x.shape[2])),
            keras.layers.LSTM(128, return_sequences=True),
            keras.layers.Dropout(0.2),
            keras.layers.LSTM(64),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(output_size, activation="sigmoid"),
        ])
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=0.001),
            loss="binary_crossentropy",
            metrics=[keras.metrics.AUC(name="auc")],
        )
        history = model.fit(
            x_train,
            y_train,
            validation_data=(x_val, y_val),
            epochs=epochs,
            batch_size=64,
            verbose=0,
        )
        val_auc = float(history.history.get("val_auc", [0.5])[-1])
        val_loss = float(history.history.get("val_loss", [0.0])[-1])
        chart_path = self._save_chart(
            game,
            "lstm",
            {
                "loss": history.history.get("loss", []),
                "val_loss": history.history.get("val_loss", []),
                "auc": history.history.get("auc", []),
                "val_auc": history.history.get("val_auc", []),
            },
        )

        model_path = self.models_dir / f"{game}_lstm.keras"
        model.save(model_path)
        training_rows = [
            {
                "date": str(row.get("draw_date_iso", "")),
                "numbers": as_ints(row.get("drawn_numbers", [])),
            }
            for row in rows
        ]
        dataset_hash = hashlib.sha256(
            json.dumps(training_rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        training_end_date = max(
            (str(row.get("draw_date_iso", "")) for row in rows),
            default="",
        )
        meta = {
            "game": game,
            "model_type": "lstm",
            "artifact_schema_version": 2,
            "feature_version": "multi_hot_sequence_v2",
            "lookback": lookback,
            "output_size": output_size,
            "seed": seed,
            "dataset_hash": dataset_hash,
            "training_end_date": training_end_date,
            "leakage_audit": "chronological split; every target uses only preceding draws",
            "metrics": {
                "val_auc": round(val_auc, 4),
                "val_loss": round(val_loss, 4),
                "train_sequences": len(x_train),
                "validation_sequences": len(x_val),
                "epochs": epochs,
                "split": "chronological_80_20",
            },
            "chart_path": chart_path,
            "model_path": str(model_path),
        }
        meta_path = self.models_dir / f"{game}_lstm.json"
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        payload = {**meta, "model": model}
        self._cache[f"{game}:lstm"] = payload
        return payload

    def load_model(self, game: str, model_type: str) -> dict[str, Any]:
        cache_key = f"{game}:{model_type}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        if model_type == "sklearn":
            model_path = self.models_dir / f"{game}_sklearn.pkl"
            if not model_path.exists():
                raise FileNotFoundError(f"No sklearn model for {game}")
            with model_path.open("rb") as handle:
                payload = pickle.load(handle)
            self._cache[cache_key] = payload
            return payload

        if model_type == "lstm":
            if not TF_AVAILABLE:
                raise RuntimeError("TensorFlow is not installed")
            meta_path = self.models_dir / f"{game}_lstm.json"
            model_path = self.models_dir / f"{game}_lstm.keras"
            if not meta_path.exists() or not model_path.exists():
                raise FileNotFoundError(f"No LSTM model for {game}")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["model"] = keras.models.load_model(model_path)
            self._cache[cache_key] = meta
            return meta

        raise ValueError(f"Unknown model type: {model_type}")

    def ensure_model(self, game: str, model_type: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        try:
            payload = self.load_model(game, model_type)
            if model_type == "sklearn" and payload.get("metrics", {}).get("split") != "temporal_by_draw":
                raise FileNotFoundError("stale sklearn model; retrain manually with backend/train_lstm.py or the sklearn training path")
            return payload
        except FileNotFoundError as exc:
            if not RUNTIME_TRAINING_ENABLED:
                raise FileNotFoundError(
                    f"No ready {model_type} model for {game}. Run training manually or set ALLOW_RUNTIME_TRAINING=1."
                ) from exc
            if model_type == "lstm":
                return self.train_lstm(game, rows)
            return self.train_sklearn(game, rows)

    def predict_lstm_weights(self, game: str, rows: list[dict[str, Any]]) -> dict[int, float]:
        if game == "noroc":
            return self.predict_noroc_lstm_weights(rows)

        config = self.game_configs[game]
        pool = config["pool"]
        pick = config["pick"]
        payload = self.ensure_model(game, "lstm", rows)
        model = payload["model"]
        vectors = [
            self.draw_to_vector(as_ints(row.get("drawn_numbers", []))[:pick], pool)
            for row in rows
        ]
        lookback = int(payload.get("lookback", LOOKBACK))
        if len(vectors) < lookback:
            raise ValueError(f"Need at least {lookback} draws for LSTM prediction")
        sequence = np.stack(vectors[-lookback:])[np.newaxis, ...]
        probs = model.predict(sequence, verbose=0).reshape(-1)
        return {number: float(max(probs[number - 1], 0.001)) for number in range(1, pool + 1)}

    def predict_noroc_lstm_weights(self, rows: list[dict[str, Any]]) -> dict[int, float]:
        import re

        payload = self.ensure_model("noroc", "lstm", rows)
        model = payload["model"]
        draws: list[np.ndarray] = []
        for row in rows:
            code = "".join(str(value) for value in row.get("drawn_numbers", []))
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
            vector = np.zeros(70, dtype=np.float32)
            for position, digit in enumerate(code):
                vector[position * 10 + int(digit)] = 1.0
            draws.append(vector)
        lookback = int(payload.get("lookback", LOOKBACK))
        if len(draws) < lookback:
            raise ValueError(f"Need at least {lookback} Noroc draws for LSTM prediction")
        sequence = np.stack(draws[-lookback:])[np.newaxis, ...]
        probs = model.predict(sequence, verbose=0).reshape(-1)
        flat_weights: dict[int, float] = {}
        for position in range(7):
            offset = position * 10
            for digit in range(10):
                flat_weights[position * 10 + digit] = float(max(probs[offset + digit], 0.001))
        return flat_weights

    def joker_weights(self, rows: list[dict[str, Any]], pool: int) -> dict[int, float]:
        counts: Counter[int] = Counter()
        for row in rows:
            joker = row.get("joker_number")
            if str(joker).isdigit():
                counts[int(joker)] += 1
        max_count = max(counts.values() or [1])
        return {
            number: (counts[number] + 1) / (max_count + 1)
            for number in range(1, pool + 1)
        }

    def predict_number_weights(
        self,
        game: str,
        rows: list[dict[str, Any]],
        model_type: str,
    ) -> dict[int, float]:
        if game == "noroc":
            if model_type == "lstm":
                return self.predict_noroc_lstm_weights(rows)
            return self.predict_noroc_weights(rows, model_type)

        if model_type == "lstm":
            return self.predict_lstm_weights(game, rows)

        config = self.game_configs[game]
        pool = config["pool"]
        pick = config["pick"]
        payload = self.ensure_model(game, model_type, rows)
        model = payload["model"]
        features = payload["features"]

        counts: Counter[int] = Counter()
        last_seen: dict[int, int] = {}
        window_hits: dict[int, list[int]] = defaultdict(list)
        pair_counts: Counter[tuple[int, int]] = Counter()
        last_drawn: set[int] = set()
        max_pair = 1
        for index, row in enumerate(rows):
            drawn = set(as_ints(row.get("drawn_numbers", []))[:pick])
            for number in range(1, pool + 1):
                window_hits[number].append(1 if number in drawn else 0)
            for pair in itertools.combinations(sorted(drawn), 2):
                pair_counts[pair] += 1
                max_pair = max(max_pair, pair_counts[pair])
            for number in drawn:
                counts[number] += 1
                last_seen[number] = index
            last_drawn = drawn

        index = len(rows)
        draw_date = parse_date(str(rows[-1].get("draw_date_iso", ""))) if rows else datetime.min
        month = draw_date.month if draw_date != datetime.min else 0
        weekday = draw_date.weekday() if draw_date != datetime.min else 0

        records = []
        for number in range(1, pool + 1):
            recent = window_hits[number]
            gap = index - last_seen.get(number, -1) if number in last_seen else index + 1
            pair_lift = 0.0
            if last_drawn:
                pair_lift = sum(
                    pair_counts[tuple(sorted((number, mate)))]
                    for mate in last_drawn
                ) / (max_pair * max(1, len(last_drawn)))
            records.append({
                "number": number,
                "number_norm": number / pool,
                "draw_index": index,
                "draw_progress": 1.0,
                "freq_all": counts[number] / max(1, index),
                "freq_5": sum(recent[-WINDOWS[0] :]) / WINDOWS[0],
                "freq_15": sum(recent[-WINDOWS[1] :]) / WINDOWS[1],
                "freq_50": sum(recent[-WINDOWS[2] :]) / WINDOWS[2],
                "gap": gap,
                "gap_norm": gap / max(1, index + 1),
                "pair_lift": pair_lift,
                "month": month,
                "weekday": weekday,
                "odd": number % 2,
                "decade": (number - 1) // 10,
            })

        frame = pd.DataFrame.from_records(records)
        matrix = frame[features]
        if model_type == "sklearn":
            probs = model.predict_proba(matrix)[:, 1]
        else:
            probs = model.predict(matrix.to_numpy(dtype=np.float32), verbose=0).reshape(-1)

        weights = {number: float(max(prob, 0.001)) for number, prob in zip(range(1, pool + 1), probs)}
        return weights

    def predict_noroc_weights(self, rows: list[dict[str, Any]], model_type: str) -> dict[int, float]:
        import re

        payload = self.ensure_model("noroc", model_type, rows)
        model = payload["model"]
        features = payload["features"]
        positional: list[Counter[str]] = [Counter() for _ in range(7)]
        positional_gap: list[dict[str, int]] = [defaultdict(lambda: -1) for _ in range(7)]
        for index, row in enumerate(rows):
            code = "".join(str(value) for value in row.get("drawn_numbers", []))
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
            for position in range(7):
                positional[position][code[position]] += 1
                positional_gap[position][code[position]] = index

        index = len(rows)
        flat_weights: dict[int, float] = {}
        for position in range(7):
            counter = positional[position]
            max_count = max(counter.values() or [1])
            records = []
            for candidate in range(10):
                gap = index - positional_gap[position].get(str(candidate), -1)
                records.append({
                    "position": position,
                    "digit": candidate,
                    "draw_index": index,
                    "freq": counter[str(candidate)] / max(1, index),
                    "hot_rank": (max_count - counter[str(candidate)]) / max_count,
                    "gap": gap,
                    "gap_norm": gap / max(1, index + 1),
                })
            frame = pd.DataFrame.from_records(records)
            matrix = frame[features]
            if model_type == "sklearn":
                probs = model.predict_proba(matrix)[:, 1]
            else:
                probs = model.predict(matrix.to_numpy(dtype=np.float32), verbose=0).reshape(-1)
            for candidate, prob in enumerate(probs):
                flat_weights[position * 10 + candidate] = float(max(prob, 0.001))
        return flat_weights

    def model_report(self, game: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        report: dict[str, Any] = {
            "game": game,
            "draws": len(rows),
            "libraries": self.available(),
            "runtime_training": RUNTIME_TRAINING_ENABLED,
            "models": {},
        }
        sklearn_path = self.models_dir / f"{game}_sklearn.pkl"
        if sklearn_path.exists():
            try:
                payload = self.load_model(game, "sklearn")
                report["models"]["sklearn"] = {
                    "status": "ready",
                    "metrics": payload.get("metrics", {}),
                    "chart_path": payload.get("chart_path"),
                }
            except Exception as exc:
                report["models"]["sklearn"] = {"status": "error", "error": str(exc)}
        else:
            report["models"]["sklearn"] = {"status": "missing"}

        meta_path = self.models_dir / f"{game}_lstm.json"
        model_path = self.models_dir / f"{game}_lstm.keras"
        if not TF_AVAILABLE:
            report["models"]["lstm"] = {"status": "tensorflow_not_installed"}
        elif meta_path.exists() and model_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                report["models"]["lstm"] = {
                    "status": "ready",
                    "metrics": meta.get("metrics", {}),
                    "chart_path": meta.get("chart_path"),
                }
            except Exception as exc:
                report["models"]["lstm"] = {"status": "error", "error": str(exc)}
        else:
            report["models"]["lstm"] = {"status": "missing"}
        return report

    def generate_tickets(
        self,
        game: str,
        rows: list[dict[str, Any]],
        model_type: str,
        ticket_count: int,
        seed: int | None,
        score_fn: Callable[[str, list[int]], float],
        ticket_payload_fn: Callable[..., dict[str, Any]],
        weighted_sample_fn: Callable[[list[int], dict[int, float], int, random.Random], list[int]],
        weighted_choice_fn: Callable[[list[int], dict[int, float], random.Random], int],
        rng: random.Random,
    ) -> dict[str, Any]:
        config = self.game_configs[game]
        if game == "noroc":
            return self._generate_noroc_tickets(rows, model_type, ticket_count, rng)

        weights = self.predict_number_weights(game, rows, model_type)
        pool = list(range(1, config["pool"] + 1))
        pick = config["pick"]
        tickets: list[dict[str, Any]] = []
        seen: set[tuple[int, ...]] = set()
        attempts = 0
        while len(tickets) < ticket_count and attempts < ticket_count * 120:
            attempts += 1
            nums = weighted_sample_fn(pool, weights, pick, rng)
            key = tuple(nums)
            if key in seen:
                continue
            seen.add(key)
            joker = None
            if game == "joker":
                joker_weights = self.joker_weights(rows, config["joker_pool"])
                joker_pool = list(range(1, config["joker_pool"] + 1))
                joker = weighted_choice_fn(joker_pool, joker_weights, rng)
            score = round(score_fn(game, nums), 2)
            tickets.append(ticket_payload_fn(game, nums, score, f"ml_{model_type}", rng, joker=joker))

        payload = self.ensure_model(game, model_type, rows)
        algorithm_name = "LSTM sequence model" if model_type == "lstm" else f"Machine learning ({model_type})"
        feature_list = (
            [
                f"last {payload.get('lookback', LOOKBACK)} draws encoded as multi-hot sequences",
                "stacked LSTM layers (128 → 64 units)",
                "sigmoid output per number probability",
            ]
            if model_type == "lstm"
            else [
                "rolling frequency windows (5/15/50 draws)",
                "gap since last seen",
                "calendar month/weekday",
                "number profile (odd/decade)",
            ]
        )
        return {
            "tickets": tickets,
            "algorithm": {
                "name": algorithm_name,
                "model_type": model_type,
                "metrics": payload.get("metrics", {}),
                "features": feature_list,
                "chart_path": payload.get("chart_path"),
                "lookback": payload.get("lookback", LOOKBACK) if model_type == "lstm" else None,
            },
            "top_probabilities": sorted(
                [{"number": number, "probability": round(weight, 4)} for number, weight in weights.items()],
                key=lambda item: item["probability"],
                reverse=True,
            )[:12],
        }

    def _generate_noroc_tickets(
        self,
        rows: list[dict[str, Any]],
        model_type: str,
        ticket_count: int,
        rng: random.Random,
    ) -> dict[str, Any]:
        import re

        positional: list[Counter[str]] = [Counter() for _ in range(7)]
        for row in rows:
            code = "".join(str(value) for value in row.get("drawn_numbers", []))
            code = re.sub(r"\D", "", code).zfill(7)[-7:]
            for position, digit in enumerate(code):
                positional[position][digit] += 1

        positional_weights = self.predict_noroc_weights(rows, model_type)
        tickets: list[dict[str, Any]] = []
        seen: set[str] = set()
        for _ in range(ticket_count * 30):
            code = ""
            for position in range(7):
                digits = list(range(10))
                weights = {
                    digit: positional_weights.get(position * 10 + digit, 0.001)
                    for digit in digits
                }
                total = sum(weights.values())
                target = rng.random() * total
                upto = 0.0
                chosen = digits[-1]
                for digit in digits:
                    upto += weights[digit]
                    if upto >= target:
                        chosen = digit
                        break
                code += str(chosen)
            if code in seen:
                continue
            seen.add(code)
            digit_score = sum(positional[i][d] for i, d in enumerate(code)) / max(1, len(rows))
            tickets.append({
                "code": code,
                "score": round(digit_score, 4),
                "strategy": f"ml_{model_type}",
            })
            if len(tickets) >= ticket_count:
                break

        payload = self.ensure_model("noroc", model_type, rows)
        return {
            "tickets": tickets,
            "algorithm": {
                "name": f"LSTM Noroc sequence model ({model_type})" if model_type == "lstm" else f"Machine learning Noroc ({model_type})",
                "model_type": model_type,
                "metrics": payload.get("metrics", {}),
                "chart_path": payload.get("chart_path"),
                "lookback": payload.get("lookback", LOOKBACK) if model_type == "lstm" else None,
            },
            "top_probabilities": [],
        }

    def predict_detailed(self, game: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        """Return per-number ML probabilities learned from chronological draw history."""
        if game == "noroc":
            sklearn_weights = self.predict_noroc_weights(rows, "sklearn")
            return {
                "game": game,
                "draws": len(rows),
                "models": {"sklearn": {"status": "ready"}},
                "predictions": [],
                "blend_available": False,
            }

        config = self.game_configs[game]
        pool = config["pool"]
        sklearn_weights: dict[int, float] = {}
        lstm_weights: dict[int, float] = {}
        sklearn_meta: dict[str, Any] = {"status": "error"}
        lstm_meta: dict[str, Any] = {"status": "unavailable"}

        try:
            sklearn_payload = self.ensure_model(game, "sklearn", rows)
            sklearn_weights = self.predict_number_weights(game, rows, "sklearn")
            sklearn_meta = {"status": "ready", "metrics": sklearn_payload.get("metrics", {})}
        except Exception as exc:
            sklearn_meta = {"status": "error", "error": str(exc)}

        if TF_AVAILABLE:
            try:
                lstm_payload = self.ensure_model(game, "lstm", rows)
                lstm_weights = self.predict_number_weights(game, rows, "lstm")
                lstm_meta = {
                    "status": "ready",
                    "metrics": lstm_payload.get("metrics", {}),
                    "lookback": lstm_payload.get("lookback", LOOKBACK),
                }
            except Exception as exc:
                lstm_meta = {"status": "error", "error": str(exc)}
        else:
            lstm_meta = {"status": "tensorflow_not_installed"}

        blend: dict[int, float] = {}
        for number in range(1, pool + 1):
            sk = sklearn_weights.get(number, 0.001)
            ls = lstm_weights.get(number, sk)
            if lstm_weights:
                blend[number] = 0.42 * sk + 0.58 * ls
            else:
                blend[number] = sk

        # Archive frequency context
        counts: Counter[int] = Counter()
        pick = config["pick"]
        for row in rows:
            for number in as_ints(row.get("drawn_numbers", []))[:pick]:
                if 1 <= number <= pool:
                    counts[number] += 1
        total = max(1, len(rows))
        expected = pick / pool

        predictions = []
        for number in range(1, pool + 1):
            sk_prob = sklearn_weights.get(number, 0.0)
            ls_prob = lstm_weights.get(number, 0.0)
            bl_prob = blend.get(number, 0.0)
            archive_rate = counts[number] / total
            lift = archive_rate / expected if expected else 1.0
            predictions.append({
                "number": number,
                "probability_sklearn": round(sk_prob, 4),
                "probability_lstm": round(ls_prob, 4) if lstm_weights else None,
                "probability_blend": round(bl_prob, 4),
                "archive_count": counts[number],
                "archive_rate": round(archive_rate * 100, 2),
                "lift_vs_expected": round(lift, 3),
            })

        predictions.sort(key=lambda item: item["probability_blend"], reverse=True)
        for rank, item in enumerate(predictions, start=1):
            item["rank"] = rank

        return {
            "game": game,
            "label": config["label"],
            "draws": len(rows),
            "lookback": lstm_meta.get("lookback", LOOKBACK),
            "device": TF_DEVICE or "CPU",
            "models": {
                "sklearn": sklearn_meta,
                "lstm": lstm_meta,
            },
            "features": [
                "rolling frequency windows (5 / 15 / 50 draws)",
                "gap since last appearance",
                "pair co-occurrence with previous draw",
                "calendar month & weekday",
                "number profile (odd / decade)",
                "LSTM: artifact-defined chronological multi-hot sequence",
            ],
            "training_note": "sklearn uses temporal train/test split by draw date (no future leakage)",
            "predictions": predictions,
            "top_numbers": predictions[:15],
            "blend_available": bool(lstm_weights),
            "disclaimer": "Lottery draws are random. ML learns historical patterns; it cannot guarantee future results.",
        }

    def score_line_ml(self, numbers: list[int], predictions: list[dict[str, Any]]) -> dict[str, Any]:
        by_number = {item["number"]: item for item in predictions}
        selected = sorted(numbers)
        probs = [by_number[n]["probability_blend"] for n in selected if n in by_number]
        if not probs:
            return {"ml_line_score": 0.0, "avg_probability": 0.0, "per_number": []}
        avg = sum(probs) / len(probs)
        synergy = avg * 100
        per_number = [
            {
                "number": n,
                "probability_blend": by_number[n]["probability_blend"],
                "rank": by_number[n]["rank"],
                "archive_count": by_number[n]["archive_count"],
            }
            for n in selected if n in by_number
        ]
        return {
            "ml_line_score": round(synergy, 2),
            "avg_probability": round(avg, 4),
            "per_number": per_number,
        }
