"""Dual-gate shadow byte-identity tests (2026-09-07).

The live scan now runs scan_ticker at the $1.00 gate floor and filters
production triplets to min_premium afterward. The guarantee under test:
scan-low-then-filter produces EXACTLY the triplets (content and order) of
scanning at min_premium directly — min_premium must remain a pure
per-triplet filter with no pruning or ordering side effects.

Run: python3 -m unittest tests.test_shadow_gate
"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from screener import scan_ticker  # noqa: E402
from sector_scan import (  # noqa: E402
    SHADOW_GATE_MIN_PREMIUM, SHADOW_GATE_MIN_ROC, roc_value,
)


def provider(ticker, exp, side, strike_low, strike_high):
    calls = [
        {"strike": 100.0, "bid": 9.80, "ask": 10.00, "mid": 9.90,
         "delta": 0.50, "volume": 500},
        {"strike": 110.0, "bid": 4.00, "ask": 4.20, "mid": 4.10,
         "delta": 0.30, "volume": 300},
        {"strike": 115.0, "bid": 2.50, "ask": 2.60, "mid": 2.55,
         "delta": 0.22, "volume": 120},
    ]
    puts = [
        {"strike": 90.0, "bid": 8.00, "ask": 8.30, "mid": 8.15,
         "delta": 0.20, "volume": 250},
        {"strike": 85.0, "bid": 11.50, "ask": 11.80, "mid": 11.65,
         "delta": 0.18, "volume": 250},
    ]
    rows = calls if side == "call" else puts
    return [r for r in rows if strike_low <= r["strike"] <= strike_high]


ARGS = dict(min_p_profit=0.50, chain_provider=provider, as_of=date(2026, 9, 7))
EXPS = [(1, "2026-10-16")]


class TestDualGateByteIdentity(unittest.TestCase):
    def test_scan_low_then_filter_is_byte_identical(self):
        prod_direct, _ = scan_ticker("SYN", 100.0, EXPS, 5.00, **ARGS)
        all_low, _ = scan_ticker("SYN", 100.0, EXPS,
                                 SHADOW_GATE_MIN_PREMIUM, **ARGS)
        refiltered = [t for t in all_low if t["net_premium"] >= 5.00]
        self.assertEqual(refiltered, prod_direct)   # content AND order
        self.assertGreater(len(prod_direct), 0)     # test isn't vacuous

    def test_admits_exist_below_floor_and_pass_roc_gate(self):
        all_low, _ = scan_ticker("SYN", 100.0, EXPS,
                                 SHADOW_GATE_MIN_PREMIUM, **ARGS)
        admits = [t for t in all_low if t["net_premium"] < 5.00
                  and roc_value(t) >= SHADOW_GATE_MIN_ROC]
        self.assertGreater(len(admits), 0)
        for t in admits:
            self.assertGreaterEqual(t["net_premium"], SHADOW_GATE_MIN_PREMIUM)
            self.assertGreaterEqual(roc_value(t), SHADOW_GATE_MIN_ROC)


if __name__ == "__main__":
    unittest.main()
