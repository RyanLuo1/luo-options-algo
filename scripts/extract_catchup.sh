#!/bin/bash
# Daily catch-up extraction for the clean overlap week (RANKER_SPEC Phase B).
#
# Extracts any missing quotes flat-file day from 2026-07-27 (the quote-basis
# cutover) up to yesterday. Flat files publish ~11:00 AM ET the next morning,
# so run this early afternoon — a local cron entry (this Mac) drives it:
#     5 12 * * 2-6 /Users/binkmaster/Desktop/Luo\ Capital/scripts/extract_catchup.sh
# (Tue-Sat, 12:05 local — extracts the previous trading day. Remove with
# `crontab -e` when the clean week is collected or the job moves to EC2.)
#
# Failures are non-fatal: an unpublished/holiday date logs and is retried on
# the next run. Log: /tmp/extract_catchup.log. Each successful extract is
# auto-validated (validate_extract.py) into the same log.

cd "$(dirname "$0")/.." || exit 0
{
  echo "=== catchup run $(date -u +%FT%TZ) ==="
  python3 - <<'PY'
import os
import subprocess
import sys
from datetime import date, timedelta

START = date(2026, 7, 27)          # first clean quote-priced cron day
d, today = START, date.today()
while d < today:                    # published files only (yesterday and back)
    if d.weekday() < 5:
        ds = d.isoformat()
        if not os.path.exists(f"data/extracts/{ds}.parquet"):
            print(f"[catchup] extracting {ds}", flush=True)
            rc = subprocess.run(
                [sys.executable, "scripts/extract_quotes.py", "--date", ds]).returncode
            if rc == 0:
                subprocess.run(
                    [sys.executable, "scripts/validate_extract.py", "--date", ds])
            else:
                print(f"[catchup] {ds} failed rc={rc} (unpublished/holiday?) — "
                      f"will retry next run", flush=True)
    d += timedelta(days=1)
print("[catchup] done", flush=True)
PY
} >> /tmp/extract_catchup.log 2>&1
exit 0
