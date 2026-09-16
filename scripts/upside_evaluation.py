#!/usr/bin/env python3
"""Upside-variant evaluation (prespecified single run — pre-reg 2026-09-15).

backtest4 corpus: three rankings — (1) max-profit/collateral, (2)
delta-EV (10%·K_C breach pin), (3) +1σ-implied-move payoff/collateral —
vs the random slice, per-collateral-day primary, tail veto, win rate
diagnostic, ex-MU/SNDK, H1/H2; and the same-collateral same-dates
comparison against the income v2 book. Rankings recomputed exactly from
stored columns (σ via lib/bs from leg A's stored ask). Read-only.
"""
import os
import sys
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from extract_claims import _sb  # noqa: E402
from lib.bs import implied_vol  # noqa: E402

H_SPLIT = "2026-02-01"
EV_BREACH = 0.10


def fetch(sources):
    cols = ("source,scan_date,sector,ticker,net_premium,leg_a_strike,"
            "leg_b_strike,leg_c_strike,leg_a_prem,leg_a_delta,leg_b_delta,"
            "leg_c_delta,underlying_price_at_scan,days_to_expiration,"
            "pnl_per_contract,score,outcome_type")
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
                        pnl=float(r["pnl_per_contract"])))
    return out


def r1(t):  # max-profit / collateral
    c = float(t["leg_c_strike"]) - float(t["net_premium"])
    return ((float(t["net_premium"]) + float(t["leg_b_strike"])
             - float(t["leg_a_strike"])) / c) if c > 0 else 0


def r2(t):  # delta-EV
    w = float(t["leg_b_strike"]) - float(t["leg_a_strike"])
    dA, dB, dC = (float(t["leg_a_delta"]), float(t["leg_b_delta"]),
                  float(t["leg_c_delta"]))
    return (float(t["net_premium"]) + dB * w + max(0.0, dA - dB) * w / 2
            - dC * EV_BREACH * float(t["leg_c_strike"]))


def r3(t):  # +1σ payoff / collateral
    spot = t.get("underlying_price_at_scan")
    prem = t.get("leg_a_prem")
    T = t["days"] / 365.0
    if not spot or not prem or T <= 0:
        return float("-inf")
    sigma = implied_vol("call", float(prem), float(spot),
                        float(t["leg_a_strike"]), T)
    if not sigma:
        return float("-inf")
    tgt = float(spot) * (1 + sigma * (T ** 0.5))
    ka, kb, kc = (float(t["leg_a_strike"]), float(t["leg_b_strike"]),
                  float(t["leg_c_strike"]))
    credit = float(t["net_premium"])
    pay = credit + max(0, tgt - ka) - max(0, tgt - kb) - max(0, kc - tgt)
    c = kc - credit
    return pay / c if c > 0 else float("-inf")


RANKINGS = (("(1) max/coll", r1), ("(2) delta-EV", r2), ("(3) +1σ payoff", r3))


def slot_map(rows):
    slots = defaultdict(list)
    for r in rows:
        slots[(r["source"], r["scan_date"], r["sector"])].append(r)
    return slots


def mark_random(rows):
    for rs in slot_map(rows).values():
        tops = set()
        for _, fn in RANKINGS:
            tops |= {id(x) for x in sorted(rs, key=fn, reverse=True)[:50]}
        for x in rs:
            x["is_random"] = id(x) not in tops


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


def books(rows, label, k_slot1=True):
    slots = slot_map(rows)
    print(f"\n### {label}\n\n{HDR}")
    for name, fn in RANKINGS:
        picks = [max(rs, key=fn) for rs in slots.values()]
        print(f"| {name} slot-#1 | {stats(picks)} |")
    rand = [x for x in rows if x.get("is_random")]
    print(f"| random slice (all) | {stats(rand)} |")


def main():
    v4 = fetch(["backtest4_open", "backtest4_close"])
    mark_random(v4)
    print(f"upside corpus: {len(v4)} labeled rows")
    from collections import Counter
    zones = Counter(r["outcome_type"] for r in v4)
    print(f"zones: {dict(zones.most_common())}\n")

    books(v4, "Full corpus")
    books([r for r in v4 if r["ticker"] not in ("MU", "SNDK")], "ex-MU/SNDK")
    for half, cond in (("H1", lambda r: r["scan_date"] < H_SPLIT),
                       ("H2", lambda r: r["scan_date"] >= H_SPLIT)):
        books([r for r in v4 if cond(r)], f"Half — {half}")

    # income comparison: same dates, same book construction, v2 corpus
    v2 = fetch(["backtest2_open", "backtest2_close"])
    slots2 = slot_map(v2)

    def roc(t):
        c = float(t["leg_c_strike"]) - float(t["net_premium"])
        return float(t["net_premium"]) / c if c > 0 else 0
    inc_picks = [max(rs, key=roc) for rs in slots2.values()]
    up_slots = slot_map(v4)
    up_picks = [max(rs, key=r1) for rs in up_slots.values()]
    print(f"\n### Same-collateral, same-year: income (B/ROC) vs upside "
          f"(best ranking)\n\n{HDR}")
    print(f"| income v2: ROC slot-#1 | {stats(inc_picks)} |")
    print(f"| upside v4: max/coll slot-#1 | {stats(up_picks)} |")
    # settle-dated drawdown at equal $25k collateral (sizing-sim convention)
    def dd(picks):
        by_day = defaultdict(float)
        for r in picks:
            size = 25000.0 / r["coll"]
            # expiration date = scan_date + days
            d = date.fromisoformat(r["scan_date"])
            from datetime import timedelta
            by_day[(d + timedelta(days=r["days"])).isoformat()] += r["pnl"] * size
        cum = peak = mdd = 0.0
        worst_m = defaultdict(float)
        for k in sorted(by_day):
            cum += by_day[k]
            peak = max(peak, cum)
            mdd = min(mdd, cum - peak)
            worst_m[k[:7]] += by_day[k]
        wm = min(worst_m.items(), key=lambda kv: kv[1])
        return mdd, wm
    for name, picks in (("income", inc_picks), ("upside", up_picks)):
        mdd, wm = dd(picks)
        tot = sum(r["pnl"] * 25000.0 / r["coll"] for r in picks)
        print(f"{name}: equal-$25k book total ${tot:,.0f}, settle-dated "
              f"maxDD ${mdd:,.0f}, worst month {wm[0]} ${wm[1]:,.0f}")


if __name__ == "__main__":
    main()
