# Operations Dashboard Metric Register

> Last reviewed: July 13, 2026  
> Scope: STREETS AVL/APC Operations Dashboard  
> Purpose: durable definitions and validation status for operational metrics

The corrected aggregation contract is performance schema version 10. Older stored days remain visible for continuity but require rebuild or re-import before they receive the corrected OTP, route-hour, stop-breakdown, and in-between-row handling.

Use this document when changing dashboard calculations, filters, labels, imports, or reports. A passing test confirms implementation behavior; operational sign-off confirms that the behavior is the intended Barrie Transit definition.

## Data flow

`STREETS import -> parser -> daily aggregation -> stored overview/monthly summaries -> route/date/day filters -> dashboard modules`

Primary calculation locations:

- daily aggregation: `utils/performanceDataAggregator.ts` and `functions/src/aggregator.ts`
- dashboard rollups: `components/Performance/SystemOverviewModule.tsx` and the related performance modules
- route scoping: `utils/performanceRouteFilter.ts`
- stored overview shape: `utils/performanceOverviewSummary.ts`
- loading and date-range trimming: `utils/performanceDataService.ts`

## Metric contracts

| Metric | Current calculation | Required interpretation | Review status |
|---|---|---|---|
| On-time performance | Eligible timepoint departures classified as early, on-time, or late; period rollups combine raw observation counts | Early is more than 3 minutes early. Late is more than 5 minutes late. Boundary values are on-time. Final trip stops, in-between rows, trippers, missing observed departures, and duplicate trip/stop observations are excluded. | Code-validated with synthetic cases; reconcile against a real STREETS period before operational sign-off |
| Early / on-time / late percentages | Bucket count divided by total eligible OTP observations | Multi-day, route, stop, and hour values must be weighted by observations, never by averaging stored percentages | Code-validated |
| Boardings / total ridership | Sum of STREETS `Boardings` | This is boarding activity, not unique riders | Code-validated; APC coverage still affects confidence |
| Alightings | Sum of STREETS `Alightings` | Presented separately from boardings; it is not subtracted from ridership | Code-validated; APC coverage still affects confidence |
| Average riders per day | Total boardings divided by distinct included service dates | A/B branches combined into one route must still count each date once | Code-validated |
| Trips observed | Distinct STREETS `TripID` values | Indicates trips represented in AVL/APC data, not necessarily scheduled trips operated | Code-validated |
| Trips operated | GTFS scheduled trips matched to STREETS observations | Display as suspected missed-trip analysis, not a final cancellation determination | Needs route-level scheduled/matched counts before route-scoped display can be fully validated |
| Service hours | Sum of the scheduled operating span calculated for each observed trip | Used as the BPH denominator. The precise start/end fields require operational confirmation | Definition sign-off required |
| Boards per service hour (BPH) | Boardings divided by service hours | Route BPH is a direct period ratio. The by-hour chart is only an explicitly labelled estimate because hourly service-hour denominators are not stored | Route calculation code-validated; business thresholds require sign-off |
| Average load | Mean of APC-reliable departure-load observations; APC-backed zero is valid | Records without a reliable APC source are excluded. Values above the configured load cap are capped and disclosed in data quality | Code-validated at daily level; multi-day weighting needs better stored sample counts |
| Peak load | Maximum APC-reliable departure load | Missing/unreliable load is not a zero-load observation | Code-validated |
| Wheelchair trips | Distinct trips containing a positive wheelchair-use count | Counts trips with activity, not individual boardings unless the source definition changes | Code-validated |
| Dwell incidents | Dwell events passing the lateness gate and severity classification | Moderate and high events are reportable incidents. Minor tracked events must not be mixed into a reportable-incident average without explicit labelling | Definition/display alignment still required |
| Incidents per 100 service hours | Reportable incidents divided by the matching service-hour denominator, multiplied by 100 | Numerator and denominator must have identical route, operator, and date scope | System scope code-validated; route-level denominators are not currently available |
| Data quality | Raw record and missing/capped/excluded field counts for the loaded import scope | Route-specific pages must not imply that system-wide quality counts are route-specific | Route-level quality fields are not currently available |
| Action Queue priority | Heuristic combining severity, persistence, and relative rider impact | Decision-support ranking only; it is not an audited operating metric | Definition sign-off required |

## Required reconciliation checks

Before treating a dashboard release as operationally validated:

1. Select a known STREETS period and independently calculate OTP, boardings, alightings, trips, loads, and service hours.
2. Reconcile system totals, each route, one merged A/B route, one stop shared by multiple routes, and at least two hourly buckets.
3. Include missing AVL, missing APC, duplicate terminal observations, in-between rows, trippers, and a post-midnight trip.
4. Confirm that date, day-type, and route filters change both numerators and denominators consistently.
5. Record expected value, dashboard value, difference, explanation, and reviewer sign-off.

## Open definition decisions

- Confirm whether service hours begin at the first scheduled departure or another STREETS field.
- Confirm BPH review thresholds and the minimum acceptable APC coverage.
- Decide whether absent hourly data means zero service or missing evidence.
- Add reliable-load observation counts so multi-day load averages can be weighted exactly.
- Add route-level scheduled/matched trip counts, dwell denominators, and data-quality counts before presenting those values as route-specific.
- Confirm whether Route 12A/12B should be combined everywhere that Routes 2A/2B and 7A/7B are combined.
