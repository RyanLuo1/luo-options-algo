#!/usr/bin/env python3
"""Portfolio-construction cut (Phase E prep): per-ticker exposure caps and
equal-collateral sizing on the v1 labeled best-in-sector book.

Book = is_best_in_sector rows of backtest_open/close (the deployable signal:
one pick per sector-slot). Positions open at scan_date, realize at
expiration (no intramonth marks — drawdown/worst-month are therefore
COARSE, settlement-dated; stated in the output). Policies: per-ticker cap
on concurrently-open positions (∞/1/2/3) × sizing (1 contract vs equal
collateral of $25k/position, fractional contracts). Read-only.
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

EQUAL_COLL = 25_000.0


def fetch():
    rows, page = [], 0
    while True:
        r = (_sb().table("ml_dataset")
             .select("scan_date,expiration,ticker,net_premium,leg_c_strike,"
                     "days_to_expiration,pnl_per_contract")
             .in_("source", ["backtest_open", "backtest_close"])
             .eq("outcome_filled", True).eq("is_best_in_sector", True)
             .range(page * 1000, page * 1000 + 999).execute())
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        page += 1
    out = []
    for r in rows:
        coll = (float(r["leg_c_strike"]) - float(r["net_premium"])) * 100
        if coll <= 0 or not r["days_to_expiration"]:
            continue
        out.append(dict(r, coll=coll, pnl=float(r["pnl_per_contract"])))
    return sorted(out, key=lambda r: (r["scan_date"], r["ticker"]))


def simulate(rows, cap, equal_coll):
    """Chronological pass; a position is open scan_date..expiration."""
    open_by_ticker = defaultdict(list)   # ticker -> [expiration,...]
    taken = []
    for r in rows:
        opens = open_by_ticker[r["ticker"]]
        opens[:] = [e for e in opens if e >= r["scan_date"]]
        if cap is not None and len(opens) >= cap:
            continue
        opens.append(r["expiration"])
        size = (EQUAL_COLL / r["coll"]) if equal_coll else 1.0
        taken.append((r, size))

    total = sum(r["pnl"] * s for r, s in taken)
    ex = sum(r["pnl"] * s for r, s in taken
             if r["ticker"] not in ("MU", "SNDK"))
    cd = sum(r["coll"] * s * int(r["days_to_expiration"]) for r, s in taken)
    ann = total / cd * 365 * 100 if cd else 0

    # settlement-dated cumulative curve → max drawdown + worst month
    by_day = defaultdict(float)
    for r, s in taken:
        by_day[r["expiration"]] += r["pnl"] * s
    cum = peak = dd = 0.0
    by_month = defaultdict(float)
    for d in sorted(by_day):
        cum += by_day[d]
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
        by_month[d[:7]] += by_day[d]
    worst_m, worst_v = min(by_month.items(), key=lambda kv: kv[1])
    return (f"| {'∞' if cap is None else cap} | "
            f"{'equal-$25k' if equal_coll else '1 contract'} | {len(taken)} | "
            f"${total:,.0f} | {ann:.1f}%/yr | ${dd:,.0f} | "
            f"{worst_m} ${worst_v:,.0f} | ${ex:,.0f} ({ex/total*100:.0f}%) |")


def main():
    rows = fetch()
    print(f"book: {len(rows)} best-in-sector labeled rows "
          f"({rows[0]['scan_date']}..{rows[-1]['scan_date']})\n")
    print("| Cap/ticker | Sizing | Positions | Total P&L | ann. RoC-day | "
          "Max DD (settle-dated) | Worst month | P&L ex-MU/SNDK |")
    print("|---|---|---|---|---|---|---|---|")
    for equal in (False, True):
        for cap in (None, 3, 2, 1):
            print(simulate(rows, cap, equal))
    print("\nNOTE: P&L realizes at expiration (no intramonth marks) — "
          "drawdown and worst-month are settlement-dated approximations, "
          "biased mild. Equal-collateral = $25k collateral per position, "
          "fractional contracts.")


if __name__ == "__main__":
    main()
