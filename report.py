"""
report.py
Generates a full PDF report capturing options screener and ranked output.
Run with: python3 report.py
"""

import io
import re
import sys
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

ANSI_ESCAPE = re.compile(r'\x1b\[[0-9;]*m')

def strip_ansi(text):
    return ANSI_ESCAPE.sub('', text)


def capture(fn, *args, **kwargs):
    """Call fn(*args, **kwargs), capture and return printed output as a string."""
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        fn(*args, **kwargs)
    finally:
        sys.stdout = old
    return strip_ansi(buf.getvalue())


# ─────────────────────────────────────────────────────────────
# Styles
# ─────────────────────────────────────────────────────────────

def make_styles():
    return {
        "title": ParagraphStyle(
            "title",
            fontName="Helvetica-Bold",
            fontSize=20,
            alignment=TA_CENTER,
            spaceAfter=6,
            textColor=colors.HexColor("#1c1c1c"),
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            fontName="Helvetica",
            fontSize=10,
            alignment=TA_CENTER,
            spaceAfter=4,
            textColor=colors.grey,
        ),
        "section": ParagraphStyle(
            "section",
            fontName="Helvetica-Bold",
            fontSize=12,
            spaceAfter=6,
            spaceBefore=14,
            textColor=colors.HexColor("#1c1c1c"),
        ),
        "meta": ParagraphStyle(
            "meta",
            fontName="Helvetica",
            fontSize=9,
            spaceAfter=3,
            textColor=colors.HexColor("#333333"),
        ),
        "mono": ParagraphStyle(
            "mono",
            fontName="Courier",
            fontSize=7.5,
            leading=10.5,
            spaceAfter=0,
            leftIndent=0,
        ),
        "status_open": ParagraphStyle(
            "status_open",
            fontName="Helvetica-Bold",
            fontSize=10,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#1a6b3a"),
            spaceAfter=4,
        ),
        "status_closed": ParagraphStyle(
            "status_closed",
            fontName="Helvetica-Bold",
            fontSize=10,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#8b1a1a"),
            spaceAfter=4,
        ),
    }


# ─────────────────────────────────────────────────────────────
# Market status
# ─────────────────────────────────────────────────────────────

def get_market_status():
    from datetime import time
    eastern = ZoneInfo("America/New_York")
    now_et = datetime.now(eastern)
    is_open = now_et.weekday() < 5 and time(9, 30) <= now_et.time() <= time(16, 0)
    return is_open, now_et.strftime("%Y-%m-%d %H:%M:%S %Z")


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────

def generate_report():
    run_dt = datetime.today()
    run_date_str = run_dt.strftime("%Y-%m-%d %H:%M:%S")
    filename = f"luo_capital_report_{run_dt.strftime('%Y-%m-%d_%H%M')}.pdf"
    reports_dir = os.path.join(os.path.dirname(__file__), "reports")
    os.makedirs(reports_dir, exist_ok=True)
    output_path = os.path.join(reports_dir, filename)

    is_open, et_time = get_market_status()

    # ── Fetch data ──────────────────────────────────────────
    print("Loading events...")
    from event_filter import load_events, get_macro_events
    load_events()
    macro_str = get_macro_events()

    print("Fetching options data...")
    from options_screener import fetch_all_rows
    screener_output = capture(fetch_all_rows, verbose=True)

    print("Ranking...")
    from ratio_ranker import calculate_ratios, print_ranked_table
    all_rows = fetch_all_rows(verbose=False)
    ranked, dupes = calculate_ratios(all_rows)
    ranked_output = capture(print_ranked_table, ranked, dupes)

    # ── Build PDF ───────────────────────────────────────────
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(letter),
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.6 * inch,  # extra space for page numbers
    )

    styles = make_styles()
    elements = []

    # ── Title page ──────────────────────────────────────────
    elements.append(Spacer(1, 0.6 * inch))
    elements.append(Paragraph("Luo Capital", styles["title"]))
    elements.append(Paragraph("Options Screening Report", styles["title"]))
    elements.append(Spacer(1, 0.15 * inch))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.lightgrey))
    elements.append(Spacer(1, 0.1 * inch))
    elements.append(Paragraph(f"Run Date: {run_date_str}  |  ET: {et_time}", styles["subtitle"]))

    status_text = "Market Status: OPEN" if is_open else "Market Status: CLOSED — data may be stale"
    elements.append(Paragraph(status_text, styles["status_open"] if is_open else styles["status_closed"]))

    elements.append(Spacer(1, 0.1 * inch))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.lightgrey))
    elements.append(Spacer(1, 0.1 * inch))
    elements.append(Paragraph("Macro Events (next 4 weeks)", styles["section"]))
    elements.append(Paragraph(macro_str, styles["meta"]))

    elements.append(PageBreak())

    # ── Section 1: Per Ticker ────────────────────────────────
    elements.append(Paragraph("Section 1 — Options Screener: Per Ticker Data", styles["section"]))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.lightgrey))
    elements.append(Spacer(1, 6))
    elements.append(Preformatted(screener_output, styles["mono"]))

    elements.append(PageBreak())

    # ── Section 2: Ranked Table ──────────────────────────────
    elements.append(Paragraph("Section 2 — Ranked Options: V2 Delta Adjusted", styles["section"]))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.lightgrey))
    elements.append(Spacer(1, 6))
    elements.append(Preformatted(ranked_output, styles["mono"]))

    # ── Page number footer ───────────────────────────────────
    def add_page_number(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.grey)
        page_width = landscape(letter)[0]
        canvas.drawCentredString(
            page_width / 2,
            0.3 * inch,
            f"Luo Capital — Options Screening Report  |  Page {doc.page}"
        )
        canvas.restoreState()

    # ── Save ─────────────────────────────────────────────────
    doc.build(elements, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"\nPDF saved: {filename}")


if __name__ == "__main__":
    generate_report()
