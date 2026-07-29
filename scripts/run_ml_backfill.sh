#!/bin/bash
# Nightly ml_dataset outcome backfill (scripts/backfill_ml_outcomes.py).
#
# Driven by a launchd LaunchAgent (this Mac):
#     ~/Library/LaunchAgents/com.luocapital.ml-backfill.plist
#     (label com.luocapital.ml-backfill, 16:30 local Mon-Fri)
# 16:30 Mountain == 18:30 ET year-round (both zones shift DST on the same
# dates), i.e. ~2.5h after each day's expirations settle. launchd runs a
# missed slot on wake if the Mac was asleep at fire time.
#
# The backfill is idempotent (only rows with outcome_filled=false; recent
# expirations that 429 are skipped and retried next night), so a missed or
# doubled run is always safe. Non-trading days no-op cleanly.
#
# Log: ~/Library/Logs/luocapital/ml_backfill.log (stable — /tmp is cleared on
# reboot). Always exits 0 so launchd never treats a data hiccup as a crash.

cd "$(dirname "$0")/.." || exit 0
LOG_DIR="$HOME/Library/Logs/luocapital"
mkdir -p "$LOG_DIR"
{
  echo "=== ml-backfill run $(date -u +%FT%TZ) ==="
  python3 scripts/backfill_ml_outcomes.py
  echo "=== end rc=$? $(date -u +%FT%TZ) ==="
} >> "$LOG_DIR/ml_backfill.log" 2>&1
exit 0
