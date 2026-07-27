"""Validate a day's quote extract (RANKER_SPEC Phase B1a validation).

Three checks per extracted date:

1. INTEGRITY — no duplicate (contract, window) rows (partition-merge
   correctness); every universe root that traded per day_aggs appears in the
   extract; window timestamps inside their ET bounds.

2. REST CROSS-CHECK (the exact-match standard) — for N sampled contracts per
   window, the extract's newest quote (q10) must equal Massive REST
   `list_quotes(timestamp_lte=window_end, limit=1)` to the nanosecond.

3. ml_dataset COMPARISON — for the date's live cron rows, compare logged leg
   premiums against the extract's slot quotes. NOTE: cron rows before the
   EC2 quote-migration deploy (2026-07-26 ~16:20 ET) are day.close-priced —
   for those dates this check QUANTIFIES the stale-pricing gap rather than
   validating the extractor; expect mismatches. From 2026-07-27 the same
   check becomes the true live-overlap agreement gate.

Usage:  python3 scripts/validate_extract.py --date 2026-07-24 [--rest-samples 3]
"""

import argparse
import gzip
import json
import os
import sys
import itertools
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import pandas as pd  # noqa: E402

from options_screener import massive_client as mc  # noqa: E402
from extract_quotes import window_bounds_ns, OUT_DIR  # noqa: E402


def check_integrity(df, date_str):
    print("— integrity —")
    win = df[df.window != "day"]
    dups = win.duplicated(subset=["contract", "window"]).sum()
    print(f"  duplicate (contract, window) rows: {dups} {'✓' if dups == 0 else '✗ FAIL'}")

    bounds = {label: (lo, hi) for label, lo, hi in window_bounds_ns(date_str)}
    bad_ts = 0
    for label, (lo, hi) in bounds.items():
        w = win[win.window == label]
        bad_ts += ((w.first_ts < lo) | (w.last_ts > hi)).sum()
    print(f"  window rows with out-of-bounds timestamps: {bad_ts} {'✓' if bad_ts == 0 else '✗ FAIL'}")

    # universe coverage vs day_aggs (which roots actually traded)
    uni = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data", "universe_extract.json")))
    roots = {t for lst in uni["sectors"].values() for t in lst}
    da_roots = set()
    da_path = os.path.join(OUT_DIR, "day_aggs", f"{date_str}.csv.gz")
    for line in gzip.open(da_path):
        t = line.split(b",", 1)[0]
        if t.startswith(b"O:"):
            sym = t[2:]
            if len(sym) > 15:
                r = sym[:-15].decode()
                if r in roots:
                    da_roots.add(r)
    have = set(df.underlying.unique())
    missing = da_roots - have
    print(f"  universe roots that traded (day_aggs): {len(da_roots)}; in extract: {len(have)}; "
          f"missing from extract: {sorted(missing) if missing else 'none ✓'}")
    return dups == 0 and bad_ts == 0 and not missing


def check_rest(df, date_str, samples_per_window=3):
    print("— REST cross-check (exact-match standard) —")
    bounds = {label: (lo, hi) for label, lo, hi in window_bounds_ns(date_str)}
    ok = True
    for label, (lo, hi) in bounds.items():
        w = df[(df.window == label) & (df.two_sided_count > 5) & (df.update_count > 20)]
        if w.empty:
            print(f"  {label}: no eligible rows to sample")
            continue
        sample = w.sample(min(samples_per_window, len(w)), random_state=7)
        for _, r in sample.iterrows():
            try:
                q = next(itertools.islice(mc.list_quotes(
                    r.contract, timestamp_lte=int(hi), sort="timestamp",
                    order="desc", limit=1), 1))
            except StopIteration:
                print(f"  {label} {r.contract}: REST returned nothing ✗")
                ok = False
                continue
            match = (q.sip_timestamp == int(r.q10_ts)
                     and float(q.bid_price) == float(r.q10_bid)
                     and float(q.ask_price) == float(r.q10_ask)
                     and int(q.bid_size) == int(r.q10_bid_size)
                     and int(q.ask_size) == int(r.q10_ask_size))
            tag = "✓ exact" if match else (
                f"✗ MISMATCH rest=({q.bid_price}x{q.bid_size} / {q.ask_price}x{q.ask_size} @ {q.sip_timestamp})")
            print(f"  {label} {r.contract}: extract q10 {r.q10_bid}x{int(r.q10_bid_size)} / "
                  f"{r.q10_ask}x{int(r.q10_ask_size)} @ {int(r.q10_ts)}  {tag}")
            ok &= match
    return ok


def check_ml_dataset(df, date_str):
    print("— ml_dataset comparison (staleness quantification pre-deploy; agreement gate after) —")
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    rows = sb.table("ml_dataset").select(
        "source,ticker,expiration,leg_a_strike,leg_a_prem,leg_b_strike,leg_b_prem,"
        "leg_c_strike,leg_c_prem").eq("scan_date", date_str).execute().data
    if not rows:
        print(f"  no live ml_dataset rows for {date_str}")
        return True
    win_by_slot = {"live_open": "open", "live_close": "close"}

    def occ(t, exp, cp, k):
        return f"O:{t}{exp[2:4]}{exp[5:7]}{exp[8:10]}{cp}{int(round(k*1000)):08d}"

    n, reported = 0, 0
    for r in rows:
        wlabel = win_by_slot.get(r["source"])
        if wlabel is None:
            continue
        legs = [("A(ask)", occ(r["ticker"], r["expiration"], "C", r["leg_a_strike"]), "q10_ask", r["leg_a_prem"]),
                ("B(bid)", occ(r["ticker"], r["expiration"], "C", r["leg_b_strike"]), "q10_bid", r["leg_b_prem"]),
                ("C(bid)", occ(r["ticker"], r["expiration"], "P", r["leg_c_strike"]), "q10_bid", r["leg_c_prem"])]
        for name, contract, side, prem in legs:
            hit = df[(df.contract == contract) & (df.window == wlabel)]
            n += 1
            if hit.empty:
                print(f"  {r['source']:10s} {r['ticker']:5s} {name} {contract}: NOT IN EXTRACT")
                continue
            qv = float(hit.iloc[0][side])
            d = prem - qv
            if reported < 12:
                print(f"  {r['source']:10s} {r['ticker']:5s} {name} {contract}: "
                      f"logged={prem:<8g} extract_{side}={qv:<8g} diff={d:+.2f}")
                reported += 1
    print(f"  ({n} legs checked; diffs ≈ 0 expected only for post-deploy quote-priced scans)")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True)
    ap.add_argument("--rest-samples", type=int, default=3)
    args = ap.parse_args()
    path = os.path.join(OUT_DIR, f"{args.date}.parquet")
    if not os.path.exists(path):
        sys.exit(f"no extract at {path} (still streaming?)")
    df = pd.read_parquet(path)
    day_rows = (df.window == "day").sum()
    print(f"[{args.date}] {len(df)} rows ({len(df) - day_rows} window + {day_rows} day), "
          f"{df.underlying.nunique()} underlyings, {df.contract.nunique()} contracts, "
          f"{os.path.getsize(path)/1e6:.1f} MB\n")
    ok = check_integrity(df, args.date)
    ok &= check_rest(df, args.date, args.rest_samples)
    check_ml_dataset(df, args.date)
    print(f"\nVERDICT: {'PASS' if ok else 'FAIL'} (integrity + REST exact-match)")


if __name__ == "__main__":
    main()
