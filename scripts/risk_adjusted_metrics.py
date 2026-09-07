#!/usr/bin/env python3
"""Portfolio-level risk-adjusted metrics on the v2 corpus (2026-09-07).

Book rule (identical for A, B, and the random baseline): one pick per
sector-slot (slot-#1 by the system's metric; random = seeded uniform pick
from the slot's random slice, falling back to all logged rows where the
slot is small enough to be fully logged), equal-collateral sizing at a
fixed $25k collateral per position (fractional contracts), settle-dated
P&L (lands on expiration date; no intra-position marks).

Capital base per book = PEAK concurrently-deployed collateral (the account
size needed to run that book fully funded, no leverage) — so a system that
holds longer-dated positions is charged for the extra capital it keeps
tied up. Risk-free = mean ^IRX (13-week T-bill) close over the span.
Reported: daily Sharpe (×√252), monthly Sharpe (×√12 — the honest small-n
version), Sortino (MAR = rf), settle-dated max drawdown, worst month,
Calmar. Per-row Sharpe is deliberately NOT computed.
"""
import os
import random as _random
import sys
from collections import defaultdict
from datetime import date, timedelta
from statistics import mean, pstdev

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

EQUAL_COLL = 25_000.0
HOLIDAYS = {"2025-09-01", "2025-11-27", "2025-12-25", "2026-01-01",
            "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
            "2026-06-19", "2026-07-03", "2026-09-07"}


def fetch():
    cols = ("source,scan_date,sector,ticker,score,net_premium,leg_c_strike,"
            "days_to_expiration,expiration,pnl_per_contract")
    rows, page = [], 0
    while True:
        r = (_sb().table("ml_dataset").select(cols)
             .in_("source", ["backtest2_open", "backtest2_close"])
             .eq("outcome_filled", True)
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
        out.append(dict(r, coll=coll, pnl=float(r["pnl_per_contract"]),
                        sc=float(r["score"]),
                        roc=float(r["net_premium"]) /
                        (float(r["leg_c_strike"]) - float(r["net_premium"]))))
    slots = defaultdict(list)
    for r in out:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    for rs in slots.values():
        inc50 = {id(x) for x in sorted(rs, key=lambda r: r["sc"], reverse=True)[:50]}
        roc50 = {id(x) for x in sorted(rs, key=lambda r: r["roc"], reverse=True)[:50]}
        for x in rs:
            x["is_random"] = not (id(x) in inc50 or id(x) in roc50)
    return slots


def risk_free():
    import yfinance as yf
    h = yf.Ticker("^IRX").history(start="2025-08-01", end="2026-08-01")
    rf = float(h["Close"].mean()) / 100.0
    return rf


def trading_days(start, end):
    d, out = start, []
    while d <= end:
        if d.weekday() < 5 and d.isoformat() not in HOLIDAYS:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def metrics(picks, rf, label):
    sized = [(r, EQUAL_COLL / r["coll"]) for r in picks]
    # peak concurrent deployment
    delta = defaultdict(float)
    for r, s in sized:
        delta[r["scan_date"]] += EQUAL_COLL
        delta[r["expiration"]] -= EQUAL_COLL
    dep = peak = 0.0
    for d in sorted(delta):
        dep += delta[d]
        peak = max(peak, dep)
    base = peak

    pnl_by_day = defaultdict(float)
    for r, s in sized:
        pnl_by_day[r["expiration"]] += r["pnl"] * s
    start = min(date.fromisoformat(r["scan_date"]) for r, _ in sized)
    end = max(date.fromisoformat(r["expiration"]) for r, _ in sized)
    days = trading_days(start, end)
    rets = [pnl_by_day.get(d, 0.0) / base for d in days]
    rf_d = rf / 252

    total = sum(r["pnl"] * s for r, s in sized)
    span_years = (end - start).days / 365.0
    ann_ret = total / base / span_years

    ex = [x - rf_d for x in rets]
    sharpe_d = mean(ex) / pstdev(ex) * (252 ** 0.5) if pstdev(ex) else 0
    monthly = defaultdict(float)
    for d, x in zip(days, rets):
        monthly[d[:7]] += x
    mvals = [v for _, v in sorted(monthly.items())]
    rf_m = rf / 12
    exm = [v - rf_m for v in mvals]
    sharpe_m = mean(exm) / pstdev(exm) * (12 ** 0.5) if pstdev(exm) else 0
    downside = [min(0.0, x) for x in ex]
    dd_dev = (sum(x * x for x in downside) / len(ex)) ** 0.5
    sortino = mean(ex) / dd_dev * (252 ** 0.5) if dd_dev else float("inf")
    cum = peak_c = mdd = 0.0
    for x in rets:
        cum += x
        peak_c = max(peak_c, cum)
        mdd = min(mdd, cum - peak_c)
    worst_m, worst_v = min(monthly.items(), key=lambda kv: kv[1])
    calmar = ann_ret / abs(mdd) if mdd else float("inf")
    return (f"| {label} | ${base:,.0f} | {ann_ret*100:.1f}% | {sharpe_d:.2f} | "
            f"{sharpe_m:.2f} | {sortino:.2f} | {mdd*100:.2f}% | "
            f"{worst_m} {worst_v*100:+.2f}% | {calmar:.1f} |")


def main():
    slots = fetch()
    rf = risk_free()
    print(f"risk-free (^IRX mean over span): {rf*100:.2f}%\n")
    print("| Book | Capital base (peak deployed) | Ann. return | Sharpe "
          "(daily×√252) | Sharpe (monthly×√12) | Sortino | Max DD | "
          "Worst month | Calmar |")
    print("|---|---|---|---|---|---|---|---|---|")
    picks_a = [max(rs, key=lambda r: r["sc"]) for rs in slots.values()]
    picks_b = [max(rs, key=lambda r: r["roc"]) for rs in slots.values()]
    rng = _random.Random("risk-adjusted-baseline")
    picks_r = []
    for key in sorted(slots):
        rs = slots[key]
        pool = [r for r in rs if r["is_random"]] or rs
        picks_r.append(rng.choice(pool))
    print(metrics(picks_a, rf, "A (incumbent) slot-#1"))
    print(metrics(picks_b, rf, "B (ROC) slot-#1"))
    print(metrics(picks_r, rf, "Random-qualifier baseline"))


if __name__ == "__main__":
    main()
