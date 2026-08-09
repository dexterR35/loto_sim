"""Isolated adapter for official Loteria Romana Loto 6/49 results."""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timezone
from typing import Protocol

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import Loto649Config
from .domain import Draw, utc_now


class ResultNotPublished(RuntimeError):
    """The source responded successfully but did not publish a valid 6/49 result."""


class LotoSource(Protocol):
    def fetch_latest_649(self) -> Draw:
        ...

    def fetch_since(self, after: date | None, through: date | None = None) -> list[Draw]:
        ...


class OfficialLotoRoSource:
    def __init__(self, config: Loto649Config, session: requests.Session | None = None) -> None:
        source = config.section("source")
        self.url = str(source["url"])
        self.timeout = float(source.get("timeout_seconds", 25))
        self.session = session or requests.Session()
        retry = Retry(
            total=int(source.get("retries", 3)),
            read=int(source.get("retries", 3)),
            connect=int(source.get("retries", 3)),
            backoff_factor=float(source.get("backoff_seconds", 1.5)),
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "POST"}),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self.session.headers.update({
            "User-Agent": "loto-gpt/2.0 statistical-research (+https://www.loto.ro/)",
            "Accept": "text/html,application/xhtml+xml",
        })

    @staticmethod
    def parse_results(html: str, source_url: str, fetched_at: datetime | None = None) -> list[Draw]:
        fetched = fetched_at or utc_now()
        soup = BeautifulSoup(html, "html.parser")
        draws: dict[date, Draw] = {}
        for container in soup.select(".rezultate-extrageri-content"):
            details = container.select_one(".button-open-details p")
            text = details.get_text(" ", strip=True) if details else ""
            match = re.search(r"6\s*/\s*49\s+din\s+(\d{2}\.\d{2}\.\d{4})", text, flags=re.IGNORECASE)
            if not match:
                continue
            parsed_date = datetime.strptime(match.group(1), "%d.%m.%Y").date()
            numbers: list[int] = []
            for image in container.select(".numere-extrase img[src]"):
                number_match = re.search(r"/bile/(\d{1,2})\.png(?:\?.*)?$", str(image.get("src", "")))
                if number_match:
                    numbers.append(int(number_match.group(1)))
            snippet = str(container)
            source_hash = hashlib.sha256(snippet.encode("utf-8")).hexdigest()
            draw = Draw(
                draw_date=parsed_date,
                numbers=tuple(numbers),
                source=source_url,
                source_hash=source_hash,
                fetched_at=fetched,
                official_id=f"loto-ro-649-{parsed_date.isoformat()}",
            )
            draws[parsed_date] = draw
        return sorted(draws.values(), key=lambda item: item.draw_date)

    def _request(self, year: int | None = None, month: int | None = None) -> list[Draw]:
        if year and month:
            response = self.session.post(
                self.url,
                data={"select-year": str(year), "select-month": str(month)},
                timeout=self.timeout,
            )
        else:
            response = self.session.get(self.url, timeout=self.timeout)
        response.raise_for_status()
        draws = self.parse_results(response.text, self.url, datetime.now(timezone.utc).replace(microsecond=0))
        if not draws:
            raise ResultNotPublished("The official page did not contain a valid published Loto 6/49 draw")
        return draws

    def fetch_latest_649(self) -> Draw:
        return self._request()[-1]

    def fetch_since(self, after: date | None, through: date | None = None) -> list[Draw]:
        end = through or date.today()
        if after is None:
            latest = self.fetch_latest_649()
            return [latest]
        if after >= end:
            latest = self.fetch_latest_649()
            return [latest] if latest.draw_date > after else []
        year, month = after.year, after.month
        collected: dict[date, Draw] = {}
        while (year, month) <= (end.year, end.month):
            for draw in self._request(year, month):
                if after < draw.draw_date <= end:
                    collected[draw.draw_date] = draw
            month += 1
            if month == 13:
                year += 1
                month = 1
        return sorted(collected.values(), key=lambda item: item.draw_date)
