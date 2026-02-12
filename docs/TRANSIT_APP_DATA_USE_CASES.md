# Transit App Data - Use Cases & Implementation Plan

> **Dataset:** Barrie Transit / Transit App export (Jan, Jul, Sep 2025)
> **Source folder:** `Transit App Data/barron/`
> **Prepared:** February 2026

---

## Implementation Status Checklist

> **Last updated:** February 2026
> **Legend:** :white_check_mark: Done | :construction: Partial | :x: Not started

### UC1: Origin-Destination Demand Analysis — :white_check_mark: 100%

- [x] Data types (`ODPairData`, `ODPair`) in `transitAppTypes.ts`
- [x] CSV parsing (`parseTripsFile()`) in `transitAppParsers.ts`
- [x] Grid-cell aggregation (`aggregateODPairs()`) — ~500m cells, top 200 pairs
- [x] Hourly + weekday/weekend distribution per OD pair
- [x] UI: Hourly distribution chart + top 20 OD pairs table (`DemandModule.tsx`)
- [x] Named geographic zones (neighbourhoods, TAZs, or labelled grid)
- [x] Seasonal OD matrices (separate Jan / Jul / Sep)
- [x] Gap analysis: overlay top OD pairs on route network
- [x] Desire line map (thickness = demand)
- [x] Gap report: high-demand corridors not served by direct routes

### UC2: Route Performance Scoring — :white_check_mark: 100%

- [x] Data types (`RouteMetricDaily`, `RouteMetricSummary`, `RoutePerformanceMonthly`, `RoutePerformanceScorecardRow`, `RouteWatchlistRow`) in `transitAppTypes.ts`
- [x] CSV parsing (`lines_*.csv` → `RouteMetricDaily`) in `transitAppParsers.ts`
- [x] Conversion funnel ratios (View→Tap, Tap→Suggestion, Suggestion→GO)
- [x] Composite score (0-100) via weighted percentile ranks in `transitAppScoring.ts`
- [x] Trend direction (Rising / Stable / Declining, ±5pt threshold)
- [x] Weekday vs. weekend day-part scores
- [x] Normalization by scheduled trips (GTFS trip count)
- [x] "Routes to Watch" flagging (below median + declining)
- [x] Cross-reference with trip leg data (`RouteLegSummary`)
- [x] Diagnosis codes + recommended actions (`transitAppPlannerRules.ts`)
- [x] UI: Scorecard table, watchlist, funnel chart (`RoutePerformanceModule.tsx`)
- [x] Tests: `transitAppScoring.test.ts`, `transitAppAggregator.routePerformance.test.ts`

### UC3: Transfer & Connection Analysis — :white_check_mark: 100%

- [x] Data types (`TransferVolumeRow`, `TransferPairSummary`, `GoLinkedTransferSummary`, `TransferConnectionTargetCandidate`) in `transitAppTypes.ts`
- [x] Trip leg parsing (`go_trip_legs`, `tapped_trip_view_legs`, `planned_go_trip_legs`) in `transitAppParsers.ts`
- [x] Route/stop name normalization to GTFS IDs (`transitAppGtfsNormalization.ts`)
- [x] Trip chain building + deduplication
- [x] Transfer event extraction (adjacent leg pairs within trip chain)
- [x] Transfer type classification (Barrie↔Barrie, Barrie↔GO, GO↔Barrie, regional)
- [x] Volume aggregation by route pair, stop, time band, day type, season
- [x] GO-linked transfer isolation and ranking
- [x] Connection target candidates with priority tiers for Scheduler 4
- [x] UI: Transfer pattern table with scope filtering (`TransfersModule.tsx`)
- [x] Tests: `transitAppAggregator.transferAnalysis.test.ts`

### UC4: Service Span & Frequency Gap Analysis — :white_check_mark: 100%

- [x] Data types (`HourlyTripDistribution`, `DailyTripCount`) in `transitAppTypes.ts`
- [x] Demand-side: Trip request timestamps binned by hour
- [x] UI: Hourly demand bar chart with time-of-day filters (`DemandModule.tsx`)
- [x] GTFS supply profiles (first/last trip, headway, departures/hour per route)
- [x] Demand-vs-supply overlay charts (demand bars + scheduled departures line)
- [x] Gap detection: span-start, span-end, weekend, seasonal gaps
- [x] Gap register table (route, gap type, day type, time band, season)
- [x] Route-level demand-vs-supply breakdown
- [x] Cross-reference with route engagement data (UC2)

### UC5: Stop-Level Demand Proximity Analysis — :white_check_mark: 100%

- [x] Data types (`LocationGridCell`) in `transitAppTypes.ts`
- [x] Location CSV parsing (`parseLocationsFile()`) in `transitAppParsers.ts`
- [x] Grid-cell density aggregation (~200m cells) in `transitAppAggregator.ts`
- [x] Route leg summaries with top boarding/alighting stops per route
- [x] UI: Location density heatmap (`HeatmapModule.tsx` + `TransitAppMap.tsx`)
- [x] Proximity calculation: distance from demand points to nearest GTFS stop
- [x] "Far from stops" cluster identification (>400m threshold)
- [x] Stop activity ranking by itinerary mention frequency
- [x] Coverage gap map with trip count + time band annotations
- [x] Cross-reference with OD corridors (UC1)

### UC6: Rider Demand Heatmaps — :white_check_mark: 100%

- [x] Location data parsing + grid-cell density aggregation
- [x] Outlier filtering (zero coordinates, out-of-bounds)
- [x] Basic heatmap rendering via Leaflet/Mapbox (`TransitAppMap.tsx`)
- [x] OD pair overlay on map
- [x] User debiasing (cap pings per user per 15-min window)
- [x] Multi-map atlas: 18 maps (6 time-band/day combos x 3 seasons)
- [x] Seasonal comparison maps (Jan vs. Jul vs. Sep side-by-side)
- [x] Route network + stop overlay on heatmaps
- [x] Annotated summary maps with callout boxes
- [x] PDF export for staff reports

### UC7: GO Transit Integration Business Case — :white_check_mark: 100%

- [x] GO-linked transfer identification and classification
- [x] GO transfer volume summaries by station, route, time band, season
- [x] First-mile / last-mile pattern recognition
- [x] Connection target candidates with `goLinked` flag and priority tier
- [x] Ready for Scheduler 4 Connection library import
- [x] Connection reliability KPIs (p50/p90 wait, % within target buffer, % missed)
- [x] Rider impact estimation (passenger-minutes lost, miss-risk hotspots)
- [x] GO Dependency Index (ranking routes by GO contribution)
- [x] Coordination/funding scenarios with operating implications
- [x] Metrolinx-ready brief document

### UC8: App Adoption & Growth Tracking — :white_check_mark: 100%

- [x] Data types (`AppUsageDaily`) in `transitAppTypes.ts`
- [x] CSV parsing (`parseUsersFile()`) in `transitAppParsers.ts`
- [x] Daily/weekly/monthly usage aggregation
- [x] Day-of-week profile (average users by day)
- [x] Seasonal comparison (Jan / Jul / Sep monthly averages)
- [x] KPI cards: total users, sessions, downloads, sessions-per-user
- [x] UI: Trend lines, day-of-week chart, seasonal view (`AppUsageModule.tsx`)

### UC9: Schedule Validation & Data Feed Audit — :white_check_mark: 100%

- [x] Planned trip legs parsed from CSV
- [x] Partial GTFS loading in `transitAppGtfsNormalization.ts`
- [x] Match planned trip legs to GTFS scheduled trips
- [x] Time mismatch detection (planned departure vs. GTFS schedule)
- [x] Missing route / ghost trip detection
- [x] Stop name mismatch identification
- [x] Feed accuracy score (% of planned legs matching GTFS within 2 min)
- [x] Planned vs. actual journey comparison
- [x] Recommendations for GTFS feed improvements

### UC10: Council-Ready Reporting & Dashboards — :white_check_mark: 100%

- [x] Dashboard workspace with tabbed navigation (`TransitAppWorkspace.tsx`)
- [x] Overview panel with KPI cards + sparklines (`OverviewPanel.tsx`)
- [x] Route Performance module (scorecard table, watchlist, actions)
- [x] Transfers module (volume patterns, GO-linked, filtering)
- [x] Demand module (hourly distribution, top OD pairs)
- [x] Heatmap module (location density map)
- [x] App Usage module (trends, day-of-week, seasonal)
- [x] Data import UI with drag-and-drop (`TransitAppImport.tsx`)
- [x] Firebase persistence (Firestore metadata + Storage summaries)
- [x] Council staff report template (executive summary, route sections, recommendations, financial implications)
- [x] Seasonal comparison report (standard tri-annual format)
- [x] 1-page talking points document
- [x] Public-facing summary / infographic
- [x] PDF export of full report

### Summary

| # | Use Case | Status | Complete |
|---|----------|--------|----------|
| 1 | OD Demand Analysis | :white_check_mark: **Done** | 100% |
| 2 | Route Performance Scoring | :white_check_mark: **Done** | 100% |
| 3 | Transfer & Connection Analysis | :white_check_mark: **Done** | 100% |
| 4 | Service Span & Frequency Gaps | :white_check_mark: **Done** | 100% |
| 5 | Stop-Level Proximity Analysis | :white_check_mark: **Done** | 100% |
| 6 | Rider Demand Heatmaps | :white_check_mark: **Done** | 100% |
| 7 | GO Transit Business Case | :white_check_mark: **Done** | 100% |
| 8 | App Adoption Tracking | :white_check_mark: **Done** | 100% |
| 9 | Schedule Validation & Audit | :white_check_mark: **Done** | 100% |
| 10 | Council Reporting & Dashboards | :white_check_mark: **Done** | 100% |

---

## Table of Contents

1. [Origin-Destination Demand Analysis](#1-origin-destination-demand-analysis)
2. [Route Performance Scoring](#2-route-performance-scoring)
3. [Transfer & Connection Optimization](#3-transfer--connection-optimization)
4. [Service Span & Frequency Gap Analysis](#4-service-span--frequency-gap-analysis)
5. [Stop-Level Analysis](#5-stop-level-analysis)
6. [Rider Heatmaps & Spatial Visualization](#6-rider-heatmaps--spatial-visualization)
7. [GO Transit Integration Business Case](#7-go-transit-integration-business-case)
8. [App Adoption & Growth Tracking](#8-app-adoption--growth-tracking)
9. [Schedule Validation & Data Feed Audit](#9-schedule-validation--data-feed-audit)
10. [Council-Ready Reporting & Dashboards](#10-council-ready-reporting--dashboards)

---

## Dataset Summary

| File Type | Records/Day (approx) | Key Fields | Coverage |
|---|---|---|---|
| `trips_*.csv` | ~2,100 | user_id, origin/dest coords, timestamp, arrive_by/leave_at | Where people want to go |
| `locations_*.csv` | ~25,000 | user_id, lat/lon, timestamp | Where riders physically are |
| `lines_*.csv` | ~11 rows | route, views, taps, routing suggestions, GO trips | Route-level engagement |
| `go_trip_legs_*.csv` | ~1,000 | trip legs with service name, route, stops, distance, users_helped | Actual multi-modal journeys |
| `planned_go_trip_legs_*.csv` | ~980 | planned trip legs with service, route, stops | Suggested journeys |
| `tapped_trip_view_legs_*.csv` | ~4,700 | trip legs users actively viewed/tapped | Engaged trip planning |
| `users.csv` | 1 row/day | date, active users, sessions, downloads | App adoption over time |

**Seasonal periods:** January (winter), July (summer), September (fall/back-to-school)

---

## 1. Origin-Destination Demand Analysis

### What It Is

Build origin-destination (OD) matrices from the `trips` data to understand where riders are trying to travel. Each row in `trips_*.csv` contains a start lat/lon, end lat/lon, and timestamp, representing a real trip planning request from a Transit App user.

### Implementation Steps

1. **Define geographic zones** - Divide the Barrie service area into analysis zones (e.g., Traffic Analysis Zones, wards, or a custom grid of 500m cells). Candidate zone boundaries:
   - Major neighbourhoods (Painswick, Holly, Letitia Heights, Allandale, etc.)
   - Key attractors as their own zones (Georgian College, RVH, Downtown Terminal, Park Place, Barrie South GO area)
   - Grid-based (500m or 1km hexagonal grid for finer granularity)

2. **Geocode trips to zones** - For each trip record, assign the start and end coordinates to a zone. This converts raw lat/lon pairs into a zone-to-zone matrix.

3. **Build OD matrices** - Aggregate trip counts by origin zone and destination zone. Produce separate matrices for:
   - **Time of day** (AM peak 6-9, midday 9-15, PM peak 15-18, evening 18-22, night 22-6)
   - **Day of week** (weekday vs. Saturday vs. Sunday)
   - **Season** (January vs. July vs. September)

4. **Identify top OD pairs** - Rank zone pairs by trip volume. The top 20 pairs will reveal the dominant travel corridors.

5. **Gap analysis** - Overlay the top OD pairs onto the existing route network. Flag any high-demand pairs that require 2+ transfers or have no direct service.

### Data Required

- `trips_*.csv` (all 92 days)
- Barrie Transit route network / GTFS shapes for overlay

### Output Deliverables

- Zone-to-zone OD matrix (spreadsheet)
- Top 25 OD pairs ranked by volume
- Map showing desire lines (thickness = demand) overlaid on route network
- Gap report: high-demand corridors not served by direct routes

### Benefits for the Agency

- **Evidence-based route planning** - Move beyond anecdotal ridership assumptions to data-driven corridor identification
- **New route justification** - If a corridor like "South Barrie residential to Georgian College" consistently shows 200+ daily trip requests with no direct route, that's a compelling case for service change
- **Seasonal service adjustment** - Quantify how OD patterns shift between school year (September) and summer (July) to justify seasonal schedule modifications
- **Equity analysis** - Identify neighbourhoods generating high demand but receiving poor connectivity, supporting equity-focused service design
- **Strategic plan input** - OD data directly feeds into long-range transit network planning and master plan updates

### Level of Effort

- **Data processing:** 2-3 days (scripting zone assignment and matrix generation)
- **Analysis & mapping:** 2-3 days
- **Ongoing:** Can be automated to refresh with each new data export

---

## 2. Route Performance Scoring

### What It Is

Build a composite performance scorecard for each Barrie Transit route that models rider engagement as a **conversion funnel** — from passive visibility through active trip planning — and flags underperformers with a single comparable number.

### Existing Infrastructure

Much of the data pipeline for this use case already exists:

- **`RouteMetricDaily`** (`transitAppTypes.ts`) — per-route, per-day metrics (views, taps, suggestions, GO trips) already parsed from `lines_*.csv`
- **`RouteMetricSummary`** (`transitAppTypes.ts`) — pre-aggregated totals and daily averages per route (totalViews, totalTaps, totalSuggestions, totalGoTrips, avgDailyViews, avgDailyTaps, daysActive)
- **`RouteLegSummary`** (`transitAppTypes.ts`) — trip leg counts, unique trips, and top boarding/alighting stops per route, aggregated from all leg files
- **`aggregateTransitAppData()`** (`transitAppAggregator.ts`) — orchestrator that produces all the above from parsed CSV data
- **`TransitAppDashboard`** (`components/Analytics/TransitAppDashboard.tsx`) — existing dashboard component that renders route metrics

The implementation below extends these types and components rather than rebuilding from scratch.

### Implementation Steps

#### Step 1: Conversion Funnel Ratios

Model Transit App engagement as a four-stage funnel. Each stage measures a successively deeper level of rider intent:

| Stage | Metric | What It Measures |
|---|---|---|
| **Awareness** | `nearby_views` | Route appeared on screen when user was nearby |
| **Interest** | `nearby_taps` | User tapped route for details |
| **Consideration** | `tapped_routing_suggestions` | Route appeared in a tapped itinerary |
| **Action** | `go_trips` | Route was part of a completed GO connection |

Calculate three conversion ratios per route per month:

- **View → Tap Rate** = `nearby_taps / nearby_views` (interest conversion)
- **Tap → Suggestion Rate** = `tapped_routing_suggestions / nearby_taps` (planning follow-through)
- **Suggestion → GO Rate** = `go_trips / tapped_routing_suggestions` (regional integration)

**Minimum sample threshold:** Exclude any route-month with fewer than 30 total views from ratio calculations to avoid noisy percentages on low-activity routes.

#### Step 2: Composite Performance Score

Compute a single 0-100 score per route per month using weighted percentile ranks:

```
Score = 0.30 × rank_pct(View→Tap Rate)
      + 0.25 × rank_pct(Tap→Suggestion Rate)
      + 0.20 × rank_pct(go_trips)
      + 0.15 × rank_pct(totalLegs from RouteLegSummary)
      + 0.10 × rank_pct(Suggestion→GO Rate)
```

Where `rank_pct(metric)` is the route's percentile rank (0-100) among all routes for that metric in the given month.

**Weight rationale:** View→Tap and Tap→Suggestion carry the most weight because they measure *conversion efficiency* — a route with moderate volume but high follow-through is performing better than one with high views but no engagement. Raw GO trip count gets its own weight to capture absolute regional integration volume.

#### Step 3: Trend Direction (Month-over-Month)

Using the existing `RouteMetricDaily` data, compute monthly averages and classify each route's trajectory:

- **Rising** — current month composite score > previous month by ≥ 5 points
- **Stable** — within ± 5 points
- **Declining** — current month < previous month by ≥ 5 points

For seasonal comparisons (Jan → Jul → Sep), calculate the same metrics per month and compare. Handle routes missing from a month (e.g., seasonal routes not operating in July) by marking them "N/A" rather than zero.

#### Step 4: Day-of-Week Dimension

Split `RouteMetricDaily` into weekday (Mon-Fri) vs. weekend (Sat-Sun) averages per route. Some routes may score well on weekdays but poorly on weekends (commuter-oriented), or vice versa. Report both profiles in the scorecard.

#### Step 5: Normalization by Service Level

Raw view counts are influenced by how many trips a route operates. A route running every 15 minutes will naturally accumulate more views than a route running every 60 minutes. Normalize where useful:

- **Views per scheduled trip** = `nearby_views / scheduled_trips_per_day` (requires GTFS trip count for the route)
- **Taps per revenue hour** = `nearby_taps / daily_revenue_hours` (if available)

This separates *rider interest per unit of service* from *raw volume driven by frequency*.

#### Step 6: Identify "Routes to Watch"

A route qualifies for the watch list when **both** conditions are met:

1. **Below median** — composite score is below the median of all routes for the most recent month
2. **Declining trend** — trend direction is "Declining" (month-over-month drop ≥ 5 points)

Routes meeting only one condition are flagged as "Monitor" but not escalated.

#### Step 7: Cross-Reference with Trip Leg Data

Using the existing `RouteLegSummary` data (already computed by the aggregator), enrich the scorecard with:

- **Total trip legs** involving the route (from `tapped_trip_view_legs` + `go_trip_legs`)
- **Unique trips** — distinct `user_trip_id` values the route appeared in
- **Top boarding/alighting stops** — from `RouteLegSummary.topBoardingStops` / `topAlightingStops`

This adds journey-level depth beyond the `lines` engagement metrics.

### Data Required

- `lines_*.csv` (all 92 days) — already parsed into `RouteMetricDaily` / `RouteMetricSummary`
- `tapped_trip_view_legs_*.csv` and `go_trip_legs_*.csv` — already aggregated into `RouteLegSummary`
- Barrie Transit GTFS `trips.txt` (for normalization by scheduled trips, Step 5)

### Output Deliverables

**Route Scorecard Table** — one row per route, with these columns:

| Column | Source |
|---|---|
| Route | `RouteMetricSummary.route` |
| Avg Daily Views | `RouteMetricSummary.avgDailyViews` |
| View → Tap % | Calculated ratio |
| Tap → Suggestion % | Calculated ratio |
| Suggestion → GO % | Calculated ratio |
| Total Trip Legs | `RouteLegSummary.totalLegs` |
| Composite Score (0-100) | Weighted percentile formula |
| Trend (↑ ↔ ↓) | Month-over-month direction |
| Weekday Score | Composite using weekday-only data |
| Weekend Score | Composite using weekend-only data |

**Additional deliverables:**
- Seasonal comparison chart per route (Jan / Jul / Sep composite scores side by side)
- "Routes to Watch" list with quantified criteria (below median + declining)
- Conversion funnel visualization per route (bar chart: Views → Taps → Suggestions → GO Trips)

### Benefits for the Agency

- **Objective route evaluation** — moves beyond ridership counts to measure rider intent. A route with high views but low taps tells a different story than one with moderate views but high follow-through
- **Service investment targeting** — focus frequency improvements or marketing on routes where riders show interest but don't convert to trips
- **Quantified underperformance** — "Routes to Watch" uses explicit criteria (below median + declining), not subjective judgment
- **Weekday/weekend insight** — separates commuter performance from off-peak, supporting differentiated service strategies
- **Seasonal resource allocation** — if a route's composite score drops 40% in July, that's evidence for reduced summer service
- **Normalized comparison** — views-per-trip normalization prevents high-frequency routes from unfairly dominating the ranking
- **Council communication** — a single 0-100 score per route is immediately understandable by non-technical audiences
- **Year-over-year tracking** — establish a baseline now; repeat annually to measure whether service changes improve engagement

### Level of Effort

- **New code:** ~0.5 days — extend `RouteMetricSummary` with ratio fields and composite score calculation; add trend classification. Most data is already parsed and aggregated.
- **Dashboard integration:** ~0.5 days — add scorecard table and funnel chart to `TransitAppDashboard`
- **GTFS normalization (optional):** ~0.5 days — pull trip counts from GTFS for per-trip normalization
- **Analysis write-up:** 1 day
- **Ongoing:** Fully automatable with each new data import

---

## 3. Transfer & Connection Analysis

### What It Is

Identify which transfers riders are planning in Transit App, quantify their volume by route pair and time of day, and populate Scheduler 4's Connection library with evidence-based targets.

**Important framing:** This data shows *planned itineraries* — trips the app suggested or that users tapped through. It does not capture actual transfers made at the stop or real-world wait times. Transfer volumes indicate rider intent and relative importance, not observed performance.

### Implementation Steps

1. **Build trip chains from leg data** - Combine `go_trip_legs_*.csv` and `tapped_trip_view_legs_*.csv`, order legs by timestamp within `user_trip_id`, and deduplicate repeated itinerary checks so each journey is counted once.

2. **Normalize routes and stops** - Map route names and stop names from leg data to GTFS `route_id` and `stop_id` using a name-matching lookup table. This prevents transfer volumes from being split by naming inconsistencies (e.g., "Barrie Transit Route 1" vs. "1").

3. **Extract transfer events** - For each adjacent transit-leg pair within a trip chain, create a transfer record:
   - `from_route`, `to_route`, `transfer_stop`, `time_band`, `day_type`, `season`
   - Transfer type: Barrie-to-Barrie, Barrie-to-GO, GO-to-Barrie, Barrie-to-regional

4. **Aggregate transfer volumes** - Count transfer events by route pair, stop, time band (AM peak / midday / PM peak / evening), day type (weekday / Saturday / Sunday), and season (Jan / Jul / Sep). This is the core output — a volume matrix showing which connections riders plan most.

5. **Identify GO-linked transfers** - Isolate all transfer events involving GO Transit. Rank by volume and time band. This directly supports Metrolinx coordination conversations and GO connection targets in Scheduler 4.

6. **Rank and select connection targets** - From the top transfer pairs by volume, select candidates for Scheduler 4's Connection library:
   - `from_route_id`, `to_route_id`, `location_stop_id`
   - Time bands where transfer volume concentrates
   - Priority tier (high / medium / low) based on volume rank
   - Flag GO-linked transfers as high priority by default

### Data Required

- `go_trip_legs_*.csv` (all 92 days)
- `tapped_trip_view_legs_*.csv` (all 92 days)
- Barrie Transit GTFS (`stops.txt`, `routes.txt`) for ID normalization

### Output Deliverables

- **Transfer volume matrix** — route-pair x stop x time-band, ranked by volume
- **Top 15 transfer pairs** — with volume, stop location, peak time bands, and transfer type
- **GO transfer summary** — GO-linked transfers ranked by volume and time, ready for Metrolinx discussion
- **Scheduler 4 connection targets** — import-ready target set for the Connection library

### What This Data Cannot Tell You

| Question | Why Not | What You Need Instead |
|---|---|---|
| Are riders actually making these transfers? | Data shows planned itineraries, not observed boardings | APC boarding/alighting data |
| How long do riders actually wait? | App shows *scheduled* connection times, not real wait | AVL on-time performance data |
| Are connections being missed? | No real-time arrival/departure data in this dataset | AVL + APC matched data |
| What's the true transfer demand? | App users are a subset of all riders | APC transfer counts at key stops |

This analysis identifies *which connections matter most to app users* and provides a strong starting signal. Validating connection reliability requires AVL/APC data as a future layer.

### Benefits for the Agency

- **Evidence-based connection targets** — Scheduler 4 connection targets are populated from observed rider planning patterns, not guesswork
- **GO coordination evidence** — Quantified, time-specific GO transfer volumes support Metrolinx schedule alignment requests
- **Seasonal awareness** — Transfer patterns shift between school year and summer; separate volumes prevent overfitting to one period
- **Proportionate to data quality** — Focuses on what app data reliably shows (volume and patterns) without overreaching into reliability claims that require AVL/APC

### Level of Effort

- **Data engineering (trip chains, normalization, dedup):** 2 days
- **Volume analysis + GO summary + Scheduler 4 targets:** 1-2 days
- **Initial total:** 3-4 working days
- **Ongoing refresh:** 0.5 day per data export

---

## 4. Service Span & Frequency Gap Analysis

### What It Is

Chart where trip planning demand appears but scheduled service is absent or thin, producing visual demand-vs-supply profiles per route that directly support service change proposals and strategic plan inputs.

**Important framing:** "Demand" here means *app trip planning requests* — a directional signal of when people want to travel, not a census of all riders. These charts show relative patterns (where demand concentrates, where it drops off) rather than absolute ridership numbers.

### Implementation Steps

1. **Build a demand-by-hour table** - Standardize `trips_*.csv` timestamps to service day, deduplicate rapid re-plans (same user + similar OD within 5 minutes), and bin by hour. Classify each record by day type (weekday / Saturday / Sunday) and season (Jan / Jul / Sep).

2. **Build GTFS supply profiles** - From `stop_times.txt` and `calendar*.txt`, compute per-route: first trip, last trip, scheduled headway, and trips-per-hour by time band. This is the "supply" side of the comparison.

3. **Produce demand-vs-supply charts** - For each route, generate an overlay chart:
   - **X-axis:** Hour of day (5 AM to 1 AM)
   - **Y-axis (left):** Trip planning requests per hour (bar chart, 3 seasons overlaid or side-by-side)
   - **Y-axis (right):** Scheduled departures per hour (line)
   - **Shaded zones:** Hours outside service span (before first trip, after last trip)

   These charts are the primary deliverable — they visually answer "when do people want to travel vs. when do we run service?"

4. **Identify gap types** - From the charts, flag:
   - **Span-start gaps** — demand appearing before first scheduled trip (e.g., 5:30 AM requests but first bus at 6:15 AM)
   - **Span-end gaps** — demand persisting after last scheduled trip
   - **Weekend gaps** — weekday-like demand patterns on Saturdays/Sundays with reduced service
   - **Seasonal shifts** — time bands where demand moves significantly between Jan, Jul, and Sep

5. **Compile a gap register** - Summarize all identified gaps in a table:

   | Route | Gap Type | Day Type | Time Band | Season | App Requests/Hour | Scheduled Trips/Hour | Notes |
   |---|---|---|---|---|---|---|---|

6. **Contextualize with route engagement data** - Cross-reference gap time bands against `lines_*.csv` view/tap data (from UC2) to distinguish between "people search but service is absent" vs. "service exists but engagement is low."

### Data Required

- `trips_*.csv` (all 92 days) for demand timestamps
- Barrie Transit GTFS (`routes.txt`, `trips.txt`, `stop_times.txt`, `calendar*.txt`)
- `lines_*.csv` (optional, for cross-reference with route engagement)

### Output Deliverables

- **Demand-vs-supply charts** — one per route, 3 seasons overlaid, showing trip requests against scheduled departures by hour. These are the exhibit you drop into a staff report or strategic plan chapter.
- **Gap register** — tabular summary of all identified gaps with route, type, time band, and season
- **Span gap summary** — pre-first-trip and post-last-trip demand counts per route, quantifying the "missed window" on each end
- **Weekend comparison** — weekday vs. Saturday vs. Sunday demand profiles per route

### What This Data Cannot Tell You

| Question | Why Not | What You Need Instead |
|---|---|---|
| How many riders would use an added trip? | App requests are intent, not guaranteed boardings | APC data from comparable routes/times |
| Is the frequency adequate for current riders? | App data doesn't capture riders who don't use the app | APC load factor data |
| What's the cost-benefit of adding service? | Revenue and operating cost data not in this dataset | Financial model + APC |

The demand-vs-supply charts are a strong *directional signal* for where gaps exist. Quantifying the business case for filling those gaps requires ridership and cost data as a second layer.

### Benefits for the Agency

- **Visual evidence for service change proposals** — demand-vs-supply charts are immediately understandable by Council, finance, and operations audiences
- **Defensible span arguments** — quantified pre-first-trip and post-last-trip demand strengthens proposals for earlier/later service
- **Seasonal planning input** — separate Jan/Jul/Sep profiles prevent overfitting service to one period
- **Strategic plan exhibit** — charts can go directly into the 2027-2032 Strategic Plan as evidence for service level targets
- **Quick production** — simple charting from existing data; no complex modeling required
- **Honest about limitations** — framed as a demand signal rather than a ridership forecast, which builds credibility with technical reviewers

### Level of Effort

- **Data preparation (timestamp cleanup, dedup, binning):** 1 day
- **GTFS supply profiles + chart generation:** 1-2 days
- **Gap register + write-up:** 0.5-1 day
- **Initial total:** 3-4 working days
- **Ongoing refresh:** 0.5 day per data export

---

## 5. Stop-Level Demand Proximity Analysis

### What It Is

Map where app users search for trips relative to existing stop locations to identify coverage gaps — places where demand clusters but no convenient stop exists nearby.

**Important framing:** Transit App data shows where people *plan trips from and to*, not where they *board and alight*. This analysis identifies spatial demand patterns near and far from stops, but it is **not a substitute for APC-based stop-level boarding data**. Stop consolidation, removal, or amenity investment decisions require actual boarding counts — this analysis provides a supplementary demand layer, not the primary evidence.

### What This Analysis IS vs. IS NOT

| This Analysis IS | This Analysis IS NOT |
|---|---|
| A coverage gap finder — where do people search far from stops? | A boarding count — how many people use each stop |
| A demand proximity map — where does trip planning cluster? | A stop consolidation tool — which stops to remove |
| A signal for potential new stop locations | An amenity prioritization framework |
| A rough activity ranking of stops mentioned in itineraries | A replacement for APC data |

### Implementation Steps

1. **Map trip origins to nearest stops** - For each trip in `trips_*.csv`, compute the walk distance from the origin lat/lon to the nearest GTFS stop. Do the same for destinations. This creates a demand-proximity dataset showing how far users are from the network when they search.

2. **Identify "far from stops" demand clusters** - Filter for trip origins/destinations more than 400m from any stop (a standard walk-distance threshold). Cluster these points to find areas with repeated demand but poor stop coverage. These are potential coverage gaps.

3. **Build a rough stop mention ranking** - From `go_trip_legs_*.csv` and `tapped_trip_view_legs_*.csv`, count how often each stop name appears as a boarding or alighting point in planned itineraries. Normalize stop names to GTFS `stop_id` where possible.

   **Caveat:** This ranks stops by *how often they appear in app itineraries*, not by actual boardings. It is useful as a relative signal (which stops appear most in planned trips) but should not be cited as boarding data.

4. **Produce a coverage gap map** - Plot the "far from stops" demand clusters on a map with the existing stop network and route shapes overlaid. Annotate clusters with trip count and predominant time bands.

5. **Cross-reference with OD analysis (UC1)** - Check whether coverage gap clusters align with high-demand OD corridors that lack direct service. Convergence between UC1 and UC5 strengthens the case for network attention.

### Data Required

- `trips_*.csv` (all 92 days) for origin/destination coordinates
- `go_trip_legs_*.csv` and `tapped_trip_view_legs_*.csv` (for stop mention ranking)
- Barrie Transit GTFS (`stops.txt`, `shapes.txt`)

### Output Deliverables

- **Coverage gap map** — clusters of demand >400m from any stop, annotated with trip count and time bands
- **"Far from stops" cluster list** — tabular summary with location, trip count, nearest existing stop, and distance
- **Rough stop activity ranking** — stops ranked by itinerary mention frequency (with clear caveat that this is not boarding data)
- **Coverage gap + OD corridor overlay** — combined map showing where gaps align with high-demand corridors from UC1

### Complementary Data Needed for Deeper Stop Decisions

This analysis answers "where is demand far from stops?" but the following questions require additional data sources:

| Decision | Required Data | Source |
|---|---|---|
| Which stops to consolidate or remove | Actual boarding/alighting counts per stop | APC data |
| Where to invest in amenities (shelters, pads, lighting) | Boarding volume + existing amenity inventory | APC + asset management system |
| Stop spacing optimization | Boarding counts + runtime impact modeling | APC + AVL |
| Accessibility compliance gaps | Physical stop infrastructure audit | Field survey / accessibility audit |

When APC data becomes available, it can be layered onto this analysis to create a complete stop decision framework. Until then, this analysis provides the demand-side spatial signal.

### Benefits for the Agency

- **Identifies coverage blind spots** — reveals where people want to travel but can't easily reach the network
- **Supports new stop or route extension proposals** — demand clusters far from stops are evidence for network expansion
- **Cross-validates OD analysis** — convergence between UC1 corridors and UC5 clusters strengthens service change cases
- **Honest scope** — framed as a coverage gap tool, not a stop removal tool, which prevents misuse and maintains credibility
- **Quick to produce** — simple spatial analysis using coordinates and stop locations

### Level of Effort

- **Trip-to-stop proximity mapping:** 1 day
- **Cluster identification + stop ranking + maps:** 1-2 days
- **Initial total:** 2-3 working days
- **Ongoing refresh:** 0.5 day per data export

---

## 6. Rider Demand Heatmaps

### What It Is

Produce static, Council-ready heatmaps showing where Transit App activity concentrates by time of day and season, overlaid on the route network. These maps are visual exhibits for staff reports, strategic plan chapters, and public engagement materials.

**Important framing:** Location data comes from the subset of app users who opted in to location sharing — a further subset of an already self-selected group. The maps show *relative spatial concentration* of app activity, not absolute ridership density. They are best used to identify patterns (where demand clusters, how it shifts seasonally) rather than to make claims about specific ridership volumes at specific locations.

### Implementation Steps

1. **Clean and filter location data** - Remove outliers (points outside Barrie city boundary), clip to the service area, and drop records with invalid coordinates. This is the largest dataset (~25K rows/day, ~2.3M total across 92 days), so filtering reduces noise significantly.

2. **Debias high-frequency pings** - Cap repeated pings from the same user within a rolling time window (e.g., max 1 point per user per 15 minutes). Without this step, a single user sitting at a stop for 30 minutes generates more "demand" than 10 users passing through. Debiasing ensures the heatmap reflects *where different people are*, not *how long one phone reported*.

3. **Generate heatmaps by time band and season** - Using ArcGIS point density (or kernel density estimation), produce a set of static maps:

   | Map | Time Band | Day Type | Season |
   |---|---|---|---|
   | Weekday AM Peak | 6:00-9:00 | Mon-Fri | Jan / Jul / Sep |
   | Weekday Midday | 9:00-15:00 | Mon-Fri | Jan / Jul / Sep |
   | Weekday PM Peak | 15:00-18:00 | Mon-Fri | Jan / Jul / Sep |
   | Weekday Evening | 18:00-22:00 | Mon-Fri | Jan / Jul / Sep |
   | Saturday All Day | 6:00-22:00 | Saturday | Jan / Jul / Sep |
   | Sunday All Day | 6:00-22:00 | Sunday | Jan / Jul / Sep |

   Use a **consistent colour scale** across all maps so that seasons and time bands are visually comparable.

4. **Overlay route network** - Add GTFS route shapes and stop locations on each map so the reader can see demand relative to existing service. Use the city boundary, major roads, and key landmarks (Georgian College, RVH, Downtown Terminal, GO station) as basemap context.

5. **Create seasonal comparison maps** - Produce side-by-side or delta maps for key comparisons:
   - **Jan vs. Sep** — winter baseline vs. fall/school (the two highest-demand periods)
   - **Jul vs. Sep** — summer drop-off vs. fall return
   - Highlight areas where demand shifts materially between seasons (e.g., Georgian College corridor in Jul vs. Sep)

6. **Annotate key findings** - On 2-3 summary maps, add callout boxes highlighting notable patterns: demand clusters far from routes, seasonal hotspots, areas where demand is strong but service frequency is low. These annotated versions are the ones that go into reports.

### Data Required

- `locations_*.csv` (all 92 days)
- Barrie Transit GTFS (`shapes.txt`, `stops.txt`) for route overlay
- City of Barrie boundary shapefile and major roads basemap (available from city GIS)

### Output Deliverables

- **Heatmap atlas** — PDF set of ~18 maps (6 time-band/day-type combinations x 3 seasons), all on consistent colour scale. Print-ready for staff reports and strategic plan appendices.
- **Seasonal comparison maps** — side-by-side Jan/Jul/Sep for weekday AM and PM peaks, showing where demand shifts
- **Annotated summary maps** — 2-3 maps with callout annotations highlighting key spatial patterns, suitable for Council presentation slides
- **Source data file** — debiased, filtered location points as a GIS layer for future re-use by planning staff

### What This Data Cannot Tell You

| Question | Why Not | What You Need Instead |
|---|---|---|
| How many riders are at each location? | Location opt-in is a small, biased subset | APC data + ridership surveys |
| Does demand justify a new route? | App activity shows interest, not committed ridership | Ridership forecasting model + APC |
| Where are non-app-users traveling? | Only location-sharing app users are captured | Comprehensive travel survey |

The heatmaps show *where app users concentrate* — a useful directional signal, especially for relative comparisons across time and space. They should be presented as "Transit App activity patterns" rather than "ridership density."

### Benefits for the Agency

- **Strongest visual product in the toolkit** — heatmaps are immediately understandable by Council, media, public, and cross-department stakeholders without explanation
- **Strategic plan exhibit** — maps go directly into the 2027-2032 Strategic Plan as evidence for spatial service priorities
- **Seasonal storytelling** — side-by-side seasonal maps make a compelling case for differentiated service levels (summer vs. school year)
- **Cross-department utility** — Planning, Engineering, and Development Services can use the same maps for land-use coordination
- **Reusable basemap investment** — the debiased location layer and map templates are reusable for future data exports with minimal effort
- **Appropriate for the data** — heatmaps are well-suited to showing relative spatial patterns, which is exactly what biased app data does well. No false precision.

### Level of Effort

- **Data cleaning + debiasing:** 1 day
- **Heatmap generation + route overlay (ArcGIS):** 1-2 days
- **Seasonal comparison + annotation + PDF export:** 0.5-1 day
- **Initial total:** 2-3 working days
- **Ongoing refresh:** 0.5 day per data export (reuse map templates, swap data)

---

## 7. GO Transit Integration Business Case

### What It Is

Quantify how strongly Barrie Transit enables GO access, measure where GO connections succeed or fail, and convert that evidence into funding, coordination, and scheduling actions.

### Implementation Steps

1. **Build canonical intermodal journey chains** - Combine `go_trip_legs_*.csv` and `tapped_trip_view_legs_*.csv`, normalize service/route names to GTFS IDs, and deduplicate repeat itinerary checks.

2. **Identify GO-linked transfer events** - Extract all Barrie-to-GO and GO-to-Barrie transfers with station/stop IDs and time bands.

3. **Classify trip roles** - Label each GO-linked journey as first-mile, last-mile, or dual transfer pattern; track which Barrie routes and stations are involved.

4. **Measure GO integration volumes** - Produce daily/monthly counts by station, route, day type, and season, and reconcile with `lines_*.csv` `go_trips` as a validation signal.

5. **Compute connection reliability KPIs** - For each key route-station pair, calculate p50/p90 transfer wait, `% <= target buffer`, and `% missed/excessive` by time band.

6. **Estimate rider impact of misalignment** - Quantify passenger-minutes lost and trips exposed to high miss risk where connection buffers are inadequate.

7. **Create GO Dependency Index** - Rank Barrie routes by their contribution to GO access using volume, reliability sensitivity, and strategic station coverage.

8. **Produce coordination and funding scenarios** - Build options (retime local departures, protect key connections, targeted span extensions) with estimated rider benefit and operating implications.

9. **Link to Scheduler 4** - Export high-priority GO connection targets into the Connections library with priority tier, protected time bands, and hold policy guidance.

### Data Required

- `go_trip_legs_*.csv` (all 92 days)
- `tapped_trip_view_legs_*.csv` (all 92 days)
- `lines_*.csv` (go_trips column)
- Barrie Transit and GO GTFS/schedules for connection timing analysis
- Optional but valuable: on-time performance data for attribution of schedule vs operations issues

### Output Deliverables

- GO integration scorecard (volumes, reliability, dependency index)
- First-mile vs last-mile breakdown by route, station, and time band
- Priority GO connection list with protected target windows for Scheduler 4
- Misalignment impact report (passenger-minutes lost, miss-risk hotspots)
- Funding/coordination scenario brief suitable for Metrolinx and Council discussion

### Benefits for the Agency

- **Stronger provincial funding narrative** - Evidence ties local service decisions directly to regional mobility outcomes
- **Better Metrolinx coordination asks** - Time-specific reliability data supports concrete schedule alignment requests
- **Risk-aware local planning** - GO Dependency Index shows which local routes are high consequence for regional access
- **Direct Scheduler 4 impact** - GO-critical transfers become protected constraints, not informal assumptions
- **Defensible budget decisions** - Scenarios quantify rider benefit per operating resource
- **Regional positioning** - Reinforces Barrie Transit as an essential first/last-mile partner, not just a municipal network

### Level of Effort

- **Data engineering & integration model:** 3-4 days
- **Reliability/dependency analysis + scenarios:** 3-4 days
- **Business case packaging + Scheduler 4 export:** 1-2 days
- **Initial total:** 7-10 working days
- **Ongoing refresh:** 1 day quarterly; full rerun when GO or local schedules materially change

---

## 8. App Adoption & Growth Tracking

### What It Is

Analyze the `users.csv` data to understand Transit App usage trends, correlate them with service changes or external events, and establish benchmarks for future growth tracking.

### Implementation Steps

1. **Trend analysis** - Plot daily active users, sessions, and downloads over the 92-day dataset. Calculate:
   - Weekday vs. weekend averages
   - Month-over-month growth rates
   - Sessions per user (engagement intensity)
   - Downloads-to-active-user ratio (retention proxy)

2. **Day-of-week patterns** - Calculate average metrics by day of week. Transit apps typically show Mon-Fri peaks with weekend valleys; measure the ratio.

3. **Seasonal comparison:**
   - January average vs. July average vs. September average
   - Identify whether school start (September) drives a usage spike
   - Holiday impacts (Jan 1, Jul 1 visible in the data)

4. **Event correlation** - If dates of service changes, marketing campaigns, or disruptions are known, overlay them on the usage timeline to look for impact.

5. **Benchmarking** - Transit App may provide peer city comparison data. If available, benchmark Barrie's adoption rate (users per capita, sessions per user) against similar-sized Ontario cities.

6. **Growth projection** - Based on observed trends, project forward to estimate future data volumes and app adoption trajectory.

### Data Required

- `users.csv` (92 rows)
- Barrie population data for per-capita calculations
- Service change dates (if available) for correlation

### Output Deliverables

- Usage trend charts (daily, weekly average, monthly average)
- Day-of-week usage profile
- Seasonal comparison summary
- Key metrics dashboard (average weekday users, sessions/user, download rate)
- Growth projection estimate

### Benefits for the Agency

- **Marketing ROI measurement** - If the agency promotes the Transit App, this data measures whether campaigns actually drive downloads and usage
- **Data confidence assessment** - Understanding how many riders use the app (vs. total ridership) helps calibrate how representative the trip and location data is. If app users represent 15% of riders, the OD analysis captures that segment
- **Service change impact measurement** - Spikes or drops in app usage after schedule changes can be an early signal of rider response, faster than waiting for monthly ridership reports
- **Digital strategy planning** - Trends in app adoption inform decisions about investing in real-time information, mobile ticketing, or other digital rider services
- **Council reporting** - Simple metrics like "our transit app has X daily users" are easy for elected officials to understand and communicate to constituents
- **Budget justification** - Growing app usage demonstrates growing transit engagement, supporting budget requests

### Level of Effort

- **Data processing:** 0.5 days (small dataset)
- **Analysis and charting:** 1 day
- **Report writing:** 0.5 days
- **Ongoing:** Trivially automated; each new export adds rows to the trend

---

## 9. Schedule Validation & Data Feed Audit

### What It Is

Compare the trip itineraries suggested by Transit App (from `planned_go_trip_legs_*.csv`) against the agency's published GTFS schedule to verify that the transit app is showing riders accurate information and to detect data feed issues.

### Implementation Steps

1. **Extract planned transit legs** - From `planned_go_trip_legs_*.csv`, filter for legs where `service_name` = "Barrie Transit" and `mode` = "Transit". Each leg has a start time, end time, route, and start/end stop.

2. **Match to GTFS trips** - For each planned leg, look up the corresponding GTFS trip:
   - Match on `route_short_name`, `start_stop_name`, and the closest scheduled departure time
   - Compare planned departure/arrival times against GTFS scheduled times

3. **Identify discrepancies:**
   - **Time mismatches** - Planned trip times that don't align with any scheduled trip (possible stale GTFS feed)
   - **Missing routes** - Routes in the planned data not found in GTFS (or vice versa)
   - **Stop name mismatches** - Stop names in Transit App data that don't match GTFS stop names (data quality issue)
   - **Ghost trips** - Planned legs referencing trips that don't exist in the current schedule

4. **Calculate accuracy score** - What percentage of planned legs match a real GTFS trip within 2 minutes? This is the feed accuracy rate.

5. **Check actual vs. planned** - Compare `planned_go_trip_legs` against `go_trip_legs` for the same `user_trip_id`. Did the app suggest the same itinerary that was actually followed? Discrepancies may indicate real-time detours or rider deviations.

### Data Required

- `planned_go_trip_legs_*.csv` (all 92 days)
- `go_trip_legs_*.csv` (all 92 days)
- Barrie Transit GTFS (matching the Jan/Jul/Sep 2025 service periods)

### Output Deliverables

- Feed accuracy rate (% of planned trips matching GTFS)
- List of discrepancies by type (time mismatch, missing route, stop name issue)
- Planned vs. actual journey comparison summary
- Recommendations for GTFS feed improvements

### Benefits for the Agency

- **Rider trust** - If Transit App shows wrong times, riders lose trust in both the app and the transit service. Identifying and fixing feed errors directly improves the rider experience
- **GTFS quality assurance** - Many agencies publish GTFS feeds without ongoing validation. This analysis serves as an independent audit of data feed accuracy
- **Third-party app consistency** - Transit App isn't the only consumer of GTFS data. Google Maps, Apple Maps, and other apps use the same feed. Errors found here likely affect all platforms
- **Schedule change verification** - After publishing a new GTFS feed for a schedule change, this analysis can verify the new data propagated correctly to Transit App
- **Data standards compliance** - Ensures Barrie Transit's GTFS meets the standards expected by major trip planners, which is increasingly important for provincial data-sharing mandates

### Level of Effort

- **Data processing:** 2-3 days (GTFS matching is the most complex part)
- **Analysis:** 1-2 days
- **Report and recommendations:** 1 day
- **Ongoing:** Should be run after every GTFS feed update

---

## 10. Council-Ready Reporting & Dashboards

### What It Is

Package the insights from the above analyses into professional, accessible reports and dashboards suitable for Council presentations, committee meetings, and public engagement.

### Implementation Steps

1. **Define report template** - Following municipal staff report conventions:
   - Executive summary with 3-5 key findings
   - Route-by-route performance section
   - Seasonal comparison section
   - Maps and visualizations
   - Recommendations tied to findings
   - Financial implications where applicable

2. **Build a reusable dashboard** - Create a dashboard (Excel, Power BI, or a web-based tool) that can be refreshed with each new data export. Key dashboard panels:
   - Daily/weekly ridership trend (from users.csv)
   - Route performance scorecard (from lines analysis)
   - Top OD pairs map (from trips analysis)
   - Connection performance summary (from transfer analysis)
   - Heatmap snapshot (from locations analysis)

3. **Seasonal comparison report** - A standard quarterly/tri-annual report comparing:
   - January (winter baseline)
   - July (summer/reduced service)
   - September (fall/back to school)

4. **Talking points document** - For each report, prepare a 1-page summary of key talking points that Council members can use when speaking with constituents or media.

5. **Public-facing summary** - A simplified version suitable for the agency website or social media, showing riders how their data helps improve service.

### Data Required

- Outputs from all analyses above (Use Cases 1-9)
- Council report templates / corporate branding standards

### Output Deliverables

- Quarterly Transit App Data Report (staff report format)
- Interactive dashboard (refreshable with new data)
- Council presentation deck (10-15 slides)
- 1-page talking points summary
- Public-facing infographic or web summary

### Benefits for the Agency

- **Informed decision-making** - Council members voting on transit budgets and service changes have evidence-based material instead of relying on staff verbal summaries alone
- **Public transparency** - Publishing ridership data analyses builds public trust and shows the agency is using modern tools to improve service
- **Budget advocacy** - Compelling data visualizations showing growing demand, unserved corridors, or GO Transit integration volumes support budget increase requests
- **Strategic plan alignment** - Regular reporting creates a data narrative that feeds directly into the 2027-2032 Strategic Plan development process
- **Staff efficiency** - A reusable dashboard and report template means each quarterly update takes days instead of weeks to produce
- **Media and public engagement** - Shareable maps and infographics generate positive media coverage and public interest in transit improvements
- **Peer comparison** - If peer agencies share similar data, side-by-side comparisons strengthen Barrie Transit's positioning in provincial discussions

### Level of Effort

- **Initial template and dashboard build:** 3-5 days
- **First full report:** 2-3 days
- **Subsequent quarterly updates:** 1-2 days each (once pipeline is established)
- **Council presentation prep:** 1 day per presentation

---

## Implementation Priority Matrix

| Use Case | Impact | Effort | Priority | Dependencies |
|---|---|---|---|---|
| 1. OD Demand Analysis | High | Medium | **P1** | None |
| 3. Transfer & Connection Analysis | High | Low-Medium | **P1** | GTFS stop/route ID mapping |
| 7. GO Integration Business Case | High | Medium | **P1** | Barrie + GO schedule/GTFS alignment |
| 2. Route Performance Scoring | High | Low | **P1** | None |
| 4. Service Span & Frequency Gaps | High | Low-Medium | **P2** | GTFS service calendar + stop_times |
| 6. Rider Demand Heatmaps | Medium-High | Low | **P2** | ArcGIS + city boundary basemap |
| 5. Stop-Level Demand Proximity | Medium | Low | **P2** | GTFS stop locations |
| 8. App Adoption Tracking | Low-Medium | Low | **P3** | None |
| 9. Schedule Validation | Medium | High | **P3** | GTFS matching complex |
| 10. Council Reporting | High | Medium | **P3** | Depends on 1-9 outputs |

### Recommended Phasing

**Phase 1 (Weeks 1-2):** Use Cases 1, 2, 3, 7
- These four analyses use different data files, can run in parallel, and produce the highest-impact outputs. Route scoring (UC2) is the quickest win. OD analysis (UC1) and transfer analysis (UC3) directly feed scheduling decisions. GO business case (UC7) supports external funding conversations.

**Phase 2 (Weeks 3-4):** Use Cases 4, 5, 6
- Service span charts (UC4) and demand heatmaps (UC6) are the strongest visual exhibits for the strategic plan and Council presentations. Stop proximity analysis (UC5) identifies coverage gaps. All three are lighter-weight than Phase 1 and build on its findings.

**Phase 3 (Weeks 4-6):** Use Cases 8, 9, 10
- App tracking and schedule validation are supporting analyses. Council reporting packages everything into a polished deliverable. Phase 3 is where the work becomes presentation-ready.

### Total Effort Summary

| Phase | Use Cases | Working Days |
|---|---|---|
| Phase 1 | 1, 2, 3, 7 | ~12-16 days |
| Phase 2 | 4, 5, 6 | ~7-10 days |
| Phase 3 | 8, 9, 10 | ~7-11 days |
| **Total** | **All 10** | **~26-37 days** |

Phase 2 (UC 3-6) reduced from ~25-37 days to ~10-14 days by right-sizing analyses to what Transit App data can reliably support.

---

## Data Limitations & Caveats

- **Sample bias** - Transit App users are a subset of all transit riders. The data skews toward smartphone-owning, tech-comfortable riders. It may underrepresent seniors, low-income riders, and casual users who don't use trip planners
- **Trip requests vs. actual trips** - A trip planning request in `trips_*.csv` does not guarantee the person actually took the trip. It represents intent, not ridership
- **Location data consent** - Only users who opted in to location sharing appear in `locations_*.csv`. This is a further subset of app users
- **Three-month snapshot** - January, July, and September provide good seasonal contrast but don't capture spring (April-May) or fall shoulder season (October-November)
- **No fare or ridership data** - This dataset measures app engagement, not actual boardings or fare revenue. It should complement, not replace, traditional ridership counting methods (APC, fareboxes)
- **Year-specific context** - 2025 data reflects 2025 conditions (route network, schedules, population). Conclusions should be validated against current conditions if significant changes have occurred
- **Privacy** - User IDs are anonymized UUIDs, but location data combined with trip patterns could theoretically re-identify individuals. All analysis should be presented in aggregate, never at the individual level
