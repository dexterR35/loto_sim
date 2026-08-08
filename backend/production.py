#!/usr/bin/env python3
"""Run the production FastAPI server with Uvicorn."""

from __future__ import annotations

import argparse
import os

import uvicorn


def main() -> int:
    parser = argparse.ArgumentParser(description="loto-gpt production FastAPI server")
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument("--workers", type=int, default=int(os.getenv("WEB_WORKERS", os.getenv("WEB_THREADS", "1"))))
    args = parser.parse_args()
    print(f"loto-gpt FastAPI production server at http://{args.host}:{args.port}")
    uvicorn.run("server:app", host=args.host, port=args.port, workers=args.workers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
