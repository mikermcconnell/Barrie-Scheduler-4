# Dwell Cascade Redesign — Pure AVL Trace

> Design approved 2026-02-25. Replaces the hybrid prediction/AVL model with a pure AVL forward-walk.

---

## Problem

The current cascade algorithm uses a hybrid model:
1. **Predicted** lateness (`exitLateness - recovery`) gates cascade entry
2. **AVL observed** departure determines blast radius (over-attributes)
3. **AVL exit lateness** of downstream trip determines continuation (under-reports — operators recover mid-trip, killing the chain)

Result: cascades never go beyond 1 trip. Every top incident shows "1 trips late · Not recovered."

Root cause: downstream trips start late (AVL) but recover by their last timepoint (exit lateness drops to ~0), zeroing out the carryover. The chain breaks at trip 2 every time.

---

## Design Decisions

| Decision | Answer | Rationale |
|----------|--------|-----------|
| Purpose | Operational incident analysis | Forensic tool using real AVL data, not schedule design |
| Attribution | Pure AVL observation | Don't model counterfactuals. Show what actually happened. |
| Chain stop | First on-time departure at ANY timepoint stop | Single on-time observation kills the chain |
| Blast radius | Every late timepoint departure downstream | Stop-level, not trip-level |
| Pre-existing lateness | Show raw AVL, don't separate causes | Honest — the dwell made a bad situation worse |
| Cross-route | Follow the block | Trace across route boundaries (8A → 8B) |
| Granularity | Trip summary + expandable stop detail | Compact default, drill-down available |
| Primary action | Operator coaching | Data feeds coaching conversations |
| Placement | Inside dwell module | Current location, no elevation needed |

---

## Core Algorithm

```
For each dwell incident:
  1. Find the incident trip in the block (by block + tripName match)
  2. Walk FORWARD through every subsequent trip in the block
  3. For each downstream trip:
     a. Collect EVERY timepoint stop with scheduled vs observed departure
     b. Calculate deviation at each timepoint (observed - scheduled)
     c. If ANY timepoint departs on-time (deviation ≤ OTP late threshold) → STOP the chain
  4. Record scheduled recovery time between each pair of trips (display context only)
  5. Blast radius = total count of late timepoint departures across all affected trips
```

Key differences from current:
- **No prediction math** — no `lateEntering = exitLateness - recovery` gating
- **No exit lateness for continuation** — chain continues based on observed departures at every timepoint, not operator mid-trip recovery
- **Stop-level granularity** — blast radius counts late timepoint departures, not late trips
- **Recovery is context, not logic** — displayed alongside cascade but never used to break the chain

---

## Data Structures

```typescript
/** Each timepoint observation in a downstream trip */
interface CascadeTimepointObs {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  scheduledDeparture: string;       // HH:MM
  observedDeparture: string | null; // HH:MM:SS from AVL
  deviationSeconds: number | null;  // positive = late
  isLate: boolean;                  // deviation > OTP late threshold (300s)
}

/** Each downstream trip in the cascade chain */
interface CascadeAffectedTrip {
  tripName: string;
  tripId: string;
  routeId: string;
  routeName: string;
  terminalDepartureTime: string;
  scheduledRecoverySeconds: number;   // recovery before this trip (context only)
  timepoints: CascadeTimepointObs[];  // every timepoint in the trip
  lateTimepointCount: number;         // count of late timepoint departures
  recoveredAtStop: string | null;     // stop where first on-time observed (chain-ender)
}

/** The cascade itself */
interface DwellCascade {
  // Origin incident fields (unchanged from current)
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

  // Cascade results (redesigned)
  cascadedTrips: CascadeAffectedTrip[];
  blastRadius: number;            // total late timepoint departures across all trips
  affectedTripCount: number;      // number of trips touched before recovery
  recoveredAtTrip: string | null; // trip name where chain ended
  recoveredAtStop: string | null; // specific stop where on-time observed
  totalLateSeconds: number;       // sum of deviation across all late timepoints
}
```

`DailyCascadeMetrics` keeps the same shape (cascades, byStop, byTerminal, totals) but recalculated against the new blast radius definition (late timepoint count).

---

## Scope

| Component | Change |
|-----------|--------|
| `utils/schedule/dwellCascadeComputer.ts` | **Rewrite** — pure AVL walk, stop-level output |
| `functions/src/dwellCascadeComputer.ts` | **Rewrite** — mirror of client version |
| `utils/performanceDataTypes.ts` | **Modify** — new `CascadeTimepointObs`, updated `CascadeAffectedTrip`, `DwellCascade` |
| `components/Performance/DwellCascadeSection.tsx` | **Modify** — expandable trip detail, updated metrics |
| `utils/schedule/operatorDwellUtils.ts` | **Modify** — aggregation updated for new blast radius |
| `tests/dwellCascadeComputer.test.ts` | **Rewrite** — tests for new behavior |

**Not changing**: Dwell incident detection, STREETS parsing, aggregation pipeline shape, section placement.

---

## UI Changes

**Top Incident cards**: Each card shows trip pills (colored by severity), expandable to stop-by-stop timepoint table. Footer shows "X late timepoint departures across Y trips" and recovery point.

**Expanded trip detail** (new):
```
Trip: 8B - 8B NB - 23:07  |  Recovery: 2.0 min
┌─────────────────┬───────────┬───────────┬──────────┐
│ Stop            │ Scheduled │ Observed  │ Dev      │
├─────────────────┼───────────┼───────────┼──────────┤
│ Terminal North  │ 23:07     │ 23:21     │ +14.0 🔴 │
│ Stop B          │ 23:15     │ 23:24     │ +9.0  🔴 │
│ Stop C          │ 23:22     │ 23:26     │ +4.0  ✅ │ ← chain stops
└─────────────────┴───────────┴───────────┴──────────┘
```

**Impact banner, route attribution, stop ranking**: Same layout, recalculated with new blast radius.
