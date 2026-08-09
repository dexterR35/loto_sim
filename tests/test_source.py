from __future__ import annotations

import unittest
from datetime import datetime, timezone

import requests

from loto649.source import OfficialLotoRoSource, ResultNotPublished


VALID_HTML = """
<html><body>
  <div class="rezultate-extrageri-content resultDiv">
    <div class="numere-extrase">
      <img src="/images/bile/25.png"><img src="/images/bile/16.png">
      <img src="/images/bile/5.png"><img src="/images/bile/41.png">
      <img src="/images/bile/42.png"><img src="/images/bile/6.png">
    </div>
    <div class="button-open-details"><p>Detalii castiguri  la 6/49 din <span>06.08.2026</span></p></div>
  </div>
  <div class="rezultate-extrageri-content resultDiv floatright">
    <div class="numere-extrase numere-extrase-noroc"><span>9858024</span></div>
    <div class="button-open-details"><p>Detalii castiguri la noroc din <span>06.08.2026</span></p></div>
  </div>
</body></html>
"""


class SourceAdapterTests(unittest.TestCase):
    def test_parses_official_649_container_only(self) -> None:
        fetched = datetime(2026, 8, 6, 20, 0, tzinfo=timezone.utc)
        draws = OfficialLotoRoSource.parse_results(VALID_HTML, "https://www.loto.ro/results", fetched)
        self.assertEqual(len(draws), 1)
        self.assertEqual(draws[0].draw_date.isoformat(), "2026-08-06")
        self.assertEqual(draws[0].numbers, (25, 16, 5, 41, 42, 6))
        self.assertEqual(draws[0].fetched_at, fetched)
        self.assertTrue(draws[0].source_hash)

    def test_missing_result_is_not_interpreted_as_empty_draw(self) -> None:
        draws = OfficialLotoRoSource.parse_results("<html><body>În curs de publicare</body></html>", "https://www.loto.ro/results")
        self.assertEqual(draws, [])

    def test_malformed_or_duplicate_numbers_fail_validation(self) -> None:
        malformed = VALID_HTML.replace("/bile/6.png", "/bile/42.png")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            OfficialLotoRoSource.parse_results(malformed, "https://www.loto.ro/results")

    def test_changed_selector_is_a_controlled_unpublished_result(self) -> None:
        class Response:
            text = "<html><div class='redesigned-result'>25 16 5 41 42 6</div></html>"

            @staticmethod
            def raise_for_status() -> None:
                return None

        class Session:
            @staticmethod
            def get(_url, timeout):
                self.assertGreater(timeout, 0)
                return Response()

        source = object.__new__(OfficialLotoRoSource)
        source.url = "https://www.loto.ro/results"
        source.timeout = 2
        source.session = Session()
        with self.assertRaises(ResultNotPublished):
            source._request()

    def test_timeout_is_not_converted_into_an_empty_draw(self) -> None:
        class Session:
            @staticmethod
            def get(_url, timeout):
                raise requests.Timeout(f"timed out after {timeout}")

        source = object.__new__(OfficialLotoRoSource)
        source.url = "https://www.loto.ro/results"
        source.timeout = 0.1
        source.session = Session()
        with self.assertRaises(requests.Timeout):
            source._request()


if __name__ == "__main__":
    unittest.main()
