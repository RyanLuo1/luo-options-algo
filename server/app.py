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

from options_screener import fetch_all_rows, DISTANCES as DEFAULT_DISTANCES, get_next_fridays, massive_client
from ratio_ranker import calculate_ratios
from event_filter import load_events, get_macro_events, get_earnings_flag
from v3_screener import scan_ticker as v3_scan_ticker, get_fair_value
import robinhood

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


@app.route("/api/holdings")
def holdings():
    """Fetch open stock positions from Robinhood. Returns 503 if unavailable."""
    try:
        detail = robinhood.get_holdings_detail()
        return jsonify({
            "tickers":   [p["ticker"] for p in detail],
            "positions": detail,
        })
    except Exception:
        return jsonify({
            "error": "Robinhood login unavailable. Use manual ticker input.",
            "robinhood_unavailable": True,
        }), 503


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
    Run a full options scan and return ranked results.

    Body (JSON, all optional):
        tickers: list[str]  — override ticker universe; omit to use Robinhood holdings
    """
    import traceback
    global _last_run

    try:
        body = request.get_json(silent=True) or {}
        requested_tickers = body.get("tickers")
        requested_distances = body.get("distances")
        requested_weeks = body.get("weeks", 4)

        # ── Validate distances ───────────────────────────────────
        if requested_distances is not None:
            if not isinstance(requested_distances, list) or len(requested_distances) == 0:
                return jsonify({"error": "distances must be a non-empty list of floats"}), 400
            for d in requested_distances:
                if not isinstance(d, (int, float)) or d < 0.01 or d > 0.50:
                    return jsonify({
                        "error": f"Each distance must be between 0.01 (1%) and 0.50 (50%). Got: {d}"
                    }), 400
            distances = [float(d) for d in requested_distances]
        else:
            distances = None  # will fall back to defaults inside fetch_all_rows

        # ── Validate weeks ───────────────────────────────────────
        if not isinstance(requested_weeks, int) or requested_weeks < 1 or requested_weeks > 12:
            return jsonify({"error": "weeks must be an integer between 1 and 12"}), 400
        weeks = requested_weeks

        # ── Resolve ticker universe ──────────────────────────────
        if requested_tickers:
            tickers = [t.lstrip('$').upper().strip() for t in requested_tickers if t.strip()]
            tickers_source = "manual"
        else:
            try:
                tickers = robinhood.get_holdings()
                tickers_source = "robinhood"
            except Exception:
                return jsonify({
                    "error": "Robinhood login unavailable. Use manual ticker input.",
                    "robinhood_unavailable": True,
                }), 503

        if not tickers:
            return jsonify({
                "error": "No tickers to scan. Enter tickers manually and click Run Scan."
            }), 400

        # ── Load events ──────────────────────────────────────────
        err = _ensure_events(weeks=weeks)
        if err:
            return jsonify({"error": f"Failed to load events: {err}"}), 500

        # ── Fetch options data ───────────────────────────────────
        all_rows = fetch_all_rows(verbose=False, tickers=tickers, distances=distances, weeks=weeks)
        effective_distances = distances if distances is not None else DEFAULT_DISTANCES

        # Tickers that came back with zero rows are skipped (no options chain available)
        tickers_with_data = sorted({r["Ticker"] for r in all_rows})
        tickers_skipped = [t for t in tickers if t not in tickers_with_data]

        # ── Rank ─────────────────────────────────────────────────
        ranked, duplicates_removed = calculate_ratios(all_rows)

        # ── Serialize + annotate ─────────────────────────────────
        output = []
        for i, r in enumerate(ranked, start=1):
            output.append({
                "rank":          i,
                "ticker":        r["Ticker"],
                "side":          r["Side"],
                "expiration":    r["Expiration"],
                "week":          r["Week"],
                "dist_pct":      r["Dist %"],
                "delta":         r["Delta"],
                "strike":        r["Strike"],
                "premium":       r["Premium"],
                "price":         r["Price"],
                "volume":        r.get("Volume"),
                "oi":            r.get("OI"),
                "ratio":         r["Ratio"],
                "earnings_flag": get_earnings_flag(r["Ticker"], r["Expiration"]),
            })

        is_open, et_time = _market_status()
        run_at = datetime.today().strftime("%Y-%m-%d %H:%M:%S")
        _last_run = run_at

        return jsonify({
            "ranked":             output,
            "macro_events":       get_macro_events(),
            "duplicates_removed": duplicates_removed,
            "market_open":        is_open,
            "time_et":            et_time,
            "run_at":             run_at,
            "tickers_used":       tickers_with_data,
            "tickers_skipped":    tickers_skipped,
            "tickers_source":     tickers_source,
            "total_ranked":       len(output),
            "distances_used":     effective_distances,
            "weeks_used":         weeks,
        })

    except Exception as e:
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route("/api/run_v3", methods=["POST"])
def run_v3():
    """
    Run a V3 Call Spread Risk Reversal scan and return ranked triplets.

    Body (JSON, all optional):
        tickers       : list[str]  — ticker universe; omit to use Robinhood holdings
        weeks_min     : int 1–12  — minimum expiration week (default 1)
        weeks_max     : int 1–12  — maximum expiration week (default 12)
        min_premium   : float     — minimum net credit in dollars (default 5.00)
        min_p_profit  : float 0–1 — minimum P(max profit) (default 0.50)
    """
    import traceback
    global _last_run

    try:
        body = request.get_json(silent=True) or {}
        requested_tickers   = body.get("tickers")
        requested_weeks_min = body.get("weeks_min", 1)
        requested_weeks_max = body.get("weeks_max", 12)
        requested_min_prem  = body.get("min_premium", 5.00)
        requested_min_pp    = body.get("min_p_profit", 0.50)

        # ── Validate ─────────────────────────────────────────────
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

        # ── Resolve tickers ──────────────────────────────────────
        if requested_tickers:
            tickers = [t.lstrip('$').upper().strip() for t in requested_tickers if t.strip()]
        else:
            try:
                tickers = robinhood.get_holdings()
            except Exception:
                return jsonify({
                    "error": "Robinhood login unavailable. Use manual ticker input.",
                    "robinhood_unavailable": True,
                }), 503

        if not tickers:
            return jsonify({"error": "No tickers to scan. Enter tickers manually and click Run Scan."}), 400

        # ── Load events ──────────────────────────────────────────
        err = _ensure_events(weeks=requested_weeks_max)
        if err:
            return jsonify({"error": f"Failed to load events: {err}"}), 500

        # ── Target expirations (filtered to [weeks_min, weeks_max]) ──
        target_fridays = get_next_fridays(requested_weeks_max)
        week_exps = [
            (i + 1, f.strftime("%Y-%m-%d"))
            for i, f in enumerate(target_fridays)
            if requested_weeks_min <= (i + 1) <= requested_weeks_max
        ]

        # ── Scan each ticker ─────────────────────────────────────
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
            triplets, evaluated = v3_scan_ticker(
                ticker, price, week_exps, fair_value,
                float(requested_min_prem),
                min_p_profit=float(requested_min_pp),
            )
            total_evaluated += evaluated
            all_triplets.extend(triplets)

        # ── Rank by score descending ─────────────────────────────
        ranked = sorted(all_triplets, key=lambda t: t["score"], reverse=True)

        is_open, et_time = _market_status()
        run_at = datetime.today().strftime("%Y-%m-%d %H:%M:%S")
        _last_run = run_at

        tickers_skipped = [t for t in tickers if t not in tickers_scanned]

        return jsonify({
            "ranked":            ranked,
            "macro_events":      get_macro_events(),
            "total_evaluated":   total_evaluated,
            "tickers_used":      sorted(tickers_scanned),
            "tickers_skipped":   tickers_skipped,
            "market_open":       is_open,
            "time_et":           et_time,
            "run_at":            run_at,
            "weeks_min_used":    requested_weeks_min,
            "weeks_max_used":    requested_weeks_max,
            "min_premium_used":  float(requested_min_prem),
            "min_p_profit_used": float(requested_min_pp),
        })

    except Exception as e:
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


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

import time

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
# Bars + RSI are both fetched from Massive on every cache miss; caching the
# whole response means we hit Massive at most once per (ticker, tf) per TTL.
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
    if time.time() - entry["timestamp"] >= _CACHE_TTL.get(timeframe, 300):
        return None
    return entry["data"]


def _set_cached_chart(ticker, timeframe, data):
    _chart_cache[(ticker, timeframe)] = {"data": data, "timestamp": time.time()}


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

        # ── OHLCV bars ──────────────────────────────────────────
        # 1D needs special handling: when the market is closed (weekend, holiday,
        # pre-open) "today" has no bars, so we want the most recent trading
        # session's intraday data. Implementation: one 7-day-window hourly
        # request, then bucket bars by ET calendar date and pick the latest.
        # (An earlier walk-back loop that made up to 7 day-by-day calls tripped
        # Massive's weekend rate limit, which returns auth-flavored 429s.)
        # Other timeframes use a rolling window that already absorbs closed days.
        aggs             = []
        session_date_str = None  # only set for 1D — see frontend "Showing …" label

        if timeframe == "1D":
            from_date = (today_et - timedelta(days=7)).strftime("%Y-%m-%d")
            to_date   = today_et.strftime("%Y-%m-%d")
            try:
                all_aggs = list(massive_client.list_aggs(
                    ticker, multiplier, timespan, from_date, to_date, limit=50000,
                ))
            except Exception as e:
                return jsonify({"error": f"chart fetch failed: {e}"}), 502

            # Group bars by ET calendar date, pick the most recent session.
            by_date = {}
            for a in all_aggs:
                if a.timestamp is None:
                    continue
                ts_et = datetime.fromtimestamp(a.timestamp / 1000, tz=eastern)
                key   = ts_et.strftime("%Y-%m-%d")
                by_date.setdefault(key, []).append(a)

            if not by_date:
                return jsonify({"error": f"No recent intraday data for {ticker}"}), 404

            session_date_str = max(by_date.keys())
            aggs             = by_date[session_date_str]
        else:
            from_date = (today_et - timedelta(days=days_back)).strftime("%Y-%m-%d")
            to_date   = today_et.strftime("%Y-%m-%d")
            try:
                aggs = list(massive_client.list_aggs(
                    ticker, multiplier, timespan, from_date, to_date, limit=50000,
                ))
            except Exception as e:
                return jsonify({"error": f"chart fetch failed: {e}"}), 502

        bars = []
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
        # concept of "the session date" doesn't apply.
        session_is_today = (
            session_date_str == today_et.strftime("%Y-%m-%d")
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
    now = time.time()
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
    print("Endpoints: /api/status  /api/holdings  /api/events  /api/run  /api/run_v3  /api/chain  /api/chart  /api/chart_cache_stats")
    app.run(host='0.0.0.0', port=5001)