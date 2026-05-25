# Transit App Data Review Checklist

Last updated: 2026-05-25

This file tracks the systematic code review of Transit App tables, metrics, charts, and map-derived values.

## Scope

- Current workspace entrypoint: `components/Analytics/TransitAppWorkspace.tsx`
- Active analysis tabs: Overview, OD Pair, Stop Analysis, Transfer, Heatmap, Route Performance, App Usage
- Disabled but inventoried tab: Service Gaps
- Legacy component inventoried separately: `components/Analytics/TransitAppDashboard.tsx`
- Import wizard counters are listed at the end.

## Review standard

Check an item only after confirming:

1. CSV input -> parser -> aggregator -> saved summary field -> UI render path.
2. Filters, sort order, top-N limits, denominators, units, and empty states.
3. Edge cases such as missing data, legacy imports, invalid coordinates, invalid timestamps, and zero denominators.
4. Tests or data validation where practical.
5. Whether old saved data must be re-imported after fixes.

## Status legend

- `[ ]` Not code-reviewed yet.
- `[x]` Code-reviewed and verified enough to trust for current use.

## Reviewed so far

### OD pair table and map summary - checked

- [x] **OD pair table data path**
  - UI: `Top Origin-Destination Pairs` in `components/Analytics/DemandModule.tsx`
  - Related UI: OD stats bar and collapsible OD summary table in `components/Analytics/TransitAppMap.tsx`
  - Source: `data.odPairs.pairs`, `data.odPairs.totalTripsProcessed`
  - Aggregator: `aggregateTransitAppODPairs(parsed.trips)` in `utils/transit-app/transitAppOdPairs.ts`
  - Reviewed: coordinate validation, Canada guard, bounds, no default pair cap, total preservation, time/day/season bins, Toronto timezone classification, min-count/top-N filtering, route-corridor filtering across all GTFS shape variants, bidirectional merge, percent-of-total denominator, stale legacy-bin handling, and empty/zero-count handling.
  - Verified: `tests/transitAppOdPairs.test.ts`, `tests/odFlowMapMetrics.test.ts`, Transit App parser/pipeline tests, build, and local data invariant audit.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate corrected OD JSON.

### Coverage Gap Analysis - checked

- [x] **OD Coverage Gap Analysis**
  - UI: Coverage Gap Analysis in `components/Analytics/DemandModule.tsx`, map in `components/Analytics/CoverageGapMap.tsx`
  - Source: `data.odPairs.pairs` -> `analyzeODCoverageGaps(odPairs)` in `utils/transit-app/transitAppAggregator.ts`
  - Fixes completed: analyzer now owns the Barrie-only endpoint filter before top-N selection, uses shared Barrie analysis bounds, considers every bundled GTFS shape variant instead of the first shape per route, groups merged Barrie A/B routes `2A/2B`, `7A/7B`, and `12A/12B` to route keys `2`, `7`, and `12`, and stores one `coverageStatus` used by both the map and table.
  - Local post-fix validation: 165,319 trip rows produced 28,525 OD pairs; top 25 Barrie-only coverage rows returned 25 served, 0 partial, and 0 gap rows with all map/table status rules aligned.
  - Tests: `tests/transitAppAggregator.coverageGaps.test.ts`, `tests/transitAppOdPairs.test.ts`, `tests/transitAppAggregator.stopProximity.test.ts`, `tests/transitAppPipeline.e2e.test.ts`, and TypeScript.

### App Usage tab - checked

- [x] **App Usage metrics and charts**
  - UI: `components/Analytics/AppUsageModule.tsx`
  - Source: `users.csv` -> `parseUsersFile` -> `aggregateAppUsage` -> `data.appUsage`
  - Helpers: `components/Analytics/appUsageChartUtils.ts`
  - Reviewed: user-day total, session total, download total, sessions-per-daily-user denominator, UTC-safe date parsing, trend sort order, month tick labels, day-of-week averages, monthly averages, and empty/zero handling.
  - Verified: local `users.csv` has 92 rows, no invalid dates, no duplicate dates, 62,396 user-days, 289,428 sessions, 1,883 downloads, and 4.6 sessions per daily user.
  - Tests: `tests/appUsageChartUtils.test.ts` and `tests/transitAppPipeline.e2e.test.ts`.

### Overview tab - checked

- [x] **Overview metrics, sparklines, and quick-glance tables**
  - UI: `components/Analytics/OverviewPanel.tsx`
  - Sources: `data.appUsage`, `data.tripDistribution`, `data.routeMetrics.summary`, `data.transferPatterns`
  - Reviewed: KPI formulas, route ranking, trip-volume daily ordering, app-usage sparkline reuse, top-route table, and top-transfer table.
  - Verified with local data: 62,396 user-days, 165,319 trip requests, 10 routes tracked, top route `8A` with 230,375 views, and 92 displayed days covered.
  - Tests: `tests/appUsageChartUtils.test.ts`, `tests/transitAppParsers.test.ts`, `tests/transitAppPipeline.e2e.test.ts`, and `tests/transitAppAggregator.transferAnalysis.test.ts`.
  - Follow-up note: `Days Covered` currently uses `appUsage.length || tripDistribution.daily.length`. Local data has 92 app-usage days and 93 Eastern-time trip day bins because one trip rolls into `2025-02-01`; the displayed 92 is correct for source `users.csv` days but could be misleading if interpreted as distinct trip-demand days.

### Transfer tab - checked

- [x] **Transfer metrics and tables**
  - UI: `components/Analytics/TransfersModule.tsx`
  - Source: `go_trip_legs_*.csv` and `tapped_trip_view_legs_*.csv` -> `parseTripLegsFile` -> `analyzeTransferConnections` -> `data.transferAnalysis` and `data.transferPatterns`
  - Local validation: 87,202 GO trip legs, 363,293 tapped trip legs, 30,898 trip chains processed, 8,939 duplicate chains removed, 29,676 transfer events, 3,372 GO-linked events, 1,975 unique route pairs, 1,298 unique transfer stops.
  - Fixes completed: scope-aware KPI cards, full rankable transfer lists saved before display caps, exact map time-band marker volumes via `timeBandCounts`, map top-N ranking after the selected time-band filter, exact `America/Toronto` transfer time buckets, scoped connection-target priorities, grouped wait averages from total wait, grouped route totals from all scoped rows, service-name-first agency classification, stricter Barrie-vs-regional route-hint classification, same-name stop disambiguation by GTFS stop ID, and a legacy-import warning when saved transfer summaries are capped.
  - Local post-fix validation: full `topTransferPairs` now represents all 29,676 transfer events; local full-list counts are 2,977 top pair rows, 354 GO-linked rows, 3,061 connection target rows, and 3,447 transfer pattern rows.
  - Tests: `tests/transitAppAggregator.transferAnalysis.test.ts`, `tests/transitAppTransferScope.test.ts`, `tests/transitAppTransferUiMetrics.test.ts`, and `tests/transitAppPipeline.e2e.test.ts`.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate uncapped transfer summaries and exact time-band counts.

### Stop Analysis tab - checked

- [x] **Stop proximity metrics, map clusters, and stop mention ranking**
  - UI: `components/Analytics/StopAnalysisModule.tsx` and coverage markers in `components/Analytics/TransitAppMap.tsx`
  - Source: `trips_*.csv` endpoints plus itinerary stop names from `go_trip_legs_*.csv`, `planned_go_trip_legs_*.csv`, and `tapped_trip_view_legs_*.csv`
  - Aggregator: `aggregateStopProximityAnalysis(parsed.trips, allLegs, odPairs)` in `utils/transit-app/transitAppAggregator.ts`
  - Fixes completed: Barrie-analysis-bounds filtering for coverage-gap endpoints, exact `America/Toronto` dominant period/day/season bucketing, total cluster count before the top-150 stored-list cap, map/table sort before top-N display, dynamic 400m threshold text, stop mention case/whitespace normalization, and nearest-stop full-search fallback for far endpoints.
  - Local post-fix validation: 330,638 candidate endpoints, 284,630 analyzed inside bounds, 46,008 excluded as out-of-scope, 18,380 far endpoints, 706 coverage clusters, 0.175 km average nearest-stop distance, and 4,391 normalized stop mention rows.
  - Tests: `tests/transitAppAggregator.stopProximity.test.ts`, `tests/transitAppPipeline.e2e.test.ts`, TypeScript, and build.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate Stop Analysis schema v2 summaries.

### Heatmap tab - checked

- [x] **Heatmap debiasing, atlas slices, callouts, and seasonal totals**
  - UI: `components/Analytics/HeatmapModule.tsx` and heatmap layer in `components/Analytics/TransitAppMap.tsx`
  - Source: `locations_*.csv` -> `parseLocationsFile` -> `aggregateHeatmapAnalysis(parsed.locations)` -> `data.heatmapAnalysis` and `data.locationDensity`
  - Reviewed: raw/debiased counters, 15-minute per-user debounce, exact `America/Toronto` day/time/season buckets, atlas slice coverage, selected slice density, callout ranking, seasonal totals, map density handoff, and PDF export data order.
  - Fixes completed: separated weekday overnight from evening, saved one callout for every non-empty atlas slice instead of globally capping at 18, prevented PDF export from mutating saved callout order, and avoided showing all-season fallback data when a selected slice is missing.
  - Local post-fix validation: 2,118,633 parsed location pings, 175,808 debiased pings, 91.7% debias reduction, 28 atlas slices, 28 callouts, seasonal totals of 54,260 January / 56,192 July / 63,617 September / 1,739 Other, and 11,635 overnight pings now separated from evening.
  - Tests: `tests/transitAppAggregator.heatmapAtlas.test.ts`, `tests/transitAppPipeline.e2e.test.ts`, TypeScript, and build.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate Heatmap schema v2 summaries with overnight slices and full callouts.

### Route Performance tab - checked

- [x] **Route scorecard, watchlist, score trend, and conversion funnel**
  - UI: `components/Analytics/RoutePerformanceModule.tsx`
  - Source: `lines_*.csv` engagement rows plus observed trip-leg rows from `go_trip_legs_*.csv`, `planned_go_trip_legs_*.csv`, and `tapped_trip_view_legs_*.csv`
  - Aggregator: `aggregateRoutePerformance(routeMetrics.daily, allLegs)` in `utils/transit-app/transitAppAggregator.ts`
  - Reviewed: monthly rollups, average daily views/taps, view-to-tap, view-to-suggestion, suggestion-to-GO rates, percentile scoring, confidence thresholds, trend classification, watch/monitor route flags, priority score, UI fallback scorecard, selected-route chart/funnel behavior, and stale-route handling.
  - Fixes completed: observed legs now join to route-performance months using exact `America/Toronto` local month instead of raw UTC string month, transit mode matching is case/space tolerant, GTFS normalization now merges `2A/2B`, `7A/7B`, and `12A/12B` into Transit App route keys for scheduled-trip normalization, weekday/weekend scores now use daypart-specific observed-leg counts, stale route rows compare against the median for their own latest month, numeric table sorts keep null/N/A values last, and empty watchlist messaging no longer implies re-import when scoring exists.
  - Local validation: 920 line rows, 10 tracked routes, active months January/July/September 2025, latest month September 2025, and 745 observed legs had UTC-month/local-month mismatch risk before the fix.
  - Tests: `tests/transitAppAggregator.routePerformance.test.ts`, `tests/transitAppPipeline.e2e.test.ts`, TypeScript, and build.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate Route Performance schema v3 summaries with corrected observed-leg monthly/daypart counts and median comparisons.

### Service Gaps tab - checked

- [x] **Service span, frequency-gap, and demand-vs-supply review**
  - UI: `components/Analytics/ServiceGapsModule.tsx`; tab is now enabled in `components/Analytics/TransitAppWorkspace.tsx`.
  - Source: Barrie Transit trip-leg rows from `go_trip_legs_*.csv`, `planned_go_trip_legs_*.csv`, and `tapped_trip_view_legs_*.csv`, plus bundled Barrie GTFS supply profiles from `utils/transit-app/transitAppGtfsNormalization.ts`.
  - Aggregator: `aggregateServiceGapAnalysis(allLegs, routeMetrics.daily, routeMetrics.summary, routePerformance.scorecard)` in `utils/transit-app/transitAppAggregator.ts`.
  - Reviewed: route-demand scoping, GTFS route matching, merged A/B route supply, average demand-per-hour rates, first/last trip span logic, headway display, gap register grouping, route priority summary, and route engagement cross-reference.
  - Fixes completed: filtered regional/non-Barrie transit legs out of Barrie service gaps, merged GTFS `2A/2B`, `7A/7B`, and `12A/12B` supply into Transit App base routes `2`, `7`, and `12`, normalized demand to average requests per service day/hour before comparing with scheduled trips/hour, used exact local minutes for span-start/span-end demand instead of whole-hour approximation, saved the full gap register instead of the old top-500 cap, and exposed the tab after review.
  - Local post-fix validation: 920 line rows, 526,469 leg rows parsed for validation, 10 routes with demand, 10 GTFS supply routes, 10 matched routes, 116 route/day/season profiles, 569 gap rows, and profile/supply routes aligned to `2`, `7`, `8A`, `8B`, `10`, `11`, `12`, `100`, `101`, `400`.
  - Tests: `tests/transitAppAggregator.serviceGaps.test.ts`, `tests/transitAppGtfsNormalization.test.ts`, `tests/transitAppAggregator.routePerformance.test.ts`, Transit App suite, TypeScript, and build.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate Service Gaps schema v2 summaries.

## Active workspace inventory

### Overview tab - `OverviewPanel.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | User-Days | `appUsage[].users` summed | Verified as same data path as App Usage; local total is 62,396. |
| [x] | Metric | Trip Requests | `tripDistribution.daily[].count` summed | Verified total equals parsed trip rows with valid timestamps; local total is 165,319. |
| [x] | Metric | Routes Tracked | `routeMetrics.summary.length` | Verified route summary aggregation; local count is 10 routes. |
| [x] | Metric | Days Covered | `appUsage.length || tripDistribution.daily.length` | Reviewed behavior. Displays 92 app-usage days locally; note this is not the same as distinct trip day bins when timezone rollover creates an extra trip date. |
| [x] | Chart | Top Routes | `routeMetrics.summary[].totalViews` top 5 | Verified `routeMetrics.summary` is sorted descending by total views; local top route is `8A`. |
| [x] | Chart | Trip Volume | `tripDistribution.daily` last 30 rows | Verified daily trip rows are Eastern-date bins sorted ascending before `slice(-30)`. |
| [x] | Chart | App Usage | `appUsage` timeline last 30 rows | Verified UTC-safe date handling through `appUsageChartUtils.ts`. |
| [x] | Table | Top Routes: Route, Views, Taps, Avg/Day | `routeMetrics.summary` | Verified views/taps totals and `avgDailyViews = round(totalViews / active route days)`. |
| [x] | Table | Top Transfers: From, To, Count, Avg Wait | `transferPatterns` | Verified `transferPatterns` are sorted descending by count and use rounded average wait. |

### OD Pair tab - `DemandModule.tsx` and `TransitAppMap.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Map/table data path | Origin-Destination Map and OD pair table | `locationDensity`, `odPairs` | OD pair aggregation and map/table data path reviewed. Route corridor filtering now evaluates all GTFS shape variants for the selected route, while the overlay can still use the compact route shape list. |
| [x] | Metric bar | Pairs, filtered pairs, trips, percent of total, legacy cap warning | `displayedPairs`, `filteredPairs`, `odPairs.totalTripsProcessed`, `totalTripsDroppedByPairLimit` | Reviewed as part of OD table pass. |
| [x] | Table | Top Origin-Destination Pairs: rank, origin, destination, trips, percent total | `displayedODPairs` or `odPairs.pairs` | Reviewed and fixed. The table now treats an empty map-filter result as a real empty result instead of falling back to unfiltered `odPairs.pairs`; fallback is only used before the map reports its displayed OD pairs. |
| [x] | Table | OD summary table: origin, destination, trips, percent total, distance, weekday, weekend | `displayedPairs`, `haversineKm`, OD bins | Checked off per OD review. |
| [x] | Chart | Hourly Trip Distribution | `tripDistribution.hourly`, OD time filter labels | Reviewed. Chart intentionally uses full trip-request hourly counts, filtered only by the shared OD time-period hour definitions; it is not capped or reduced to OD-pair rows. |
| [x] | Table/map | Coverage Gap Analysis: origin, destination, trips, distance, nearest route O/D, status | `analyzeODCoverageGaps(odPairs)`, GTFS route shapes | Reviewed. Coverage analysis filters Barrie-only OD pairs before top-N selection, considers all GTFS shape variants grouped by normalized Barrie route, uses a 1 km direct-route buffer, dedupes served-route labels, and emits one `coverageStatus` used by both map and table. Local post-fix: 25 top Barrie-only rows analyzed; 25 served, 0 partial, 0 gap. |
| [x] | Table | Seasonal OD Comparison: origin, destination, total, Jan, Jul, Sep, Other when present | `odPairs.pairs[].seasonBins` | Reviewed. This is intentionally the overall unfiltered top 10 so Jan/Jul/Sep/Other can be compared side-by-side; added the Other column when those trips exist. Local OD season totals sum to processed OD trips. |
| [x] | Table | OD matrix heatmap: origin-by-destination cell counts | `matrixHeat.lookup`, `matrixZoneHeaders` | Reviewed. Matrix uses the displayed Top N pairs unless All zones is enabled; All zones uses the full filtered network. Zone headers rank by combined origin+destination demand, cells remain directional unless the user enables bidirectional merge. |
| [x] | Table | OD matrix pair list: origin, destination, trips, percent total, distance | `matrixRows` | Reviewed. Search filters origin/destination names, pagination is 40 rows, `% Total` uses `odPairs.totalTripsProcessed`, and row click switches back to the map, fits bounds, and highlights the same pair object. |
| [x] | Metric panel | Zone isolation: total trips, unique flows, average distance, peak period | `zonePanelData`, `getDirectionalCountsForZone` | Reviewed and fixed. Selected-zone totals now use all filtered flows touching the zone, not only the visible Top N map slice; merged inbound/outbound counts are preserved, distance is trip-weighted, and all-zero hourly bins no longer show a false Overnight peak. Local top-zone validation changed from old capped 1,618 trips / 1 connection to full 5,080 trips / 172 connections. |
| [x] | Map popup | OD popup: trips, percent total, distance, A-to-B/B-to-A counts | `popupState.pair` | Reviewed. Popup reads the same `displayedPairs[pairIndex]` object used by map/table rows, with matching trip count, global percent denominator, haversine distance, and merged forward/reverse counts. |

### Stop Analysis tab - `StopAnalysisModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | Endpoints Analyzed | `stopProximityAnalysis.totals.tripEndpointsAnalyzed` | Reviewed endpoint rules. v2 now counts valid trip endpoints inside the Barrie analysis bounds only and records invalid/out-of-scope exclusions. Local post-fix: 284,630 analyzed; 46,008 out-of-scope excluded. |
| [x] | Metric | Far Endpoints | `farEndpointCount`, `farEndpointSharePct`, `farThresholdKm` | Verified 400m threshold and in-scope denominator. Local post-fix: 18,380 far endpoints, 6.5% of analyzed endpoints. |
| [x] | Metric | Coverage Gap Clusters | `clusterCount` | Fixed to report total cluster count before the saved top-150 display cap. Local post-fix: 706 total clusters, with top 150 stored for display. |
| [x] | Metric | Avg Nearest Stop Dist | `avgNearestStopDistanceKm` | Verified endpoint-weighted nearest GTFS stop distance after excluding out-of-area endpoints. Local post-fix: 0.175 km. |
| [x] | Map | Coverage Gap Map | `topCoverageGaps`, `TransitAppMap` coverage clusters | Fixed map/table cluster sorting before top-N display and dynamic threshold subtitle. Coverage symbols scale by cluster trip count and popup uses cluster avg distance/time/day/season. |
| [x] | Table | Far-From-Stops Clusters: cluster, trips, avg dist, peak period, OD overlap | `stopProximityAnalysis.topClusters` | Reviewed clustering at ~400m grid, trip-count ranking, dominant period/day/season, OD overlap within 0.8 km, and exact `America/Toronto` time bucketing. Local top cluster is Hickling Trail area with 2,404 far endpoints. |
| [x] | Table | Stop Mention Ranking: stop name, mentions | `stopProximityAnalysis.stopMentions` | Fixed case/whitespace normalization while keeping the most common display label. Confirmed these are itinerary stop-name mentions from leg files, not boardings. Local normalized rows: 4,391. |

### Transfer tab - `TransfersModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | Transfer Events | Scoped `topTransferPairs` count sum, with all-system fallback | Verified local all-system total is 29,676 and Barrie-scope total is 23,067. Scope route hints now require numbered Barrie local routes so labels like TTC or Viva Blue stay regional. |
| [x] | Metric | GO-Linked Events | Scoped `topTransferPairs` GO-linked count sum, with all-system fallback | Verified local all-system total is 3,372 and Barrie-scope total is 3,368. Transfer type now respects `service_name` before Barrie GTFS route-short-name matches. |
| [x] | Metric | Unique Route Pairs | Scoped `topTransferPairs` route-pair set | Verified route-pair count follows the selected scope. |
| [x] | Metric | Route Match Rate | Scoped route-reference matches from `topTransferPairs` | Verified all-system route match rate is 31.39%; scoped KPI now follows selected scope. |
| [x] | Map/table | Top Transfer Pairs | `transferAnalysis.topTransferPairs` | Verified full rankable list is saved before UI display caps; local full list has 2,977 rows. Map top-N is ranked after the selected time-band count is applied and includes overnight filtering. Same-name GTFS stops stay separate by stop ID. |
| [x] | Table | Top Transfer Pairs: from, to, transfer stop, arrival/departure times, peak bands, volume, avg wait | `visibleTopPairs` after scope filtering | Verified scope filtering happens before top-50 display cap. |
| [x] | Table | GO-Linked Transfers: from, to, band, count | `visibleGoLinked` after scope filtering | Verified scope filtering happens before top-15 display cap; local full GO-linked list has 354 rows. |
| [x] | Table | Connection Targets: pair, stop ID, arr/dep times, bands, tier | `visibleConnectionTargets` after scope filtering | Verified scope filtering happens before top-15 display cap; local full target list has 3,061 rows. Priority tier is recomputed after scope ranking. |
| [x] | Table | Grouped transfer pattern tables: from stop, to stop, arrival/departure times, count, avg wait, range | `groupedPatterns` | Verified grouping uses all scoped rows and weighted total-wait math where available, not only the top-100 visible rows. |
| [x] | Table | Transfer Patterns: from, to, transfer stop, arrival/departure times, count, avg wait, range | `visiblePatterns` after scope filtering | Verified scope filtering happens before top-100 display cap; local full transfer-pattern list has 3,447 rows. |

### Heatmap tab - `HeatmapModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | Raw Pings | `heatmapAnalysis.debiasing.rawPoints` | Verified as parsed valid-coordinate `locations_*.csv` rows. Local count is 2,118,633; no invalid timestamps or missing user IDs found in local data. |
| [x] | Metric | Debiased Pings | `heatmapAnalysis.debiasing.debiasedPoints` | Verified 15-minute per-user debounce using UTC timestamp buckets. Local debiased count is 175,808. |
| [x] | Metric | Atlas Slices | `heatmapAnalysis.atlas.length` | Fixed schema v2 to include weekday overnight separately. Local data has 28 slices: 7 slice definitions x 4 seasons including Other. |
| [x] | Metric | Callouts | `heatmapAnalysis.callouts.length` | Fixed global top-18 cap so each non-empty slice keeps a callout. Local data now has 28 callouts. |
| [x] | Metric | Season Total | `heatmapAnalysis.seasonalTotals[season]` | Verified exact Toronto season classification and Other treatment. Local totals: Jan 54,260; Jul 56,192; Sep 63,617; Other 1,739. |
| [x] | Metric | Selected Slice Points | `activeSlice.totalPoints` | Verified selected metric comes from the selected atlas slice. Local January AM slice has 6,892 debiased points. |
| [x] | Metric | Repeat Ping Reduction | `heatmapAnalysis.debiasing.reductionPct` | Verified formula `(raw - debiased) / raw`, rounded to one decimal. Local reduction is 91.7%. |
| [x] | Map/chart | Heatmap Atlas Viewer | `activeSlice.cells` or empty slice density | Fixed missing-slice behavior so the map no longer falls back to all-season density. TransitAppMap can still further filter visible cells by Barrie/Regional toggle. Added map-hover help text explaining Repeat Ping Reduction. |
| [x] | Table | Atlas Matrix: season, slice, points, top cell | `atlasRows` | Verified rows are derived from every atlas slice, sorted by points, top cell uses first density cell, and click-through sets selected season/slice. |
| [x] | Cards | Key Callouts: day/time, points, note, coordinates | `heatmapAnalysis.callouts` | Verified selected-season filtering and top-six display. Callout notes use nearest GTFS stop to the slice top cell. |
| [x] | Metric cards | Seasonal Comparison: January, July, September, Other | `seasonalTotals` | Verified seasonal cards equal debiased point totals by season; Other displays only when non-zero. |

### Route Performance tab - `RoutePerformanceModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Table | Routes to Watch: route, score, trend, confidence, diagnosis, action, priority | `routePerformance.watchlist` | Reviewed watch route = below its own latest-month median and declining; monitor route = below median or declining. Priority score uses same-month score gap, trend penalty, confidence, and demand weight. Fixed no-watchlist empty message. |
| [x] | Chart | Seasonal Score Trend | `routePerformance.monthly` | Verified selected-route filter, month sort, composite/weekday/weekend score series, and score components from percentile ranks. Weekday/weekend scores now use daypart-specific observed-leg counts. |
| [x] | Chart | Route Conversion Funnel: views, taps, suggestions, GO trips | selected `scorecard` row | Verified funnel stages use app engagement counts from `lines_*.csv`; GO Trips means app `go_trips`, not scheduled GO service or transfer events. |
| [x] | Table | Route Performance Scorecard | `routePerformance.scorecard` or fallback from `routeMetrics` and `routeLegs` | Verified rate formulas, default low-score sort, null/N/A sort behavior, confidence thresholds, planner diagnosis/action labels, legacy fallback labels, observed-leg monthly join, and stale-route median comparison. |

### App Usage tab - `AppUsageModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | User-Days | `appUsage[].users` summed | Verified as sum of daily `users` rows from `users.csv`; local total is 62,396. |
| [x] | Metric | Total Sessions | `appUsage[].sessions` summed | Verified as sum of daily `sessions` rows; local total is 289,428. |
| [x] | Metric | Downloads | `appUsage[].downloads` summed | Verified as sum of daily `downloads` rows; local total is 1,883. |
| [x] | Metric | Sessions / Daily User | `totalSessions / userDays` | Verified zero-denominator guard and local value of 4.6. |
| [x] | Chart | App Usage Trend | `buildAppUsageTimeline(appUsage)` | Verified valid date parsing, chronological sort, UTC labels, users/sessions/downloads series. |
| [x] | Chart | Day-of-Week Profile | `buildDayOfWeekProfile(appUsage)` | Verified UTC date-only weekday buckets and average daily users by weekday. |
| [x] | Chart | Monthly Comparison | `buildMonthlyAverages(appUsage)` | Verified month grouping, average daily users denominator, labels, and chronological sort. |

### Service Gaps tab - `ServiceGapsModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | Routes with Demand | `serviceGapAnalysis.totals.routesWithDemand` | Verified as Barrie Transit demand routes only after filtering regional legs. Local post-fix: 10. |
| [x] | Metric | Matched to GTFS | `serviceGapAnalysis.totals.matchedRoutes` | Verified against normalized bundled GTFS supply routes, including merged A/B route supply. Local post-fix: 10 of 10. |
| [x] | Metric | Gap Rows | `serviceGapAnalysis.gapRegister.length` | Fixed to use the uncapped full gap register. Local post-fix: 569 rows. |
| [x] | Metric | Supply Profiles | `serviceGapAnalysis.supplyProfiles.length` | Verified supply profiles are generated from bundled GTFS and normalized to Transit App route keys. |
| [x] | Chart | Demand vs Supply Overlay | selected `routeProfiles[].hourly` | Fixed demand axis to average app requests per service day/hour, comparable to scheduled departures/hour. Selected route/day/season filters verified. |
| [x] | Metric | First Trip | `selectedProfile.firstDepartureMin` | Verified from first GTFS departure minute for the selected route/day. |
| [x] | Metric | Last Trip | `selectedProfile.lastDepartureMin` | Verified from last GTFS departure minute; post-midnight display remains service-day aware. |
| [x] | Metric | Avg Headway | `selectedProfile.avgHeadwayMinutes` | Verified from sorted GTFS first-departure times and rounded to nearest minute. |
| [x] | Metric | Avg Demand Outside Span | `demandBeforeFirst + demandAfterLast` | Fixed to use exact Toronto-local leg minutes and average per active service date. |
| [x] | Table | Gap Register: type, day, band, season, avg demand/h, supply/h | `gapRegister` | Verified gap types, time-band grouping, average demand/h rates, and scheduled supply/h rates. |
| [x] | Table | Route Gap Priority: route, gap rows, peak gap, primary type | derived from `gapRegister` | Verified priority uses full saved gap rows and strongest average demand-minus-supply signal. |
| [x] | Metric | Route Engagement Summary: avg daily views, avg daily taps, performance trend | `routeMetrics.summary`, `routePerformance.scorecard` | Verified selected route matching against normalized route keys. |

## Disabled / placeholder workspace inventory

### GO Integration and Validation tabs

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [ ] | Placeholder | GO Integration | none | Current tab renders `ComingSoonPlaceholder`. |
| [ ] | Placeholder | Validation | none | Current tab renders `ComingSoonPlaceholder`. |

## Legacy component inventory

`components/Analytics/TransitAppDashboard.tsx` appears to be a legacy combined dashboard rather than the current tabbed workspace, but it still renders data if used.

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [ ] | Metric | User-Days | `appUsage[].users` summed | Same as Overview/App Usage. |
| [ ] | Metric | Trip Requests | `tripDistribution.daily[].count` summed | Same as Overview. |
| [ ] | Metric | Routes Tracked | `routeMetrics.summary.length` | Same as Overview. |
| [ ] | Metric | Days Covered | `appUsage.length || tripDistribution.daily.length` | Same as Overview. |
| [ ] | Chart | Route Popularity | `routeMetrics.summary` | Confirm route sort and values. |
| [ ] | Chart | App Usage Trend | `appUsage` | Confirm date ordering. |
| [ ] | Chart | Hourly Trip Distribution | `tripDistribution.hourly` | Confirm hourly parsing. |
| [ ] | Map | Rider Activity Map | `locationDensity`, `odPairs` | Confirm whether legacy map should stay in sync with current OD behavior. |
| [ ] | Table | Top Transfer Patterns: from route, to route, transfer stop, count, avg wait, min/max | `transferPatterns` | Confirm transfer detection. |
| [ ] | Table | Route Leg Summary: route, service, legs, trips, top boarding, top alighting | `routeLegs` | Confirm leg aggregation and top-stop ranking. |

## Import wizard counters

`components/Analytics/TransitAppImport.tsx` does not render analysis tables, but it shows import progress and data counters.

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [ ] | Counter | Found Transit App files | detected files by Transit App CSV type | Confirm file type detection and required/optional file handling. |
| [ ] | Counter | File counts by type | `lines`, `trips`, `locations`, `go_trip_legs`, `planned_go_trip_legs`, `tapped_trip_view_legs`, `users` | Confirm naming pattern and duplicate treatment. |
| [ ] | Counter | Parsed rows/files after import | parser stats | Confirm failures are surfaced and row counts match parsed data. |

## Next review order recommendation

1. GO Integration and Validation placeholders, because they are still unreviewed but should be quick to confirm.
2. Import wizard counters, because file detection and row-count messaging are the next remaining user-facing numbers.
3. Legacy `TransitAppDashboard.tsx`, only if it is still reachable or worth keeping in sync.
