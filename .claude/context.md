# Locked Logic & Critical Rules

> **DO NOT modify locked logic without explicit user approval.**

---

## Locked Logic (6 Rules)

### 1. Double Pass Optimization (`api/optimize.ts`)

```
Phase 1 (Generator): Create initial schedule
Phase 2 (Critic): Review and suggest improvements
```

**Why:** Prevents AI over-optimization; iterative refinement produces better results.

---

### 2. Segment Rounding (`scheduleGenerator.ts`)

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

### 3. Trip Pairing (`ScheduleEditor.tsx`)

```
Row 1: Trip N1 | Trip S1
Row 2: Trip N2 | Trip S2
```

**NOT:** N1/N2 in one column, S1/S2 in another.

**Why:** Operators need paired round trips (N→S) for vehicle assignment.

---

### 4. Cycle Time Calculation

```typescript
cycleTime = schedule[schedule.length - 1].end - schedule[0].start
```

**NOT:** Sum of trip durations or runtime + recovery.

**Why:** Cycle time = total vehicle operating period, not sum of parts.

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
| Use first GTFS trip for stop list | Use canonical (most stops) trip |
| Index-based stop time lookup | Name-based stop matching |
| Use `expectedStart` for merged routes | Use gap-based matching (`maxGap`) |
| Check `timeTolerance` before `maxGap` | Check `maxGap` first when specified |
| Reference old interline code | Interline was removed Feb 2026; reimplementation pending |

---

## 5. GTFS Import for Merged A/B Routes (`gtfsImportService.ts`)

Routes like 2A+2B, 7A+7B, 12A+12B share a terminus where the bus arrives on A and departs on B.

### Stop Name Generation

```typescript
// CORRECT: Use trip with MOST stops as canonical
const canonicalTrip = trips.reduce((best, trip) =>
    trip.stopTimes.length > best.stopTimes.length ? trip : best
);

// WRONG: Use first trip (may be partial, missing stops like Park Place)
const stopNames = generateUniqueStopNames(trips[0].stopTimes);
```

**Why:** First trip may start mid-route; canonical trip ensures all stops captured.

### Stop Time Assignment

```typescript
// CORRECT: Name-based matching
const stopName = stopNameMap.get(st.stopName);
if (stopName) stops[stopName] = formatTime(st.arrivalMinutes);

// WRONG: Index-based lookup
const stopName = uniqueStopNames[stIdx];  // Assumes all trips have same stops
```

**Why:** Trips may have different stop counts; index lookup assigns times to wrong columns.

### Merged Route Detection

```typescript
// Detect shared terminus (e.g., Downtown Hub)
const lastNorthStop = northStops[northStops.length - 1]?.toLowerCase();
const firstSouthStop = southStops[0]?.toLowerCase();
const isMergedRoute = lastNorthStop === firstSouthStop;
```

### Block Assignment - Gap-Based Chaining (LOCKED)

**File:** `blockAssignmentCore.ts:105-162` (`findNextTrip`)

Blocks must chain trips by **time continuity**, not by index. Each block represents a single bus operating throughout the day.

```typescript
// CORRECT: Gap-based matching for merged routes
// Uses direct time gap instead of unreliable recoveryAtEnd
if (config.maxGap !== undefined) {
    const gap = candidate.startTime - current.endTime;
    if (gap >= 0 && gap <= config.maxGap) {
        // Valid chain: bus waits `gap` minutes, then starts next trip
    }
}

// WRONG: ExpectedStart-based matching with missing recovery
const recoveryAtEnd = current.recoveryTimes?.[lastStopName] ?? 0;  // Often 0!
const expectedStart = current.endTime + recoveryAtEnd;  // Wrong if recovery missing
const timeDiff = Math.abs(candidate.startTime - expectedStart);
if (timeDiff > timeTolerance) continue;  // Fails when recovery=0 but gap=8min
```

**Why this matters:**
- GTFS doesn't have terminal layover data → `recoveryAtEnd = 0`
- Actual layover (8 min) is calculated from `nextTrip.startTime - currentTrip.endTime`
- ExpectedStart-based matching fails: `|6:40 - 6:32| = 8 > timeTolerance(5)` → no chain
- Gap-based matching succeeds: `8 <= maxGap(30)` → trips chain correctly

**Config presets (`MatchConfigPresets`):**
| Preset | Use Case | Key Setting |
|--------|----------|-------------|
| `merged` | 2A+2B, 7A+7B routes | `maxGap: 30` (gap-based) |
| `gtfs` | Standard GTFS import | `timeTolerance: 5, checkLocation: true` |
| `exact` | Generated schedules | `timeTolerance: 1, checkLocation: true` |

**Expected result:**
- ~8 blocks with multiple trips chained (not 53 single-trip blocks)
- "END" marker only on final trip of each block
- Matches Excel master schedule format (one row = one round trip)

### Layover/Recovery Calculation (BOTH Terminuses)

Merged routes have TWO recovery points:
1. **Shared terminus** (Downtown): North→South handoff
2. **Outer terminus** (Park Place): South→North handoff (next cycle)

```typescript
// 1. Recovery at SHARED terminus (Downtown) - North trip waits before South departs
const sharedLayover = southTrip.startTime - northTrip.endTime;
northTrip.recoveryTimes[lastNorthStopName] = sharedLayover;

// 2. Recovery at OUTER terminus (Park Place) - South trip waits before next North departs
// Find CLOSEST North trip by time (not sequential index)
// e.g., South ends 3:57 PM → find North starting 4:05 PM (closest), not just next in array
let closestNorthTrip = null;
let minGap = Infinity;
for (const candidate of sortedNorth) {
    const gap = candidate.startTime - southTrip.endTime;
    if (gap >= 0 && gap < minGap) {
        minGap = gap;
        closestNorthTrip = candidate;
    }
}
if (closestNorthTrip && minGap < 60) {
    southTrip.recoveryTimes[lastSouthStopName] = minGap;
}
```

**Why:** Without outer terminus recovery, Park Place shows R=0, block chaining fails, and operator breaks are missing.

### Display Format (`RoundTripTableView.tsx`)

For merged terminus:
- **Show:** ARR column (arrival), R column (recovery)
- **Skip:** DEP column (South's first stop handles departure)

```
| Route 2A                              | Route 2B                    |
| Park Pl | ... | Downtown (ARR) | R    | Downtown (DEP) | ... | Park Pl |
| 6:05 AM | ... | 6:32 AM        | 8    | 6:40 AM        | ... | 7:15 AM |
```

**Key condition:**
```typescript
const isMergedTerminusStop = i === lastNorthStopIdx && hasMergedTerminus;
const showArrRCols = hasRecovery || isMergedTerminusStop;
// Show ARR | R, skip DEP for merged terminus
```
