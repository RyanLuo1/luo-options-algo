#!/usr/bin/env python3
"""One-off coverage audit for the 2026-08 universe gap (read-only on extracts).

For every local extract (data/extracts/*.parquet), enumerate which
scan-universe roots (data/universe.json) are present vs absent in the
parquet's `underlying` column, and write the authoritative record to
docs/private/UNIVERSE_GAP_LEDGER.md — the doc the re-stream decision and
Phase C's coverage section read from.

Context: the 2026-08-07 extraction-universe rebuild silently dropped 12 S&P
mega-caps (ADI BLK CRM HD JPM LOW MCD MDT MRK MU WDC XOM); every extract
banked with that file lacks them. The $75B-era extracts (2026-07-20 →
2026-08-03) predate the break.

Usage (from project root):
    python3 scripts/audit_universe_coverage.py
    python3 scripts/audit_universe_coverage.py --out /tmp/ledger.md
"""

import argparse
import glob
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

import pandas as pd

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACTS_DIR = os.path.join(_PROJECT_ROOT, "data", "extracts")
SCAN_UNIVERSE = os.path.join(_PROJECT_ROOT, "data", "universe.json")
DEFAULT_OUT = os.path.join(_PROJECT_ROOT, "docs", "private",
                           "UNIVERSE_GAP_LEDGER.md")

KNOWN_12 = ["ADI", "BLK", "CRM", "HD", "JPM", "LOW", "MCD", "MDT", "MRK",
            "MU", "WDC", "XOM"]

# Point-in-time analysis of the audit's surprises (2026-08-27), carried into
# every regenerated ledger. Evidence: day_aggs root counts quoted inline.
FINDINGS = """\
## Findings — the surprises explained (investigated 2026-08-27)

**BRK-B — missing from EVERY extract, both eras (symbology, not universe).**
The universe files store yfinance-style `BRK-B`; OPRA option roots strip the
punctuation — the 2026-08-20 day_aggs carries **616 contracts under root
`BRKB`** (and no `BRK-B`). The extractor's exact-root match therefore never
captures Berkshire options, in any extract ever banked ($75B era included).
This is a 13th effectively-missing scan name for the re-stream scope
discussion, and the fix is a yfinance→OPRA root map (`BRK-B` → `BRKB`) in
`load_universe_roots()` — NOT a universe rebuild. Pending decision.

**HON on 2025-10-30 — corporate-action adjustment day (known semantic).**
day_aggs evidence: 2025-10-29 all plain `HON` (186 contracts); **2025-10-30
the entire chain trades as adjusted class `HON1` (144 contracts, zero plain
`HON`)**; 2025-10-31 both (103 relisted standard `HON` + 150 adjusted
`HON1`) — consistent with the Solstice spinoff ex-date. The extractor's
exact-root match deliberately excludes adjusted classes (different
deliverables; the replay should not trade them), so HON has no coverage on
2025-10-30 and only the relisted standard chain from 10-31 onward. This is
the documented adjusted-class limitation surfacing, not an extraction bug —
replay coverage accounting must treat 2025-10-30 as a HON holiday.
"""


def scan_names():
    with open(SCAN_UNIVERSE) as f:
        uni = json.load(f)
    return sorted({t for lst in uni["sectors"].values() for t in lst})


def manifest_done_dates():
    """Set of manifest-'done' dates; empty set if Supabase is unreachable
    (the ledger still audits every local file either way)."""
    try:
        sys.path.insert(0, os.path.join(_PROJECT_ROOT, "scripts"))
        import extract_claims as ec
        rows, page = [], 0
        while True:
            r = (ec._sb().table("extract_claims").select("date,status")
                 .eq("status", "done").range(page * 1000, page * 1000 + 999)
                 .execute())
            rows.extend(r.data)
            if len(r.data) < 1000:
                break
            page += 1
        return {row["date"] for row in rows}
    except Exception as e:  # noqa: BLE001
        print(f"[audit] manifest unavailable ({e}) — 'done' column omitted",
              file=sys.stderr)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    names = scan_names()
    name_set = set(names)
    done = manifest_done_dates()

    paths = sorted(glob.glob(os.path.join(EXTRACTS_DIR, "*.parquet")))
    paths = [p for p in paths if not p.endswith(".partial.parquet")]
    rows = []
    for p in paths:
        date = os.path.basename(p)[:-8]
        und = set(pd.read_parquet(p, columns=["underlying"])["underlying"]
                  .unique())
        missing = sorted(name_set - und)
        generation = "$75B era" if "MU" in und else "$50B era (gapped)"
        rows.append({
            "date": date,
            "generation": generation,
            "n_underlyings": len(und),
            "missing": missing,
            "done": (date in done) if done is not None else None,
        })
        print(f"[audit] {date}: {len(und)} underlyings, "
              f"{len(missing)} scan names missing", flush=True)

    # group identical missing-sets
    sig_groups = defaultdict(list)
    for r in rows:
        sig_groups[tuple(r["missing"])].append(r["date"])

    surprises = []
    for r in rows:
        extra_missing = [m for m in r["missing"] if m not in KNOWN_12]
        if extra_missing:
            surprises.append((r["date"], extra_missing))
        if r["generation"].startswith("$75B") and r["missing"]:
            surprises.append((r["date"], f"$75B-era date missing "
                                         f"{r['missing']}"))

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Universe gap ledger — scan-name coverage of every banked extract",
        "",
        f"Generated {now} by `scripts/audit_universe_coverage.py` "
        f"(re-runnable; audits every non-partial parquet in "
        f"`data/extracts/`).",
        "",
        f"Scan universe: {len(names)} names (`data/universe.json`, $100B). "
        f"Known gap: the 2026-08-07 extraction-universe rebuild dropped 12 "
        f"S&P mega-caps ({', '.join(KNOWN_12)}); extracts banked with it "
        f"lack all 12.",
        "",
        "## Summary — missing-set signatures",
        "",
        "| Signature | Dates | Date range |",
        "|---|---|---|",
    ]
    for sig, dates in sorted(sig_groups.items(),
                             key=lambda kv: (-len(kv[1]), kv[0])):
        label = ("complete (no scan names missing)" if not sig else
                 "the known 12" if list(sig) == KNOWN_12 else
                 ", ".join(sig))
        lines.append(f"| {label} | {len(dates)} | "
                     f"{min(dates)} → {max(dates)} |")

    lines += ["", FINDINGS]
    lines += ["## Surprises beyond the known 12-name pattern", ""]
    if surprises:
        for date, what in surprises:
            lines.append(f"- **{date}**: {what}")
    else:
        lines.append("None — every gapped extract is missing exactly the "
                     "known 12, and every $75B-era extract is complete.")

    lines += [
        "",
        "## Per-date table",
        "",
        "| Date | Generation | Underlyings | Manifest | Missing scan names |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        done_s = ("done" if r["done"] else "not-done" if r["done"] is not None
                  else "?")
        miss_s = "—" if not r["missing"] else ", ".join(r["missing"])
        lines.append(f"| {r['date']} | {r['generation']} | "
                     f"{r['n_underlyings']} | {done_s} | {miss_s} |")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n[audit] ledger written to {args.out} "
          f"({len(rows)} extracts, {len(sig_groups)} signatures, "
          f"{len(surprises)} surprises)")


if __name__ == "__main__":
    main()
