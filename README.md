# loto-gpt

A Vite + React + Tailwind app with a FastAPI backend for exploring Romanian lottery archives and generating ticket lines with statistical, ML, and local RAG methods.

The interface uses Tailwind CSS 4 through the Vite plugin. Its CSS-first theme lives in `src/styles.css`; there is no PostCSS configuration or legacy Tailwind config file.

## How it works

1. **Extract** — historical draw rows from 1993-2026 are normalized into one CSV.
2. **Store** — `data/lottery/lottery_history.csv` is the runtime source of truth. It includes draw numbers, extracted raw cells, date parts, category winners/prizes/reports, and `rag_text`.
3. **Serve** — FastAPI exposes the CSV as JSON, downloadable CSV, stats, RAG search, and ML/generation endpoints.
4. **Train/Predict** — LSTM and scikit-learn models read the same CSV-backed history through the API data layer.

The app uses local data in `data/lottery/`:

- `lottery_history.csv`: standalone 9,361-row history table with 141 columns.
- `ml_models/` / `ml_charts/`: trained LSTM/sklearn models and training charts.
- `vectors/`: local numpy vector indexes for RAG-style similarity search.
- `loto649_draw_metadata.jsonl`: fetch/source provenance for official 6/49 appends.
- `reports/loto649/`: versioned statistical, prediction, evaluation, and backtest artifacts.
- `model_registry/loto649/`: Champion/Challenger records and immutable status events.

Ticket-generation strategies (hot/cold/overdue/MC ticket generation) are also available. The separate uniform-draw simulation in the Statistical Lab tests whether archive anomalies are unusual; it does not generate tickets. Lottery draws are random, and model rankings are research experiments rather than guaranteed predictions.

The Loto 6/49 upgrade adds automatic official catch-up, rigorous inference/FDR, exact-mechanism null simulation, leakage-safe temporal features, immutable predictions, a model registry, walk-forward comparisons, and a 49-number explorer. See [the implementation and measured results](docs/STATISTICAL_UPGRADE_IMPLEMENTATION.md).

The current measured result is intentionally conservative: no complex model passes the complete production gate.

## UI map

- **Dashboard** is a compact status page: latest official draw, research verdict, next scheduled check, and the current experimental Top 6.
- **Generator** has two jobs only: create ticket lines and analyze a combination entered by the user.
- **6/49 Statistical Lab** is the single detailed workspace for inference, the 49-number explorer, number relationships, prediction/model explanations, and walk-forward backtesting.
- **Archive history** is the source-level draw browser.

The three simulation contexts are labeled separately in the UI: MC ticket generation creates candidate lines, uniform-draw null simulation tests archive anomalies, and random backtest baselines compare out-of-sample strategy performance.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
npm install
```

## Run

```bash
npm run dev
```

Frontend: `http://localhost:5173`  
FastAPI: `http://127.0.0.1:8000`

## Useful API Routes

- `GET /api/health`
- `GET /api/summary`
- `GET /api/dataset`
- `GET /api/history?game=6din49&limit=100&year=2026`
- `GET /api/export/csv`
- `GET /api/draws?game=6din49&limit=50`
- `GET /api/stats?game=6din49`
- `GET /api/rag/search?q=2026&game=6din49`
- `POST /api/generate`
- `POST /api/calculate`
- `POST /api/analyze`

## Docker

Build and run the full app (API + built frontend) on port **8000**:

```bash
docker compose up --build
```

Open `http://localhost:8000`

Train LSTM models inside the running container:

```bash
docker compose exec app python backend/train_lstm.py --all
```

The `data/lottery` folder is bind-mounted so CSV data and trained models persist on the host.

## Loto 6/49 pipeline

```bash
npm run loto649:update
npm run loto649:stats
npm run loto649:backtest
.venv/bin/python scripts/loto649_pipeline.py backtest --cached
npm run loto649:train
npm run test:backend
```

Expensive API jobs are disabled until an admin token is configured:

```bash
export LOTO649_ADMIN_TOKEN='replace-with-a-long-random-secret'
curl -X POST http://127.0.0.1:8000/api/649/backtest \
  -H "X-Admin-Token: $LOTO649_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"draws":180,"random_strategies":1000,"seed":42}'
```

Read endpoints never fetch the official website. Scheduled/CLI updates populate the persistent cache.

## Train LSTM models

```bash
source .venv/bin/activate
python3 backend/train_lstm.py --game 6din49 --epochs 30 --lookback 25 --seed 649
python3 backend/train_lstm.py --all
```
LSTM artifacts are experimental and are not promotion-eligible without the common temporal backtest evidence.

## Rebuild CSV From A Fresh Scrape

If you scrape new source pages, rebuild the standalone CSV before restarting the API:

```bash
python3 lottery_scraper.py archive \
  --base-url https://your-source-site/ \
  --start-year 1993 \
  --end-year 2026 \
  --output data/lottery \
  --delay 0.3

python3 scripts/build_history_csv.py
npm run dev
```
