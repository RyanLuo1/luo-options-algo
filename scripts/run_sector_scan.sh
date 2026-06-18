#!/usr/bin/env bash
# scripts/run_sector_scan.sh — cron wrapper for the daily sector scan.
#
# Usage:
#   run_sector_scan.sh <open|close> [force]
#
# WHY A WRAPPER: the EC2 box runs in UTC and this cron build has no CRON_TZ, so
# we can't ask cron to track ET/DST. Instead cron schedules each slot at BOTH
# the EDT and EST UTC times (4 lines total), and this wrapper gates on the
# ACTUAL Eastern-time clock: it proceeds only when "now" in America/New_York is
# inside the slot's target window. So exactly ONE of the two daily fires runs in
# each DST period — no twice-a-year crontab edits, no server-timezone change.
#   open  target 10:00 ET  (accept 09:45–10:30)   -> ~30 min after 09:30 open
#   close target 15:30 ET  (accept 15:15–15:45)   -> ~30 min before 16:00 close
# Pass "force" to bypass the time gate (manual / off-hours testing). The
# in-script NYSE market-day guard (weekends + holidays) still applies either way.
#
# Logging: all stdout+stderr is appended, timestamped, to logs/sector_scan.log,
# which is size-capped here (5 MB, one rotated .1 backup). The wrapper always
# exits 0 so a scan failure is logged but never mails cron or blocks the next
# scheduled run (cron invocations are independent regardless).
set -uo pipefail

SLOT="${1:-}"
FORCE="${2:-}"
case "$SLOT" in
    open|close) ;;
    *) echo "usage: $0 <open|close> [force]" >&2; exit 2 ;;
esac

# Resolve project root from this script's location so the wrapper is portable.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
LOG="$LOG_DIR/sector_scan.log"
PY="$PROJECT_ROOT/venv/bin/python"
MAX_BYTES=$((5 * 1024 * 1024))   # 5 MB cap; with one .1 backup that's ~10 MB max

mkdir -p "$LOG_DIR"

# Size cap / rotate (keep a single previous file).
if [ -f "$LOG" ]; then
    sz=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
    [ "$sz" -gt "$MAX_BYTES" ] && mv -f "$LOG" "$LOG.1"
fi

now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# DST-safe ET time gate (skipped when "force"). 10#$x forces base-10 so a
# leading-zero ET time like 0900 isn't parsed as octal.
if [ "$FORCE" != "force" ]; then
    ethm=$((10#$(TZ=America/New_York date +%H%M)))
    proceed=0
    [ "$SLOT" = "open"  ] && (( ethm >= 945  && ethm <= 1030 )) && proceed=1
    [ "$SLOT" = "close" ] && (( ethm >= 1515 && ethm <= 1545 )) && proceed=1
    if [ "$proceed" -ne 1 ]; then
        echo "[$(now_utc)] slot=$SLOT skipped: ET $(TZ=America/New_York date '+%H:%M %Z') outside window (DST no-op fire)" >> "$LOG"
        exit 0
    fi
fi

cd "$PROJECT_ROOT" || { echo "[$(now_utc)] slot=$SLOT FATAL: cannot cd $PROJECT_ROOT" >> "$LOG"; exit 0; }

{
    echo "===================================================================="
    echo "[$(now_utc)] sector_scan START slot=$SLOT host=$(hostname) ET=$(TZ=America/New_York date '+%Y-%m-%d %H:%M %Z')"
    "$PY" scripts/sector_scan.py --slot "$SLOT"
    rc=$?
    echo "[$(now_utc)] sector_scan END   slot=$SLOT rc=$rc"
} >> "$LOG" 2>&1

exit 0
