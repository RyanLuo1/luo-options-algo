#!/usr/bin/env python3
"""v2 replay evaluation (RANKER_SPEC §5b item-3) — read-only.

On the backtest2 corpus (deep-slice logging: per sector-slot top-50 by
incumbent ∪ top-50 by ROC ∪ 20 random), per-collateral-day + tail
throughout: (a) TRUE top-k of each ranking; (b) the random-slice
calibration (either ranking vs chance); (c) the distrust triggers
(ex-MU/SNDK, H1/H2, within-ticker); (d) the universe effect (what the
dual gate admitted that the $5 bar excluded). Prints markdown for
docs/private/PHASE_C_FINDINGS.md. Slot-membership flags are DERIVED by
re-ranking each sector-slot's logged rows (exact by construction).
"""
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

H_SPLIT = "2026-02-01"
K = 500


def fetch():
    cols = ("source,scan_date,sector,ticker,score,net_premium,leg_c_strike,"
            "days_to_expiration,pnl_per_contract")
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
        days = int(r["days_to_expiration"] or 0)
        if coll <= 0 or days <= 0:
            continue
        out.append(dict(r, coll=coll, days=days,
                        pnl=float(r["pnl_per_contract"]), sc=float(r["score"]),
                        roc=float(r["net_premium"]) /
                        (float(r["leg_c_strike"]) - float(r["net_premium"]))))
    # derive slot membership
    slots = defaultdict(list)
    for r in out:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    for rs in slots.values():
        inc50 = set(id(x) for x in sorted(rs, key=lambda r: r["sc"], reverse=True)[:50])
        roc50 = set(id(x) for x in sorted(rs, key=lambda r: r["roc"], reverse=True)[:50])
        for x in rs:
            x["in_inc50"] = id(x) in inc50
            x["in_roc50"] = id(x) in roc50
            x["is_random"] = not (id(x) in inc50 or id(x) in roc50)
    return out


def stats(rs, worst_ids=frozenset()):
    if not rs:
        return "— | — | — | — | — | —"
    pnl = sum(r["pnl"] for r in rs)
    ann = pnl / sum(r["coll"] * r["days"] for r in rs) * 365 * 100
    losses = [r["pnl"] for r in rs if r["pnl"] < 0]
    win = sum(1 for r in rs if r["pnl"] > 0) / len(rs) * 100
    w = sum(1 for r in rs if id(r) in worst_ids)
    return (f"{len(rs)} | {win:.1f}% | ${pnl:,.0f} | {ann:.1f}%/yr | "
            f"{len(losses)} (${(sum(losses)/len(losses)) if losses else 0:,.0f}) | {w}")


HDR = ("| Set | n | Win | Σ P&L | ann. RoC-day | losses (mean) | worst-100 |"
       "\n|---|---|---|---|---|---|---|")


def main():
    rows = fetch()
    worst_ids = {id(r) for r in sorted(rows, key=lambda r: r["pnl"])[:100]}
    print(f"v2 labeled corpus: {len(rows)} rows\n")

    print(f"### (a) True top-{K} of each ranking (global)\n\n{HDR}")
    for name, key in (("incumbent true top", lambda r: r["sc"]),
                      ("ROC true top", lambda r: r["roc"])):
        print(f"| {name} | {stats(sorted(rows, key=key, reverse=True)[:K], worst_ids)} |")

    print(f"\n### (b) Random-slice calibration (chance baseline)\n\n{HDR}")
    print(f"| random qualifiers | {stats([r for r in rows if r['is_random']], worst_ids)} |")
    print(f"| slot inc-top-50 | {stats([r for r in rows if r['in_inc50']], worst_ids)} |")
    print(f"| slot roc-top-50 | {stats([r for r in rows if r['in_roc50']], worst_ids)} |")
    slots = defaultdict(list)
    for r in rows:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    for name, key in (("slot inc-#1", lambda r: r["sc"]),
                      ("slot roc-#1", lambda r: r["roc"])):
        print(f"| {name} | {stats([max(rs, key=key) for rs in slots.values()], worst_ids)} |")

    print(f"\n### (c) Distrust triggers on the unbiased corpus\n\n{HDR}")
    ex = [r for r in rows if r["ticker"] not in ("MU", "SNDK")]
    for name, key in (("ex-MU/SNDK inc top", lambda r: r["sc"]),
                      ("ex-MU/SNDK roc top", lambda r: r["roc"])):
        print(f"| {name} | {stats(sorted(ex, key=key, reverse=True)[:K], worst_ids)} |")
    for half, cond in (("H1", lambda r: r["scan_date"] < H_SPLIT),
                       ("H2", lambda r: r["scan_date"] >= H_SPLIT)):
        h = [r for r in rows if cond(r)]
        for name, key in ((f"{half} inc top-250", lambda r: r["sc"]),
                          (f"{half} roc top-250", lambda r: r["roc"])):
            print(f"| {name} | {stats(sorted(h, key=key, reverse=True)[:250], worst_ids)} |")
    wins = tot = 0
    for t, n in Counter(r["ticker"] for r in rows).most_common():
        if n < 400:
            continue
        rs = [r for r in rows if r["ticker"] == t]
        q = n // 4
        a = sorted(rs, key=lambda r: r["sc"], reverse=True)[:q]
        b = sorted(rs, key=lambda r: r["roc"], reverse=True)[:q]
        f = lambda s: sum(r["pnl"] for r in s) / sum(r["coll"] * r["days"] for r in s)
        wins += f(b) > f(a)
        tot += 1
    print(f"\nwithin-ticker (top quartile, names ≥400 rows): ROC better {wins}/{tot}")

    print(f"\n### (d) Universe effect — what the dual gate admitted\n\n{HDR}")
    print(f"| new admits (credit < $5) | {stats([r for r in rows if r['net_premium'] < 5.0], worst_ids)} |")
    print(f"| old universe (credit ≥ $5) | {stats([r for r in rows if r['net_premium'] >= 5.0], worst_ids)} |")
    v1_tickers = {"MU","SNDK","TSLA","LLY","GEV","AVGO","META","APP","ORCL","MSFT",
                  "GS","CAT","AMD","NFLX","CRWD","COST","DELL","WDC","NOW","KLAC","BKNG","SPGI"}
    newt = [r for r in rows if r["ticker"] not in v1_tickers]
    print(f"| rows on tickers new to the corpus | {stats(newt, worst_ids)} |")
    print("new-name tickers by rows:", Counter(r["ticker"] for r in newt).most_common(8))


if __name__ == "__main__":
    main()
