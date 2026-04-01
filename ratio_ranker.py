from options_screener import fetch_all_rows
from event_filter import load_events, get_macro_events, get_earnings_flag
from datetime import datetime, time
from zoneinfo import ZoneInfo


def calculate_ratios(all_rows):
    ranked = []

    for r in all_rows:
        price = r["Price"]

        # --- Call ---
        call_delta = r.get("Call Delta")
        if r["Call Premium"] is not None and r["Call Actual"] is not None and call_delta and call_delta >= 0.05:
            ratio = (r["Call Premium"] / price) / call_delta
            ranked.append({
                "Ticker":     r["Ticker"],
                "Side":       "Call",
                "Expiration": r["Expiration"],
                "Week":       r["Week"],
                "Dist %":     r["Dist %"],
                "Delta":      round(call_delta, 4),
                "Strike":     r["Call Actual"],
                "Premium":    r["Call Premium"],
                "Price":      price,
                "Ratio":      round(ratio, 6),
            })

        # --- Put ---
        put_delta = r.get("Put Delta")
        if r["Put Premium"] is not None and r["Put Actual"] is not None and put_delta and put_delta >= 0.05:
            ratio = (r["Put Premium"] / price) / put_delta
            ranked.append({
                "Ticker":     r["Ticker"],
                "Side":       "Put",
                "Expiration": r["Expiration"],
                "Week":       r["Week"],
                "Dist %":     r["Dist %"],
                "Delta":      round(put_delta, 4),
                "Strike":     r["Put Actual"],
                "Premium":    r["Put Premium"],
                "Price":      price,
                "Ratio":      round(ratio, 6),
            })

    ranked.sort(key=lambda x: x["Ratio"], reverse=True)

    # Deduplicate: for the same (Ticker, Side, Expiration, Strike), keep lowest Dist %
    best = {}
    for r in ranked:
        key = (r["Ticker"], r["Side"], r["Expiration"], r["Strike"])
        dist = float(r["Dist %"].rstrip("%"))
        if key not in best or dist < float(best[key]["Dist %"].rstrip("%")):
            best[key] = r

    deduped = sorted(best.values(), key=lambda x: x["Ratio"], reverse=True)
    duplicates_removed = len(ranked) - len(deduped)
    return deduped, duplicates_removed


def market_status():
    eastern = ZoneInfo("America/New_York")
    now_et = datetime.now(eastern)
    is_weekday = now_et.weekday() < 5
    is_trading_hours = time(9, 30) <= now_et.time() <= time(16, 0)
    return is_weekday and is_trading_hours


def print_ranked_table(ranked_rows, duplicates_removed=0):
    is_open = market_status()
    eastern = ZoneInfo("America/New_York")
    now_et = datetime.now(eastern)
    RED    = "\033[31m"
    GREEN  = "\033[32m"
    YELLOW = "\033[33m"
    RESET  = "\033[0m"

    print(f"\n{'=' * 116}")
    print("  RANKED OPTIONS — Luo Capital")
    print(f"  Algorithm: V2 — Delta Adjusted")
    print(f"  Minimum delta threshold: 0.05")
    print(f"  Duplicates removed: {duplicates_removed}")
    print(f"  {'─' * 112}")
    print(f"  Macro Events (next 4 weeks): {get_macro_events()}")
    print(f"  {'─' * 112}")
    print(f"  Run Date: {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}  |  ET: {now_et.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    if is_open:
        print(f"  Market Status: {GREEN}OPEN{RESET}")
    else:
        print(f"  Market Status: {RED}CLOSED{RESET} — data may be stale. Run during market hours for accurate signals.")
    print(f"{'=' * 116}")

    header = (
        f"  {'Rank':>4}  {'Ticker':<6} {'Side':<5} {'Expiration':<12} {'Wk':<4} "
        f"{'Dist':>5}  {'Delta':>7}  {'Strike':>10} {'Premium':>9} {'Stock Price':>11} {'Ratio':>10}  | {'Earnings'}"
    )
    print(header)
    print(f"  {'-' * 112}")

    for i, r in enumerate(ranked_rows, start=1):
        wk = r["Week"].replace("Week ", "W")
        flags = get_earnings_flag(r["Ticker"], r["Expiration"])
        event_cell = f"{YELLOW}{flags}{RESET}" if "EARNINGS" in flags else flags
        print(
            f"  {i:>4}  {r['Ticker']:<6} {r['Side']:<5} {r['Expiration']:<12} {wk:<4} "
            f"{r['Dist %']:>5}  {r['Delta']:>7.4f}  {r['Strike']:>10.2f} ${r['Premium']:>8.4f} "
            f"${r['Price']:>10.2f} {r['Ratio']:>10.6f}  | {event_cell}"
        )

    print(f"  {'-' * 112}")
    print(f"  {len(ranked_rows)} data points ranked (after deduplication).\n")


if __name__ == "__main__":
    print("Fetching options data (silent)...")
    all_rows = fetch_all_rows(verbose=False)

    print("Fetching event data...")
    load_events()

    ranked, dupes = calculate_ratios(all_rows)
    print_ranked_table(ranked, dupes)
