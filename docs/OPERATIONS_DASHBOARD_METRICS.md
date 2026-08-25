# Operations Dashboard Metric Register

> Last reviewed: July 29, 2026
> Scope: STREETS AVL/APC Operations Dashboard  
> Purpose: durable definitions and validation status for operational metrics

The current aggregation contract is performance schema version 14. Version 10 corrected OTP, route-hour, stop-breakdown, and in-between-row handling. Version 11 added reliable stop-level load observation counts. Version 12 added deterministic dwell-incident IDs, incident operating context, and route/operator eligible-timepoint exposure so Dwell Incident Review rates remain scope-correct. Version 13 adds occurrence-aware stop identity so repeated loop visits remain separate while shifted route positions still align. Version 14 gives heatmap trips stable identity and stores vehicle/applied capacity so same-time trips remain separate and inference uses the configured fleet limit. Older stored days remain visible with unavailable fields labelled honestly until rebuilt or re-imported.

Use this document when changing dashboard calculations, filters, labels, imports, or reports. A passing test confirms implementation behavior; operational sign-off confirms that the behavior is the intended Barrie Transit definition.

## Data flow

`STREETS import -> parser -> daily aggregation -> stored overview/monthly summaries -> authorized route/date/day filters -> dashboard modules`

The Planning Data Ridership Trends workspace reuses only each day's system fixed-route boarding total. A separate compact projection retains those post-cutover daily totals beyond the detailed dashboard's 380-day history and combines them with the reported workbook baseline through July 2026. It does not add Transit On Demand activity or expose route, stop, trip, operator, load, or alighting detail. See `docs/RIDERSHIP_TRENDS.md`.

The dashboard uses one shared time-range and day-type filter across Overview, OTP Analysis, Ridership, Load Profiles, and Dwell Incident Review. Preset ranges and the inclusive custom start/end range persist when moving between tabs, and every module must apply the same selected dates and day type to its numerator and denominator.

Primary calculation locations:

- daily aggregation: `utils/performanceDataAggregator.ts` and `functions/src/aggregator.ts`
- dashboard rollups: `components/Performance/SystemOverviewModule.tsx` and the related performance modules
- route scoping: `utils/performanceRouteFilter.ts`
- stored overview shape: `utils/performanceOverviewSummary.ts`
- loading and date-range trimming: `utils/performanceDataService.ts`
- legacy compact load-profile projection retained for backward-compatible API reads: `utils/performanceLoadProfileView.ts` and `functions/src/performanceLoadProfileView.ts`

Passenger load is presented in **Ridership -> Passenger Flow by Stop** only for Admin and Developer/internal access profiles; Planner access does not render this section. There is no standalone Load Profiles tab. The legacy compact load-profile read model, backend detail mode, and access key remain temporarily for backward compatibility and repair workflows, not as a supported navigation surface. Multi-day average load uses `loadObservationCount` weighting when every included value has reliable counts; mixed legacy history falls back to a daily-average estimate, and ambiguous legacy zeroes are omitted. Missing or non-positive APC source values are excluded from observed load calculations rather than treated as valid zero loads.

## Metric contracts

| Metric | Current calculation | Required interpretation | Review status |
|---|---|---|---|
| On-time performance | Eligible timepoint departures classified as early, on-time, or late; period rollups combine raw observation counts | Early is more than 3 minutes early. Late is more than 5 minutes late. Boundary values are on-time. Final trip stops, in-between rows, trippers, missing observed departures, and duplicate trip/stop observations are excluded. | Code-validated with synthetic cases; reconcile against a real STREETS period before operational sign-off |
| Early / on-time / late percentages | Bucket count divided by total eligible OTP observations | Multi-day, route, stop, and hour values must be weighted by observations, never by averaging stored percentages | Code-validated |
| Boardings / total ridership | Sum of STREETS `Boardings` | This is boarding activity, not unique riders | Code-validated; APC coverage still affects confidence |
| Transit On Demand activity | Sum of completed pickups and completed drop-offs in the automatically imported daily Licensee KPI workbooks for the active Ridership period | The Stop Activity Map combines TOD pickups with fixed-route boardings and TOD drop-offs with fixed-route alightings; Activity is the sum of both and is the default view. Numeric TOD stop IDs merge with matching fixed-route stops, while unmatched TOD locations remain separate map points. The separate TOD card immediately below the Stop Activity Map uses the same Activity/Pickups/Drop-offs views. TOD is excluded from fixed-route route selections, hourly views, and prior-period change views because the workbook has no route, hour, or comparison-period detail. Power Automate supplies the previous Toronto calendar day because the workbook has no trustworthy report date. | Parser, automatic replacement, selected-period aggregation, activity toggle, stop merge, and filter-exclusion behavior code-validated; monitor the email flow and imported service date operationally |
| Alightings | Sum of STREETS `Alightings` | Presented separately from boardings; it is not subtracted from ridership | Code-validated; APC coverage still affects confidence |
| Stop activity change | Current average activity per included service day minus the equivalent prior-period average. The map supports boardings, alightings, and combined activity. Past-week, past-month, and past-three-month views compare with the immediately preceding equal-length calendar window; single-day views compare with the same weekday one week earlier. | Circle size reflects absolute activity change per day, while colour shows increase, decrease, or little change. Percentage change is supporting context only because low-volume stops can produce unstable percentages. Route, day-type, and time-of-day filters must apply consistently to both periods. Shared stops use route-level breakdowns when a route is selected; all-route activity must not be substituted. Stops without comparable hourly data in both periods are omitted and disclosed rather than mixing hourly and all-day totals. | Code-validated with synthetic period-selection, route-scope, and hourly-availability cases; operational interpretation remains advisory |
| Average riders per day | Total boardings divided by distinct included service dates | A/B branches combined into one route must still count each date once | Code-validated |
| Trips observed | Distinct STREETS `TripID` values | Indicates trips represented in AVL/APC data, not necessarily scheduled trips operated | Code-validated |
| Trips operated | GTFS scheduled trips matched to STREETS observations | Display as suspected missed-trip analysis, not a final cancellation determination | Needs route-level scheduled/matched counts before route-scoped display can be fully validated |
| Service hours | Sum of the scheduled operating span calculated for each observed trip | Used as the BPH denominator. The precise start/end fields require operational confirmation | Definition sign-off required |
| Boards per service hour (BPH) | Boardings divided by service hours | Route BPH is a direct period ratio. The by-hour chart is only an explicitly labelled estimate because hourly service-hour denominators are not stored | Route calculation code-validated; business thresholds require sign-off |
| Average load | Mean of APC-reliable departure-load observations, grouped by route-stop occurrence and weighted across days by reliable stop-level observation count; APC-backed zero is valid | A route-stop occurrence is the physical stop ID plus its zero-based visit number within the trip, so a loop may contain the same stop more than once. Only positive APC source identifiers are reliable; zero, negative, or missing source values are excluded. Version 10 history falls back to a disclosed average of daily averages; ambiguous legacy zeroes are omitted because v10 cannot distinguish missing APC from a genuine zero. Values above the configured load cap are capped and disclosed in data quality | Code-validated; legacy history remains explicitly estimated |
| Passenger flow by stop | Boarding and alighting totals come from occurrence-aware route-direction heatmap cells. Reliable APC departure load is used first at each stop; when it is missing or unusable, the dashboard estimates load by carrying heatmap `boardings - alightings` through chronologically consecutive trips on the same route and block. | A single date shows exact stop-occurrence boarding/alighting totals. Multi-day filters show boarding/alighting averages per observed route-direction service day. Heatmap inference is independent from daily APC averages, preserves every served stop delta, uses stable trip identity, and carries ending load into later chronological trips. It uses a zero anchor when feasible; otherwise it uses the smallest non-negative starting load and labels the result as a lower bound. Same-time trips on one block are rejected as ambiguous. Every inferred trip-stop must remain within that vehicle's configured capacity. The UI reports observed, estimated, historical, and unavailable opportunity coverage, marks estimated points separately, and keeps confidence findings visible. | Code-validated for observed loads, stable same-time trip separation, trip-specific capacity, block inference, and confidence scoring. Inferred values remain planning estimates and still require operational reconciliation. |
| Peak load | Maximum APC-reliable departure load | Missing/unreliable load is not a zero-load observation | Code-validated |
| Wheelchair trips | Distinct trips containing a positive wheelchair-use count | Counts trips with activity, not individual boardings unless the source definition changes | Code-validated |
| Dwell incidents | Timepoint events departing more than 3 minutes late, with effective dwell classified as minor (up to 2 minutes), moderate (over 2 through 5 minutes), or high (over 5 minutes) | Moderate and high events are reportable. Minor tracked events are excluded from reportable counts, averages, queues, patterns, and exports. These are investigation signals, not proof of operator fault. | Code-validated; thresholds still require operational sign-off |
| Dwell incidents per 1,000 eligible timepoint visits | Reportable incidents divided by normal, non-tripper, non-detour timepoint observations with valid observed arrival and departure, multiplied by 1,000 | Numerator and denominator must share date, route, and operator scope. Version 12 stores route/operator exposure rows so route filters remain valid. | Code-validated |
| Dwell-associated downstream delay | Observed departure delay remaining after subtracting positive lateness already present when the vehicle arrived at the dwell stop | Show same-trip impact first, then later block carryover. Distinguish any carried delay, OTP-late departures over 5 minutes, return under 5 minutes, and full recovery to zero. Do not claim sole causation. | Code-validated; operational interpretation remains advisory |
| Data quality | Raw record and missing/capped/excluded field counts for the loaded import scope | Route-specific pages must not imply that system-wide quality counts are route-specific | Route-level quality fields are not currently available |
| Action Queue priority | Heuristic combining severity, persistence, and relative rider impact | Decision-support ranking only; it is not an audited operating metric | Definition sign-off required |

## Passenger-load confidence method v1

Confidence is calculated for the selected route and direction from served trip-stop opportunities: every non-null heatmap cell is one opportunity. Structural nulls caused by trips that do not serve a stop are not penalized.

- Observed positive-source APC evidence receives weight 100.
- Heatmap-inferred evidence receives weight 60.
- Historical daily averages without sample counts receive weight 30.
- Unavailable opportunities receive weight 0.
- Penalties apply proportionally for minimum-feasible anchors, open block endings, invalid chains, and pre-v14 trip identity.
- High is 90-100, medium is 60-89, low is 0-59, and unavailable means no usable load evidence.

The panel also monitors attempted/valid/invalid chains, assumed-empty and minimum-feasible anchors, open endings, stable versus legacy trip identity, skipped inference trips, and the four evidence categories. A score supports triage; it does not convert estimated loads into observations.

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
- Rebuild version 10 history when exact multi-day load weighting is required instead of the disclosed estimate. Rebuild pre-v13 loop history when separate repeated-stop occurrences are required. Rebuild pre-v14 CSV history to recover stable trip identity and current capacity; workbook history requires source re-upload.
- Block-inferred load is a planning estimate, not a replacement for APC evidence. Confirm whether operations can provide a verified pull-out/pull-in load anchor instead of the zero/minimum-feasible anchors derived from stored passenger movements.
- Pre-v14 summaries may already contain same-time trip collisions that cannot be reconstructed from stored cells; keep the legacy-identity confidence warning until those dates are rebuilt or re-imported.
- Add route-level scheduled/matched trip counts and data-quality counts before presenting those values as route-specific. Dwell exposure denominators are route-scoped in schema v12.
- Confirm the legacy dwell late gate and moderate/high thresholds as the permanent Barrie Transit operating definition.
- Confirm whether Route 12A/12B should be combined everywhere that Routes 2A/2B and 7A/7B are combined.
