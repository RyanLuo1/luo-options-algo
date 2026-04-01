import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd

TICKERS = ["GEV", "PLTR", "APP", "AVGO", "META", "MU", "NVDA", "TSLA", "AMD", "TSM"]
DISTANCES = [0.05, 0.07, 0.10, 0.12]


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

        for dist in DISTANCES:
            dist_pct = int(dist * 100)

            # --- CALL ---
            call_target = round(price * (1 + dist), 2)
            call_premium = None
            if calls_df is not None and not calls_df.empty:
                call_strike = find_closest_strike(list(calls_df.index), call_target)
                call_row = calls_df.loc[call_strike]
                call_premium = get_midpoint(call_row)

            # --- PUT ---
            put_target = round(price * (1 - dist), 2)
            put_premium = None
            if puts_df is not None and not puts_df.empty:
                put_strike = find_closest_strike(list(puts_df.index), put_target)
                put_row = puts_df.loc[put_strike]
                put_premium = get_midpoint(put_row)

            rows.append({
                "Ticker": ticker,
                "Price": price,
                "Expiration": exp,
                "Week": week_label,
                "Dist %": f"{dist_pct}%",
                "Call Strike": round(price * (1 + dist), 2),
                "Call Premium": call_premium,
                "Put Strike": round(price * (1 - dist), 2),
                "Put Premium": put_premium,
            })

    return rows


def print_ticker_table(ticker, rows):
    print(f"\n{'=' * 72}")
    print(f"  {ticker}")
    print(f"{'=' * 72}")

    if not rows:
        print("  No data.")
        return

    price = rows[0]["Price"]
    print(f"  Current Price: ${price}\n")

    header = f"  {'Week':<8} {'Dist':>5}  {'Call Strike':>12} {'Call Prem':>10}  {'Put Strike':>12} {'Put Prem':>10}"
    print(header)
    print(f"  {'-' * 66}")

    for r in rows:
        call_p = f"${r['Call Premium']:.4f}" if r["Call Premium"] is not None else "  N/A"
        put_p = f"${r['Put Premium']:.4f}" if r["Put Premium"] is not None else "  N/A"
        print(
            f"  {r['Week']:<8} {r['Dist %']:>5}  "
            f"{r['Call Strike']:>12.2f} {call_p:>10}  "
            f"{r['Put Strike']:>12.2f} {put_p:>10}"
        )


def main():
    print("\nOptions Screener — Luo Capital")
    print(f"Run Date: {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}")

    for ticker in TICKERS:
        print(f"\nFetching {ticker}...")
        price, expirations = fetch_ticker_data(ticker)
        if price is None:
            continue

        rows = build_rows(ticker, price, expirations)
        print_ticker_table(ticker, rows)

    print(f"\n{'=' * 72}")
    print("Done.")


if __name__ == "__main__":
    main()
