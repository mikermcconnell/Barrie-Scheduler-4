# Ridership Trends

Durable product and data contract for the Planning Data Ridership Trends workspace.

## Purpose

Ridership Trends replaces the `Ridership Trend` worksheet in `Transit Annual Ridership.xlsx` with a shared, automatically updated planning view. It shows long-range fixed-route boarding activity without turning the Operations dashboard into a permanent historical warehouse.

The workspace supports historical direction and year-over-year comparison. It does not identify unique riders, establish causation, include Transit On Demand activity, or justify a service change without operational context.

## Metric and source boundary

- The metric is fixed-route boarding activity: the sum of STREETS `Boardings`, exposed in daily performance summaries as `system.totalRidership`.
- Workbook monthly totals are authoritative through July 2026.
- Daily STREETS summaries are authoritative from August 1, 2026 onward.
- Alightings, Transit On Demand pickups/drop-offs, forecasts, and route-level breakdowns are excluded.
- A missing daily report is missing evidence, not zero ridership.

The checked-in generated baseline records the source workbook name, worksheet, final baseline month, and SHA-256 hash. Derived totals and percentages are calculated by application code rather than copied from workbook formula cells.

## Presentation contract

The workspace uses the Friendly Design Theme: a soft-gray workspace, strong title row, rounded white cards with crisp borders, a dominant annual-ridership graph, three compact tinted status blocks, an annual-change graph, and the month-by-year table.

- Annual totals use exact monthly/daily values. Abbreviated axes must retain exact tooltips and labels.
- Annual change is `(current - previous) / previous` and is shown only when both ended years have adequate source coverage.
- The active calendar year stays out of the annual charts and is shown as YTD.
- The YTD comparison uses completed months only; the active partial month is disclosed separately through its latest service date.
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

Same-team users read only the compact projection. Partner teams may use their configured performance source through the authenticated `sharedWorkspaceData` endpoint. Ridership Trends access does not grant access to the complete Operations payload. Projection writes remain restricted to team managers, authorized support, and server-side ingestion.

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
