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
  - Reviewed: coordinate validation, Canada guard, bounds, no default pair cap, total preservation, time/day/season bins, Toronto timezone classification, min-count/top-N filtering, bidirectional merge, percent-of-total denominator, stale legacy-bin handling, and empty/zero-count handling.
  - Verified: `tests/transitAppOdPairs.test.ts`, `tests/odFlowMapMetrics.test.ts`, Transit App parser/pipeline tests, build, and local data invariant audit.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate corrected OD JSON.

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
  - Fixes completed: scope-aware KPI cards, full rankable transfer lists saved before display caps, exact map time-band marker volumes via `timeBandCounts`, map top-N ranking after the selected time-band filter, exact `America/Toronto` transfer time buckets, scoped connection-target priorities, grouped wait averages from total wait, grouped route totals from all scoped rows, stricter Barrie-vs-regional route-hint classification, same-name stop disambiguation by GTFS stop ID, and a legacy-import warning when saved transfer summaries are capped.
  - Local post-fix validation: full `topTransferPairs` now represents all 29,676 transfer events; local full-list counts are 2,977 top pair rows, 354 GO-linked rows, 3,061 connection target rows, and 3,447 transfer pattern rows.
  - Tests: `tests/transitAppAggregator.transferAnalysis.test.ts`, `tests/transitAppTransferScope.test.ts`, `tests/transitAppTransferUiMetrics.test.ts`, and `tests/transitAppPipeline.e2e.test.ts`.
  - Rollout note: existing saved Transit App imports must be re-imported to regenerate uncapped transfer summaries and exact time-band counts.

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
| [x] | Map/table data path | Origin-Destination Map and OD pair table | `locationDensity`, `odPairs` | OD pair aggregation and map table data path reviewed. |
| [x] | Metric bar | Pairs, filtered pairs, trips, percent of total, legacy cap warning | `displayedPairs`, `filteredPairs`, `odPairs.totalTripsProcessed`, `totalTripsDroppedByPairLimit` | Reviewed as part of OD table pass. |
| [x] | Table | Top Origin-Destination Pairs: rank, origin, destination, trips, percent total | `displayedODPairs` or `odPairs.pairs` | Checked off per OD review. |
| [x] | Table | OD summary table: origin, destination, trips, percent total, distance, weekday, weekend | `displayedPairs`, `haversineKm`, OD bins | Checked off per OD review. |
| [ ] | Chart | Hourly Trip Distribution | `tripDistribution.hourly`, OD time filter labels | Confirm chart uses the correct filtered hourly counts, not OD-pair-only counts. |
| [ ] | Table/map | Coverage Gap Analysis: origin, destination, trips, distance, nearest route O/D, status | `analyzeODCoverageGaps(odPairs)`, GTFS route shapes | Confirm route-distance logic, direct-route detection, and Barrie-only filter. |
| [ ] | Table | Seasonal OD Comparison: origin, destination, total, Jan, Jul, Sep | `odPairs.pairs[].seasonBins` | Confirm it should use unfiltered top 10 rather than current map filters. |
| [ ] | Table | OD matrix heatmap: origin-by-destination cell counts | `matrixHeat.lookup`, `matrixZoneHeaders` | Confirm full filtered network behavior, zone header ranking, and directional vs merged counts. |
| [ ] | Table | OD matrix pair list: origin, destination, trips, percent total, distance | `matrixRows` | Confirm pagination, search, denominator, and map highlight path. |
| [ ] | Metric panel | Zone isolation: total trips, unique flows, average distance, peak period | `zonePanelData`, `getDirectionalCountsForZone` | Confirm inbound/outbound math and hourly-bin behavior for merged pairs. |
| [ ] | Map popup | OD popup: trips, percent total, distance, A-to-B/B-to-A counts | `popupState.pair` | Confirm popup values match table values under each filter. |

### Stop Analysis tab - `StopAnalysisModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [ ] | Metric | Endpoints Analyzed | `stopProximityAnalysis.totals.tripEndpointsAnalyzed` | Confirm endpoint inclusion/exclusion rules. |
| [ ] | Metric | Far Endpoints | `farEndpointCount`, `farEndpointSharePct`, `farThresholdKm` | Confirm threshold and denominator. |
| [ ] | Metric | Coverage Gap Clusters | `clusterCount` | Confirm clustering method and min-count behavior. |
| [ ] | Metric | Avg Nearest Stop Dist | `avgNearestStopDistanceKm` | Confirm distance source and weighting. |
| [ ] | Map | Coverage Gap Map | `topCoverageGaps`, `TransitAppMap` coverage clusters | Confirm map symbol size, filters, and popup metrics. |
| [ ] | Table | Far-From-Stops Clusters: cluster, trips, avg dist, peak period, OD overlap | `stopProximityAnalysis.topClusters` | Confirm ranking, dominant period/day, and OD overlap calculation. |
| [ ] | Table | Stop Mention Ranking: stop name, mentions | `stopProximityAnalysis.stopMentions` | Confirm stop-name normalization and that mentions are not boardings. |

### Transfer tab - `TransfersModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [x] | Metric | Transfer Events | Scoped `topTransferPairs` count sum, with all-system fallback | Verified local all-system total is 29,676 and Barrie-scope total is 23,067. Scope route hints now require numbered Barrie local routes so labels like TTC or Viva Blue stay regional. |
| [x] | Metric | GO-Linked Events | Scoped `topTransferPairs` GO-linked count sum, with all-system fallback | Verified local all-system total is 3,372 and Barrie-scope total is 3,368. |
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
| [ ] | Metric | Raw Pings | `heatmapAnalysis.debiasing.rawPoints` | Confirm source rows and coordinate validation. |
| [ ] | Metric | Debiased Pings | `heatmapAnalysis.debiasing.debiasedPoints` | Confirm debias window and user-key logic. |
| [ ] | Metric | Atlas Slices | `heatmapAnalysis.atlas.length` | Confirm expected season x day/time slice coverage. |
| [ ] | Metric | Callouts | `heatmapAnalysis.callouts.length` | Confirm callout selection criteria. |
| [ ] | Metric | Season Total | `heatmapAnalysis.seasonalTotals[season]` | Confirm season classification and "Other" treatment. |
| [ ] | Metric | Selected Slice Points | `activeSlice.totalPoints` | Confirm selected map slice matches table row. |
| [ ] | Metric | Debias Reduction | `heatmapAnalysis.debiasing.reductionPct` | Confirm formula and rounding. |
| [ ] | Map/chart | Heatmap Atlas Viewer | `activeSlice.cells` or `locationDensity` | Confirm base map fallback and selected-slice density. |
| [ ] | Table | Atlas Matrix: season, slice, points, top cell | `atlasRows` | Confirm sorting, top-cell selection, and click-through behavior. |
| [ ] | Cards | Key Callouts: day/time, points, note, coordinates | `heatmapAnalysis.callouts` | Confirm filtering by season and top-six ranking. |
| [ ] | Metric cards | Seasonal Comparison: January, July, September, Other | `seasonalTotals` | Confirm totals equal debiased points by season. |

### Route Performance tab - `RoutePerformanceModule.tsx`

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [ ] | Table | Routes to Watch: route, score, trend, confidence, diagnosis, action, priority | `routePerformance.watchlist` | Confirm watchlist criteria, priority score, and fallback behavior. |
| [ ] | Chart | Seasonal Score Trend | `routePerformance.monthly` | Confirm selected route filter and score components. |
| [ ] | Chart | Route Conversion Funnel: views, taps, suggestions, GO trips | selected `scorecard` row | Confirm funnel stages and that "GO trips" means app go-trip count. |
| [ ] | Table | Route Performance Scorecard | `routePerformance.scorecard` or fallback from `routeMetrics` and `routeLegs` | Confirm all rate formulas, score sorting, confidence, diagnosis, and fallback labels. |

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

## Disabled / placeholder workspace inventory

### Service Gaps tab - `ServiceGapsModule.tsx`

This tab is marked `underDevelopment` in `TransitAppWorkspace.tsx`, so it is inventoried but not available in the normal workspace tab bar.

| Reviewed | Surface | UI label / columns | Source fields | Review notes |
|---|---|---|---|---|
| [ ] | Metric | Routes with Demand | `serviceGapAnalysis.totals.routesWithDemand` | Confirm route-demand profile creation. |
| [ ] | Metric | Matched to GTFS | `serviceGapAnalysis.totals.matchedRoutes` | Confirm route matching and GTFS dependency. |
| [ ] | Metric | Gap Rows | `serviceGapAnalysis.gapRegister.length` | Confirm duplicate and filter behavior. |
| [ ] | Metric | Supply Profiles | `serviceGapAnalysis.supplyProfiles.length` | Confirm supply profile generation. |
| [ ] | Chart | Demand vs Supply Overlay | selected `routeProfiles[].hourly` | Confirm demand/supply axes, span shading, and selected route/day/season. |
| [ ] | Metric | First Trip | `selectedProfile.firstDepartureMin` | Confirm overnight and null handling. |
| [ ] | Metric | Last Trip | `selectedProfile.lastDepartureMin` | Confirm overnight and null handling. |
| [ ] | Metric | Avg Headway | `selectedProfile.avgHeadwayMinutes` | Confirm headway calculation and rounding. |
| [ ] | Metric | Demand Outside Span | `demandBeforeFirst + demandAfterLast` | Confirm span gap formula. |
| [ ] | Table | Gap Register: type, day, band, season, demand/h, supply/h | `gapRegister` | Confirm gap type logic and rates. |
| [ ] | Table | Route Gap Priority: route, gap rows, peak gap, primary type | derived from `gapRegister` | Confirm primary type and peak gap logic. |
| [ ] | Metric | Route Engagement Summary: avg daily views, avg daily taps, performance trend | `routeMetrics.summary`, `routePerformance.scorecard` | Confirm selected route matching. |

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

1. App Usage metrics, because they are simple and repeated in Overview.
2. Overview route and trip metrics.
3. Transfer tables and transfer KPIs.
4. Stop Analysis coverage tables.
5. Heatmap debiasing and atlas tables.
6. Route Performance scorecard and watchlist.
7. Service Gaps once the tab is ready to expose.
