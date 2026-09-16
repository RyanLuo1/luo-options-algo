#!/usr/bin/env python3
"""Probability-gate evaluation (prespecified single run — pre-reg 2026-09-16).

backtest5 = production income, min_p_profit=0. Three gate policies as
eval-time cuts of the ONE ungated corpus:
  product : p_max_profit ≥ 0.50   ((1−δ_B)(1−δ_C) — production's formula)
  none    : all rows
  exact   : 1 − δ_B − δ_C ≥ 0.50  (linear proxy for P(K_C < S < K_B))
Both rankings (incumbent score, ROC) × three policies, per-collateral-day
primary, tail veto (loss count/mean, p5, worst-100, put-assignment share),
credit distribution at the top of book, ex-MU/SNDK, H1/H2. Read-only.
"""
import os
import sys
from collections import defaultdict
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

H_SPLIT = "2026-02-01"


def fetch():
    cols = ("source,scan_date,sector,ticker,score,net_premium,leg_c_strike,"
            "leg_b_delta,leg_c_delta,p_max_profit,days_to_expiration,"
            "pnl_per_contract,outcome_type")
    rows, page = [], 0
    while True:
        r = (_sb().table("ml_dataset").select(cols)
             .in_("source", ["backtest5_open", "backtest5_close"])
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
    return out


POLICIES = (
    ("product ≥ 0.50 (production)",
     lambda r: float(r["p_max_profit"] or 0) >= 0.50),
    ("none (ungated)", lambda r: True),
    ("exact ≥ 0.50",
     lambda r: 1 - float(r["leg_b_delta"]) - float(r["leg_c_delta"]) >= 0.50),
)
RANKS = (("incumbent", lambda r: r["sc"]), ("ROC", lambda r: r["roc"]))


def slot_map(rows):
    slots = defaultdict(list)
    for r in rows:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    return slots


def stats(picks, worst_ids):
    pnl = sum(r["pnl"] for r in picks)
    ann = pnl / sum(r["coll"] * r["days"] for r in picks) * 365 * 100
    losses = sorted(r["pnl"] for r in picks if r["pnl"] < 0)
    win = sum(1 for r in picks if r["pnl"] > 0) / len(picks) * 100
    pcds = sorted(r["pnl"] / (r["coll"] * r["days"]) * 365 * 100 for r in picks)
    p5 = pcds[max(0, int(len(pcds) * 0.05) - 1)]
    put_share = sum(1 for r in picks if r["outcome_type"] == "expired_loss") / len(picks) * 100
    med_credit = median(float(r["net_premium"]) for r in picks)
    w = sum(1 for r in picks if id(r) in worst_ids)
    ml = sum(losses) / len(losses) if losses else 0
    return (f"{len(picks)} | {med_credit:.2f} | {win:.1f}% | ${pnl:,.0f} | "
            f"{ann:.1f}%/yr | {put_share:.1f}% | {len(losses)} (${ml:,.0f}) | "
            f"{p5:.0f}%/yr | {w}")


HDR = ("| Policy × ranking | n | med credit | Win | Σ P&L | ann. RoC-day | "
       "loss-zone share | losses (mean) | p5 | worst-100 |"
       "\n|---|---|---|---|---|---|---|---|---|---|")


def table(rows, worst_ids, label):
    print(f"\n### {label}\n\n{HDR}")
    for pname, pfn in POLICIES:
        kept = [r for r in rows if pfn(r)]
        slots = slot_map(kept)
        for rname, rfn in RANKS:
            picks = [max(rs, key=rfn) for rs in slots.values()]
            print(f"| {pname} × {rname} | {stats(picks, worst_ids)} |")


def main():
    rows = fetch()
    worst_ids = {id(r) for r in sorted(rows, key=lambda r: r["pnl"])[:100]}
    n_prod = sum(1 for r in rows if POLICIES[0][1](r))
    n_exact = sum(1 for r in rows if POLICIES[2][1](r))
    print(f"ungated corpus: {len(rows)} labeled rows | pass product-gate: "
          f"{n_prod} ({n_prod/len(rows)*100:.0f}%) | pass exact-gate: "
          f"{n_exact} ({n_exact/len(rows)*100:.0f}%)")
    table(rows, worst_ids, "Full corpus (slot-#1 books)")
    table([r for r in rows if r["ticker"] not in ("MU", "SNDK")],
          worst_ids, "ex-MU/SNDK")
    for half, cond in (("H1", lambda r: r["scan_date"] < H_SPLIT),
                       ("H2", lambda r: r["scan_date"] >= H_SPLIT)):
        table([r for r in rows if cond(r)], worst_ids, f"Half — {half}")


if __name__ == "__main__":
    main()
