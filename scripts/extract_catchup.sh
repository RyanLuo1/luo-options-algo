#!/bin/bash
# Daily catch-up extraction for the clean overlap week (RANKER_SPEC Phase B).
#
# Extracts any missing quotes flat-file day from 2026-07-27 (the quote-basis
# cutover) up to yesterday. Flat files publish ~11:00 AM ET the next morning,
# so run this early afternoon — a launchd LaunchAgent (this Mac) drives it:
#     ~/Library/LaunchAgents/com.luocapital.extract-catchup.plist
#     (label com.luocapital.extract-catchup, 12:05 local Tue-Sat)
# launchd replaced the original cron entry 2026-07-28: macOS denies cron Full
# Disk Access so it never fired, and launchd also runs a missed slot on wake.
# Unload with `launchctl bootout gui/$UID <plist>` when the job moves to EC2.
#
# Failures are non-fatal: an unpublished/holiday date logs and is retried on
# the next run. Log: ~/Library/Logs/luocapital/extract_catchup.log (moved out
# of /tmp, which reboots clear). Each successful extract is auto-validated
# (validate_extract.py) into the same log.

LOG_DIR="$HOME/Library/Logs/luocapital"
mkdir -p "$LOG_DIR"

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
} >> "$LOG_DIR/extract_catchup.log" 2>&1
exit 0
