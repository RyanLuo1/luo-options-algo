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
from datetime import datetime, time
from zoneinfo import ZoneInfo

import yfinance as yf

from options_screener import fetch_all_rows, DISTANCES as DEFAULT_DISTANCES, get_next_fridays
from ratio_ranker import calculate_ratios
from event_filter import load_events, get_macro_events, get_earnings_flag
from v3_screener import scan_ticker as v3_scan_ticker, get_fair_value, match_expirations
import robinhood

WEB_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist"
)

app = Flask(__name__, static_folder=WEB_DIST, static_url_path="")
CORS(app)


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
        "events_loaded": _events_loaded,
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
        weeks         : int 1–12  — expirations to scan (default 12)
        min_premium   : float     — minimum net credit in dollars (default 5.00)
        min_p_profit  : float 0–1 — minimum P(max profit) (default 0.50)
    """
    import traceback
    global _last_run

    try:
        body = request.get_json(silent=True) or {}
        requested_tickers   = body.get("tickers")
        requested_weeks     = body.get("weeks", 12)
        requested_min_prem  = body.get("min_premium", 5.00)
        requested_min_pp    = body.get("min_p_profit", 0.50)

        # ── Validate ─────────────────────────────────────────────
        if not isinstance(requested_weeks, int) or not (1 <= requested_weeks <= 12):
            return jsonify({"error": "weeks must be an integer between 1 and 12"}), 400
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
        err = _ensure_events(weeks=requested_weeks)
        if err:
            return jsonify({"error": f"Failed to load events: {err}"}), 500

        # ── Target expirations ───────────────────────────────────
        target_fridays = get_next_fridays(requested_weeks)

        # ── Scan each ticker ─────────────────────────────────────
        all_triplets    = []
        total_evaluated = 0
        tickers_scanned = []

        for ticker in tickers:
            try:
                stock = yf.Ticker(ticker)
                hist  = stock.history(period="1d")
                if hist.empty:
                    continue
                price = round(float(hist["Close"].iloc[-1]), 2)
            except Exception:
                continue

            fair_value = get_fair_value(ticker)

            try:
                available = stock.options
            except Exception:
                available = ()

            week_exps = match_expirations(available, target_fridays)
            if not week_exps:
                continue

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
            "weeks_used":        requested_weeks,
            "min_premium_used":  float(requested_min_prem),
            "min_p_profit_used": float(requested_min_pp),
        })

    except Exception as e:
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


# ─────────────────────────────────────────────────────────────
# Serve React SPA (must be registered after all /api/* routes)
# ─────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """Serve built React app. Falls back to index.html for client-side routing."""
    target = os.path.join(WEB_DIST, path) if path else None
    if target and os.path.isfile(target):
        return send_from_directory(WEB_DIST, path)
    return send_from_directory(WEB_DIST, "index.html")


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Luo Capital — Options Screener API")
    print("Listening on http://localhost:5001")
    print("Endpoints: /api/status  /api/holdings  /api/events  /api/run  /api/run_v3")
    app.run(host='0.0.0.0', port=5001)