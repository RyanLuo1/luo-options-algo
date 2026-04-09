"""
server/robinhood.py
Handles Robinhood authentication and holdings fetch via robin_stocks.
Credentials are loaded from the project-root .env file.
"""

import os
import sys

from dotenv import load_dotenv
import robin_stocks.robinhood as r

# Load .env from project root (one level up from server/)
_env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(_env_path)

_logged_in = False


def _ensure_login():
    """Login to Robinhood once per process. Reuses cached session on subsequent calls."""
    global _logged_in
    if _logged_in:
        return

    username = os.getenv("ROBINHOOD_USERNAME")
    password = os.getenv("ROBINHOOD_PASSWORD")

    if not username or not password:
        raise RuntimeError(
            "ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD must be set in .env"
        )

    # store_session=True caches the auth token locally — MFA only required on first run
    r.login(username, password, store_session=True)
    _logged_in = True


def get_holdings():
    """
    Returns a sorted list of uppercase ticker symbols for all open stock positions.

    Raises RuntimeError if credentials are missing or login fails.
    """
    _ensure_login()

    # build_holdings() returns {symbol: {price, quantity, ...}} for all open positions
    holdings = r.account.build_holdings()
    if not holdings:
        return []

    return sorted(k.upper() for k in holdings.keys())


def get_holdings_detail():
    """
    Returns a list of dicts with ticker, shares, and average cost.
    Used by /api/holdings to give the frontend richer position data.
    """
    _ensure_login()

    holdings = r.account.build_holdings()
    if not holdings:
        return []

    result = []
    for symbol, data in holdings.items():
        result.append({
            "ticker":    symbol.upper(),
            "shares":    float(data.get("quantity", 0)),
            "avg_cost":  float(data.get("average_buy_price", 0)),
        })

    return sorted(result, key=lambda x: x["ticker"])


# ── Quick smoke test ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Logging in to Robinhood...")
    try:
        detail = get_holdings_detail()
        if not detail:
            print("No open positions found.")
        else:
            print(f"\n{'Ticker':<8} {'Shares':>8} {'Avg Cost':>10}")
            print("-" * 30)
            for p in detail:
                print(f"{p['ticker']:<8} {p['shares']:>8.2f} ${p['avg_cost']:>9.2f}")
            print(f"\nTickers: {[p['ticker'] for p in detail]}")
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
