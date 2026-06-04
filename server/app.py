"""
server/app.py
Flask API server — wraps existing options screener algo and exposes JSON endpoints.
Run with: python3 server/app.py
"""

import sys
import os

# Add project root to path so existing algo modules are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from datetime import datetime, date, time, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf

from options_screener import get_next_fridays, massive_client, TICKERS as DEFAULT_TICKERS
from event_filter import load_events, get_macro_events, get_earnings_flag
from screener import scan_ticker, get_fair_value

WEB_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist"
)

app = Flask(__name__, static_folder=None)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)

# ── Supabase auth ──────────────────────────────────────────────────────────────
_SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
_SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
_supabase = None
try:
    from supabase import create_client
    if _SUPABASE_URL and _SUPABASE_SERVICE_KEY:
        _supabase = create_client(_SUPABASE_URL, _SUPABASE_SERVICE_KEY)
except Exception:
    pass  # supabase package not installed — verify_token will return None


def verify_token(req):
    """Verify Supabase JWT from Authorization header. Returns user object or None."""
    if _supabase is None:
        return None
    auth = req.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth.split(' ', 1)[1]
    try:
        result = _supabase.auth.get_user(token)
        return result.user
    except Exception:
        return None


@app.errorhandler(Exception)
def handle_exception(e):
    """Catch-all — ensures every unhandled exception returns JSON, never an empty body."""
    import traceback
    return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

# Server-level state (per process — fine for local single-user use)
_last_run = None
_events_loaded_weeks = None  # tracks which weeks value the cache was built with


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _market_status():
    eastern = ZoneInfo("America/New_York")
    now_et = datetime.now(eastern)
    is_open = now_et.weekday() < 5 and time(9, 30) <= now_et.time() <= time(16, 0)
    return is_open, now_et.strftime("%Y-%m-%d %H:%M:%S %Z")


def _ensure_events(weeks=4):
    """Load (or reload) events for the given lookback window. Returns error string or None."""
    global _events_loaded_weeks
    if _events_loaded_weeks == weeks:
        return None
    try:
        load_events(weeks=weeks)
        _events_loaded_weeks = weeks
    except Exception as e:
        return str(e)
    return None


# ── Market context (VIX + SPY) ────────────────────────────────────────────────
# Both fields come from yfinance — Massive's Options plan blocks today's stock
# aggregates (SPY) and doesn't include indices data at all (VIX). See CLAUDE.md
# → "Data Provider Responsibilities" for the rationale. Fetched best-effort and
# cached across scans for 60s so back-to-back runs don't keep hitting yfinance.
# Used only for scan_runs logging — never fails the scan.
_market_context_cache = {"data": None, "timestamp": 0.0}
_MARKET_CONTEXT_TTL   = 60  # seconds


def _get_market_context():
    """Return {vix, spy_price}, either field may be None. Best-effort."""
    import time as _t
    now = _t.time()
    cached = _market_context_cache["data"]
    if cached is not None and (now - _market_context_cache["timestamp"]) < _MARKET_CONTEXT_TTL:
        age = now - _market_context_cache["timestamp"]
        print(f"[market_ctx] cache hit (age={age:.1f}s)", flush=True)
        return cached

    def _yf_last_close(symbol):
        """Latest non-NaN close from yfinance, or None on any failure."""
        try:
            hist = yf.Ticker(symbol).history(period='2d')
            if hist.empty:
                return None
            for c in reversed(hist['Close'].tolist()):
                f = _yf_float(c)
                if f is not None:
                    return f
        except Exception as e:
            print(f"[market_ctx] {symbol} fetch failed: {e}", flush=True)
        return None

    data = {
        "vix":       _yf_last_close("^VIX"),  # yfinance uses ^VIX, not I:VIX
        "spy_price": _yf_last_close("SPY"),
    }
    print(f"[market_ctx] fetched fresh: vix={data['vix']} spy_price={data['spy_price']}", flush=True)
    _market_context_cache["data"]      = data
    _market_context_cache["timestamp"] = now
    return data


# ── Scan history logging ──────────────────────────────────────────────────────
# Writes one row to `scan_runs` and a batch of rows to `scan_results`. All
# failures here are swallowed and printed to stderr — logging must never break
# the scan response. See docs/scan_history_schema.sql for table definitions.

def log_scan_run(*, user_id, tickers_requested, tickers_used, tickers_skipped,
                 weeks_min, weeks_max, min_premium, min_p_profit,
                 ranked, total_evaluated, market_open, elapsed_ms,
                 error_message, market_context):
    """
    Persist a scan run and all produced triplets.

    Returns:
        (scan_id, result_ids) where result_ids is parallel to `ranked` (same
        order). On any failure returns (None, []) and logs to stderr.
    """
    if _supabase is None or user_id is None:
        return None, []

    try:
        run_row = {
            "user_id":           str(user_id),
            "tickers_requested": list(tickers_requested or []),
            "tickers_used":      list(tickers_used      or []),
            "tickers_skipped":   list(tickers_skipped   or []),
            "weeks_min":         int(weeks_min),
            "weeks_max":         int(weeks_max),
            "min_premium":       float(min_premium),
            "min_p_profit":      float(min_p_profit),
            "total_evaluated":   int(total_evaluated),
            "total_passed":      len(ranked),
            "market_open":       bool(market_open) if market_open is not None else None,
            "elapsed_ms":        int(elapsed_ms) if elapsed_ms is not None else None,
            "error_message":     error_message,
            "vix":               market_context.get("vix")       if market_context else None,
            "spy_price":         market_context.get("spy_price") if market_context else None,
        }
        run_resp = _supabase.table("scan_runs").insert(run_row).execute()
        if not run_resp.data:
            return None, []
        scan_id = run_resp.data[0]["id"]

        if not ranked:
            return scan_id, []

        result_rows = []
        for i, r in enumerate(ranked, start=1):
            result_rows.append({
                "scan_id":       scan_id,
                "rank":          i,
                "ticker":        r["ticker"],
                "expiration":    r["expiration"],
                "week_num":      int(r["week"]),
                "leg_a_strike":  float(r["leg_a_strike"]),
                "leg_a_premium": float(r["leg_a_prem"]),
                "leg_a_delta":   float(r["leg_a_delta"]),
                "leg_b_strike":  float(r["leg_b_strike"]),
                "leg_b_premium": float(r["leg_b_prem"]),
                "leg_b_delta":   float(r["leg_b_delta"]),
                "leg_c_strike":  float(r["leg_c_strike"]),
                "leg_c_premium": float(r["leg_c_prem"]),
                "leg_c_delta":   float(r["leg_c_delta"]),
                "net_premium":   float(r["net_premium"]),
                "spread_width":  float(r["spread_width"]),
                "score":         float(r["score"]),
                "p_max_profit":  float(r["p_max_profit"]),
                "fair_value":    float(r["fair_value"]) if r.get("fair_value") is not None else None,
                "fv_available":  bool(r.get("fv_available", r.get("fair_value") is not None)),
            })

        # Insert in chunks to stay well under Supabase's per-request payload limit.
        result_ids = []
        CHUNK = 200
        for start in range(0, len(result_rows), CHUNK):
            chunk = result_rows[start:start + CHUNK]
            resp = _supabase.table("scan_results").insert(chunk).execute()
            if resp.data:
                result_ids.extend(row["id"] for row in resp.data)

        return scan_id, result_ids

    except Exception as e:
        print(f"[scan_history] log_scan_run failed: {e}", flush=True)
        return None, []


# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@app.route("/api/status")
def status():
    """Fast health-check — no external calls."""
    is_open, et_time = _market_status()
    return jsonify({
        "market_open":   is_open,
        "time_et":       et_time,
        "last_run":      _last_run,
        "events_loaded": _events_loaded_weeks is not None,
    })


@app.route("/api/events")
def events():
    """Return cached macro events. Loads them on first call."""
    err = _ensure_events()
    if err:
        return jsonify({"error": f"Failed to load events: {err}"}), 500
    return jsonify({"macro_events": get_macro_events()})


@app.route("/api/run", methods=["POST"])
def run():
    """
    Run a Call Spread Risk Reversal scan and return ranked triplets.

    Body (JSON, all optional):
        tickers       : list[str]  — ticker universe; omit for the default watchlist
        weeks_min     : int 1–12  — minimum expiration week (default 1)
        weeks_max     : int 1–12  — maximum expiration week (default 12)
        min_premium   : float     — minimum net credit in dollars (default 5.00)
        min_p_profit  : float 0–1 — minimum P(max profit) (default 0.50)

    Scan history is logged to Supabase tables `scan_runs` / `scan_results`
    automatically (best-effort — logging never fails the response).
    """
    import traceback
    import time as _t
    global _last_run

    body = request.get_json(silent=True) or {}
    requested_tickers   = body.get("tickers")
    requested_weeks_min = body.get("weeks_min", 1)
    requested_weeks_max = body.get("weeks_max", 12)
    requested_min_prem  = body.get("min_premium", 5.00)
    requested_min_pp    = body.get("min_p_profit", 0.50)

    # ── Validate (400 errors are not logged to scan_runs) ────────
    if not isinstance(requested_weeks_min, int) or not (1 <= requested_weeks_min <= 12):
        return jsonify({"error": "weeks_min must be an integer between 1 and 12"}), 400
    if not isinstance(requested_weeks_max, int) or not (1 <= requested_weeks_max <= 12):
        return jsonify({"error": "weeks_max must be an integer between 1 and 12"}), 400
    if requested_weeks_min > requested_weeks_max:
        return jsonify({"error": "weeks_min must be ≤ weeks_max"}), 400
    if not isinstance(requested_min_prem, (int, float)) or requested_min_prem < 0:
        return jsonify({"error": "min_premium must be a non-negative number"}), 400
    if not isinstance(requested_min_pp, (int, float)) or not (0 <= requested_min_pp <= 1):
        return jsonify({"error": "min_p_profit must be a float between 0 and 1"}), 400

    # ── Resolve tickers ──────────────────────────────────────────
    if requested_tickers:
        tickers_requested_clean = [t.lstrip('$').upper().strip() for t in requested_tickers if t.strip()]
        tickers = list(tickers_requested_clean)
    else:
        tickers_requested_clean = []
        tickers = list(DEFAULT_TICKERS)

    # Auth — best-effort. Scans still work without a token, just won't be logged.
    user = verify_token(request)
    user_id = user.id if user is not None else None

    market_ctx = _get_market_context()
    is_open, et_time = _market_status()

    started_at = _t.time()

    # ── Try the scan; on exception, log a scan_runs row with error_message ──
    try:
        # Load events
        err = _ensure_events(weeks=requested_weeks_max)
        if err:
            raise RuntimeError(f"Failed to load events: {err}")

        # Target expirations (filtered to [weeks_min, weeks_max])
        target_fridays = get_next_fridays(requested_weeks_max)
        week_exps = [
            (i + 1, f.strftime("%Y-%m-%d"))
            for i, f in enumerate(target_fridays)
            if requested_weeks_min <= (i + 1) <= requested_weeks_max
        ]

        # Scan each ticker
        all_triplets    = []
        total_evaluated = 0
        tickers_scanned = []

        for ticker in tickers:
            try:
                hist = yf.Ticker(ticker).history(period="1d")
                if hist.empty:
                    continue
                price = round(float(hist["Close"].iloc[-1]), 2)
            except Exception:
                continue

            fair_value = get_fair_value(ticker)

            tickers_scanned.append(ticker)
            triplets, evaluated = scan_ticker(
                ticker, price, week_exps, fair_value,
                float(requested_min_prem),
                min_p_profit=float(requested_min_pp),
            )
            total_evaluated += evaluated
            all_triplets.extend(triplets)

        ranked = sorted(all_triplets, key=lambda t: t["score"], reverse=True)
        tickers_used    = sorted(tickers_scanned)
        tickers_skipped = [t for t in tickers if t not in tickers_scanned]

        elapsed_ms = int((_t.time() - started_at) * 1000)

        scan_id, result_ids = log_scan_run(
            user_id            = user_id,
            tickers_requested  = tickers_requested_clean,
            tickers_used       = tickers_used,
            tickers_skipped    = tickers_skipped,
            weeks_min          = requested_weeks_min,
            weeks_max          = requested_weeks_max,
            min_premium        = float(requested_min_prem),
            min_p_profit       = float(requested_min_pp),
            ranked             = ranked,
            total_evaluated    = total_evaluated,
            market_open        = is_open,
            elapsed_ms         = elapsed_ms,
            error_message      = None,
            market_context     = market_ctx,
        )

        # Attach result_id to each ranked entry (in same order as logged).
        ranked_with_ids = []
        for i, r in enumerate(ranked):
            row = dict(r)
            row["result_id"] = result_ids[i] if i < len(result_ids) else None
            ranked_with_ids.append(row)

        # Per-ticker grouping for the overview cards. Purely a reorganization
        # of the already-ranked list (sorted by score desc) — no recomputation.
        # Each group keeps the ticker's single best (max-score) triplet plus a
        # count of how many qualifying triplets it produced. Groups are ordered
        # by best score descending so the strongest ticker's card comes first.
        by_ticker_map = {}
        for r in ranked_with_ids:
            t = r["ticker"]
            if t not in by_ticker_map:
                by_ticker_map[t] = {"ticker": t, "best": r, "count": 0}
            by_ticker_map[t]["count"] += 1
        by_ticker = sorted(
            by_ticker_map.values(),
            key=lambda g: g["best"]["score"],
            reverse=True,
        )

        run_at = datetime.today().strftime("%Y-%m-%d %H:%M:%S")
        _last_run = run_at

        return jsonify({
            "ranked":               ranked_with_ids,
            "by_ticker":            by_ticker,
            "scan_id":              scan_id,
            "macro_events":         get_macro_events(),
            "total_evaluated":      total_evaluated,
            "tickers_used":         tickers_used,
            "tickers_skipped":      tickers_skipped,
            "tickers_with_results": len(by_ticker),
            "market_open":          is_open,
            "time_et":              et_time,
            "run_at":               run_at,
            "weeks_min_used":       requested_weeks_min,
            "weeks_max_used":       requested_weeks_max,
            "min_premium_used":     float(requested_min_prem),
            "min_p_profit_used":    float(requested_min_pp),
            "elapsed_ms":           elapsed_ms,
        })

    except Exception as e:
        elapsed_ms = int((_t.time() - started_at) * 1000)
        log_scan_run(
            user_id            = user_id,
            tickers_requested  = tickers_requested_clean,
            tickers_used       = [],
            tickers_skipped    = list(tickers),
            weeks_min          = requested_weeks_min,
            weeks_max          = requested_weeks_max,
            min_premium        = float(requested_min_prem),
            min_p_profit       = float(requested_min_pp),
            ranked             = [],
            total_evaluated    = 0,
            market_open        = is_open,
            elapsed_ms         = elapsed_ms,
            error_message      = str(e),
            market_context     = market_ctx,
        )
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


# ─────────────────────────────────────────────────────────────
# Tradebook save endpoint
# ─────────────────────────────────────────────────────────────

@app.route("/api/tradebook/save", methods=["POST"])
def tradebook_save():
    """
    Save a triplet to tradebook and flip `was_saved` on the source scan_results row.

    Body (JSON):
        scan_id   : uuid | null  — source scan run (nullable; older trades pre-date logging)
        result_id : uuid | null  — source triplet row (nullable for the same reason)
        trade     : dict         — flat tradebook payload (strikes, premiums, deltas, …)

    The server fills in `user_id` from the verified JWT — clients may NOT spoof it.
    Returns the inserted tradebook row.
    """
    import traceback
    user = verify_token(request)
    if user is None:
        return jsonify({"error": "Not authenticated"}), 401
    if _supabase is None:
        return jsonify({"error": "Supabase not configured on server"}), 500

    body      = request.get_json(silent=True) or {}
    scan_id   = body.get("scan_id")    # may be None for legacy / unlinked saves
    result_id = body.get("result_id")  # may be None
    trade     = body.get("trade") or {}

    if not isinstance(trade, dict) or not trade.get("ticker") or not trade.get("expiration"):
        return jsonify({"error": "trade payload must include ticker and expiration"}), 400

    # Force server-controlled fields — clients cannot spoof user_id, scan_id, result_id.
    insert_row = dict(trade)
    insert_row["user_id"]   = str(user.id)
    insert_row["scan_id"]   = scan_id
    insert_row["result_id"] = result_id
    insert_row.pop("id", None)  # never accept a client-supplied PK

    try:
        ins = _supabase.table("tradebook").insert(insert_row).execute()
        saved = ins.data[0] if ins.data else None
    except Exception as e:
        return jsonify({"error": f"Tradebook insert failed: {e}",
                        "traceback": traceback.format_exc()}), 500

    # Flip was_saved on the linked scan_results row. Best-effort — a failure
    # here doesn't undo the save; we just print to stderr and move on.
    if result_id:
        try:
            _supabase.table("scan_results") \
                .update({"was_saved": True}) \
                .eq("id", result_id) \
                .execute()
        except Exception as e:
            print(f"[scan_history] failed to flip was_saved for {result_id}: {e}", flush=True)

    return jsonify({"trade": saved})


# ─────────────────────────────────────────────────────────────
# Options chain endpoint
# ─────────────────────────────────────────────────────────────

@app.route("/api/chain", methods=["GET"])
def chain():
    """
    Return the full options chain for a ticker/expiration/side via Massive.

    Query params:
        ticker     : str  — stock symbol (e.g. MU)
        expiration : str  — date string YYYY-MM-DD
        side       : str  — 'call' or 'put'

    Returns JSON array sorted by strike ascending, each entry:
        strike, premium, delta, volume, oi, iv
    Only contracts with 0.05 ≤ delta ≤ 0.85 and IV > 0.01 are returned.
    """
    import traceback
    try:
        ticker     = request.args.get("ticker", "").upper().strip()
        expiration = request.args.get("expiration", "").strip()
        side       = request.args.get("side", "call").lower().strip()

        if not ticker or not expiration:
            return jsonify({"error": "ticker and expiration are required"}), 400
        if side not in ("call", "put"):
            return jsonify({"error": "side must be 'call' or 'put'"}), 400

        try:
            raw = list(massive_client.list_snapshot_options_chain(
                ticker,
                params={
                    'expiration_date': expiration,
                    'contract_type':   side,
                    'limit':           250,
                }
            ))
        except Exception as e:
            return jsonify({"error": f"Could not load chain for {ticker} {expiration}: {e}"}), 400

        contracts = []
        for o in raw:
            if o.greeks is None or o.greeks.delta is None:
                continue
            iv_raw = o.implied_volatility
            if iv_raw is None or float(iv_raw) <= 0.01:
                continue
            if o.day is None or o.day.close is None:
                continue

            delta = round(abs(float(o.greeks.delta)), 4)
            if not (0.05 <= delta <= 0.85):
                continue

            volume = int(o.day.volume)    if o.day.volume    is not None else 0
            oi     = int(o.open_interest) if o.open_interest is not None else 0

            contracts.append({
                "strike":  round(float(o.details.strike_price), 2),
                "premium": round(float(o.day.close), 4),
                "delta":   delta,
                "volume":  volume,
                "oi":      oi,
                "iv":      round(float(iv_raw), 4),
            })

        contracts.sort(key=lambda c: c["strike"])
        return jsonify(contracts)

    except Exception as e:
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


# ─────────────────────────────────────────────────────────────
# Stock chart endpoint (price + volume + RSI)
# ─────────────────────────────────────────────────────────────

# `time as _time` to avoid shadowing `from datetime import time` above —
# that import is used by _market_status() for the 9:30 / 16:00 ET checks.
import time as _time

# Timeframe → (multiplier, timespan, days_back) for Massive list_aggs.
# 1D uses 1-hour bars (not 5-minute) because the Massive Options plan does
# not include sub-hourly stock aggregates — 5/15/30-min requests return 401
# NOT_AUTHORIZED. Hourly is included; ~7 bars per trading session is enough
# resolution for an at-a-glance intraday view.
_CHART_TIMEFRAMES = {
    "1D": (1,  "hour",     1),
    "5D": (1,  "hour",     7),
    "1M": (1,  "day",     35),   # ~1 month of trading days
    "3M": (1,  "day",     95),
    "6M": (1,  "day",    190),
    "1Y": (1,  "day",    370),
}

# Per-process in-memory cache for /api/chart responses. Keyed by (ticker, tf).
# Per-worker scope under gunicorn — fine since chart data only changes slowly.
# Each cache miss may hit yfinance (1D bars, header price for all timeframes),
# Massive (5D+ bars, RSI), or both; caching the whole response keeps the total
# outbound rate to at most one fetch per (ticker, tf) per TTL.
_chart_cache = {}
_CACHE_TTL = {  # seconds
    "1D":  60,   # intraday — refresh-friendly
    "5D":  60,
    "1M": 300,   # daily bars — barely change minute-to-minute
    "3M": 300,
    "6M": 300,
    "1Y": 300,
}
_chart_cache_hits   = 0
_chart_cache_misses = 0


def _get_cached_chart(ticker, timeframe):
    entry = _chart_cache.get((ticker, timeframe))
    if entry is None:
        return None
    if _time.time() - entry["timestamp"] >= _CACHE_TTL.get(timeframe, 300):
        return None
    return entry["data"]


def _set_cached_chart(ticker, timeframe, data):
    _chart_cache[(ticker, timeframe)] = {"data": data, "timestamp": _time.time()}


# ── yfinance helpers (today-only data — Massive Options plan doesn't cover this) ─
# The $30/mo Massive Options plan includes options + *historical* stock aggs but
# returns NOT_AUTHORIZED for any stock aggregate dated today. yfinance fills the
# gap by scraping Yahoo's public quotes for today's bars and the current price.
# See CLAUDE.md → "Data Provider Responsibilities" for the full split.

def _yf_float(v):
    """yfinance returns float('nan') for missing OHLC values — coerce to None."""
    if v is None:
        return None
    try:
        f = float(v)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


def _fetch_1d_bars_yfinance(ticker):
    """
    Fetch the most recent trading session's hourly bars via yfinance.

    Returns (bars, session_date_str) on success, or None if yfinance had no
    usable data (caller should fall back to Massive). `bars` is in the same
    shape as the Massive path: list of dicts with timestamp/open/high/low/close/volume.
    """
    try:
        hist = yf.Ticker(ticker).history(period='5d', interval='1h')
        if hist.empty:
            return None

        # Force ET tz so date bucketing matches everything else in this file.
        if hist.index.tz is None:
            hist.index = hist.index.tz_localize('America/New_York')
        else:
            hist.index = hist.index.tz_convert('America/New_York')

        # Pick the most recent trading date present in the response.
        dates = [ts.date() for ts in hist.index]
        if not dates:
            return None
        latest_date = max(dates)

        bars = []
        for idx, row in hist.iterrows():
            if idx.date() != latest_date:
                continue
            close = _yf_float(row.get('Close'))
            if close is None:
                continue
            vol = _yf_float(row.get('Volume'))
            bars.append({
                "timestamp": int(idx.timestamp() * 1000),
                "open":      _yf_float(row.get('Open')),
                "high":      _yf_float(row.get('High')),
                "low":       _yf_float(row.get('Low')),
                "close":     close,
                "volume":    int(vol) if vol is not None else 0,
            })

        if not bars:
            return None
        bars.sort(key=lambda b: b["timestamp"])
        return bars, latest_date.strftime('%Y-%m-%d')

    except Exception as e:
        print(f"[chart] yfinance 1D fetch failed for {ticker}: {e}", flush=True)
        return None


def _fetch_header_price_yfinance(ticker):
    """
    Fetch the latest price + previous day's close via yfinance for the chart
    header. Returns (current_price, prev_close, change_pct) on success, or None.
    """
    try:
        hist = yf.Ticker(ticker).history(period='2d')
        if hist.empty:
            return None
        closes = [c for c in hist['Close'].tolist() if c is not None and c == c]
        if not closes:
            return None
        current = float(closes[-1])
        prev    = float(closes[-2]) if len(closes) >= 2 else current
        change  = round(((current - prev) / prev) * 100, 2) if prev else 0.0
        return current, prev, change
    except Exception as e:
        print(f"[chart] yfinance header price failed for {ticker}: {e}", flush=True)
        return None


@app.route("/api/chart", methods=["GET"])
def chart():
    """
    Return OHLCV bars + RSI series for a ticker over a chosen timeframe.

    Query params:
        ticker    : str  — stock symbol
        timeframe : str  — one of 1D, 5D, 1M, 3M, 6M, 1Y (default 1M)

    Returns:
        {
          ticker, timeframe,
          current_price, prev_close, change_pct,
          bars: [{timestamp, open, high, low, close, volume}, ...],
          rsi:  [{timestamp, value}, ...]
        }
    """
    import traceback
    global _chart_cache_hits, _chart_cache_misses
    try:
        ticker    = request.args.get("ticker", "").upper().strip()
        timeframe = request.args.get("timeframe", "1M").upper().strip()

        if not ticker:
            return jsonify({"error": "ticker is required"}), 400
        if timeframe not in _CHART_TIMEFRAMES:
            return jsonify({"error": f"unknown timeframe: {timeframe}"}), 400

        # Cache check — avoid hitting Massive if a fresh response is on hand.
        cached = _get_cached_chart(ticker, timeframe)
        if cached is not None:
            _chart_cache_hits += 1
            return jsonify(cached)
        _chart_cache_misses += 1

        multiplier, timespan, days_back = _CHART_TIMEFRAMES[timeframe]
        eastern  = ZoneInfo("America/New_York")
        today_et = datetime.now(eastern).date()
        today_str = today_et.strftime("%Y-%m-%d")

        # ── OHLCV bars ──────────────────────────────────────────
        # 1D: yfinance is the primary source. Massive's Options plan returns
        # NOT_AUTHORIZED for any stock aggregate dated today, so we can never
        # get today's intraday from Massive — yfinance fills the gap. Massive
        # remains the fallback for edge cases (yfinance ticker unknown, network).
        # Other timeframes (5D/1M/3M/6M/1Y) request only historical bars, which
        # Massive's Options plan DOES include.
        bars             = []
        session_date_str = None  # only set for 1D — see frontend "Showing …" label

        if timeframe == "1D":
            yf_result = _fetch_1d_bars_yfinance(ticker)
            if yf_result is not None:
                bars, session_date_str = yf_result

            if not bars:
                # yfinance fallback — try Massive's single-call 7-day window,
                # bucket bars by ET calendar date, pick the most recent session.
                # (An earlier walk-back loop made day-by-day calls and tripped
                # Massive's weekend rate limit; single call avoids that.)
                from_date = (today_et - timedelta(days=7)).strftime("%Y-%m-%d")
                try:
                    all_aggs = list(massive_client.list_aggs(
                        ticker, multiplier, timespan, from_date, today_str, limit=50000,
                    ))
                except Exception as e:
                    return jsonify({"error": f"chart fetch failed: {e}"}), 502

                by_date = {}
                for a in all_aggs:
                    if a.timestamp is None:
                        continue
                    ts_et = datetime.fromtimestamp(a.timestamp / 1000, tz=eastern)
                    by_date.setdefault(ts_et.strftime("%Y-%m-%d"), []).append(a)

                if not by_date:
                    return jsonify({"error": f"No recent intraday data for {ticker}"}), 404

                session_date_str = max(by_date.keys())
                for a in by_date[session_date_str]:
                    if a.close is None:
                        continue
                    bars.append({
                        "timestamp": int(a.timestamp),
                        "open":      float(a.open)   if a.open   is not None else None,
                        "high":      float(a.high)   if a.high   is not None else None,
                        "low":       float(a.low)    if a.low    is not None else None,
                        "close":     float(a.close),
                        "volume":    int(a.volume)   if a.volume is not None else 0,
                    })
        else:
            from_date = (today_et - timedelta(days=days_back)).strftime("%Y-%m-%d")
            try:
                aggs = list(massive_client.list_aggs(
                    ticker, multiplier, timespan, from_date, today_str, limit=50000,
                ))
            except Exception as e:
                return jsonify({"error": f"chart fetch failed: {e}"}), 502

            for a in aggs:
                if a.close is None or a.timestamp is None:
                    continue
                bars.append({
                    "timestamp": int(a.timestamp),
                    "open":      float(a.open)   if a.open   is not None else None,
                    "high":      float(a.high)   if a.high   is not None else None,
                    "low":       float(a.low)    if a.low    is not None else None,
                    "close":     float(a.close),
                    "volume":    int(a.volume)   if a.volume is not None else 0,
                })

        if not bars:
            return jsonify({"error": f"No bar data for {ticker} ({timeframe})"}), 404

        bars.sort(key=lambda b: b["timestamp"])

        # Truthy only for 1D — non-1D timeframes use rolling windows where the
        # concept of "the session date" doesn't apply. The "Showing {date}"
        # label in the frontend fires when session_is_today is False (weekends,
        # holidays — when yfinance also can't give us today's data).
        session_is_today = (
            session_date_str == today_str
            if session_date_str is not None else None
        )

        # ── RSI (best-effort — return [] if endpoint unavailable) ──
        rsi_values = []
        try:
            rsi_resp = massive_client.get_rsi(
                ticker,
                timespan=timespan,
                window=14,
                limit=5000,
                series_type="close",
            )
            raw_values = getattr(rsi_resp, "values", None) or []
            for v in raw_values:
                ts  = getattr(v, "timestamp", None)
                val = getattr(v, "value",     None)
                if ts is None or val is None:
                    continue
                rsi_values.append({"timestamp": int(ts), "value": round(float(val), 2)})
            rsi_values.sort(key=lambda r: r["timestamp"])
        except Exception as rsi_err:
            # RSI is optional — log and return [] rather than failing the
            # whole chart request. Common cause: weekend rate-limit 429s.
            print(f"[chart] RSI fetch failed for {ticker} {timeframe}: {rsi_err}", flush=True)
            rsi_values = []

        # ── Summary ─────────────────────────────────────────────
        # Header price always tries yfinance first so the displayed price
        # matches what the scan actually uses (yfinance current-day quote).
        # Massive's last bar is the fallback — for timeframes where bars come
        # from Massive, that bar is yesterday's close, which is what users
        # would see during a yfinance outage.
        yf_price = _fetch_header_price_yfinance(ticker)
        if yf_price is not None:
            current_price, prev_close, change_pct = yf_price
        else:
            current_price = bars[-1]["close"]
            prev_close    = bars[-2]["close"] if len(bars) >= 2 else current_price
            change_pct    = round(((current_price - prev_close) / prev_close) * 100, 2) if prev_close else 0.0

        payload = {
            "ticker":           ticker,
            "timeframe":        timeframe,
            "current_price":    round(current_price, 2),
            "prev_close":       round(prev_close,    2),
            "change_pct":       change_pct,
            "session_date":     session_date_str,    # 1D only — null otherwise
            "session_is_today": session_is_today,    # bool for 1D, null otherwise
            "bars":             bars,
            "rsi":              rsi_values,
        }
        _set_cached_chart(ticker, timeframe, payload)
        return jsonify(payload)

    except Exception as e:
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route("/api/chart_cache_stats", methods=["GET"])
def chart_cache_stats():
    """Per-process cache stats — useful when verifying that the cache is
    actually serving repeat requests instead of going to Massive each time."""
    now = _time.time()
    keys = []
    for (ticker, tf), entry in _chart_cache.items():
        ttl = _CACHE_TTL.get(tf, 300)
        age = now - entry["timestamp"]
        keys.append({
            "ticker":         ticker,
            "timeframe":      tf,
            "age_seconds":    round(age, 1),
            "ttl_seconds":    ttl,
            "expires_in":     round(max(0, ttl - age), 1),
        })
    keys.sort(key=lambda k: (k["ticker"], k["timeframe"]))
    return jsonify({
        "entries": len(_chart_cache),
        "hits":    _chart_cache_hits,
        "misses":  _chart_cache_misses,
        "ttl":     _CACHE_TTL,
        "keys":    keys,
    })


# ─────────────────────────────────────────────────────────────
# Serve React SPA (must be registered after all /api/* routes)
# ─────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """
    Serve built React app for all non-API routes.
    If the path resolves to a real file in web/dist (e.g. assets/index-*.js),
    serve it directly. Otherwise fall back to index.html so React Router handles
    client-side routes like /trade and /tradebook.
    index.html is served with no-cache headers so rebuilds are picked up immediately.
    """
    if path:
        candidate = os.path.join(WEB_DIST, path)
        if os.path.isfile(candidate):
            return send_from_directory(WEB_DIST, path)
    response = send_from_directory(WEB_DIST, "index.html")
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Luo Capital — Options Screener API")
    print("Listening on http://localhost:5001")
    print("Endpoints: /api/status  /api/events  /api/run  /api/chain  /api/chart  /api/chart_cache_stats")
    app.run(host='0.0.0.0', port=5001)