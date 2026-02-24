# Dwell Cascade Analysis — Implementation Plan

> **Goal:** Trace how a single dwell incident at a stop propagates through a block's trip chain, attributing downstream OTP damage back to the originating dwell. Answers: "How much of this route's poor OTP is caused by dwell?"

---

## Status Tracker

| Phase | Task | Status |
|-------|------|--------|
| **1 — Types** | Add 6 new interfaces to `performanceDataTypes.ts` | ✅ |
| **1 — Types** | Add `byCascade?: DailyCascadeMetrics` to `DailySummary` | ✅ |
| **1 — Types** | Bump `PERFORMANCE_SCHEMA_VERSION` to 3 | ✅ |
| **2 — Engine** | Create `utils/schedule/dwellCascadeComputer.ts` | ✅ |
| **2 — Engine** | Write `tests/dwellCascadeComputer.test.ts` | ✅ |
| **2 — Engine** | Tests passing (10/10) | ✅ |
| **3 — Integration** | Hook into `performanceDataAggregator.ts` `aggregateSingleDay()` | ✅ |
| **3 — Integration** | Add `aggregateCascadeAcrossDays()` to `operatorDwellUtils.ts` | ✅ |
| **3 — Integration** | Build passes (`tsc --noEmit`, no new test failures) | ✅ |
| **4 — UI** | Create `components/Performance/DwellCascadeSection.tsx` | ✅ |
| **4 — UI** | Add sub-view toggle to `OperatorDwellModule.tsx` | ✅ |
| **4 — UI** | `tsc --noEmit` passes (rollup has pre-existing OD exporter error) | ✅ |
| **5 — Verify** | Import real STREETS CSV and verify cascades compute | ✅ |
| **5 — Verify** | Verify absorbed case (366 of 403 absorbed) | ✅ |
| **5 — Verify** | Verify multi-day aggregation with filter bar | ✅ |
| **5 — Verify** | Verify graceful fallback when `byCascade` is undefined | ✅ |

---

## What Success Looks Like

The transit operations manager can answer:

1. **"How much of Route 1's poor OTP is caused by dwell?"** — % of late trip observations that trace back to an upstream dwell incident on the same block.
2. **"Which stops are the worst offenders?"** — Stops ranked by total downstream OTP damage (blast radius), not just dwell duration.
3. **"When does the block recover?"** — For each dwell incident: how many downstream trips were late before the block got back on-time.
4. **"Is our recovery time sufficient?"** — Terminals where dwells consistently cascade = schedule needs more recovery time.

---

## Architecture

### Files Created

| File | Purpose | ~Lines |
|------|---------|--------|
| `utils/schedule/dwellCascadeComputer.ts` | Pure computation engine | ~250 |
| `components/Performance/DwellCascadeSection.tsx` | Cascade analysis UI | ~350 |
| `tests/dwellCascadeComputer.test.ts` | Unit tests | ~200 |

### Files Modified

| File | Change | ~Lines Changed |
|------|--------|----------------|
| `utils/performanceDataTypes.ts` | 6 new interfaces, `byCascade` on `DailySummary`, schema bump | ~80 added |
| `utils/performanceDataAggregator.ts` | Call `buildDailyCascadeMetrics` in `aggregateSingleDay()` | ~5 |
| `utils/schedule/operatorDwellUtils.ts` | Add `aggregateCascadeAcrossDays()` | ~50 |
| `components/Performance/OperatorDwellModule.tsx` | Sub-view toggle + render cascade section | ~20 |

### Files NOT Touched

`PerformanceWorkspace.tsx`, `PerformanceFilterBar.tsx` — no new top-level tab. Cascade lives inside the existing Operator Dwell module as a sub-view.

---

## Data Model

### Core Type: `DwellCascade`

Each dwell incident gets annotated with its downstream impact:

```typescript
interface DwellCascade {
  // Origin incident (from DwellIncident)
  date: string;
  block: string;
  routeId: string;
  routeName: string;
  stopName: string;
  stopId: string;
  tripName: string;
  operatorId: string;
  observedDepartureTime: string;
  trackedDwellSeconds: number;
  severity: DwellSeverity;

  // Cascade analysis
  excessLateSeconds: number;                  // lateness exiting the trip
  recoveryTimeAvailableSeconds: number;       // scheduled layover before next trip
  cascadedTrips: CascadeAffectedTrip[];       // ordered downstream trips affected
  blastRadius: number;                        // count of trips made late
  absorbed: boolean;                          // true = recovery contained the dwell
}
```

### Supporting Types

```typescript
interface CascadeAffectedTrip {
  tripName: string;
  routeId: string;
  terminalDepartureTime: string;              // scheduled
  observedDepartureSeconds: number | null;    // actual
  scheduledDepartureSeconds: number;
  lateSeconds: number;
  otpStatus: OTPStatus;
  recoveredHere: boolean;                     // block got back on-time at this trip
}

interface CascadeStopImpact {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  totalTrackedDwellSeconds: number;
  totalBlastRadius: number;                   // sum across all incidents at this stop
  avgBlastRadius: number;
  absorbedCount: number;
  cascadedCount: number;
  avgExcessLateSeconds: number;
}

interface TerminalRecoveryStats {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  absorbedCount: number;
  cascadedCount: number;
  avgScheduledRecoverySeconds: number;
  avgExcessLateSeconds: number;
  sufficientRecovery: boolean;                // true if >75% absorbed
}

interface DailyCascadeMetrics {
  cascades: DwellCascade[];
  byStop: CascadeStopImpact[];
  byTerminal: TerminalRecoveryStats[];
  totalCascades: number;
  totalAbsorbed: number;
  avgBlastRadius: number;
  totalCascadeOTPDamage: number;              // total trip-lateness events caused by dwell
}
```

---

## Algorithm

### Step 1 — Build Block Trip Sequences

```
Group STREETSRecord[] by block ID
For each block:
  Group by tripId → sort trips by terminalDepartureTime (scheduled)
  Result: Map<blockId, BlockTrip[]>
```

### Step 2 — Compute Exit Lateness Per Trip

```
For each trip in a block:
  Find last timepoint stop (excluding final stop — same rule as OTP eligibility)
  Exit lateness = observed departure - scheduled departure at that timepoint
  Positive = late
```

### Step 3 — Match Dwell Incidents to Blocks

```
For each DwellIncident:
  Find the trip containing this incident (match by tripName + block)
  Compute exit lateness for that trip
  Compute recovery time: next trip's scheduled start - this trip's scheduled end
```

### Step 4 — Trace Cascade Forward

```
carryover_late = exit_lateness
For each subsequent trip in the block:
  late_entering = max(0, carryover_late - recovery_time)
  If late_entering <= 0: ABSORBED → stop
  Else:
    Record as CascadeAffectedTrip
    Check if recovered (observed lateness <= 5 min)
    If recovered: stop
    Else: carryover_late = this trip's exit lateness, continue
```

### Step 5 — Aggregate

```
Group cascades by stop → CascadeStopImpact (ranked by total blast radius)
Group by terminal → TerminalRecoveryStats (is recovery sufficient?)
```

---

## Data Flow

```
STREETSRecord[] (36K records/day)
  │
  ▼
aggregateSingleDay()  [performanceDataAggregator.ts]
  │
  ├── buildOperatorDwellMetrics() → DwellIncident[]
  │
  ├── buildDailyCascadeMetrics(records, incidents)  [NEW]
  │     │
  │     ├── groupBy(block) → sequenceBlockTrips()
  │     ├── For each DwellIncident: traceCascade()
  │     ├── buildByStop() → CascadeStopImpact[]
  │     └── buildByTerminal() → TerminalRecoveryStats[]
  │     → DailyCascadeMetrics
  │
  ▼
DailySummary.byCascade = DailyCascadeMetrics
  │
  ▼
OperatorDwellModule (filtered data)
  │
  ├── aggregateCascadeAcrossDays()  [operatorDwellUtils.ts]
  │
  ▼
DwellCascadeSection renders 4 sections
```

---

## UI Layout

Inside `OperatorDwellModule`, toggled via "Incidents" | "Cascade Analysis" sub-tabs.

### Section 1 — KPI Cards

| Card | Metric |
|------|--------|
| Cascaded Incidents | Count that escaped recovery / total dwell incidents |
| Avg Blast Radius | Trips affected per cascading incident |
| Total OTP Damage | Sum of blast radius — total trip-observations damaged by dwell |
| Worst Terminal | Terminal with highest cascade rate |

### Section 2 — Stop Impact Ranking (table)

Columns: Stop Name, Route, Incidents, Cascaded, Avg Blast Radius, Total OTP Damage, Absorbed %

Sorted by total downstream OTP damage. Click row to filter cascade detail.

### Section 3 — Cascade Detail (expandable table)

Columns: Date, Block, Trip, Stop, Dwell (min), Recovery Available (min), Blast Radius, Absorbed?

Expandable row shows `cascadedTrips[]` — which trips were late, by how much, which one recovered.

### Section 4 — Terminal Recovery Analysis (table)

Columns: Terminal Stop, Route, Incidents, Absorbed %, Avg Recovery (min), Avg Excess Late (min), Status

Status badge: "Sufficient" (green, ≥75% absorbed) or "Needs More Recovery" (amber).

---

## Edge Cases & Safety

- **Missing AVL data:** If observed times are null, set `blastRadius = 0` and `absorbed = true`. Never assert lateness without evidence.
- **Overnight blocks:** Recovery time computation handles midnight wrap (`if gap < 0: gap += 86400`).
- **Old imported data:** `byCascade` is optional on `DailySummary`. UI shows "Re-import data to see cascade analysis" when undefined.
- **Schema version:** Bump `PERFORMANCE_SCHEMA_VERSION` from 2 → 3. Existing stored summaries degrade gracefully.

---

## Performance

- Computation is O(D × B) where D = dwell incidents (~50-200/day), B = block size (~3-8 trips)
- Dominated by initial groupBy which is already done in other builders
- Expected < 50ms per day — negligible vs existing aggregation
- Memory: ~1600 small objects per day max — within Firebase document limits
