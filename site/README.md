# Monthly Transit Dashboard

An offline, one-page management report for Barrie Transit. Each month, import an
Excel workbook and the dashboard shows the month's key measures against targets
and against the same month last year. It can be printed or saved as a two-page
PDF.

It is separate from Scheduler 4: it has its own dependencies, it builds on its
own, and it does not use Firebase or the network.

## Using it

1. Build it once (see below), or use a copy of `Transit-Dashboard.html` that
   someone has already built.
2. Double-click the HTML file. It opens in Edge or Chrome and runs entirely on
   this computer. No internet connection or server is needed.
3. Click **Download blank template**, fill in the workbook, then **Choose Excel
   file** (or drag the workbook onto the window).
4. Use **Month** to look at any month in the workbook, and **Print / PDF** to
   produce the monthly report.

The last imported workbook is remembered on that computer, in the browser's
local storage. Use **Remove data** in the footer to clear it. Nothing is
uploaded anywhere.

To see it working before you have real data, use **Preview with sample data** or
**Download sample workbook**. Sample numbers are invented.

## The workbook

Sheet names and column headers are matched without regard to case, spacing or
punctuation, and common alternatives are accepted (for example `OTP` for
`On-Time %` and `Ridership` for `Boardings`). The header row can sit below a
title block. A single-sheet workbook or CSV file is read as **System Monthly**.

| Sheet | Required | Columns |
|---|---|---|
| **System Monthly** | Yes | Month, Boardings, Revenue Hours, Scheduled Trips, Trips Operated, On-Time %, Fare Revenue, Operating Cost, Complaints |
| **Routes** | No | Month, Route, Route Name, Boardings, Revenue Hours, On-Time % |
| **Targets** | No | Measure, Target (one row per measure; see the template for names) |
| **Notes** | No | Month, Title, Detail (shown under "Needs attention"; leave Month blank to show a note every month) |

- **Month**: any Excel date in the month, or text such as `2026-09` or `Sep 2026`.
- **Percentages**: `84.3`, `84.3%` and an Excel-formatted `0.843` all mean 84.3%.
- **Blank cells** are fine. That measure shows "No data" instead of a wrong number.
- Keep **at least 13 months** in the workbook so each month can be compared with the
  same month a year earlier. Year-to-date totals run from January.

Rows with an unreadable month are skipped. A cell that isn't a number is treated
as blank. A month listed twice uses the last row. Each of these is listed under
"Imported with notes" after an import.

## Measures

| Measure | Calculation | "Watch" band |
|---|---|---|
| Total boardings | Boardings | within 3% of target |
| Boardings per revenue hour | Boardings ÷ revenue hours | within 5% |
| On-time performance | On-Time % as supplied | within 2 points |
| Service delivered | Trips operated ÷ scheduled trips | within 0.5 points |
| Farebox recovery ratio | Fare revenue ÷ operating cost | within 2 points |
| Operating cost per boarding | Operating cost ÷ boardings (lower is better) | within 5% |
| Revenue hours operated | Revenue hours | within 2% |
| Complaints per 100k boardings | Complaints ÷ boardings × 100,000 (lower is better) | within 15% |

A measure that meets its target is **On target**. One that misses but is inside
the band is **Watch**, and anything worse is **Below**. Route on-time performance
uses the system on-time target. The bands are set in `src/lib/kpis.ts`
(`KPI_DEFS`).

## Development

```bash
cd site
npm ci           # installs from the lockfile (a fresh `npm install` needs npm 11+)
npm run dev      # http://localhost:3010
npm test         # importer and measure tests
npm run build    # typecheck, then build dist/index.html as one self-contained file
```

`dist/index.html` is the whole app: scripts, styles and fonts are inlined.
Rename it (for example `Transit-Dashboard.html`) and share or copy it as a single
file.

| Path | What it holds |
|---|---|
| `src/lib/workbookSchema.ts` | Sheet names, column headers and accepted aliases |
| `src/lib/importWorkbook.ts` | Reads and validates the workbook |
| `src/lib/kpis.ts` | Measure calculations, targets and status bands |
| `src/lib/template.ts` | Blank template and sample workbook |
| `src/components/` | Dashboard panels |
