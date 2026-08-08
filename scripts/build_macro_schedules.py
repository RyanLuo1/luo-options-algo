"""Reconstruct historical FOMC/CPI/PPI/NFP schedules — RANKER_SPEC §6 #6.

Builds data/macro_schedules/{year}.json from the same sources the live
event_filter scrapes, WITHOUT the today/cutoff windowing — the full published
schedule for each target year. Justification for point-in-time validity: the
Fed and BLS publish each year's full schedule a year+ in advance and
effectively never revise it, so published == as-known-then. Where the current
page no longer carries a past year, the script falls back to an archive.org
snapshot from that year (which is literally as-known-then).

Output format (data/macro_schedules/2026.json):
{
  "metadata": {"generated_at": "...", "sources": {"fomc": "...", "cpi": "..."}},
  "fomc": ["2026-01-28", ...],   # decision dates (last day of each meeting)
  "cpi":  ["2026-01-14", ...],   # release dates
  "ppi":  [...], "nfp": [...]
}

Usage: python3 scripts/build_macro_schedules.py --year 2025 --year 2026
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

from event_filter import BLS_URLS, HEADERS  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "macro_schedules")
FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"


def _get(url):
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.text


def _archive_snapshot(url, year):
    """Fetch an archive.org snapshot of `url` taken during `year` (as-known-then)."""
    api = f"https://archive.org/wayback/available?url={url}&timestamp={year}0601"
    meta = requests.get(api, timeout=20).json()
    snap = meta.get("archived_snapshots", {}).get("closest")
    if not snap or not snap.get("available"):
        return None, None
    return _get(snap["url"]), snap["url"]


def parse_fomc(html, year):
    """FOMC decision dates (last day of each meeting) for `year` from the
    calendar page. Mirrors event_filter.fetch_fomc_dates' panel parsing, minus
    the windowing."""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for panel in soup.select(".panel"):
        heading = panel.select_one(".panel-heading")
        if not heading:
            continue
        pyear = None
        for word in heading.text.strip().split():
            if word.isdigit() and len(word) == 4:
                pyear = int(word)
        if pyear != year:
            continue
        for meeting in panel.select(".fomc-meeting"):
            month_el = meeting.select_one(".fomc-meeting__month")
            date_el = meeting.select_one(".fomc-meeting__date")
            if not month_el or not date_el:
                continue
            month_txt = month_el.text.strip()
            # multi-month meetings render as e.g. "Jan/Feb"; decision day uses
            # the SECOND month when the day range crosses the boundary
            months = re.findall(r"[A-Z][a-z]+", month_txt)
            day_txt = date_el.text.strip()
            days = re.findall(r"\d+", day_txt)
            if not months or not days:
                continue
            last_day = int(days[-1])
            month_name = months[-1] if len(months) > 1 and len(days) > 1 and int(days[-1]) < int(days[0]) else months[0]
            if len(months) > 1:
                # "Apr/May 30-1" style: last day belongs to the second month
                month_name = months[-1] if int(days[-1]) < int(days[0]) else months[0]
            try:
                m = datetime.strptime(month_name[:3], "%b").month
            except ValueError:
                continue
            out.append(f"{year:04d}-{m:02d}-{last_day:02d}")
    return sorted(set(out))


def parse_bls(html, year):
    """All release dates for `year` from a BLS schedule page table (mirrors
    event_filter.fetch_bls_dates' cell parsing, minus the windowing)."""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for table in soup.select("table"):
        for row in table.select("tr"):
            cells = row.select("td")
            if len(cells) < 2:
                continue
            date_str = cells[1].text.strip()
            for fmt in ("%b. %d, %Y", "%b %d, %Y", "%B %d, %Y"):
                try:
                    d = datetime.strptime(date_str, fmt).date()
                    if d.year == year:
                        out.append(d.isoformat())
                    break
                except ValueError:
                    continue
    return sorted(set(out))


def build_year(year):
    sources = {}
    fomc_html = _get(FOMC_URL)
    fomc = parse_fomc(fomc_html, year)
    sources["fomc"] = FOMC_URL
    if not fomc:
        snap_html, snap_url = _archive_snapshot(FOMC_URL, year)
        if snap_html:
            fomc = parse_fomc(snap_html, year)
            sources["fomc"] = snap_url

    events = {"fomc": fomc}
    # A full year has ~12 monthly releases; fewer means the current page has
    # scrolled past this year -> merge in an as-known-then archive snapshot.
    MIN_FULL_YEAR = 10
    for name, url in BLS_URLS.items():
        key = name.lower()
        dates = parse_bls(_get(url), year)
        sources[key] = url
        if len(dates) < MIN_FULL_YEAR:
            snap_html, snap_url = _archive_snapshot(url, year)
            if snap_html:
                dates = sorted(set(dates) | set(parse_bls(snap_html, year)))
                sources[key] = f"{url} + {snap_url}"
        events[key] = dates

    doc = {"metadata": {"generated_at": datetime.utcnow().isoformat() + "Z",
                        "year": year, "sources": sources},
           **events}
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{year}.json")
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
    counts = {k: len(v) for k, v in events.items()}
    print(f"[{year}] wrote {path}  counts={counts}")
    for k, v in events.items():
        if not v:
            print(f"[{year}] WARNING: no {k.upper()} dates found (live page + archive fallback)")
    return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", action="append", type=int, required=True)
    args = ap.parse_args()
    for y in args.year:
        build_year(y)


if __name__ == "__main__":
    main()
