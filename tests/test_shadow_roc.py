"""Tests for the ROC shadow ranking union (Phase E shadow clock).

The production guarantee under test: select_with_shadow's leading rows are
BYTE-IDENTICAL to select_top_n's output (the site's pick and every
production runner-up are unchanged), and ROC's true best-in-sector is
always present in the logged union so the shadow flag can be derived at
evaluation time.

Run: python3 -m unittest tests.test_shadow_roc
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from sector_scan import (  # noqa: E402
    MAX_PER_TICKER, roc_value, select_top_n, select_with_shadow,
)


def T(ticker, score, prem, kc, exp="2026-10-16", ka=100.0, kb=110.0):
    return {"ticker": ticker, "score": score, "net_premium": prem,
            "leg_a_strike": ka, "leg_b_strike": kb, "leg_c_strike": kc,
            "expiration": exp}


def ranked(*ts):
    return sorted(ts, key=lambda t: t["score"], reverse=True)


class TestShadowUnion(unittest.TestCase):
    def setUp(self):
        # Incumbent order: AAA1, AAA2, BBB1, CCC1, DDD1...
        # ROC order differs: EEE1 has small K_C → huge ROC but low score.
        self.rows = ranked(
            T("AAA", 2.0, 8.0, 900.0), T("AAA", 1.9, 7.5, 900.0),
            T("AAA", 1.8, 7.0, 900.0),          # per-ticker cap victim
            T("BBB", 1.5, 6.0, 800.0), T("CCC", 1.2, 5.5, 700.0),
            T("DDD", 1.0, 5.0, 600.0), T("EEE", 0.3, 6.0, 90.0),
        )

    def test_production_prefix_byte_identical(self):
        prod = select_top_n(self.rows, 5)
        shadow = select_with_shadow(self.rows, 5)
        self.assertEqual(shadow[:len(prod)], prod)

    def test_incumbent_best_is_first_and_unchanged(self):
        self.assertIs(select_with_shadow(self.rows, 5)[0],
                      select_top_n(self.rows, 5)[0])

    def test_roc_true_best_always_logged(self):
        shadow = select_with_shadow(self.rows, 5)
        roc_best = max(self.rows, key=roc_value)
        self.assertEqual(roc_best["ticker"], "EEE")     # low score, top ROC
        self.assertIn(roc_best, shadow)
        # and it is derivable as the max-ROC of the logged set
        self.assertIs(max(shadow, key=roc_value), roc_best)

    def test_no_duplicates_when_rankings_agree(self):
        rows = ranked(T("AAA", 2.0, 8.0, 90.0), T("BBB", 1.0, 4.0, 900.0))
        shadow = select_with_shadow(rows, 5)
        self.assertEqual(len(shadow), 2)                # union added nothing

    def test_per_ticker_cap_still_applies_to_production_slice(self):
        prod = select_top_n(self.rows, 5)
        self.assertLessEqual(
            max(sum(1 for t in prod if t["ticker"] == x)
                for x in {t["ticker"] for t in prod}),
            MAX_PER_TICKER)

    def test_roc_value_math(self):
        self.assertAlmostEqual(roc_value(T("X", 1, 10.0, 510.0)), 0.02)
        self.assertEqual(roc_value(T("X", 1, 10.0, 5.0)), 0.0)  # degenerate


if __name__ == "__main__":
    unittest.main()
