#!/usr/bin/env python3
"""Scrape public pages and lottery archives from a configurable source site.

The script has two independent jobs:

* crawl: follow same-domain HTML/PHP links and save page text plus raw HTML.
* archive: fetch the known lottery archive pages by year and export structured rows.

It intentionally uses only Python's standard library so it can run on a clean
machine without installing packages.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import sys
import time
from collections import deque
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib import robotparser
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


USER_AGENT = "lottery-archive-scraper/1.0"
DATE_RE = re.compile(r"^[A-Za-zĂÂÎȘȚăâîșț]{2},\s+\d{1,2}\s+\S+\s+\d{4}$")
YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")

MONTHS_RO = {
    "ianuarie": 1,
    "februarie": 2,
    "martie": 3,
    "aprilie": 4,
    "mai": 5,
    "iunie": 6,
    "iulie": 7,
    "august": 8,
    "septembrie": 9,
    "octombrie": 10,
    "noiembrie": 11,
    "decembrie": 12,
}


@dataclass(frozen=True)
class ArchiveSpec:
    key: str
    label: str
    path: str
    first_year: int
    drawn_count: int
    category_labels: tuple[str, ...]
    has_fond_castiguri: bool = False
    preserve_draw_as_string: bool = False
    joker_split: bool = False


ARCHIVES: dict[str, ArchiveSpec] = {
    "6din49": ArchiveSpec(
        key="6din49",
        label="Loto 6/49",
        path="/Loto/6-din-49/arhiva-rezultate.php",
        first_year=1993,
        drawn_count=6,
        category_labels=("I", "II", "III", "IV"),
    ),
    "noroc": ArchiveSpec(
        key="noroc",
        label="Loto Noroc",
        path="/Loto/noroc/arhiva-rezultate.php",
        first_year=1998,
        drawn_count=1,
        category_labels=("1", "2", "3", "4", "5", "N+3", "N-3"),
        has_fond_castiguri=True,
        preserve_draw_as_string=True,
    ),
    "5din40": ArchiveSpec(
        key="5din40",
        label="Loto 5/40",
        path="/Loto/5-din-40/arhiva-rezultate.php",
        first_year=1995,
        drawn_count=6,
        category_labels=("I", "II", "III"),
    ),
    "joker": ArchiveSpec(
        key="joker",
        label="Loto Joker",
        path="/Loto/joker/arhiva-rezultate.php",
        first_year=2000,
        drawn_count=6,
        category_labels=("I", "II", "III", "IV", "V", "VI", "VII", "VIII"),
        has_fond_castiguri=True,
        joker_split=True,
    ),
}

CSV_FIELDS = [
    "game",
    "game_label",
    "year",
    "draw_date_raw",
    "draw_date_iso",
    "drawn_numbers",
    "joker_number",
    "fond_castiguri",
    "category_data",
    "raw_cells",
    "raw_html_path",
    "source_url",
]

PAGE_CSV_FIELDS = [
    "url",
    "status",
    "content_type",
    "title",
    "text",
    "raw_html_path",
    "discovered_links",
]


def clean_space(value: str) -> str:
    value = html.unescape(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


def normalize_url(url: str) -> str:
    parts = urlsplit(url)
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)))
    path = parts.path or "/"
    scheme = (parts.scheme or "http").lower()
    netloc = parts.netloc.lower()
    if scheme == "http" and netloc.endswith(":80"):
        netloc = netloc[:-3]
    if scheme == "https" and netloc.endswith(":443"):
        netloc = netloc[:-4]
    return urlunsplit((scheme, netloc, path, query, ""))


def same_domain(url: str, base_url: str) -> bool:
    host = urlsplit(url).hostname or ""
    base_host = urlsplit(base_url).hostname or ""
    return host == base_host or host == f"www.{base_host}" or f"www.{host}" == base_host


def safe_relpath_for_url(url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    parts = urlsplit(url)
    path = (parts.path or "/").strip("/").replace("/", "__")
    if not path:
        path = "index"
    if parts.query:
        path = f"{path}__{hashlib.sha1(parts.query.encode('utf-8')).hexdigest()[:10]}"
    return f"{digest}__{path}.html"


def read_text_best_effort(payload: bytes, content_type: str) -> str:
    charset = "utf-8"
    match = re.search(r"charset=([\w.-]+)", content_type or "", re.I)
    if match:
        charset = match.group(1)
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def fetch_url(url: str, timeout: float, user_agent: str = USER_AGENT) -> tuple[int, str, bytes]:
    request = Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            content_type = response.headers.get("Content-Type", "")
            return status, content_type, response.read()
    except HTTPError as exc:
        content_type = exc.headers.get("Content-Type", "") if exc.headers else ""
        return exc.code, content_type, exc.read()
    except URLError as exc:
        raise RuntimeError(f"failed to fetch {url}: {exc}") from exc


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.text_parts: list[str] = []
        self.title_parts: list[str] = []
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs_dict = dict(attrs)
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if tag == "title":
            self._in_title = True
        if tag in {"a", "area"}:
            href = attrs_dict.get("href")
            if href:
                self.links.append(href)
        elif tag in {"br", "p", "div", "tr", "li", "h1", "h2", "h3"} and self._skip_depth == 0:
            self.text_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"} and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._in_title:
            self.title_parts.append(data)
        self.text_parts.append(data)

    @property
    def title(self) -> str:
        return clean_space(" ".join(self.title_parts))

    @property
    def text(self) -> str:
        lines = [clean_space(line) for line in "".join(self.text_parts).splitlines()]
        return "\n".join(line for line in lines if line)


class TableParser(HTMLParser):
    """Collect all table rows and cell text from permissive old HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._table_stack: list[list[list[str]]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "table":
            self._table_stack.append([])
        elif tag == "tr" and self._table_stack:
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []
        elif tag == "br" and self._current_cell is not None:
            self._current_cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag in {"td", "th"} and self._current_cell is not None and self._current_row is not None:
            self._current_row.append(clean_space("".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None and self._table_stack:
            if any(cell for cell in self._current_row):
                self._table_stack[-1].append(self._current_row)
            self._current_row = None
        elif tag == "table" and self._table_stack:
            table = self._table_stack.pop()
            if table:
                self.tables.append(table)

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._current_cell is not None:
            self._current_cell.append(data)


def parse_tables(html_text: str) -> list[list[list[str]]]:
    parser = TableParser()
    parser.feed(html_text)
    parser.close()
    return parser.tables


def parse_page(html_text: str) -> PageParser:
    parser = PageParser()
    parser.feed(html_text)
    parser.close()
    return parser


def parse_romanian_date(value: str) -> str:
    value = clean_space(value)
    _, _, date_part = value.partition(",")
    parts = date_part.strip().split()
    if len(parts) != 3:
        return ""
    day_s, month_s, year_s = parts
    month = MONTHS_RO.get(month_s.lower())
    if not month:
        return ""
    try:
        return date(int(year_s), month, int(day_s)).isoformat()
    except ValueError:
        return ""


def extract_archive_year(html_text: str, fallback: int) -> int:
    title_match = re.search(r"Arhiva rezultatelor .*? pentru anul\s+(\d{4})", html_text, re.I)
    if title_match:
        return int(title_match.group(1))
    return fallback


def row_looks_like_draw(row: list[str]) -> bool:
    if not row:
        return False
    first = clean_space(row[0])
    if not DATE_RE.match(first):
        return False
    return bool(YEAR_RE.search(first))


def normalize_drawn_numbers(spec: ArchiveSpec, cells: list[str]) -> tuple[list[str | int], str]:
    drawn_raw = cells[: spec.drawn_count]
    if spec.joker_split:
        first_set = [int(v) if v.isdigit() else v for v in drawn_raw[:5]]
        joker = drawn_raw[5] if len(drawn_raw) > 5 else ""
        return first_set, joker
    if spec.preserve_draw_as_string:
        return drawn_raw, ""
    normalized: list[str | int] = []
    for value in drawn_raw:
        normalized.append(int(value) if value.isdigit() else value)
    return normalized, ""


def categories_from_cells(labels: Iterable[str], cells: list[str]) -> dict[str, dict[str, str]]:
    categories: dict[str, dict[str, str]] = {}
    offset = 0
    for label in labels:
        chunk = cells[offset : offset + 3]
        if len(chunk) < 3:
            break
        categories[label] = {
            "numar_castiguri": chunk[0],
            "valoare_castig": chunk[1],
            "report": chunk[2],
        }
        offset += 3
    return categories


def extract_archive_rows(html_text: str, spec: ArchiveSpec, url: str, requested_year: int) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    page_year = extract_archive_year(html_text, requested_year)
    tables = parse_tables(html_text)
    for table in tables:
        for row in table:
            if not row_looks_like_draw(row):
                continue
            draw_date_raw = clean_space(row[0])
            data_cells = [clean_space(cell) for cell in row[1:]]
            drawn_numbers, joker_number = normalize_drawn_numbers(spec, data_cells)
            rest = data_cells[spec.drawn_count :]
            fond_castiguri = ""
            if spec.has_fond_castiguri and rest:
                fond_castiguri = rest[0]
                rest = rest[1:]
            category_data = categories_from_cells(spec.category_labels, rest)
            rows.append(
                {
                    "game": spec.key,
                    "game_label": spec.label,
                    "year": page_year,
                    "draw_date_raw": draw_date_raw,
                    "draw_date_iso": parse_romanian_date(draw_date_raw),
                    "drawn_numbers": drawn_numbers,
                    "joker_number": joker_number,
                    "fond_castiguri": fond_castiguri,
                    "category_data": category_data,
                    "raw_cells": row,
                    "source_url": url,
                }
            )
    return rows


def write_jsonl(path: Path, records: Iterable[dict[str, object]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            count += 1
    return count


def write_archive_csv(path: Path, rows: Iterable[dict[str, object]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            csv_row: dict[str, str] = {}
            for field in CSV_FIELDS:
                value = row.get(field, "")
                if isinstance(value, (dict, list)):
                    csv_row[field] = json.dumps(value, ensure_ascii=False, sort_keys=True)
                else:
                    csv_row[field] = str(value)
            writer.writerow(csv_row)
            count += 1
    return count

def write_pages_csv(path: Path, rows: Iterable[dict[str, object]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=PAGE_CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            csv_row: dict[str, str] = {}
            for field in PAGE_CSV_FIELDS:
                value = row.get(field, "")
                if isinstance(value, (dict, list)):
                    csv_row[field] = json.dumps(value, ensure_ascii=False, sort_keys=True)
                else:
                    csv_row[field] = str(value)
            writer.writerow(csv_row)
            count += 1
    return count


def archive_url(base_url: str, spec: ArchiveSpec, year: int) -> str:
    return urljoin(base_url, f"{spec.path}?Y={year}")


def selected_archive_specs(game: str) -> list[ArchiveSpec]:
    if game == "all":
        return list(ARCHIVES.values())
    if game not in ARCHIVES:
        raise SystemExit(f"unknown game {game!r}; choose one of: all, {', '.join(ARCHIVES)}")
    return [ARCHIVES[game]]


def scrape_archives(args: argparse.Namespace) -> int:
    output = Path(args.output)
    base_url = normalize_url(args.base_url)
    all_rows: list[dict[str, object]] = []
    errors: list[dict[str, object]] = []
    specs = selected_archive_specs(args.game)

    for spec in specs:
        start_year = max(args.start_year, spec.first_year)
        end_year = args.end_year
        if start_year > end_year:
            continue
        for year in range(start_year, end_year + 1):
            url = archive_url(base_url, spec, year)
            raw_path = output / "raw" / "archive" / spec.key / f"{year}.html"
            try:
                status, content_type, payload = fetch_url(url, timeout=args.timeout)
                html_text = read_text_best_effort(payload, content_type)
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_text(html_text, encoding="utf-8")
                rows = extract_archive_rows(html_text, spec, url, year)
                for row in rows:
                    row["raw_html_path"] = str(raw_path)
                all_rows.extend(rows)
                print(f"archive {spec.key} {year}: status={status} rows={len(rows)}", file=sys.stderr)
            except Exception as exc:  # keep the full run going across years
                print(f"archive {spec.key} {year}: ERROR {exc}", file=sys.stderr)
                errors.append({"game": spec.key, "year": year, "url": url, "error": str(exc)})
            time.sleep(args.delay)

    write_jsonl(output / "archive_results.jsonl", all_rows)
    write_archive_csv(output / "archive_results.csv", all_rows)
    if errors:
        write_jsonl(output / "archive_errors.jsonl", errors)
    print(f"archive complete: {len(all_rows)} rows -> {output}", file=sys.stderr)
    return 0 if all_rows else 1


def robot_checker(base_url: str, timeout: float, ignore_robots: bool) -> robotparser.RobotFileParser | None:
    if ignore_robots:
        return None
    robots_url = urljoin(base_url, "/robots.txt")
    parser = robotparser.RobotFileParser()
    parser.set_url(robots_url)
    try:
        status, content_type, payload = fetch_url(robots_url, timeout=timeout)
        if status >= 400:
            return parser
        parser.parse(read_text_best_effort(payload, content_type).splitlines())
    except Exception as exc:
        print(f"warning: could not read robots.txt ({exc}); continuing cautiously", file=sys.stderr)
    return parser


def should_keep_link(url: str, base_url: str, include_assets: bool) -> bool:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"}:
        return False
    if not same_domain(url, base_url):
        return False
    if include_assets:
        return True
    lowered = parts.path.lower()
    blocked_suffixes = (
        ".css",
        ".js",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".ico",
        ".webp",
        ".pdf",
        ".zip",
        ".rar",
        ".7z",
        ".mp3",
        ".mp4",
        ".avi",
        ".mov",
    )
    return not lowered.endswith(blocked_suffixes)


def discover_links(parser: PageParser, url: str, base_url: str, include_assets: bool) -> list[str]:
    links: list[str] = []
    for href in parser.links:
        href = href.strip()
        if not href or href.startswith(("mailto:", "javascript:", "tel:")):
            continue
        absolute = normalize_url(urljoin(url, href))
        if should_keep_link(absolute, base_url, include_assets):
            links.append(absolute)
    return links


def resolve_start_url(args: argparse.Namespace) -> str:
    return normalize_url(args.start_url or args.base_url)


def crawl_site(args: argparse.Namespace) -> int:
    output = Path(args.output)
    base_url = resolve_start_url(args)
    robots = robot_checker(base_url, args.timeout, args.ignore_robots)
    queue: deque[str] = deque([base_url])
    seen: set[str] = set()
    page_records: list[dict[str, object]] = []
    error_records: list[dict[str, object]] = []
    raw_dir = output / "raw" / "crawl"

    while queue and len(seen) < args.max_pages:
        url = queue.popleft()
        if url in seen:
            continue
        seen.add(url)

        if robots is not None and not robots.can_fetch(USER_AGENT, url):
            print(f"crawl skip robots: {url}", file=sys.stderr)
            continue

        try:
            status, content_type, payload = fetch_url(url, timeout=args.timeout)
            text_payload = read_text_best_effort(payload, content_type)
            raw_rel = safe_relpath_for_url(url)
            raw_path = raw_dir / raw_rel
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_text(text_payload, encoding="utf-8")

            is_html = "html" in content_type.lower() or urlsplit(url).path.lower().endswith((".php", ".html", ".htm", "/"))
            parser = parse_page(text_payload) if is_html else PageParser()
            links = discover_links(parser, url, base_url, args.include_assets) if is_html else []
            for link in links:
                if link not in seen:
                    queue.append(link)

            page_records.append(
                {
                    "url": url,
                    "status": status,
                    "content_type": content_type,
                    "title": parser.title if is_html else "",
                    "text": parser.text if is_html else "",
                    "raw_html_path": str(raw_path),
                    "discovered_links": links,
                }
            )
            print(f"crawl {len(seen)}/{args.max_pages}: status={status} links={len(links)} {url}", file=sys.stderr)
        except Exception as exc:
            print(f"crawl ERROR {url}: {exc}", file=sys.stderr)
            error_records.append({"url": url, "error": str(exc)})

        time.sleep(args.delay)

    write_jsonl(output / "pages.jsonl", page_records)
    write_pages_csv(output / "pages.csv", page_records)
    if error_records:
        write_jsonl(output / "crawl_errors.jsonl", error_records)
    print(f"crawl complete: {len(page_records)} pages -> {output}", file=sys.stderr)
    return 0 if page_records else 1


def run_all(args: argparse.Namespace) -> int:
    archive_args = argparse.Namespace(**vars(args))
    crawl_args = argparse.Namespace(**vars(args))
    archive_status = scrape_archives(archive_args)
    crawl_status = crawl_site(crawl_args)
    return 0 if archive_status == 0 and crawl_status == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape lottery archive pages and same-domain site content into raw HTML, JSONL, and CSV files."
    )
    parser.set_defaults(func=None)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--output", "-o", default="data/lottery", help="Output directory.")
    common.add_argument("--base-url", required=True, help="Root URL of the source lottery site.")
    common.add_argument("--delay", type=float, default=0.5, help="Seconds to wait between requests.")
    common.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")

    subparsers = parser.add_subparsers(dest="command", required=True)

    archive = subparsers.add_parser("archive", parents=[common], help="Scrape structured lottery archive rows.")
    archive.add_argument("--game", choices=["all", *ARCHIVES.keys()], default="all")
    archive.add_argument("--start-year", type=int, default=1993)
    archive.add_argument("--end-year", type=int, default=2026)
    archive.set_defaults(func=scrape_archives)

    crawl = subparsers.add_parser("crawl", parents=[common], help="Crawl same-domain pages and save text/raw HTML.")
    crawl.add_argument("--start-url", default=None, help="Crawl start URL. Defaults to --base-url.")
    crawl.add_argument("--max-pages", type=int, default=5000)
    crawl.add_argument("--include-assets", action="store_true", help="Also queue same-domain linked assets.")
    crawl.add_argument("--ignore-robots", action="store_true", help="Do not check robots.txt.")
    crawl.set_defaults(func=crawl_site)

    all_cmd = subparsers.add_parser("all", parents=[common], help="Run archive scraping and page crawling.")
    all_cmd.add_argument("--game", choices=["all", *ARCHIVES.keys()], default="all")
    all_cmd.add_argument("--start-year", type=int, default=1993)
    all_cmd.add_argument("--end-year", type=int, default=2026)
    all_cmd.add_argument("--start-url", default=None, help="Crawl start URL. Defaults to --base-url.")
    all_cmd.add_argument("--max-pages", type=int, default=5000)
    all_cmd.add_argument("--include-assets", action="store_true")
    all_cmd.add_argument("--ignore-robots", action="store_true")
    all_cmd.set_defaults(func=run_all)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.end_year < args.start_year if hasattr(args, "end_year") else False:
        parser.error("--end-year must be greater than or equal to --start-year")
    if args.delay < 0:
        parser.error("--delay must be non-negative")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
