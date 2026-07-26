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


def _parse_massive_contracts(raw):
    """Filter and normalize a list of Massive option snapshot objects.

    Prices come from the live quote (Options Advanced plan), not day.close —
    the last-trade price can be hours stale and violates strike monotonicity.
    Each contract keeps both sides; the leg role decides which side is the
    transactable premium (sell → bid, buy → ask).
    """
    result = []
    for o in raw:
        if o.greeks is None or o.greeks.delta is None:
            continue
        if o.implied_volatility is None or float(o.implied_volatility) <= MIN_IV:
            continue
        q = o.last_quote
        if q is None or q.bid is None or q.ask is None:
            continue
        bid, ask = float(q.bid), float(q.ask)
        if bid <= 0 or ask <= 0 or ask < bid:
            continue          # no live two-sided quote → not tradeable
        mid = (bid + ask) / 2
        if (ask - bid) / mid > MAX_SPREAD_PCT:
            continue          # quote too wide for the price to be meaningful
        vol = int(o.day.volume) if o.day is not None and o.day.volume is not None else 0
        if vol < MIN_VOLUME:
            continue
        result.append({
            "strike": float(o.details.strike_price),
            "bid":    round(bid, 4),
            "ask":    round(ask, 4),
            "mid":    round(mid, 4),
            "delta":  round(abs(float(o.greeks.delta)), 6),
            "volume": vol,
        })
    return result


# ── Core scan ──────────────────────────────────────────────────────────────────

def scan_ticker(ticker, price, week_exps, min_premium, min_p_profit=None):
    """
    Builds all valid triplets for one ticker across the provided expirations.

    Args:
        ticker        : str
        price         : float — current stock price
        week_exps     : list of (week_num, exp_str)
        min_premium   : float — minimum net credit required
        min_p_profit  : float or None — minimum P(max profit); defaults to MIN_P_MAX_PROFIT

    Returns:
        (triplets: list[dict], total_evaluated: int)
    """
    if min_p_profit is None:
        min_p_profit = MIN_P_MAX_PROFIT

    triplets        = []
    total_evaluated = 0

    strike_low  = round(price * 0.70, 2)
    strike_high = round(price * 1.30, 2)

    for week_num, exp in week_exps:
        exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
        T = (exp_date - datetime.today().date()).days / 365.0
        if T <= 0:
            continue

        try:
            raw_calls = list(massive_client.list_snapshot_options_chain(
                ticker,
                params={
                    'expiration_date':  exp,
                    'strike_price.gte': strike_low,
                    'strike_price.lte': strike_high,
                    'contract_type':    'call',
                    'limit':            250,
                }
            ))
        except Exception as e:
            print(f"\n    [!] {exp}: call chain error — {e}")
            continue

        try:
            raw_puts = list(massive_client.list_snapshot_options_chain(
                ticker,
                params={
                    'expiration_date':  exp,
                    'strike_price.gte': strike_low,
                    'strike_price.lte': strike_high,
                    'contract_type':    'put',
                    'limit':            250,
                }
            ))
        except Exception as e:
            print(f"\n    [!] {exp}: put chain error — {e}")
            continue

        calls = _parse_massive_contracts(raw_calls)
        puts  = _parse_massive_contracts(raw_puts)

        # Segment by role. Premium is the transactable side of the quote:
        # legs we buy price at the ask, legs we sell price at the bid — so
        # net_premium is the credit we could actually collect.
        leg_a_cands = [{**c, "premium": c["ask"]} for c in calls
                       if LEG_A_DELTA_LOW <= c["delta"] <= LEG_A_DELTA_HIGH]

        leg_b_pool  = [{**c, "premium": c["bid"]} for c in calls
                       if LEG_B_DELTA_LOW <= c["delta"] <= LEG_B_DELTA_HIGH]

        leg_c_cands = [{**c, "premium": c["bid"]} for c in puts
                       if LEG_C_DELTA_LOW <= c["delta"] <= LEG_C_DELTA_HIGH
                       and c["strike"] < price]

        if not leg_a_cands or not leg_b_pool or not leg_c_cands:
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
                        continue

                    spread_width = leg_b["strike"] - leg_a["strike"]
                    if spread_width <= 0:
                        continue

                    score = net_premium / spread_width
                    p_max = (1 - leg_b["delta"]) * (1 - leg_c["delta"])
                    if p_max < min_p_profit:
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
