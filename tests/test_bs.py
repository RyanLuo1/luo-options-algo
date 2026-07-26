"""Unit tests for lib/bs.py — the Black-Scholes math itself (RANKER_SPEC Phase A).

Run from the project root:  python3 -m unittest tests.test_bs -v
"""

import math
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.bs import bs_price, delta, implied_vol, RISK_FREE_RATE


class TestKnownValues(unittest.TestCase):
    """Canonical textbook spot-checks: S=100, K=100, T=1, r=5%, sigma=20%."""

    def test_atm_call_price(self):
        self.assertAlmostEqual(
            bs_price("call", 100, 100, 1.0, 0.05, 0.20), 10.4506, places=3)

    def test_atm_put_price(self):
        self.assertAlmostEqual(
            bs_price("put", 100, 100, 1.0, 0.05, 0.20), 5.5735, places=3)

    def test_atm_call_delta(self):
        self.assertAlmostEqual(
            delta("call", 100, 100, 1.0, 0.05, 0.20), 0.6368, places=3)

    def test_atm_put_delta(self):
        self.assertAlmostEqual(
            delta("put", 100, 100, 1.0, 0.05, 0.20), -0.3632, places=3)


class TestParity(unittest.TestCase):
    """Put-call parity across a moneyness/DTE/vol grid."""

    GRID_M = [0.7, 0.85, 1.0, 1.15, 1.3]
    GRID_T = [1 / 52, 4 / 52, 12 / 52, 0.5, 1.0]
    GRID_IV = [0.15, 0.3, 0.6, 1.2]

    def test_put_call_price_parity(self):
        spot, r = 250.0, RISK_FREE_RATE
        for m in self.GRID_M:
            for t in self.GRID_T:
                for iv in self.GRID_IV:
                    k = spot * m
                    c = bs_price("call", spot, k, t, r, iv)
                    p = bs_price("put", spot, k, t, r, iv)
                    parity = spot - k * math.exp(-r * t)
                    self.assertAlmostEqual(c - p, parity, places=8,
                                           msg=f"m={m} t={t} iv={iv}")

    def test_delta_parity(self):
        spot, r = 250.0, RISK_FREE_RATE
        for m in self.GRID_M:
            for t in self.GRID_T:
                for iv in self.GRID_IV:
                    k = spot * m
                    dc = delta("call", spot, k, t, r, iv)
                    dp = delta("put", spot, k, t, r, iv)
                    self.assertAlmostEqual(dc - dp, 1.0, places=10,
                                           msg=f"m={m} t={t} iv={iv}")


class TestIVRoundTrip(unittest.TestCase):
    """Price at a chosen IV, solve it back — must recover tightly."""

    def test_round_trip_grid(self):
        spot, r = 480.0, RISK_FREE_RATE
        checked = 0
        for opt in ("call", "put"):
            for m in [0.75, 0.85, 0.95, 1.0, 1.05, 1.15, 1.25]:
                for t in [1 / 52, 2 / 52, 4 / 52, 8 / 52, 12 / 52, 0.5]:
                    for iv_true in [0.15, 0.25, 0.4, 0.7, 1.2]:
                        k = round(spot * m, 2)
                        price = bs_price(opt, spot, k, t, r, iv_true)
                        # Skip prices the solver rightly refuses (at intrinsic)
                        iv_got = implied_vol(opt, price, spot, k, t, r)
                        if iv_got is None:
                            disc = math.exp(-r * t)
                            intrinsic = (max(0.0, spot - k * disc) if opt == "call"
                                         else max(0.0, k * disc - spot))
                            self.assertLess(price - intrinsic, 2e-4,
                                            msg=f"None for a price with real time value: "
                                                f"{opt} m={m} t={t} iv={iv_true}")
                            continue
                        self.assertAlmostEqual(iv_got, iv_true, places=6,
                                               msg=f"{opt} m={m} t={t} iv={iv_true}")
                        checked += 1
        self.assertGreater(checked, 300)  # the grid must mostly be solvable


class TestEdgeCases(unittest.TestCase):
    def test_zero_or_negative_inputs(self):
        self.assertIsNone(implied_vol("call", 0.0, 100, 100, 0.5))
        self.assertIsNone(implied_vol("call", -1.0, 100, 100, 0.5))
        self.assertIsNone(implied_vol("call", 5.0, 100, 100, 0.0))
        self.assertIsNone(implied_vol("call", 5.0, 100, 100, -0.1))
        self.assertIsNone(implied_vol("put", 5.0, 0, 100, 0.5))
        self.assertIsNone(implied_vol("put", 5.0, 100, 0, 0.5))
        self.assertIsNone(implied_vol("call", None, 100, 100, 0.5))

    def test_price_below_intrinsic_is_none(self):
        # Deep ITM call: intrinsic ~ 100 - 50*disc ≈ 51.1; quote below that = bad
        self.assertIsNone(implied_vol("call", 45.0, 100, 50, 0.5))

    def test_price_at_intrinsic_is_none(self):
        r = RISK_FREE_RATE
        intrinsic = 100 - 50 * math.exp(-r * 0.5)
        self.assertIsNone(implied_vol("call", intrinsic, 100, 50, 0.5, r))

    def test_price_above_upper_bound_is_none(self):
        self.assertIsNone(implied_vol("call", 101.0, 100, 100, 0.5))  # call > spot
        self.assertIsNone(implied_vol("put", 120.0, 100, 100, 0.5))   # put > K*disc

    def test_absurd_price_within_bounds_is_none(self):
        # Below spot but above anything 500% vol can produce at 1 week
        self.assertIsNone(implied_vol("call", 99.0, 100, 100, 1 / 52))

    def test_near_zero_dte_still_sane(self):
        # 5 minutes to expiry, ATM with real time value: solvable and positive
        t = 5 / (60 * 24 * 365)
        price = bs_price("call", 100, 100, t, RISK_FREE_RATE, 0.5)
        iv = implied_vol("call", price, 100, 100, t)
        self.assertIsNotNone(iv)
        self.assertAlmostEqual(iv, 0.5, places=4)

    def test_delta_edge_inputs(self):
        self.assertIsNone(delta("call", 100, 100, 0.0, 0.05, 0.2))
        self.assertIsNone(delta("call", 100, 100, 0.5, 0.05, None))
        self.assertIsNone(delta("call", 100, 100, 0.5, 0.05, 0.0))

    def test_bad_option_type_raises(self):
        with self.assertRaises(ValueError):
            implied_vol("cll", 5.0, 100, 100, 0.5)

    def test_delta_ranges(self):
        d_itm = delta("call", 100, 60, 0.25, 0.05, 0.3)
        d_otm = delta("call", 100, 150, 0.25, 0.05, 0.3)
        self.assertGreater(d_itm, 0.95)
        self.assertLess(d_otm, 0.05)
        self.assertGreater(d_otm, 0.0)
        p_itm = delta("put", 100, 150, 0.25, 0.05, 0.3)
        self.assertLess(p_itm, -0.95)


if __name__ == "__main__":
    unittest.main(verbosity=2)
