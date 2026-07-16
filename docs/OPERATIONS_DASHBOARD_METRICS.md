# Operations Dashboard Metric Register

> Last reviewed: July 13, 2026  
> Scope: STREETS AVL/APC Operations Dashboard  
> Purpose: durable definitions and validation status for operational metrics

The current aggregation contract is performance schema version 13. Version 10 corrected OTP, route-hour, stop-breakdown, and in-between-row handling. Version 11 added reliable stop-level load observation counts. Version 12 added deterministic dwell-incident IDs, incident operating context, and route/operator eligible-timepoint exposure so Dwell Incident Review rates remain scope-correct. Version 13 adds occurrence-aware stop identity so repeated loop visits remain separate while shifted route positions still align. Older stored days remain visible with unavailable fields labelled honestly until rebuilt or re-imported.

Use this document when changing dashboard calculations, filters, labels, imports, or reports. A passing test confirms implementation behavior; operational sign-off confirms that the behavior is the intended Barrie Transit definition.

## Data flow

`STREETS import -> parser -> daily aggregation -> stored overview/monthly summaries + compact Load Profiles views -> authorized route/date/day filters -> dashboard modules`

Primary calculation locations:

- daily aggregation: `utils/performanceDataAggregator.ts` and `functions/src/aggregator.ts`
- dashboard rollups: `components/Performance/SystemOverviewModule.tsx` and the related performance modules
- route scoping: `utils/performanceRouteFilter.ts`
- stored overview shape: `utils/performanceOverviewSummary.ts`
- loading and date-range trimming: `utils/performanceDataService.ts`
- compact Load Profiles projection: `utils/performanceLoadProfileView.ts` and `functions/src/performanceLoadProfileView.ts`

The Load Profiles tab must render every valid selected range, including a single day. Fewer than five route-direction service days is a non-blocking comparison-quality note, not an empty-state rule. Multi-day average load uses `loadObservationCount` weighting when every included value has reliable counts; mixed legacy history falls back to a daily-average estimate, and ambiguous legacy zeroes are omitted. Peak-trip rankings use every compact positive-load candidate in the selected range; missing or unreliable load is never converted to an observed zero.

## Metric contracts

| Metric | Current calculation | Required interpretation | Review status |
|---|---|---|---|
| On-time performance | Eligible timepoint departures classified as early, on-time, or late; period rollups combine raw observation counts | Early is more than 3 minutes early. Late is more than 5 minutes late. Boundary values are on-time. Final trip stops, in-between rows, trippers, missing observed departures, and duplicate trip/stop observations are excluded. | Code-validated with synthetic cases; reconcile against a real STREETS period before operational sign-off |
| Early / on-time / late percentages | Bucket count divided by total eligible OTP observations | Multi-day, route, stop, and hour values must be weighted by observations, never by averaging stored percentages | Code-validated |
| Boardings / total ridership | Sum of STREETS `Boardings` | This is boarding activity, not unique riders | Code-validated; APC coverage still affects confidence |
| Alightings | Sum of STREETS `Alightings` | Presented separately from boardings; it is not subtracted from ridership | Code-validated; APC coverage still affects confidence |
| Stop activity change | Current average activity per included service day minus the equivalent prior-period average. The map supports boardings, alightings, and combined activity. Past-week, past-month, and past-three-month views compare with the immediately preceding equal-length calendar window; single-day views compare with the same weekday one week earlier. | Circle size reflects absolute activity change per day, while colour shows increase, decrease, or little change. Percentage change is supporting context only because low-volume stops can produce unstable percentages. Route, day-type, and time-of-day filters must apply consistently to both periods. Shared stops use route-level breakdowns when a route is selected; all-route activity must not be substituted. Stops without comparable hourly data in both periods are omitted and disclosed rather than mixing hourly and all-day totals. | Code-validated with synthetic period-selection, route-scope, and hourly-availability cases; operational interpretation remains advisory |
| Average riders per day | Total boardings divided by distinct included service dates | A/B branches combined into one route must still count each date once | Code-validated |
| Trips observed | Distinct STREETS `TripID` values | Indicates trips represented in AVL/APC data, not necessarily scheduled trips operated | Code-validated |
| Trips operated | GTFS scheduled trips matched to STREETS observations | Display as suspected missed-trip analysis, not a final cancellation determination | Needs route-level scheduled/matched counts before route-scoped display can be fully validated |
| Service hours | Sum of the scheduled operating span calculated for each observed trip | Used as the BPH denominator. The precise start/end fields require operational confirmation | Definition sign-off required |
| Boards per service hour (BPH) | Boardings divided by service hours | Route BPH is a direct period ratio. The by-hour chart is only an explicitly labelled estimate because hourly service-hour denominators are not stored | Route calculation code-validated; business thresholds require sign-off |
| Average load | Mean of APC-reliable departure-load observations, grouped by route-stop occurrence and weighted across days by reliable stop-level observation count; APC-backed zero is valid | A route-stop occurrence is the physical stop ID plus its zero-based visit number within the trip, so a loop may contain the same stop more than once. Records without a reliable APC source are excluded. Version 10 history falls back to a disclosed average of daily averages; ambiguous legacy zeroes are omitted because v10 cannot distinguish missing APC from a genuine zero. Values above the configured load cap are capped and disclosed in data quality | Code-validated; legacy history remains explicitly estimated |
| Passenger flow by stop | Boarding and alighting totals from occurrence-aware route-direction heatmap cells plus average onboard load from the matching occurrence-aware load profile. When a same-route block chain has no usable load-profile stops in any direction it touches that day, the dashboard may infer load by carrying `boardings - alightings` through its chronologically consecutive trips. | A single date shows exact stop-occurrence boarding/alighting totals. Multi-day filters show boarding/alighting averages per observed route-direction service day. Any usable daily observed/legacy load profile on a direction touched by a same-route block chain suppresses inference for that whole chain; daily averaged load profiles are not treated as trip-specific block anchors. Route-local inference preserves every stop delta and carries the ending load into later trips. It uses a zero anchor when feasible; otherwise it uses the smallest starting load that keeps the full block non-negative and discloses the result as a lower-bound estimate. Repeated loop visits remain separate, and a whole chain is rejected when its inferred range exceeds the configured plausible-load cap. | Code-validated for observed loads; block inference must remain visibly labelled as an estimate and disclose adjusted anchors and invalid chains |
| Peak load | Maximum APC-reliable departure load | Missing/unreliable load is not a zero-load observation | Code-validated |
| Wheelchair trips | Distinct trips containing a positive wheelchair-use count | Counts trips with activity, not individual boardings unless the source definition changes | Code-validated |
| Dwell incidents | Timepoint events departing more than 3 minutes late, with effective dwell classified as minor (up to 2 minutes), moderate (over 2 through 5 minutes), or high (over 5 minutes) | Moderate and high events are reportable. Minor tracked events are excluded from reportable counts, averages, queues, patterns, and exports. These are investigation signals, not proof of operator fault. | Code-validated; thresholds still require operational sign-off |
| Dwell incidents per 1,000 eligible timepoint visits | Reportable incidents divided by normal, non-tripper, non-detour timepoint observations with valid observed arrival and departure, multiplied by 1,000 | Numerator and denominator must share date, route, and operator scope. Version 12 stores route/operator exposure rows so route filters remain valid. | Code-validated |
| Dwell-associated downstream delay | Observed departure delay remaining after subtracting positive lateness already present when the vehicle arrived at the dwell stop | Show same-trip impact first, then later block carryover. Distinguish any carried delay, OTP-late departures over 5 minutes, return under 5 minutes, and full recovery to zero. Do not claim sole causation. | Code-validated; operational interpretation remains advisory |
| Data quality | Raw record and missing/capped/excluded field counts for the loaded import scope | Route-specific pages must not imply that system-wide quality counts are route-specific | Route-level quality fields are not currently available |
| Action Queue priority | Heuristic combining severity, persistence, and relative rider impact | Decision-support ranking only; it is not an audited operating metric | Definition sign-off required |

## Required reconciliation checks

Before treating a dashboard release as operationally validated:

1. Select a known STREETS period and independently calculate OTP, boardings, alightings, trips, loads, and service hours.
2. Reconcile system totals, each route, one merged A/B route, one stop shared by multiple routes, and at least two hourly buckets.
3. Include missing AVL, missing APC, duplicate terminal observations, a loop that visits the same stop twice, a shifted stop pattern, in-between rows, trippers, and a post-midnight trip.
4. Confirm that date, day-type, and route filters change both numerators and denominators consistently.
5. Record expected value, dashboard value, difference, explanation, and reviewer sign-off.

## Open definition decisions

- Confirm whether service hours begin at the first scheduled departure or another STREETS field.
- Confirm BPH review thresholds and the minimum acceptable APC coverage.
- Decide whether absent hourly data means zero service or missing evidence.
- Rebuild version 10 history when exact multi-day load weighting is required instead of the disclosed estimate. Rebuild pre-v13 loop history when separate repeated-stop occurrences are required.
- Block-inferred load is a planning estimate, not a replacement for APC evidence. Confirm whether operations can provide a verified pull-out/pull-in load anchor instead of the zero/minimum-feasible anchors derived from stored passenger movements.
- Ridership heatmaps currently identify trip columns by terminal departure time. If two same-route/direction trips share that time, older summaries may already have combined them; add stable trip identity to a future performance schema before relying on inference for that edge case.
- Add route-level scheduled/matched trip counts and data-quality counts before presenting those values as route-specific. Dwell exposure denominators are route-scoped in schema v12.
- Confirm the legacy dwell late gate and moderate/high thresholds as the permanent Barrie Transit operating definition.
- Confirm whether Route 12A/12B should be combined everywhere that Routes 2A/2B and 7A/7B are combined.
