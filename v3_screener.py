"""
v3_screener.py — V3 Call Spread Risk Reversal Screener

Strategy (3 legs):
  Leg A: Buy  ATM call  (long)  — pay premium
  Leg B: Sell OTM call  (short) — collect premium (target: near fair value)
  Leg C: Sell OTM put   (short) — collect premium
  Goal:  Net Premium = (B + C) − A ≥ $5.00  (credit only)

Run:
  python3 v3_screener.py
  python3 v3_screener.py --tickers NVDA META TSLA
  python3 v3_screener.py --weeks 6 --min-premium 3.00
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


def get_fair_value(ticker):
    """
    Compute fair value via fallback chain:
      1. forwardEps × forwardPE
      2. trailingEps × trailingPE
      3. targetMeanPrice  (analyst consensus)
      4. None
    Returns a float or None.
    """
    try:
        info = yf.Ticker(ticker).info
    except Exception:
        return None

    fwd_eps = info.get("forwardEps")
    fwd_pe  = info.get("forwardPE")
    if fwd_eps and fwd_pe and fwd_eps > 0 and fwd_pe > 0:
        return round(float(fwd_eps) * float(fwd_pe), 2)

    trail_eps = info.get("trailingEps")
    trail_pe  = info.get("trailingPE")
    if trail_eps and trail_pe and trail_eps > 0 and trail_pe > 0:
        return round(float(trail_eps) * float(trail_pe), 2)

    target = info.get("targetMeanPrice")
    if target and float(target) > 0:
        return round(float(target), 2)

    return None


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
    """Filter and normalize a list of Massive option snapshot objects."""
    result = []
    for o in raw:
        if o.greeks is None or o.greeks.delta is None:
            continue
        if o.implied_volatility is None or float(o.implied_volatility) <= MIN_IV:
            continue
        if o.day is None or o.day.close is None:
            continue
        vol = int(o.day.volume) if o.day.volume is not None else 0
        if vol < MIN_VOLUME:
            continue
        result.append({
            "strike":  float(o.details.strike_price),
            "premium": round(float(o.day.close), 4),
            "delta":   round(abs(float(o.greeks.delta)), 6),
            "volume":  vol,
        })
    return result


# ── Core scan ──────────────────────────────────────────────────────────────────

def scan_ticker(ticker, price, week_exps, fair_value, min_premium, min_p_profit=None):
    """
    Builds all valid triplets for one ticker across the provided expirations.

    Args:
        ticker        : str
        price         : float — current stock price
        week_exps     : list of (week_num, exp_str)
        fair_value    : float or None
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

        # Segment by role
        leg_a_cands = [c for c in calls
                       if LEG_A_DELTA_LOW <= c["delta"] <= LEG_A_DELTA_HIGH]

        leg_b_pool  = [c for c in calls
                       if LEG_B_DELTA_LOW <= c["delta"] <= LEG_B_DELTA_HIGH]

        leg_c_cands = [c for c in puts
                       if LEG_C_DELTA_LOW <= c["delta"] <= LEG_C_DELTA_HIGH
                       and c["strike"] < price]

        if not leg_a_cands or not leg_b_pool or not leg_c_cands:
            continue

        for leg_a in leg_a_cands:
            leg_b_cands = [c for c in leg_b_pool if c["strike"] > leg_a["strike"]]
            if not leg_b_cands:
                continue

            if fair_value is not None:
                leg_b_cands.sort(key=lambda c: abs(c["strike"] - fair_value))

            for leg_b in leg_b_cands:
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
                        "fair_value":   fair_value,
                        "fv_available": fair_value is not None,
                    })

    return triplets, total_evaluated


# ── Output formatting ──────────────────────────────────────────────────────────

_COL = dict(
    rank=4, ticker=6, exp=12, wk=4,
    a_stk=10, a_pm=10, b_stk=10, b_pm=10,
    c_stk=10, c_pm=10, net=10, swd=10,
    score=10, pp=11, fv=11,
)

_LINE_WIDTH = 162


def _header():
    c = _COL
    return (
        f"{'Rank':>{c['rank']}}  {'Ticker':<{c['ticker']}}  {'Expiration':<{c['exp']}}"
        f"  {'Wk':>{c['wk']}}  {'Leg A Stk':>{c['a_stk']}}  {'Leg A Pm':>{c['a_pm']}}"
        f"  {'Leg B Stk':>{c['b_stk']}}  {'Leg B Pm':>{c['b_pm']}}"
        f"  {'Leg C Stk':>{c['c_stk']}}  {'Leg C Pm':>{c['c_pm']}}"
        f"  {'Net Prem':>{c['net']}}  {'Spd Width':>{c['swd']}}"
        f"  {'Score':>{c['score']}}  {'P(Profit)%':>{c['pp']}}  {'Fair Value':>{c['fv']}}"
    )


def _row(rank, t):
    c   = _COL
    fv  = f"${t['fair_value']:.2f}" if t["fv_available"] else "N/A"
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
        f"  {fv:>{c['fv']}}"
    )


def print_results(ranked, tickers_no_triplets, total_evaluated, min_premium):
    is_open, et_time = market_status()
    mkt = "OPEN" if is_open else "CLOSED"
    sep = "=" * _LINE_WIDTH
    div = "-" * _LINE_WIDTH

    print(f"\n{sep}")
    print(f"  {BOLD}Luo Capital — V3 Call Spread Risk Reversal Screener{RESET}")
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
              f"{YELLOW}Yellow{RESET} = no fair value, Leg B by delta only  |  "
              f"{RED}Red{RESET} = P(max profit) 50–55%% (borderline)\n")
        print(f"  {_header()}")
        print(f"  {div}")

        for rank, t in enumerate(ranked, start=1):
            line = _row(rank, t)
            borderline = MIN_P_MAX_PROFIT <= t["p_max_profit"] <= 0.55
            no_fv      = not t["fv_available"]

            if borderline:
                print(f"  {RED}{line}{RESET}")
            elif no_fv:
                print(f"  {YELLOW}{line}{RESET}")
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
        description="V3 Call Spread Risk Reversal Screener — Luo Capital",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 v3_screener.py\n"
            "  python3 v3_screener.py --tickers NVDA META TSLA\n"
            "  python3 v3_screener.py --weeks 6 --min-premium 3.00\n"
        ),
    )
    parser.add_argument(
        "--tickers", nargs="+", metavar="TICKER",
        help="Ticker symbols to scan (default: project watchlist)",
    )
    parser.add_argument(
        "--weeks", type=int, default=DEFAULT_WEEKS, metavar="N",
        help=f"Number of weekly expirations W1–WN (default: {DEFAULT_WEEKS}, max: 12)",
    )
    parser.add_argument(
        "--min-premium", type=float, default=DEFAULT_MIN_PREMIUM, metavar="DOLLARS",
        help=f"Minimum net credit in dollars (default: ${DEFAULT_MIN_PREMIUM:.2f})",
    )
    args = parser.parse_args()

    tickers     = [t.lstrip("$").upper() for t in (args.tickers or DEFAULT_TICKERS)]
    weeks       = max(1, min(12, args.weeks))
    min_premium = args.min_premium

    print(f"\nLuo Capital — V3 Call Spread Risk Reversal Screener")
    print(f"Run date    : {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Tickers     : {', '.join(tickers)}")
    print(f"Weeks       : W1–W{weeks}  |  Min net premium: ${min_premium:.2f}")
    print()

    target_fridays = get_next_fridays(weeks)
    week_exps_template = [(i + 1, f.strftime("%Y-%m-%d")) for i, f in enumerate(target_fridays)]

    all_triplets     = []
    total_evaluated  = 0
    tickers_no_trips = []

    for ticker in tickers:
        print(f"Scanning {ticker}...", end="", flush=True)

        # ── Price (yfinance — only remaining yfinance call in v3) ──
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

        # ── Fair value ─────────────────────────────────────────────
        fair_value = get_fair_value(ticker)
        fv_str     = f"${fair_value:.2f}" if fair_value is not None else "N/A"

        # ── Scan ───────────────────────────────────────────────────
        triplets, evaluated = scan_ticker(
            ticker, price, week_exps_template, fair_value, min_premium
        )
        total_evaluated += evaluated
        all_triplets.extend(triplets)

        count = len(triplets)
        if count:
            plural = "s" if count != 1 else ""
            print(f"  found {count} triplet{plural}  "
                  f"(price=${price:.2f}, FV={fv_str})")
        else:
            print(f"  no valid triplets  (price=${price:.2f}, FV={fv_str})")
            tickers_no_trips.append(ticker)

    # ── Rank and display ───────────────────────────────────────────
    ranked = sorted(all_triplets, key=lambda t: t["score"], reverse=True)
    print_results(ranked, tickers_no_trips, total_evaluated, min_premium)


if __name__ == "__main__":
    main()
