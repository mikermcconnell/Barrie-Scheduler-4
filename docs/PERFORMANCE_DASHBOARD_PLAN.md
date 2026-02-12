# Performance Dashboard — Project Plan

## Context

Barrie Transit currently pays **$30K+/year** for Transify, an analytics vendor that provides OTP and ridership dashboards from the same STREETS Datawarehouse data. This project **replaces Transify** with a fully integrated, customized Performance Dashboard workspace inside Scheduler 4.

**Why build instead of buy:**
- Eliminates $30K+/year recurring vendor cost
- Integrates performance data with scheduling tools (act on insights immediately)
- Customizable views that Transify doesn't offer (connection analysis, load profiles tied to schedule changes)
- Full data ownership — team-scoped, Firebase-backed, no vendor lock-in
- Day-type separation (weekday/Saturday/Sunday) across all views

**Key questions the dashboard answers:**
1. Which routes are consistently late? (OTP trends by route)
2. Where is ridership growing/declining? (ridership trends over time)
3. How loaded are our buses? (load profiles by route/stop)
4. Are we meeting GO and inter-route connections? (connection reliability)

**Audience:** All Barrie Transit staff (team-wide access via existing auth), with live dashboard view for Transit Manager.

---

## Data Source

**STREETS Datawarehouse** on MVT's SQL Server, accessed via ODBC DSN "STREETSDW".

- ~36,000 records/day, ~7MB CSV
- 35 fields per stop-event record (see schema below)
- 12 routes: NORTH LOOP, RED, BLUE, GEORGIAN MALL, BARRIE SOUTH GO, DUNLOP, PARK PLACE, EXPRESS, GROVE, BEAR CREEK, RVH/YONGE, Crosstown/Essa
- Directions: CW, CCW, N, S
- Day types: DAY_OF_WEEK, SATURDAY, SUNDAY
- **InBetween** flag distinguishes actual stop arrivals from between-stop GPS pings (must filter for OTP)
- **TimePoint** flag marks designated timing points

**Route name mapping:** Mike will provide STREETS name → Barrie Transit route number mapping (e.g., NORTH LOOP → Route 10). Dashboard will display route numbers with STREETS names as secondary labels.

---

## Architecture Overview

```
MVT LAN (Daily 5am)          Firebase                     Browser
┌──────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│ Scheduled Task   │    │ Cloud Function       │    │ Performance         │
│ SQL Query → CSV  │───>│ Parse → Aggregate    │───>│ Dashboard           │
│ Upload to        │    │ → Store summary      │    │ (7 tabs)            │
│ Firebase Storage │    │ → Update metadata    │    │                     │
└──────────────────┘    │ → Cleanup >90 days   │    │ System Overview     │
                        └──────────────────────┘    │ OTP Analysis        │
Manual CSV fallback:                                │ Ridership           │
┌──────────────────┐    ┌──────────────────────┐    │ Load Profiles       │
│ Mike exports CSV │───>│ Import UI (FSM)      │    │ Route Detail        │
│ from ODBC/Excel  │    │ Parse → Aggregate    │    │ Stop Detail         │
└──────────────────┘    │ → Save to Firebase   │    │ Connections         │
                        └──────────────────────┘    └─────────────────────┘
```

**Storage strategy:**
- Raw CSV: `teams/{teamId}/performanceData/raw/{date}.csv` — 90-day rolling window
- Daily summaries: `teams/{teamId}/performanceData/daily/{date}.json` — permanent (~50-100KB each)
- Metadata: Firestore `teams/{teamId}/performanceData/metadata`
- 90 days raw ≈ 630MB, summaries ≈ 36MB/year — well within Firebase free tier for 1 team

---

## OTP Calculation Rules

| Parameter | Value |
|-----------|-------|
| **Early threshold** | > 3 min early (deviation < -180s) |
| **On-time window** | 3 min early to 5 min late (-180s to +300s) |
| **Late threshold** | > 5 min late (deviation > +300s) |
| **Default scope** | Timepoint stops only (toggle for all stops) |
| **Filter** | Exclude `InBetween === true` records |
| **Null handling** | Exclude records where `ObservedArrivalTime` is null |
| **Day types** | Always separate: Weekday / Saturday / Sunday |

---

## Phases

### Phase 1: Core Pipeline + Import + Key Dashboards

**Goal:** Working manual import with the three Transify-replacement views (OTP heatmap, ridership trends, load profiles) plus system overview.

#### New Files

| File | Purpose |
|------|---------|
| `utils/performanceDataTypes.ts` | All TypeScript interfaces (raw record, daily summary, OTP metrics, ridership metrics, metadata) |
| `utils/performanceDataParser.ts` | CSV parser for STREETS export (validate schema, parse rows, handle nulls) |
| `utils/performanceDataAggregator.ts` | Raw → daily summary aggregation engine (OTP by route/hour/stop, ridership, load profiles, trip summaries). Day-type separation built in from day 1. |
| `utils/performanceDataService.ts` | Firebase CRUD — save/load daily summaries, metadata management, 90-day cleanup. Pattern: `transitAppService.ts` |
| `components/Performance/PerformanceDashboard.tsx` | Landing page with import/workspace state machine. Pattern: `AnalyticsDashboard.tsx` |
| `components/Performance/PerformanceImport.tsx` | 5-phase FSM import UI (select → preview → processing → complete → error). Pattern: `TransitAppImport.tsx` |
| `components/Performance/PerformanceWorkspace.tsx` | Tab container with 7 tabs. Pattern: `TransitAppWorkspace.tsx` |
| `components/Performance/SystemOverviewModule.tsx` | KPI cards + trend charts (OTP%, ridership, peak load). Day-type tabs. |
| `components/Performance/OTPModule.tsx` | OTP heatmap (route × time-of-day), scatter plot, late trips table. Replaces `OTPAnalysis.tsx` mock prototype. |
| `components/Performance/RidershipModule.tsx` | Ridership trends over time (daily/weekly/monthly), route rankings, hourly distribution. |
| `components/Performance/LoadProfileModule.tsx` | Passenger load at each stop along a route (boardings/alightings/load curve). Key Transify replacement. |
| `tests/performanceDataAggregator.test.ts` | Unit tests for OTP calculation, InBetween filtering, day-type separation, load profile computation |

#### Modified Files

| File | Change |
|------|--------|
| `components/FixedRouteWorkspace.tsx` | Add `'performance'` to `FixedRouteViewMode`, add dashboard card, render `<PerformanceDashboard />` |

#### Key Reusable Patterns

| What | From | Reuse How |
|------|------|-----------|
| Tab config + navigation | `TransitAppWorkspace.tsx` | Copy tab structure pattern |
| Import FSM + dropzone | `TransitAppImport.tsx` | Copy 5-phase pattern, adapt file detection |
| Firebase save/load/cleanup | `transitAppService.ts` | Mirror for `performanceData` collection |
| MetricCard, ChartCard components | `AnalyticsShared.tsx` | Import directly — already generic |
| Recharts (Bar, Line, Scatter) | Throughout Analytics modules | Same charting library |
| xlsx library | Already in `package.json` | Use for CSV parsing (or use PapaParse if preferred) |

#### Aggregation Design (Critical)

The aggregator transforms ~36K raw records into a ~50-100KB daily summary. All breakdowns include day-type separation:

```typescript
DailySummary {
  date, dayType (weekday|saturday|sunday)
  system: { otp, ridership, vehicleCount, tripCount, wheelchairTrips }
  byRoute[]: { routeName, otp, ridership, avgDelay, tripCount, avgLoad, maxLoad }
  byHour[]: { hour, otp, boardings, alightings, avgLoad }
  byStop[]: { stopName, stopId, lat, lon, isTimepoint, otp, boardings, alightings, avgLoad }
  byTrip[]: { tripId, tripName, block, route, direction, departureTime, otp, boardings, maxLoad }
  loadProfiles: { [routeName]: { stops[]: { stopName, index, avgBoardings, avgAlightings, avgLoad } } }
  dataQuality: { totalRecords, inBetweenFiltered, missingAVL, missingAPC }
}
```

**Load profiles** (key Transify replacement feature): For each route, calculate avg boardings/alightings/running load at each stop in sequence using `RouteStopIndex`. This shows where passengers get on and off along the route — essential for service planning.

---

### Phase 2: Drill-Down Views + Connection Analysis

**Goal:** Route and stop detail pages, connection analysis for GO and inter-route transfers.

#### New Files

| File | Purpose |
|------|---------|
| `components/Performance/RouteDetailModule.tsx` | Select a route → OTP by stop (bar chart), ridership by stop, load profile chart, trip list with OTP scores |
| `components/Performance/StopDetailModule.tsx` | Select a stop → OTP trend, ridership trend, routes serving this stop, connection reliability |
| `components/Performance/ConnectionsModule.tsx` | Configure connection targets (GO station + train time, hub stop + connecting route), calculate success rate, show missed connections. Evolution of `OTPAnalysis.tsx` prototype. |

#### Connection Analysis Design

Two connection types, both using the same analysis engine:

**GO Connections:** Bus arrival at Barrie South GO / Allandale Waterfront GO vs train departure time. Config: stop name, train time (HH:MM), transfer buffer (minutes). Success = bus arrives before (train time - buffer).

**Inter-route Connections:** Bus arrival at Downtown Hub / Georgian Mall vs connecting route departure. Config: arriving route + stop, departing route + stop, buffer. Can be auto-detected from data (same stop, different routes, close timestamps).

---

### Phase 3: Automation + Council Reporting

**Goal:** Automated daily data pipeline from MVT, PDF/Excel export for annual Council reporting.

#### New Files

| File | Purpose |
|------|---------|
| `functions/src/ingestPerformanceData.ts` | Cloud Function: HTTP endpoint that accepts CSV upload, parses, aggregates, stores summary, cleans up old raw data |
| `functions/src/cleanupOldRawData.ts` | Scheduled Cloud Function: daily 6am, delete raw CSVs > 90 days |
| `scripts/mvt-upload-sample.js` | Sample Node.js script for MVT to automate daily upload (SQL query → CSV → Firebase Storage → trigger Cloud Function) |
| `components/Performance/ReportsExport.tsx` | Monthly/annual PDF + Excel export. Templates: System Summary, OTP Scorecard, Ridership Report, Route Report Card |

#### MVT Automation Flow

1. MVT scheduled task runs SQL query at 5am (Eddy's existing query, same date replacement logic)
2. Exports CSV to local file
3. Uploads CSV to Firebase Storage via `mvt-upload-sample.js` (uses Firebase Admin SDK with service account)
4. Cloud Function triggers: parse → aggregate → store summary → update metadata → cleanup
5. Error notification email to mike.mcconnell@barrie.ca on failure

**Deliverables to MVT:**
- `mvt-upload-sample.js` (working upload script)
- Firebase service account JSON (scoped to performanceData path only)
- Setup docs (install Node.js, npm install firebase-admin, configure as Windows Scheduled Task)

#### Council Report Templates

**Annual Performance Summary (PDF):**
- Cover: Barrie Transit Performance Report, date range
- Page 1: System KPIs (OTP%, total ridership, fleet utilization) with year-over-year comparison
- Page 2: Route scorecards (OTP + ridership per route, ranked)
- Page 3: Ridership trends (monthly chart)
- Page 4: Load profiles for top 3 busiest routes
- Page 5: Connection reliability summary (GO + inter-route)

**Excel Export:** Raw summary tables for further analysis (route metrics, stop metrics, trip metrics)

---

### Phase 4: Maps + Enhancements (Future)

- Stop-level OTP/ridership map (reuse `TransitAppMap.tsx` Leaflet component)
- Period comparison (this month vs last month, with delta indicators)
- Vehicle-level analysis (fleet utilization, mechanical reliability proxy)
- Real-time monitoring (if MVT can push more frequently than daily)

---

## MVT Coordination Plan

| Step | What to Do | Who | When |
|------|-----------|-----|------|
| 1 | Email Mike Laevens: request continued ODBC access + discuss automated push | Mike McConnell | Before Phase 1 |
| 2 | Provide STREETS name → route number mapping | Mike McConnell | Phase 1 start |
| 3 | Send sample upload script + Firebase credentials to MVT | Mike McConnell | Phase 3 start |
| 4 | MVT sets up scheduled task for daily upload | Mike Laevens / MVT IT | Phase 3 |
| 5 | Validate automated pipeline (1-week trial) | Both | Phase 3 |
| 6 | Decommission Transify contract | Mike McConnell + Transit Manager | After Phase 3 validated |

**Manual fallback:** Phase 1 import UI always available. If automation fails, Mike exports CSV via Excel/ODBC and uploads manually.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MVT automation delayed | Medium | Low | Manual import works from Phase 1; automation is Phase 3 |
| STREETS schema changes | Low | High | Parser validates required fields, alerts on unknown columns |
| Transify has features we miss | Medium | Medium | Mike uses Transify daily — identify gaps during Phase 1 testing |
| InBetween flag unreliable | Low | Medium | Data quality metrics in dashboard, % filtered shown |
| Large CSV parsing slows browser | Low | Medium | Web Worker for parsing (Transit App pattern), progress bar |
| Transit Manager wants different metrics | Medium | Low | Configurable views, export to Excel for custom analysis |
| Eddy's SQL query changes | Low | Medium | Document the query, store a copy in the repo |

---

## Verification Plan

**Phase 1 verification:**
1. `npx vitest run tests/performanceDataAggregator.test.ts` — OTP calculation, filtering, day-type separation
2. `npm run build` — TypeScript compiles cleanly
3. Manual test: Import Eddy's sample Excel data (36K records) via Import UI
4. Verify: System Overview shows correct KPIs, OTP module shows route × time heatmap
5. Verify: Load profile chart shows boardings/alightings/running load per stop for a selected route
6. Verify: Day-type tabs correctly separate weekday/Saturday/Sunday (sample data is weekday only — need Saturday data to fully test)
7. Compare a few metrics against Transify to validate calculation accuracy

**Phase 2 verification:**
8. Navigate all drill-down views (route detail, stop detail)
9. Configure a GO connection target, verify success rate calculation
10. Cross-check connection analysis against known GO train schedule

**Phase 3 verification:**
11. Deploy Cloud Function, trigger with test CSV upload
12. Run MVT script locally, verify end-to-end pipeline
13. Generate PDF report, review formatting and accuracy
14. Run 90-day cleanup against mock old files

---

## Success Criteria

- [ ] Dashboard shows accurate OTP% matching manual calculation from raw data
- [ ] Load profiles correctly show passenger flow along routes (validated against Transify)
- [ ] Ridership trends visible over 30+ day window
- [ ] Weekday/Saturday/Sunday views work independently
- [ ] All 12 routes display correctly with mapped route numbers
- [ ] Import UI handles 36K-record CSV without browser freeze
- [ ] Daily summary aggregates to <100KB per day
- [ ] Transit Manager can log in and view dashboard (team auth)
- [ ] PDF export produces presentation-ready Council report
- [ ] Automated pipeline delivers data daily without manual intervention (Phase 3)
- [ ] Transify contract can be cancelled after 30-day parallel operation
