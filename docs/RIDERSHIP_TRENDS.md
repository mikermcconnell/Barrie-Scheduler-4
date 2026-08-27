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

The workspace uses the Friendly Design Theme: a soft-gray workspace, strong title row, rounded white cards with crisp borders, a dominant annual-ridership graph, four compact tinted status blocks, a year-end outlook, an annual-change graph, and the month-by-year table.

- Annual totals use exact monthly/daily values. Abbreviated axes must retain exact tooltips and labels.
- Annual change is `(current - previous) / previous` and is shown only when both ended years have adequate source coverage.
- The active calendar year stays out of the annual charts and is shown as YTD.
- The active partial month is shown in a dedicated `Month ridership so far` section with Scheduled Routes, On Demand, and All Transit Ridership cards. Each source retains its own report-day and freshness disclosure.
- The YTD comparison uses completed months only; the active partial month is disclosed separately through its latest service date.
- The base year-end forecast divides active-year completed-month boardings by the prior year's matching completed months, then applies that factor to the prior year's remaining monthly pattern.
- Within the active month, received STREETS dates remain actual. Each unreported calendar date, including a known missing report, retains an equal share of the seasonally adjusted prior-year monthly estimate until actual evidence replaces it.
- Forecast values use a dashed projected series and remain separate from actual boardings. The low/high range applies the median absolute full-year error from all eligible historical backtests using the same completed-month cutoff.
- The forecast is a derived planning scenario, not an approved target, budget forecast, causal explanation, or service-change justification. It is withheld when matching completed-month evidence or the prior-year remaining pattern is incomplete.
- Live-derived ended years with missing reports remain visibly incomplete and do not receive an annual-change value.
- Every graph states its unit, supported use, limitations, and the next evidence a planner should check.

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
