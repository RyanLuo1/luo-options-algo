"""Default-path byte-identity for scan_ticker (Upside mode, 2026-09-15).

scan_ticker gained keyword parameters (leg_b_delta, min_upside) with today's
constants as defaults. The guarantee under test: the DEFAULT call path — what
the sector cron, the backtest replay, the CLI and /api/run's Income mode all
use — produces byte-identical triplets (content AND order) to the code as it
stood before the parameters existed. The golden fixture was recorded from that
pre-change code over a deterministic synthetic chain (`--record` regenerates it;
only do that deliberately, with the reason in the commit message).

Run: python3 -m unittest tests.test_mode_defaults
Record: python3 tests/test_mode_defaults.py --record
"""
import inspect
import json
import os
import re
import sys
import unittest
from datetime import date

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, ROOT)
from screener import scan_ticker  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "scan_ticker_golden.json")
AS_OF = date(2026, 9, 15)
EXPS = [(1, "2026-09-18"), (3, "2026-10-02"), (6, "2026-10-23"), (10, "2026-11-20")]
TICKERS = {"SYN": 100.0, "BIG": 850.0, "THN": 42.5}   # a mid, a large, a thin chain


WEEK_OF = dict((exp, wk) for wk, exp in EXPS)


def _chain(ticker, price, exp, side):
    """A deterministic synthetic chain: strikes across 0.7–1.3× spot, deltas
    falling with strike (flatter for longer expirations), quotes with realistic
    spreads. Contains legs that hit every gate: premium below the floor, P below
    50%, wide and narrow spreads, and a few thin-volume contracts."""
    seed = sum(ord(c) for c in ticker + exp) % 97
    wk = WEEK_OF[exp]
    step = 5.0 if price > 200 else (2.5 if price > 60 else 1.0)
    slope = 2.2 - 0.08 * wk                     # delta falls faster with moneyness near expiry
    tv = 0.12 * (0.30 + 0.002 * (seed % 10)) * (1 + wk / 20.0)   # time value at the money, as a share of spot
    rows = []
    k = round(price * 0.70 / step) * step
    while k <= price * 1.30 + 1e-9:
        m = (k - price) / price                 # moneyness
        if side == "call":
            delta = max(0.02, min(0.98, 0.5 - m * slope))
            mid = max(0.05, price * (max(0.0, -m) + tv * max(0.15, 1 - abs(m) * 1.5)))
        else:
            delta = max(0.02, min(0.98, 0.5 + m * slope))
            mid = max(0.05, price * (max(0.0, m) + tv * max(0.15, 1 - abs(m) * 1.5)))
        spread = round(max(0.02, mid * (0.02 + 0.001 * ((seed + int(k)) % 9))), 2)
        volume = 15 if int(k) % 17 == 0 else 100 + (seed + int(k)) % 400   # a few thin contracts
        rows.append({"strike": float(k), "bid": round(mid - spread / 2, 2), "ask": round(mid + spread / 2, 2),
                     "mid": round(mid, 2), "delta": round(delta, 3), "volume": volume})
        k += step
    if ticker == "THN":                          # thin: drop every other strike
        rows = rows[::2]
    return rows


def provider_for(price):
    def provider(ticker, exp, side, strike_low, strike_high):
        return [r for r in _chain(ticker, price, exp, side) if strike_low <= r["strike"] <= strike_high and r["volume"] >= 20]
    return provider


def default_path():
    """Exactly how the cron/replay/CLI/Income call it: positional min_premium, min_p_profit, provider, as_of, stats."""
    out = {}
    for ticker, price in TICKERS.items():
        for min_premium in (5.0, 1.0, 0.0):
            stats = {}
            triplets, evaluated = scan_ticker(ticker, price, EXPS, min_premium, min_p_profit=0.50,
                                              chain_provider=provider_for(price), as_of=AS_OF, stats=stats)
            out[f"{ticker}@{min_premium}"] = {"triplets": triplets, "evaluated": evaluated, "stats": stats}
    return out


class TestDefaultPathByteIdentity(unittest.TestCase):
    def test_default_call_matches_the_golden(self):
        with open(FIXTURE) as f:
            golden = json.load(f)
        now = json.loads(json.dumps(default_path()))   # same JSON round-trip as the fixture
        self.assertEqual(now, golden)
        self.assertGreater(sum(len(v["triplets"]) for v in golden.values()), 50)   # not vacuous

    def test_explicit_defaults_equal_the_default_call(self):
        sig = inspect.signature(scan_ticker)
        if "leg_b_delta" not in sig.parameters:
            self.skipTest("parameters not added yet (step a in progress)")
        for ticker, price in TICKERS.items():
            a, _ = scan_ticker(ticker, price, EXPS, 5.0, min_p_profit=0.50, chain_provider=provider_for(price), as_of=AS_OF)
            b, _ = scan_ticker(ticker, price, EXPS, 5.0, min_p_profit=0.50, chain_provider=provider_for(price), as_of=AS_OF,
                               leg_b_delta=(0.20, 0.40), min_upside=0.0)
            self.assertEqual(a, b)

    def test_existing_callers_pass_nothing_new(self):
        """The cron, the replay and the CLI must not have grown mode arguments."""
        for rel in ("scripts/sector_scan.py", "scripts/replay_scan.py", "screener.py"):
            src = open(os.path.join(ROOT, rel)).read()
            calls = re.findall(r"scan_ticker\((?:[^()]|\([^()]*\))*\)", src)
            body = "\n".join(c for c in calls if not c.startswith("scan_ticker(ticker, price, week_exps, min_premium, min_p_profit=None"))
            self.assertNotIn("leg_b_delta", body, rel)
            self.assertNotIn("min_upside", body, rel)


class TestUpsidePreset(unittest.TestCase):
    def test_upside_admits_wide_spreads_and_zero_credit(self):
        sig = inspect.signature(scan_ticker)
        if "leg_b_delta" not in sig.parameters:
            self.skipTest("parameters not added yet (step a in progress)")
        price = TICKERS["SYN"]
        income, _ = scan_ticker("SYN", price, EXPS, 1.0, min_p_profit=0.50, chain_provider=provider_for(price), as_of=AS_OF)
        upside, _ = scan_ticker("SYN", price, EXPS, 0.0, min_p_profit=0.50, chain_provider=provider_for(price), as_of=AS_OF,
                                leg_b_delta=(0.05, 0.20), min_upside=0.05)
        self.assertGreater(len(upside), 0)
        for t in upside:
            self.assertTrue(0.05 <= t["leg_b_delta"] <= 0.20)
            self.assertGreaterEqual(t["net_premium"], 0.0)                      # still a credit (or zero)
            self.assertGreaterEqual((t["net_premium"] + t["spread_width"]) / t["leg_c_strike"], 0.05 - 1e-9)
        self.assertGreater(max(t["spread_width"] for t in upside), max(t["spread_width"] for t in income))


if __name__ == "__main__":
    if "--record" in sys.argv:
        os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
        with open(FIXTURE, "w") as f:
            json.dump(default_path(), f, indent=1, sort_keys=True)
        n = sum(len(v["triplets"]) for v in default_path().values())
        print(f"recorded {FIXTURE}: {n} triplets across {len(TICKERS)} tickers × 3 floors")
    else:
        unittest.main()
