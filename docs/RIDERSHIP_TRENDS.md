# Ridership Trends

Durable product and data contract for the Planning Data Ridership Trends workspace.

## Purpose

Ridership Trends replaces the `Ridership Trend` worksheet in `Transit Annual Ridership.xlsx` with a shared, automatically updated planning view. It shows current scheduled-route and On Demand subtotals plus their combined reported ridership, while retaining a comparable long-range scheduled-route series without turning the Operations dashboard into a permanent historical warehouse.

The workspace supports historical direction and year-over-year comparison. It does not identify unique riders, establish causation, or justify a service change without operational context. On Demand is included only where daily completed-trip reports exist; it is not added to historical or forecast scheduled-route totals.

## Metric and source boundary

- Scheduled-route ridership is boarding activity: the sum of STREETS `Boardings`, exposed in daily performance summaries as `system.totalRidership`.
- On Demand ridership is completed trips from daily On Demand KPI reports. Each completed pickup counts once. Drop-offs are not added because they represent the other end of the same trip.
- Current-month All Transit Ridership is scheduled-route boardings plus completed On Demand trips for the reported dates in each source. It is provisional when either source has incomplete daily coverage.
- Workbook monthly totals are authoritative through July 2026.
- Daily STREETS summaries are authoritative from August 1, 2026 onward.
- Alightings, On Demand drop-offs, and route-level breakdowns are excluded. The year-end forecast is derived from fixed-route boarding totals only and is never stored as observed evidence. A combined forecast is withheld until comparable On Demand history is available.
- A missing daily report is missing evidence, not zero ridership.

The checked-in generated baseline records the source workbook name, worksheet, final baseline month, and SHA-256 hash. Derived totals and percentages are calculated by application code rather than copied from workbook formula cells.

## Presentation contract

The workspace uses the Friendly Design Theme: a soft-gray workspace, strong title row, a dominant current-year scheduled-route overview, a compact current-month service breakdown, secondary historical charts, and the month-by-year table. The current-year overview keeps the reported total, source coverage, comparable change, monthly actuals, and any derived outlook together so planners see the active year before historical context.

- Annual totals use exact monthly/daily values. Abbreviated axes must retain exact tooltips and labels.
- Annual change is `(current - previous) / previous` and is shown only when both ended years have adequate source coverage. When the active-year base forecast is available, its projected change against the prior completed year is appended in violet and labelled as projected.
- The active calendar year is the primary view and its observed partial total stays out of the completed-year historical charts. When a base forecast is available, the annual-ridership chart appends that projected total as a violet dashed segment and projected point; missing reports are not presented as zero activity.
- The active partial month is shown in a dedicated `Month ridership so far` section with Scheduled Routes, On Demand, and All Transit Ridership cards when either source has reported activity. Before either source reports, this becomes a compact reporting-not-started status row rather than three empty metric cards. Each source retains its own report-day and freshness disclosure.
- The active-year comparison uses the latest contiguous months for which both the active and prior year have complete coverage. The active partial month is disclosed separately through its latest service date.
- The active-year monthly chart shows actual monthly boardings first and adds the dashed projected series only when a forecast is available. The dashed path begins at the final actual point so the transition to forecast months is continuous without relabelling that actual value as a projection. The monthly-history table uses the same forecast for active-year months with an estimated remainder, rendering those values and the projected year-end total in violet with explicit projected labels. Completed months remain actuals. Historical annual ridership, annual change, and monthly history follow as secondary context.
- The base year-end forecast divides active-year completed-month boardings by the prior year's matching completed months, then applies that factor to the prior year's remaining monthly pattern.
- Within the active month, received STREETS dates remain actual. Each unreported calendar date, including a known missing report, retains an equal share of the seasonally adjusted prior-year monthly estimate until actual evidence replaces it.
- Forecast values use a dashed projected series and remain separate from actual boardings. The low/high range applies the median absolute full-year error from all eligible historical backtests using the same completed-month cutoff.
- The forecast is a derived planning scenario, not an approved target, budget forecast, causal explanation, or service-change justification. It is withheld when matching completed-month evidence or the prior-year remaining pattern is incomplete.
- Live-derived ended years with missing reports remain visibly incomplete and do not receive an annual-change value.
- Every graph states its unit, supported use, limitations, and the next evidence a planner should check.

## Monthly email contract

The automated monthly email replaces the manually assembled monthly ridership PDF for the metrics supported by Scheduler 4. It uses a Barrie-blue, email-safe layout and does not generate or attach a PDF. Template version 2 (October 2026) follows the approved executive mockup.

Two templates are deployed. Template 1 is the original scheduled-bus and On Demand email (`utils/ridership-trends/monthlyReportV1.ts`, `functions/src/monthlyRidershipReportHtmlV1.ts`). Template 2 is the three-service executive email described below. The scheduled send reads `templateVersion` (1 or 2) from `teams/{teamId}/monthlyRidershipReportConfig/active` each run and uses template 1 when the document or field is missing. Switching templates needs no redeploy. The test endpoint accepts `?template=1|2` and otherwise uses the configured template. Remove template 1 once template 2 is the confirmed default.

- The primary audience is executive management. Every heading uses title case, labels use plain language, and the layout is built to be read at a glance.
- `sendMonthlyRidershipReport` runs at 10:00 Toronto time on the first calendar day and reports the previous month to the existing `REPORT_RECIPIENTS` list.
- Three services are reported: Conventional (scheduled-route STREETS boardings), Transit ON Demand (completed trips), and Specialized (the `reportedTrips` total from the uploaded monthly Specialized Transit report).
- Sections, in order: header; hero box (total riders, year to date, riders per service hour, and a generated one-line summary); Ridership by Service cards (riders, change badge, 13-month sparkline, YTD change); Change From Last Year bar chart; 13-Month Trend (Conventional, with the same months one year earlier dashed); Service Efficiency (riders per service hour and average weekday riders, each with this-year and last-year bars); Detailed Numbers table with subtotals and the All Services grand total; source footer.
- Charts are PNG images attached inline by `cid`. Sparklines are attached only for services with at least two complete months in the last 13.
- A month-over-year change is shown only when both months are complete. Daily sources need every day reported. When a stored prior-year Specialized month is missing, the change uses the percentage printed on the source report and the card says so.
- The All Services change covers only the services that have a change, and the email names them (for example, `Change covers Conventional only`). All Services year to date covers only services with complete year-to-date evidence in both years.
- Missing evidence is shown as `Not yet reported`, `No comparison yet`, `Not yet available`, or `Official service hours not yet entered`. It is never shown as zero.
- Riders per service hour uses official monthly service hours entered by staff in `teams/{teamId}/monthlyServiceHours/{YYYY-MM}` (numeric `conventional`, `onDemand`, `specialized` fields). STREETS in-service trip time is not used. The All Services rate is shown only when every reported service has hours.
- Average weekday riders come from daily evidence. Specialized has no weekday figure because its source is monthly. Conventional weekday comparisons need the prior-year month in retained daily STREETS detail.
- End-of-Year Pace, Saturday and Sunday averages, and the five-year year-to-date chart were removed in template version 2.
- Missing reports remain missing evidence. The fixed-date email still sends with partial totals and an amber `Some Days Are Missing` warning; it is not automatically resent when late files arrive.
- Production queueing writes `teams/{teamId}/monthlyRidershipReports/{YYYY-MM}` and its deterministic `mail` document in one transaction so scheduler retries cannot duplicate the month. The API-key-protected test endpoint sends only to its explicit `to` address and does not write the production audit.

## Persistence and update contract

The detailed performance archive retains roughly one year of daily evidence. Ridership Trends therefore uses a compact versioned projection under `teams/{teamId}/performanceViews/ridership-trends/`, referenced by `teams/{teamId}/performanceData/metadata.ridershipTrendStoragePath`.

Every automatic or manual performance save must:

1. Read and validate the previous projection when a pointer exists.
2. Preserve all prior post-cutover daily totals, including dates no longer present in detailed retention.
3. Replace matching service dates idempotently from the new performance summary.
4. Upload the replacement projection before switching the metadata pointer.
5. Commit performance and trend pointers together.
6. Delete the prior projection only after the pointer commit succeeds.

If a referenced projection cannot be read, the save fails before pointer replacement. Retrying the same daily file must replace that date rather than add a second copy.

## Access and shared sources

`analyticsRidershipTrend` is a Planning Data permission enabled by default for Planner, Admin, and Internal access levels. It is independently overrideable.

The read-only view embedded in the 2027–2032 Strategic Plan may instead be read with `analyticsStrategicPlan`. That contextual read goes through `sharedWorkspaceData`; it does not expose the standalone Ridership Trends route or grant write access.

Same-team users read only the compact projection. Partner teams may use their configured performance source through the authenticated `sharedWorkspaceData` endpoint. Ridership Trends access does not grant access to the complete Operations payload. Projection writes remain restricted to team managers, authorized support, and server-side ingestion.

For On Demand, the workspace derives a narrow, non-persisted projection from `teams/{teamId}/todPickupData/metadata` and its referenced summary. The projection contains only service-date completed-trip totals and freshness metadata; it excludes pickup/drop-off locations and raw rider data. Standalone and Strategic Plan reads use the same Ridership Trends or Strategic Plan permission boundaries as the fixed-route projection.

## Operational verification

Regenerate or verify the workbook baseline from the repository root:

```powershell
node scripts/generateRidershipTrendBaseline.mjs --source "D:\Transit Annual Ridership.xlsx" --check
```

Bootstrap an existing team's retained performance history from `functions/`. The command is a dry run unless `--apply` is supplied:

```powershell
npm.cmd run bootstrap:ridership-trends -- --team TEAM_ID
npm.cmd run bootstrap:ridership-trends -- --team TEAM_ID --apply
```

Before production use:

1. Reconcile the generated baseline against 2024 `4,076,773`, 2025 `3,362,338`, and January-July 2026 `1,632,133`.
2. Dry-run the team bootstrap and review the cutover, live dates, missing dates, and resulting YTD total.
3. Apply the bootstrap with an update-time precondition.
4. Replay one already-present daily file and verify the date is replaced exactly once.
5. Open the Planning Data workspace and confirm its latest service date and total match the stored projection.
6. Render complete and partial monthly email fixtures at desktop and mobile widths, including the chart-image fallback.
7. Send a protected test email to a controlled inbox and confirm the Firestore email extension records accepted delivery.
8. Reconcile the first automated month against the approved manual report before enabling the scheduled send.
