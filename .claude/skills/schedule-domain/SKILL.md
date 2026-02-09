---
name: schedule-domain
description: Auto-activates when discussing transit scheduling concepts like trips, blocks, cycles, recovery times, headways, interlining, or route structures. Use for domain questions, schedule validation, and ensuring code correctly models transit operations.
---

# Transit Scheduling Domain Expert

This skill auto-activates when working with transit scheduling concepts. It provides industry-standard knowledge contextualized for Barrie Transit.

## Trigger Conditions

Activate when discussion involves:
- Transit terminology (trips, blocks, headways, recovery, deadhead, etc.)
- Schedule generation or editing logic
- Runtime analysis or travel time calculations
- Block assignment or vehicle scheduling
- Route structure or service planning
- GTFS import/export
- Connection optimization
- Any file in: `scheduleGenerator.ts`, `blockAssignment.ts`, `runtimeAnalysis.ts`, `gtfsImportService.ts`

---

## Part 1: Transit Terminology Glossary

### Core Concepts

| Term | Definition | Industry Standard |
|------|------------|-------------------|
| **Trip** | Single one-way vehicle journey from origin to destination | GTFS: `trips.txt` |
| **Block** | Sequence of trips operated by one vehicle throughout the day | GTFS: `block_id` field |
| **Route** | Named transit service with defined stops (e.g., "Route 400") | GTFS: `routes.txt` |
| **Pattern** | Specific stop sequence for a route variant | Also called "trip pattern" |
| **Run** | Driver assignment (may span multiple blocks) | Also called "piece" |

### Time & Frequency

| Term | Definition | Formula/Example |
|------|------------|-----------------|
| **Headway** | Time between consecutive vehicles at a stop | 30-min headway = bus every 30 min |
| **Frequency** | Trips per hour | 60 ÷ headway = trips/hr |
| **Span of Service** | Hours of operation per day | First trip start → Last trip end |
| **Revenue Hours** | Total scheduled service time | Sum of all trip durations |
| **Cycle Time** | Time for one complete round trip | Includes travel + recovery |

### Travel Time Components

| Term | Definition | Barrie Context |
|------|------------|----------------|
| **Running Time** | Actual travel time between stops | From runtime CSV data |
| **Dwell Time** | Time stopped for passenger boarding | Typically 15-30 sec/stop |
| **Recovery Time** | Scheduled layover at terminus | 10-20% of cycle time standard |
| **Deadhead** | Non-revenue movement (garage ↔ route) | Not tracked in this app |
| **Layover** | Driver break time at terminus | Combined with recovery |

### Schedule Structure

| Term | Definition | Barrie Implementation |
|------|------------|----------------------|
| **Timepoint** | Stop where schedule adherence is measured | Column headers in schedule tables |
| **Segment** | Travel between two consecutive timepoints | Runtime data granularity |
| **Time Band** | Period with similar travel characteristics | A/B/C/D/E bands (A=slowest peak) |
| **Day Type** | Service variation by day | Weekday, Saturday, Sunday |

### Vehicle Operations

| Term | Definition | Example |
|------|------------|---------|
| **Pull-out** | Vehicle leaves garage for service | First trip of block |
| **Pull-in** | Vehicle returns to garage | Last trip of block |
| **Interline** | Vehicle transitions between routes | 8A → 8B at terminal |
| **Short-turn** | Trip that doesn't complete full route | Not currently supported |
| **Express** | Limited-stop service | Route 100 pattern |

---

## Part 2: Barrie Transit Specifics

### Route Types

| Type | Routes | Characteristics |
|------|--------|-----------------|
| **Linear (Merged A/B)** | 2, 7, 12 | North (A) + South (B) share downtown terminus; treated as single route |
| **Linear (Variants)** | 8A, 8B | Separate route variants with distinct stops |
| **Linear (Single)** | 400 | Single direction without variants |
| **Loop** | 10, 11, 100, 101 | Circular routes (CW/CCW) |

### Merged Route Behavior (CRITICAL)

Routes 2, 7, and 12 have **merged A/B directions**:

```
2A (North): Park Place → Downtown Terminal
2B (South): Downtown Terminal → South End

Same bus operates: 2A trip → recovery at terminal → 2B trip → recovery → 2A...
```

**Implications for code:**
- Block spans both directions
- Recovery at shared terminus appears once (between ARR and DEP)
- GTFS import must chain trips across directions using gap-based matching
- Display shows: `| ARR | R | DEP |` at terminus (not separate stops)

### Downtown Terminal

Central hub where most routes converge:
- Platform assignments matter (conflict detection)
- Connection optimization targets this location
- Recovery times absorbed here between directions

### Time Bands

| Band | Period | Characteristics |
|------|--------|-----------------|
| **A** | AM Peak (7:00-9:00) | Slowest - congestion |
| **B** | PM Peak (15:00-18:00) | Second slowest |
| **C** | Midday (9:00-15:00) | Moderate |
| **D** | Evening (18:00-22:00) | Faster |
| **E** | Early/Late | Fastest - minimal traffic |

---

## Part 3: Industry Best Practices

### Recovery Time Standards

| Metric | Industry Standard | Recommendation |
|--------|-------------------|----------------|
| **Minimum recovery** | 10% of cycle time | Never less |
| **Target recovery** | 15-20% of cycle time | Optimal range |
| **Maximum recovery** | 25% of cycle time | Indicates inefficiency |

```
Example: 60-min cycle time
- Minimum: 6 min recovery
- Target: 9-12 min recovery
- Maximum: 15 min recovery
```

### Headway Guidelines

| Service Type | Headway | Notes |
|--------------|---------|-------|
| **High frequency** | ≤15 min | "Show up and go" service |
| **Standard** | 20-30 min | Typical fixed-route |
| **Low frequency** | 45-60 min | Requires schedule awareness |
| **Lifeline** | 60+ min | Basic coverage only |

### Schedule Padding

- **Never pad individual segments** - Creates compounding delays
- **Pad at timepoints only** - Allows recovery without drift
- **Use realistic runtimes** - Based on actual data, not optimistic estimates

### Block Efficiency

| Metric | Formula | Target |
|--------|---------|--------|
| **Platform hours ratio** | Revenue hrs ÷ Total block hrs | >85% |
| **Deadhead ratio** | Deadhead mi ÷ Revenue mi | <10% |
| **Interlining efficiency** | Interlined trips ÷ Total trips | Maximize where practical |

---

## Part 4: Schedule Validation Checklist

When reviewing schedules, verify:

### Timing Integrity
- [ ] Recovery time ≥ 10% of cycle time at each terminus
- [ ] No negative recovery (trip ends after next trip starts)
- [ ] Segment times sum correctly to trip travel time
- [ ] Time bands applied correctly (peak = slower)

### Block Assignment
- [ ] All trips assigned to blocks
- [ ] Block IDs follow convention: `{route}-{number}`
- [ ] Trips within block are time-continuous (gap ≤ 1 min or explicit interline)
- [ ] First/last trips of block marked (`isBlockStart`, `isBlockEnd`)

### Service Consistency
- [ ] Headways are regular (no random gaps)
- [ ] Span of service matches policy
- [ ] All timepoints have departure times
- [ ] Direction alternates correctly for linear routes

### Connection Viability
- [ ] Connection buffer times are realistic (5-10 min)
- [ ] Optimized times don't violate minimum recovery
- [ ] Platform conflicts resolved

---

## Part 5: Code Implementation Guidance

### Correct Patterns

**Segment Rounding (LOCKED)**
```typescript
// CORRECT - round each segment before summing
const totalTime = segments.reduce((sum, seg) =>
  sum + Math.round(seg.time), 0
);

// WRONG - sum then round
const totalTime = Math.round(segments.reduce((sum, seg) =>
  sum + seg.time, 0)
);
```

**Cycle Time Calculation (LOCKED)**
```typescript
// CORRECT - span from first departure to last arrival
const cycleTime = lastTrip.endTime - firstTrip.startTime;

// WRONG - sum of individual trip times
const cycleTime = trips.reduce((sum, t) => sum + t.duration, 0);
```

**Block Assignment for Merged Routes (LOCKED)**
```typescript
// CORRECT - gap-based matching
const gap = nextTrip.startTime - currentTrip.endTime;
const sameBlock = gap >= 0 && gap <= maxRecovery;

// WRONG - index-based matching
const sameBlock = i + 1 < trips.length; // Fails for merged routes
```

### Anti-Patterns to Avoid

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| Hardcoded stop indices | Breaks when stops change | Use stop name matching |
| Sum-then-round timing | Cumulative drift | Round-then-sum |
| Index-based block chains | Fails for merged routes | Gap-based matching |
| Negative recovery allowed | Physically impossible | Enforce minimum recovery |
| Magic numbers for bands | Unmaintainable | Use band lookup tables |

### Domain Model Invariants

These must ALWAYS be true:

1. `trip.endTime > trip.startTime` (trips have positive duration)
2. `trip.recoveryTime >= 0` (no negative recovery)
3. `block.trips` ordered by `startTime` ascending
4. `roundTrip.north.endTime <= roundTrip.south.startTime` (for merged routes)
5. `sum(segment.times) == trip.travelTime` after rounding

---

## Part 6: Common Questions

### "What's a reasonable recovery time?"

For Barrie Transit routes:
- **Short routes (< 20 min)**: 3-5 min recovery
- **Medium routes (20-40 min)**: 5-10 min recovery
- **Long routes (> 40 min)**: 10-15 min recovery

Always verify: recovery ≥ 10% of round-trip cycle time.

### "How do I handle a route that runs both directions?"

Depends on route type:
- **Merged (2, 7, 12)**: Single schedule with N+S paired; one block operates both
- **Variants (8A, 8B)**: Separate schedules; may or may not interline

### "What if GTFS has no block_id?"

Use gap-based block inference:
1. Sort trips by start time within route+direction
2. If trip N ends and trip N+1 starts within reasonable recovery window → same block
3. For merged routes, also check across directions at shared terminus

### "How do I calculate trips per hour?"

```
Trips/hour = 60 ÷ headway (in minutes)

Example: 30-min headway → 60/30 = 2 trips/hr per direction
For round trips: 2 trips/hr (1 N + 1 S = 1 round trip/hr)
```

### "What's the difference between runtime and travel time?"

- **Runtime**: Actual observed travel time from data (varies by time of day)
- **Travel Time**: Scheduled travel time assigned to trip (rounded, band-averaged)
- **Running Time**: Industry synonym for runtime

---

## Part 7: Quick Reference Card

### Formulas
```
Cycle Time = Last Arrival - First Departure + Final Recovery
Headway = Time between consecutive trip departures
Frequency = 60 ÷ Headway
Recovery Ratio = Recovery Time ÷ Cycle Time (target: 15-20%)
```

### File Locations
```
Schedule generation: utils/scheduleGenerator.ts
Block assignment: utils/blockAssignment.ts (+ gtfsImportService.ts)
Runtime analysis: components/NewSchedule/utils/runtimeAnalysis.ts
Time parsing: utils/timeUtils.ts
GTFS handling: utils/gtfsImportService.ts
```

### Key Types
```typescript
MasterTrip       // Single trip with times, stops, block
MasterRouteTable // Collection of trips for one direction
RoundTripRow     // Paired N+S trips for display
DraftSchedule    // Editable working schedule
MasterSchedule   // Published immutable schedule
```

---

## Part 8: Interlining (REMOVED - Pending Reimplementation)

> **Status:** All interline code was removed in February 2026. The functions `applyInterlineRules`, `calculateInterlineTerminalDepartures`, `findInterlineTarget`, and `tripMatchesRule` no longer exist. `MasterTrip` no longer has `interlineNext`, `interlinePrev`, or `interlineTerminalDep` fields.

### Domain Context (for future reimplementation)

**Interlining** is when a bus transitions between different routes without returning to the garage. At Barrie Transit, Routes 8A and 8B interline at the Allandale Transit Terminal during reduced-service periods:

- **Weekday/Saturday**: Evening only (8:00 PM - 1:35 AM)
- **Sunday**: All day

One bus alternates: 8A → 8B → 8A → 8B, with ~5 min recovery at the terminal between route transitions.

### Key Design Considerations (When Reimplementing)

1. Both 8A and 8B schedules must be loaded simultaneously
2. Terminal DEP column shows next **same-route** departure, not ARR + R
3. Use dynamic stop-name matching (platform numbers vary)
4. Block IDs must span across routes for interlined trips
5. Time ranges differ by day type (evening-only vs all-day)
