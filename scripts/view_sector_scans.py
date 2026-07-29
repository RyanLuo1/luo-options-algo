#!/usr/bin/env python3
"""
scripts/view_sector_scans.py — read-only review report of the daily sector scans.

Usage:
    python3 scripts/view_sector_scans.py                  # today's scans
    python3 scripts/view_sector_scans.py --date 2026-06-16
    python3 scripts/view_sector_scans.py --date 2026-06-16 --slot open
    python3 scripts/view_sector_scans.py --slot close

Reads `sector_scan_runs` and `ml_dataset` (joining run.ml_dataset_id → the
ml_dataset pick) and prints a clean per-day, per-slot summary. Performs ZERO
writes — safe to run any time. Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from
`.env` (loaded transitively by `options_screener`); the service-role key is
required because both tables are RLS-locked with no public policies.

Open and close are distinct observations, encoded in `source`
(live_open / live_close, and backtest_open / backtest_close for replay rows);
by default every source present is shown, separated. `--slot` restricts to
one slot across both provenances (live_<slot> + backtest_<slot>). Legacy
slot-blind `backtest` rows, if any remain, render as their own section.

If `rich` is installed, status is colored (green=picked, dim=none_qualified,
yellow=no_tickers, red=error). Otherwise it prints plain text and still works.
"""

import argparse
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

# Project root on path so options_screener's import-time load_dotenv() populates
# SUPABASE_URL / SUPABASE_SERVICE_KEY for us.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

import options_screener  # noqa: F401, E402 — import for load_dotenv() side effect

from supabase import create_client  # noqa: E402

# Optional pretty output. Must work whether or not rich is installed.
try:
    from rich.console import Console
    _console = Console()
    _HAS_RICH = True
except ImportError:
    _console = None
    _HAS_RICH = False


SUPABASE_URL         = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env",
          file=sys.stderr)
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# Status → color, and a sort priority (picks first, errors last).
_STATUS_STYLE = {
    'picked':         'green',
    'none_qualified': 'dim',
    'no_tickers':     'yellow',
    'error':          'red',
}
_STATUS_ORDER = {'picked': 0, 'none_qualified': 1, 'no_tickers': 2, 'error': 3}

# source → human slot label. ('backtest' is the legacy slot-blind value —
# kept only so any pre-split rows still render; see
# docs/backtest_slot_split_migration.sql.)
_SLOT_LABEL = {'live_open': 'open', 'live_close': 'close',
               'backtest_open': 'backtest-open', 'backtest_close': 'backtest-close',
               'backtest': 'backtest'}


def _emit(text, style=None):
    """Print with rich color if available, plain text otherwise.

    soft_wrap=True stops rich from reflowing these pre-aligned, fixed-width
    lines to the console width (which would mangle the table); the terminal
    handles any wrapping itself.
    """
    if _HAS_RICH:
        _console.print(text, style=style, highlight=False, soft_wrap=True)
    else:
        print(text)


def _status_style(status):
    return _STATUS_STYLE.get(status, 'white')


def _num(x):
    """Coerce a possibly-None numeric to float, or None."""
    try:
        return float(x) if x is not None else None
    except (TypeError, ValueError):
        return None


def _pick_detail(run, ml_by_id):
    """
    Build the right-hand detail string for one sector run row.

    For 'picked', joins to the ml_dataset row for ticker/expiration/score/
    economics. If the link is missing (null id or no matching row), flags it
    rather than crashing.
    """
    status = run['status']
    s  = run.get('tickers_scanned') or 0
    k  = run.get('tickers_skipped') or 0
    q  = run.get('setups_qualified') or 0
    counts = f"scan {s:>3} / skip {k:>2} / qual {q:>5}"

    if status == 'picked':
        ml = ml_by_id.get(run.get('ml_dataset_id'))
        if ml is None:
            return counts, "⚠ pick detail missing (no ml_dataset row linked)", 'red'
        net = _num(ml.get('net_premium'))
        spr = _num(ml.get('spread_width'))
        sc  = _num(ml.get('score'))
        pp  = _num(ml.get('p_max_profit'))
        net_c = net * 100 if net is not None else None
        max_c = (net + spr) * 100 if (net is not None and spr is not None) else None
        wk    = ml.get('weeks_to_expiration')
        detail = (
            f"{ml.get('ticker',''):<5} {ml.get('expiration','')}"
            f"  W{wk if wk is not None else '?'}"
            f"  score={sc:7.4f}" if sc is not None else
            f"{ml.get('ticker',''):<5} {ml.get('expiration','')}"
        )
        econ = (
            f"  net ${net_c:+,.0f}" if net_c is not None else ""
        ) + (
            f"  max ${max_c:+,.0f}" if max_c is not None else ""
        ) + (
            f"  P {pp*100:.1f}%" if pp is not None else ""
        )
        return counts, detail + econ, None

    if status == 'none_qualified':
        return counts, "no setups cleared the filters", None
    if status == 'no_tickers':
        return counts, "no tickers in universe", None
    if status == 'error':
        msg = (run.get('error_message') or "unknown error").replace("\n", " ")
        if len(msg) > 70:
            msg = msg[:67] + "..."
        return counts, f"ERROR: {msg}", None
    return counts, status, None


def _render_slot(date_str, source, runs, ml_by_id):
    """Render one (date, source) slot: header, per-sector rows, slot summary."""
    slot = _SLOT_LABEL.get(source, source)

    # Market context (vix/spy) lives on ml_dataset, identical across a slot's
    # picks — grab the first non-null we can find among this slot's picks.
    vix = spy = None
    for r in runs:
        ml = ml_by_id.get(r.get('ml_dataset_id'))
        if ml:
            vix = vix if vix is not None else _num(ml.get('vix'))
            spy = spy if spy is not None else _num(ml.get('spy_price'))

    # Filters snapshot (same for every sector in the slot).
    sample = runs[0]
    mnp = _num(sample.get('min_net_premium'))
    mpp = _num(sample.get('min_p_profit'))
    wr  = sample.get('weeks_range')

    sec_w = max(8, max(len(r['sector']) for r in runs))

    ctx = []
    if vix is not None: ctx.append(f"VIX {vix:.2f}")
    if spy is not None: ctx.append(f"SPY {spy:.2f}")
    ctx_str = "  |  ".join(ctx) if ctx else "n/a"

    filt = []
    if mnp is not None: filt.append(f"min premium ${mnp:.2f}")
    if mpp is not None: filt.append(f"min P {mpp*100:.0f}%")
    if wr:              filt.append(f"weeks {wr}")
    filt_str = "  |  ".join(filt) if filt else "n/a"

    _emit("")
    _emit(f"══ SLOT: {slot}  ({source})  ══", "bold")
    _emit(f"   market context: {ctx_str}        filters: {filt_str}", "dim")
    _emit("   " + "-" * (sec_w + 78), "dim")

    # Picks first (by score desc), then none_qualified, no_tickers, error.
    def sort_key(r):
        ml = ml_by_id.get(r.get('ml_dataset_id')) or {}
        sc = _num(ml.get('score')) or 0.0
        return (_STATUS_ORDER.get(r['status'], 9), -sc, r['sector'])

    for run in sorted(runs, key=sort_key):
        counts, detail, override = _pick_detail(run, ml_by_id)
        style = override or _status_style(run['status'])
        line = (f"   {run['sector']:<{sec_w}}  {run['status']:<14}  "
                f"{counts}   {detail}")
        _emit(line, style)

    # ── Slot summary ─────────────────────────────────────────────────────────
    counts = Counter(r['status'] for r in runs)
    picks       = counts.get('picked', 0)
    tot_scanned = sum(r.get('tickers_scanned') or 0 for r in runs)
    tot_skipped = sum(r.get('tickers_skipped') or 0 for r in runs)
    elapsed_ms  = sum(r.get('elapsed_ms') or 0 for r in runs)

    _emit("   " + "-" * (sec_w + 78), "dim")
    status_str = " | ".join(
        f"{k} {counts.get(k,0)}"
        for k in ('picked', 'none_qualified', 'no_tickers', 'error')
    )
    _emit(f"   Summary ({slot}): {len(runs)} sectors  →  {status_str}", "bold")
    _emit(f"     picks logged {picks}  |  tickers scanned {tot_scanned}  |  "
          f"skipped {tot_skipped}  |  elapsed {elapsed_ms/1000:.1f}s")


def main():
    parser = argparse.ArgumentParser(
        description="Read-only review report of the daily sector scans.")
    parser.add_argument("--date", default=None,
                        help="day to view, YYYY-MM-DD (default: today, ET)")
    parser.add_argument("--slot", choices=["open", "close"], default=None,
                        help="restrict to one slot (default: show all slots)")
    args = parser.parse_args()

    if args.date:
        try:
            datetime.strptime(args.date, "%Y-%m-%d")
        except ValueError:
            print(f"error: --date must be YYYY-MM-DD (got {args.date!r})",
                  file=sys.stderr)
            sys.exit(1)
        date_str = args.date
    else:
        date_str = datetime.now(ZoneInfo("America/New_York")).date().isoformat()

    # Two flat queries → Python-side join (small dataset; avoids depending on
    # PostgREST embedded-relation syntax).
    run_q = supabase.table('sector_scan_runs').select('*').eq('scan_date', date_str)
    if args.slot:
        # A slot spans both provenances: live_<slot> and backtest_<slot>.
        run_q = run_q.in_('source', [f'live_{args.slot}', f'backtest_{args.slot}'])
    runs = run_q.execute().data or []

    if not runs:
        slot_note = f" ({args.slot})" if args.slot else ""
        _emit("")
        _emit(f"No sector scans found for {date_str}{slot_note}.", "yellow")
        _emit("Run `python3 scripts/sector_scan.py --slot open` (or close) to "
              "produce some.", "dim")
        _emit("")
        return

    ml_rows = supabase.table('ml_dataset').select('*').eq('scan_date', date_str).execute().data or []
    ml_by_id = {m['id']: m for m in ml_rows}

    by_source = defaultdict(list)
    for r in runs:
        by_source[r['source']].append(r)

    _emit("")
    _emit("═" * 92, "dim")
    _emit(f"SECTOR SCAN REVIEW  —  {date_str}"
          f"{('  slot=' + args.slot) if args.slot else '  (all slots)'}", "bold")
    _emit("═" * 92, "dim")

    # Render live_open, live_close, backtest_open, backtest_close, then any
    # other source (e.g. legacy plain 'backtest').
    ordered = sorted(by_source, key=lambda s: (
        {'live_open': 0, 'live_close': 1,
         'backtest_open': 2, 'backtest_close': 3}.get(s, 4), s))
    for source in ordered:
        _render_slot(date_str, source, by_source[source], ml_by_id)

    # Cross-slot note when more than one slot is present.
    if len(ordered) > 1:
        _emit("")
        parts = []
        for source in ordered:
            picks = sum(1 for r in by_source[source] if r['status'] == 'picked')
            parts.append(f"{_SLOT_LABEL.get(source, source)} {picks}")
        _emit(f"Picks by slot (distinct observations): {'  |  '.join(parts)}", "bold")
    _emit("")


if __name__ == '__main__':
    main()
