from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent
OUTPUT = ROOT / "outputs" / "2027-2032-strategic-plan-workspace-summary-2026-09-02.docx"
CHART = WORK / "annual-ridership.png"

NAVY = "001C80"
NAVY_DARK = "071B4D"
BLUE = "2563EB"
CYAN = "0891B2"
VIOLET = "7C3AED"
AMBER = "D97706"
GREEN = "047857"
SLATE = "475569"
LIGHT = "F1F5F9"
LIGHT_BLUE = "EAF2FF"
LIGHT_VIOLET = "F3E8FF"
WHITE = "FFFFFF"
BLACK = "111827"
BORDER = "CBD5E1"
RED = "B91C1C"

CAPTURE_DATE = "September 2, 2026"

WORKPLAN = [
    ["Project Initiation and Data Collection", "Aug 3, 2026–Sep 6, 2027", "6", "0%", "6", "0", "0", "0", "1"],
    ["Stakeholder Engagement", "Aug 10, 2026–Jun 7, 2027", "10", "0%", "10", "0", "0", "0", "0"],
    ["Strategic Plan Development", "Aug 17, 2026–Jul 12, 2027", "54", "0%", "54", "0", "0", "0", "1"],
    ["Report Production and Finalization", "Jul 19, 2027–Sep 27, 2027", "3", "0%", "3", "0", "0", "0", "0"],
    ["TOTAL", "Aug 3, 2026–Sep 27, 2027", "73", "0%", "73", "0", "0", "0", "2"],
]

SERVICE = [
    ["400", "EXPRESS", "6:45 AM–6:45 PM", "30 min\n6:45 AM–6:15 PM", "N/A", "19.1"],
    ["100", "RED", "7:00 AM–11:00 PM", "25 min\n7:00 AM–9:45 PM", "41 min\n10:30 PM–11:00 PM", "27.4"],
    ["101", "BLUE", "7:00 AM–10:45 PM", "25 min\n7:00 AM–9:15 PM", "41 min\n10:00 PM–10:45 PM", "26.6"],
    ["2", "DUNLOP / PARK PLACE", "5:30 AM–11:45 PM", "30 min\n5:45 AM–7:45 PM", "60 min\n7:45 PM–11:00 PM", "39.6"],
    ["7", "GROVE / BEAR CREEK", "5:30 AM–12:30 AM (+1)", "30 min\n5:30 AM–7:30 PM", "60 min\n7:30 PM–10:30 PM", "61.5"],
    ["8A", "RVH/YONGE", "4:30 AM–12:45 AM (+1)", "30 min\n5:00 AM–6:15 PM", "60 min\n6:15 PM–11:45 PM", "76.6"],
    ["8B", "Crosstown/Essa", "4:45 AM–12:30 AM (+1)", "30 min\n5:45 AM–6:00 PM", "60 min\n5:15 AM–5:45 AM; 6:00 PM–12:30 AM (+1)", "73.4"],
    ["10", "NORTH LOOP", "5:45 AM–12:30 AM (+1)", "30 min\n5:45 AM–9:15 PM", "60 min\n9:45 PM–11:45 PM", "32.3"],
    ["11", "NORTH LOOP", "5:00 AM–12:00 AM (+1)", "30 min\n6:00 AM–10:00 PM", "60 min\n10:00 PM–11:00 PM", "32.5"],
    ["12", "GEORGIAN MALL / BARRIE SOUTH GO", "5:15 AM–12:30 AM (+1)", "35 min\n5:15 AM–9:00 PM", "50 min\n9:00 PM–11:30 PM", "65.9"],
]

TRIP_ROUTES = [
    ["8A", "230,375", "17,003", "2,504"],
    ["8B", "224,333", "15,773", "2,438"],
    ["12", "125,792", "13,591", "1,367"],
    ["7", "121,100", "8,148", "1,316"],
    ["101", "120,139", "9,628", "1,306"],
]

RIDERSHIP_YEARS = list(range(2008, 2027))
RIDERSHIP_TOTALS = [
    2572061, 2497761, 2531337, 2620930, 2629537, 2547884, 2481681,
    2568627, 2597004, 2707396, 3388424, 3424421, 1901738, 1483972,
    2806293, 3918060, 4076773, 3362338, 1851423,
]
RIDERSHIP_FORECAST = 2640044

FLEET = [
    ["2027", "69", "7", "8", "2"],
    ["2028", "69", "8", "8", "4"],
    ["2029", "67", "12", "9", "7"],
    ["2030", "71", "10", "3", "6"],
    ["2031", "80", "4", "4", "6"],
    ["2032", "87", "5", "9", "4"],
]

MASTER = [
    ["400", "23.4h", "5,888.4h", "19.4h", "987.7h", "—", "—", "6,876.1h"],
    ["100", "30.5h", "7,694.4h", "29.0h", "1,477.3h", "22.5h", "1,261.9h", "10,433.6h"],
    ["101", "29.7h", "7,480.2h", "28.6h", "1,459.5h", "22.3h", "1,246.0h", "10,185.7h"],
    ["2", "48.2h", "12,150.6h", "45.3h", "2,307.8h", "26.6h", "1,491.5h", "15,949.8h"],
    ["7", "63.9h", "16,098.6h", "59.8h", "3,049.8h", "24.9h", "1,393.5h", "20,541.9h"],
    ["8A", "83.2h", "20,958.0h", "73.6h", "3,752.7h", "33.0h", "1,846.1h", "26,556.9h"],
    ["8B", "79.8h", "20,109.6h", "72.6h", "3,700.9h", "32.4h", "1,812.5h", "25,623.0h"],
    ["10", "34.8h", "8,778.0h", "31.8h", "1,623.5h", "14.9h", "835.3h", "11,236.8h"],
    ["11", "34.8h", "8,778.0h", "30.8h", "1,572.5h", "14.9h", "835.3h", "11,185.8h"],
    ["12", "69.5h", "17,509.8h", "65.9h", "3,360.1h", "29.0h", "1,624.9h", "22,494.8h"],
    ["TOTAL", "497.8h", "125,445.6h", "456.7h", "23,291.7h", "220.5h", "12,347.1h", "161,084.4h"],
]


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=100, bottom=80, end=100) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_table_geometry(table, widths: Sequence[float]) -> None:
    total_dxa = int(round(sum(widths) * 1440))
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(total_dxa))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), "100")
    tbl_ind.set(qn("w:type"), "dxa")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        grid_col = OxmlElement("w:gridCol")
        grid_col.set(qn("w:w"), str(int(round(width * 1440))))
        grid.append(grid_col)

    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            dxa = int(round(width * 1440))
            cell.width = Inches(width)
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(dxa))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)


def set_run_font(run, name="Calibri", size=None, color=None, bold=None, italic=None) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def add_field(paragraph, field: str) -> None:
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = field
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr, fld_char2])


def add_header_footer(section, label="2027–2032 Strategic Plan Workspace Summary") -> None:
    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hp.paragraph_format.space_after = Pt(0)
    run = hp.add_run(label)
    set_run_font(run, size=8.5, color=SLATE, bold=True)
    p_pr = hp._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), BORDER)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    fp.paragraph_format.space_before = Pt(0)
    r = fp.add_run("Internal working document  |  ")
    set_run_font(r, size=8.5, color=SLATE)
    add_field(fp, "PAGE")


def configure_section(section, landscape=False, first_page=False) -> None:
    if landscape:
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width = Inches(11)
        section.page_height = Inches(8.5)
        section.left_margin = Inches(0.65)
        section.right_margin = Inches(0.65)
        section.top_margin = Inches(0.7)
        section.bottom_margin = Inches(0.65)
    else:
        section.orientation = WD_ORIENT.PORTRAIT
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
    section.header_distance = Inches(0.32)
    section.footer_distance = Inches(0.32)
    section.different_first_page_header_footer = first_page
    if not first_page:
        add_header_footer(section)


def add_section(doc, landscape=False):
    section = doc.add_section(WD_SECTION.NEW_PAGE)
    section.header.is_linked_to_previous = False
    section.footer.is_linked_to_previous = False
    configure_section(section, landscape=landscape)
    return section


def style_document(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(BLACK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1
    for name, size, color, before, after in (
        ("Heading 1", 19, NAVY, 0, 10),
        ("Heading 2", 13, NAVY, 10, 6),
        ("Heading 3", 11, NAVY_DARK, 8, 4),
    ):
        style = styles[name]
        style.font.name = "Calibri"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True


def add_kicker(doc: Document, text: str, color=NAVY) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text.upper())
    set_run_font(run, size=8.5, color=color, bold=True)
    run.font.all_caps = True


def add_intro(doc: Document, text: str) -> None:
    p = doc.add_paragraph(text)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.15


def add_source_line(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(f"Source snapshot: {text}")
    set_run_font(run, size=8.5, color=SLATE, italic=True)


def add_limit_box(doc: Document, title: str, text: str, width=6.5) -> None:
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    set_table_geometry(table, [width])
    cell = table.cell(0, 0)
    set_cell_shading(cell, LIGHT)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(title)
    set_run_font(r, size=9, color=NAVY_DARK, bold=True)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    r2 = p2.add_run(text)
    set_run_font(r2, size=9, color=SLATE)


def add_caption(doc: Document, label: str) -> None:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(5)
    r = p.add_run(label)
    set_run_font(r, size=8.5, color=SLATE, italic=True)


def add_table(
    doc: Document,
    headers: Sequence[str],
    rows: Iterable[Sequence[str]],
    widths: Sequence[float],
    font_size=8.5,
    header_fill=NAVY,
    total_last=False,
    align_numeric_from=1,
):
    rows = list(rows)
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    table.style = "Table Grid"
    header = table.rows[0]
    set_repeat_table_header(header)
    for i, text in enumerate(headers):
        cell = header.cells[i]
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        set_cell_shading(cell, header_fill)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER if i >= align_numeric_from else WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(text)
        set_run_font(r, size=font_size, color=WHITE, bold=True)

    for row_index, values in enumerate(rows):
        row = table.add_row()
        is_total = total_last and row_index == len(rows) - 1
        for i, value in enumerate(values):
            cell = row.cells[i]
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            if is_total:
                set_cell_shading(cell, LIGHT_BLUE)
            elif row_index % 2:
                set_cell_shading(cell, "F8FAFC")
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT if i >= align_numeric_from else WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.0
            r = p.add_run(str(value))
            set_run_font(r, size=font_size, color=BLACK, bold=is_total or i == 0)
    set_table_geometry(table, widths)
    return table


def add_metric_strip(doc: Document, metrics: Sequence[tuple[str, str]], width=6.5) -> None:
    each = width / len(metrics)
    table = doc.add_table(rows=1, cols=len(metrics))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    for idx, (value, label) in enumerate(metrics):
        cell = table.cell(0, idx)
        set_cell_shading(cell, LIGHT_BLUE if idx % 2 == 0 else LIGHT_VIOLET)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(1)
        r = p.add_run(value)
        set_run_font(r, size=16, color=NAVY_DARK, bold=True)
        p2 = cell.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_after = Pt(0)
        r2 = p2.add_run(label.upper())
        set_run_font(r2, size=7.5, color=SLATE, bold=True)
    set_table_geometry(table, [each] * len(metrics))


def make_chart() -> None:
    width, height = 2200, 1050
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    font_dir = Path("C:/Windows/Fonts")

    def font(size: int, bold=False):
        candidate = font_dir / ("arialbd.ttf" if bold else "arial.ttf")
        try:
            return ImageFont.truetype(str(candidate), size)
        except OSError:
            return ImageFont.load_default()

    label_font = font(27)
    small_font = font(24)
    bold_font = font(27, True)
    left, top, right, bottom = 185, 145, 2120, 880
    max_value = 4_500_000

    def point(year: int, value: int):
        x = left + (year - 2008) / (2026 - 2008) * (right - left)
        y = bottom - value / max_value * (bottom - top)
        return int(x), int(y)

    for value in range(0, max_value + 1, 1_000_000):
        y = point(2008, value)[1]
        draw.line((left, y, right, y), fill="#DDE5EF", width=2)
        draw.text((left - 25, y), f"{value / 1_000_000:.1f}M", fill="#475569", font=label_font, anchor="rm")

    draw.line((left, top, left, bottom), fill="#94A3B8", width=3)
    draw.line((left, bottom, right, bottom), fill="#94A3B8", width=3)
    for year in RIDERSHIP_YEARS:
        x, _ = point(year, 0)
        draw.line((x, bottom, x, bottom + 10), fill="#94A3B8", width=2)
        draw.text((x, bottom + 25), str(year), fill="#475569", font=small_font, anchor="ma")

    completed_points = [point(year, value) for year, value in zip(RIDERSHIP_YEARS[:-1], RIDERSHIP_TOTALS[:-1])]
    draw.line(completed_points, fill="#2563EB", width=8, joint="curve")
    for x, y in completed_points:
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill="#2563EB", outline="white", width=2)

    p2025 = point(2025, RIDERSHIP_TOTALS[-2])
    pforecast = point(2026, RIDERSHIP_FORECAST)
    segments = 12
    for i in range(segments):
        if i % 2 == 0:
            x1 = p2025[0] + (pforecast[0] - p2025[0]) * i / segments
            y1 = p2025[1] + (pforecast[1] - p2025[1]) * i / segments
            x2 = p2025[0] + (pforecast[0] - p2025[0]) * (i + 1) / segments
            y2 = p2025[1] + (pforecast[1] - p2025[1]) * (i + 1) / segments
            draw.line((x1, y1, x2, y2), fill="#7C3AED", width=8)
    draw.ellipse((pforecast[0] - 11, pforecast[1] - 11, pforecast[0] + 11, pforecast[1] + 11), fill="#7C3AED", outline="white", width=3)

    pytd = point(2026, RIDERSHIP_TOTALS[-1])
    draw.ellipse((pytd[0] - 12, pytd[1] - 12, pytd[0] + 12, pytd[1] + 12), fill="#0891B2", outline="white", width=3)
    draw.text((pforecast[0] - 22, pforecast[1] - 28), "2026 base: 2.64M", fill="#5B21B6", font=bold_font, anchor="rs")
    draw.text((pytd[0] - 22, pytd[1] + 25), "YTD: 1.85M", fill="#0E7490", font=bold_font, anchor="ra")

    legend_y = 70
    draw.line((left, legend_y, left + 90, legend_y), fill="#2563EB", width=8)
    draw.text((left + 105, legend_y), "Completed calendar year", fill="#334155", font=label_font, anchor="lm")
    draw.line((left + 570, legend_y, left + 660, legend_y), fill="#7C3AED", width=8)
    draw.text((left + 675, legend_y), "2026 base projection", fill="#334155", font=label_font, anchor="lm")
    draw.ellipse((left + 1125, legend_y - 10, left + 1145, legend_y + 10), fill="#0891B2")
    draw.text((left + 1160, legend_y), "2026 YTD through Sep 1", fill="#334155", font=label_font, anchor="lm")
    draw.text((left, top - 32), "Fixed-route boardings", fill="#334155", font=bold_font, anchor="ls")
    image.save(CHART, dpi=(220, 220))


def add_picture_alt_text(inline_shape, title: str, description: str) -> None:
    doc_pr = inline_shape._inline.docPr
    doc_pr.set("name", title)
    doc_pr.set("descr", description)


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    make_chart()

    doc = Document()
    style_document(doc)
    first = doc.sections[0]
    configure_section(first, landscape=False, first_page=True)

    # Cover
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(72)
    p.paragraph_format.space_after = Pt(12)
    r = p.add_run("BARRIE TRANSIT")
    set_run_font(r, size=10, color=CYAN, bold=True)
    r.font.all_caps = True
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run("2027–2032 Strategic Plan")
    set_run_font(r, size=31, color=NAVY_DARK, bold=True)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(22)
    r = p.add_run("Workspace Summary")
    set_run_font(r, size=22, color=NAVY, bold=True)
    rule = doc.add_paragraph()
    rule.paragraph_format.space_after = Pt(22)
    p_pr = rule._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "24")
    bottom.set(qn("w:color"), CYAN)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run("A working-team snapshot of six Strategic Plan workspaces")
    set_run_font(r, size=14, color=SLATE)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(f"Captured from the authenticated Barrie Transit workspace on {CAPTURE_DATE}")
    set_run_font(r, size=10.5, color=SLATE)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(170)
    r = p.add_run("INTERNAL WORKING DOCUMENT")
    set_run_font(r, size=9, color=NAVY, bold=True)
    r.font.all_caps = True

    # Contents
    add_section(doc, landscape=False)
    add_kicker(doc, "Report guide")
    doc.add_heading("Contents and reading notes", level=1)
    add_intro(doc, "This report selects one summary table or graph from each workspace. It preserves the source definitions and limitations shown in the application; it is not a new analytical model or an approval record.")
    contents = [
        ["1", "Project Work Plan", "3"],
        ["2", "Current Scheduled Service", "4"],
        ["3", "Trip Planning Trends", "5"],
        ["4", "Annual Ridership", "6"],
        ["5", "Bus Fleet Plan", "7"],
        ["6", "Published Route Schedules", "8"],
        ["", "Evidence definitions and source register", "9"],
    ]
    add_table(doc, ["Section", "Workspace", "Page"], contents, [0.75, 4.9, 0.85], font_size=9.5, align_numeric_from=2)
    doc.add_paragraph()
    add_limit_box(doc, "Freshness rule", "All values were read from the signed-in production workspace on the capture date. No demo values, local fallback estimates, or copied datasets were used.")
    doc.add_paragraph()
    add_limit_box(doc, "How to use this report", "Use the visuals as a common working reference. Return to the source workspace before making a decision that depends on current status, newly published schedules, daily ridership, or revised fleet assumptions.")

    # 1 Work plan
    add_section(doc, landscape=True)
    add_kicker(doc, "1 · Project control", CYAN)
    doc.add_heading("Project Work Plan", level=1)
    add_intro(doc, "The shared work plan contains 73 tasks across four phases. This roll-up shows the baseline timing and current status recorded in revision 1.")
    add_source_line(doc, "Shared revision 1 · Dillon Consulting Limited work plan dated June 16, 2026 · baseline window August 3, 2026 to September 27, 2027")
    add_table(
        doc,
        ["Phase", "Baseline window", "Tasks", "Avg. progress", "Unconfirmed", "In progress", "At risk / blocked", "Complete", "Unscheduled"],
        WORKPLAN,
        [2.4, 1.65, 0.6, 0.8, 0.8, 0.75, 0.95, 0.65, 0.8],
        font_size=8.2,
        total_last=True,
        align_numeric_from=2,
    )
    add_caption(doc, "Table 1. Project Work Plan status by phase")
    add_limit_box(doc, "Interpretation limit", "All 73 tasks remain Unconfirmed at 0% progress. The proposal establishes timing and proposed responsibility, not current completion. Two rows are unscheduled in the source.", width=9.7)

    # 2 Service baseline
    add_section(doc, landscape=True)
    add_kicker(doc, "2 · Existing service baseline", BLUE)
    doc.add_heading("Current Scheduled Service — Weekday", level=1)
    add_intro(doc, "This table summarizes the weekday service span, sustained peak and off-peak frequency regimes, and scheduled revenue hours for each route family in the bundled static GTFS snapshot.")
    add_source_line(doc, "Barrie Transit static GTFS version 20260503b · feed validity May 27 to August 29, 2026")
    add_table(
        doc,
        ["Route", "Route name", "Service span", "Peak frequency and span", "Off-peak frequency and span", "Revenue hours / day"],
        SERVICE,
        [0.65, 1.85, 1.55, 1.85, 3.0, 0.8],
        font_size=8.2,
        align_numeric_from=5,
    )
    add_caption(doc, "Table 2. Current scheduled weekday service route summaries")
    add_limit_box(doc, "Interpretation limit", "This is a dated planning snapshot, not live service. Revenue hours exclude terminal recovery and deadhead. Frequencies are simplified route-level scheduled headways; N/A means no service in that category.", width=9.7)

    # 3 Trip planning
    add_section(doc, landscape=False)
    add_kicker(doc, "3 · Rider-planning evidence", CYAN)
    doc.add_heading("Trip Planning Trends", level=1)
    add_intro(doc, "The Transit App overview identifies the routes with the most nearby views and engagement during the available evidence period.")
    add_source_line(doc, "Canonical Transit App aggregate · January 1 to September 30, 2025")
    add_metric_strip(doc, [("62,396", "User-days"), ("165,319", "Trip requests"), ("10", "Routes tracked"), ("92", "Days covered")])
    doc.add_paragraph()
    add_table(doc, ["Route", "Nearby views", "Taps", "Average / day"], TRIP_ROUTES, [1.1, 1.8, 1.7, 1.9], font_size=9.5, align_numeric_from=1)
    add_caption(doc, "Table 3. Top routes by nearby views and engagement")
    add_limit_box(doc, "Interpretation limit", "Transit App records describe app engagement and requested-trip evidence. They do not prove boardings, unique riders, residence, trip completion, or service need.")

    # 4 Ridership
    add_section(doc, landscape=False)
    add_kicker(doc, "4 · Long-range boarding trend", VIOLET)
    doc.add_heading("Annual Ridership", level=1)
    add_intro(doc, "Completed annual fixed-route boardings are shown from 2008 to 2025. The 2026 point separates actual year-to-date activity from the modelled base projection.")
    add_source_line(doc, "Transit Annual Ridership.xlsx through July 2026 + daily STREETS fixed-route boardings from August 1, 2026 · evidence through September 1, 2026")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    shape = p.add_run().add_picture(str(CHART), width=Inches(6.45))
    add_picture_alt_text(shape, "Annual fixed-route ridership", "Line chart of completed annual fixed-route boardings from 2008 to 2025, with 2026 year-to-date boardings and a dashed 2026 base projection.")
    add_caption(doc, "Figure 1. Scheduled-route annual ridership with 2026 YTD and base projection")
    add_metric_strip(doc, [("1,851,423", "2026 YTD"), ("2,640,044", "Base projection"), ("2,573,240", "Low scenario"), ("2,706,848", "High scenario")])
    doc.add_paragraph()
    add_limit_box(doc, "Interpretation limit", "Ridership is boarding activity, not unique riders. The 2026 outlook is derived, not a target: it applies the Jan–Aug comparison with 2025 to the remaining seasonal pattern. On Demand is unavailable and is not included in the history or forecast.")

    # 5 Fleet
    add_section(doc, landscape=False)
    add_kicker(doc, "5 · Fleet planning assumptions", AMBER)
    doc.add_heading("Bus Fleet Plan", level=1)
    add_intro(doc, "The fleet outlook summarizes planned totals and lifecycle activity for each year of the 2027–2032 horizon.")
    add_source_line(doc, "2026-04-08 - Fleet_Plan.xlsx · version 1 · updated April 29, 2026")
    add_table(doc, ["Year", "Planned fleet total", "Retiring", "Replacement purchases", "Growth purchases"], FLEET, [0.8, 1.55, 1.05, 1.65, 1.45], font_size=9.5, align_numeric_from=1)
    add_caption(doc, "Table 4. Fleet outlook by plan year")
    doc.add_paragraph()
    add_limit_box(doc, "Interpretation limit", "Fleet Plan records are current planning assumptions for vehicle lifecycle, replacement, and growth. They do not establish approved capital funding, procurement timing, vehicle availability, operating cost, or Council approval.")

    # 6 Master schedule
    add_section(doc, landscape=True)
    add_kicker(doc, "6 · Published planning source", GREEN)
    doc.add_heading("Published Route Schedules", level=1)
    add_intro(doc, "The Master Schedule overview aggregates service hours from the current published route/day schedules. Annual values use the configured 2026 holiday-adjusted service-day counts.")
    add_source_line(doc, "Canonical Barrie Transit Master Schedule · 29 published route/day entries across 10 routes · 252 weekdays, 51 Saturdays, and 56 Sundays")
    add_table(
        doc,
        ["Route", "Weekday daily", "Weekday annual", "Saturday daily", "Saturday annual", "Sunday daily", "Sunday annual", "Total annual"],
        MASTER,
        [0.65, 1.1, 1.25, 1.1, 1.25, 1.0, 1.15, 1.2],
        font_size=8.4,
        total_last=True,
        align_numeric_from=1,
    )
    add_caption(doc, "Table 5. Published Master Schedule service hours")
    add_limit_box(doc, "Interpretation limit", "These records describe the current published planning source. They do not establish service actually delivered, reliability, ridership, cost, or future Strategic Plan approval. Route 400 has no published Sunday entry.", width=9.7)

    # Source register
    add_section(doc, landscape=False)
    add_kicker(doc, "Reference")
    doc.add_heading("Evidence definitions and source register", level=1)
    add_intro(doc, "The six workspaces intentionally remain separate because their measures answer different planning questions. The report preserves those boundaries.")
    source_rows = [
        ["Project Work Plan", "Shared revision 1", "Status and progress require confirmation; not an approval record."],
        ["Current Scheduled Service", "GTFS 20260503b; May 27–Aug 29, 2026", "Static schedule snapshot; not live or delivered service."],
        ["Trip Planning Trends", "Transit App; Jan 1–Sep 30, 2025", "App engagement and requested trips; not ridership."],
        ["Annual Ridership", "Workbook + STREETS through Sep 1, 2026", "Fixed-route boardings; not unique riders or causation."],
        ["Bus Fleet Plan", "Version 1; updated Apr 29, 2026", "Planning assumptions; not funding or procurement approval."],
        ["Published Route Schedules", "29 current route/day entries; captured Sep 2, 2026", "Published planning source; not delivered service."],
    ]
    add_table(doc, ["Workspace", "Source snapshot", "Use boundary"], source_rows, [1.75, 2.15, 2.6], font_size=8.8, align_numeric_from=99)
    add_caption(doc, "Table 6. Source register and interpretation boundaries")
    doc.add_heading("Document controls", level=2)
    p = doc.add_paragraph()
    p.add_run("Prepared for: ").bold = True
    p.add_run("Barrie Transit Strategic Plan working team")
    p = doc.add_paragraph()
    p.add_run("Workspace captured: ").bold = True
    p.add_run(CAPTURE_DATE)
    p = doc.add_paragraph()
    p.add_run("Data handling: ").bold = True
    p.add_run("Read-only review of authenticated source workspaces; no source records were changed or copied back into the application.")

    doc.core_properties.title = "2027–2032 Strategic Plan Workspace Summary"
    doc.core_properties.subject = "Working-team summary of six Barrie Transit Strategic Plan workspaces"
    doc.core_properties.author = "Barrie Transit"
    doc.core_properties.keywords = "Strategic Plan, Barrie Transit, Work Plan, Ridership, Fleet, Service"
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
