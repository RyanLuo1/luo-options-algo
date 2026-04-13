"""
event_filter.py
Fetches earnings dates (via yfinance) and macro events (FOMC/CPI/PPI/NFP via Fed & BLS)
and flags each option contract with relevant events within its expiration window.
"""

import yfinance as yf
import requests
from bs4 import BeautifulSoup
from datetime import datetime, date, timedelta

from options_screener import TICKERS

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

# Module-level cache — populated once by load_events()
_earnings  = {}   # ticker -> date
_macro     = []   # list of (event_name, event_date)


# ─────────────────────────────────────────────────────────────
# Earnings
# ─────────────────────────────────────────────────────────────

def fetch_earnings_dates():
    """Returns dict of ticker -> next earnings date (date object)."""
    earnings = {}
    for ticker in TICKERS:
        try:
            cal = yf.Ticker(ticker).calendar
            dates = cal.get("Earnings Date", [])
            if dates:
                # yfinance may return a list; take the first upcoming date
                today = date.today()
                upcoming = [d for d in dates if d >= today]
                if upcoming:
                    earnings[ticker] = upcoming[0]
        except Exception:
            pass
    return earnings


# ─────────────────────────────────────────────────────────────
# FOMC — scraped from Federal Reserve
# ─────────────────────────────────────────────────────────────

MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

def fetch_fomc_dates(weeks=4):
    """Returns list of FOMC decision dates (last day of each meeting) as date objects."""
    results = []
    try:
        r = requests.get(
            "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
            headers=HEADERS, timeout=10
        )
        soup = BeautifulSoup(r.text, "html.parser")
        today = date.today()
        cutoff = today + timedelta(weeks=weeks)

        for panel in soup.select(".panel"):
            heading = panel.select_one(".panel-heading")
            if not heading:
                continue
            year_text = heading.text.strip()
            year = None
            for word in year_text.split():
                if word.isdigit() and len(word) == 4:
                    year = int(word)
            if not year:
                continue

            for meeting in panel.select(".fomc-meeting"):
                month_el = meeting.select_one(".fomc-meeting__month")
                date_el  = meeting.select_one(".fomc-meeting__date")
                if not month_el or not date_el:
                    continue

                month_str = month_el.text.strip().lower()
                month = MONTH_MAP.get(month_str)
                if not month:
                    continue

                # Date cell may be "28-29" or "28-29*" — take last day
                day_text = date_el.text.strip().replace("*", "")
                day_part = day_text.split("-")[-1].strip()
                if not day_part.isdigit():
                    continue

                try:
                    meeting_date = date(year, month, int(day_part))
                    if today <= meeting_date <= cutoff:
                        results.append(meeting_date)
                except ValueError:
                    pass
    except Exception:
        pass
    return results


# ─────────────────────────────────────────────────────────────
# BLS (CPI, PPI, NFP) — scraped from Bureau of Labor Statistics
# ─────────────────────────────────────────────────────────────

BLS_URLS = {
    "CPI": "https://www.bls.gov/schedule/news_release/cpi.htm",
    "PPI": "https://www.bls.gov/schedule/news_release/ppi.htm",
    "NFP": "https://www.bls.gov/schedule/news_release/empsit.htm",
}

def fetch_bls_dates(event_name, url, weeks=4):
    """Returns list of upcoming release dates for a BLS event within the next N weeks."""
    results = []
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        today = date.today()
        cutoff = today + timedelta(weeks=weeks)

        table = soup.select_one("table")
        if not table:
            return results

        for row in table.select("tr"):
            cells = row.select("td")
            if len(cells) < 2:
                continue
            date_str = cells[1].text.strip()
            # Format: "Apr. 10, 2026"
            try:
                release_date = datetime.strptime(date_str, "%b. %d, %Y").date()
                if today <= release_date <= cutoff:
                    results.append(release_date)
            except ValueError:
                # Some rows use full month name e.g. "May 12, 2026"
                try:
                    release_date = datetime.strptime(date_str, "%b %d, %Y").date()
                    if today <= release_date <= cutoff:
                        results.append(release_date)
                except ValueError:
                    pass
    except Exception:
        pass
    return results


# ─────────────────────────────────────────────────────────────
# Load all events (called once at startup)
# ─────────────────────────────────────────────────────────────

def load_events(weeks=4):
    """Fetches all earnings and macro event data and stores in module-level cache."""
    global _earnings, _macro

    print("  Loading earnings dates...")
    _earnings = fetch_earnings_dates()

    print(f"  Loading macro events (FOMC, CPI, PPI, NFP) — {weeks}w window...")
    _macro = []

    for fomc_date in fetch_fomc_dates(weeks=weeks):
        _macro.append(("FOMC", fomc_date))

    for event_name, url in BLS_URLS.items():
        for d in fetch_bls_dates(event_name, url, weeks=weeks):
            _macro.append((event_name, d))

    _macro.sort(key=lambda x: x[1])

    total = len(_earnings) + len(_macro)
    print(f"  Events loaded: {len(_earnings)} earnings, {len(_macro)} macro events\n")


# ─────────────────────────────────────────────────────────────
# Public functions
# ─────────────────────────────────────────────────────────────

def get_macro_events():
    """
    Returns a formatted string of all macro events in the cache, chronological order.
    Example: 'NFP 4/3  |  CPI 4/10  |  PPI 4/14'
    Returns 'None in next 4 weeks' if cache is empty.
    """
    if not _macro:
        return "None scheduled"
    parts = [f"{name} {d.month}/{d.day}" for name, d in _macro]
    return "  |  ".join(parts)


def get_earnings_flag(ticker, expiration_date):
    """
    Returns an earnings flag for a ticker within a given expiration window.
    Returns 'EARNINGS M/D' if earnings fall between today and expiration, else 'CLEAR'.
    """
    today = date.today()
    if isinstance(expiration_date, str):
        expiration_date = datetime.strptime(expiration_date, "%Y-%m-%d").date()

    earnings_date = _earnings.get(ticker)
    if earnings_date and today <= earnings_date <= expiration_date:
        return f"EARNINGS {earnings_date.month}/{earnings_date.day}"
    return "CLEAR"
