from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from datetime import datetime

from ratio_ranker import calculate_ratios
from options_screener import fetch_all_rows


def generate_pdf(output_path):
    print("Fetching options data...")
    all_rows = fetch_all_rows(verbose=False)
    ranked = calculate_ratios(all_rows)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(letter),
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "title", parent=styles["Normal"],
        fontSize=16, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4
    )
    subtitle_style = ParagraphStyle(
        "subtitle", parent=styles["Normal"],
        fontSize=9, fontName="Helvetica", alignment=TA_CENTER, spaceAfter=12,
        textColor=colors.grey
    )

    run_date = datetime.today().strftime("%Y-%m-%d %H:%M:%S")
    elements = [
        Paragraph("Luo Capital — Ranked Options", title_style),
        Paragraph(f"Run Date: {run_date}  |  {len(ranked)} data points", subtitle_style),
        Spacer(1, 4),
    ]

    # Table header
    headers = ["Rank", "Ticker", "Side", "Expiration", "Wk", "Dist %",
               "Strike", "Premium", "Stock Price", "Ratio"]

    col_widths = [0.45*inch, 0.6*inch, 0.5*inch, 1.0*inch, 0.4*inch,
                  0.55*inch, 0.75*inch, 0.75*inch, 0.85*inch, 0.85*inch]

    data = [headers]
    for i, r in enumerate(ranked, start=1):
        wk = r["Week"].replace("Week ", "W")
        data.append([
            str(i),
            r["Ticker"],
            r["Side"],
            r["Expiration"],
            wk,
            r["Dist %"],
            f"${r['Strike']:.2f}",
            f"${r['Premium']:.4f}",
            f"${r['Price']:.2f}",
            f"{r['Ratio']:.6f}",
        ])

    table = Table(data, colWidths=col_widths, repeatRows=1)

    row_styles = []
    for i in range(1, len(data)):
        bg = colors.whitesmoke if i % 2 == 0 else colors.white
        row_styles.append(("BACKGROUND", (0, i), (-1, i), bg))
        side = data[i][2]
        side_color = colors.HexColor("#1a6b3a") if side == "Call" else colors.HexColor("#8b1a1a")
        row_styles.append(("TEXTCOLOR", (2, i), (2, i), side_color))

    table.setStyle(TableStyle([
        # Header
        ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#1c1c1c")),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 8),
        ("ALIGN",        (0, 0), (-1, 0), "CENTER"),
        # Body
        ("FONTNAME",     (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",     (0, 1), (-1, -1), 7.5),
        ("ALIGN",        (0, 1), (-1, -1), "CENTER"),
        ("ROWBACKGROUND",(0, 1), (-1, -1), [colors.white, colors.whitesmoke]),
        ("GRID",         (0, 0), (-1, -1), 0.3, colors.lightgrey),
        ("TOPPADDING",   (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 3),
        *row_styles,
    ]))

    elements.append(table)
    doc.build(elements)
    print(f"PDF saved to: {output_path}")


if __name__ == "__main__":
    output = "/Users/binkmaster/Desktop/Luo Capital/reports/ranked_options.pdf"
    generate_pdf(output)
