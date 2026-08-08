#!/usr/bin/env python3
"""Extract structured content from crawled pages.jsonl into src/content/*.json."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PAGES_PATH = ROOT / "data" / "lottery" / "pages.jsonl"
OUT_DIR = ROOT / "src" / "content"

GAME_SLUGS = {
    "6-din-49": "6din49",
    "5-din-40": "5din40",
    "joker": "joker",
    "noroc": "noroc",
}

GAME_LABELS = {
    "6din49": "Loto 6/49",
    "5din40": "Loto 5/40",
    "joker": "Joker",
    "noroc": "Noroc",
}

NAV_BOILERPLATE = {
    "Simulator bilet",
    "Generator numere",
    "Reţetar",
    "Costuri variante",
    "Scheme reduse",
    "Arhiva Loto",
    "Află mai multe:",
    "Rezultate LOTO",
    "Tip varianta",
    "Numar variante",
    "simple",
    "Cost varianta",
    "(in RON - lei noi)",
    "(in ROL - lei vechi)",
    "Cod schema redusa",
    "Numar de numere jucate",
    "Numar de variante",
    "Reducere (%)",
    "Cost schema",
    "schema redusa",
    "6/49",
    "5/40",
    "Joker",
    "Noroc",
    "arhivă",
    "Cea mai recenta extragere:",
    "Numere extrase:",
    "Report Cat 1:",
    "Urmatoarea extragere:",
}


def load_pages() -> list[dict]:
    rows = []
    with PAGES_PATH.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def clean_lines(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        clean = re.sub(r"\s+", " ", line).strip()
        if clean:
            lines.append(clean)
    return lines


def game_from_url(url: str) -> str | None:
    lower = url.lower()
    for segment, slug in GAME_SLUGS.items():
        if f"/loto/{segment}" in lower:
            return slug
    return None


def is_boilerplate(line: str) -> bool:
    if line in NAV_BOILERPLATE:
        return True
    if line.startswith("Noroc chior -"):
        return True
    if line in ("Pentru că trăind în cercul nostru strâmt", "Norocul ne petrece"):
        return True
    if re.fullmatch(r"\d{1,2}", line):
        return True
    if re.fullmatch(r"\d{7}", line):
        return True
    if re.search(r"\d{1,2} [a-zăîâșț]+ \d{4}", line, re.I):
        return True
    if re.search(r"\d[\d., ]+ lei", line):
        return True
    return False


def content_paragraphs(lines: list[str], start_markers: tuple[str, ...], stop_markers: tuple[str, ...] = ()) -> list[str]:
    start = 0
    for index, line in enumerate(lines):
        if any(marker in line for marker in start_markers):
            start = index
            break
    paragraphs: list[str] = []
    buffer: list[str] = []
    for line in lines[start + 1 :]:
        if any(marker in line for marker in stop_markers):
            break
        if is_boilerplate(line):
            continue
        if len(line) <= 3 and line.isdigit():
            continue
        if line.startswith("[") and line.endswith("]"):
            continue
        if re.fullmatch(r"[AB]\d+", line.replace(" ", "")):
            continue
        if re.fullmatch(r"\d{10,}", line.replace(" ", "")):
            continue
        if len(line) > 180 and "," in line and re.search(r"\d", line):
            continue
        if len(line) > 40 or line.endswith((".", "!", "?")):
            if buffer:
                paragraphs.append(" ".join(buffer))
                buffer = []
            paragraphs.append(line)
        else:
            buffer.append(line)
    if buffer:
        paragraphs.append(" ".join(buffer))
    return [p for p in paragraphs if len(p) > 20]


def parse_cost_rows(lines: list[str]) -> list[dict]:
    rows = []
    pattern = re.compile(
        r"^Costul / Pretul unei variante (?P<kind>simple|multiple) formata din (?P<count>\d+) numere"
    )
    index = 0
    while index < len(lines):
        match = pattern.match(lines[index])
        if not match:
            index += 1
            continue
        count = int(match.group("count"))
        kind = match.group("kind")
        simple_variants = lines[index + 1] if index + 1 < len(lines) else ""
        ron = lines[index + 2] if index + 2 < len(lines) else ""
        rol = lines[index + 3] if index + 3 < len(lines) else ""
        if re.fullmatch(r"[\d.,]+", simple_variants.replace(".", "").replace(",", "")):
            rows.append(
                {
                    "kind": kind,
                    "numbers": count,
                    "simpleVariants": int(simple_variants.replace(".", "").replace(",", "")),
                    "costRon": ron,
                    "costRol": rol,
                    "label": lines[index],
                }
            )
            index += 4
            continue
        index += 1
    return rows


def parse_reduced_cost_rows(lines: list[str]) -> list[dict]:
    rows = []
    index = 0
    while index < len(lines) - 4:
        code = lines[index]
        if not re.fullmatch(r"\d{2}", code):
            index += 1
            continue
        numbers_played = lines[index + 1]
        variants = lines[index + 2]
        reduction = lines[index + 3]
        ron = lines[index + 4]
        rol = lines[index + 5] if index + 5 < len(lines) else ""
        if (
            numbers_played.isdigit()
            and variants.replace(".", "").replace(",", "").isdigit()
            and "%" in reduction
            and "RON" in ron
        ):
            rows.append(
                {
                    "code": code,
                    "numbersPlayed": int(numbers_played),
                    "variants": variants,
                    "reduction": reduction,
                    "costRon": ron,
                    "costRol": rol,
                }
            )
            index += 6
            continue
        index += 1
    return rows


def clean_paragraphs(paragraphs: list[str], max_count: int = 12) -> list[str]:
    cleaned = []
    for paragraph in paragraphs:
        if len(paragraph) > 220 and ("REPORT" in paragraph or "Numar castiguri" in paragraph):
            continue
        if paragraph.startswith("©") or "contact@noroc-chior.ro" in paragraph:
            continue
        if "Simulator bilet" in paragraph and "Generator numere" in paragraph:
            continue
        if re.search(r"\bExact \d+ numere\b", paragraph):
            continue
        if re.search(r"Numarul \d+ a fost extras", paragraph):
            continue
        if paragraph.startswith("Detaliile extragerilor"):
            continue
        cleaned.append(paragraph)
    return cleaned[:max_count]


def parse_scheme_detail(lines: list[str], code: str, title: str) -> dict:
    paragraphs = clean_paragraphs(content_paragraphs(lines, (title,), ("Calculeaza castigurile", "Tabel coduri")))
    matrix: list[list[str]] = []
    collecting = False
    row_buffer: list[str] = []
    for line in lines:
        if line.startswith("Calculeaza castigurile"):
            collecting = True
            continue
        if not collecting:
            continue
        if line in {"I", "II", "III", "IV", "V", "VI"} or re.fullmatch(r"\d{1,2}", line):
            if len(row_buffer) >= 6:
                matrix.append(row_buffer[:12])
            row_buffer = [line]
            continue
        if row_buffer and (re.fullmatch(r"\d{1,2}", line) or line in {"JOKER", "joker"}):
            row_buffer.append(line)
    if len(row_buffer) >= 6:
        matrix.append(row_buffer[:12])
    return {
        "code": code,
        "title": title,
        "intro": paragraphs[:4],
        "matrixPreview": matrix[:8],
    }


def pick_unique(pages: list[dict], matcher) -> dict | None:
    for row in pages:
        if matcher(row):
            return row
    return None


def extract_game_content(pages: list[dict], game_slug: str) -> dict:
    prefix = next(key for key, slug in GAME_SLUGS.items() if slug == game_slug)
    label = GAME_LABELS[game_slug]

    def has_path(fragment: str) -> bool:
        return lambda row, f=fragment: f"/Loto/{prefix}/" in row.get("url", "") and f in row.get("url", "")

    home = pick_unique(pages, lambda row: row.get("url", "").rstrip("/").endswith(f"/Loto/{prefix}"))
    analysis = pick_unique(pages, has_path("analiza-numere.php"))
    recipe = pick_unique(pages, has_path("reteta-ta-loto.php"))
    costs_simple = pick_unique(pages, has_path("costuri-variante-simple-si-multiple.php"))
    costs_reduced = pick_unique(pages, has_path("costuri-scheme-reduse.php"))

    def section(row: dict | None, markers: tuple[str, ...]) -> dict:
        if not row:
            return {"title": "", "paragraphs": []}
        lines = clean_lines(row.get("text", ""))
        title = next((line for line in lines if any(marker in line for marker in markers)), markers[0])
        return {"title": title, "paragraphs": clean_paragraphs(content_paragraphs(lines, (title,), ("Tabel", "Alege", "Prăfuite")), 8)}

    variant_rows = parse_cost_rows(clean_lines(costs_simple.get("text", ""))) if costs_simple else []
    reduced_rows = parse_reduced_cost_rows(clean_lines(costs_reduced.get("text", ""))) if costs_reduced else []

    scheme_pages = [
        row
        for row in pages
        if f"/Loto/{prefix}/calculator-castiguri-schema-redusa-cod-" in row.get("url", "")
    ]
    schemes = []
    seen_codes: set[str] = set()
    for row in sorted(scheme_pages, key=lambda item: item.get("url", "")):
        url = row.get("url", "")
        match = re.search(r"cod-(\d+)(?:-cu-\d+-numere-joker)?\.html", url)
        if not match:
            continue
        code = match.group(1)
        if code in seen_codes:
            continue
        seen_codes.add(code)
        lines = clean_lines(row.get("text", ""))
        title = row.get("title", "").replace("Noroc chior - ", "")
        schemes.append(parse_scheme_detail(lines, code, title))

    return {
        "slug": game_slug,
        "label": label,
        "tagline": f"Generator, archive insights, and scheme tools for {label}.",
        "overview": section(home, ("Generator de numere", "Simulator si calculator")),
        "analysis": section(analysis, ("Analiza numere",)),
        "recipe": section(recipe, ("Creaza-ti propria reteta", "Cu ajutorul")),
        "variantCosts": variant_rows,
        "reducedCosts": reduced_rows,
        "schemes": schemes,
    }


def main() -> None:
    pages = load_pages()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    games = {slug: extract_game_content(pages, slug) for slug in GAME_LABELS}

    manifest = {
        "source": "loto-gpt content extraction",
        "games": [
            {
                "slug": game["slug"],
                "label": game["label"],
                "schemeCount": len(game["schemes"]),
                "variantCostCount": len(game["variantCosts"]),
            }
            for game in games.values()
        ],
    }

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    for slug, payload in games.items():
        (OUT_DIR / f"game-{slug}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote content for {len(games)} games to {OUT_DIR}")


if __name__ == "__main__":
    main()
