# loto-gpt

A Vite + React + Tailwind app with a FastAPI backend for exploring Romanian lottery archives and generating ticket lines with statistical, ML, and local RAG methods.

## How it works

1. **Extract** — historical draw rows from 1993-2026 are normalized into one CSV.
2. **Store** — `data/lottery/lottery_history.csv` is the runtime source of truth. It includes draw numbers, extracted raw cells, date parts, category winners/prizes/reports, and `rag_text`.
3. **Serve** — FastAPI exposes the CSV as JSON, downloadable CSV, stats, RAG search, and ML/generation endpoints.
4. **Train/Predict** — LSTM and scikit-learn models read the same CSV-backed history through the API data layer.

The app uses local data in `data/lottery/`:

- `lottery_history.csv`: standalone 9,354-row history table with 141 columns.
- `ml_models/` / `ml_charts/`: trained LSTM/sklearn models and training charts.
- `vectors/`: local numpy vector indexes for RAG-style similarity search.

Statistical strategies (hot/cold/overdue/Monte Carlo) are also available. Lottery draws are random; models analyze history for exploration, not guaranteed prediction.

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

## Train LSTM models

```bash
source .venv/bin/activate
python3 backend/train_lstm.py --game 6din49 --epochs 30
python3 backend/train_lstm.py --all
```

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
