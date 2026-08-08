#!/usr/bin/env bash
# scripts/ec2_extract_catchup.sh — EC2 cron wrapper for the daily catch-up
# extraction (RANKER_SPEC Phase B). Linux port of the Mac's extract_catchup.sh
# (the Mac launchd agents are permanently unloaded — macOS TCC denies cron/
# launchd Full Disk Access; ALL scheduled automation now lives on EC2).
#
# Schedule (crontab, ubuntu user): daily Tue–Sat, target 14:05 ET — flat files
# publish ~11:00 AM ET, so early afternoon is safely after publication. The box
# is UTC with no CRON_TZ, so cron fires at BOTH the EDT and EST UTC times
# (18:05 + 19:05 UTC) and this wrapper gates on the real ET clock — exactly one
# fire proceeds per day in either DST period (same pattern as run_sector_scan.sh).
#
# Extracts every missing quotes flat-file day from START up to yesterday, then
# auto-validates each successful extract. Failures are non-fatal: an
# unpublished/holiday date logs and is retried on the next run.
#
# Guards:
#   - flock: a still-running catch-up (multi-hour first runs) blocks the next
#     fire instead of double-extracting.
#   - disk: skips (with a log line) if < 5 GB free on / — an extraction must
#     never wedge the live app's disk.
#
# Log: /home/ubuntu/logs/extract_catchup.log (size-capped, one .1 backup).
# Always exits 0 so cron never mails or treats a data hiccup as a crash.
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/home/ubuntu/logs"
LOG="$LOG_DIR/extract_catchup.log"
PY="$PROJECT_ROOT/venv/bin/python"
LOCK="/home/ubuntu/logs/.extract_catchup.lock"
MAX_BYTES=$((5 * 1024 * 1024))
MIN_FREE_KB=$((5 * 1024 * 1024))   # 5 GB

mkdir -p "$LOG_DIR"
if [ -f "$LOG" ]; then
    sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
    [ "$sz" -gt "$MAX_BYTES" ] && mv -f "$LOG" "$LOG.1"
fi

now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# DST-safe ET time gate (pass "force" to bypass for manual runs).
if [ "${1:-}" != "force" ]; then
    ethm=$((10#$(TZ=America/New_York date +%H%M)))
    if ! (( ethm >= 1345 && ethm <= 1445 )); then
        echo "[$(now_utc)] extract-catchup skipped: ET $(TZ=America/New_York date '+%H:%M %Z') outside window (DST no-op fire)" >> "$LOG"
        exit 0
    fi
fi

# Free-disk gate.
free_kb=$(df -k --output=avail / | tail -1 | tr -d ' ')
if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
    echo "[$(now_utc)] extract-catchup skipped: only $((free_kb / 1024)) MB free on / (< 5 GB) — resize EBS" >> "$LOG"
    exit 0
fi

exec 9>"$LOCK"
if ! flock -n 9; then
    echo "[$(now_utc)] extract-catchup skipped: previous run still holds the lock" >> "$LOG"
    exit 0
fi

cd "$PROJECT_ROOT" || { echo "[$(now_utc)] FATAL: cannot cd $PROJECT_ROOT" >> "$LOG"; exit 0; }

{
  echo "=== catchup run $(now_utc) host=$(hostname) ==="
  "$PY" - <<'PY'
import os
import subprocess
import sys
from datetime import date, timedelta

# Claims manifest (extract_claims table): prevents this cron duplicating a day
# another machine already extracted/holds. Degrades gracefully to local-file
# existence checks if the table/network is unavailable (single-machine mode).
sys.path.insert(0, "scripts")
try:
    from extract_claims import ClaimsUnavailable, claim_day, mark_done, mark_failed
    def _claim(ds):
        try:
            return claim_day(ds)
        except ClaimsUnavailable as e:
            print(f"[catchup] claims unavailable ({e}) — local-only mode", flush=True)
            return None                     # None = manifest unusable
except ImportError:
    def _claim(ds):
        return None

START = date(2026, 7, 27)          # first clean quote-priced cron day
d, today = START, date.today()
while d < today:                    # published files only (yesterday and back)
    if d.weekday() < 5:
        ds = d.isoformat()
        if not os.path.exists(f"data/extracts/{ds}.parquet"):
            claimed = _claim(ds)
            if claimed is False:
                print(f"[catchup] {ds} held/done by another worker — skipping", flush=True)
                d += timedelta(days=1)
                continue
            print(f"[catchup] extracting {ds}", flush=True)
            rc = subprocess.run(
                [sys.executable, "scripts/extract_quotes.py", "--date", ds]).returncode
            if rc == 0:
                vrc = subprocess.run(
                    [sys.executable, "scripts/validate_extract.py", "--date", ds]).returncode
                if claimed:
                    try:
                        size = os.path.getsize(f"data/extracts/{ds}.parquet")
                        mark_done(ds, parquet_bytes=size) if vrc == 0 else \
                            mark_failed(ds, f"validation rc={vrc}")
                    except Exception:
                        pass
            else:
                print(f"[catchup] {ds} failed rc={rc} (unpublished/holiday?) — "
                      f"will retry next run", flush=True)
                if claimed:
                    try:
                        mark_failed(ds, f"extract rc={rc} (unpublished/holiday?)")
                    except Exception:
                        pass
    d += timedelta(days=1)
print("[catchup] done", flush=True)
PY
  echo "=== end rc=$? $(now_utc) ==="
} >> "$LOG" 2>&1

exit 0
