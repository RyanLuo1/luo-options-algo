"""
server/app.py
Flask API server — wraps existing options screener algo and exposes JSON endpoints.
Run with: python3 server/app.py
"""

import sys
import os

# Add project root to path so existing algo modules are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime, time
from zoneinfo import ZoneInfo

from options_screener import fetch_all_rows
from ratio_ranker import calculate_ratios
from event_filter import load_events, get_macro_events, get_earnings_flag
import robinhood

app = Flask(__name__)
CORS(app)

# Server-level state (per process — fine for local single-user use)
_last_run = None
_events_loaded = False


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _market_status():
    eastern = ZoneInfo("America/New_York")
    now_et = datetime.now(eastern)
    is_open = now_et.weekday() < 5 and time(9, 30) <= now_et.time() <= time(16, 0)
    return is_open, now_et.strftime("%Y-%m-%d %H:%M:%S %Z")


def _ensure_events():
    """Load events if not already cached. Returns error string or None."""
    global _events_loaded
    if not _events_loaded:
        try:
            load_events()
            _events_loaded = True
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
    """Fetch open stock positions from Robinhood."""
    try:
        detail = robinhood.get_holdings_detail()
        return jsonify({
            "tickers":   [p["ticker"] for p in detail],
            "positions": detail,
        })
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        return jsonify({"error": f"Unexpected error fetching holdings: {e}"}), 500


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

    Returns:
        ranked:             list of ranked option rows
        macro_events:       formatted macro event string
        duplicates_removed: int
        market_open:        bool
        time_et:            current ET time string
        run_at:             timestamp of this run
        tickers_used:       tickers that returned options data
        tickers_skipped:    tickers that returned no options data
        tickers_source:     "manual" | "robinhood"
        total_ranked:       int
    """
    global _last_run

    body = request.get_json(silent=True) or {}
    requested_tickers = body.get("tickers")

    # ── Resolve ticker universe ──────────────────────────────
    if requested_tickers:
        tickers = [t.upper().strip() for t in requested_tickers if t.strip()]
        tickers_source = "manual"
    else:
        try:
            tickers = robinhood.get_holdings()
            tickers_source = "robinhood"
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 503
        except Exception as e:
            return jsonify({"error": f"Failed to fetch Robinhood holdings: {e}"}), 500

    if not tickers:
        return jsonify({
            "error": "No tickers to scan. Provide tickers manually or connect Robinhood."
        }), 400

    # ── Load events ──────────────────────────────────────────
    err = _ensure_events()
    if err:
        return jsonify({"error": f"Failed to load events: {err}"}), 500

    # ── Fetch options data ───────────────────────────────────
    try:
        all_rows = fetch_all_rows(verbose=False, tickers=tickers)
    except Exception as e:
        return jsonify({"error": f"Failed to fetch options data: {e}"}), 500

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
    })


# ─────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Luo Capital — Options Screener API")
    print("Listening on http://localhost:5000")
    print("Endpoints: /api/status  /api/holdings  /api/events  /api/run")
    app.run(debug=False, port=5000)
