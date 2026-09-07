#!/usr/bin/env python3
"""Blend candidate — PRESPECIFIED, SINGLE RUN (2026-09-07). Read-only.

Definition (fixed before results were seen): per sector-slot, Stage 1
ranks underlyings by their max achievable return-on-collateral among the
slot's qualifying setups and chooses the top underlying; Stage 2 selects
that underlying's setup by incumbent score (credit/spread-width). No
weights, no parameters. Note the structural identity: Stage 1's ticker is
B's slot-#1 ticker by construction, so the blend differs from B only in
WHICH setup of that ticker it takes (score-best vs ROC-best geometry).

Prediction on record before running: modest improvement plausible
(20-24%/yr), real probability of indistinguishable-from-B.

Decision rule, prestated: joins the live shadow ONLY if it beats B's
slot-#1 on per-collateral-day AND passes the tail veto; otherwise B
stands alone and this dataset gets no further blend variants.
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

H_SPLIT = "2026-02-01"


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
    return out


def blend_pick(rs):
    """Stage 1: ticker of the slot's max-ROC setup. Stage 2: that ticker's
    max-score setup."""
    t = max(rs, key=lambda r: r["roc"])["ticker"]
    return max((r for r in rs if r["ticker"] == t), key=lambda r: r["sc"])


def stats(picks, worst_ids):
    pnl = sum(r["pnl"] for r in picks)
    ann = pnl / sum(r["coll"] * r["days"] for r in picks) * 365 * 100
    losses = sorted(r["pnl"] for r in picks if r["pnl"] < 0)
    win = sum(1 for r in picks if r["pnl"] > 0) / len(picks) * 100
    pcds = sorted(r["pnl"] / (r["coll"] * r["days"]) * 365 * 100 for r in picks)
    p5 = pcds[max(0, int(len(pcds) * 0.05) - 1)]
    w = sum(1 for r in picks if id(r) in worst_ids)
    return (f"{len(picks)} | {win:.1f}% | ${pnl:,.0f} | {ann:.1f}%/yr | "
            f"{len(losses)} (${sum(losses)/len(losses):,.0f}) | {p5:.0f}%/yr | {w}")


HDR = ("| Picker | n | Win | Σ P&L | ann. RoC-day | losses (mean) | p5 ann. | "
       "worst-100 |\n|---|---|---|---|---|---|---|---|")


def slot_map(rows):
    slots = defaultdict(list)
    for r in rows:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    return slots


PICKERS = (
    ("A slot-#1 (incumbent)", lambda rs: max(rs, key=lambda r: r["sc"])),
    ("B slot-#1 (ROC)", lambda rs: max(rs, key=lambda r: r["roc"])),
    ("BLEND (B ticker → A setup)", blend_pick),
)


def table(rows, worst_ids, label):
    print(f"\n### {label}\n\n{HDR}")
    slots = slot_map(rows)
    for name, pk in PICKERS:
        print(f"| {name} | {stats([pk(rs) for rs in slots.values()], worst_ids)} |")


def main():
    rows = fetch()
    worst_ids = {id(r) for r in sorted(rows, key=lambda r: r["pnl"])[:100]}
    print(f"corpus: {len(rows)} labeled v2 rows; "
          f"random-qualifier baseline: 7.9%/yr (see v2 evaluation)\n")
    table(rows, worst_ids, "Full corpus, one pick per sector-slot")
    ex = [r for r in rows if r["ticker"] not in ("MU", "SNDK")]
    table(ex, worst_ids, "ex-MU/SNDK (slots re-picked without them)")
    for half, cond in (("H1 (2025-08 → 2026-01)", lambda r: r["scan_date"] < H_SPLIT),
                       ("H2 (2026-02 → 2026-07)", lambda r: r["scan_date"] >= H_SPLIT)):
        table([r for r in rows if cond(r)], worst_ids, f"Half split — {half}")

    # Structural tension: blend vs B within the same ticker
    slots = slot_map(rows)
    same = diff = 0
    roc_forfeit = []
    pnl_delta = 0.0
    for rs in slots.values():
        b = max(rs, key=lambda r: r["roc"])
        bl = blend_pick(rs)
        if bl is b:
            same += 1
        else:
            diff += 1
            roc_forfeit.append(bl["roc"] / b["roc"])
            pnl_delta += bl["pnl"] - b["pnl"]
    roc_forfeit.sort()
    n = len(roc_forfeit)
    print(f"\n### Structural tension (blend vs B, same ticker by construction)")
    print(f"- identical pick: {same}/{same+diff} slots; different setup: {diff}")
    if n:
        print(f"- when different, blend's ROC as a fraction of the slot max: "
              f"median {roc_forfeit[n//2]:.2f}, p10 {roc_forfeit[n//10]:.2f} "
              f"(sharp disagreement = low fraction)")
        print(f"- total P&L cost of taking A-geometry over B-geometry in "
              f"those slots: ${pnl_delta:,.0f}")


if __name__ == "__main__":
    main()
