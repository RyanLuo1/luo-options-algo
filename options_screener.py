import os
import yfinance as yf
from datetime import datetime, timedelta
from dotenv import load_dotenv
from massive import RESTClient

load_dotenv()

TICKERS = ["GEV", "PLTR", "APP", "AVGO", "META", "MU", "NVDA", "TSLA", "AMD", "TSM"]
DISTANCES = [0.03, 0.05, 0.07, 0.10, 0.15]

massive_client = RESTClient(os.getenv('MASSIVE_API_KEY'))


def get_next_fridays(n=4):
    today = datetime.today()
    fridays = []
    d = today + timedelta(days=1)
    while len(fridays) < n:
        if d.weekday() == 4:  # Friday
            fridays.append(d.date())
        d += timedelta(days=1)
    return fridays


def find_closest_strike(strikes, target):
    return min(strikes, key=lambda s: abs(s - target))


def get_midpoint(row):
    bid = row.get("bid", 0) or 0
    ask = row.get("ask", 0) or 0
    if bid > 0 and ask > 0:
        return round((bid + ask) / 2, 4)
    last = row.get("lastPrice", 0) or 0
    return round(last, 4)


def fetch_ticker_data(ticker, weeks=4):
    stock = yf.Ticker(ticker)
    hist = stock.history(period="1d")
    if hist.empty:
        print(f"  [!] No price data for {ticker}")
        return None, None

    price = round(hist["Close"].iloc[-1], 2)
    target_fridays = get_next_fridays(weeks)
    expirations = [f.strftime("%Y-%m-%d") for f in target_fridays]
    return price, expirations


def _log_massive_error(ticker, exp, side, err):
    msg = str(err)
    if any(x in msg for x in ('401', '403', 'Unauthorized', 'Forbidden')):
        print(f"  [!] Massive auth error ({ticker} {exp} {side}) — check MASSIVE_API_KEY: {msg}")
    else:
        print(f"  [!] Massive error ({ticker} {exp} {side}): {msg}")


def _build_strike_dict(contracts):
    """Build a strike → contract mapping, keeping only contracts with valid Greeks, IV, and price."""
    d = {}
    for o in contracts:
        if o.greeks is None or o.greeks.delta is None:
            continue
        if o.implied_volatility is None or float(o.implied_volatility) <= 0.01:
            continue
        if o.day is None or o.day.close is None:
            continue
        d[float(o.details.strike_price)] = o
    return d


def build_rows(ticker, price, expirations, distances=None):
    if distances is None:
        distances = DISTANCES

    rows = []
    strike_low  = round(price * 0.80, 2)
    strike_high = round(price * 1.20, 2)

    for i, exp in enumerate(expirations):
        week_label = f"Week {i + 1}"

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
            _log_massive_error(ticker, exp, 'call', e)
            raw_calls = []

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
            _log_massive_error(ticker, exp, 'put', e)
            raw_puts = []

        if not raw_calls and not raw_puts:
            print(f"  [!] No chain data from Massive for {ticker} {exp}")
            continue

        calls_dict = _build_strike_dict(raw_calls)
        puts_dict  = _build_strike_dict(raw_puts)

        for dist in distances:
            dist_pct = dist * 100

            # --- CALL ---
            call_target = round(price * (1 + dist), 2)
            call_actual = call_premium = call_delta = call_volume = call_oi = None
            if calls_dict:
                call_actual  = find_closest_strike(list(calls_dict.keys()), call_target)
                o            = calls_dict[call_actual]
                call_premium = round(float(o.day.close), 4)
                call_delta   = round(abs(float(o.greeks.delta)), 6)
                call_volume  = int(o.day.volume)    if o.day.volume    is not None else None
                call_oi      = int(o.open_interest) if o.open_interest is not None else None

            # --- PUT ---
            put_target = round(price * (1 - dist), 2)
            put_actual = put_premium = put_delta = put_volume = put_oi = None
            if puts_dict:
                put_actual  = find_closest_strike(list(puts_dict.keys()), put_target)
                o           = puts_dict[put_actual]
                put_premium = round(float(o.day.close), 4)
                put_delta   = round(abs(float(o.greeks.delta)), 6)
                put_volume  = int(o.day.volume)    if o.day.volume    is not None else None
                put_oi      = int(o.open_interest) if o.open_interest is not None else None

            rows.append({
                "Ticker":       ticker,
                "Price":        price,
                "Expiration":   exp,
                "Week":         week_label,
                "Dist %":       f"{dist_pct:g}%",
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


def fetch_all_rows(verbose=True, tickers=None, distances=None, weeks=4):
    tickers = tickers or TICKERS
    if verbose:
        print("\nOptions Screener — Luo Capital")
        print(f"Run Date: {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}")

    all_rows = []
    for ticker in tickers:
        if verbose:
            print(f"\nFetching {ticker}...")
        price, expirations = fetch_ticker_data(ticker, weeks=weeks)
        if price is None:
            continue

        rows = build_rows(ticker, price, expirations, distances=distances)
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
