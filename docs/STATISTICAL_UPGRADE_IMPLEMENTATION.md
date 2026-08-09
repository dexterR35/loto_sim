# Loto 6/49 statistical and prediction upgrade

Implemented on 2026-08-09 for the existing `loto-gpt` application. The scope is intentionally limited to Romanian Loto 6/49; existing 5/40, Joker, Noroc, simulator, ML, and RAG routes remain intact.

## Delivered architecture

The upgrade lives in `backend/loto649/` and keeps `data/lottery/lottery_history.csv` as the source of truth:

1. `source.py` isolates the official Loteria Română selectors, bounded timeouts, HTTP retries, monthly catch-up, and the unpublished-result state.
2. `domain.py` validates immutable six-number draws and produces canonical hashes/serialization.
3. `repository.py` performs locked, atomic, idempotent CSV appends. Provenance is stored in `loto649_draw_metadata.jsonl`, keyed by date plus number set so legitimate same-day special draws remain distinct.
4. `statistics.py` produces observed/expected frequencies, Wilson intervals, global chi-square, FDR-corrected number/pair/triple tests, recency/gaps, rolling windows, EWMA, drift, entropy, autocorrelation, period comparisons, draw-pattern null tests, and seeded without-replacement Monte Carlo histories.
5. `features.py` creates one row per number using history strictly before the target. Every row carries `history_end_date` and `target_date`; same-day targets with unknowable publication order are skipped.
6. `evaluation.py` provides draw-by-draw expanding-window metrics, all required baselines, ordered ablations, a frozen pre-test scikit-learn benchmark, calibration metrics, yearly stability, ticket hit distributions, and comparison with many random strategies.
7. `models.py` handles deterministic temporal training, nested tuning/final validation blocks, ensemble-weight grid search, feature contributions, optional PyTorch experiments, legacy LSTM audit, and the promotion gate.
8. `registry.py`, `reports.py`, `prediction.py`, and `service.py` implement Champion/Challenger state, immutable prediction snapshots, separate immutable evaluations, reproducible reports, explanations, uncertainty, and update orchestration.

The operational sequence is:

```text
official fetch -> validate -> evaluate prior snapshot -> atomic append
-> statistics -> temporal Challenger -> promotion gates
-> next ranking/tickets -> immutable snapshot
```

A failed Challenger cannot roll back a valid official draw. A result that is not published is a clean no-op; a real source/network failure is logged and exits the CLI with status 2.

## Statistical contract

- Each number has observed/expected values, standardized residual, chi contribution, confidence interval, raw p-value, Benjamini-Hochberg adjusted p-value, rank, rolling windows (10/25/50/100/250/500, 1/3/5 years, full), gap distribution, EWMA/trend, period drift, relationships, prediction decomposition, and occurrence history.
- All 1,176 pairs use the exact combinatorial per-draw probability `C(47,4) / C(49,6)`.
- Supported triples are corrected against all `C(49,3)` possible hypotheses.
- Null Monte Carlo samples exactly six unique numbers per draw and records seed, run count, and version. It evaluates global chi-square, maximum marginal residual, maximum pair residual, maximum current gap, and marginal entropy. Ticket-generation simulation remains separate.
- Sum, parity, low/high, spread, consecutive counts, autocorrelation, entropy, drift, and arbitrary A/B period comparisons are exposed without conflating anomaly evidence with predictive advantage.

## Prediction and model policy

- Every strategy returns 49 finite ranking scores and calibrated marginal probabilities that sum to six.
- Required baselines: random uniform, frequency-only, recent frequency, hot, cold, overdue, balanced, and Monte Carlo.
- Additional reports include the statistical composite, ordered feature ablations, and a logistic ranker fitted once before an untouched 180-draw test range.
- Challenger training uses chronological train, ensemble-tuning, and final-validation blocks. Weight selection never sees the final block.
- Promotion requires the leakage audit, NDCG improvement, bounded Brier degradation, stability in both temporal halves, and an empirical many-random-strategy p-value at or below 0.05.
- LSTM artifacts remain archived until they have common walk-forward evidence. Future LSTM training now records seed, dataset hash, training cutoff, feature version, and a configurable 10/25/50/100 lookback (15 remains accepted for legacy compatibility).
- PyTorch is lazy and disabled by default. Enabling `ml.pytorch_enabled` trains a deterministic 49-output MLP as an experimental rejected artifact; it is not promoted without the common frozen-range protocol.

## Real-data run

The official updater appended seven validated draws:

```text
2026-07-16  24  4 46 37 14  1
2026-07-19  12 19 15 41 43 18
2026-07-23  43 28 20  3 44 30
2026-07-26  20 35 31 10 39 11
2026-07-30  16 18  2 19 22 13
2026-08-02  13 30 12 49 32 48
2026-08-06  25 16  5 41 42  6
```

The second updater run returned `already_up_to_date`, confirming the real persistence path is idempotent.
A further official check on Sunday, 2026-08-09 also returned `already_up_to_date`; the latest published result at check time remained Thursday, 2026-08-06. The configured draw weekdays are Thursday and Sunday, while scheduled retries deliberately avoid assuming an exact publication time.

Long-running API processes now watch the canonical CSV mtime/size and atomically refresh their legacy read caches after an external CLI or scheduled update. The dashboard and Statistical Lab separately label the latest official draw and a selected number's last appearance, so an older per-number date cannot be mistaken for the global latest extraction. Exact duplicate historical identities are filtered at read time without silently rewriting the archive.

Current dataset:

- 2,535 deduplicated Loto 6/49 draws, 1993-02-07 through 2026-08-06.
- dataset SHA-256: `4710ca11b49a91804ff02e303d89d3ff73bd83eb92d93e04aa5a96c243a0c7ca`.
- global chi-square: 48.754635 with 48 df; asymptotic p-value 0.4424977.
- 400-run exact-mechanism null: global empirical p-value 0.22194514; maximum pair-residual empirical p-value 0.06733167; maximum-gap empirical p-value 0.21945137.
- adjusted number signals: 0; adjusted pair signals: 0.
- conclusion: insufficient evidence against the uniform 6/49 null. This does not establish or refute predictability by itself.

The frozen 180-draw walk-forward range is 2024-10-27 through 2026-08-06, with 1,000 random-strategy comparisons:

| Strategy | Mean Hits@6 | NDCG@10 | Brier | Random percentile | Empirical p |
|---|---:|---:|---:|---:|---:|
| scikit-learn logistic, frozen pre-test | 0.8222 | 0.1810 | 0.10742 | 94.1% | 0.05994 |
| cold | 0.8000 | 0.1739 | 0.10969 | 89.0% | 0.12388 |
| frequency-only | 0.7611 | 0.1753 | 0.11031 | 67.1% | 0.32967 |
| Monte Carlo ticket strategy | 0.7333 | 0.1661 | 0.11061 | 47.8% | 0.52248 |
| statistical composite | 0.6556 | 0.1574 | 0.11098 | 10.5% | 0.89510 |

The random-strategy mean was 0.73248 Hits@6 with a 95% interval of 0.61667–0.84444. The scikit-learn result is encouraging but does not pass the 0.05 evidence gate. Model `sk-49f3db46b8a76d7f4b` was therefore demoted to `rejected`; no complex Champion is active. Its artifact, metrics, status transition, and the prediction made while it was provisionally active are preserved for audit.

An immutable snapshot for the scheduled 2026-08-09 draw was created before publication. Its Top 6 was `[5, 36, 7, 3, 4, 6]`; this is an experimental historical snapshot, not a recommendation or guarantee.

## API and UI

The FastAPI application exposes:

```text
GET  /api/649/latest
GET  /api/649/history
GET  /api/649/statistics
GET  /api/649/statistics/numbers
GET  /api/649/statistics/numbers/{number}
GET  /api/649/statistics/pairs
GET  /api/649/statistics/tests
GET  /api/649/statistics/compare
GET  /api/649/prediction/latest
GET  /api/649/predictions/history
GET  /api/649/models
GET  /api/649/backtest
POST /api/649/update
POST /api/649/train
POST /api/649/backtest
```

GET backtest reads only the persisted compact summary. Expensive POST jobs require `X-Admin-Token` matching `LOTO649_ADMIN_TOKEN`; without a configured token they are disabled. `LOTO649_ALLOW_UNAUTHENTICATED_ADMIN=1` is an explicit local-only escape hatch.

The React UI now has explicit ownership boundaries: the 6/49 dashboard is summary-only; the Generator contains only ticket creation and user-combination analysis; and the Statistical Lab is the canonical detailed workspace. Its five directly routable tabs are Inference, Number Explorer, Relationships, Prediction & Models, and Backtesting. The UI distinguishes MC ticket generation, uniform-draw null simulation, and random backtest baselines by both label and explanation. Other games retain their existing pages.

```text
/dashboard/6din49
/generator/6din49/play
/generator/6din49/analyze
/statistics/6din49/inference
/statistics/6din49/number
/statistics/6din49/relationships
/statistics/6din49/prediction
/statistics/6din49/backtest
/archive/6din49
```

## Operation

```bash
npm run loto649:update
npm run loto649:stats
npm run loto649:backtest
.venv/bin/python scripts/loto649_pipeline.py backtest --cached
npm run loto649:train
.venv/bin/python scripts/loto649_pipeline.py predict --ephemeral
```

GitHub Actions checks the official page multiple times on Thursday/Sunday, relies on idempotency rather than an assumed publication second, and commits only durable data/report/model state. Runtime logs and lock files are ignored.

## Validation

```bash
npm run test:backend
npm run build
.venv/bin/python -m compileall -q backend scripts/loto649_pipeline.py
```

The automated suite covers source parsing, malformed markup, changed selectors, timeout behavior, duplicate/conflicting draws, same-day provenance, atomic persistence, source failure no-mutation, statistical formulas, FDR, gaps, seeded null simulation, theoretical draw patterns, feature/target alignment, future-data rejection, snapshot immutability, evaluation ordering, all required API routes, admin protection, model temporal validation, ablations, and the frozen scikit-learn protocol.

The final suite contains 29 passing backend tests, including live-history cache refresh, duplicate-view filtering, read-only prediction GET behavior, and crash-safe immutable evaluation retry.

## Remaining limitations

- A 400-run null is suitable for routine refreshes but has coarse tail resolution; use up to the configured 10,000 runs for a publication-grade report.
- No model currently meets the full production gate. That is the correct outcome for the measured evidence.
- LSTM and PyTorch remain experimental until independently walk-forward validated; a neural architecture is not treated as evidence merely because it trains.
- Git-backed scheduled persistence assumes the repository permits Action pushes. Deployments that disallow that should replace the repository with transactional database storage.
- Scraper selectors are isolated and tested, but an upstream redesign will still produce a visible `result_not_published`/`source_error` state until the adapter is updated.
