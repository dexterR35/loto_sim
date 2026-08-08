"""Production WSGI application for loto-gpt."""

from __future__ import annotations

import json
import mimetypes
import re
from pathlib import Path
from typing import Any, Callable

from werkzeug.exceptions import HTTPException, NotFound
from werkzeug.routing import Map, Rule
from werkzeug.wrappers import Request, Response

from security import (
    SECURITY_HEADERS,
    SecurityConfig,
    RateLimiter,
    client_ip,
    clamp_int,
    cors_origin,
    public_error_message,
    validate_numbers,
    validate_strategy,
)

ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"

# Import app state after path setup in server module.
from server import DATA, DIST_DIR as SERVER_DIST_DIR, GAME_CONFIGS, STRATEGIES  # noqa: E402

DIST_DIR = SERVER_DIST_DIR

CONFIG = SecurityConfig.from_env()
LIMITER = RateLimiter(CONFIG)

URL_MAP = Map([
    Rule("/api/health", endpoint="health", methods=["GET"]),
    Rule("/api/summary", endpoint="summary", methods=["GET"]),
    Rule("/api/stats", endpoint="stats", methods=["GET"]),
    Rule("/api/draws", endpoint="draws", methods=["GET"]),
    Rule("/api/ml", endpoint="ml", methods=["GET"]),
    Rule("/api/generate", endpoint="generate", methods=["POST"]),
    Rule("/api/analyze", endpoint="analyze", methods=["POST"]),
    Rule("/api/calculate", endpoint="calculate", methods=["POST"]),
    Rule("/", endpoint="static", methods=["GET"], defaults={"filename": "index.html"}),
    Rule("/<path:filename>", endpoint="static", methods=["GET"]),
])


def route_class(endpoint: str, payload: dict[str, Any] | None = None) -> str:
    if endpoint == "ml":
        return "ml"
    if endpoint in {"generate", "analyze", "calculate"}:
        strategy = str((payload or {}).get("strategy", ""))
        if strategy in {"ml_sklearn", "ml_lstm"}:
            return "ml"
        return "heavy"
    return "default"


def json_response(payload: Any, status: int = 200, origin: str | None = None) -> Response:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    response = Response(body, status=status, mimetype="application/json; charset=utf-8")
    response.headers["Content-Length"] = str(len(body))
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response


def with_security(response: Response, origin: str | None = None) -> Response:
    for key, value in SECURITY_HEADERS.items():
        response.headers[key] = value
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response


def require_game(game: str) -> str:
    if game not in GAME_CONFIGS:
        raise ValueError(f"Unknown game: {game}")
    return game


def handle_health() -> dict[str, Any]:
    return {"ok": True, "app": "loto-gpt", "production": True}


def handle_summary() -> dict[str, Any]:
    payload = DATA.summary()
    payload.pop("data_dir", None)
    return payload


def handle_stats(game: str) -> dict[str, Any]:
    return DATA.stats(require_game(game))


def handle_draws(game: str, limit: str | None, offset: str | None, year: str | None) -> dict[str, Any]:
    year_value = int(year) if year else None
    return DATA.draw_history(
        require_game(game),
        clamp_int(limit, 50, 1, 1000),
        clamp_int(offset, 0, 0, 1_000_000),
        year_value,
    )


def handle_ml(game: str) -> dict[str, Any]:
    return DATA.ml_report(require_game(game))


def handle_generate(payload: dict[str, Any]) -> dict[str, Any]:
    game = require_game(str(payload.get("game", "6din49")))
    strategy = validate_strategy(str(payload.get("strategy", "balanced")), STRATEGIES)
    ticket_count = clamp_int(payload.get("ticket_count", 6), 6, 1, 20)
    seed = payload.get("seed")
    seed_value = int(seed) if seed not in (None, "") else None
    simulations = clamp_int(payload.get("simulations", 2500), 2500, 200, 10000)
    return DATA.generate(game, strategy, ticket_count, seed_value, simulations)


def handle_analyze(payload: dict[str, Any]) -> dict[str, Any]:
    game = require_game(str(payload.get("game", "6din49")))
    numbers = payload.get("numbers", [])
    if isinstance(numbers, str):
        numbers = [int(part) for part in re.findall(r"\d+", numbers)]
    elif game != "noroc":
        numbers = validate_numbers(game, numbers, GAME_CONFIGS)
    joker = payload.get("joker")
    joker_value = int(joker) if joker not in (None, "") else None
    simulations = clamp_int(payload.get("simulations", 2500), 2500, 200, 10000)
    return DATA.analyze(game, numbers, joker_value, simulations=simulations)


def handle_calculate(payload: dict[str, Any]) -> dict[str, Any]:
    game = require_game(str(payload.get("game", "6din49")))
    numbers = payload.get("numbers", [])
    if isinstance(numbers, str):
        numbers = [int(part) for part in re.findall(r"\d+", numbers)] if game != "noroc" else numbers
    elif game != "noroc":
        numbers = validate_numbers(game, numbers, GAME_CONFIGS)
    joker = payload.get("joker")
    joker_value = int(joker) if joker not in (None, "") else None
    simulations = clamp_int(payload.get("simulations", 2500), 2500, 200, 10000)
    if game == "noroc":
        raw = numbers if isinstance(numbers, str) else numbers
        return DATA.calculate(game, raw, simulations=simulations)
    return DATA.calculate(game, numbers, joker_value, simulations)


def serve_static(filename: str) -> Response:
    if not DIST_DIR.exists():
        return json_response({"error": "Frontend build not found"}, status=503)
    safe_name = filename.lstrip("/")
    target = (DIST_DIR / safe_name).resolve()
    root = DIST_DIR.resolve()
    if not str(target).startswith(str(root)):
        return json_response({"error": "Forbidden"}, status=403)
    if target.is_dir() or not target.exists():
        target = DIST_DIR / "index.html"
    mime, _ = mimetypes.guess_type(str(target))
    data = target.read_bytes()
    response = Response(data, mimetype=mime or "application/octet-stream")
    response.headers["Content-Length"] = str(len(data))
    if target.suffix == ".html":
        response.headers["Cache-Control"] = "no-cache"
    else:
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response


HANDLERS: dict[str, Callable[..., Any]] = {
    "health": lambda **_: handle_health(),
    "summary": lambda **_: handle_summary(),
    "stats": lambda game, **_: handle_stats(game),
    "draws": lambda game, limit=None, offset=None, year=None, **_: handle_draws(game, limit, offset, year),
    "ml": lambda game, **_: handle_ml(game),
    "generate": lambda payload, **_: handle_generate(payload),
    "analyze": lambda payload, **_: handle_analyze(payload),
    "calculate": lambda payload, **_: handle_calculate(payload),
    "static": lambda filename="index.html", **_: serve_static(filename),
}


def application(environ: dict[str, Any], start_response: Callable[..., Any]) -> list[bytes]:
    request = Request(environ)
    origin_header = cors_origin(CONFIG, request.headers.get("Origin"))

    if request.method == "OPTIONS":
        response = Response(status=204)
        if origin_header:
            response.headers["Access-Control-Allow-Origin"] = origin_header
            response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Vary"] = "Origin"
        return with_security(response, origin_header)(environ, start_response)

    adapter = URL_MAP.bind_to_environ(environ)
    try:
        endpoint, values = adapter.match()
    except NotFound:
        response = json_response({"error": "Not found"}, status=404, origin=origin_header)
        return with_security(response, origin_header)(environ, start_response)

    payload: dict[str, Any] | None = None
    if request.method == "POST":
        if request.content_length and request.content_length > CONFIG.max_body_bytes:
            response = json_response({"error": "Request body too large"}, status=413, origin=origin_header)
            return with_security(response, origin_header)(environ, start_response)
        try:
            payload = request.get_json(force=True, silent=False) or {}
        except Exception:
            response = json_response({"error": "Invalid JSON"}, status=400, origin=origin_header)
            return with_security(response, origin_header)(environ, start_response)
        if not isinstance(payload, dict):
            response = json_response({"error": "JSON body must be an object"}, status=400, origin=origin_header)
            return with_security(response, origin_header)(environ, start_response)

    allowed, retry_after = LIMITER.check(client_ip(environ), route_class(endpoint, payload))
    if not allowed:
        response = json_response({"error": "Rate limit exceeded", "retry_after": retry_after}, status=429, origin=origin_header)
        response.headers["Retry-After"] = str(retry_after)
        return with_security(response, origin_header)(environ, start_response)

    try:
        handler = HANDLERS[endpoint]
        if endpoint in {"generate", "analyze", "calculate"}:
            result = handler(payload=payload)
            response = json_response(result, origin=origin_header)
        elif endpoint == "static":
            response = handler(**values)
        else:
            result = handler(**values)
            response = json_response(result, origin=origin_header)
    except HTTPException as exc:
        response = json_response({"error": exc.description or "Request error"}, status=exc.code, origin=origin_header)
    except Exception as exc:
        status = 400 if isinstance(exc, ValueError) else 500
        response = json_response({"error": public_error_message(CONFIG, exc)}, status=status, origin=origin_header)

    return with_security(response, origin_header)(environ, start_response)
