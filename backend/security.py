"""Production security helpers: rate limiting, CORS, headers, validation."""

from __future__ import annotations

import os
import re
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SecurityConfig:
    cors_origins: tuple[str, ...]
    rate_limit_default: tuple[int, int]
    rate_limit_heavy: tuple[int, int]
    rate_limit_ml: tuple[int, int]
    max_body_bytes: int
    debug_errors: bool

    @classmethod
    def from_env(cls) -> SecurityConfig:
        raw_origins = os.getenv("CORS_ORIGINS", "").strip()
        if raw_origins == "*":
            origins = ("*",)
        elif raw_origins:
            origins = tuple(origin.strip() for origin in raw_origins.split(",") if origin.strip())
        else:
            origins = ()

        return cls(
            cors_origins=origins,
            rate_limit_default=(
                int(os.getenv("RATE_LIMIT_DEFAULT_MAX", "120")),
                int(os.getenv("RATE_LIMIT_DEFAULT_WINDOW", "60")),
            ),
            rate_limit_heavy=(
                int(os.getenv("RATE_LIMIT_HEAVY_MAX", "20")),
                int(os.getenv("RATE_LIMIT_HEAVY_WINDOW", "60")),
            ),
            rate_limit_ml=(
                int(os.getenv("RATE_LIMIT_ML_MAX", "5")),
                int(os.getenv("RATE_LIMIT_ML_WINDOW", "60")),
            ),
            max_body_bytes=int(os.getenv("MAX_BODY_BYTES", "65536")),
            debug_errors=os.getenv("DEBUG", "").lower() in {"1", "true", "yes"},
        )


class RateLimiter:
    def __init__(self, config: SecurityConfig) -> None:
        self.config = config
        self._lock = threading.Lock()
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def _bucket(self, route_class: str) -> tuple[int, int]:
        if route_class == "ml":
            return self.config.rate_limit_ml
        if route_class == "heavy":
            return self.config.rate_limit_heavy
        return self.config.rate_limit_default

    def check(self, client_key: str, route_class: str) -> tuple[bool, int]:
        max_requests, window = self._bucket(route_class)
        now = time.monotonic()
        key = f"{client_key}:{route_class}"
        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > window:
                bucket.popleft()
            if len(bucket) >= max_requests:
                retry_after = max(1, int(window - (now - bucket[0])))
                return False, retry_after
            bucket.append(now)
            return True, 0


def client_ip(environ: dict[str, Any]) -> str:
    forwarded = environ.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return environ.get("REMOTE_ADDR", "unknown")


def cors_origin(config: SecurityConfig, request_origin: str | None) -> str | None:
    if not request_origin:
        return None
    if "*" in config.cors_origins:
        return "*"
    if request_origin in config.cors_origins:
        return request_origin
    return None


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
}


def public_error_message(config: SecurityConfig, exc: Exception) -> str:
    if config.debug_errors:
        return str(exc)
    if isinstance(exc, ValueError):
        return str(exc)
    return "Request could not be processed"


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


def validate_strategy(strategy: str, allowed: dict[str, str]) -> str:
    if strategy not in allowed:
        raise ValueError(f"Unknown strategy: {strategy}")
    return strategy


def validate_numbers(game: str, numbers: Any, game_configs: dict[str, dict[str, Any]]) -> list[int]:
    if not isinstance(numbers, list):
        raise ValueError("numbers must be a list of integers")
    config = game_configs[game]
    pool = config["pool"]
    parsed: list[int] = []
    for value in numbers:
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("numbers must contain integers only") from exc
        if number < 1 or number > pool:
            raise ValueError(f"numbers must be between 1 and {pool}")
        parsed.append(number)
    if len(parsed) > config["pick"]:
        raise ValueError(f"Too many numbers (max {config['pick']})")
    return parsed
