from options_screener import fetch_all_rows
from datetime import datetime


def calculate_ratios(all_rows):
    ranked = []

    for r in all_rows:
        price = r["Price"]

        # --- Call ---
        call_delta = r.get("Call Delta")
        if r["Call Premium"] is not None and r["Call Actual"] is not None and call_delta and call_delta >= 0.01:
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
        if r["Put Premium"] is not None and r["Put Actual"] is not None and put_delta and put_delta >= 0.01:
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
    return ranked


def print_ranked_table(ranked_rows):
    print(f"\n{'=' * 100}")
    print("  RANKED OPTIONS — Luo Capital")
    print(f"  Algorithm: V2 — Delta Adjusted")
    print(f"  Run Date: {datetime.today().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'=' * 100}")

    header = (
        f"  {'Rank':>4}  {'Ticker':<6} {'Side':<5} {'Expiration':<12} {'Wk':<4} "
        f"{'Dist':>5}  {'Delta':>7}  {'Strike':>10} {'Premium':>9} {'Stock Price':>11} {'Ratio':>10}"
    )
    print(header)
    print(f"  {'-' * 94}")

    for i, r in enumerate(ranked_rows, start=1):
        wk = r["Week"].replace("Week ", "W")
        print(
            f"  {i:>4}  {r['Ticker']:<6} {r['Side']:<5} {r['Expiration']:<12} {wk:<4} "
            f"{r['Dist %']:>5}  {r['Delta']:>7.4f}  {r['Strike']:>10.2f} ${r['Premium']:>8.4f} "
            f"${r['Price']:>10.2f} {r['Ratio']:>10.6f}"
        )

    print(f"  {'-' * 94}")
    print(f"  {len(ranked_rows)} data points ranked.\n")


if __name__ == "__main__":
    print("Fetching options data (silent)...")
    all_rows = fetch_all_rows(verbose=False)
    ranked = calculate_ratios(all_rows)
    print_ranked_table(ranked)
