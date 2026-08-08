"""Atomic day-claiming for extraction workers — RANKER_SPEC Phase B2 fleet
coordination. Table: extract_claims (docs/extract_claims_schema.sql).

Any number of workers (year-stream fleet, the EC2 catch-up cron, a manual
Mac run) can share one date list without duplicating work:

    from extract_claims import claim_day, mark_done, mark_failed, heartbeat
    if claim_day("2026-08-04"):
        ... extract + validate ...
        mark_done("2026-08-04", parquet_bytes=...)   # or mark_failed(...)

Crash safety: a claim whose heartbeat is older than STALE_MINUTES is
reclaimable by anyone (the extractor heartbeats from its progress loop, far
more often than the threshold). 'done' is terminal and never reclaimed.
'failed' is reclaimable immediately (retry semantics).

No table (or no network)? claim_day raises ClaimsUnavailable — callers choose
between failing loudly (year-stream: yes) and single-machine fallback
behavior (catch-up wrapper: proceeds with local-file existence checks only,
logging the degradation).
"""

import os
import socket
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

STALE_MINUTES = 60   # paired with per-progress-line (~2 GB) heartbeats; a slow
                     # live stream must never look stale (reclaim latency for a
                     # truly dead worker is noise over a multi-day fleet run)
_WORKER = f"{socket.gethostname()}:{os.getpid()}"


class ClaimsUnavailable(RuntimeError):
    pass


_client = None


def _sb():
    global _client
    if _client is None:
        from supabase import create_client
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise ClaimsUnavailable("SUPABASE_URL/SERVICE_KEY not configured")
        _client = create_client(url, key)
    return _client


def _now():
    return datetime.now(timezone.utc)


def claim_day(date_str, worker=None):
    """True if this worker now holds the claim for date_str; False if another
    live worker holds it or the day is already done."""
    worker = worker or _WORKER
    sb = _sb()
    try:
        sb.table("extract_claims").insert({
            "date": date_str, "status": "claimed", "worker": worker,
        }).execute()
        return True
    except ClaimsUnavailable:
        raise
    except Exception as e:
        msg = str(e)
        if "extract_claims" in msg and ("does not exist" in msg or "PGRST205" in msg):
            raise ClaimsUnavailable(
                "extract_claims table missing — run docs/extract_claims_schema.sql") from e
        if "23505" not in msg and "duplicate" not in msg.lower():
            raise ClaimsUnavailable(f"claims insert failed: {msg[:200]}") from e
    # Row exists. Take over iff failed, or claimed-but-stale. Conditional
    # UPDATE with the previous holder in the WHERE keeps takeover atomic:
    # two racers both read the same stale row, but only the first UPDATE
    # matches (the second sees a changed worker/heartbeat and matches 0 rows).
    rows = (_sb().table("extract_claims").select("status,worker,heartbeat_at")
            .eq("date", date_str).execute()).data
    if not rows:
        return claim_day(date_str, worker)      # deleted between calls — retry
    row = rows[0]
    if row["status"] == "done":
        return False
    hb = datetime.fromisoformat(row["heartbeat_at"].replace("Z", "+00:00"))
    if row["status"] == "claimed" and _now() - hb < timedelta(minutes=STALE_MINUTES):
        return False                             # live holder
    res = (_sb().table("extract_claims").update({
        "status": "claimed", "worker": worker,
        "claimed_at": _now().isoformat(), "heartbeat_at": _now().isoformat(),
        "note": f"reclaimed from {row['worker']} ({row['status']})",
    }).eq("date", date_str).eq("worker", row["worker"])
        .eq("heartbeat_at", row["heartbeat_at"]).execute())
    return bool(res.data)


def heartbeat(date_str, worker=None):
    _sb().table("extract_claims").update(
        {"heartbeat_at": _now().isoformat()}
    ).eq("date", date_str).eq("worker", worker or _WORKER).execute()


def mark_done(date_str, parquet_bytes=None, worker=None):
    _sb().table("extract_claims").update({
        "status": "done", "finished_at": _now().isoformat(),
        "parquet_bytes": parquet_bytes,
    }).eq("date", date_str).eq("worker", worker or _WORKER).execute()


def mark_failed(date_str, note, worker=None):
    _sb().table("extract_claims").update({
        "status": "failed", "finished_at": _now().isoformat(),
        "note": (note or "")[:500],
    }).eq("date", date_str).eq("worker", worker or _WORKER).execute()
