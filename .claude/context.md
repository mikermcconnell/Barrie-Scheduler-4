# Locked Logic & Critical Rules

> Read `docs/CONTEXT_INDEX.md` first for context load order.
> Durable read-first summary: `docs/rules/LOCKED_LOGIC.md`

> **DO NOT modify locked logic without explicit user approval.**

---

## Locked Logic (7 Rules)

### 1. Segment Rounding (`utils/schedule/scheduleGenerator.ts`)

```typescript
// CORRECT:
const segment1 = Math.round(runtime1)
const segment2 = Math.round(runtime2)
const total = segment1 + segment2

// WRONG:
const total = Math.round(runtime1 + runtime2)
```

**Why:** Individual segment precision prevents cumulative timing errors.

---

### 2. Trip Pairing (`components/ScheduleEditor.tsx`)

```
Row 1: Trip N1 | Trip S1
Row 2: Trip N2 | Trip S2
```

**NOT:** N1/N2 in one column, S1/S2 in another.

**Why:** Operators need paired round trips (N→S) for vehicle assignment.

---

### 3. Cycle Time Calculation

```typescript
const lastTrip = schedule[schedule.length - 1];
const occupiedEnd = lastTrip.endTime + (
  lastTrip.isBlockEnd || resolvedEndTimeIncludesRecovery
    ? 0
    : terminalRecovery
);
const cycleTime = occupiedEnd - schedule[0].startTime;
```

Resolve `endTimeIncludesRecovery` from the explicit trip flag when available;
for legacy trips, infer it from terminal arrival/departure data. **Do not**
blindly add terminal recovery, and do not sum trip durations.

**Why:** Cycle time is the occupied span from first departure through the final
applicable recovery, counted exactly once.

---

### 4. Block Assignment for Merged Routes

Routes 2A/2B, 7A/7B, and 12A/12B must chain by the actual non-negative gap
between a trip end and the next trip start. Do not derive an expected start
from recovery metadata that GTFS may not provide.

---

### 5. Time Parsing

Fixed-route Excel values greater than `1.0` retain their whole-day offset so
post-midnight trips sort after prior-evening service. For example, `1.02083`
is approximately 1470 service-day minutes, not 30. Pure integer/date values
without a time fraction are rejected. A time-of-day-only consumer may
intentionally normalize only when its domain contract and focused tests require
that representation.

---

### 6. Dual AI Optimization Paths (`api/optimize.ts`, `functions/src/optimizePipelinePolicy.ts`)

```
Generate (`full`): fast single-generator path
Refine with OPTIMIZE_MULTI_PHASE enabled and runtime support:
  generator → critic → polisher
Refine without that policy/runtime support: fast single-generator path
```

Fresh generation stays fast. Explicit refinement can use the extended review
pipeline where the deployment supports it. Do not assume every request runs a
critic phase; AI output remains planner-controlled in either path.

---

### 7. Trusted Runtime Buckets

New Schedule generation consumes only the current approved Step 2 runtime
contract. Use the exact eligible approved half-hour bucket when available;
otherwise use the nearest eligible bucket from the same direction/start
orientation, measuring around the 24-hour clock and preferring the earlier
bucket on a tie.

Performance evidence is approved by paired-cycle start orientation and the
selected bucket is reused for both legs. Uploaded CSV evidence remains keyed to
each trip start. If the required orientation has no eligible bucket or the
selected bucket lacks a canonical segment, throw `MissingApprovedRuntimeError`.
Never cross orientations or substitute review-only evidence, raw segment data,
another band, or a default runtime.

---

## Domain Terms

| Term | Meaning |
|------|---------|
| **Runtime** | Actual driving time start → end |
| **Recovery** | Buffer between trips for operator breaks |
| **Cycle Time** | Total time vehicle is in service |
| **Trip Pair** | Northbound + Southbound trip |
| **Block** | Chain of trips by single bus |
| **Time Band** | Period with characteristic travel times (A/B/C/D/E) |

---

## Critical Gotchas

| Don't | Do |
|-------|-----|
| Modify cycle time calculation | Ask before changing locked logic |
| Change rounding logic | Round each segment individually |
| Reorder trip pairing | Preserve N+S pairs in display |
| Assume CSV headers exist | Validate format before parsing |
| Hardcode column indices | Use dynamic stop-name detection |
| Use the first GTFS trip as the stop list | Merge adjacency from all patterns; let longer patterns establish edges first |
| Index-based stop time lookup | Use occurrence-aware stop-name mapping |
| Use `expectedStart` for merged routes | Use gap-based matching (`maxGap`) |
| Check `timeTolerance` before `maxGap` | Check `maxGap` first when specified |
| Reference old manual interline fields/functions | They remain removed; system-wide GTFS import separately preserves limited shared-`block_id` continuity |

---

## GTFS Import for Merged A/B Routes (`utils/gtfs/gtfsImportService.ts`)

Routes like 2A+2B, 7A+7B, 12A+12B share a terminus where the bus arrives on A and departs on B.

### Current Conversion Behavior

- `processTripsForRoute` parses GTFS times without collapsing values above 24
  hours, maps direction from GTFS/config/headsign with terminus inference as a
  fallback, and optionally keeps only explicit timepoints when at least two
  remain.
- `convertToMasterSchedule` merges adjacency from all trip patterns in a
  direction so partial trips contribute to the complete stop chain. Longer
  patterns establish adjacency first; it does not use the first trip as a
  canonical stop list.
- Repeated stop names receive occurrence suffixes such as `(2)`. Trip times are
  assigned through occurrence-aware name maps so loop visits and partial trips
  do not shift into the wrong columns.
- Arrival values populate schedule stop cells; positive
  departure-minus-arrival values populate recovery. The terminal retains a
  recovery entry, including zero, so the editor can display and edit it.

### Block Assignment - Gap-Based Chaining (LOCKED)

**File:** `utils/blocks/blockAssignmentCore.ts` (`findNextTrip`)

`applyBlockAssignment` prefers GTFS `block_id` continuity when at least 70% of
trips have usable block IDs. It renumbers those physical blocks into stable
route-prefixed display IDs and calculates only reasonable positive recovery
gaps. When GTFS block coverage is insufficient, it delegates to
`utils/blocks/blockAssignmentCore.ts`: merged A/B routes use the gap-based
`merged` preset; other routes use the standard GTFS matching preset.

Never restore index-based chains or derive merged-route continuity from absent
recovery values.

### System-Wide Interline Import

Per-route conversion cannot see a bus change route. After all routes are loaded,
system-wide import groups trips by shared GTFS `block_id`, applies reasonable
cross-route terminal recovery where none is already recorded, and coordinates
the user-facing block suffix across those routes. This limited GTFS-derived
behavior is current; the old manual interline fields and rules remain removed.

### Display Format (`RoundTripTableView.tsx`)

For merged terminus:
- **Show:** ARR column (arrival), R column (recovery)
- **Skip:** DEP column (South's first stop handles departure)

```
| Route 2A                              | Route 2B                    |
| Park Pl | ... | Downtown (ARR) | R    | Downtown (DEP) | ... | Park Pl |
| 6:05 AM | ... | 6:32 AM        | 8    | 6:40 AM        | ... | 7:15 AM |
```

The exact rendering implementation may change; verify
`components/schedule/RoundTripTableView.tsx` and its focused tests instead of
copying an old condition from this historical supplement.

---

## RAPTOR Routing Engine (`utils/routing/`)

Local RAPTOR (Round-Based Public Transit Routing) engine ported from BTTP. Used by Student Pass module for trip planning.

### Architecture
- **`gtfsAdapter.ts`** — Loads raw GTFS txt files from `gtfs/` folder, caches in memory
- **`routingDataService.ts`** — Builds pre-computed indexes (stop departures, route sequences, transfer graph, service calendar)
- **`calendarService.ts`** — Builds date→active-services map from calendar.txt + calendar_dates.txt
- **`raptorEngine.ts`** — Core RAPTOR algorithm: multi-round forward search with transfer expansion
- **`itineraryBuilder.ts`** — Converts raw RAPTOR results → structured Itinerary with legs, walk segments, timing
- **`studentPassRaptorAdapter.ts`** (`utils/transit-app/`) — Maps RAPTOR Itinerary → StudentPassResult for the Student Pass UI

### Key Design Decisions
- **Calendar span derived from GTFS data**: `getCalendarSpan()` computes reference date + daysAhead from calendar start/end dates, not from today's date. This ensures routing works regardless of when the code runs.
- **Loop route handling**: `tripStopTimes` index enables position-based stop lookup (not just stopId), critical for routes that visit the same stop twice.
- **Transfer graph uses spatial grid**: O(n) performance via 0.005° grid cells instead of O(n²) all-pairs comparison.
- **Forward-only search**: RAPTOR searches forward from departure time. Morning trips search 90min before bell; afternoon trips search from bell end.

### Constants (`utils/routing/constants.ts`)
- `MAX_WALK_TO_TRANSIT`: 800m — max walk from origin/destination to nearest stop
- `MAX_WALK_FOR_TRANSFER`: 400m — max walk between stops for transfer
- `WALK_SPEED`: 1.2 m/s
- `MAX_ROUNDS`: 4 — max transfers + 1
