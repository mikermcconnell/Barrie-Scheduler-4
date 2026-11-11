# Daily Performance Email Redesign: Implementation Plan

Date: 2026-11-11. Status: approved design, not started.

This plan is a handoff. It contains everything needed to do the work without the original conversation.

## 1. Goal

Make the daily operations email to Transit Management shorter and remove repeated figures. The approved design is the mockup `explainers/daily-email-redesign.html`. Open it in a browser before you start. The pink numbered markers show each change.

The mockup uses browser CSS (grid, flex) and JavaScript. **Do not copy its markup.** The real email must use the rules in section 3.

## 2. Files

| File | Role |
|---|---|
| `functions/src/reportHtml.ts` | The email template. Almost all work is here. |
| `functions/src/dailyGlance.ts` | Model for status, headline, comparisons, standouts, actions. One small change. |
| `functions/src/dailyReport.ts` | Sends the email. **No change.** The subject at line 45 stays as it is. |
| `tests/reportHtml.dailyEmail.test.ts` | Main test file. Many tests change. |
| `tests/dailyGlance.test.ts` | Three assertions change (lines 119, 133, 136). |
| `tests/featuredTrip.test.ts` | One test checks section order (line 148). |
| `tests/performanceInBetweenRidership.test.ts` | Line 171 expects `'204 alightings'`. |

Do not edit: `functions/src/featuredTrip.ts`, `functions/src/emailIconData.ts`, `scripts/prepareRidershipCorrection.mjs`, `extensions/firestore-send-email.env`.

## 3. Rules for email HTML

- Layout with `<table>` and inline `style` only. No `<style>` block, flexbox, grid, SVG or JavaScript. Outlook drops them.
- Charts are table columns that hold stacked `<div>` blocks with fixed pixel heights. Copy the pattern in `buildWeeklyDwellChart` (`reportHtml.ts:895`).
- Icons are `cid:` images made by `iconBadge()`. Keep the icons that exist now.
- Escape every external string with `escapeHtml()`.
- No `any`. Exported functions keep explicit types.

## 4. Decisions already made

Do not reopen these.

1. Subject line: no change.
2. A status strip (badge and headline) goes directly under the header. This reverses an older decision (test "does not render the review status banner above the KPI cards"). The user approved the strip in the mockup.
3. Route scorecard order: boardings per hour (BPH), highest first. This is the current order.
4. The stop item is the top 10 stops by ridership. The "Lowest OTP Stops" table is removed.
5. Trip of the Day stays, with its current content, as the last section.
6. Last 7 days is a graph, not a table.
7. These sections are removed from the email: OTP Distribution bar, Boardings by Hour, Operator Dwell by Stop.
8. The legacy fallback (`buildExecutiveSummary`, `buildActionFocus`, `deriveReportStatus`) stays for reports without `routeHistory`. Do not delete or restyle it.

## 5. Final section order

1. Header (compact)
2. Status strip (only when the glance model exists)
3. KPI cards
4. "What Stood Out" (left) and "Action Focus" (right)
5. Route Scorecard
6. Last 7 Days (graph)
7. Weekly Operator Dwell (only when `showWeeklyDwellSection`; no content change)
8. Missed Trips (only when `totalMissed > 0`)
9. Top 10 Stops by Ridership
10. Trip of the Day (no content change)
11. Footer

## 6. Work steps

Do the phases in order. After each phase run the focused tests in section 8 and fix them before you continue.

### Phase 1: Model change (`dailyGlance.ts`)

1. Add `detail?: string` to `GlanceComparison`.
2. In `buildComparisons`, split the riders verdict. `verdict` becomes only `▲ 8%` or `▼ 11%` (or `normal`). The rank text (`busiest weekday in 4 weeks`, `5th busiest weekday in 4 weeks`) moves to `detail`. Leave `detail` undefined when there is no rank.
3. Update `tests/dailyGlance.test.ts` lines 119, 133, 136 to check `verdict` and `detail` separately.

### Phase 2: Header, status strip, KPI cards (`reportHtml.ts`)

**Header** (`buildReportHtml`, from line 1690)

- Replace the centred block with one two-cell table row.
  - Left cell: the bus icon (`iconBadge('bus', '#ffffff', 18)`), then `${teamName} Daily Performance Report` (about 20px, weight 900), then a second line `${formatDateLong(latestDay.date)} · ${DWELL_DAY_TYPE_LABEL[latestDay.dayType]} service` (13px, `#93c5fd`).
  - Right cell: the existing "Open full dashboard →" link, same URL.
- Delete `dateRangeLabel` and `dayTypeLabel` (lines 1644 to 1666). This removes the wrong "Historical Service Data" text.
- Keep `teamName` escaped as it is used now.

**Status strip**

- New function `buildStatusStrip(glance: GlanceModel): string`. White background, bottom border `#e5e7eb`, padding `14px 20px`. Content: the status badge (colours from `GLANCE_STATUS_STYLE`) and `escapeHtml(glance.headline)` at 16px, weight 700.
- Render it between the header and the `padding:18px` body div, only when `glance` is not null.

**KPI cards**

Keep `kpiCard()`, its icons and its centred style. Change only the text lines. Each card has a first grey line and an optional second lighter line. If `kpiCard` needs a second-line parameter, add one; keep the long style string that the "KPI card sizing" test matches, or update that test's regular expression together with it.

| Card | First line | Second line |
|---|---|---|
| On-time performance | `usual 89.1% · normal` from `glance.comparisons` item with label `On-time` (`usual` and `verdict`, verdict coloured with `GLANCE_TONE_COLOR[tone]`) | `1.9% early · 9.6% late` |
| Total ridership | `usual 9,105 · normal` from the `Riders` comparison | `detail` when present |
| Trips operated | No text change | none |
| Operator Dwell | `usual 70 · normal`. Use `high` in `#d97706` when `comparison.elevated`. Omit the line when `typicalPer100` is null | `Total: 6.9 hrs` |

- When `glance` is null or `glance.comparisons` is empty, the On-time and ridership cards show no "usual" line. On-time still shows the early and late line.
- Remove the `${num(sys.totalAlightings)} alightings` subtitle.
- Remove the old dwell text `Weekday median:<br>… min / 100 trips` and `Today: … hrs total` (`buildDwellKpiCard`, lines 572 to 576).
- Trips card colour: use `glance.status` when `glance` exists, otherwise `deriveReportStatus(latestDay).label`. This removes the case where the card and the badge disagree.
- `KPI_CARD_HEIGHT_PX` can go down (about 170) if all four cards still fit two grey lines. All four cards must keep the same height.

**Remove** the `otpBar` function and its call (lines 997 to 1020, 1714).

### Phase 3: What Stood Out, Action Focus, Route Scorecard

**`buildGlanceSummary`** (line 477)

- Section header becomes `What Stood Out`.
- Remove the badge and headline (now in the strip), the comparisons table, and the small uppercase "What stood out" label.
- Keep the standout rows and the "Ongoing" box unchanged.
- When there are no standouts, show one grey line: `No route ran well below its usual.`
- `buildGlanceActions`: no change.
- The fallback `buildExecutiveSummary` keeps the header `Yesterday at a Glance`.

**`buildRouteScorecard`** (line 1291)

- New signature: `buildRouteScorecard(routes, dwellByRoute, glance: GlanceModel | null)`.
- Columns, in order: Route, Name, BPH, Riders, On-time, Flags. Remove the `Dwell (hrs)` and `APC` columns.
- Sort: BPH, highest first (no change). Keep `bphPill()` and `routeOtpCell()` as they are.
- Flags cell (left aligned, small pills, empty when there is nothing):
  - Standout: when `glance.standouts` has the route, show `▼ {(usualOtp - otp).toFixed(1)} pts below usual` (background `#fee2e2`, text `#991b1b`) and give the row background `#fef2f2`.
  - APC: when `apcStatusForRoute(route) !== 'ok'`. Text `APC new` (background `#dbeafe`, text `#1d4ed8`) when any `glance.ongoing[].newRoutes` includes the route. Text `APC ongoing` (background `#f1f5f9`, text `#64748b`) otherwise. Text `APC check` when `glance` is null.
  - Dwell: when the route's value in `dwellByRoute` is 1800 seconds or more, show `Dwell {formatDwellHours(seconds)} hrs` (background `#fffbeb`, text `#b45309`).
- Subtitle: `Ranked by boardings per service hour (BPH), highest first`.
- Replace the long footnote with: `A flag shows only when a route needs a look: on-time well below its usual, APC counts that do not agree, or 0.5 hours or more of operator dwell.`
- Remove helpers that become unused (`apcPill`, `apcStatusCellStyle`, `apcStatusBg`, `apcStatusColor`, `apcStatusLabel`) only if nothing else uses them. Check with a search first.

### Phase 4: Last 7 Days graph

Replace `buildTrendTable` and `buildTrendRows` with `buildTrendCharts(trendDays: DailySummary[], latestDate: string): string`.

- Data: sort `trendDays` by date, take the last 7 days up to and including `latestDate`. Return `''` when there are fewer than 2 days.
- One card (`cardWrap`) that holds one outer table with three cells of equal width. Each cell is one small bar chart:

| Chart | Value per day | Scale | Latest bar | Earlier bars | Label on bar |
|---|---|---|---|---|---|
| On-time (scale 70–100%) | `day.system.otp.onTimePercent` | 70 to 100, fixed | `otpColor(value)` | `#86efac` at 85 or more, `#fcd34d` at 75 or more, `#fca5a5` below | `88.5` |
| Riders | `day.system.totalRidership` | 0 to the highest value | `#2563eb` | `#bfdbfe` | `9.3k` (plain number below 1,000) |
| Operator dwell (min / 100 trips) | `dwellMinutesPer100Trips(day)` | 0 to the highest value | `#0891b2` | `#a5f3fc` | `76` |

- Chart details: plot height 74px. Each day is one table column with `valign="bottom"`. Above the bar put the value label (10px, `#64748b`; latest day `#0f172a`, weight 800). Minimum bar height 2px. The row has a bottom border `1px solid #9ca3af`. Under it, a second table row has the short weekday name (`Wed`, 10px, `#6b7280`; latest day dark and bold).
- A day with `system.tripCount` of 0 or no `byOperatorDwell` has no dwell bar; show `—` as its label.
- On-time values below 70 get the minimum bar height.
- Section header: `Last ${n} Days`. No footnote.
- The 7-day rolling dwell average is removed.

### Phase 5: Removals, missed trips, stops, footer

**Remove from the email and delete the code:**

- `buildHourlyTable`, `buildHourlyDwellMap`, `parseServiceHour` (in `reportHtml.ts` only; `dailyReport.ts` has its own copy, leave it).
- `buildStopDwellTable`.
- Remove unused imports and variables after this (`HourMetrics`, `totalServiceHours` if nothing uses it, `dwellByHour`). `totalServiceHours` is still used by the trips card fallback subtitle; check before you delete it.

**`buildMissedTripsTable`** (line 1022)

- The caller already renders it only when `totalMissed > 0`. Delete the `totalMissed === 0` branch.
- Delete the four summary tiles (`missedTripSummary`).
- Delete the 7-day late-departure aggregation and table (`lateTrendMap`, `lateTrendRows`, the "Late Departures" block and its "shown after at least 3 days" note). Remove the `trendDays` parameter.
- With trip rows: one table of yesterday's trips, sorted with the existing `sortTrips`. Columns: Route, Sched. Departure, Reason. Reason is `Late {lateByMinutes} min` (or `Late 15+ min` when `lateByMinutes` is missing) for `late_over_15`, and `No data recorded` for `not_performed`.
- Without trip rows: keep the existing route-level fallback table.
- Keep the section header and its subtitle (`N of M scheduled trips missed (x.x%)`).

**`buildTopStops`** (line 1335)

- Header: `Top 10 Stops by Ridership`. Subtitle: `Boardings plus alightings; terminal platforms count as one stop`.
- Keep the busiest-stops table, its ranking and the hub merge. Remove the small "Busiest Stops" label.
- Delete the "Lowest OTP Stops" table.

**Footer**

Replace the single line with three lines (11px, `#64748b`):

1. `Boardings by hour, stop detail and operator dwell by stop are on the dashboard.` The word "dashboard" links to `https://transitscheduler.ca/#operations/performance`. Do not invent deeper links.
2. `On-time: between 3 min early and 5 min late. Usual: median of recent days of the same day type. BPH: boardings per service hour. APC: automatic passenger counter; a flag means boardings and alightings do not agree. Dwell: moderate and high operator dwell only.`
3. The existing `This is an automated report. Generated by Scheduler 4 · {date}` line.

**Reorder** the sections in `buildReportHtml` to match section 5.

## 7. Tests to update

Change tests to match the new design. Do not weaken a test that still describes wanted behaviour.

`tests/reportHtml.dailyEmail.test.ts`:

| Test (line) | Action |
|---|---|
| Scorecard OTP tests (199, 233) | Change the end marker of `between(html, 'Route Scorecard', 'Boardings by Hour')` to the next section that exists in the fixture (for example `Top 10 Stops by Ridership`). |
| "adds moderate/high dwell hours to the route scorecard and boardings-by-hour table" (310) | Rewrite: a route with 0.5 hours or more of dwell gets the `Dwell x.x hrs` flag; a route below that gets none. |
| "adds a standalone operator dwell by stop table" (354), "merges platform stop IDs … in operator dwell by stop" (455) | Delete. |
| "falls back to route name, trip name, or block when dwell incident route IDs are blank" (480) | Keep the intent. Assert on the scorecard dwell flag. |
| "ranks busiest stops" (393), "merges hub stop routes" (413) | Update the `between` markers (`Busiest Stops`, `Lowest OTP Stops`) to the new header and the next section. |
| "uses trimmed report snapshot totals for historical weekday dwell averages" (502) | Update the expected text to the new `usual N` line. |
| "does not render total dwell rows in route or hour tables" (533) | Reduce to the scorecard only. |
| "shows daily dwell hours and trailing 7-day average dwell in the trend table" (568) | Rewrite for the graph: three chart titles are present, the latest day's label is present, and the rolling-average text is absent. |
| "skips malformed hourly dwell times" (610) | Delete. |
| "does not render the review status banner above the KPI cards" (667) | Replace with two checks: with `routeHistory` the strip shows the status and headline before the KPI cards; without `routeHistory` there is no strip. |
| Icon test (689) | Must pass unchanged. |
| Dwell KPI median tests (783, 803) | Update to `usual 150` text and to its absence. |
| "KPI card sizing" (817) | Must still find 4 cards of equal height. |
| Glance section test (827) | Use `What Stood Out` for the glance path. The fallback path still uses `Yesterday at a Glance`. |

Add tests for: the compact header (no `Service Data` text, day type present), the On-time and ridership "usual" lines, each of the three flags, the missed-trips table with a Reason column, and no `OTP Distribution`, `Boardings by Hour`, `Operator Dwell by Stop` or `Lowest OTP Stops` text in the output.

Other files:

- `tests/featuredTrip.test.ts:148`: the test name says "above operator dwell". Update the order check: Trip of the Day comes after `Top 10 Stops by Ridership` and before the footer.
- `tests/performanceInBetweenRidership.test.ts:171`: `'204 alightings'` no longer appears in a KPI card. Assert on a value that still shows the same data (for example the alightings cell in the top stops table, or total ridership).

## 8. Verification

During the work:

```bash
npx vitest run tests/reportHtml.dailyEmail.test.ts tests/dailyGlance.test.ts tests/featuredTrip.test.ts tests/performanceInBetweenRidership.test.ts
```

Once, after the last edit:

```bash
npm run typecheck
npm --prefix functions run build
```

Do not run the full test suite. If `npm --prefix functions run build` writes compiled files into `functions/lib`, do not add unrelated changes.

Visual check: write a short throwaway script (not committed) or a test that calls `buildReportHtml` with fixture data and saves the HTML, then open it in a browser. Icons are `cid:` attachments, so they show as broken images in a browser; that is expected. Compare each section with the mockup.

## 9. Out of scope and open items

Report these to the user. Do not act on them.

- **Sender address.** `extensions/firestore-send-email.env:4` has `DEFAULT_FROM=onboarding@resend.dev`, which causes the "outside your organization" banner. The fix needs a verified domain in Resend and a redeploy of the extension. This is a user action.
- **BPH colours.** `bphColor` (`reportHtml.ts:259`) shows red above 30 and below 10. The user has not decided if high BPH should be red. Leave it.
- **Deploy.** Do not deploy the functions and do not commit unless the user asks.
- **Docs.** `docs/ARCHITECTURE.md` and `docs/SCHEMA.md` do not describe the email sections, so no durable doc needs an update.

## 10. Done means

- The email output matches the mockup section by section, with the rules in section 3.
- The four focused test files pass, and typecheck and the functions build pass.
- The final report lists what changed, the test results, and the open items in section 9.
