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

## Part 8: Interlining at Barrie Transit

### What is Interlining?

**Interlining** is when a bus transitions between different routes without returning to the garage. At Barrie Transit, Routes 8A and 8B interline during evening hours at the Barrie Allandale Transit Terminal.

```
Weekday/Saturday Evening (8:00 PM - 1:35 AM):
Bus operates: 8A → 8B → 8A → 8B → ...

Example sequence:
1. 8A arrives at terminal     8:07 PM
2. 8B departs from terminal   8:12 PM  (5 min recovery)
3. 8B arrives back            8:37 PM
4. 8A departs from terminal   8:42 PM  (5 min recovery)
5. 8A arrives back            9:07 PM
... cycle continues
```

### Why Interline?

- **Efficiency**: One bus serves both routes instead of two buses sitting idle
- **Lower evening demand**: Ridership doesn't justify separate vehicles
- **Cost savings**: Reduces vehicle hours and driver shifts

### Prerequisite: Load Both Routes

**CRITICAL**: Both 8A and 8B schedules must be loaded for interline logic to work.

The system needs to:
1. Find 8A trips arriving at the terminal
2. Find 8B trips departing from the terminal
3. Link them into shared blocks
4. Calculate when the same route next departs

If only one route is loaded, none of this can happen.

### The ARR | R | DEP Pattern at Terminal

At interline terminals, the schedule displays three sub-columns:

| Column | Meaning | Example |
|--------|---------|---------|
| **ARR** | When this trip arrives at terminal | 8:07 PM |
| **R** | Recovery/layover minutes | 5 |
| **DEP** | When the SAME ROUTE next departs | 8:42 PM |

**Key insight**: DEP is NOT `ARR + R`. During interline:
- The bus departs as a different route (8B at 8:12 PM)
- DEP shows when the original route (8A) next departs (8:42 PM)
- The 35-minute gap (8:07 → 8:42) signals to schedulers that an interline occurred

### Interline Rules

Rules define when and where interlining occurs:

```typescript
interface InterlineRule {
  fromRoute: '8A' | '8B';
  fromDirection: 'North';
  toRoute: '8B' | '8A';
  toDirection: 'North';
  atStop: 'Barrie Allandale Transit Terminal - Platform 1';
  timeRange: { start: 1200, end: 1535 };  // 8:00 PM - 1:35 AM
  days: ['Weekday', 'Saturday'];
  enabled: boolean;
}
```

Default rules are auto-created when both 8A and 8B are detected in the loaded schedules.

### Data Flow: How Interline Works

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. LOAD SCHEDULES                                               │
│    Load both 8A and 8B tables into ScheduleEditor               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. AUTO-DETECT RULES (ScheduleEditor.tsx)                       │
│    - Detect 8A + 8B presence                                    │
│    - Find terminal stop name from schedule                      │
│    - Create default InterlineRule[] for Weekday/Saturday/Sunday │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. APPLY INTERLINE RULES (applyInterlineRules)                  │
│    For each trip matching a rule:                               │
│    - Find the target trip (8A→8B or 8B→8A)                      │
│    - Set trip.interlineNext = { route, time, stopName }         │
│    - Set target.interlinePrev = { route, time, stopName }       │
│    - Assign shared blockId to linked trip chains                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. CALCULATE TERMINAL DEP (calculateInterlineTerminalDepartures)│
│    For each trip with interlineNext:                            │
│    - Group all trips by blockId                                 │
│    - Find next trip in block with SAME route number             │
│    - Store that trip's terminal departure in interlineTerminalDep│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. RENDER DEP COLUMN (RoundTripTableView.tsx)                   │
│    When displaying terminal stop:                               │
│    - Check if trip.interlineTerminalDep[stop] exists            │
│    - If yes: show that time (next same-route departure)         │
│    - If no: show ARR + Recovery (standard calculation)          │
└─────────────────────────────────────────────────────────────────┘
```

### Key Code Locations

| Function | File | Purpose |
|----------|------|---------|
| `applyInterlineRules` | `masterScheduleParser.ts:1077` | Links trips and assigns shared blocks |
| `calculateInterlineTerminalDepartures` | `masterScheduleParser.ts:1348` | Calculates DEP times for interlined trips |
| `tripMatchesRule` | `masterScheduleParser.ts:863` | Checks if a trip matches an interline rule |
| `findInterlineTarget` | `masterScheduleParser.ts:944` | Finds the target trip for interlining |
| `getInterlineTerminalDep` | `RoundTripTableView.tsx:70` | Gets DEP time with fuzzy stop matching |
| Auto-apply logic | `ScheduleEditor.tsx:282` | Creates and applies default rules on load |

### MasterTrip Interline Fields

```typescript
interface MasterTrip {
  // ... other fields ...

  // Set by applyInterlineRules
  interlineNext?: {
    route: string;      // "8B" - route it becomes
    time: number;       // Time at terminal (minutes)
    stopName?: string;  // "Barrie Allandale Transit Terminal - Platform 1"
  };
  interlinePrev?: {
    route: string;      // "8A" - route it came from
    time: number;
    stopName?: string;
  };

  // Set by calculateInterlineTerminalDepartures
  interlineTerminalDep?: Record<string, number>;  // stopName → DEP time (minutes)
}
```

### Stop Name Matching

The terminal stop name may vary (platform numbers, abbreviations). The `stopNameMatches` function handles:

- Exact match: `"Barrie Allandale Transit Terminal"` = `"Barrie Allandale Transit Terminal"`
- Platform suffix: `"Barrie Allandale Transit Terminal - Platform 1"` matches `"Barrie Allandale Transit Terminal"`
- Partial match: `"Allandale Terminal"` matches `"Barrie Allandale Transit Terminal"`
- Numbered suffix: `"Terminal (2)"` matches `"Terminal"`

### Debugging Interline Issues

Enable console logging by loading schedules and checking browser DevTools:

```
[ApplyInterline] Enabled rules: 4 ["8A->8B at Barrie Allandale...", ...]
[ApplyInterline] Trip matched rule: 8A (Weekday) trip ending 8:07 PM
[ApplyInterline] Found target: 8B (Weekday) trip starting 8:12 PM
[InterlineDEP] Found interline trip: 8A block=IL-W1 startTime=7:32 PM -> 8B
[InterlineDEP] Looking for next 8A trip at terminal
[InterlineDEP] Found same route! depTime at terminal = 8:42 PM
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| DEP shows ARR+R instead of next same-route | Only one route loaded | Load both 8A and 8B |
| No interline applied | Rules not enabled or time outside range | Check InterlineConfigPanel |
| Wrong terminal stop | Stop name mismatch | Check `atStop` in rules matches actual stop |
| Trips not in same block | Target trip not found | Verify both routes have trips at matching times |

### Sunday Behavior

On Sundays, interlining runs **all day** (not just evenings) due to reduced service levels:

```typescript
// Sunday rules
timeRange: { start: 0, end: 1535 }  // 12:00 AM - 1:35 AM (next day)
```
