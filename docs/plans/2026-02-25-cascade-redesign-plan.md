# Cascade Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hybrid prediction/AVL dwell cascade algorithm with a pure AVL forward-walk that traces stop-level lateness through blocks.

**Architecture:** Rewrite `dwellCascadeComputer.ts` with a new `traceCascade` that walks every timepoint stop in every subsequent trip using only AVL observations. No prediction math, no exit-lateness gating. Chain stops at first on-time timepoint departure. Recovery time is computed and displayed as context but never used in cascade logic.

**Tech Stack:** TypeScript, Vitest, React (Tailwind CSS)

**Design Doc:** `docs/plans/2026-02-25-cascade-redesign-design.md`

---

### Task 1: Update Type Definitions

**Files:**
- Modify: `utils/performanceDataTypes.ts:124-193`

**Step 1: Add CascadeTimepointObs and update CascadeAffectedTrip and DwellCascade**

Replace the cascade type block (lines 124-193) with:

```typescript
// ─── Dwell Cascade Types ──────────────────────────────────────────────

/** Each timepoint observation in a downstream trip. */
export interface CascadeTimepointObs {
  stopName: string;
  stopId: string;
  routeStopIndex: number;
  scheduledDeparture: string;       // HH:MM
  observedDeparture: string | null; // HH:MM:SS from AVL
  deviationSeconds: number | null;  // positive = late, null = no AVL
  isLate: boolean;                  // deviation > OTP late threshold (300s)
}

/** A downstream trip affected by a dwell incident earlier on the same block. */
export interface CascadeAffectedTrip {
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

/** A dwell incident annotated with its downstream cascade through the block. */
export interface DwellCascade {
  // Origin incident fields
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

  // Cascade results
  cascadedTrips: CascadeAffectedTrip[];
  blastRadius: number;            // total late timepoint departures across all trips
  affectedTripCount: number;      // number of trips touched before recovery
  recoveredAtTrip: string | null; // trip name where chain ended
  recoveredAtStop: string | null; // specific stop where on-time observed
  totalLateSeconds: number;       // sum of deviation across all late timepoints
}
```

Keep `CascadeStopImpact` (lines 158-169) — update `avgExcessLateSeconds` field to `avgTotalLateSeconds`:

```typescript
export interface CascadeStopImpact {
  stopName: string;
  stopId: string;
  routeId: string;
  incidentCount: number;
  totalTrackedDwellSeconds: number;
  totalBlastRadius: number;
  avgBlastRadius: number;
  cascadedCount: number;        // incidents that produced any cascade
  nonCascadedCount: number;     // incidents with no downstream late timepoints
  avgTotalLateSeconds: number;  // avg totalLateSeconds per cascading incident
}
```

Keep `TerminalRecoveryStats` (lines 172-182) unchanged — it still makes sense as context.

Update `DailyCascadeMetrics` (lines 185-193):

```typescript
export interface DailyCascadeMetrics {
  cascades: DwellCascade[];
  byStop: CascadeStopImpact[];
  byTerminal: TerminalRecoveryStats[];
  totalCascaded: number;          // incidents that produced cascade
  totalNonCascaded: number;       // incidents with no downstream impact
  avgBlastRadius: number;         // avg late-timepoint-departures per cascading incident
  totalBlastRadius: number;       // sum of all blast radii
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: Errors in files that consume the old types (dwellCascadeComputer, DwellCascadeSection, operatorDwellUtils). This is expected — we fix them in subsequent tasks.

**Step 3: Commit**

```bash
git add utils/performanceDataTypes.ts
git commit -m "refactor: update cascade types for pure AVL redesign"
```

---

### Task 2: Rewrite the Cascade Computer (Client)

**Files:**
- Rewrite: `utils/schedule/dwellCascadeComputer.ts`

**Step 1: Write the new dwellCascadeComputer.ts**

Keep the existing helpers that are still needed:
- `timeToSeconds` (line 31) — unchanged
- `safeDivide` (line 47) — unchanged
- `chooseCanonicalStopRecord` (line 52) — unchanged
- `dedupeTripRecords` (line 73) — unchanged
- `buildBlockTripSequences` (line 92) — unchanged
- `computeRecoveryTime` (line 185) — unchanged

**Remove** these functions (no longer needed):
- `computeTripExitLateness` (line 143) — was the hybrid gating logic
- `getActualFirstTimepointDeparture` (line 172) — replaced by stop-level walk

**Replace** `traceCascade` (line 198-273) with new pure AVL walk:

```typescript
function traceCascade(
  incident: DwellIncident,
  incidentTrip: BlockTrip,
  subsequentTrips: BlockTrip[],
): DwellCascade {
  const cascadedTrips: CascadeAffectedTrip[] = [];
  let totalBlastRadius = 0;
  let totalLateSeconds = 0;
  let recoveredAtTrip: string | null = null;
  let recoveredAtStop: string | null = null;
  let chainBroken = false;

  for (let i = 0; i < subsequentTrips.length && !chainBroken; i++) {
    const nextTrip = subsequentTrips[i];
    const prevTrip = i === 0 ? incidentTrip : subsequentTrips[i - 1];
    const recovery = computeRecoveryTime(prevTrip, nextTrip);

    const timepoints: CascadeTimepointObs[] = [];
    let lateTimepointCount = 0;
    let tripRecoveredAtStop: string | null = null;

    // Walk every timepoint stop in this trip
    for (const rec of nextTrip.records) {
      if (!rec.timePoint) continue;

      const scheduledSec = timeToSeconds(rec.stopTime);
      let deviationSeconds: number | null = null;
      let isLate = false;

      if (rec.observedDepartureTime) {
        const observedSec = timeToSeconds(rec.observedDepartureTime);
        deviationSeconds = observedSec - scheduledSec;
        // Post-midnight guard
        if (deviationSeconds < -43200) deviationSeconds += 86400;
        if (deviationSeconds > 43200) deviationSeconds -= 86400;

        isLate = deviationSeconds > OTP_THRESHOLDS.lateSeconds;

        if (isLate) {
          lateTimepointCount++;
          totalLateSeconds += deviationSeconds;
        } else {
          // First on-time timepoint departure → chain stops
          tripRecoveredAtStop = rec.stopName;
          chainBroken = true;
        }
      }
      // else: no AVL data for this timepoint — skip (don't count, don't break)

      timepoints.push({
        stopName: rec.stopName,
        stopId: rec.stopId,
        routeStopIndex: rec.routeStopIndex,
        scheduledDeparture: rec.stopTime,
        observedDeparture: rec.observedDepartureTime,
        deviationSeconds,
        isLate,
      });

      if (chainBroken) break;
    }

    totalBlastRadius += lateTimepointCount;

    cascadedTrips.push({
      tripName: nextTrip.tripName,
      tripId: nextTrip.tripId,
      routeId: nextTrip.routeId,
      routeName: nextTrip.routeName,
      terminalDepartureTime: nextTrip.records[0].terminalDepartureTime,
      scheduledRecoverySeconds: recovery,
      timepoints,
      lateTimepointCount,
      recoveredAtStop: tripRecoveredAtStop,
    });

    if (tripRecoveredAtStop) {
      recoveredAtTrip = nextTrip.tripName;
      recoveredAtStop = tripRecoveredAtStop;
    }
  }

  // Remove trailing trips with 0 late timepoints (they weren't really affected)
  while (cascadedTrips.length > 0 && cascadedTrips[cascadedTrips.length - 1].lateTimepointCount === 0) {
    cascadedTrips.pop();
  }

  return {
    date: incident.date,
    block: incident.block,
    routeId: incident.routeId,
    routeName: incident.routeName,
    stopName: incident.stopName,
    stopId: incident.stopId,
    tripName: incident.tripName,
    operatorId: incident.operatorId,
    observedDepartureTime: incident.observedDepartureTime,
    trackedDwellSeconds: incident.trackedDwellSeconds,
    severity: incident.severity,
    cascadedTrips,
    blastRadius: totalBlastRadius,
    affectedTripCount: cascadedTrips.length,
    recoveredAtTrip,
    recoveredAtStop,
    totalLateSeconds,
  };
}
```

**Replace** `buildByStop` (line 277-311) — update for new type fields:

```typescript
function buildByStop(cascades: DwellCascade[]): CascadeStopImpact[] {
  const map = new Map<string, DwellCascade[]>();
  for (const c of cascades) {
    const key = `${c.stopId}||${c.stopName}||${c.routeId}`;
    const arr = map.get(key);
    if (arr) arr.push(c);
    else map.set(key, [c]);
  }

  const results: CascadeStopImpact[] = [];
  for (const [, group] of map) {
    const first = group[0];
    const cascaded = group.filter(c => c.blastRadius > 0);
    const nonCascaded = group.length - cascaded.length;
    const totalBlast = group.reduce((s, c) => s + c.blastRadius, 0);
    const totalDwell = group.reduce((s, c) => s + c.trackedDwellSeconds, 0);
    const totalLate = cascaded.reduce((s, c) => s + c.totalLateSeconds, 0);

    results.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: group.length,
      totalTrackedDwellSeconds: totalDwell,
      totalBlastRadius: totalBlast,
      avgBlastRadius: safeDivide(totalBlast, cascaded.length),
      cascadedCount: cascaded.length,
      nonCascadedCount: nonCascaded,
      avgTotalLateSeconds: safeDivide(totalLate, cascaded.length),
    });
  }

  return results.sort((a, b) => b.totalBlastRadius - a.totalBlastRadius || b.cascadedCount - a.cascadedCount);
}
```

**Replace** `buildByTerminal` (line 313-372) — keep the structure but use new fields:

```typescript
function buildByTerminal(cascades: DwellCascade[], blockTrips: Map<string, BlockTrip[]>): TerminalRecoveryStats[] {
  const terminalMap = new Map<string, { cascades: DwellCascade[]; recoveryTimes: number[] }>();

  for (const c of cascades) {
    const trips = blockTrips.get(c.block);
    if (!trips) continue;
    const tripIdx = trips.findIndex(t => t.tripName === c.tripName);
    if (tripIdx < 0) continue;

    const trip = trips[tripIdx];
    const lastRec = trip.records[trip.records.length - 1];
    const terminalKey = `${lastRec.stopId}||${lastRec.stopName}||${c.routeId}`;

    // Recovery = time to the NEXT trip after the incident trip
    const nextTrip = tripIdx < trips.length - 1 ? trips[tripIdx + 1] : null;
    const recovery = nextTrip ? computeRecoveryTime(trip, nextTrip) : 0;

    const entry = terminalMap.get(terminalKey);
    if (entry) {
      entry.cascades.push(c);
      entry.recoveryTimes.push(recovery);
    } else {
      terminalMap.set(terminalKey, { cascades: [c], recoveryTimes: [recovery] });
    }
  }

  const results: TerminalRecoveryStats[] = [];
  for (const [, entry] of terminalMap) {
    const first = entry.cascades[0];
    const trips = blockTrips.get(first.block);
    if (!trips) continue;
    const tripIdx = trips.findIndex(t => t.tripName === first.tripName);
    if (tripIdx < 0) continue;
    const trip = trips[tripIdx];
    const lastRec = trip.records[trip.records.length - 1];

    const cascadedCount = entry.cascades.filter(c => c.blastRadius > 0).length;
    const nonCascadedCount = entry.cascades.length - cascadedCount;
    const totalRecovery = entry.recoveryTimes.reduce((s, r) => s + r, 0);
    const totalLate = entry.cascades.reduce((s, c) => s + c.totalLateSeconds, 0);

    results.push({
      stopName: lastRec.stopName,
      stopId: lastRec.stopId,
      routeId: first.routeId,
      incidentCount: entry.cascades.length,
      absorbedCount: nonCascadedCount,
      cascadedCount,
      avgScheduledRecoverySeconds: safeDivide(totalRecovery, entry.cascades.length),
      avgExcessLateSeconds: safeDivide(totalLate, entry.cascades.length),
      sufficientRecovery: nonCascadedCount >= entry.cascades.length * 0.75,
    });
  }

  return results.sort((a, b) => b.cascadedCount - a.cascadedCount || a.absorbedCount - b.absorbedCount);
}
```

**Replace** `buildDailyCascadeMetrics` (line 376-454) — simplified main entry:

```typescript
export function buildDailyCascadeMetrics(
  records: STREETSRecord[],
  dwellIncidents: DwellIncident[],
): DailyCascadeMetrics {
  if (dwellIncidents.length === 0) {
    return {
      cascades: [],
      byStop: [],
      byTerminal: [],
      totalCascaded: 0,
      totalNonCascaded: 0,
      avgBlastRadius: 0,
      totalBlastRadius: 0,
    };
  }

  const blockTrips = buildBlockTripSequences(records);
  const cascades: DwellCascade[] = [];

  for (const incident of dwellIncidents) {
    const trips = blockTrips.get(incident.block);
    if (!trips) continue;

    const tripIdx = trips.findIndex(t => t.tripName === incident.tripName);
    if (tripIdx < 0) continue;

    const incidentTrip = trips[tripIdx];
    const subsequentTrips = trips.slice(tripIdx + 1);
    cascades.push(traceCascade(incident, incidentTrip, subsequentTrips));
  }

  const cascadedOnly = cascades.filter(c => c.blastRadius > 0);
  const totalBlast = cascades.reduce((s, c) => s + c.blastRadius, 0);

  return {
    cascades,
    byStop: buildByStop(cascades),
    byTerminal: buildByTerminal(cascades, blockTrips),
    totalCascaded: cascadedOnly.length,
    totalNonCascaded: cascades.length - cascadedOnly.length,
    avgBlastRadius: safeDivide(
      totalBlast,
      cascadedOnly.length,
    ),
    totalBlastRadius: totalBlast,
  };
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`

Expected: Errors only in consuming files (DwellCascadeSection, operatorDwellUtils, tests) — NOT in dwellCascadeComputer.ts itself.

**Step 3: Commit**

```bash
git add utils/schedule/dwellCascadeComputer.ts
git commit -m "refactor: rewrite cascade computer with pure AVL forward-walk"
```

---

### Task 3: Write Tests for New Algorithm

**Files:**
- Rewrite: `tests/dwellCascadeComputer.test.ts`

**Step 1: Update test helpers**

The existing `makeRecord` and `makeIncident` helpers are fine. Update `buildBlockRecords` to support per-stop observed departure overrides (not just mid and first):

```typescript
function buildBlockRecords(opts: {
  block: string;
  tripCount: number;
  baseHour: number;
  intervalMin: number;
  /** Override observed departure per trip index per routeStopIndex */
  observedDepartures?: Record<number, Record<number, string | null>>;
}): STREETSRecord[] {
  const records: STREETSRecord[] = [];
  for (let i = 0; i < opts.tripCount; i++) {
    const baseMin = opts.baseHour * 60 + i * opts.intervalMin;
    const hh = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
    const termDep = hh(baseMin);
    const tripName = `Trip-${i + 1}`;
    const tripId = `trip-guid-${i + 1}`;

    // 3 stops: Terminal (TP), Mid (TP), End (non-TP)
    const stops = [
      { stopName: 'Terminal North', stopId: 'TN', idx: 1, tp: true, minOffset: 0 },
      { stopName: 'Stop B', stopId: 'SB', idx: 2, tp: true, minOffset: 10 },
      { stopName: 'Terminal South', stopId: 'TS', idx: 3, tp: false, minOffset: 20 },
    ];

    for (const stop of stops) {
      const stopMin = baseMin + stop.minOffset;
      const overrideObs = opts.observedDepartures?.[i]?.[stop.idx];
      const defaultObs = `${hh(stopMin)}:00`;
      const obs = overrideObs === undefined ? defaultObs : overrideObs;

      records.push(makeRecord({
        block: opts.block,
        tripName,
        tripId,
        terminalDepartureTime: termDep,
        stopName: stop.stopName,
        stopId: stop.stopId,
        routeStopIndex: stop.idx,
        timePoint: stop.tp,
        arrivalTime: hh(stopMin),
        stopTime: hh(stopMin),
        observedArrivalTime: obs,
        observedDepartureTime: obs,
      }));
    }
  }
  return records;
}
```

**Step 2: Write core test cases**

```typescript
describe('dwellCascadeComputer.buildDailyCascadeMetrics (pure AVL)', () => {

  it('returns empty metrics when no dwell incidents', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30 });
    const result = buildDailyCascadeMetrics(records, []);
    expect(result.cascades).toHaveLength(0);
    expect(result.totalCascaded).toBe(0);
    expect(result.totalNonCascaded).toBe(0);
  });

  it('reports no cascade when all downstream timepoints are on-time', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0].blastRadius).toBe(0);
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
    expect(result.totalNonCascaded).toBe(1);
  });

  it('traces cascade through multiple trips until first on-time timepoint', () => {
    // Trip 1: incident trip (doesn't matter what its times are)
    // Trip 2: both TPs late (8 min, 6 min)
    // Trip 3: first TP late (4 min), second TP on-time (2 min) → chain stops at Trip 3, stop B
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 4,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        // Trip 2 (index 1): both timepoints late
        1: { 1: '08:33:00', 2: '08:41:00' },  // +8 min, +6 min (sched 08:25, 08:35)
        // Trip 3 (index 2): first TP late, second TP on-time
        2: { 1: '08:54:00', 2: '09:02:00' },   // +4 min, +2 min (sched 08:50, 09:00)
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.cascadedTrips).toHaveLength(2);
    expect(cascade.affectedTripCount).toBe(2);

    // Trip 2: 2 late timepoints
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-2');
    expect(cascade.cascadedTrips[0].lateTimepointCount).toBe(2);
    expect(cascade.cascadedTrips[0].recoveredAtStop).toBeNull();

    // Trip 3: 1 late TP + chain stops at Stop B (on-time)
    expect(cascade.cascadedTrips[1].tripName).toBe('Trip-3');
    expect(cascade.cascadedTrips[1].lateTimepointCount).toBe(1);
    expect(cascade.cascadedTrips[1].recoveredAtStop).toBe('Stop B');

    // Blast radius = 2 (Trip 2) + 1 (Trip 3) = 3 late timepoint departures
    expect(cascade.blastRadius).toBe(3);
    expect(cascade.recoveredAtTrip).toBe('Trip-3');
    expect(cascade.recoveredAtStop).toBe('Stop B');
  });

  it('stops chain immediately when first downstream timepoint is on-time', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 30,
      // Trip 2: first TP on-time → chain stops immediately
      observedDepartures: { 1: { 1: '08:30:00', 2: '08:40:00' } },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades[0].blastRadius).toBe(0);
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
  });

  it('handles last trip in block (no subsequent trips)', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ tripName: 'Trip-2', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
    expect(result.cascades[0].blastRadius).toBe(0);
  });

  it('handles non-matching block gracefully', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ block: 'UNKNOWN' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(0);
  });

  it('handles non-matching trip name gracefully', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ tripName: 'Nonexistent', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(0);
  });

  it('includes recovery time as context on each affected trip', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25, // 25 min cycle, 20 min trip = 5 min recovery
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:43:00' }, // both late
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    const trip2 = result.cascades[0].cascadedTrips[0];
    expect(trip2.scheduledRecoverySeconds).toBe(300); // 5 min
  });

  it('traces across route boundaries within a block', () => {
    // Build records where Trip 2 is a different route
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:43:00' }, // Trip 2 late
      },
    });
    // Change Trip 2's route
    for (const r of records) {
      if (r.tripName === 'Trip-2') {
        r.routeId = '8B';
        r.routeName = 'Route 8B';
      }
    }

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades[0].cascadedTrips[0].routeId).toBe('8B');
    expect(result.cascades[0].cascadedTrips[0].lateTimepointCount).toBe(2);
  });

  it('skips timepoints without AVL data (does not count, does not break chain)', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        // Trip 2: first TP has no AVL (null), second TP is late
        1: { 1: null, 2: '08:43:00' },
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    const trip2 = result.cascades[0].cascadedTrips[0];
    // Should have 2 timepoint entries but only 1 counted as late
    expect(trip2.timepoints).toHaveLength(2);
    expect(trip2.lateTimepointCount).toBe(1);
  });

  it('computes totalLateSeconds as sum of all deviations at late timepoints', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:43:00' }, // +8 min, +8 min = 960 sec total
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades[0].totalLateSeconds).toBe(960);
  });

  it('builds byStop ranked by total blast radius', () => {
    // Two incidents at different stops
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 4,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:43:00' }, // Trip 2 late
      },
    });

    const bigIncident = makeIncident({ tripName: 'Trip-1', block: '10-01', stopName: 'Bad Stop', stopId: 'BS' });
    const smallIncident = makeIncident({ tripName: 'Trip-3', block: '10-01', stopName: 'Fine Stop', stopId: 'FS' });

    const result = buildDailyCascadeMetrics(records, [bigIncident, smallIncident]);
    expect(result.byStop.length).toBeGreaterThanOrEqual(1);
    const badStop = result.byStop.find(s => s.stopName === 'Bad Stop');
    expect(badStop).toBeDefined();
    expect(badStop!.totalBlastRadius).toBeGreaterThan(0);
  });
});
```

**Step 3: Run tests to verify they fail (no implementation yet if doing TDD) or pass (if Task 2 already done)**

Run: `npx vitest run tests/dwellCascadeComputer.test.ts`

Expected: All tests pass (since Task 2 implemented the algorithm).

**Step 4: Commit**

```bash
git add tests/dwellCascadeComputer.test.ts
git commit -m "test: rewrite cascade tests for pure AVL algorithm"
```

---

### Task 4: Update the Aggregation Utility

**Files:**
- Modify: `utils/schedule/operatorDwellUtils.ts:67-165`

**Step 1: Update aggregateCascadeAcrossDays for new types**

Replace the function body to use new field names:

```typescript
export function aggregateCascadeAcrossDays(days: DailySummary[]): DailyCascadeMetrics {
  const cascades: DwellCascade[] = days.flatMap(d => d.byCascade?.cascades ?? []);

  if (cascades.length === 0) {
    return {
      cascades: [],
      byStop: [],
      byTerminal: [],
      totalCascaded: 0,
      totalNonCascaded: 0,
      avgBlastRadius: 0,
      totalBlastRadius: 0,
    };
  }

  // Re-aggregate byStop
  const stopMap = new Map<string, DwellCascade[]>();
  for (const c of cascades) {
    const key = `${c.stopId}||${c.stopName}||${c.routeId}`;
    const arr = stopMap.get(key);
    if (arr) arr.push(c);
    else stopMap.set(key, [c]);
  }

  const byStop: CascadeStopImpact[] = [];
  for (const [, group] of stopMap) {
    const first = group[0];
    const cascaded = group.filter(c => c.blastRadius > 0);
    const nonCascaded = group.length - cascaded.length;
    const totalBlast = group.reduce((s, c) => s + c.blastRadius, 0);
    const totalDwell = group.reduce((s, c) => s + c.trackedDwellSeconds, 0);
    const totalLate = cascaded.reduce((s, c) => s + c.totalLateSeconds, 0);

    byStop.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: group.length,
      totalTrackedDwellSeconds: totalDwell,
      totalBlastRadius: totalBlast,
      avgBlastRadius: cascaded.length > 0 ? totalBlast / cascaded.length : 0,
      cascadedCount: cascaded.length,
      nonCascadedCount: nonCascaded,
      avgTotalLateSeconds: cascaded.length > 0 ? totalLate / cascaded.length : 0,
    });
  }
  byStop.sort((a, b) => b.totalBlastRadius - a.totalBlastRadius || b.cascadedCount - a.cascadedCount);

  // Re-aggregate byTerminal
  const termMap = new Map<string, TerminalRecoveryStats[]>();
  for (const d of days) {
    for (const t of d.byCascade?.byTerminal ?? []) {
      const key = `${t.stopId}||${t.stopName}||${t.routeId}`;
      const arr = termMap.get(key);
      if (arr) arr.push(t);
      else termMap.set(key, [t]);
    }
  }

  const byTerminal: TerminalRecoveryStats[] = [];
  for (const [, group] of termMap) {
    const first = group[0];
    const totalIncidents = group.reduce((s, t) => s + t.incidentCount, 0);
    const totalAbsorbed = group.reduce((s, t) => s + t.absorbedCount, 0);
    const totalCascaded = group.reduce((s, t) => s + t.cascadedCount, 0);
    const totalRecovery = group.reduce((s, t) => s + t.avgScheduledRecoverySeconds * t.incidentCount, 0);
    const totalExcess = group.reduce((s, t) => s + t.avgExcessLateSeconds * t.incidentCount, 0);

    byTerminal.push({
      stopName: first.stopName,
      stopId: first.stopId,
      routeId: first.routeId,
      incidentCount: totalIncidents,
      absorbedCount: totalAbsorbed,
      cascadedCount: totalCascaded,
      avgScheduledRecoverySeconds: totalIncidents > 0 ? totalRecovery / totalIncidents : 0,
      avgExcessLateSeconds: totalIncidents > 0 ? totalExcess / totalIncidents : 0,
      sufficientRecovery: totalAbsorbed >= totalIncidents * 0.75,
    });
  }
  byTerminal.sort((a, b) => b.cascadedCount - a.cascadedCount || a.absorbedCount - b.absorbedCount);

  const cascadedOnly = cascades.filter(c => c.blastRadius > 0);
  const totalBlast = cascades.reduce((s, c) => s + c.blastRadius, 0);

  return {
    cascades,
    byStop,
    byTerminal,
    totalCascaded: cascadedOnly.length,
    totalNonCascaded: cascades.length - cascadedOnly.length,
    avgBlastRadius: cascadedOnly.length > 0
      ? totalBlast / cascadedOnly.length
      : 0,
    totalBlastRadius: totalBlast,
  };
}
```

**Step 2: Verify compile**

Run: `npx tsc --noEmit 2>&1 | grep "operatorDwellUtils"`

Expected: No errors in this file.

**Step 3: Commit**

```bash
git add utils/schedule/operatorDwellUtils.ts
git commit -m "refactor: update cascade aggregation for new blast radius definition"
```

---

### Task 5: Mirror Changes to Cloud Function

**Files:**
- Rewrite: `functions/src/dwellCascadeComputer.ts`

**Step 1: Copy the new algorithm from the client version**

The cloud function should be an exact mirror of `utils/schedule/dwellCascadeComputer.ts`. Copy the entire file, adjusting only the import paths (cloud function imports from `./types` not `../performanceDataTypes`).

**Step 2: Update cloud function types**

Check `functions/src/types.ts` — ensure it has the new `CascadeTimepointObs`, updated `CascadeAffectedTrip`, `DwellCascade`, `CascadeStopImpact`, and `DailyCascadeMetrics` types matching the client.

**Step 3: Verify cloud function compiles**

Run: `cd functions && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add functions/src/dwellCascadeComputer.ts functions/src/types.ts
git commit -m "refactor: mirror cascade redesign to cloud function"
```

---

### Task 6: Update DwellCascadeSection UI

**Files:**
- Modify: `components/Performance/DwellCascadeSection.tsx`

This is the largest task. Key changes:

**Step 1: Update type references and computed values**

- Replace `c.absorbed` checks with `c.blastRadius === 0` (no more `absorbed` field)
- Replace `c.excessLateSeconds` with `c.totalLateSeconds`
- Replace `metrics.totalCascades` / `metrics.totalAbsorbed` with `metrics.totalCascaded` / `metrics.totalNonCascaded`
- Replace `metrics.totalCascadeOTPDamage` with `metrics.totalBlastRadius`
- Update `cascadedOnly` filter: `metrics.cascades.filter(c => c.blastRadius > 0)`
- Update `AbsorbedBadge` to use blastRadius > 0 check

**Step 2: Update Top Incident cards**

Change the footer from `{incident.blastRadius} trips late` to:
```tsx
<span className="font-semibold text-red-600">{incident.blastRadius}</span>
{' '}late timepoint departures across{' '}
<span className="font-semibold">{incident.affectedTripCount}</span> trips
```

Add recovery info:
```tsx
{incident.recoveredAtStop ? (
  <span className="text-emerald-600"> · Recovered at {incident.recoveredAtStop}</span>
) : incident.cascadedTrips.length > 0 ? (
  <span className="text-red-500"> · Not recovered by end of block</span>
) : null}
```

**Step 3: Add expandable timepoint detail inside trip pills**

When a trip pill is clicked in the Top Incidents or Cascade Detail, show a table:

```tsx
const TimepointTable: React.FC<{ trip: CascadeAffectedTrip }> = ({ trip }) => (
  <div className="mt-2 overflow-x-auto">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          <th className="pb-1 pr-3 font-medium">Stop</th>
          <th className="pb-1 pr-2 font-medium text-right">Sched</th>
          <th className="pb-1 pr-2 font-medium text-right">Actual</th>
          <th className="pb-1 font-medium text-right">Dev</th>
        </tr>
      </thead>
      <tbody>
        {trip.timepoints.map((tp, i) => (
          <tr key={i} className="border-b border-gray-50">
            <td className="py-1 pr-3 text-gray-700">{tp.stopName}</td>
            <td className="py-1 pr-2 text-right text-gray-500 tabular-nums">
              {fmtTime(tp.scheduledDeparture)}
            </td>
            <td className="py-1 pr-2 text-right tabular-nums">
              {tp.observedDeparture ? fmtTime(tp.observedDeparture) : '—'}
            </td>
            <td className={`py-1 text-right tabular-nums font-medium ${
              tp.isLate ? 'text-red-600' : tp.deviationSeconds != null ? 'text-emerald-600' : 'text-gray-300'
            }`}>
              {tp.deviationSeconds != null ? `${tp.deviationSeconds > 0 ? '+' : ''}${fmtMin(Math.abs(tp.deviationSeconds))}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

**Step 4: Update the Cascade Detail table**

The expandable row currently shows `cascadedTrips` as simple text. Update to show trip pills with click-to-expand timepoint detail (reuse `TimepointTable`).

**Step 5: Update metric cards in details section**

- "Cascaded Incidents" → `{metrics.totalCascaded} / {metrics.cascades.length}`
- "Avg Blast Radius" → `{metrics.avgBlastRadius.toFixed(1)}` with subValue "late timepoint departures per cascade"
- "Total OTP Damage" → rename to "Total Blast Radius" → `{metrics.totalBlastRadius}`
- "Worst Terminal" → keep unchanged

**Step 6: Verify build**

Run: `npm run build`

Expected: Clean build.

**Step 7: Commit**

```bash
git add components/Performance/DwellCascadeSection.tsx
git commit -m "feat: update cascade UI with stop-level detail and expandable timepoints"
```

---

### Task 7: Run Diagnostic Against Real Data

**Files:**
- Modify: `tests/dwellCascadeDiagnostic.test.ts`

**Step 1: Update diagnostic to use new types and verify cascades now go beyond 1 trip**

Update the diagnostic to report:
- How many incidents produce multi-trip cascades
- Average affected trips per cascade
- Average blast radius (late timepoints)
- Show a few step-by-step traces proving chains go past 1 trip

**Step 2: Run diagnostic**

Run: `npx vitest run tests/dwellCascadeDiagnostic.test.ts`

Expected: Cascades now go beyond 1 trip. Blast radius numbers are higher.

**Step 3: Commit**

```bash
git add tests/dwellCascadeDiagnostic.test.ts
git commit -m "test: update cascade diagnostic for pure AVL algorithm"
```

---

### Task 8: Clean Up

**Step 1: Delete the old diagnostic test if no longer needed**

**Step 2: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass.

**Step 3: Run production build**

Run: `npm run build`

Expected: Clean build.

**Step 4: Final commit**

```bash
git commit -m "chore: cascade redesign complete — pure AVL trace with stop-level blast radius"
```
