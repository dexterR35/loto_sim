# loto-gpt backend

FastAPI over the local `data/lottery/lottery_history.csv` archive. The backend no longer reads raw HTML or archive JSONL at runtime.

## Development server

```bash
python backend/server.py --host 127.0.0.1 --port 8030
```

## Production server

```bash
python backend/production.py --host 0.0.0.0 --port 8030
```

Docker uses the production server by default.

### Production environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEB_WORKERS` | `WEB_THREADS` or `1` | Uvicorn worker processes |
| `PORT` | `8030` | Listen port |
| `HOST` | `0.0.0.0` | Listen host |
| `LOTO649_ADMIN_TOKEN` | unset | Enables protected update/train/backtest jobs |
| `LOTO649_ALLOW_UNAUTHENTICATED_ADMIN` | unset | Explicit local-only bypass for protected jobs |
| `ALLOW_RUNTIME_TRAINING` | unset | Legacy ML only; keep disabled in normal API processes |

## Endpoints

- `GET /api/health`
- `GET /api/summary`
- `GET /api/dataset`
- `GET /api/history?game=6din49&limit=100&year=2026`
- `GET /api/export/csv`
- `GET /api/stats?game=6din49`
- `GET /api/draws?game=6din49&limit=50`
- `GET /api/rag/search?q=2026&game=6din49`
- `GET /api/rag/similar?game=6din49&numbers=1,2,3,4,5,6`
- `GET /api/ml/predict?game=6din49`
- `POST /api/generate`
- `POST /api/calculate`
- `POST /api/analyze`

ML strategies for `POST /api/generate`:

- `ml_sklearn` — pandas features + scikit-learn gradient boosting
- `ml_lstm` — TensorFlow/Keras LSTM on sequential draw history

### Loto 6/49 research API

- `GET /api/649/latest`
- `GET /api/649/history`
- `GET /api/649/statistics`
- `GET /api/649/statistics/numbers`
- `GET /api/649/statistics/numbers/{number}`
- `GET /api/649/statistics/pairs`
- `GET /api/649/statistics/tests`
- `GET /api/649/statistics/compare`
- `GET /api/649/prediction/latest`
- `GET /api/649/predictions/history`
- `GET /api/649/models`
- `GET /api/649/backtest` (persisted compact report only)
- `POST /api/649/update` (admin)
- `POST /api/649/train` (admin)
- `POST /api/649/backtest` (admin)

Admin requests use `X-Admin-Token`. The CLI is the preferred scheduled-job interface:

```bash
python scripts/loto649_pipeline.py update
python scripts/loto649_pipeline.py statistics --simulations 400 --seed 42
python scripts/loto649_pipeline.py backtest
python scripts/loto649_pipeline.py backtest --cached
python scripts/loto649_pipeline.py train
python scripts/loto649_pipeline.py models
```

`result_not_published` and `already_up_to_date` are successful no-op states. `source_error` returns CLI status 2. The service evaluates a matching immutable snapshot before appending its target draw; prediction content and evaluation content are separate artifacts.

Train models manually:

```bash
python3 backend/train_lstm.py --game 6din49 --lookback 25 --seed 649
```
