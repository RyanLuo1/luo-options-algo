#!/usr/bin/env python3
"""Universe-expansion evaluation (prespecified, single run — 2026-09-12).

Grades the backtest3 corpus (240-name universe) against backtest2 (118)
under the identical corrected harness: per-collateral-day annualized
primary, tail veto, win rate diagnostic. The three pre-registered cuts:
(a) the package on 240 vs on 118, same book construction, side by side;
(b) the 122 additions in isolation; (c) concentration (top-6 P&L share vs
v2's 94%, ex-dominant-names). Plus standard robustness: H1/H2, random
baseline, within-slot top-1. Read-only; prints markdown for
docs/private/PHASE_C_FINDINGS.md.
"""
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

H_SPLIT = "2026-02-01"
_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def scan118():
    with open(os.path.join(_ROOT, "data", "universe.json")) as f:
        return {t for l in json.load(f)["sectors"].values() for t in l}


def fetch(sources):
    cols = ("source,scan_date,sector,ticker,score,net_premium,leg_c_strike,"
            "days_to_expiration,pnl_per_contract")
    rows, page = [], 0
    while True:
        r = (_sb().table("ml_dataset").select(cols)
             .in_("source", sources).eq("outcome_filled", True)
             .range(page * 1000, page * 1000 + 999).execute())
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        page += 1
    out = []
    for r in rows:
        coll = (float(r["leg_c_strike"]) - float(r["net_premium"])) * 100
        days = int(r["days_to_expiration"] or 0)
        if coll <= 0 or days <= 0:
            continue
        out.append(dict(r, coll=coll, days=days,
                        pnl=float(r["pnl_per_contract"]), sc=float(r["score"]),
                        roc=float(r["net_premium"]) /
                        (float(r["leg_c_strike"]) - float(r["net_premium"]))))
    return out


def slot_map(rows):
    slots = defaultdict(list)
    for r in rows:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    return slots


def mark_random(rows):
    for rs in slot_map(rows).values():
        inc50 = {id(x) for x in sorted(rs, key=lambda r: r["sc"], reverse=True)[:50]}
        roc50 = {id(x) for x in sorted(rs, key=lambda r: r["roc"], reverse=True)[:50]}
        for x in rs:
            x["is_random"] = not (id(x) in inc50 or id(x) in roc50)


def stats(rs):
    if not rs:
        return "0 | — | — | — | — | —"
    pnl = sum(r["pnl"] for r in rs)
    ann = pnl / sum(r["coll"] * r["days"] for r in rs) * 365 * 100
    losses = sorted(r["pnl"] for r in rs if r["pnl"] < 0)
    win = sum(1 for r in rs if r["pnl"] > 0) / len(rs) * 100
    pcds = sorted(r["pnl"] / (r["coll"] * r["days"]) * 365 * 100 for r in rs)
    p5 = pcds[max(0, int(len(pcds) * 0.05) - 1)]
    ml = sum(losses) / len(losses) if losses else 0
    return (f"{len(rs)} | {win:.1f}% | ${pnl:,.0f} | {ann:.1f}%/yr | "
            f"{len(losses)} (${ml:,.0f}) | {p5:.0f}%/yr")


HDR = ("| Book | n | Win | Σ P&L | ann. RoC-day | losses (mean) | p5 ann. |"
       "\n|---|---|---|---|---|---|---|")


def book_table(rows, label):
    slots = slot_map(rows)
    print(f"\n### {label}\n\n{HDR}")
    picks_b = [max(rs, key=lambda r: r["roc"]) for rs in slots.values()]
    picks_a = [max(rs, key=lambda r: r["sc"]) for rs in slots.values()]
    rand = [r for r in rows if r.get("is_random")]
    print(f"| B (ROC) slot-#1 | {stats(picks_b)} |")
    print(f"| A (incumbent) slot-#1 | {stats(picks_a)} |")
    print(f"| random qualifiers (all) | {stats(rand)} |")
    return picks_b


def conc(picks, label):
    by_t = defaultdict(float)
    for r in picks:
        by_t[r["ticker"]] += r["pnl"]
    total = sum(by_t.values())
    top6 = sorted(by_t.items(), key=lambda kv: -kv[1])[:6]
    share = sum(v for _, v in top6) / total * 100 if total else 0
    print(f"\n{label}: total ${total:,.0f}; top-6 = "
          f"{[(t, f'${v:,.0f}') for t, v in top6]} = {share:.0f}% of P&L")
    return share


def main():
    v3 = fetch(["backtest3_open", "backtest3_close"])
    v2 = fetch(["backtest2_open", "backtest2_close"])
    mark_random(v3)
    mark_random(v2)
    s118 = scan118()
    print(f"corpora: v3 {len(v3)} labeled rows (240 names), "
          f"v2 {len(v2)} (118 names)\n")

    # (a) package on 240 vs 118
    p3 = book_table(v3, "(a) Package on 240 (backtest3)")
    p2 = book_table(v2, "(a) Package on 118 (backtest2, same harness)")

    # (b) additions in isolation
    adds3 = [r for r in v3 if r["ticker"] not in s118]
    print(f"\n### (b) The 122 additions in isolation\n\n{HDR}")
    print(f"| all addition rows | {stats(adds3)} |")
    add_picks = [r for r in p3 if r["ticker"] not in s118]
    print(f"| additions winning slot-#1 (B book) | {stats(add_picks)} |")
    n_add_tickers = len({r['ticker'] for r in adds3})
    print(f"\nadditions producing ≥1 qualifying setup: {n_add_tickers}/120; "
          f"share of B-book picks: {len(add_picks)}/{len(p3)} "
          f"({len(add_picks)/len(p3)*100:.0f}%)")
    print("top addition contributors (all rows):",
          Counter(r["ticker"] for r in adds3).most_common(8))
    by_t = defaultdict(float)
    for r in adds3:
        by_t[r["ticker"]] += r["pnl"]
    print("top addition P&L:", [(t, f"${v:,.0f}") for t, v in
                                sorted(by_t.items(), key=lambda kv: -kv[1])[:6]])

    # (c) concentration
    print("\n### (c) Concentration (B slot-#1 books)")
    s3 = conc(p3, "240 universe")
    s2 = conc(p2, "118 universe (v2)")
    ex3 = [r for r in p3 if r["ticker"] not in ("MU", "SNDK")]
    ex2 = [r for r in p2 if r["ticker"] not in ("MU", "SNDK")]
    print(f"\nex-MU/SNDK B book: 240 → {stats(ex3)}")
    print(f"ex-MU/SNDK B book: 118 → {stats(ex2)}")

    # robustness: halves + within-slot (B book, 240)
    print(f"\n### Robustness (B slot-#1 on 240)\n\n{HDR}")
    for half, cond in (("H1", lambda r: r["scan_date"] < H_SPLIT),
                       ("H2", lambda r: r["scan_date"] >= H_SPLIT)):
        h = [r for r in v3 if cond(r)]
        picks = [max(rs, key=lambda r: r["roc"]) for rs in slot_map(h).values()]
        print(f"| {half} | {stats(picks)} |")
    print(f"\ntop-6 share summary: 240 = {s3:.0f}% vs 118 = {s2:.0f}%")


if __name__ == "__main__":
    main()
