# Performance Reports Tab — Implementation Plan

## Context

Barrie Transit has a working Performance Dashboard with OTP, ridership, and load profile modules powered by STREETS data imports. The next step is a **Reports** tab within the Performance workspace that lets transit planners:
1. Pull structured reports (weekly/monthly summary, route deep-dive) with date range filtering
2. Export reports to Excel
3. Ask the AI natural-language questions about their performance data

This builds on the existing `PerformanceDataSummary` data model, recharts visualizations, Gemini API pattern, and exceljs/jsPDF packages already in the project.

---

## Phase 1: Reports Tab Shell + Date Range Picker

### 1.1 Add "Reports" tab to PerformanceWorkspace
**File:** `components/Performance/PerformanceWorkspace.tsx`
- Add `'reports'` to `PerformanceTab` type
- Add entry to `TAB_CONFIG`: `{ id: 'reports', label: 'Reports', icon: FileText, status: 'complete' }`
- Add case to `renderPanel()`: `<ReportsModule data={data} />`

### 1.2 Create ReportsModule container
**New file:** `components/Performance/ReportsModule.tsx`
- Sub-navigation with 3 panels: **Weekly/Monthly Summary** | **Route Performance** | **AI Assistant**
- Shared `DateRangePicker` at top (all panels use same date range)
- Filters `data.dailySummaries` to selected range, passes filtered data to active panel

### 1.3 Create DateRangePicker component
**New file:** `components/Performance/reports/DateRangePicker.tsx`
- **Presets:** Last 7 days, Last 14 days, Last 30 days, This month, Last month, All data
- **Custom:** Start date + end date inputs (HTML `<input type="date">`)
- Constrained to available dates in `data.dailySummaries`
- Day type filter toggle (All / Weekday / Saturday / Sunday) — reuses existing pattern
- Returns `{ startDate, endDate, dayTypeFilter }` via onChange callback

---

## Phase 2: Weekly/Monthly Summary Report

**New file:** `components/Performance/reports/WeeklySummaryReport.tsx`

### System Scorecard (top section)
- KPI row using existing `MetricCard` pattern: OTP%, Total Ridership, Vehicles, Peak Load, Trips
- Each KPI shows **delta vs previous period** (e.g., "+2.3% vs prior week") and color-coded arrow
- **Benchmark indicators**: green/amber/red vs custom target if set

### Route Scorecard Table
- All routes ranked by BPH (matches daily email pattern)
- Columns: Route, OTP%, Early%, Late%, Ridership, Alightings, Trips, Avg Load, BPH
- Color-coded OTP pills (green >= 85%, amber >= 75%, red < 75%)
- Sortable columns

### Trend Charts
- **OTP trend**: Line chart, day-by-day OTP% over selected range
- **Ridership trend**: Bar chart, daily boardings over selected range
- **Hourly distribution**: Composed chart (bars = boardings, line = BPH) averaged over range

### Benchmark Logic
- **Previous period**: Auto-calculated — if user selects 7 days, compare to prior 7 days from loaded data
- **Year-over-year**: Only shown if prior-year data is loaded (check dates in dailySummaries)
- **Custom targets**: Stored in component state initially; later could persist to Firebase
  - Default targets: OTP 85%, ridership growth 0% (neutral baseline)

---

## Phase 3: Route Performance Report

**New file:** `components/Performance/reports/RoutePerformanceReport.tsx`

### Route Selector
- Dropdown of all routes found in filtered data
- Shows route ID + name

### Route Detail Sections (for selected route, within date range)
1. **KPI Summary**: OTP%, ridership, trips, service hours, avg load, max load, wheelchair trips, avg deviation
2. **OTP by Timepoint**: Table of stops (timepoints only) with OTP%, early%, late%, avg deviation — identifies problem spots
3. **Ridership by Stop**: Horizontal bar chart — boardings + alightings per stop
4. **Load Profile**: Line chart of avg load by stop sequence (reuses LoadProfileModule pattern)
5. **Daily Trend**: OTP% and ridership trend lines day-by-day for this route
6. **Trip Table**: Sortable table of all trips — departure time, block, OTP%, boardings, max load
7. **Worst Performers**: Highlight trips with OTP <= 75% or avg delay > 10 min

---

## Phase 4: Excel Export

**New file:** `components/Performance/reports/reportExporter.ts`

Uses `exceljs` (already in package.json).

### Weekly Summary Export
- **Sheet 1 "Summary"**: System KPIs with period comparison
- **Sheet 2 "Route Scorecard"**: Full route table with all metrics
- **Sheet 3 "Daily Trend"**: Date, OTP%, Ridership, Vehicles for each day
- **Sheet 4 "Hourly"**: Hour, avg boardings, avg OTP%

### Route Performance Export
- **Sheet 1 "Route Summary"**: KPIs for selected route
- **Sheet 2 "Stop Performance"**: Per-stop OTP, ridership, loads
- **Sheet 3 "Trip Detail"**: Full trip table with all metrics
- **Sheet 4 "Daily Trend"**: Day-by-day route metrics

### Export Pattern
```typescript
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Summary');
// Add headers, rows, styling
const buffer = await workbook.xlsx.writeBuffer();
const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
// Trigger download via link click
```

---

## Phase 5: AI Performance Assistant

### 5.1 API Endpoint
**New file:** `api/performance-query.ts`
- Accepts: `{ question: string, context: object, contextTier: string }`
- Uses existing `callGemini()` pattern from `api/optimize.ts`
- Returns: `{ answer: string, dataPoints?: object[] }`
- **No structured schema** — returns natural language (unlike the optimizer which returns JSON shifts)
- Temperature: 0.3 (factual, data-focused)

### 5.2 Vite Middleware
**File:** `vite.config.ts`
- Add `/api/performance-query` route following same pattern as `/api/optimize`
- Read body, get API key from env, call handler, return JSON

### 5.3 Context Builder
**New file:** `utils/ai/performanceQueryService.ts`

**Tiered context injection** — builds the right-sized context based on question:

| Tier | What's Sent | Token Estimate | Triggered By |
|------|-------------|---------------|--------------|
| `system` | System-level metrics for all days in range | ~5-10K | Default for trend/overview questions |
| `route` | System + specific route metrics all days | ~15-25K | Question mentions a route name/ID |
| `stops` | System + stop-level data for date range | ~50-80K | Question about stops, locations |
| `trips` | System + trip-level data for a few days | ~80-120K | Question about specific trips, blocks |

**Context builder function:**
```typescript
buildQueryContext(data: PerformanceDataSummary, filteredDays: DailySummary[], tier: ContextTier): string
```
- Serializes relevant metrics as concise text (not raw JSON — saves tokens)
- Example: `"Route 1 NORTH LOOP: OTP 82.3%, 1,245 boardings, 89 trips, avg load 18.2"`

**Auto-tier detection:**
- Scan question for route IDs/names -> route tier
- Scan for "stop", "location", "timepoint" -> stops tier
- Scan for "trip", "block", "driver" -> trips tier
- Default -> system tier
- User can override via dropdown

### 5.4 System Prompt
```
You are a transit performance analyst for Barrie Transit, a mid-size municipal transit agency
in Ontario, Canada.

You are given performance data from the STREETS AVL/APC system. Answer questions accurately
using ONLY the provided data. If the data doesn't contain enough information to answer, say so.

Key definitions:
- OTP (On-Time Performance): Trips arriving within -3 min (early) to +5 min (late) of schedule
- BPH (Boardings Per Hour): Ridership efficiency metric
- Load: Passengers on board at a given stop
- Timepoint: A stop where schedule adherence is measured

When providing analysis:
- Cite specific numbers from the data
- Highlight concerning trends (OTP < 85%, declining ridership)
- Suggest possible causes when patterns are clear
- Keep responses concise and actionable
```

### 5.5 AI Assistant UI
**New file:** `components/Performance/reports/AIQueryPanel.tsx`

- **Question input**: Text input with submit button
- **Suggested questions** (chips):
  - "Which routes had the worst OTP this week?"
  - "How is ridership trending compared to last period?"
  - "Which stops are causing the most delays?"
  - "Summarize system performance for the selected period"
- **Context tier selector**: Auto (default) | System | Route | Stops | Trips
- **Response display**: Markdown-rendered response area
- **Loading state**: Spinner with "Analyzing performance data..."
- **Conversation**: Single Q&A (not multi-turn) — keeps it simple, avoids token bloat

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `components/Performance/PerformanceWorkspace.tsx` | Modify | Add 'reports' tab |
| `components/Performance/ReportsModule.tsx` | Create | Reports container with sub-nav + date picker |
| `components/Performance/reports/DateRangePicker.tsx` | Create | Preset + custom date range selection |
| `components/Performance/reports/WeeklySummaryReport.tsx` | Create | System + route scorecard + trends |
| `components/Performance/reports/RoutePerformanceReport.tsx` | Create | Single-route deep dive |
| `components/Performance/reports/AIQueryPanel.tsx` | Create | AI Q&A interface |
| `components/Performance/reports/reportExporter.ts` | Create | Excel export for both report types |
| `api/performance-query.ts` | Create | Gemini endpoint for Q&A |
| `utils/ai/performanceQueryService.ts` | Create | Client fetch + context builder |
| `vite.config.ts` | Modify | Add /api/performance-query middleware route |

---

## Build Order

1. **Phase 1** — Tab shell + DateRangePicker + ReportsModule (scaffold)
2. **Phase 2** — Weekly/Monthly Summary (on-screen)
3. **Phase 3** — Route Performance Report (on-screen)
4. **Phase 4** — Excel export for both reports
5. **Phase 5** — AI Assistant (API endpoint + context builder + UI)

Each phase produces a working, buildable increment. Commit after each phase.

---

## Verification

- `npm run build` after every phase
- Manual verification: navigate to Performance > Reports tab, check each sub-panel renders
- Excel export: download and open in Excel, verify sheets and data
- AI Q&A: test with sample questions against loaded STREETS data
- Edge cases: no data loaded, single day only, all days filtered out by day type
