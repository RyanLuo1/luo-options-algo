import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from massive import RESTClient

load_dotenv()

# Default watchlist — used by the screener and macro-event loading when the
# caller doesn't supply an explicit ticker universe.
TICKERS = ["GEV", "PLTR", "APP", "AVGO", "META", "MU", "NVDA", "TSLA", "AMD", "TSM"]

# Module-level Massive client, initialized from MASSIVE_API_KEY. Imported by
# server/app.py and screener.py — there is only one client for the project.
massive_client = RESTClient(os.getenv('MASSIVE_API_KEY'))


def get_next_fridays(n=4, as_of=None):
    """Return the next N Friday dates (as date objects), starting the day
    after `as_of` (default: today — live behavior unchanged). The backtest
    replay passes the historical scan date so weekly targets are
    point-in-time."""
    today = datetime.combine(as_of, datetime.min.time()) if as_of else datetime.today()
    fridays = []
    d = today + timedelta(days=1)
    while len(fridays) < n:
        if d.weekday() == 4:  # Friday
            fridays.append(d.date())
        d += timedelta(days=1)
    return fridays


def find_closest_strike(strikes, target):
    """Snap a target price to the nearest available chain strike."""
    return min(strikes, key=lambda s: abs(s - target))
