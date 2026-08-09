"""Exact first-hit simulation helpers for a fixed Loto 6/49 target."""

from __future__ import annotations

import hashlib
import math
import random
import secrets
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np


POOL_SIZE = 49
DRAW_SIZE = 6
MAX_ATTEMPTS = 1_000_000_000_000
MAX_SAFE_SEED = 9_007_199_254_740_991
MAX_INPUT_SEED = 18_446_744_073_709_551_615
UNIFORM_COMBINATIONS = math.comb(POOL_SIZE, DRAW_SIZE)


MODEL_DEFINITIONS: dict[str, dict[str, str]] = {
    "random": {
        "label": "Uniform random",
        "family": "baseline",
        "description": "Every valid 6/49 combination has equal probability.",
    },
    "balanced": {
        "label": "Balanced archive",
        "family": "statistical",
        "description": "Blends frequency, absence gap, and cold-number weights.",
    },
    "hot": {
        "label": "Hot numbers",
        "family": "statistical",
        "description": "Weights historically frequent numbers more heavily.",
    },
    "cold": {
        "label": "Cold numbers",
        "family": "statistical",
        "description": "Weights historically infrequent numbers more heavily.",
    },
    "overdue": {
        "label": "Overdue numbers",
        "family": "statistical",
        "description": "Weights numbers by their current absence gap.",
    },
    "monte_carlo": {
        "label": "Monte Carlo weights",
        "family": "simulation",
        "description": "Uses the archive-weight mix that seeds the MC ticket generator.",
    },
    "ml_sklearn": {
        "label": "ML · sklearn",
        "family": "machine_learning",
        "description": "Samples from the gradient-boosting per-number probabilities.",
    },
    "ml_lstm": {
        "label": "ML · LSTM",
        "family": "machine_learning",
        "description": "Samples from the sequence model's per-number probabilities.",
    },
    "ml_blend": {
        "label": "ML blend",
        "family": "machine_learning",
        "description": "Samples from the existing sklearn/LSTM blended probabilities.",
    },
    "research_ensemble": {
        "label": "Research ensemble",
        "family": "ensemble",
        "description": "Uses the latest frozen 6/49 prediction snapshot scores.",
    },
}


DEFAULT_MODEL_KEYS = (
    "random",
    "balanced",
    "monte_carlo",
    "ml_sklearn",
    "ml_lstm",
    "ml_blend",
    "research_ensemble",
)


def validate_target(numbers: Sequence[int]) -> list[int]:
    """Return a canonical target or raise a user-facing validation error."""
    try:
        parsed = [int(number) for number in numbers]
    except (TypeError, ValueError) as exc:
        raise ValueError("Enter exactly 6 unique numbers from 1 to 49") from exc
    if len(parsed) != DRAW_SIZE or len(set(parsed)) != DRAW_SIZE:
        raise ValueError("Enter exactly 6 unique numbers from 1 to 49")
    if any(number < 1 or number > POOL_SIZE for number in parsed):
        raise ValueError("Every target number must be between 1 and 49")
    return sorted(parsed)


def validate_attempt_limit(value: int) -> int:
    try:
        attempts = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Attempt limit must be a whole number") from exc
    if attempts < 1 or attempts > MAX_ATTEMPTS:
        raise ValueError(f"Attempt limit must be between 1 and {MAX_ATTEMPTS:,}")
    return attempts


def validate_model_keys(values: Sequence[str] | None) -> list[str]:
    requested = list(values or DEFAULT_MODEL_KEYS)
    if not requested:
        raise ValueError("Select at least one model")
    unique: list[str] = []
    for value in requested:
        key = str(value)
        if key not in MODEL_DEFINITIONS:
            raise ValueError(f"Unknown target-simulation model: {key}")
        if key not in unique:
            unique.append(key)
    return unique


def exact_weighted_set_probability(
    weights: Mapping[int, float],
    target: Sequence[int],
    pool_size: int = POOL_SIZE,
) -> float:
    """Probability that weighted sampling without replacement returns ``target``.

    The dynamic program sums every possible ordering of the target numbers. Paths
    that select a non-target number are deliberately absent, so the final state is
    the exact unordered-combination probability.
    """
    canonical = validate_target(target)
    cleaned: dict[int, float] = {}
    for number in range(1, pool_size + 1):
        try:
            value = float(weights.get(number, 0.0))
        except (TypeError, ValueError):
            value = 0.0
        cleaned[number] = value if math.isfinite(value) and value > 0 else 0.0
    total_weight = sum(cleaned.values())
    if total_weight <= 0 or sum(value > 0 for value in cleaned.values()) < len(canonical):
        return 0.0

    target_weights = [cleaned[number] for number in canonical]
    states = 1 << len(canonical)
    selected_weights = [0.0] * states
    for mask in range(1, states):
        least_bit = mask & -mask
        index = least_bit.bit_length() - 1
        selected_weights[mask] = selected_weights[mask ^ least_bit] + target_weights[index]

    probabilities = [0.0] * states
    probabilities[0] = 1.0
    for mask in range(states - 1):
        current = probabilities[mask]
        if current <= 0:
            continue
        denominator = total_weight - selected_weights[mask]
        if denominator <= 0:
            continue
        for index, weight in enumerate(target_weights):
            bit = 1 << index
            if mask & bit or weight <= 0:
                continue
            probabilities[mask | bit] += current * weight / denominator
    return min(1.0, max(0.0, probabilities[-1]))


def _attempt_quantile(probability: float, quantile: float) -> int | None:
    if probability <= 0:
        return None
    if probability >= 1:
        return 1
    return max(1, math.ceil(math.log1p(-quantile) / math.log1p(-probability)))


def _sample_first_hit(probability: float, rng: random.Random) -> int | None:
    if probability <= 0:
        return None
    if probability >= 1:
        return 1
    # Inverse transform for a geometric distribution supported on 1, 2, ...
    return math.floor(math.log1p(-rng.random()) / math.log1p(-probability)) + 1


def _derived_seed(seed: int, model_key: str) -> int:
    digest = hashlib.sha256(f"{seed}:{model_key}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


def _weight_context(weights: Mapping[int, float], target: Sequence[int]) -> dict[str, Any]:
    cleaned = {number: max(0.0, float(weights.get(number, 0.0))) for number in range(1, POOL_SIZE + 1)}
    values = list(cleaned.values())
    uniform = max(values, default=0.0) - min(values, default=0.0) <= 1e-15
    if uniform:
        return {"top_numbers": [], "target_average_rank": None}
    ranked = sorted(cleaned, key=lambda number: (-cleaned[number], number))
    rank_by_number = {number: index for index, number in enumerate(ranked, start=1)}
    return {
        "top_numbers": ranked[:6],
        "target_average_rank": round(sum(rank_by_number[number] for number in target) / len(target), 2),
    }


def simulate_target_models(
    target: Sequence[int],
    attempt_limit: int,
    model_specs: Sequence[Mapping[str, Any]],
    seed: int | None = None,
) -> dict[str, Any]:
    """Sample the exact-hit count and first hit for each fixed model distribution."""
    canonical = validate_target(target)
    limit = validate_attempt_limit(attempt_limit)
    if seed is None:
        experiment_seed = secrets.randbelow(MAX_SAFE_SEED + 1)
    else:
        try:
            experiment_seed = int(seed)
        except (TypeError, ValueError) as exc:
            raise ValueError("Seed must be a whole number") from exc
        if experiment_seed < 0 or experiment_seed > MAX_INPUT_SEED:
            raise ValueError(f"Seed must be between 0 and {MAX_INPUT_SEED}")
    uniform_probability = 1.0 / UNIFORM_COMBINATIONS
    results: list[dict[str, Any]] = []

    for spec in model_specs:
        key = str(spec["key"])
        definition = MODEL_DEFINITIONS[key]
        error = spec.get("error")
        weights = spec.get("weights")
        base = {
            "key": key,
            **definition,
            "details": dict(spec.get("details") or {}),
        }
        if error or not isinstance(weights, Mapping):
            results.append({
                **base,
                "available": False,
                "error": str(error or "Model weights are unavailable"),
            })
            continue

        probability = exact_weighted_set_probability(weights, canonical)
        model_seed = _derived_seed(experiment_seed, key)
        first_hit = _sample_first_hit(probability, random.Random(model_seed))
        reached = first_hit is not None and first_hit <= limit
        if reached:
            remaining_attempts = limit - first_hit
            count_seed = _derived_seed(model_seed, "exact-hit-count")
            additional_hits = int(np.random.default_rng(count_seed).binomial(remaining_attempts, probability))
            exact_hits = 1 + additional_hits
        else:
            exact_hits = 0
        expected_hits = limit * probability
        log_survival = math.log1p(-probability) if 0 < probability < 1 else None
        chance_within_limit = (
            -math.expm1(limit * log_survival)
            if log_survival is not None
            else 1.0 if probability >= 1 else 0.0
        )
        context = _weight_context(weights, canonical)
        results.append({
            **base,
            **context,
            "available": True,
            "reached": reached,
            "status": "hit" if reached else "not_reached",
            "attempt_limit": limit,
            "attempts_run": min(first_hit, limit) if first_hit is not None else limit,
            "simulated_first_hit_attempt": first_hit,
            "exact_hits_within_limit": exact_hits,
            "expected_hits_within_limit": expected_hits,
            "exact_hits_per_million": exact_hits / limit * 1_000_000,
            "probability_per_ticket": probability,
            "one_in": round(1.0 / probability) if probability > 0 else None,
            "expected_attempts": round(1.0 / probability) if probability > 0 else None,
            "median_attempts": _attempt_quantile(probability, 0.5),
            "p95_attempts": _attempt_quantile(probability, 0.95),
            "hit_probability_within_limit": min(1.0, max(0.0, chance_within_limit)),
            "probability_uplift_vs_uniform": probability / uniform_probability if probability > 0 else 0.0,
            "model_seed": model_seed,
        })

    return {
        "game": "6din49",
        "target_numbers": canonical,
        "order_matters": False,
        "attempt_limit": limit,
        # Preserve old 64-bit seeds exactly across JSON/JavaScript boundaries.
        "seed": experiment_seed if experiment_seed <= MAX_SAFE_SEED else str(experiment_seed),
        "uniform_baseline": {
            "combinations": UNIFORM_COMBINATIONS,
            "probability_per_ticket": uniform_probability,
            "one_in": UNIFORM_COMBINATIONS,
        },
        "method": {
            "key": "exact_weighted_first_hit_and_count",
            "description": (
                "Exact weighted-combination probability with seeded first-hit and hit-count trials; "
                "statistically equivalent to generating independent tickets one at a time."
            ),
            "target_is_used_to_condition_weights": False,
            "uses_current_dataset": True,
        },
        "results": results,
    }
