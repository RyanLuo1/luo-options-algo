#!/usr/bin/env python3
"""Corrected ROC-vs-incumbent bake-off (Phase C follow-up, 2026-09-06).

Primary unit: per-collateral-day — pnl / (collateral × days-held),
annualized (×365) for readability; aggregates are Σpnl / Σ(coll·days) ×365.
The original bake-off's per-cycle ROI flattered ROC's 60d-vs-24d duration
skew. Tail metrics ride alongside every table.

Views: (a) full corpus; (b) ex-MU/ex-SNDK; (c) within-ticker re-ranking;
plus the within-slot top-1 test and an H1/H2 half-year split. Read-only on
the DB; prints markdown tables for docs/private/PHASE_C_FINDINGS.md.

Also characterizes the crash-bait mechanism (worst-100 credit/spot
richness vs the name's own point-in-time history; 20-day drawdown at scan,
built from the corpus's own scan prices) and sweeps the two candidate
guards, reporting the tradeoff curve.
"""
import os
import sys
from collections import Counter, defaultdict
from statistics import median

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402

K = 500          # top-k for full/ex views
H_SPLIT = "2026-02-01"


def fetch():
    cols = ("source,scan_date,ticker,score,net_premium,leg_c_strike,"
            "days_to_expiration,underlying_price_at_scan,pnl_per_contract")
    rows, page = [], 0
    while True:
        r = (_sb().table("ml_dataset").select(cols)
             .in_("source", ["backtest_open", "backtest_close"])
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
        out.append(dict(
            r, coll=coll, days=days, pnl=float(r["pnl_per_contract"]),
            roc=float(r["net_premium"]) / (float(r["leg_c_strike"]) - float(r["net_premium"])),
            sc=float(r["score"]),
            cs=(float(r["net_premium"]) / float(r["underlying_price_at_scan"]))
            if r.get("underlying_price_at_scan") else None,
        ))
    return out


def band(days):
    return "W1-2" if days <= 14 else ("W3-6" if days <= 45 else "W7-12")


def stats(top, worst_ids):
    pnl = sum(r["pnl"] for r in top)
    cd = sum(r["coll"] * r["days"] for r in top)
    ann = pnl / cd * 365 * 100
    losses = [r["pnl"] for r in top if r["pnl"] < 0]
    pcds = sorted(r["pnl"] / (r["coll"] * r["days"]) * 365 * 100 for r in top)
    p5 = pcds[max(0, int(len(pcds) * 0.05) - 1)] if pcds else 0
    w100 = sum(1 for r in top if id(r) in worst_ids)
    return (f"${pnl:,.0f} | {ann:.1f}%/yr | {len(losses)} | "
            f"${(sum(losses)/len(losses)) if losses else 0:,.0f} | "
            f"{p5:.0f}%/yr | {w100}")


HDR = ("| Ranking | Σ P&L | ann. RoC-day | losses | mean loss | p5 ann. "
       "| worst-100 in set |\n|---|---|---|---|---|---|---|")


def view(rows, worst_ids, label, k=K):
    print(f"\n### {label} (top-{k} of {len(rows)} rows)\n\n{HDR}")
    for name, key in (("incumbent", lambda r: r["sc"]),
                      ("ROC", lambda r: r["roc"])):
        top = sorted(rows, key=key, reverse=True)[:k]
        print(f"| {name} | {stats(top, worst_ids)} |")


def main():
    rows = fetch()
    worst = sorted(rows, key=lambda r: r["pnl"])[:100]
    worst_ids = {id(r) for r in worst}
    print(f"corpus: {len(rows)} labeled backtest rows\n")

    # (a) full
    view(rows, worst_ids, "(a) Full corpus")
    # (b) ex-MU/SNDK
    ex = [r for r in rows if r["ticker"] not in ("MU", "SNDK")]
    view(ex, worst_ids, "(b) ex-MU, ex-SNDK")

    # (c) within-ticker: top quartile of each name's setups by each ranking
    print("\n### (c) Within-ticker re-ranking (top quartile per name, "
          "names with ≥100 rows)\n")
    print("| Ticker | n | incumbent ann. | ROC ann. | ROC better? |")
    print("|---|---|---|---|---|")
    wins = tot = 0
    for t, n in Counter(r["ticker"] for r in rows).most_common():
        if n < 100:
            continue
        rs = [r for r in rows if r["ticker"] == t]
        q = max(10, n // 4)
        outs = []
        for key in (lambda r: r["sc"], lambda r: r["roc"]):
            top = sorted(rs, key=key, reverse=True)[:q]
            outs.append(sum(r["pnl"] for r in top) /
                        sum(r["coll"] * r["days"] for r in top) * 365 * 100)
        better = outs[1] > outs[0]
        wins += better
        tot += 1
        print(f"| {t} | {n} | {outs[0]:.1f}%/yr | {outs[1]:.1f}%/yr | "
              f"{'YES' if better else 'no'} |")
    print(f"\nROC better within-ticker: {wins}/{tot} names")

    # within-slot top-1 under the fixed metric
    slots = defaultdict(list)
    for r in rows:
        slots[(r["scan_date"], r["source"])].append(r)
    print("\n### Within-slot top-1 (fixed metric)\n\n"
          "| Ranking | Σ P&L | ann. RoC-day | losses | mean loss |")
    print("|---|---|---|---|---|")
    for name, key in (("incumbent", lambda r: r["sc"]),
                      ("ROC", lambda r: r["roc"])):
        picks = [max(rs, key=key) for rs in slots.values()]
        pnl = sum(r["pnl"] for r in picks)
        ann = pnl / sum(r["coll"] * r["days"] for r in picks) * 365 * 100
        losses = [r["pnl"] for r in picks if r["pnl"] < 0]
        print(f"| {name} | ${pnl:,.0f} | {ann:.1f}%/yr | {len(losses)} | "
              f"${sum(losses)/len(losses):,.0f} |")

    # half-year split
    for label, cond in (("H1 (2025-08 → 2026-01)", lambda r: r["scan_date"] < H_SPLIT),
                        ("H2 (2026-02 → 2026-07)", lambda r: r["scan_date"] >= H_SPLIT)):
        view([r for r in rows if cond(r)], worst_ids, f"Half split — {label}", k=250)

    # ── crash-bait characterization ─────────────────────────────────────────
    print("\n## Crash-bait characterization\n")
    # point-in-time per-name credit/spot history by DTE band (corpus-internal)
    hist = defaultdict(list)   # (ticker, band) -> [(scan_date, cs)]
    for r in sorted(rows, key=lambda r: r["scan_date"]):
        if r["cs"]:
            hist[(r["ticker"], band(r["days"]))].append((r["scan_date"], r["cs"]))

    def richness(r):
        h = [cs for d, cs in hist[(r["ticker"], band(r["days"]))]
             if d < r["scan_date"]]
        if len(h) < 10 or not r["cs"]:
            return None
        return r["cs"] / median(h)

    # 20d drawdown from corpus scan prices
    px = defaultdict(dict)
    for r in rows:
        if r.get("underlying_price_at_scan"):
            px[r["ticker"]][r["scan_date"]] = float(r["underlying_price_at_scan"])
    series = {t: sorted(d.items()) for t, d in px.items()}

    def drawdown20(r):
        s = series[r["ticker"]]
        prior = [p for d, p in s if d <= r["scan_date"]][-20:]
        if len(prior) < 5:
            return None
        return float(r["underlying_price_at_scan"]) / max(prior) - 1

    for r in rows:
        r["rich"] = richness(r)
        r["dd"] = drawdown20(r)

    w_rich = [r["rich"] for r in worst if r["rich"] is not None]
    a_rich = [r["rich"] for r in rows if r["rich"] is not None]
    w_dd = [r["dd"] for r in worst if r["dd"] is not None]
    a_dd = [r["dd"] for r in rows if r["dd"] is not None]
    print(f"credit/spot richness (vs own PIT median, same DTE band): "
          f"worst-100 median {median(w_rich):.2f}× vs corpus {median(a_rich):.2f}×")
    print(f"20d drawdown at scan: worst-100 median {median(w_dd)*100:.1f}% "
          f"vs corpus {median(a_dd)*100:.1f}%")

    # guard sweeps
    def guard_table(name, param_grid, excluded_fn):
        print(f"\n### Guard: {name}\n\n"
              "| Threshold | worst-100 excluded | winning P&L forfeited | "
              "ROC top-500 Σ P&L | ann. RoC-day | losses | mean loss |")
        print("|---|---|---|---|---|---|---|")
        for p in param_grid:
            excl = {id(r) for r in rows if excluded_fn(r, p)}
            kept = [r for r in rows if id(r) not in excl]
            w_excl = sum(1 for r in worst if id(r) in excl)
            forfeit = sum(r["pnl"] for r in rows if id(r) in excl and r["pnl"] > 0)
            top = sorted(kept, key=lambda r: r["roc"], reverse=True)[:K]
            pnl = sum(r["pnl"] for r in top)
            ann = pnl / sum(r["coll"] * r["days"] for r in top) * 365 * 100
            losses = [r["pnl"] for r in top if r["pnl"] < 0]
            print(f"| {p} | {w_excl}/100 | ${forfeit:,.0f} | ${pnl:,.0f} | "
                  f"{ann:.1f}%/yr | {len(losses)} | "
                  f"${(sum(losses)/len(losses)) if losses else 0:,.0f} |")

    guard_table("credit/spot cap at m× own PIT median",
                (1.25, 1.5, 1.75, 2.0, 2.5),
                lambda r, m: r["rich"] is not None and r["rich"] > m)
    guard_table("20d-drawdown veto (exclude if drawdown worse than)",
                (-0.05, -0.10, -0.15, -0.20),
                lambda r, d: r["dd"] is not None and r["dd"] < d)


if __name__ == "__main__":
    main()
