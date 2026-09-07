#!/usr/bin/env python3
"""Phase C descriptive analytics (RANKER_SPEC) — read-only over ml_dataset.

Runs the eight spec'd cuts on the labeled corpus (backtest_* + clean live,
scan_date >= 2026-07-27) and writes the tables to
docs/private/PHASE_C_FINDINGS.md (results stay private; this script is the
public methodology). Interpretation paragraphs are added to the doc by hand.

Usage: python3 scripts/phase_c_analytics.py
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402 — service-role client, env via .env

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                   "docs", "private", "PHASE_C_FINDINGS.md")

BACKTEST = ("backtest_open", "backtest_close")
CLEAN_LIVE_CUTOVER = "2026-07-27"


def fetch_rows():
    cols = ("id,source,scan_date,sector,ticker,expiration,score,net_premium,"
            "spread_width,p_max_profit,leg_a_strike,leg_b_strike,leg_c_strike,"
            "underlying_price_at_scan,vix,days_to_earnings,"
            "earnings_before_expiry,weeks_to_expiration,days_to_expiration,"
            "is_best_in_sector,outcome_type,stock_price_at_expiration,"
            "pnl_per_contract,capture_pct,outcome_filled")
    rows, page = [], 0
    while True:
        r = (_sb().table("ml_dataset").select(cols)
             .eq("outcome_filled", True)
             .range(page * 1000, page * 1000 + 999).execute())
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        page += 1
    keep = [r for r in rows if r["source"] in BACKTEST
            or r["scan_date"] >= CLEAN_LIVE_CUTOVER]
    return keep


def fetch_qualified_map():
    """(source, scan_date, sector) -> setups_qualified from sector_scan_runs."""
    m, page = {}, 0
    while True:
        r = (_sb().table("sector_scan_runs")
             .select("source,scan_date,sector,setups_qualified")
             .range(page * 1000, page * 1000 + 999).execute())
        for x in r.data:
            m[(x["source"], x["scan_date"], x["sector"])] = x["setups_qualified"]
        if len(r.data) < 1000:
            break
        page += 1
    return m


def agg(rs):
    n = len(rs)
    if n == 0:
        return dict(n=0, win=0, pnl=0, avg=0, cap=None)
    pnl = [float(r["pnl_per_contract"]) for r in rs]
    wins = sum(1 for p in pnl if p > 0)
    caps = [float(r["capture_pct"]) for r in rs if r.get("capture_pct") is not None]
    return dict(n=n, win=wins / n * 100, pnl=sum(pnl), avg=sum(pnl) / n,
                cap=(sum(caps) / len(caps) * 100) if caps else None)


def row_line(label, a):
    cap = f"{a['cap']:.1f}%" if a["cap"] is not None else "—"
    return (f"| {label} | {a['n']} | {a['win']:.1f}% | ${a['pnl']:,.0f} | "
            f"${a['avg']:,.0f} | {cap} |")


HEADER = "| Bucket | n | Win rate | Total P&L | Avg P&L | Capture (winners) |\n|---|---|---|---|---|---|"


def main():
    rows = fetch_rows()
    qmap = fetch_qualified_map()
    lines = [
        "# Phase C findings — descriptive analytics on the labeled corpus",
        "",
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
        f"by `scripts/phase_c_analytics.py`. Corpus: {len(rows)} labeled rows "
        f"(backtest_* fully; live at scan_date >= {CLEAN_LIVE_CUTOVER}). "
        f"Dollars are per-contract. Interpretations added by hand below each "
        f"table.",
        "",
    ]

    # 1 — score deciles
    srt = sorted(rows, key=lambda r: float(r["score"]))
    lines += ["## 1. Win rate & capture by score decile", "", HEADER]
    for i in range(10):
        chunk = srt[i * len(srt) // 10:(i + 1) * len(srt) // 10]
        lo, hi = float(chunk[0]["score"]), float(chunk[-1]["score"])
        lines.append(row_line(f"D{i+1} ({lo:.2f}–{hi:.2f})", agg(chunk)))
    lines.append("")

    # 2 — P(profit) calibration: predicted (1-dB)(1-dC) vs realized K_C<S<K_B
    lines += ["## 2. P(profit) calibration (predicted vs realized "
              "K_C < S < K_B)", "",
              "| Predicted bucket | n | Mean predicted | Realized freq | Gap |",
              "|---|---|---|---|---|"]
    buckets = defaultdict(list)
    for r in rows:
        p = float(r["p_max_profit"] or 0)
        buckets[min(int((p - 0.50) / 0.05), 9)].append(r)
    for b in sorted(buckets):
        rs = buckets[b]
        pred = sum(float(r["p_max_profit"]) for r in rs) / len(rs)
        real = sum(1 for r in rs
                   if float(r["leg_c_strike"]) < float(r["stock_price_at_expiration"]) < float(r["leg_b_strike"])) / len(rs)
        lo = 0.50 + 0.05 * b
        lines.append(f"| {lo:.2f}–{lo+0.05:.2f} | {len(rs)} | {pred*100:.1f}% "
                     f"| {real*100:.1f}% | {(real-pred)*100:+.1f}pp |")
    lines.append("")

    # 3 — earnings
    lines += ["## 3. Earnings effect", "", HEADER]
    lines.append(row_line("earnings before expiry",
                          agg([r for r in rows if r["earnings_before_expiry"]])))
    lines.append(row_line("no earnings before expiry",
                          agg([r for r in rows if not r["earnings_before_expiry"]])))
    for label, lo, hi in (("d2e 0–7", 0, 7), ("d2e 8–21", 8, 21),
                          ("d2e 22+", 22, 10**6)):
        rs = [r for r in rows if r["days_to_earnings"] is not None
              and lo <= r["days_to_earnings"] <= hi]
        lines.append(row_line(label, agg(rs)))
    lines.append(row_line("d2e unknown",
                          agg([r for r in rows if r["days_to_earnings"] is None])))
    lines.append("")

    # 4 — VIX regime & slot
    lines += ["## 4. VIX regime & slot", "", HEADER]
    for label, lo, hi in (("VIX <15", 0, 15), ("VIX 15–20", 15, 20),
                          ("VIX 20–25", 20, 25), ("VIX 25+", 25, 999)):
        rs = [r for r in rows if r["vix"] is not None and lo <= float(r["vix"]) < hi]
        lines.append(row_line(label, agg(rs)))
    for sl in ("open", "close"):
        rs = [r for r in rows if r["source"].endswith(sl)]
        a = agg(rs)
        mean_score = sum(float(r["score"]) for r in rs) / len(rs)
        lines.append(row_line(f"slot {sl} (mean score {mean_score:.2f})", a))
    lines.append("")

    # 5 — pick competitiveness
    lines += ["## 5. Pick competitiveness (setups_qualified of the sector-slot)",
              "", HEADER]
    for label, lo, hi in (("qual 1–2", 1, 2), ("qual 3–10", 3, 10),
                          ("qual 11–50", 11, 50), ("qual 51+", 51, 10**9)):
        rs = [r for r in rows
              if (q := qmap.get((r["source"], r["scan_date"], r["sector"]))) is not None
              and lo <= q <= hi]
        lines.append(row_line(label, agg(rs)))
    lines.append("")

    # 6 — concentration
    lines += ["## 6. Ticker / sector concentration of realized P&L", ""]
    by_t, by_s = defaultdict(float), defaultdict(float)
    for r in rows:
        by_t[r["ticker"]] += float(r["pnl_per_contract"])
        by_s[r["sector"]] += float(r["pnl_per_contract"])
    total = sum(by_t.values())
    lines += [f"Total P&L: ${total:,.0f}", "", "| Ticker | P&L | share |",
              "|---|---|---|"]
    ranked = sorted(by_t.items(), key=lambda kv: -kv[1])
    for t, v in ranked[:6] + ranked[-4:]:
        lines.append(f"| {t} | ${v:,.0f} | {v/total*100:.0f}% |")
    lines += ["", "| Sector | P&L | share |", "|---|---|---|"]
    for s, v in sorted(by_s.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {s} | ${v:,.0f} | {v/total*100:.0f}% |")
    lines.append("")

    # 7 — capital-normalized bake-off
    lines += ["## 7. Capital-normalized ranking bake-off", "",
              "| Ranking | top-250 P&L | top-500 P&L | top-1000 P&L | "
              "top-500 ROI/cycle |", "|---|---|---|---|---|"]

    def roc(r):
        coll = float(r["leg_c_strike"]) - float(r["net_premium"])
        return float(r["net_premium"]) / coll if coll > 0 else 0

    for name, key in (("incumbent score", lambda r: float(r["score"])),
                      ("return-on-collateral", roc)):
        rk = sorted(rows, key=key, reverse=True)
        cells = []
        for k in (250, 500, 1000):
            cells.append(f"${sum(float(r['pnl_per_contract']) for r in rk[:k]):,.0f}")
        top = rk[:500]
        coll = sum((float(r["leg_c_strike"]) - float(r["net_premium"])) * 100 for r in top)
        pnl = sum(float(r["pnl_per_contract"]) for r in top)
        lines.append(f"| {name} | {cells[0]} | {cells[1]} | {cells[2]} | "
                     f"{pnl/coll*100:.2f}% |")
    lines.append("")

    # 8 — threshold bias
    lines += ["## 8. Absolute-threshold bias (underlying price at scan)", "",
              HEADER]
    for label, lo, hi in (("< $200", 0, 200), ("$200–500", 200, 500),
                          ("$500–1000", 500, 1000), ("$1000+", 1000, 10**9)):
        rs = [r for r in rows if r["underlying_price_at_scan"] is not None
              and lo <= float(r["underlying_price_at_scan"]) < hi]
        lines.append(row_line(label, agg(rs)))
    lines.append("")

    with open(OUT, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"[phase-c] wrote {OUT} ({len(rows)} rows analyzed)")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
