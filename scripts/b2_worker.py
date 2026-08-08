"""B2 year-stream worker — claim-driven extraction loop (RANKER_SPEC B2).

Run N of these (across any machines with the repo + .env) and they share the
date range via the extract_claims manifest without duplicating work:

    python3 scripts/b2_worker.py --start 2025-08-04 --end 2026-07-25 \
        --reconnect-every-gb 8

Per date: claim -> extract (heartbeating via the progress log) -> validate ->
mark done/failed. Weekends are skipped locally; holidays surface as
"file missing" failures and are marked failed with that note (reclaimable,
but every worker will fail them the same way — filter the list by NYSE
calendar upstream if that noise matters).

The claims table is REQUIRED here (this is fleet mode): if it's missing the
worker exits loudly rather than risk duplicating a 100+ GB stream.
"""

import argparse
import os
import subprocess
import sys
from datetime import date as date_cls, datetime, timedelta

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, ".."))

from extract_claims import (  # noqa: E402
    ClaimsUnavailable, claim_day, heartbeat, mark_done, mark_failed,
)
import extract_quotes  # noqa: E402


def run_one(date_str, reconnect_bytes):
    hb_state = {"n": 0}

    def log(msg, **kw):
        print(msg, flush=True, **{k: v for k, v in kw.items() if k != "flush"})
        hb_state["n"] += 1
        if hb_state["n"] % 3 == 0:          # every ~3 progress lines (~6 GB)
            try:
                heartbeat(date_str)
            except Exception:
                pass                         # heartbeat is best-effort

    res = extract_quotes.extract_day(date_str, log=log, reconnect_bytes=reconnect_bytes)
    if res is None:                          # already extracted locally
        out = os.path.join(extract_quotes.OUT_DIR, f"{date_str}.parquet")
        res = {"parquet_bytes": os.path.getsize(out)}
    rc = subprocess.run(
        [sys.executable, os.path.join(_HERE, "validate_extract.py"),
         "--date", date_str]).returncode
    if rc != 0:
        raise RuntimeError(f"validation failed rc={rc}")
    return res.get("parquet_bytes")


def main():
    ap = argparse.ArgumentParser(description="claim-driven B2 extraction worker")
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--reconnect-every-gb", type=float, default=8.0)
    args = ap.parse_args()

    d = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = datetime.strptime(args.end, "%Y-%m-%d").date()
    reconnect = int(args.reconnect_every_gb * 1e9)
    done = skipped = failed = 0
    while d <= end:
        if d.weekday() < 5:
            ds = d.isoformat()
            try:
                got = claim_day(ds)
            except ClaimsUnavailable as e:
                sys.exit(f"FATAL: claims manifest unavailable ({e}) — refusing "
                         f"to run fleet extraction without coordination")
            if got:
                print(f"[worker] claimed {ds}", flush=True)
                try:
                    nbytes = run_one(ds, reconnect)
                    mark_done(ds, parquet_bytes=nbytes)
                    done += 1
                    print(f"[worker] {ds} DONE ({(nbytes or 0)/1e6:.1f} MB)", flush=True)
                except Exception as e:  # noqa: BLE001
                    mark_failed(ds, f"{type(e).__name__}: {e}")
                    failed += 1
                    print(f"[worker] {ds} FAILED: {e}", flush=True)
            else:
                skipped += 1
        d += timedelta(days=1)
    print(f"[worker] range complete: {done} done, {skipped} skipped (held/done "
          f"elsewhere), {failed} failed", flush=True)


if __name__ == "__main__":
    main()
