# RAPTOR Engine Port — Implementation Plan

> **Design doc:** `docs/plans/2026-03-04-raptor-engine-design.md`
> **Source:** BTTP `src/services/` and `src/utils/`
> **Target:** Scheduler 4 `utils/routing/`

---

## Phase 1: Foundation Types & Pure Utilities

**Goal:** Establish the type system and port zero-dependency utility files.

### Step 1.1 — Types & Constants
- [ ] Create `utils/routing/types.ts` with all interfaces (GtfsStop, GtfsTrip, GtfsStopTime, RoutingData, Departure, Transfer, PathSegment, RaptorResult, Itinerary, Leg, WalkLeg, TransitLeg, RoutingError)
- [ ] Create `utils/routing/constants.ts` with ROUTING_CONFIG
- [ ] Verify: `npx tsc --noEmit`

### Step 1.2 — Calendar Service
- [ ] Port `calendarService.js` → `utils/routing/calendarService.ts`
- [ ] Functions: `formatGTFSDate`, `buildServiceCalendar`, `getActiveServicesForDate`, `isServiceActive`
- [ ] Drop: `getServiceStartTime`, `getServiceEndTime`, `formatSecondsToTime` (not needed for routing)
- [ ] Write `tests/routing/calendarService.test.ts`
  - Weekday service active on Monday
  - Weekend service inactive on Monday
  - calendar_dates exception type 1 (add) and type 2 (remove)
  - Date outside range returns empty set
- [ ] Verify: `npx vitest run tests/routing/calendarService.test.ts`

### Step 1.3 — Geometry Utils
- [ ] Port routing-relevant subset of `geometryUtils.js` → `utils/routing/geometryUtils.ts`
- [ ] Functions: `haversineDistance`, `pointInPolygon`, `pointInRing`
- [ ] Drop: `douglasPeuckerSimplify`, `catmullRomSmooth`, `processShapeForRendering`, `computeOverlapOffsets`, `offsetPath`, `darkenColor`, `simplifyPath`, `pathsOverlap`
- [ ] Fix: Remove hardcoded lat 44.39 from any ported function
- [ ] Write `tests/routing/geometryUtils.test.ts`
  - Known distance pairs (e.g., Terminal to Barrie North ~4.5km)
  - Point inside/outside a polygon
  - Edge case: point on polygon boundary
- [ ] Verify: `npx vitest run tests/routing/geometryUtils.test.ts`

**Commit after Phase 1.** ~400 lines. No integration risk — all standalone.

---

## Phase 2: GTFS Adapter & Routing Index

**Goal:** Read GTFS data and build the pre-computed indexes RAPTOR needs.

### Step 2.1 — GTFS Adapter
- [ ] Create `utils/routing/gtfsAdapter.ts`
- [ ] Reuse CSV parsing patterns from `studentPassUtils.ts` (loadStopTimes, loadTrips, etc.)
- [ ] Export: `loadGtfsData() → { stops: GtfsStop[], trips: GtfsTrip[], stopTimes: GtfsStopTime[], calendar, calendarDates }`
- [ ] Handle: BOM stripping, quoted fields, empty lines
- [ ] Handle: post-midnight times (HH:MM:SS where HH >= 24) → convert to seconds correctly
- [ ] Write `tests/routing/gtfsAdapter.test.ts`
  - Parses stops.txt with correct lat/lon
  - Parses stop_times.txt with post-midnight handling
  - Handles malformed rows gracefully
- [ ] Verify: `npx vitest run tests/routing/gtfsAdapter.test.ts`

### Step 2.2 — Routing Data Service
- [ ] Port `routingDataService.js` → `utils/routing/routingDataService.ts`
- [ ] Functions: `buildRoutingData`, `buildStopDeparturesIndex`, `buildRouteStopSequences`, `buildTransferGraph`, `buildTripIndex`, `buildStopIndex`, `buildStopTimesIndex`, `findNearbyStops`, `getDeparturesAfter`
- [ ] Keep: Spatial grid index (0.005° cells) for transfer graph — this is the performance win
- [ ] Write `tests/routing/routingDataService.test.ts`
  - Departures sorted by time for a given stop
  - Transfer graph links stops within 400m
  - Transfer graph does NOT link stops > 400m apart
  - Compound key "tripId_stopId" returns correct stop time
  - `getDeparturesAfter` filters by active services
- [ ] Verify: `npx vitest run tests/routing/routingDataService.test.ts`

**Commit after Phase 2.** ~550 lines. Can be validated independently — just data loading and indexing.

---

## Phase 3: Core RAPTOR Engine

**Goal:** Port the actual routing algorithm.

### Step 3.1 — RAPTOR Engine
- [ ] Port `localRouter.js` → `utils/routing/raptorEngine.ts`
- [ ] Export: `planTripLocal(options) → Promise<Itinerary[]>`
- [ ] Internal: `raptorForward`, `getNextDepartureForRouteDirection`, `getTripArrivalAtStop`, `reconstructPath`, `deduplicateResults`
- [ ] Port `RoutingError` class with typed error codes
- [ ] Drop: `raptorReverse` (add as `// TODO: implement true reverse RAPTOR` stub)
- [ ] Drop: on-demand zone checks
- [ ] Write `tests/routing/raptorEngine.test.ts` with synthetic GTFS fixtures:
  - **Direct route:** A → B → C, query A→C = 1 leg, no transfer
  - **One transfer:** Route 1 (A→B→C), Route 2 (C→D→E), query A→E = 2 legs + 1 transfer
  - **Two transfers:** Three routes chained
  - **No route found:** Disconnected stops
  - **Too close:** Origin/destination within 50m
  - **No service:** Empty active services set
  - **Multi-pass diversity:** Multiple calls exclude previous trips, return different departure times
- [ ] Verify: `npx vitest run tests/routing/raptorEngine.test.ts`

### Step 3.2 — Itinerary Builder
- [ ] Port `itineraryBuilder.js` → `utils/routing/itineraryBuilder.ts`
- [ ] Export: `buildItinerary(result, routingData, date) → Itinerary`
- [ ] Internal: `mergeSameRouteLegs`, `buildWalkLeg`, `buildTransitLeg`, `getIntermediateStops`, `getRouteInfo`
- [ ] Drop: `buildTransitLegGeometry` polyline extraction (add stub — geometry enrichment is Phase 5)
- [ ] Write `tests/routing/itineraryBuilder.test.ts`
  - Walk-only itinerary (no transit legs)
  - Single transit leg with walk to/from
  - Same-route legs get merged
  - Transfer produces walk leg between transit legs
  - Duration/distance/transfer count calculated correctly
- [ ] Verify: `npx vitest run tests/routing/itineraryBuilder.test.ts`

**Commit after Phase 3.** ~1,100 lines. The engine works end-to-end with synthetic data at this point.

---

## Phase 4: Walking Service & Integration Test

**Goal:** Add Mapbox walking directions and validate with real Barrie GTFS.

### Step 4.1 — Walking Service
- [ ] Create `utils/routing/walkingService.ts`
- [ ] Export: `getWalkingDirections(fromLat, fromLon, toLat, toLon) → Promise<WalkingDirections>`
- [ ] Export: `enrichItinerary(itinerary) → Promise<EnrichedItinerary>`
- [ ] Use Mapbox Directions API (`https://api.mapbox.com/directions/v5/mapbox/walking/`)
- [ ] Token from `import.meta.env.VITE_MAPBOX_TOKEN`
- [ ] Fallback: haversine × 1.3 buffer if API fails
- [ ] Simple in-memory `Map` cache (key = rounded coords to ~50m precision, TTL = 1 hour)
- [ ] Write `tests/routing/walkingService.test.ts`
  - Mock fetch: successful API response → returns geometry + steps
  - Mock fetch: API failure → returns fallback estimate
  - Cache hit returns cached result without fetch
- [ ] Verify: `npx vitest run tests/routing/walkingService.test.ts`

### Step 4.2 — Integration Test with Real GTFS
- [ ] Create `tests/routing/raptor.integration.test.ts`
- [ ] Uses real bundled `gtfs/*.txt` files
- [ ] Test cases:
  - Direct route: Allandale Waterfront → Terminal (Route 1)
  - One transfer: South Barrie → East Barrie via Terminal
  - No service on queried date
  - Origin outside service area (lat/lon in middle of nowhere)
- [ ] Verify: `npx vitest run tests/routing/raptor.integration.test.ts`

**Commit after Phase 4.** Engine is fully functional and validated against real data.

---

## Phase 5: Student Pass Integration

**Goal:** Replace the bespoke trip-finder in StudentPassModule with RAPTOR.

### Step 5.1 — Wire Up RAPTOR in Student Pass
- [ ] In `StudentPassModule.tsx`: import `planTripLocal` from `utils/routing/raptorEngine`
- [ ] Replace calls to bespoke trip-finding functions with RAPTOR:
  - For each stop in polygon → school stop: call `planTripLocal`
  - Collect and rank results (earliest arrival, fewest transfers)
  - Map RAPTOR `Itinerary` → existing `StudentPassResult` shape for preview compatibility
- [ ] Keep: polygon drawing, zone stop detection, school config, PDF export — all unchanged
- [ ] Delete from `studentPassUtils.ts`: the direct+transfer scanner functions (~300 lines)
  - Keep: `loadStopTimes`, `loadTrips`, stop/polygon utilities (reusable by gtfsAdapter or directly)

### Step 5.2 — Verify Student Pass Still Works
- [ ] Manual test: draw polygon in south Barrie, select Barrie North Collegiate
  - Expect: morning route(s) with ≤ 2 transfers, arriving before 8:45 AM
  - Expect: afternoon route(s) departing after 3:10 PM
- [ ] Verify transfer quality indicators still render (tight/good/ok/long)
- [ ] Verify PDF export still captures map + instructions
- [ ] Run full test suite: `npx vitest run tests/routing/ && npm run build`

**Commit after Phase 5.** Student pass is now powered by RAPTOR. Feature parity confirmed.

---

## Phase 6: Cleanup & Documentation

### Step 6.1 — Code Cleanup
- [ ] Remove any dead imports in `studentPassUtils.ts`
- [ ] Verify no circular dependencies in `utils/routing/`
- [ ] Run `npm run build` — clean build, no warnings

### Step 6.2 — Update Project Docs
- [ ] Add `utils/routing/` to Danger Zones table in `.claude/CLAUDE.md`
- [ ] Add RAPTOR section to `docs/ARCHITECTURE.md` (if exists) or `.claude/context.md`
- [ ] Update `MEMORY.md` with RAPTOR routing patterns

**Final commit.** Project is clean and documented.

---

## Phase Summary

| Phase | What | ~Lines | Risk | Depends On |
|---|---|---|---|---|
| 1 | Types, calendar, geometry | 400 | Low | Nothing |
| 2 | GTFS adapter, routing indexes | 550 | Low | Phase 1 |
| 3 | RAPTOR engine, itinerary builder | 1,100 | Medium | Phase 2 |
| 4 | Walking service, integration tests | 250 | Low | Phase 3 |
| 5 | Student pass integration | -300 (net delete) | Medium | Phase 4 |
| 6 | Cleanup & docs | 50 | Low | Phase 5 |

**Each phase is independently committable and verifiable.** If any phase reveals issues, you can stop and reassess without losing prior work.

---

## Reference: BTTP Source Files

| BTTP File | Lines | Scheduler 4 Target |
|---|---|---|
| `src/services/localRouter.js` | 607 | `utils/routing/raptorEngine.ts` |
| `src/services/routingDataService.js` | 415 | `utils/routing/routingDataService.ts` |
| `src/services/itineraryBuilder.js` | 525 | `utils/routing/itineraryBuilder.ts` |
| `src/services/calendarService.js` | 245 | `utils/routing/calendarService.ts` |
| `src/utils/geometryUtils.js` | 538 | `utils/routing/geometryUtils.ts` (subset) |
| `src/config/constants.js` | 222 | `utils/routing/constants.ts` (ROUTING_CONFIG only) |
| `src/services/walkingService.js` | 557 | `utils/routing/walkingService.ts` (rewritten for Mapbox) |
