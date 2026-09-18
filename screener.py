"""
screener.py — Call Spread Risk Reversal Screener

Strategy (3 legs):
  Leg A: Buy  ATM call  (long)  — pay premium
  Leg B: Sell OTM call  (short) — collect premium (candidates nearest spot tried first)
  Leg C: Sell OTM put   (short) — collect premium
  Goal:  Net Premium = (B + C) − A ≥ $5.00  (credit only)

Run:
  python3 screener.py
  python3 screener.py --tickers NVDA META TSLA
  python3 screener.py --weeks 6 --min-premium 3.00
"""

import argparse
import sys
import functools
from datetime import datetime, date, timedelta, time
from zoneinfo import ZoneInfo

import yfinance as yf

from options_screener import get_next_fridays, massive_client

# ── Constants ──────────────────────────────────────────────────────────────────

DEFAULT_TICKERS     = ["GEV", "PLTR", "APP", "AVGO", "META", "MU", "NVDA", "TSLA", "AMD", "TSM"]
DEFAULT_MIN_PREMIUM = 5.00
DEFAULT_WEEKS       = 12

MIN_IV              = 0.01
MIN_VOLUME          = 20
MAX_SPREAD_PCT      = 0.15   # max bid-ask spread as a fraction of quote midpoint

LEG_A_DELTA_LOW     = 0.40
LEG_A_DELTA_HIGH    = 0.60
LEG_B_DELTA_LOW     = 0.20
LEG_B_DELTA_HIGH    = 0.40
LEG_C_DELTA_LOW     = 0.15
LEG_C_DELTA_HIGH    = 0.30
MIN_P_MAX_PROFIT    = 0.50

# ANSI
YELLOW = "\033[33m"
RED    = "\033[31m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


# ── Helpers ────────────────────────────────────────────────────────────────────

def market_status():
    """Returns (is_open: bool, time_str: str) in Eastern time."""
    eastern = ZoneInfo("America/New_York")
    now_et  = datetime.now(eastern)
    is_open = now_et.weekday() < 5 and time(9, 30) <= now_et.time() <= time(16, 0)
    return is_open, now_et.strftime("%Y-%m-%d %H:%M:%S %Z")


def match_expirations(available_exps, target_fridays):
    """
    For each target Friday, find the nearest available expiration string.
    Deduplicates so the same chain date is not repeated.
    Returns an ordered list of (week_num, exp_str) tuples.
    """
    matched = []
    seen = set()
    for i, friday in enumerate(target_fridays):
        best, best_gap = None, timedelta(days=999)
        for exp_str in available_exps:
            exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
            gap = abs(exp_date - friday)
            if gap < best_gap:
                best_gap = gap
                best = exp_str
        if best and best not in seen:
            seen.add(best)
            matched.append((i + 1, best))
    return matched


def passes_quote_guards(bid, ask):
    """Shared liquidity guards — the live parser AND the backtest replay
    (scripts/replay_scan.py) both call this, so the tradeable-universe
    definition can never diverge between them.

    A contract is quotable iff it has a live two-sided quote (bid > 0,
    ask > 0, not crossed) whose spread is ≤ MAX_SPREAD_PCT of the midpoint.
    """
    if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
        return False
    mid = (bid + ask) / 2
    return (ask - bid) / mid <= MAX_SPREAD_PCT


CENSUS_KEYS = ("contracts", "no_greeks", "placeholder_iv", "no_quote", "wide_spread", "untraded", "tradeable")


def _parse_massive_contracts(raw, census=None, min_volume=MIN_VOLUME):
    """Filter and normalize a list of Massive option snapshot objects.

    Prices come from the live quote (Options Advanced plan), not day.close —
    the last-trade price can be hours stale and violates strike monotonicity.
    Each contract keeps both sides; the leg role decides which side is the
    transactable premium (sell → bid, buy → ask).

    `census` (optional dict) is a liquidity census, bookkeeping only: each
    contract is tallied under the first guard it fails (keys in CENSUS_KEYS),
    accumulated across calls. It never changes which contracts survive —
    the default path (census=None) is byte-identical to before.

    `min_volume` is the volume floor (default MIN_VOLUME = Tier 0). The web
    Screener's Upside ladder passes 0 (Tier 1) to re-parse an in-memory chain
    for a ticker that produced nothing at Tier 0 — display-only rows; no
    research writer ever passes it.
    """
    if census is not None:
        for k in CENSUS_KEYS:
            census.setdefault(k, 0)
        census["contracts"] += len(raw)

    def tally(key):
        if census is not None:
            census[key] += 1

    result = []
    for o in raw:
        if o.greeks is None or o.greeks.delta is None:
            tally("no_greeks")
            continue
        if o.implied_volatility is None or float(o.implied_volatility) <= MIN_IV:
            tally("placeholder_iv")
            continue
        q = o.last_quote
        if q is None or q.bid is None or q.ask is None:
            tally("no_quote")
            continue
        bid, ask = float(q.bid), float(q.ask)
        if not passes_quote_guards(bid, ask):
            # the same guard, split for the census: no two-sided quote vs a quote that is too wide
            tally("no_quote" if (bid <= 0 or ask <= 0 or ask < bid) else "wide_spread")
            continue
        vol = int(o.day.volume) if o.day is not None and o.day.volume is not None else 0
        if vol < min_volume:
            tally("untraded")
            continue
        tally("tradeable")
        result.append({
            "strike": float(o.details.strike_price),
            "bid":    round(bid, 4),
            "ask":    round(ask, 4),
            "mid":    round((bid + ask) / 2, 4),
            "delta":  round(abs(float(o.greeks.delta)), 6),
            "volume": vol,
        })
    return result


def _fetch_chain_raw(ticker, exp, side, strike_low, strike_high):
    """One Massive snapshot call → the raw contract objects, or None on a fetch error."""
    try:
        raw = list(massive_client.list_snapshot_options_chain(
            ticker,
            params={
                'expiration_date':  exp,
                'strike_price.gte': strike_low,
                'strike_price.lte': strike_high,
                'contract_type':    side,
                'limit':            250,
            }
        ))
    except Exception as e:
        print(f"\n    [!] {exp}: {side} chain error — {e}")
        return None
    return raw


def _live_chain_provider(ticker, exp, side, strike_low, strike_high, census=None):
    """Default chain source: Massive live snapshot → parsed contract dicts.

    Returns a list of {strike, bid, ask, mid, delta, volume} or None on a
    fetch error (the caller skips that side/expiration, matching the old
    inline behavior). The backtest replay passes its own provider with the
    same signature/shape — everything downstream is shared.
    """
    raw = _fetch_chain_raw(ticker, exp, side, strike_low, strike_high)
    if raw is None:
        return None
    return _parse_massive_contracts(raw, census=census)


class CachedLiveChains:
    """The web Screener's chain source for the Upside ladder: each (ticker,
    expiration, side) snapshot is fetched once and parsed per tier, so a
    Tier 1 pass for a zero-at-Tier-0 ticker costs zero extra Massive calls.
    `provider(min_volume=MIN_VOLUME)` is Tier 0 (identical to the live
    provider); `provider(min_volume=0)` is Tier 1. Parsed contracts are kept
    by (ticker, exp, side, strike) so relaxed rows can carry each leg's mid
    and volume for the liquidity-cost figure."""

    def __init__(self):
        self.raw = {}
        self.contracts = {}

    def _fetch(self, ticker, exp, side, strike_low, strike_high):
        key = (ticker, exp, side)
        if key not in self.raw:
            self.raw[key] = _fetch_chain_raw(ticker, exp, side, strike_low, strike_high)
        return self.raw[key]

    def provider(self, min_volume=MIN_VOLUME, census=None):
        def _provider(ticker, exp, side, strike_low, strike_high):
            raw = self._fetch(ticker, exp, side, strike_low, strike_high)
            if raw is None:
                return None
            parsed = _parse_massive_contracts(raw, census=census, min_volume=min_volume)
            for c in parsed:
                self.contracts[(ticker, exp, side, c["strike"])] = c
            return parsed
        return _provider


# ── Core scan ──────────────────────────────────────────────────────────────────

def scan_ticker(ticker, price, week_exps, min_premium, min_p_profit=None,
                chain_provider=None, as_of=None, stats=None, census=None,
                leg_b_delta=None, min_upside=0.0):
    """
    Builds all valid triplets for one ticker across the provided expirations.

    Args:
        ticker         : str
        price          : float — current stock price (at the scan/replay moment)
        week_exps      : list of (week_num, exp_str)
        min_premium    : float — minimum net credit required
        min_p_profit   : float or None — minimum P(max profit); defaults to MIN_P_MAX_PROFIT
        chain_provider : callable(ticker, exp, side, strike_low, strike_high)
                         -> list of {strike, bid, ask, mid, delta, volume} or
                         None on error. Defaults to the live Massive snapshot
                         (_live_chain_provider). The backtest replay injects an
                         extract-backed provider — all leg/guard/scoring logic
                         below is shared between live and replay.
        as_of          : date or None — valuation date for time-to-expiry and
                         the expired-contract cut. Defaults to today (live).
                         The replay passes the historical scan date; without
                         it, replaying past dates would silently mis-anchor T.
        stats          : dict or None — if a dict is passed it is filled with
                         rejection counters (no_chain, no_legs, below_min_premium,
                         below_min_p) so a caller can explain a zero-result
                         ticker. Pure bookkeeping: no filter or score changes.
        leg_b_delta    : (low, high) or None — the short-call delta window.
                         Defaults to (LEG_B_DELTA_LOW, LEG_B_DELTA_HIGH), the
                         validated Income window. The Screener's Upside mode
                         passes (0.05, 0.20) for a wide call spread.
        min_upside     : float — floor on max profit ÷ collateral per share,
                         (net_premium + spread_width) / leg_c_strike. 0.0 (the
                         default) disables the gate entirely; when active, a
                         `below_min_upside` counter is added to `stats`.

    Every existing caller (the sector cron, the backtest replay, the CLI,
    /api/run's Income mode) passes neither keyword, and the default path is
    byte-identical to the pre-parameter scanner — tests/test_mode_defaults.py
    holds a golden fixture recorded from that code.

    Returns:
        (triplets: list[dict], total_evaluated: int)
    """
    if min_p_profit is None:
        min_p_profit = MIN_P_MAX_PROFIT
    if chain_provider is None:
        chain_provider = _live_chain_provider
        if census is not None:   # the liquidity census rides on the live provider only (bookkeeping; no filter change)
            chain_provider = functools.partial(_live_chain_provider, census=census)
    if as_of is None:
        as_of = datetime.today().date()
    leg_b_low, leg_b_high = leg_b_delta if leg_b_delta is not None else (LEG_B_DELTA_LOW, LEG_B_DELTA_HIGH)
    upside_gate = float(min_upside or 0.0) > 0.0

    triplets        = []
    total_evaluated = 0
    if stats is None:
        stats = {}
    stats.update(no_chain=0, no_legs=0, below_min_premium=0, below_min_p=0)
    if upside_gate:
        stats["below_min_upside"] = 0

    strike_low  = round(price * 0.70, 2)
    strike_high = round(price * 1.30, 2)

    for week_num, exp in week_exps:
        exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
        T = (exp_date - as_of).days / 365.0
        if T <= 0:
            continue

        calls = chain_provider(ticker, exp, "call", strike_low, strike_high)
        puts  = chain_provider(ticker, exp, "put", strike_low, strike_high)
        if calls is None or puts is None:
            stats["no_chain"] += 1
            continue

        # Segment by role. Premium is the transactable side of the quote:
        # legs we buy price at the ask, legs we sell price at the bid — so
        # net_premium is the credit we could actually collect.
        leg_a_cands = [{**c, "premium": c["ask"]} for c in calls
                       if LEG_A_DELTA_LOW <= c["delta"] <= LEG_A_DELTA_HIGH]

        leg_b_pool  = [{**c, "premium": c["bid"]} for c in calls
                       if leg_b_low <= c["delta"] <= leg_b_high]

        leg_c_cands = [{**c, "premium": c["bid"]} for c in puts
                       if LEG_C_DELTA_LOW <= c["delta"] <= LEG_C_DELTA_HIGH
                       and c["strike"] < price]

        if not leg_a_cands or not leg_b_pool or not leg_c_cands:
            stats["no_legs"] += 1
            continue

        for leg_a in leg_a_cands:
            leg_b_cands = [c for c in leg_b_pool if c["strike"] > leg_a["strike"]]
            if not leg_b_cands:
                continue

            # Try Leg B candidates nearest the current spot first. (This was
            # previously a sort toward "fair value", but that value always
            # equaled spot — see CLAUDE.md Changelog on the forwardPE
            # circularity — so this is the same ordering, stated honestly.)
            leg_b_cands.sort(key=lambda c: abs(c["strike"] - price))

            for leg_b in leg_b_cands:
                # No-arbitrage sanity check: a higher-strike call can never be
                # worth more than a lower-strike one. With B at bid and A at
                # ask this should never fire — a hit means a crossed or
                # degenerate quote slipped through.
                if leg_b["premium"] >= leg_a["premium"]:
                    print(f"    [!] monotonicity reject {ticker} {exp}: "
                          f"B {leg_b['strike']}@{leg_b['premium']} >= "
                          f"A {leg_a['strike']}@{leg_a['premium']}",
                          file=sys.stderr)
                    continue

                for leg_c in leg_c_cands:
                    total_evaluated += 1

                    net_premium = leg_b["premium"] + leg_c["premium"] - leg_a["premium"]
                    if net_premium < min_premium:
                        stats["below_min_premium"] += 1
                        continue

                    spread_width = leg_b["strike"] - leg_a["strike"]
                    if spread_width <= 0:
                        continue

                    score = net_premium / spread_width
                    p_max = (1 - leg_b["delta"]) * (1 - leg_c["delta"])
                    if p_max < min_p_profit:
                        stats["below_min_p"] += 1
                        continue

                    # Upside gate (off by default): max profit ÷ collateral,
                    # both per share — collateral is the put strike (cash-secured).
                    if upside_gate and (net_premium + spread_width) / leg_c["strike"] < min_upside:
                        stats["below_min_upside"] += 1
                        continue

                    triplets.append({
                        "ticker":       ticker,
                        "expiration":   exp,
                        "week":         week_num,
                        "leg_a_strike": leg_a["strike"],
                        "leg_a_prem":   leg_a["premium"],
                        "leg_a_delta":  leg_a["delta"],
                        "leg_b_strike": leg_b["strike"],
                        "leg_b_prem":   leg_b["premium"],
                        "leg_b_delta":  leg_b["delta"],
                        "leg_c_strike": leg_c["strike"],
                        "leg_c_prem":   leg_c["premium"],
                        "leg_c_delta":  leg_c["delta"],
                        "net_premium":  round(net_premium, 4),
                        "spread_width": round(spread_width, 2),
                        "score":        round(score, 6),
                        "p_max_profit": round(p_max, 4),
                    })

    return triplets, total_evaluated


# ── Output formatting ──────────────────────────────────────────────────────────

_COL = dict(
    rank=4, ticker=6, exp=12, wk=4,
    a_stk=10, a_pm=10, b_stk=10, b_pm=10,
    c_stk=10, c_pm=10, net=10, swd=10,
    score=10, pp=11,
)

_LINE_WIDTH = 149


def _header():
    c = _COL
    return (
        f"{'Rank':>{c['rank']}}  {'Ticker':<{c['ticker']}}  {'Expiration':<{c['exp']}}"
        f"  {'Wk':>{c['wk']}}  {'Leg A Stk':>{c['a_stk']}}  {'Leg A Pm':>{c['a_pm']}}"
        f"  {'Leg B Stk':>{c['b_stk']}}  {'Leg B Pm':>{c['b_pm']}}"
        f"  {'Leg C Stk':>{c['c_stk']}}  {'Leg C Pm':>{c['c_pm']}}"
        f"  {'Net Prem':>{c['net']}}  {'Spd Width':>{c['swd']}}"
        f"  {'Score':>{c['score']}}  {'P(Profit)%':>{c['pp']}}"
    )


def _row(rank, t):
    c   = _COL
    wk  = f"W{t['week']}"
    return (
        f"{rank:>{c['rank']}}  {t['ticker']:<{c['ticker']}}  {t['expiration']:<{c['exp']}}"
        f"  {wk:>{c['wk']}}"
        f"  {t['leg_a_strike']:>{c['a_stk']}.2f}"
        f"  ${t['leg_a_prem']:>{c['a_pm']-1}.4f}"
        f"  {t['leg_b_strike']:>{c['b_stk']}.2f}"
        f"  ${t['leg_b_prem']:>{c['b_pm']-1}.4f}"
        f"  {t['leg_c_strike']:>{c['c_stk']}.2f}"
        f"  ${t['leg_c_prem']:>{c['c_pm']-1}.4f}"
        f"  ${t['net_premium']:>{c['net']-1}.4f}"
        f"  {t['spread_width']:>{c['swd']}.2f}"
        f"  {t['score']:>{c['score']}.6f}"
        f"  {t['p_max_profit']*100:>{c['pp']-1}.2f}%"
    )


def print_results(ranked, tickers_no_triplets, total_evaluated, min_premium):
    is_open, et_time = market_status()
    mkt = "OPEN" if is_open else "CLOSED"
    sep = "=" * _LINE_WIDTH
    div = "-" * _LINE_WIDTH

    print(f"\n{sep}")
    print(f"  {BOLD}Luo Capital — Call Spread Risk Reversal Screener{RESET}")
    print(f"  Run: {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}  |  "
          f"Market: {mkt} ({et_time})")
    print(f"  Min net premium: ${min_premium:.2f}  |  "
          f"Min P(max profit): {MIN_P_MAX_PROFIT*100:.0f}%  |  "
          f"Min volume per leg: {MIN_VOLUME}")
    print(sep)

    if not ranked:
        print("\n  No valid triplets found across all tickers and expirations.\n")
    else:
        print(f"\n  {BOLD}Legend:{RESET}  "
              f"{RED}Red{RESET} = P(max profit) 50–55%% (borderline)\n")
        print(f"  {_header()}")
        print(f"  {div}")

        for rank, t in enumerate(ranked, start=1):
            line = _row(rank, t)
            borderline = MIN_P_MAX_PROFIT <= t["p_max_profit"] <= 0.55

            if borderline:
                print(f"  {RED}{line}{RESET}")
            else:
                print(f"  {line}")

        print(f"  {div}")

    print(f"\n  {BOLD}SUMMARY{RESET}")
    print(f"  Total triplets evaluated : {total_evaluated:,}")
    print(f"  Triplets passing filters : {len(ranked):,}")
    if tickers_no_triplets:
        print(f"  No valid triplets found  : {', '.join(tickers_no_triplets)}")
    print(f"\n{sep}\n")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Call Spread Risk Reversal Screener — Luo Capital",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 screener.py\n"
            "  python3 screener.py --tickers NVDA META TSLA\n"
            "  python3 screener.py --weeks 6 --min-premium 3.00\n"
        ),
    )
    parser.add_argument(
        "--tickers", nargs="+", metavar="TICKER",
        help="Ticker symbols to scan (default: project watchlist)",
    )
    parser.add_argument(
        "--weeks", type=int, default=DEFAULT_WEEKS, metavar="N",
        help=f"Maximum weekly expiration to scan, W1–WN (default: {DEFAULT_WEEKS}, max: 12)",
    )
    parser.add_argument(
        "--weeks-min", type=int, default=1, metavar="N",
        help="Minimum weekly expiration to scan (default: 1)",
    )
    parser.add_argument(
        "--min-premium", type=float, default=DEFAULT_MIN_PREMIUM, metavar="DOLLARS",
        help=f"Minimum net credit in dollars (default: ${DEFAULT_MIN_PREMIUM:.2f})",
    )
    args = parser.parse_args()

    tickers     = [t.lstrip("$").upper() for t in (args.tickers or DEFAULT_TICKERS)]
    weeks_max   = max(1, min(12, args.weeks))
    weeks_min   = max(1, min(weeks_max, args.weeks_min))
    min_premium = args.min_premium

    print(f"\nLuo Capital — Call Spread Risk Reversal Screener")
    print(f"Run date    : {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Tickers     : {', '.join(tickers)}")
    print(f"Weeks       : W{weeks_min}–W{weeks_max}  |  Min net premium: ${min_premium:.2f}")
    print()

    target_fridays = get_next_fridays(weeks_max)
    # Filter to [weeks_min, weeks_max] inclusive (week numbers are 1-indexed)
    week_exps_template = [
        (i + 1, f.strftime("%Y-%m-%d"))
        for i, f in enumerate(target_fridays)
        if weeks_min <= (i + 1) <= weeks_max
    ]

    all_triplets     = []
    total_evaluated  = 0
    tickers_no_trips = []

    for ticker in tickers:
        print(f"Scanning {ticker}...", end="", flush=True)

        # ── Price (yfinance — only remaining yfinance call here) ──
        try:
            hist = yf.Ticker(ticker).history(period="1d")
            if hist.empty:
                print(f"  [!] no price data — skipping")
                tickers_no_trips.append(ticker)
                continue
            price = round(float(hist["Close"].iloc[-1]), 2)
        except Exception as e:
            print(f"  [!] price fetch failed ({e}) — skipping")
            tickers_no_trips.append(ticker)
            continue

        # ── Scan ───────────────────────────────────────────────────
        triplets, evaluated = scan_ticker(
            ticker, price, week_exps_template, min_premium
        )
        total_evaluated += evaluated
        all_triplets.extend(triplets)

        count = len(triplets)
        if count:
            plural = "s" if count != 1 else ""
            print(f"  found {count} triplet{plural}  (price=${price:.2f})")
        else:
            print(f"  no valid triplets  (price=${price:.2f})")
            tickers_no_trips.append(ticker)

    # ── Rank and display ───────────────────────────────────────────
    ranked = sorted(all_triplets, key=lambda t: t["score"], reverse=True)
    print_results(ranked, tickers_no_trips, total_evaluated, min_premium)


if __name__ == "__main__":
    main()
