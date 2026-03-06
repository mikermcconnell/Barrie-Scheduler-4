# RAPTOR Engine Port — Design Document

> **Date:** 2026-03-04
> **Status:** Approved
> **Source:** BTTP (Barrie Transit Trip Planner) `localRouter.js` + supporting files

---

## Summary

Port BTTP's production RAPTOR (Round-Based Public Transit Routing) engine from JavaScript to TypeScript within Scheduler 4. This gives planners the ability to analyze what riders can actually do with a schedule — starting with replacing the student pass trip-finder, with future expansion to isochrone maps, coverage analysis, and schedule comparison.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Code location | `utils/routing/` in Scheduler 4 | Simple, no monorepo overhead. Extract later if needed. |
| Data input | GTFS files only (via adapter) | Matches BTTP's model. Reuses existing bundled `gtfs/*.txt` files. |
| Walking API | Mapbox Directions | Single vendor (already adding Mapbox for maps). |
| Threading | Main thread | Barrie GTFS is small (~500 stops). Move to Web Worker later if needed. |
| Port approach | Faithful translation (Approach A) | Proven algorithm, minimal design risk, ~2,500 lines of battle-tested JS. |
| First integration | Replace student pass trip-finder | Proves engine end-to-end with existing UI. |

---

## File Structure

```
utils/routing/
├── types.ts              # All shared types (RoutingData, PathSegment, Itinerary, Leg, etc.)
├── constants.ts          # ROUTING_CONFIG tuning parameters
├── calendarService.ts    # GTFS service day resolution (calendar.txt + calendar_dates.txt)
├── geometryUtils.ts      # Haversine, point-in-polygon, spatial grid index
├── routingDataService.ts # GTFS arrays → RoutingData (pre-computed indexes)
├── raptorEngine.ts       # Core RAPTOR algorithm (forward routing, multi-pass diversity)
├── itineraryBuilder.ts   # RaptorResult → Itinerary with walk/transit legs
├── walkingService.ts     # Mapbox Directions API for real street-level walking paths
└── gtfsAdapter.ts        # Reads bundled gtfs/*.txt → typed GTFS arrays
```

---

## Key Types

```typescript
// GTFS inputs
interface GtfsStop { stopId: string; stopName: string; lat: number; lon: number }
interface GtfsTrip { tripId: string; routeId: string; serviceId: string; directionId: number; headsign: string; shapeId?: string }
interface GtfsStopTime { tripId: string; stopId: string; arrivalTime: number; departureTime: number; stopSequence: number }

// Pre-computed routing indexes
interface RoutingData {
  stopDepartures: Record<string, Departure[]>
  routeStopSequences: Record<string, Record<string, string[]>>
  transfers: Record<string, Transfer[]>
  tripIndex: Record<string, GtfsTrip>
  stopIndex: Record<string, GtfsStop>
  stopTimesIndex: Record<string, GtfsStopTime>  // "tripId_stopId" compound key
  serviceCalendar: ServiceCalendar
}

// RAPTOR output
type PathSegment = OriginWalkSegment | TransitSegment | TransferSegment
interface RaptorResult { destinationStopId: string; arrivalTime: number; path: PathSegment[] }

// Final consumer output
interface Itinerary { id: string; duration: number; legs: Leg[]; transfers: number; walkDistance: number }
type Leg = WalkLeg | TransitLeg  // discriminated on mode: 'WALK' | 'BUS'
```

---

## Data Flow

```
Startup / On-Demand:
  gtfsAdapter.ts → reads bundled gtfs/*.txt → GtfsStop[], GtfsTrip[], GtfsStopTime[]
  routingDataService.ts → buildRoutingData(gtfsData) → RoutingData (cached in memory)

Query Time:
  raptorEngine.ts → planTrip(from, to, date, time, routingData) → RaptorResult[]
  itineraryBuilder.ts → buildItinerary(result, routingData) → Itinerary
  walkingService.ts → enrichItinerary(itinerary) → EnrichedItinerary (optional)

Consumer:
  StudentPassModule.tsx → calls planTrip() instead of bespoke scanner
```

**RoutingData built once, cached in memory.** Barrie GTFS builds in <500ms (BTTP production baseline).

---

## Port Mapping

### Ported from BTTP (JS → TS)

| BTTP File | Scheduler 4 File | ~Lines | Changes |
|---|---|---|---|
| `localRouter.js` | `raptorEngine.ts` | 600 | Add types, remove `raptorReverse` stub |
| `routingDataService.js` | `routingDataService.ts` | 400 | Add types, keep spatial grid index |
| `itineraryBuilder.js` | `itineraryBuilder.ts` | 500 | Add types, discriminated union for Leg |
| `calendarService.js` | `calendarService.ts` | 245 | Straightforward pure functions |
| `geometryUtils.js` | `geometryUtils.ts` | 300 | Routing subset only (drop rendering functions) |
| `constants.js` | `constants.ts` | 50 | ROUTING_CONFIG only |

### Dropped

- `walkingService.js` AsyncStorage cache (React Native specific)
- `onDemandRouter.js` (not relevant)
- `raptorReverse` arrive-by (stub in BTTP, future TODO)
- `proxyAuth.js` (LocationIQ specific)
- `enrichTripPlanWithWalking` labeling logic (BTTP UX specific)
- `protobufDecoder.js` (GTFS-RT not needed)
- Rendering functions from `geometryUtils.js` (smoothing, offsets)

### Written New

| File | Purpose | ~Lines |
|---|---|---|
| `gtfsAdapter.ts` | Read bundled gtfs/*.txt, reuse parsing patterns from studentPassUtils | 150 |
| `walkingService.ts` | Mapbox Directions API wrapper with straight-line fallback | 100 |
| `types.ts` | All shared interfaces | 120 |

### Student Pass Integration (modify existing)

- `StudentPassModule.tsx` — replace trip-finding calls with `planTrip()`
- `studentPassUtils.ts` — keep zone/polygon/stop logic, delete bespoke trip scanner (~300 lines removed)

**Total scope:** ~2,000 lines ported/written, ~300 lines deleted.

---

## Error Handling

| Scenario | Handling |
|---|---|
| Origin/destination too close (<50m) | Return "walkable" result, skip routing |
| No stops within 800m | `RoutingError('OUTSIDE_SERVICE_AREA')` |
| No active services for date | `RoutingError('NO_SERVICE')` |
| No path found after all rounds | `RoutingError('NO_ROUTE_FOUND')` |
| Mapbox walking API failure | Fall back to haversine × 1.3 buffer |
| GTFS files missing/malformed | Throw at gtfsAdapter level |
| Post-midnight times (>= 1440 min) | Natural in seconds-since-midnight format |

### Barrie-Specific Edge Cases

- **Terminal platforms:** Transfer graph links co-located stops with 60s min transfer
- **Express vs local:** Different trip patterns, RAPTOR treats as separate route-directions
- **Partial trips:** `startStopIndex`/`endStopIndex` honored by gtfsAdapter
- **Seasonal changes:** Rebuild RoutingData when GTFS updates

### Explicitly Out of Scope

- Real-time delays (no GTFS-RT)
- Arrive-by / reverse routing
- On-demand zones
- Multi-day trips
- Bike/car access modes

---

## Testing Strategy

### Unit Tests

| File | Test File |
|---|---|
| `calendarService.ts` | `tests/routing/calendarService.test.ts` |
| `geometryUtils.ts` | `tests/routing/geometryUtils.test.ts` |
| `routingDataService.ts` | `tests/routing/routingDataService.test.ts` |
| `raptorEngine.ts` | `tests/routing/raptorEngine.test.ts` |
| `itineraryBuilder.ts` | `tests/routing/itineraryBuilder.test.ts` |
| `gtfsAdapter.ts` | `tests/routing/gtfsAdapter.test.ts` |
| `walkingService.ts` | `tests/routing/walkingService.test.ts` |

### Integration Test (Golden Path)

`tests/routing/raptor.integration.test.ts` with real Barrie GTFS:

1. Direct route (no transfer)
2. One transfer via Terminal hub
3. Student pass scenario (polygon → school by bell time)
4. No service (wrong day type)
5. Walk-only (<50m)

### Verification

```bash
npx vitest run tests/routing/          # After each file ported
npx vitest run tests/routing/ && npm run build  # After student pass integration
```

---

## ROUTING_CONFIG (from BTTP, tuned for Barrie)

```typescript
export const ROUTING_CONFIG = {
  MAX_TRANSFERS: 2,
  MAX_WALK_TO_TRANSIT: 800,      // meters
  MAX_WALK_FOR_TRANSFER: 400,    // meters
  WALK_SPEED: 1.2,               // m/s (~4.3 km/h)
  TRANSFER_PENALTY: 180,         // seconds
  MIN_TRANSFER_TIME: 60,         // seconds
  WALK_DISTANCE_BUFFER: 1.3,     // straight-line to actual path multiplier
  MAX_ACTUAL_WALK_DISTANCE: 1200,// meters
  MAX_ITINERARIES: 5,            // increased from BTTP's 3 for planner use
  TIME_WINDOW: 7200,             // seconds (2 hours)
  MAX_TRIP_DURATION: 7200,       // seconds
  MAX_WAIT_TIME: 3600,           // seconds
} as const;
```

---

## Future Capabilities (unlocked by this engine, not in scope now)

- **Isochrone maps:** Run RAPTOR from one stop, collect all reachable stops by time, paint on Mapbox
- **Coverage analysis:** Grid of origins → key destinations, score the schedule
- **What-if comparison:** Run same analysis on two schedule drafts, diff the results
- **Accessibility scoring:** "% of population within 30 min of hospital/mall/college"
- **Connection validation:** "Do routes X and Y actually connect with reasonable wait?"
