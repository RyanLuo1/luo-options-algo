#!/usr/bin/env bash
# scripts/ec2_ml_backfill.sh — EC2 cron wrapper for the nightly ml_dataset
# outcome backfill. Linux port of the Mac's run_ml_backfill.sh (the Mac
# launchd agents are permanently unloaded — macOS TCC broke them; ALL
# scheduled automation now lives on EC2).
#
# Schedule (crontab, ubuntu user): Mon–Fri, target 18:30 ET (~2.5 h after
# expirations settle). UTC box, no CRON_TZ → cron fires at BOTH the EDT and
# EST UTC times (22:30 + 23:30 UTC) and this wrapper gates on the real ET
# clock (same pattern as run_sector_scan.sh).
#
# The backfill is idempotent (only outcome_filled=false rows; recent
# expirations that 429 are skipped and retried next night), so a missed or
# doubled run is always safe. Non-trading days no-op cleanly.
#
# Log: /home/ubuntu/logs/ml_backfill.log (size-capped, one .1 backup).
# Always exits 0 so cron never mails or treats a data hiccup as a crash.
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/home/ubuntu/logs"
LOG="$LOG_DIR/ml_backfill.log"
PY="$PROJECT_ROOT/venv/bin/python"
MAX_BYTES=$((5 * 1024 * 1024))

mkdir -p "$LOG_DIR"
if [ -f "$LOG" ]; then
    sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
    [ "$sz" -gt "$MAX_BYTES" ] && mv -f "$LOG" "$LOG.1"
fi

now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# DST-safe ET time gate (pass "force" to bypass for manual runs).
if [ "${1:-}" != "force" ]; then
    ethm=$((10#$(TZ=America/New_York date +%H%M)))
    if ! (( ethm >= 1815 && ethm <= 1845 )); then
        echo "[$(now_utc)] ml-backfill skipped: ET $(TZ=America/New_York date '+%H:%M %Z') outside window (DST no-op fire)" >> "$LOG"
        exit 0
    fi
fi

cd "$PROJECT_ROOT" || { echo "[$(now_utc)] FATAL: cannot cd $PROJECT_ROOT" >> "$LOG"; exit 0; }

{
  echo "=== ml-backfill run $(now_utc) host=$(hostname) ==="
  "$PY" scripts/backfill_ml_outcomes.py
  echo "=== end rc=$? $(now_utc) ==="
} >> "$LOG" 2>&1

exit 0
