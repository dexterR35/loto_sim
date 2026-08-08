# loto-gpt backend

FastAPI over the local `data/lottery/lottery_history.csv` archive. The backend no longer reads raw HTML or archive JSONL at runtime.

## Development server

```bash
python3 backend/server.py --host 127.0.0.1 --port 8000
```

## Production server

```bash
python3 backend/production.py --host 0.0.0.0 --port 8000
```

Docker uses the production server by default.

### Production environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEB_WORKERS` | `WEB_THREADS` or `1` | Uvicorn worker processes |
| `PORT` | `8000` | Listen port |
| `HOST` | `0.0.0.0` | Listen host |

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

Train models manually:

```bash
python3 backend/train_lstm.py --game 6din49
```
