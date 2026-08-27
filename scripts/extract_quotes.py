"""Flat-file quote extraction worker — RANKER_SPEC.md Phase B-extract (B1a).

Streams one trading day's OPRA quotes flat file
(s3://flatfiles/us_options_opra/quotes_v1/YYYY/MM/YYYY-MM-DD.csv.gz on
https://files.massive.com) and produces a compact per-day extract for the
extraction universe (the $75B superset — see load_universe_roots), plus the matching day_aggs_v1 file (contract discovery +
historical volume filter for the replay).

Extraction parameters (spec open question #5 — RESOLVED, 2026-07-26):
  - Three ET windows per day: 09:30-10:05, 12:45-13:00, 15:00-15:35
    (slot times 10:00/15:30 + 5-min tails so the replay can match the live
    cron's actual scan minutes; midday is frozen optionality — extracted,
    unused for now).
  - Per contract per window: the LAST 10 quote updates (full rows) + summary
    stats (update_count, min/max/mean spread, OHLC of quote mid, sizes at the
    last quote, first/last quote timestamps).
  - Per contract per DAY: counters only (total update_count, first/last quote
    timestamp) — no stored quotes outside the windows.
  - One-sided quotes (bid or ask price/size 0) are KEPT in the last-10 rows
    and counted in update_count; they are excluded from spread/mid stats
    (undefined there). Eligibility is the replay's guards' job, not ours.

Implementation notes (from the 2026-07 probes — see CLAUDE.md):
  - Files are CONCATENATIONS of internally-sorted partitions (discovered
    2026-07-26: the first partition runs A→B* with whole root spans missing —
    e.g. AMAT/AMD/AMZN — which appear in later partitions). Within a
    partition rows are (ticker, timestamp)-sorted and a contract's rows are
    contiguous, so run-detection works — but there is NO global alphabetical
    order: never exit early, always stream to physical EOF, and keep
    per-contract state in a dict so a contract recurring in a later partition
    merges instead of duplicating.
  - gzip is non-seekable: single forward stream, bounded memory (a day is
    ~100-160 GB compressed; never materialized).
  - OCC parsing: root = symbol minus the trailing 15 chars (YYMMDD + C/P +
    8-digit strike). Exact-root match only — O:MU... must not match O:MUR...
    or the adjusted class O:MU1... (both parse to different roots).
  - sip timestamps are 19-digit nanoseconds; window bounds are compared as
    fixed-width byte strings in the hot loop (no int() until a row is kept).
  - ET windows are computed with zoneinfo for the specific date (DST-correct
    across the year; never a hardcoded UTC offset).

Output: data/extracts/YYYY-MM-DD.parquet (schema: docs/extract_schema.md;
window rows + one window='day' counters row per contract). Extracts are
immutable; already-extracted dates are skipped (resumable). day_aggs land in
data/extracts/day_aggs/YYYY-MM-DD.csv.gz verbatim.

Memory (2026-08-05 chunked-writer fix): per-contract state MUST persist to
physical EOF — the partition layout means any contract can recur in a later
partition (that is why `states` is a merge dict), so there is no point mid-
stream where an underlying is provably final; flush-at-underlying-boundary
would silently duplicate/split rows. The old OOM (~6.9 GB total-vm, killed
the 2 GB t3.small three times) was NOT the state dict (~1.7 GB) but the
endgame: materializing every flushed row dict, building DataFrames, then
pd.concat + to_parquet held several copies at once. The endgame now streams
batches of flushed rows straight into one pyarrow ParquetWriter (identical
schema/columns, just more row groups) — peak memory is the state dict plus
one ~100k-row batch. Content is unchanged; only row-group layout differs.

Usage (from project root):
  python3 scripts/extract_quotes.py --date 2026-07-24
  python3 scripts/extract_quotes.py --date 2026-07-20 --date 2026-07-21 ...
  python3 scripts/extract_quotes.py --date 2026-07-24 --limit-gb 1  # smoke test
"""

import argparse
import gzip
import json
import os
import random
import re
import socket
import sys
import time
import zlib
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import boto3  # noqa: E402
from botocore.config import Config  # noqa: E402

ENDPOINT = "https://files.massive.com"
ENDPOINT_HOST = "files.massive.com"
BUCKET = "flatfiles"

# ── Pod-aware connection routing (2026-08-12) ────────────────────────────────
# Massive serves flat files from SHARED, congestion-varying pods behind one
# rotating DNS A record (TTL ~34 s). Measured inter-pod spread at one moment:
# 0.8 → 28 MB/s (35x). Naive per-recycle re-resolution clumps concurrent
# workers onto whichever single record the TTL window serves, pinning them to
# congested pods. Fix (per Massive support: "reconnect periodically to
# re-roll pod assignment"): accumulate every IP DNS ever hands us into a pod
# pool and choose per-connection — KEEP the current pod while it serves fast
# segments ("win-stay"), re-roll to a random other pod when it slows
# ("lose-shift"). The getaddrinfo patch below pins only ENDPOINT_HOST; TLS
# still validates against the hostname via SNI.
POD_KEEP_MBS = 6.0        # keep the pod when the last segment beat this
POD_REFRESH_S = 30        # re-resolve at most this often (DNS TTL ~34 s)
POD_TTL_S = 2 * 3600      # drop pods DNS hasn't served for this long (2026-08-15
                          # incident: Massive rotated their pod fleet and an
                          # append-only pool went 100% stale in one moment; a
                          # sticky pinned choice then 403'd every subsequent
                          # request and burned the whole claim range in 30 min)
_POD_POOL = {}            # ip -> last time DNS served it (epoch seconds)
_POD_BLOCKED = set()      # pods that returned 4xx this process — never re-picked
_pod_choice = {"ip": None}
_pod_state = {"last_refresh": 0.0}
_real_getaddrinfo = socket.getaddrinfo


def _pod_getaddrinfo(host, *args, **kwargs):
    if host == ENDPOINT_HOST and _pod_choice["ip"]:
        return _real_getaddrinfo(_pod_choice["ip"], *args, **kwargs)
    return _real_getaddrinfo(host, *args, **kwargs)


socket.getaddrinfo = _pod_getaddrinfo


def _refresh_pod_pool(force=False):
    """Grow the pod pool: fresh DNS resolution (throttled to POD_REFRESH_S,
    matching the record's TTL) merged with a SHARED per-box pool file so
    concurrent workers pool their discoveries — one worker resolving alone
    sees ~1 new pod per TTL window; eight sharing see eight windows' worth.
    Called cheaply from the stream read loop, not just at recycles (a slow
    pod means recycles ~10 min apart — far too slow to learn the pool)."""
    now = time.time()
    if not force and now - _pod_state["last_refresh"] < POD_REFRESH_S:
        return
    _pod_state["last_refresh"] = now
    try:
        for info in _real_getaddrinfo(ENDPOINT_HOST, 443, socket.AF_INET,
                                      socket.SOCK_STREAM):
            _POD_POOL[info[4][0]] = now
    except OSError:
        pass
    try:
        path = os.path.join(OUT_DIR, "pod_pool.json")
        try:
            with open(path) as f:
                disk = json.load(f)
            if isinstance(disk, list):        # legacy ageless format: treat as
                disk = {ip: now - POD_TTL_S / 2 for ip in disk}   # half-aged
        except Exception:  # noqa: BLE001 — missing/corrupt file is fine
            disk = {}
        merged = {}
        for src in (disk, _POD_POOL):
            for ip, ts in src.items():
                merged[ip] = max(merged.get(ip, 0), ts)
        # (a) AGE-OUT: the pool is a rolling window of DNS-fresh pods, never an
        # append-only set — a fleet-wide pod rotation must purge it naturally.
        merged = {ip: ts for ip, ts in merged.items() if now - ts <= POD_TTL_S}
        if merged != disk:
            tmp = f"{path}.tmp{os.getpid()}"
            with open(tmp, "w") as f:
                json.dump(merged, f)
            os.rename(tmp, path)
        _POD_POOL.clear()
        _POD_POOL.update(merged)
    except Exception:  # noqa: BLE001 — the shared file is best-effort
        pass


def _live_pods():
    now = time.time()
    return [ip for ip, ts in _POD_POOL.items()
            if now - ts <= POD_TTL_S and ip not in _POD_BLOCKED]


def block_pod(ip):
    """(c) Negative health caching: a pod that answered 4xx is dead to this
    process — drop it from the pool and never re-pick it."""
    if ip:
        _POD_BLOCKED.add(ip)
        _POD_POOL.pop(ip, None)


def _is_transient(err):
    """Vendor-side trouble (retry/wait), as opposed to a dead pod (4xx) or a
    real error. String-matched because botocore surfaces these many ways.
    Timeouts are transient too (2025-08-06 burned twice on ReadTimeoutError
    being treated as a date-failure): "ReadTimeout"/"ConnectTimeout" match
    botocore's ReadTimeoutError/ConnectTimeoutError and the requests/urllib3
    class names; "TimeoutError"/"timed out" catch socket-level variants.
    "EndpointConnectionError" is the same family — the network's moment, not
    the date's fault (2026-01-08 was marked failed on one)."""
    return any(s in err for s in ("503", "500", "502", "504",
                                  "ServiceUnavailable", "SlowDown",
                                  "InternalError",
                                  "ReadTimeout", "ConnectTimeout",
                                  "TimeoutError", "timed out",
                                  "EndpointConnectionError"))


def choose_pod(last_segment_mbs=None):
    """Pick the pod for the next connection; returns the chosen IP (or None to
    use plain DNS when no live pod is known — plain DNS always serves a live
    pod by construction)."""
    _refresh_pod_pool(force=True)
    cur = _pod_choice["ip"]
    live = _live_pods()
    if (cur in live and last_segment_mbs is not None
            and last_segment_mbs >= POD_KEEP_MBS):
        return cur                                   # win-stay
    others = [ip for ip in live if ip != cur] or live
    _pod_choice["ip"] = random.choice(others) if others else None
    return _pod_choice["ip"]
N_LAST_QUOTES = 10
WINDOWS_ET = [  # (label, start hh:mm, end hh:mm) — end-inclusive
    ("open",   (9, 30),  (10, 5)),
    ("midday", (12, 45), (13, 0)),
    ("close",  (15, 0),  (15, 35)),
]
PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT_DIR = os.path.join(PROJECT_ROOT, "data", "extracts")
CHUNK = 8 * 1024 * 1024


def s3_client():
    return boto3.client(
        "s3", endpoint_url=ENDPOINT,
        aws_access_key_id=os.environ["MASSIVE_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["MASSIVE_S3_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )


UNIVERSE_PATH = os.path.join(PROJECT_ROOT, "data", "universe_extract.json")


SCAN_UNIVERSE_PATH = os.path.join(PROJECT_ROOT, "data", "universe.json")


def opra_root(ticker):
    """yfinance→OPRA symbology map (2026-08-28): OPRA option roots strip
    share-class punctuation — BRK-B options trade under root BRKB — while
    the universe files store yfinance/Wikipedia style (dashes/dots). The
    old exact-root match on the raw ticker therefore never captured BRK-B
    in ANY extract of either era (see docs/private/UNIVERSE_GAP_LEDGER.md).
    Plain alphanumeric tickers pass through untouched. Any consumer that
    looks a scan-universe name up against extract `underlying` values (the
    replay's chain provider, coverage audits) must apply this same map."""
    return re.sub(r"[^A-Z0-9]", "", ticker.upper())


def load_universe_roots(path=None):
    """Extraction universe: the $50B SUPERSET (data/universe_extract.json),
    deliberately wider than the scan's $100B data/universe.json so future
    point-in-time universe corrections are replay-side filters, not
    re-extractions. The replay applies the real >$100B logic itself.
    Tickers are returned as OPRA roots (see opra_root) — the parquet
    `underlying` column carries these, e.g. BRKB for BRK-B."""
    with open(path or UNIVERSE_PATH) as f:
        uni = json.load(f)
    roots = sorted({opra_root(t) for lst in uni["sectors"].values() for t in lst})
    return roots


def assert_universe_superset(extract_path=None, scan_path=None):
    """Defense in depth (2026-08-27): the extraction universe must contain
    every scan-universe name, else the extract silently loses scan coverage
    (the 2026-08-07 universe build dropped 12 S&P mega-caps — MU, JPM, XOM,
    HD, ... — and 132 extracts were banked without them before the ml-
    comparison surfaced it). Called at the top of extract_day(), before a
    single byte is streamed, so a stale/broken universe file on any box
    fails the date loudly instead of banking a gapped extract.

    Returns (n_extract, n_scan) on success; raises RuntimeError naming the
    missing tickers on violation."""
    def _tickers(path):
        with open(path) as f:
            return {t for lst in json.load(f)["sectors"].values() for t in lst}

    extract = _tickers(extract_path or UNIVERSE_PATH)
    scan = _tickers(scan_path or SCAN_UNIVERSE_PATH)
    missing = sorted(scan - extract)
    if missing:
        raise RuntimeError(
            f"extraction universe is missing {len(missing)} scan-universe "
            f"name(s): {missing} — refusing to extract with a gapped "
            f"universe (rebuild data/universe_extract.json with "
            f"--require-superset-of data/universe.json and redeploy)")
    return len(extract), len(scan)


def _extract_schema():
    """The exact arrow schema of the output parquet (string / int64 / double
    only; ns timestamps are int64 with 0-sentinels, NEVER floats/nulls).
    Explicit so a batch that happens to lack variation (e.g. an all-'day'-rows
    batch with all-None spread stats) can never drift the schema.

    Schema v2 (2026-08-07): adds bid_upd_count/ask_upd_count after
    two_sided_count. Files extracted before this date lack the two columns —
    readers select by name and tolerate both generations."""
    import pyarrow as pa
    fields = [
        ("date", pa.string()), ("underlying", pa.string()),
        ("contract", pa.string()), ("window", pa.string()),
        ("update_count", pa.int64()), ("two_sided_count", pa.int64()),
        ("bid_upd_count", pa.int64()), ("ask_upd_count", pa.int64()),
        ("spread_min", pa.float64()), ("spread_max", pa.float64()),
        ("spread_mean", pa.float64()),
        ("mid_open", pa.float64()), ("mid_high", pa.float64()),
        ("mid_low", pa.float64()), ("mid_close", pa.float64()),
        ("first_ts", pa.int64()), ("last_ts", pa.int64()),
        ("last_bid_size", pa.int64()), ("last_ask_size", pa.int64()),
    ]
    for qi in range(1, N_LAST_QUOTES + 1):
        fields += [
            (f"q{qi}_ask_exch", pa.int64()), (f"q{qi}_ask", pa.float64()),
            (f"q{qi}_ask_size", pa.int64()), (f"q{qi}_bid_exch", pa.int64()),
            (f"q{qi}_bid", pa.float64()), (f"q{qi}_bid_size", pa.int64()),
            (f"q{qi}_ts", pa.int64()),
        ]
    return pa.schema(fields)


def window_bounds_ns(date_str):
    """DST-correct ET window bounds for the date, as (label, lo_ns, hi_ns)."""
    et = ZoneInfo("America/New_York")
    y, m, d = (int(x) for x in date_str.split("-"))
    out = []
    for label, (h1, m1), (h2, m2) in WINDOWS_ET:
        lo = int(datetime(y, m, d, h1, m1, tzinfo=et).timestamp() * 1_000_000_000)
        hi = int(datetime(y, m, d, h2, m2, tzinfo=et).timestamp() * 1_000_000_000)
        out.append((label, lo, hi))
    return out


class ContractState:
    __slots__ = ("ticker", "underlying", "day_count", "day_first_ts",
                 "day_last_ts", "windows", "widx", "windows_done")

    def __init__(self, ticker, underlying, n_windows):
        self.ticker = ticker
        self.underlying = underlying
        self.day_count = 0
        self.day_first_ts = None   # bytes
        self.day_last_ts = None    # bytes
        # per window: [count, two_sided, sp_min, sp_max, sp_sum, mo, mh, ml, mc,
        #              deque, f_ts, l_ts, prev_bid, prev_ask, bid_upd, ask_upd]
        # bid_upd/ask_upd (2026-08-07): rows whose bid (ask) differs from the
        # previous in-window row's — quote-side update activity, a cheap
        # microstructure feature. First in-window row counts as both.
        self.windows = [None] * n_windows
        self.widx = 0              # window cursor (persists across partitions)
        self.windows_done = False


def extract_day(date_str, limit_bytes=None, log=print, reconnect_bytes=None):
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, "day_aggs"), exist_ok=True)
    # A byte-limited run is a smoke test: name it .partial so it never counts
    # as a finished (immutable) extract for resume purposes.
    suffix = ".partial.parquet" if limit_bytes else ".parquet"
    out_path = os.path.join(OUT_DIR, f"{date_str}{suffix}")
    if not limit_bytes and os.path.exists(out_path):
        log(f"[{date_str}] extract exists, skipping (immutable)")
        return None

    # Universe guard — fail before streaming a byte (see assert_universe_superset).
    n_extract, n_scan = assert_universe_superset()
    log(f"[{date_str}] universe OK: {n_extract} extract roots ⊇ {n_scan} scan names")

    # (b) The pre-stream calls (day_aggs GET, quotes HEAD) run BEFORE any
    # ResumableBody re-roll logic exists — a stale pinned pod carried over
    # from a previous date would 403 them and fail the whole date (the
    # 2026-08-15 burn). Plain DNS for everything until the stream opens.
    _pod_choice["ip"] = None

    s3 = s3_client()
    y, m, _d = date_str.split("-")

    def _retry_5xx(fn, what, attempts=4):
        """Pre-stream calls ride plain DNS but still see vendor 5xx storms
        (2026-08-20); ride out short ones here, let longer ones raise to the
        worker's circuit breaker."""
        for i in range(attempts):
            try:
                return fn()
            except Exception as e:  # noqa: BLE001
                if _is_transient(str(e)) and i < attempts - 1:
                    log(f"[{date_str}] {what}: transient vendor error — "
                        f"retry {i + 1} in 30s", flush=True)
                    time.sleep(30)
                    continue
                raise

    # day_aggs first (tiny) — stored verbatim
    da_path = os.path.join(OUT_DIR, "day_aggs", f"{date_str}.csv.gz")
    if not os.path.exists(da_path):
        obj = _retry_5xx(
            lambda: s3.get_object(Bucket=BUCKET, Key=f"us_options_opra/day_aggs_v1/{y}/{m}/{date_str}.csv.gz"),
            "day_aggs GET")
        with open(da_path + ".tmp", "wb") as f:
            f.write(obj["Body"].read())
        os.rename(da_path + ".tmp", da_path)
        log(f"[{date_str}] day_aggs saved ({os.path.getsize(da_path)/1e6:.1f} MB)")

    roots = load_universe_roots()
    roots_set = {r.encode() for r in roots}
    windows = window_bounds_ns(date_str)
    w_lo_b = [str(lo).encode() for _, lo, _ in windows]
    w_hi_b = [str(hi).encode() for _, _, hi in windows]
    n_win = len(windows)

    key = f"us_options_opra/quotes_v1/{y}/{m}/{date_str}.csv.gz"
    head = _retry_5xx(lambda: s3.head_object(Bucket=BUCKET, Key=key), "quotes HEAD")
    total_bytes = head["ContentLength"]
    end_byte = (min(limit_bytes, total_bytes) if limit_bytes else total_bytes) - 1
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)

    class ResumableBody:
        """S3 stream that survives connection drops on multi-hour GETs.

        gzip state lives in `d` (in-process), so a network failure only needs
        the HTTP stream re-opened at the current byte offset — decompression
        continues seamlessly. (This is what turned the 07-20/07-23 overlap
        runs into rc=1 IncompleteReadError crashes before it existed.)
        """

        def __init__(s):
            s.pos = 0
            s.body = None
            s.retries = 0
            s.since_open = 0
            s.opened_at = None
            s.pod_rolls = 0
            s._open()

        def _segment_mbs(s):
            if s.opened_at is None or s.since_open == 0:
                return None
            dt = time.time() - s.opened_at
            return (s.since_open / 1e6 / dt) if dt > 0 else None

        def _open(s, force_reroll=False):
            """Open (or re-open) the ranged stream. _open is reached from
            __init__, the 1 GB recycle, and the read-error path — none of
            which may die on a pod that rotated away inside the 2 h aging
            window. A 4xx here blocks the pod and re-rolls; the final
            attempt pins nothing (plain DNS always resolves to a live pod)."""
            nonlocal s3
            seg = None if force_reroll else s._segment_mbs()
            for attempt in range(6):
                prev = _pod_choice["ip"]
                if attempt == 5:
                    _pod_choice["ip"] = None      # last resort: plain DNS
                    pod = None
                else:
                    pod = choose_pod(last_segment_mbs=seg)
                    seg = None                    # win-stay only on 1st attempt
                if pod != prev:
                    s.pod_rolls += 1
                    log(f"[{date_str}] pod re-roll -> {pod} "
                        f"(pool {len(_POD_POOL)}, open attempt {attempt + 1})",
                        flush=True)
                try:
                    obj = s3.get_object(Bucket=BUCKET, Key=key,
                                        Range=f"bytes={s.pos}-{end_byte}")
                    s.body = obj["Body"]
                    s.since_open = 0
                    s.opened_at = time.time()
                    return
                except Exception as e:  # noqa: BLE001
                    err = str(e)
                    if "403" in err or "AccessDenied" in err or "Forbidden" in err:
                        log(f"[{date_str}] open hit dead pod "
                            f"{_pod_choice['ip']} — blocked, re-rolling",
                            flush=True)
                        block_pod(_pod_choice["ip"])
                        _pod_choice["ip"] = None
                        continue
                    if _is_transient(err):
                        # 5xx = vendor-side trouble, NOT a dead pod: back off,
                        # re-roll without blocklisting (2026-08-20 incident: a
                        # 503 storm burned the whole claim range because 5xx
                        # fell through to raise)
                        wait = min(60, 10 * (attempt + 1))
                        log(f"[{date_str}] open got transient vendor error "
                            f"({err[:60]}) — waiting {wait}s, re-rolling",
                            flush=True)
                        _pod_choice["ip"] = None
                        time.sleep(wait)
                        continue
                    raise                          # anything else: caller's problem
            raise IOError(f"[{date_str}] stream open failed even via plain DNS")

        def read(s, n):
            nonlocal s3
            if s.pos > end_byte:
                return b""
            _refresh_pod_pool()   # throttled internally; grows the shared pool
            # Proactive connection recycle: per-stream throughput decays over a
            # connection's lifetime on Massive's side (measured 16-18 MB/s at
            # open -> 2.3 MB/s after ~21 h). A fresh ranged GET at the current
            # offset resets the server-side pacing; gzip state is in-process so
            # this is exactly the resume path, invoked proactively.
            if reconnect_bytes and s.since_open >= reconnect_bytes:
                log(f"[{date_str}] recycling connection at {s.pos/1e9:.1f} GB "
                    f"(--reconnect-every-gb)", flush=True)
                try:
                    s.body.close()
                except Exception:  # noqa: BLE001
                    pass
                s3 = s3_client()
                s._open()
            for attempt in range(8):
                try:
                    chunk = s.body.read(n)
                    if not chunk and s.pos <= end_byte:
                        raise IOError(f"stream ended early at {s.pos}/{end_byte + 1}")
                    s.pos += len(chunk)
                    s.since_open += len(chunk)
                    return chunk
                except Exception as e:  # noqa: BLE001 — resume on any stream error
                    s.retries += 1
                    err = str(e)
                    if "403" in err or "AccessDenied" in err or "Forbidden" in err:
                        # a 4xx from a pinned pod = dead/rotated pod, not
                        # congestion — blocklist it so lose-shift can't return
                        block_pod(_pod_choice["ip"])
                        _pod_choice["ip"] = None
                    wait = min(60, 2 ** attempt)
                    log(f"[{date_str}] stream error at {s.pos/1e9:.1f} GB "
                        f"({type(e).__name__}: {e}) — resuming in {wait}s "
                        f"(retry {s.retries})", flush=True)
                    time.sleep(wait)
                    try:
                        s.body.close()
                    except Exception:
                        pass
                    s3 = s3_client()      # fresh client + connection pool
                    s._open(force_reroll=True)   # error = assume the pod is bad
            raise IOError(f"[{date_str}] giving up after repeated stream failures at {s.pos}")

    body = ResumableBody()

    import pandas as pd
    import pyarrow as pa
    import pyarrow.parquet as pq
    results = []          # flushed per-contract dicts (drained per batch at end of stream)
    states = {}           # contract ticker bytes -> ContractState (merges partitions)
    cur = None            # ContractState of the active contract (None = not universe)
    cur_prefix = b""      # active contract ticker + b','
    in_universe = False
    lines_total = 0
    kept_rows = 0
    downloaded = 0
    next_log = 2 * 1024 ** 3
    tail = b""
    t0 = time.time()
    header_checked = False

    def flush(state):
        if state is None:
            return
        base = dict(underlying=state.underlying.decode(), contract=state.ticker.decode())
        for wi, wstate in enumerate(state.windows):
            if wstate is None:
                continue
            (count, two_sided, sp_min, sp_max, sp_sum, mo, mh, ml, mc, dq, f_ts, l_ts,
             _pb, _pa, bid_upd, ask_upd) = wstate
            row = dict(base)
            row.update(
                window=windows[wi][0], update_count=count, two_sided_count=two_sided,
                bid_upd_count=bid_upd, ask_upd_count=ask_upd,
                spread_min=sp_min, spread_max=sp_max,
                spread_mean=(sp_sum / two_sided) if two_sided else None,
                mid_open=mo, mid_high=mh, mid_low=ml, mid_close=mc,
                first_ts=int(f_ts), last_ts=int(l_ts),
            )
            parts = [raw.split(b",") for raw in dq]   # ≤10 rows; full parse here only
            last = parts[-1]
            row["last_bid_size"] = int(last[6]) if last[6] else 0
            row["last_ask_size"] = int(last[3]) if last[3] else 0
            # RIGHT-aligned: q10 is ALWAYS the newest quote in the window (the
            # replay's slot quote); q1..q(10-k) are null when only k were seen.
            pad = N_LAST_QUOTES - len(parts)
            for qi in range(N_LAST_QUOTES):
                if qi >= pad:
                    p = parts[qi - pad]
                    row[f"q{qi+1}_ask_exch"] = int(p[1]) if p[1] else 0
                    row[f"q{qi+1}_ask"] = float(p[2]) if p[2] else 0.0
                    row[f"q{qi+1}_ask_size"] = int(p[3]) if p[3] else 0
                    row[f"q{qi+1}_bid_exch"] = int(p[4]) if p[4] else 0
                    row[f"q{qi+1}_bid"] = float(p[5]) if p[5] else 0.0
                    row[f"q{qi+1}_bid_size"] = int(p[6]) if p[6] else 0
                    row[f"q{qi+1}_ts"] = int(p[8])
                else:
                    # 0-sentinels, NOT None: a None anywhere makes pandas cast
                    # the column to float64, which silently destroys the low
                    # bits of ns timestamps (> 2^53). q_ts == 0 marks absence.
                    row[f"q{qi+1}_ask_exch"] = 0
                    row[f"q{qi+1}_ask"] = 0.0
                    row[f"q{qi+1}_ask_size"] = 0
                    row[f"q{qi+1}_bid_exch"] = 0
                    row[f"q{qi+1}_bid"] = 0.0
                    row[f"q{qi+1}_bid_size"] = 0
                    row[f"q{qi+1}_ts"] = 0
            results.append(row)
        if state.day_count:
            row = dict(base)
            row.update(window="day", update_count=state.day_count,
                       two_sided_count=0, bid_upd_count=0, ask_upd_count=0,
                       spread_min=None, spread_max=None, spread_mean=None,
                       mid_open=None, mid_high=None, mid_low=None, mid_close=None,
                       first_ts=int(state.day_first_ts), last_ts=int(state.day_last_ts),
                       last_bid_size=0, last_ask_size=0)
            for qi in range(N_LAST_QUOTES):
                row[f"q{qi+1}_ask_exch"] = 0
                row[f"q{qi+1}_ask"] = 0.0
                row[f"q{qi+1}_ask_size"] = 0
                row[f"q{qi+1}_bid_exch"] = 0
                row[f"q{qi+1}_bid"] = 0.0
                row[f"q{qi+1}_bid_size"] = 0
                row[f"q{qi+1}_ts"] = 0
            results.append(row)

    while True:
        chunk = body.read(CHUNK)
        if not chunk:
            break
        downloaded += len(chunk)
        data = tail + d.decompress(chunk)
        rows = data.split(b"\n")
        tail = rows.pop()
        if not header_checked and rows:
            hdr = rows[0]
            assert hdr.startswith(b"ticker,ask_exchange,ask_price"), f"unexpected header: {hdr!r}"
            rows = rows[1:]
            header_checked = True
        lines_total += len(rows)

        # Run-based processing. The file is (ticker, timestamp)-sorted, so each
        # contract's rows form one contiguous run (possibly spanning chunks).
        # At each contract boundary we find the run's end within this chunk by
        # galloping + binary search on `startswith` (O(log run) probes), then:
        #   - non-universe runs are skipped whole;
        #   - universe runs bulk-advance the DAY counters (never per-row);
        #   - window slices inside a run are located by binary search on the
        #     19-digit timestamp bytes (time-sorted within a contract), and
        #     ONLY those rows get fully parsed.
        i = 0
        n = len(rows)
        while i < n:
            r = rows[i]
            if not (cur_prefix and r.startswith(cur_prefix)):
                # contract boundary
                cur = None
                ci = r.find(b",")
                if ci <= 2:                 # empty/malformed line — reset state
                    cur_prefix = b""
                    in_universe = False
                    i += 1
                    continue
                sym = r[2:ci]               # strip 'O:'
                cur_prefix = r[:ci + 1]
                root = sym[:-15] if len(sym) > 15 else None
                in_universe = root in roots_set
                if in_universe:
                    ticker = cur_prefix[:-1]
                    cur = states.get(ticker)
                    if cur is None:
                        cur = states[ticker] = ContractState(ticker, root, n_win)

            # find last index j of this contract's run within rows[i:]
            j = i
            step = 512
            while j + step < n and rows[j + step].startswith(cur_prefix):
                j += step
                step *= 4
            lo_s, hi_s = j, min(j + step, n)
            while lo_s + 1 < hi_s:
                mid = (lo_s + hi_s) // 2
                if rows[mid].startswith(cur_prefix):
                    lo_s = mid
                else:
                    hi_s = mid
            j = lo_s

            if not in_universe:
                i = j + 1
                continue

            st = cur
            first_ts = rows[i][-19:]
            last_ts = rows[j][-19:]
            st.day_count += j - i + 1
            if st.day_first_ts is None or first_ts < st.day_first_ts:
                st.day_first_ts = first_ts
            if st.day_last_ts is None or last_ts > st.day_last_ts:
                st.day_last_ts = last_ts

            widx = st.widx
            windows_done = st.windows_done
            while not windows_done and widx < n_win:
                lo_b, hi_b = w_lo_b[widx], w_hi_b[widx]
                if last_ts < lo_b:
                    break                   # window opens after this run ends
                if first_ts > hi_b:
                    widx += 1               # run starts past this window
                    if widx >= n_win:
                        windows_done = True
                    continue
                # overlap: binary-search the in-window slice [a, b] by ts bytes
                a_lo, a_hi = i, j
                while a_lo < a_hi:
                    m = (a_lo + a_hi) // 2
                    if rows[m][-19:] < lo_b:
                        a_lo = m + 1
                    else:
                        a_hi = m
                a = a_lo
                if rows[a][-19:] > hi_b:    # nothing actually inside the window
                    if last_ts > hi_b:
                        widx += 1
                        if widx >= n_win:
                            windows_done = True
                        continue
                    break
                b_lo, b_hi = a, j
                while b_lo < b_hi:
                    m = (b_lo + b_hi + 1) // 2
                    if rows[m][-19:] <= hi_b:
                        b_lo = m
                    else:
                        b_hi = m - 1
                b = b_lo

                w = st.windows[widx]
                if w is None:
                    w = [0, 0, None, None, 0.0, None, None, None, None,
                         deque(maxlen=N_LAST_QUOTES), rows[a][-19:], rows[b][-19:],
                         None, None, 0, 0]
                    st.windows[widx] = w
                w[0] += b - a + 1
                w[11] = rows[b][-19:]
                kept_rows += b - a + 1
                for r2 in rows[a:b + 1]:
                    p = r2.split(b",", 6)   # only fields 0-5 needed per-row
                    ask = float(p[2]) if p[2] != b"0" else 0.0
                    bid = float(p[5]) if p[5] != b"0" else 0.0
                    if bid != w[12]:
                        w[14] += 1
                        w[12] = bid
                    if ask != w[13]:
                        w[15] += 1
                        w[13] = ask
                    if bid > 0 and ask > 0:
                        w[1] += 1
                        sp = ask - bid
                        mid = (ask + bid) / 2
                        if w[2] is None or sp < w[2]:
                            w[2] = sp
                        if w[3] is None or sp > w[3]:
                            w[3] = sp
                        w[4] += sp
                        if w[5] is None:
                            w[5] = mid
                        if w[6] is None or mid > w[6]:
                            w[6] = mid
                        if w[7] is None or mid < w[7]:
                            w[7] = mid
                        w[8] = mid
                    w[9].append(r2)         # raw row; fully split only at flush

                if last_ts > hi_b:
                    widx += 1
                    if widx >= n_win:
                        windows_done = True
                else:
                    break                   # run ends inside this window

            st.widx = widx
            st.windows_done = windows_done
            i = j + 1

        if downloaded >= next_log:
            next_log += 2 * 1024 ** 3
            el = time.time() - t0
            log(f"[{date_str}] {downloaded/1e9:.1f}/{total_bytes/1e9:.0f} GB "
                f"({downloaded/1e6/el:.1f} MB/s, {lines_total/1e6:.0f}M lines, "
                f"{len(states)} contracts tracked, {el/60:.0f}m)", flush=True)

    # End of stream: flush every tracked contract (partitions merged in
    # `states`) THROUGH an incremental parquet writer — never more than one
    # batch of row dicts + its arrow table in memory. Same columns/dtypes as
    # the old single-shot writer (schema is pinned); only row-group layout
    # differs. The state dict itself cannot be flushed earlier: partition
    # recurrence means no contract is final before physical EOF.
    schema = _extract_schema()
    total_rows = 0
    win_rows = 0
    writer = pq.ParquetWriter(out_path + ".tmp", schema)

    def write_batch():
        nonlocal total_rows, win_rows
        if not results:
            return
        df = pd.DataFrame(results)
        results.clear()
        df.insert(0, "date", date_str)
        total_rows += len(df)
        win_rows += int((df["window"] != "day").sum())
        writer.write_table(pa.Table.from_pandas(df, schema=schema, preserve_index=False))

    try:
        for st in states.values():
            flush(st)
            if len(results) >= 100_000:
                write_batch()
        write_batch()
    finally:
        writer.close()
    el = time.time() - t0

    os.rename(out_path + ".tmp", out_path)
    size = os.path.getsize(out_path)
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mb = peak / 1e6 if sys.platform == "darwin" else peak / 1e3  # bytes vs KB
    log(f"[{date_str}] DONE in {el/60:.1f} min: {downloaded/1e9:.1f} GB streamed "
        f"({downloaded/1e6/el:.1f} MB/s sustained), {lines_total/1e6:.0f}M lines scanned, "
        f"{kept_rows/1e6:.1f}M in-window rows, {total_rows} extract rows "
        f"({win_rows} window + {total_rows - win_rows} day), "
        f"{size/1e6:.1f} MB parquet, peak RSS {peak_mb:.0f} MB")
    return dict(date=date_str, seconds=el, bytes=downloaded, mb_s=downloaded / 1e6 / el,
                lines=lines_total, kept=kept_rows, rows=total_rows, parquet_bytes=size)


def main():
    ap = argparse.ArgumentParser(description="Extract universe quote windows from OPRA flat files")
    ap.add_argument("--date", action="append", required=True, help="YYYY-MM-DD (repeatable)")
    ap.add_argument("--limit-gb", type=float, default=None,
                    help="Smoke test: stop after N GB downloaded (extract is partial; not renamed final)")
    ap.add_argument("--reconnect-every-gb", type=float, default=None,
                    help="Proactively recycle the S3 connection every N GB (per-stream "
                         "throughput decays over connection lifetime; a fresh ranged GET "
                         "resets it — same mechanism as the error-resume path)")
    ap.add_argument("--universe", default=None,
                    help="override universe JSON (default data/universe_extract.json)")
    args = ap.parse_args()
    if args.universe:
        global UNIVERSE_PATH
        UNIVERSE_PATH = args.universe
    limit = int(args.limit_gb * 1e9) if args.limit_gb else None
    reconnect = int(args.reconnect_every_gb * 1e9) if args.reconnect_every_gb else None
    for date_str in args.date:
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            sys.exit(f"bad date: {date_str}")
        extract_day(date_str, limit_bytes=limit, reconnect_bytes=reconnect)


if __name__ == "__main__":
    main()
