"""Descriptive, inferential, relationship, drift, and null-simulation statistics."""

from __future__ import annotations

import itertools
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import mean, median, pstdev
from typing import Any, Iterable, Sequence

import numpy as np

from .config import Loto649Config
from .domain import Draw, dataset_hash

try:
    from scipy.stats import binom, chi2, chi2_contingency, norm, pearsonr

    SCIPY_AVAILABLE = True
except ImportError:  # pragma: no cover - scipy is pulled by scikit-learn in production
    SCIPY_AVAILABLE = False
    binom = chi2 = chi2_contingency = norm = pearsonr = None


POOL = 49
PICK = 6
NUMBER_PROBABILITY = PICK / POOL
PAIR_PROBABILITY = math.comb(POOL - 2, PICK - 2) / math.comb(POOL, PICK)
TRIPLE_PROBABILITY = math.comb(POOL - 3, PICK - 3) / math.comb(POOL, PICK)


def normal_two_sided_p(z_score: float) -> float:
    if SCIPY_AVAILABLE:
        return float(2 * norm.sf(abs(z_score)))
    return math.erfc(abs(z_score) / math.sqrt(2))


def chi_square_survival(value: float, degrees_of_freedom: int) -> float:
    if SCIPY_AVAILABLE:
        return float(chi2.sf(value, degrees_of_freedom))
    # Wilson-Hilferty normal approximation is a safe fallback for df=48.
    if degrees_of_freedom <= 0:
        return 1.0
    transformed = ((value / degrees_of_freedom) ** (1 / 3) - (1 - 2 / (9 * degrees_of_freedom))) / math.sqrt(2 / (9 * degrees_of_freedom))
    return min(1.0, max(0.0, 0.5 * math.erfc(transformed / math.sqrt(2))))


def benjamini_hochberg(values: Sequence[float], total_tests: int | None = None) -> list[float]:
    """Benjamini-Hochberg correction with optional unreturned hypotheses."""
    if not values:
        return []
    m = max(len(values), int(total_tests or len(values)))
    ordered = sorted(enumerate(values), key=lambda item: item[1])
    adjusted = [1.0] * len(values)
    running = 1.0
    for rank_index in range(len(ordered) - 1, -1, -1):
        original_index, raw = ordered[rank_index]
        rank = rank_index + 1
        running = min(running, float(raw) * m / rank)
        adjusted[original_index] = min(1.0, max(0.0, running))
    return adjusted


def wilson_interval(successes: int, trials: int, confidence: float = 0.95) -> tuple[float, float]:
    if trials <= 0:
        return (0.0, 0.0)
    z_value = 1.959963984540054 if confidence == 0.95 else 1.959963984540054
    observed = successes / trials
    denominator = 1 + z_value * z_value / trials
    centre = observed + z_value * z_value / (2 * trials)
    spread = z_value * math.sqrt((observed * (1 - observed) + z_value * z_value / (4 * trials)) / trials)
    return (max(0.0, (centre - spread) / denominator), min(1.0, (centre + spread) / denominator))


def percentile_rank(values: Sequence[int | float], value: int | float) -> float:
    if not values:
        return 0.0
    less = sum(item < value for item in values)
    equal = sum(item == value for item in values)
    return (less + 0.5 * equal) / len(values)


def _status(raw_p: float, adjusted_p: float, z_score: float, stability: float, alpha: float) -> str:
    if adjusted_p < alpha and stability >= 0.6:
        return "statistically_interesting"
    if adjusted_p < alpha and stability < 0.6:
        return "unstable"
    if raw_p < alpha or abs(z_score) >= 2:
        return "watch"
    if abs(z_score) >= 1.25:
        return "weak_signal"
    return "neutral"


def _number_positions(draws: Sequence[Draw]) -> dict[int, list[int]]:
    positions = {number: [] for number in range(1, POOL + 1)}
    for index, draw in enumerate(draws):
        for number in draw.numbers:
            positions[number].append(index)
    return positions


def _ewma(draws: Sequence[Draw], number: int, span: int) -> float:
    alpha = 2 / (span + 1)
    value = NUMBER_PROBABILITY
    for draw in draws:
        value = alpha * (1.0 if number in draw.numbers else 0.0) + (1 - alpha) * value
    return value


def _window_rows(draws: Sequence[Draw], number: int, windows: Sequence[int]) -> dict[str, dict[str, float | int]]:
    result: dict[str, dict[str, float | int]] = {}
    for window in windows:
        subset = draws[-window:]
        observed = sum(number in draw.numbers for draw in subset)
        result[str(window)] = {
            "draws": len(subset),
            "observed": observed,
            "expected": round(len(subset) * NUMBER_PROBABILITY, 4),
            "rate": round(observed / max(1, len(subset)), 6),
        }
    if draws:
        end = draws[-1].draw_date
        for years in (1, 3, 5):
            cutoff = end - timedelta(days=round(365.2425 * years))
            subset = [draw for draw in draws if draw.draw_date > cutoff]
            observed = sum(number in draw.numbers for draw in subset)
            result[f"{years}y"] = {
                "draws": len(subset),
                "observed": observed,
                "expected": round(len(subset) * NUMBER_PROBABILITY, 4),
                "rate": round(observed / max(1, len(subset)), 6),
            }
    observed = sum(number in draw.numbers for draw in draws)
    result["full"] = {
        "draws": len(draws),
        "observed": observed,
        "expected": round(len(draws) * NUMBER_PROBABILITY, 4),
        "rate": round(observed / max(1, len(draws)), 6),
    }
    return result


def _trend_points(draws: Sequence[Draw], number: int, window: int = 50, maximum: int = 120) -> list[dict[str, Any]]:
    if not draws:
        return []
    start = max(window, len(draws) - maximum)
    points = []
    for target in range(start, len(draws) + 1):
        subset = draws[max(0, target - window):target]
        rate = sum(number in draw.numbers for draw in subset) / max(1, len(subset))
        points.append({"date": draws[target - 1].draw_date.isoformat(), "rate": round(rate, 6)})
    return points


def _period_definitions(draws: Sequence[Draw]) -> list[tuple[str, date, date]]:
    if not draws:
        return []
    return [
        ("1993-2000", date(1993, 1, 1), date(2000, 12, 31)),
        ("2001-2010", date(2001, 1, 1), date(2010, 12, 31)),
        ("2011-2020", date(2011, 1, 1), date(2020, 12, 31)),
        ("2021-present", date(2021, 1, 1), draws[-1].draw_date),
    ]


def _safe_distribution(counts: Sequence[int | float]) -> np.ndarray:
    array = np.asarray(counts, dtype=float) + 1e-12
    return array / array.sum()


def _js_divergence(left: Sequence[int | float], right: Sequence[int | float]) -> float:
    p = _safe_distribution(left)
    q = _safe_distribution(right)
    midpoint = 0.5 * (p + q)
    return float(0.5 * np.sum(p * np.log2(p / midpoint)) + 0.5 * np.sum(q * np.log2(q / midpoint)))


def _psi(actual: Sequence[int | float], expected: Sequence[int | float]) -> float:
    p = _safe_distribution(actual)
    q = _safe_distribution(expected)
    return float(np.sum((p - q) * np.log(p / q)))


def analyze_drift(draws: Sequence[Draw], alpha: float) -> dict[str, Any]:
    periods = []
    matrix = []
    number_periods = {number: [] for number in range(1, POOL + 1)}
    uniform = [1] * POOL
    for label, start, end in _period_definitions(draws):
        subset = [draw for draw in draws if start <= draw.draw_date <= end]
        if not subset:
            continue
        counter = Counter(number for draw in subset for number in draw.numbers)
        counts = [counter[number] for number in range(1, POOL + 1)]
        matrix.append(counts)
        periods.append({
            "label": label,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "draws": len(subset),
            "jensen_shannon_vs_uniform": round(_js_divergence(counts, uniform), 8),
            "psi_vs_uniform": round(_psi(counts, uniform), 8),
        })
        for number in range(1, POOL + 1):
            number_periods[number].append({
                "period": label,
                "draws": len(subset),
                "observed": counter[number],
                "expected": round(len(subset) * NUMBER_PROBABILITY, 4),
                "rate": round(counter[number] / len(subset), 6),
            })
    if len(matrix) >= 2 and SCIPY_AVAILABLE:
        statistic, p_value, degrees, _ = chi2_contingency(np.asarray(matrix), correction=False)
    else:
        statistic, p_value, degrees = 0.0, 1.0, 0
    divergences = []
    for first, second in itertools.combinations(range(len(matrix)), 2):
        divergences.append({
            "period_a": periods[first]["label"],
            "period_b": periods[second]["label"],
            "jensen_shannon": round(_js_divergence(matrix[first], matrix[second]), 8),
            "psi": round(_psi(matrix[first], matrix[second]), 8),
        })
    max_js = max((item["jensen_shannon"] for item in divergences), default=0.0)
    status = "watch" if p_value < alpha and max_js >= 0.002 else "neutral"
    return {
        "global_chi_square": round(float(statistic), 6),
        "degrees_of_freedom": int(degrees),
        "p_value": round(float(p_value), 8),
        "status": status,
        "periods": periods,
        "comparisons": divergences,
        "number_periods": number_periods,
        "interpretation": "Drift is descriptive/inferential evidence and is not predictive advantage.",
    }


def run_null_simulation(
    draw_count: int,
    real_chi_square: float,
    real_max_abs_z: float,
    n_simulations: int,
    seed: int,
    real_max_pair_z: float | None = None,
    real_max_current_gap: int | None = None,
    real_normalized_entropy: float | None = None,
) -> dict[str, Any]:
    runs = max(0, int(n_simulations))
    if runs == 0 or draw_count == 0:
        return {
            "simulation_version": "uniform-without-replacement-v2",
            "random_seed": seed,
            "n_simulations": 0,
            "status": "not_run",
        }
    rng = np.random.default_rng(seed)
    expected = draw_count * NUMBER_PROBABILITY
    variance = draw_count * NUMBER_PROBABILITY * (1 - NUMBER_PROBABILITY)
    simulated_chi = np.empty(runs, dtype=float)
    simulated_max_z = np.empty(runs, dtype=float)
    simulated_entropy = np.empty(runs, dtype=float)
    simulated_max_pair_z = np.empty(runs, dtype=float)
    simulated_max_gap = np.empty(runs, dtype=float)
    pair_expected = draw_count * PAIR_PROBABILITY
    pair_std = math.sqrt(max(1e-12, draw_count * PAIR_PROBABILITY * (1 - PAIR_PROBABILITY)))
    pair_columns = list(itertools.combinations(range(PICK), 2))
    valid_pair_codes = np.asarray([left * POOL + right for left in range(POOL) for right in range(left + 1, POOL)])
    batch_size = max(1, min(16, runs))
    cursor = 0
    while cursor < runs:
        batch = min(batch_size, runs - cursor)
        random_keys = rng.random((batch, draw_count, POOL), dtype=np.float32)
        selected = np.argpartition(random_keys, PICK - 1, axis=2)[:, :, :PICK]
        for local in range(batch):
            counts = np.bincount(selected[local].reshape(-1), minlength=POOL).astype(float)
            simulated_chi[cursor + local] = float(np.sum((counts - expected) ** 2 / expected))
            simulated_max_z[cursor + local] = float(np.max(np.abs(counts - expected) / math.sqrt(variance)))
            distribution = counts / counts.sum()
            simulated_entropy[cursor + local] = float(-np.sum(distribution * np.log2(distribution + 1e-15)) / math.log2(POOL))
            chosen = selected[local]
            pair_codes = []
            for first, second in pair_columns:
                left = np.minimum(chosen[:, first], chosen[:, second])
                right = np.maximum(chosen[:, first], chosen[:, second])
                pair_codes.append(left * POOL + right)
            pair_counts = np.bincount(np.concatenate(pair_codes), minlength=POOL * POOL).astype(float)
            simulated_max_pair_z[cursor + local] = float(
                np.max(np.abs(pair_counts[valid_pair_codes] - pair_expected) / pair_std)
            )
            last_seen = np.full(POOL, -1, dtype=int)
            for draw_index, draw_numbers in enumerate(chosen):
                last_seen[draw_numbers] = draw_index
            simulated_max_gap[cursor + local] = float(np.max((draw_count - 1) - last_seen))
        cursor += batch
    chi_exceed = int(np.count_nonzero(simulated_chi >= real_chi_square))
    z_exceed = int(np.count_nonzero(simulated_max_z >= real_max_abs_z))
    pair_exceed = int(np.count_nonzero(simulated_max_pair_z >= real_max_pair_z)) if real_max_pair_z is not None else 0
    gap_exceed = int(np.count_nonzero(simulated_max_gap >= real_max_current_gap)) if real_max_current_gap is not None else 0
    return {
        "simulation_version": "uniform-without-replacement-v2",
        "random_seed": seed,
        "n_simulations": runs,
        "draws_per_simulation": draw_count,
        "selection_mechanism": "six unique numbers sampled uniformly without replacement per draw",
        "global_chi_square": {
            "real": round(real_chi_square, 6),
            "null_mean": round(float(np.mean(simulated_chi)), 6),
            "null_std": round(float(np.std(simulated_chi)), 6),
            "percentile_real": round(float(np.mean(simulated_chi <= real_chi_square)), 6),
            "empirical_p_value": round((chi_exceed + 1) / (runs + 1), 8),
        },
        "maximum_absolute_residual": {
            "real": round(real_max_abs_z, 6),
            "null_mean": round(float(np.mean(simulated_max_z)), 6),
            "null_std": round(float(np.std(simulated_max_z)), 6),
            "percentile_real": round(float(np.mean(simulated_max_z <= real_max_abs_z)), 6),
            "empirical_p_value": round((z_exceed + 1) / (runs + 1), 8),
        },
        "normalized_marginal_entropy_null": {
            "real": round(real_normalized_entropy, 8) if real_normalized_entropy is not None else None,
            "mean": round(float(np.mean(simulated_entropy)), 8),
            "lower_95": round(float(np.quantile(simulated_entropy, 0.025)), 8),
            "upper_95": round(float(np.quantile(simulated_entropy, 0.975)), 8),
        },
        "maximum_pair_absolute_residual": {
            "real": round(real_max_pair_z, 6) if real_max_pair_z is not None else None,
            "null_mean": round(float(np.mean(simulated_max_pair_z)), 6),
            "null_std": round(float(np.std(simulated_max_pair_z)), 6),
            "percentile_real": round(float(np.mean(simulated_max_pair_z <= real_max_pair_z)), 6) if real_max_pair_z is not None else None,
            "empirical_p_value": round((pair_exceed + 1) / (runs + 1), 8) if real_max_pair_z is not None else None,
        },
        "maximum_current_gap": {
            "real": int(real_max_current_gap) if real_max_current_gap is not None else None,
            "null_mean": round(float(np.mean(simulated_max_gap)), 6),
            "null_std": round(float(np.std(simulated_max_gap)), 6),
            "percentile_real": round(float(np.mean(simulated_max_gap <= real_max_current_gap)), 6) if real_max_current_gap is not None else None,
            "empirical_p_value": round((gap_exceed + 1) / (runs + 1), 8) if real_max_current_gap is not None else None,
        },
        "status": "complete",
    }


class StatisticalEngine:
    def __init__(self, config: Loto649Config) -> None:
        self.config = config

    def build(self, draws: Sequence[Draw], n_simulations: int | None = None, seed: int | None = None) -> dict[str, Any]:
        ordered = sorted(draws, key=lambda item: item.draw_date)
        if not ordered:
            raise ValueError("At least one validated Loto 6/49 draw is required")
        if len({(draw.draw_date, tuple(sorted(draw.numbers))) for draw in ordered}) != len(ordered):
            raise ValueError("Historical draws must be unique by date and number combination")
        settings = self.config.section("statistics")
        alpha = float(settings["alpha"])
        fdr_alpha = float(settings["fdr_alpha"])
        windows = self.config.rolling_windows
        ewma_span = int(self.config.section("features").get("ewma_span", 25))
        total_draws = len(ordered)
        expected = total_draws * NUMBER_PROBABILITY
        variance = total_draws * NUMBER_PROBABILITY * (1 - NUMBER_PROBABILITY)
        positions = _number_positions(ordered)
        counts = {number: len(positions[number]) for number in range(1, POOL + 1)}
        chi_contributions = {number: (counts[number] - expected) ** 2 / expected for number in range(1, POOL + 1)}
        global_chi = sum(chi_contributions.values())
        global_p = chi_square_survival(global_chi, POOL - 1)
        raw_number_p = [normal_two_sided_p((counts[number] - expected) / math.sqrt(variance)) for number in range(1, POOL + 1)]
        adjusted_number_p = benjamini_hochberg(raw_number_p)
        frequency_order = sorted(range(1, POOL + 1), key=lambda number: (-counts[number], number))
        frequency_rank = {number: index + 1 for index, number in enumerate(frequency_order)}
        drift = analyze_drift(ordered, alpha)

        numbers: list[dict[str, Any]] = []
        for number in range(1, POOL + 1):
            observed = counts[number]
            z_score = (observed - expected) / math.sqrt(variance)
            occurrence_positions = positions[number]
            completed_gaps = [right - left - 1 for left, right in zip(occurrence_positions, occurrence_positions[1:])]
            current_gap = total_draws - 1 - occurrence_positions[-1] if occurrence_positions else total_draws
            lower_rate, upper_rate = wilson_interval(observed, total_draws)
            window_data = _window_rows(ordered, number, windows)
            signs = []
            for key in ("50", "100", "250", "500"):
                if key in window_data:
                    signs.append(math.copysign(1, float(window_data[key]["rate"]) - NUMBER_PROBABILITY) if float(window_data[key]["rate"]) != NUMBER_PROBABILITY else 0)
            dominant = max((signs.count(-1), signs.count(0), signs.count(1)), default=0)
            stability = dominant / max(1, len(signs))
            recent_rate = float(window_data.get("50", window_data["full"])["rate"])
            long_rate = observed / total_draws
            trend_delta = recent_rate - long_rate
            gap_tail = (1 - NUMBER_PROBABILITY) ** current_gap
            numbers.append({
                "number": number,
                "observed": observed,
                "expected": round(expected, 4),
                "difference": round(observed - expected, 4),
                "deviation_pct": round((observed - expected) / expected * 100, 4),
                "standardized_residual": round(z_score, 6),
                "chi_contribution": round(chi_contributions[number], 6),
                "confidence_interval": {
                    "level": 0.95,
                    "rate_lower": round(lower_rate, 8),
                    "rate_upper": round(upper_rate, 8),
                    "count_lower": round(lower_rate * total_draws, 3),
                    "count_upper": round(upper_rate * total_draws, 3),
                },
                "raw_p_value": round(raw_number_p[number - 1], 8),
                "adjusted_p_value": round(adjusted_number_p[number - 1], 8),
                "significant_raw": raw_number_p[number - 1] < alpha,
                "significant_adjusted": adjusted_number_p[number - 1] < fdr_alpha,
                "status": _status(raw_number_p[number - 1], adjusted_number_p[number - 1], z_score, stability, alpha),
                "frequency_rank": frequency_rank[number],
                "windows": window_data,
                "recency": {
                    "last_appearance": ordered[occurrence_positions[-1]].draw_date.isoformat() if occurrence_positions else None,
                    "current_gap": current_gap,
                    "mean_gap": round(mean(completed_gaps), 4) if completed_gaps else None,
                    "median_gap": round(median(completed_gaps), 4) if completed_gaps else None,
                    "std_gap": round(pstdev(completed_gaps), 4) if len(completed_gaps) > 1 else 0.0,
                    "max_gap": max(completed_gaps, default=current_gap),
                    "gap_percentile": round(percentile_rank(completed_gaps, current_gap), 6),
                    "gap_tail_probability": round(gap_tail, 8),
                    "expected_mean_gap": round((1 - NUMBER_PROBABILITY) / NUMBER_PROBABILITY, 6),
                    "warning": "A large gap does not make a number due to appear.",
                },
                "trend": {
                    "recent_rate_50": round(recent_rate, 6),
                    "long_term_rate": round(long_rate, 6),
                    "recent_vs_long_delta": round(trend_delta, 6),
                    "ewma_frequency": round(_ewma(ordered, number, ewma_span), 6),
                    "drift_score": round(abs(trend_delta) / NUMBER_PROBABILITY, 6),
                    "stability": round(stability, 6),
                    "rolling": _trend_points(ordered, number),
                },
                "periods": drift["number_periods"][number],
            })

        raw_gap_p = [float(item["recency"]["gap_tail_probability"]) for item in numbers]
        adjusted_gap_p = benjamini_hochberg(raw_gap_p)
        for index, item in enumerate(numbers):
            item["recency"].update({
                "raw_p_value": round(raw_gap_p[index], 8),
                "adjusted_p_value": round(adjusted_gap_p[index], 8),
                "significant_raw": raw_gap_p[index] < alpha,
                "significant_adjusted": adjusted_gap_p[index] < fdr_alpha,
            })
        gap_tests = {
            "null_model": "geometric waiting time implied by independent uniform draws",
            "expected_mean_gap": round((1 - NUMBER_PROBABILITY) / NUMBER_PROBABILITY, 6),
            "adjusted_signals": sum(value < fdr_alpha for value in adjusted_gap_p),
            "minimum_adjusted_p_value": round(min(adjusted_gap_p), 8),
            "warning": "A current gap is censored descriptive evidence and never means a number is due.",
        }

        pairs = self._pairs(ordered, alpha, fdr_alpha)
        triples = self._triples(ordered, alpha, fdr_alpha)
        autocorrelation = self._autocorrelation(ordered, alpha, fdr_alpha)
        entropy = self._entropy(ordered)
        patterns = self._draw_patterns(ordered)
        real_max_z = max(abs(item["standardized_residual"]) for item in numbers)
        requested_runs = int(n_simulations if n_simulations is not None else settings["monte_carlo_runs"])
        runs = min(max(0, requested_runs), int(settings.get("monte_carlo_max_runs", 10000)))
        simulation_seed = int(seed if seed is not None else settings["random_seed"])
        null_simulation = run_null_simulation(
            total_draws,
            global_chi,
            real_max_z,
            runs,
            simulation_seed,
            real_max_pair_z=max(abs(item["standardized_residual"]) for item in pairs),
            real_max_current_gap=max(int(item["recency"]["current_gap"]) for item in numbers),
            real_normalized_entropy=float(entropy["normalized_marginal"]),
        )

        return {
            "report_version": "loto649-statistical-v3",
            "dataset_version": dataset_hash(ordered),
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "draw_count": total_draws,
            "date_range": {"first": ordered[0].draw_date.isoformat(), "last": ordered[-1].draw_date.isoformat()},
            "configuration": {
                "alpha": alpha,
                "fdr_alpha": fdr_alpha,
                "rolling_windows": list(windows),
                "random_seed": simulation_seed,
                "n_simulations": runs,
            },
            "levels": {
                "descriptive": "What happened in the validated historical archive.",
                "inference": "Whether observed deviations are unusual under a uniform 6/49 null.",
                "prediction": "Only out-of-sample temporal backtests can assess predictive value.",
            },
            "global_tests": {
                "null_hypothesis": "Draws are compatible with uniform sampling of six distinct numbers from 1..49.",
                "chi_square": round(global_chi, 6),
                "degrees_of_freedom": POOL - 1,
                "p_value": round(global_p, 8),
                "alpha": alpha,
                "reject_null": global_p < alpha,
                "verdict": "evidence_against_uniform_null" if global_p < alpha else "insufficient_evidence_against_uniform_null",
                "warning": "Evidence against a null hypothesis is not evidence of predictive advantage.",
            },
            "numbers": numbers,
            "gap_tests": gap_tests,
            "pairs": pairs,
            "triples": triples,
            "drift": {key: value for key, value in drift.items() if key != "number_periods"},
            "autocorrelation": autocorrelation,
            "entropy": entropy,
            "draw_patterns": patterns,
            "monte_carlo_null": null_simulation,
            "warnings": [
                "Predictions and anomaly scores are experimental and cannot guarantee a future draw.",
                "Adjusted p-values are preferred because many numbers, pairs, triples, windows, and lags are tested.",
                "Monte Carlo null simulation is separate from ticket-generation simulation.",
            ],
        }

    def _pairs(self, draws: Sequence[Draw], alpha: float, fdr_alpha: float) -> list[dict[str, Any]]:
        counts: Counter[tuple[int, int]] = Counter()
        occurrences: dict[tuple[int, int], list[int]] = defaultdict(list)
        for index, draw in enumerate(draws):
            for pair in itertools.combinations(sorted(draw.numbers), 2):
                counts[pair] += 1
                occurrences[pair].append(index)
        expected = len(draws) * PAIR_PROBABILITY
        variance = len(draws) * PAIR_PROBABILITY * (1 - PAIR_PROBABILITY)
        raw_values: list[float] = []
        pairs = list(itertools.combinations(range(1, POOL + 1), 2))
        for pair in pairs:
            z_score = (counts[pair] - expected) / math.sqrt(max(variance, 1e-12))
            raw_values.append(normal_two_sided_p(z_score))
        adjusted = benjamini_hochberg(raw_values)
        result = []
        for index, pair in enumerate(pairs):
            observed = counts[pair]
            z_score = (observed - expected) / math.sqrt(max(variance, 1e-12))
            indexes = occurrences.get(pair, [])
            gaps = [right - left - 1 for left, right in zip(indexes, indexes[1:])]
            recency = len(draws) - 1 - indexes[-1] if indexes else len(draws)
            if SCIPY_AVAILABLE:
                null_percentile = float(binom.cdf(observed, len(draws), PAIR_PROBABILITY))
            else:
                null_percentile = 0.5 * (1 + math.erf(z_score / math.sqrt(2)))
            stability = 1.0 if observed >= int(self.config.section("statistics")["min_pair_support"]) else observed / max(1, int(self.config.section("statistics")["min_pair_support"]))
            result.append({
                "pair": list(pair),
                "observed": observed,
                "expected": round(expected, 6),
                "deviation": round(observed - expected, 6),
                "lift": round(observed / expected if expected else 0.0, 6),
                "standardized_residual": round(z_score, 6),
                "recency": recency,
                "average_gap": round(mean(gaps), 4) if gaps else None,
                "monte_carlo_percentile": round(null_percentile, 8),
                "null_percentile_method": "exact_binomial_marginal_under_uniform_draws",
                "raw_p_value": round(raw_values[index], 8),
                "adjusted_p_value": round(adjusted[index], 8),
                "significant_raw": raw_values[index] < alpha,
                "significant_adjusted": adjusted[index] < fdr_alpha,
                "status": _status(raw_values[index], adjusted[index], z_score, stability, alpha),
            })
        result.sort(key=lambda item: (-abs(item["standardized_residual"]), -item["observed"], item["pair"]))
        return result

    def _triples(self, draws: Sequence[Draw], alpha: float, fdr_alpha: float) -> dict[str, Any]:
        counts: Counter[tuple[int, int, int]] = Counter(
            triple for draw in draws for triple in itertools.combinations(sorted(draw.numbers), 3)
        )
        minimum = int(self.config.section("statistics")["min_triple_support"])
        supported = sorted((item for item in counts.items() if item[1] >= minimum), key=lambda item: (-item[1], item[0]))
        expected = len(draws) * TRIPLE_PROBABILITY
        variance = len(draws) * TRIPLE_PROBABILITY * (1 - TRIPLE_PROBABILITY)
        raw = [normal_two_sided_p((observed - expected) / math.sqrt(max(variance, 1e-12))) for _, observed in supported]
        adjusted = benjamini_hochberg(raw, total_tests=math.comb(POOL, 3))
        items = []
        for index, (triple, observed) in enumerate(supported):
            z_score = (observed - expected) / math.sqrt(max(variance, 1e-12))
            percentile = float(binom.cdf(observed, len(draws), TRIPLE_PROBABILITY)) if SCIPY_AVAILABLE else 0.5
            items.append({
                "triple": list(triple),
                "observed": observed,
                "expected": round(expected, 8),
                "lift": round(observed / expected if expected else 0.0, 6),
                "standardized_residual": round(z_score, 6),
                "monte_carlo_percentile": round(percentile, 8),
                "raw_p_value": round(raw[index], 8),
                "adjusted_p_value": round(adjusted[index], 8),
                "significant_raw": raw[index] < alpha,
                "significant_adjusted": adjusted[index] < fdr_alpha,
            })
        return {
            "possible_tests": math.comb(POOL, 3),
            "minimum_support": minimum,
            "returned": len(items),
            "expected_per_triple": round(expected, 8),
            "items": items[:500],
            "warning": "Sparse triples are filtered by support and FDR-corrected across all possible triples.",
        }

    def _autocorrelation(self, draws: Sequence[Draw], alpha: float, fdr_alpha: float) -> dict[str, Any]:
        tests = []
        raw = []
        for number in range(1, POOL + 1):
            series = np.asarray([1.0 if number in draw.numbers else 0.0 for draw in draws])
            for lag in range(1, 6):
                if len(series) <= lag + 2 or np.std(series[:-lag]) == 0 or np.std(series[lag:]) == 0:
                    correlation, p_value = 0.0, 1.0
                elif SCIPY_AVAILABLE:
                    correlation, p_value = pearsonr(series[:-lag], series[lag:])
                else:
                    correlation = float(np.corrcoef(series[:-lag], series[lag:])[0, 1])
                    p_value = normal_two_sided_p(correlation * math.sqrt(max(1, len(series) - lag - 2)))
                tests.append({"number": number, "lag": lag, "correlation": round(float(correlation), 8)})
                raw.append(float(p_value))
        adjusted = benjamini_hochberg(raw)
        for index, test in enumerate(tests):
            test.update({
                "raw_p_value": round(raw[index], 8),
                "adjusted_p_value": round(adjusted[index], 8),
                "significant_raw": raw[index] < alpha,
                "significant_adjusted": adjusted[index] < fdr_alpha,
            })
        tests.sort(key=lambda item: (item["adjusted_p_value"], -abs(item["correlation"])))
        return {
            "lags": [1, 2, 3, 4, 5],
            "tests": tests[:100],
            "adjusted_signals": sum(item["significant_adjusted"] for item in tests),
            "warning": "Small lag correlations require stability and out-of-sample confirmation.",
        }

    def _entropy(self, draws: Sequence[Draw]) -> dict[str, Any]:
        def normalized(subset: Sequence[Draw]) -> float:
            counter = Counter(number for draw in subset for number in draw.numbers)
            distribution = np.asarray([counter[number] for number in range(1, POOL + 1)], dtype=float)
            distribution /= max(1.0, distribution.sum())
            return float(-np.sum(distribution * np.log2(distribution + 1e-15)) / math.log2(POOL))

        pair_counts = Counter(pair for draw in draws for pair in itertools.combinations(sorted(draw.numbers), 2))
        pair_distribution = np.asarray(list(pair_counts.values()), dtype=float)
        pair_distribution /= max(1.0, pair_distribution.sum())
        pair_entropy = float(-np.sum(pair_distribution * np.log2(pair_distribution + 1e-15)) / math.log2(math.comb(POOL, 2)))
        return {
            "normalized_marginal": round(normalized(draws), 8),
            "normalized_pair": round(pair_entropy, 8),
            "rolling": {
                str(window): round(normalized(draws[-window:]), 8)
                for window in self.config.rolling_windows
                if draws[-window:]
            },
        }

    @staticmethod
    def _draw_patterns(draws: Sequence[Draw]) -> dict[str, Any]:
        sums = [sum(draw.numbers) for draw in draws]
        spreads = [max(draw.numbers) - min(draw.numbers) for draw in draws]
        odd_counts = Counter(sum(number % 2 for number in draw.numbers) for draw in draws)
        low_counts = Counter(sum(number <= 24 for number in draw.numbers) for draw in draws)
        consecutive_counts = Counter(
            sum(1 for left, right in zip(sorted(draw.numbers), sorted(draw.numbers)[1:]) if right - left == 1)
            for draw in draws
        )
        combinations = math.comb(POOL, PICK)

        def hypergeometric_test(observed: Counter[int], successes: int) -> dict[str, Any]:
            expected = {
                selected: len(draws) * math.comb(successes, selected) * math.comb(POOL - successes, PICK - selected) / combinations
                for selected in range(PICK + 1)
            }
            statistic = sum((observed[selected] - expected[selected]) ** 2 / expected[selected] for selected in range(PICK + 1))
            return {
                "expected": {str(key): round(value, 6) for key, value in expected.items()},
                "chi_square": round(statistic, 6),
                "degrees_of_freedom": PICK,
                "p_value": round(chi_square_survival(statistic, PICK), 8),
            }

        theoretical_sum_mean = PICK * (POOL + 1) / 2
        population_variance = (POOL * POOL - 1) / 12
        sum_variance = PICK * (POOL - PICK) / (POOL - 1) * population_variance
        sum_mean_z = (mean(sums) - theoretical_sum_mean) / math.sqrt(sum_variance / len(draws))
        return {
            "sum": {
                "mean": round(mean(sums), 6),
                "median": round(median(sums), 6),
                "std": round(pstdev(sums), 6),
                "min": min(sums),
                "max": max(sums),
                "theoretical_mean": round(theoretical_sum_mean, 6),
                "theoretical_std_per_draw": round(math.sqrt(sum_variance), 6),
                "mean_z_score": round(sum_mean_z, 6),
                "mean_p_value": round(normal_two_sided_p(sum_mean_z), 8),
            },
            "spread": {
                "mean": round(mean(spreads), 6),
                "median": round(median(spreads), 6),
                "min": min(spreads),
                "max": max(spreads),
            },
            "odd_count_distribution": {str(key): odd_counts[key] for key in range(PICK + 1)},
            "odd_count_uniform_test": hypergeometric_test(odd_counts, 25),
            "low_1_24_count_distribution": {str(key): low_counts[key] for key in range(PICK + 1)},
            "low_1_24_uniform_test": hypergeometric_test(low_counts, 24),
            "consecutive_pair_distribution": {str(key): value for key, value in sorted(consecutive_counts.items())},
        }


def compare_periods(draws: Sequence[Draw], start_a: date, end_a: date, start_b: date, end_b: date) -> dict[str, Any]:
    left = [draw for draw in draws if start_a <= draw.draw_date <= end_a]
    right = [draw for draw in draws if start_b <= draw.draw_date <= end_b]
    if not left or not right:
        raise ValueError("Both comparison periods must contain at least one draw")
    counts_left = Counter(number for draw in left for number in draw.numbers)
    counts_right = Counter(number for draw in right for number in draw.numbers)
    rows = []
    raw = []
    for number in range(1, POOL + 1):
        p_left = counts_left[number] / len(left)
        p_right = counts_right[number] / len(right)
        pooled = (counts_left[number] + counts_right[number]) / (len(left) + len(right))
        standard_error = math.sqrt(max(1e-15, pooled * (1 - pooled) * (1 / len(left) + 1 / len(right))))
        z_score = (p_right - p_left) / standard_error
        p_value = normal_two_sided_p(z_score)
        raw.append(p_value)
        rows.append({
            "number": number,
            "observed_a": counts_left[number],
            "expected_a": round(len(left) * NUMBER_PROBABILITY, 4),
            "rate_a": round(p_left, 8),
            "observed_b": counts_right[number],
            "expected_b": round(len(right) * NUMBER_PROBABILITY, 4),
            "rate_b": round(p_right, 8),
            "delta_rate": round(p_right - p_left, 8),
            "z_score": round(z_score, 6),
            "raw_p_value": round(p_value, 8),
        })
    adjusted = benjamini_hochberg(raw)
    for index, row in enumerate(rows):
        row["adjusted_p_value"] = round(adjusted[index], 8)
        row["significant_adjusted"] = adjusted[index] < 0.05
    return {
        "period_a": {"start": start_a.isoformat(), "end": end_a.isoformat(), "draws": len(left)},
        "period_b": {"start": start_b.isoformat(), "end": end_b.isoformat(), "draws": len(right)},
        "numbers": rows,
    }
