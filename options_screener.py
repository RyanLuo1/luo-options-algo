import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd
import math
from scipy.stats import norm

TICKERS = ["GEV", "PLTR", "APP", "AVGO", "META", "MU", "NVDA", "TSLA", "AMD", "TSM"]
DISTANCES = [0.03, 0.05, 0.07, 0.10, 0.15]


def get_next_fridays(n=4):
    today = datetime.today()
    fridays = []
    d = today + timedelta(days=1)
    while len(fridays) < n:
        if d.weekday() == 4:  # Friday
            fridays.append(d.date())
        d += timedelta(days=1)
    return fridays


RISK_FREE_RATE = 0.045  # approximate current risk-free rate


def black_scholes_delta(S, K, T, sigma, side):
    """Returns BS delta for a call or put. Returns None if inputs are invalid."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return None
    try:
        d1 = (math.log(S / K) + (RISK_FREE_RATE + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        if side == "call":
            return norm.cdf(d1)
        else:
            return abs(norm.cdf(d1) - 1)  # abs of put delta
    except Exception:
        return None


def find_closest_strike(strikes, target):
    return min(strikes, key=lambda s: abs(s - target))


def get_midpoint(row):
    bid = row.get("bid", 0) or 0
    ask = row.get("ask", 0) or 0
    if bid > 0 and ask > 0:
        return round((bid + ask) / 2, 4)
    last = row.get("lastPrice", 0) or 0
    return round(last, 4)


def fetch_ticker_data(ticker):
    stock = yf.Ticker(ticker)
    hist = stock.history(period="1d")
    if hist.empty:
        print(f"  [!] No price data for {ticker}")
        return None, None

    price = round(hist["Close"].iloc[-1], 2)
    expirations = stock.options  # all available expiration strings

    target_fridays = get_next_fridays(4)

    # Match each target Friday to the nearest available expiration
    matched_expirations = []
    for friday in target_fridays:
        best = None
        best_delta = timedelta(days=999)
        for exp_str in expirations:
            exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
            delta = abs(exp_date - friday)
            if delta < best_delta:
                best_delta = delta
                best = exp_str
        if best and best not in matched_expirations:
            matched_expirations.append(best)

    return price, matched_expirations


def build_rows(ticker, price, expirations):
    stock = yf.Ticker(ticker)
    rows = []

    for i, exp in enumerate(expirations):
        week_label = f"Week {i + 1}"
        try:
            chain = stock.option_chain(exp)
        except Exception as e:
            print(f"  [!] Could not fetch chain for {ticker} {exp}: {e}")
            continue

        calls_df = chain.calls.set_index("strike") if not chain.calls.empty else None
        puts_df = chain.puts.set_index("strike") if not chain.puts.empty else None

        exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
        T = (exp_date - datetime.today().date()).days / 365.0

        for dist in DISTANCES:
            dist_pct = int(dist * 100)

            # --- CALL ---
            call_target = round(price * (1 + dist), 2)
            call_actual = None
            call_premium = None
            call_delta = None
            call_volume = None
            call_oi = None
            if calls_df is not None and not calls_df.empty:
                call_actual = find_closest_strike(list(calls_df.index), call_target)
                call_row = calls_df.loc[call_actual]
                call_premium = get_midpoint(call_row)
                iv = call_row.get("impliedVolatility", None)
                if iv and iv == iv and iv > 0.01:
                    call_delta = black_scholes_delta(price, call_actual, T, float(iv), "call")
                raw_vol = call_row.get("volume", None)
                raw_oi  = call_row.get("openInterest", None)
                call_volume = int(raw_vol) if raw_vol is not None and raw_vol == raw_vol else None
                call_oi     = int(raw_oi)  if raw_oi  is not None and raw_oi  == raw_oi  else None

            # --- PUT ---
            put_target = round(price * (1 - dist), 2)
            put_actual = None
            put_premium = None
            put_delta = None
            put_volume = None
            put_oi = None
            if puts_df is not None and not puts_df.empty:
                put_actual = find_closest_strike(list(puts_df.index), put_target)
                put_row = puts_df.loc[put_actual]
                put_premium = get_midpoint(put_row)
                iv = put_row.get("impliedVolatility", None)
                if iv and iv == iv and iv > 0.01:
                    put_delta = black_scholes_delta(price, put_actual, T, float(iv), "put")
                raw_vol = put_row.get("volume", None)
                raw_oi  = put_row.get("openInterest", None)
                put_volume = int(raw_vol) if raw_vol is not None and raw_vol == raw_vol else None
                put_oi     = int(raw_oi)  if raw_oi  is not None and raw_oi  == raw_oi  else None

            rows.append({
                "Ticker":       ticker,
                "Price":        price,
                "Expiration":   exp,
                "Week":         week_label,
                "Dist %":       f"{dist_pct}%",
                "Call Target":  call_target,
                "Call Actual":  call_actual,
                "Call Premium": call_premium,
                "Call Delta":   call_delta,
                "Call Volume":  call_volume,
                "Call OI":      call_oi,
                "Put Target":   put_target,
                "Put Actual":   put_actual,
                "Put Premium":  put_premium,
                "Put Delta":    put_delta,
                "Put Volume":   put_volume,
                "Put OI":       put_oi,
            })

    return rows


def print_ticker_table(ticker, rows):
    print(f"\n{'=' * 128}")
    print(f"  {ticker}")
    print(f"{'=' * 128}")

    if not rows:
        print("  No data.")
        return

    from event_filter import get_earnings_flag
    price = rows[0]["Price"]
    last_expiration = rows[-1]["Expiration"]
    earnings = get_earnings_flag(ticker, last_expiration)
    earnings_display = earnings.replace("EARNINGS ", "") if "EARNINGS" in earnings else "None in next 4 weeks"
    print(f"  Current Price: ${price}")
    print(f"  Earnings: {earnings_display}\n")

    header = (
        f"  {'Expiration':<12} {'Wk':>3} {'Dist':>5}  "
        f"{'Call Target':>12} {'Call Actual':>12} {'Call Prem':>10} {'C.Vol':>7} {'C.OI':>7}  "
        f"{'Put Target':>12} {'Put Actual':>12} {'Put Prem':>10} {'P.Vol':>7} {'P.OI':>7}"
    )
    print(header)
    print(f"  {'-' * 130}")

    for r in rows:
        call_actual = f"{r['Call Actual']:.2f}" if r["Call Actual"] is not None else "N/A"
        put_actual  = f"{r['Put Actual']:.2f}"  if r["Put Actual"]  is not None else "N/A"
        call_p = f"${r['Call Premium']:.4f}" if r["Call Premium"] is not None else "N/A"
        put_p  = f"${r['Put Premium']:.4f}"  if r["Put Premium"]  is not None else "N/A"
        c_vol  = str(r["Call Volume"]) if r["Call Volume"] is not None else "N/A"
        c_oi   = str(r["Call OI"])     if r["Call OI"]     is not None else "N/A"
        p_vol  = str(r["Put Volume"])  if r["Put Volume"]  is not None else "N/A"
        p_oi   = str(r["Put OI"])      if r["Put OI"]      is not None else "N/A"
        wk = r["Week"].replace("Week ", "W")
        print(
            f"  {r['Expiration']:<12} {wk:>3} {r['Dist %']:>5}  "
            f"{r['Call Target']:>12.2f} {call_actual:>12} {call_p:>10} {c_vol:>7} {c_oi:>7}  "
            f"{r['Put Target']:>12.2f} {put_actual:>12} {put_p:>10} {p_vol:>7} {p_oi:>7}"
        )


def fetch_all_rows(verbose=True, tickers=None):
    tickers = tickers or TICKERS
    if verbose:
        print("\nOptions Screener — Luo Capital")
        print(f"Run Date: {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}")

    all_rows = []
    for ticker in tickers:
        if verbose:
            print(f"\nFetching {ticker}...")
        price, expirations = fetch_ticker_data(ticker)
        if price is None:
            continue

        rows = build_rows(ticker, price, expirations)
        all_rows.extend(rows)
        if verbose:
            print_ticker_table(ticker, rows)

    if verbose:
        print(f"\n{'=' * 106}")
        print("Done.")

    return all_rows


def main():
    from event_filter import load_events
    load_events()
    fetch_all_rows(verbose=True)


if __name__ == "__main__":
    main()
