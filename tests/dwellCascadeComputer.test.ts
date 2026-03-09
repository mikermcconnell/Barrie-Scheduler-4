import { describe, it, expect } from 'vitest';
import { buildDailyCascadeMetrics } from '../utils/schedule/dwellCascadeComputer';
import type { STREETSRecord, DwellIncident, DwellSeverity } from '../utils/performanceDataTypes';

// ─── Test Helpers ─────────────────────────────────────────────────────

/** Minimal STREETS record with only fields the cascade computer uses. */
function makeRecord(overrides: Partial<STREETSRecord>): STREETSRecord {
  return {
    vehicleLocationTPKey: 1,
    vehicleId: 'V100',
    inBetween: false,
    isTripper: false,
    date: '2026-02-20',
    month: '2026-02',
    day: 'FRIDAY',
    arrivalTime: '08:00',
    observedArrivalTime: '08:00:00',
    stopTime: '08:00',
    observedDepartureTime: '08:01:00',
    wheelchairUsageCount: 0,
    departureLoad: 10,
    boardings: 2,
    alightings: 1,
    apcSource: 1,
    block: '10-01',
    operatorId: 'OP1',
    tripName: 'Trip-1',
    stopName: 'Stop A',
    routeName: 'Route 10',
    branch: '10 FULL',
    routeId: '10',
    routeStopIndex: 1,
    stopId: 'SA',
    direction: 'N',
    isDetour: false,
    stopLat: 44.0,
    stopLon: -79.0,
    timePoint: true,
    distance: 0,
    previousStopName: null,
    tripId: 'trip-guid-1',
    internalTripId: 1,
    terminalDepartureTime: '08:00',
    ...overrides,
  } as STREETSRecord;
}

function makeIncident(overrides: Partial<DwellIncident>): DwellIncident {
  return {
    operatorId: 'OP1',
    date: '2026-02-20',
    routeId: '10',
    routeName: 'Route 10',
    stopName: 'Stop B',
    stopId: 'SB',
    tripName: 'Trip-1',
    block: '10-01',
    observedArrivalTime: '08:10:00',
    observedDepartureTime: '08:15:00',
    rawDwellSeconds: 300,
    trackedDwellSeconds: 180,
    severity: 'high' as DwellSeverity,
    ...overrides,
  };
}

/**
 * Build a simple block with N trips, each having 3 stops.
 * Trip i departs at baseHour + i*intervalMin.
 * Each trip takes ~20 min with stops at +0, +10, +20 relative to terminal departure.
 *
 * Stops:
 *  - Stop 1: Terminal North (idx 1, timepoint=true)
 *  - Stop 2: Stop B (idx 2, timepoint=true)
 *  - Stop 3: Terminal South (idx 3, timepoint=false)
 *
 * maxStopIdx = 3, so both stops 1 and 2 are eligible timepoints (< maxStopIdx).
 */
function buildBlockRecords(opts: {
  block: string;
  tripCount: number;
  baseHour: number;
  intervalMin: number;
  /** Override routeId for specific trip indices */
  routeIdOverrides?: Record<number, string>;
  /** Override observed departure per trip index per routeStopIndex */
  observedDepartures?: Record<number, Record<number, string | null>>;
}): STREETSRecord[] {
  const records: STREETSRecord[] = [];
  for (let i = 0; i < opts.tripCount; i++) {
    const baseMin = opts.baseHour * 60 + i * opts.intervalMin;
    const hh = (n: number) =>
      `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
    const termDep = hh(baseMin);
    const tripName = `Trip-${i + 1}`;
    const tripId = `trip-guid-${i + 1}`;
    const routeId = opts.routeIdOverrides?.[i] ?? '10';

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
        routeId,
        routeName: routeId === '10' ? 'Route 10' : `Route ${routeId}`,
        arrivalTime: hh(stopMin),
        stopTime: hh(stopMin),
        observedArrivalTime: obs,
        observedDepartureTime: obs,
      }));
    }
  }
  return records;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('dwellCascadeComputer.buildDailyCascadeMetrics', () => {

  it('returns empty metrics when no dwell incidents', () => {
    const records = buildBlockRecords({
      block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30,
    });
    const result = buildDailyCascadeMetrics(records, []);

    expect(result.cascades).toHaveLength(0);
    expect(result.totalCascaded).toBe(0);
    expect(result.totalNonCascaded).toBe(0);
    expect(result.avgBlastRadius).toBe(0);
    expect(result.totalBlastRadius).toBe(0);
  });

  it('returns blastRadius 0 when all downstream trips are on-time', () => {
    // All trips depart on-time. Downstream trips have no late timepoints.
    // Trailing trim removes Trip-2 (0 late TPs) → cascadedTrips empty.
    const records = buildBlockRecords({
      block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    const cascade = result.cascades[0];
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(0);
    expect(cascade.totalLateSeconds).toBe(0);
    expect(result.totalNonCascaded).toBe(1);
    expect(result.totalCascaded).toBe(0);
  });

  it('traces cascade through multiple trips with recovery', () => {
    // 3 trips, 25 min apart (5 min recovery between 20 min trips).
    //
    // Trip-2 (i=0, base 08:25):
    //   Stop 1 (Terminal North): sched 08:25, obs 08:33 → dev=480s (8min) → LATE
    //   Stop 2 (Stop B):         sched 08:35, obs 08:41 → dev=360s (6min) → LATE
    //   lateTimepointCount = 2
    //
    // Trip-3 (i=1, base 08:50):
    //   Stop 1 (Terminal North): sched 08:50, obs 08:56 → dev=360s (6min) → LATE
    //   Stop 2 (Stop B):         sched 09:00, obs 09:04 → dev=240s (4min) → ON-TIME
    //     → chain breaks here (lateCount=1 > 0), recoveredAtStop = 'Stop B'
    //   lateTimepointCount = 1
    //
    // blastRadius = 2 + 1 = 3
    // totalLateSeconds = 480 + 360 + 360 = 1200
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' }, // Trip-2: +8min, +6min
        2: { 1: '08:56:00', 2: '09:04:00' }, // Trip-3: +6min, +4min (recovery)
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    const cascade = result.cascades[0];

    expect(cascade.cascadedTrips).toHaveLength(2);
    expect(cascade.blastRadius).toBe(3);
    expect(cascade.totalLateSeconds).toBe(1200);

    // Trip-2: both timepoints late
    const trip2 = cascade.cascadedTrips[0];
    expect(trip2.tripName).toBe('Trip-2');
    expect(trip2.lateTimepointCount).toBe(2);
    expect(trip2.recoveredAtStop).toBeNull();
    expect(trip2.timepoints).toHaveLength(2);
    expect(trip2.timepoints[0].isLate).toBe(true);
    expect(trip2.timepoints[0].deviationSeconds).toBe(480);
    expect(trip2.timepoints[0].boardings).toBe(2);
    expect(trip2.timepoints[1].isLate).toBe(true);
    expect(trip2.timepoints[1].deviationSeconds).toBe(360);
    expect(trip2.timepoints[1].boardings).toBe(2);

    // Trip-3: first TP late, second TP on-time → recovery
    const trip3 = cascade.cascadedTrips[1];
    expect(trip3.tripName).toBe('Trip-3');
    expect(trip3.lateTimepointCount).toBe(1);
    expect(trip3.recoveredAtStop).toBe('Stop B');
    // Trip-3 has 2 timepoints in output (late one + the on-time recovery point)
    expect(trip3.timepoints).toHaveLength(2);
    expect(trip3.timepoints[0].isLate).toBe(true);
    expect(trip3.timepoints[0].deviationSeconds).toBe(360);
    expect(trip3.timepoints[1].isLate).toBe(false);
    expect(trip3.timepoints[1].deviationSeconds).toBe(240);

    // Top-level recovery fields
    expect(cascade.recoveredAtTrip).toBe('Trip-3');
    expect(cascade.recoveredAtStop).toBe('Stop B');
    expect(cascade.affectedTripCount).toBe(2);

    expect(result.totalCascaded).toBe(1);
  });

  it('returns blastRadius 0 when first downstream TP is immediately on-time', () => {
    // First subsequent trip (i=0): first timepoint on-time, lateCount=0, i=0
    // → condition (lateCount > 0 || i > 0) = false → not chain-breaking
    // After walking all TPs with 0 late, lateCount=0 && !chainBroken → chainBroken=true
    // Trailing trim removes it → cascadedTrips empty
    const records = buildBlockRecords({
      block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0].blastRadius).toBe(0);
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
  });

  it('handles dwell on last trip in block (no subsequent trips)', () => {
    const records = buildBlockRecords({
      block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ tripName: 'Trip-2', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
    expect(result.cascades[0].blastRadius).toBe(0);
  });

  it('produces empty cascades array for non-matching block', () => {
    const records = buildBlockRecords({
      block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ block: 'UNKNOWN-BLOCK' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(0);
  });

  it('produces empty cascades array for non-matching trip', () => {
    const records = buildBlockRecords({
      block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ tripName: 'NonExistent-Trip', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(0);
  });

  it('computes scheduledRecoverySeconds correctly', () => {
    // 25 min interval, 20 min trip → 5 min recovery = 300s
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' }, // Trip-2 late to create cascade
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    // Trip-2's scheduledRecoverySeconds = Trip-2 sched start (08:25) - Trip-1 last stop arrival (08:20) = 300s
    expect(cascade.cascadedTrips.length).toBeGreaterThanOrEqual(1);
    expect(cascade.cascadedTrips[0].scheduledRecoverySeconds).toBe(300);
  });

  it('cascades across different routeIds within the same block', () => {
    // Trip-2 has a different routeId but same block → still cascades
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      routeIdOverrides: { 1: '20' }, // Trip-2 is on Route 20
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' }, // Trip-2: both TPs late
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.cascadedTrips).toHaveLength(1);
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-2');
    expect(cascade.cascadedTrips[0].routeId).toBe('20');
    expect(cascade.cascadedTrips[0].lateTimepointCount).toBe(2);
    expect(cascade.blastRadius).toBe(2);
  });

  it('skips timepoints with null observed departures without breaking chain', () => {
    // Trip-2 (i=0): Stop 1 null obs → skip, Stop 2 late → lateCount=1
    // Trip-3 (i=1): Stop 1 on-time → chain breaks (lateCount=0 but i>0)
    //   Actually: Trip-3 first TP is on-time, i=1 > 0, so condition is true → chain breaks
    //   Trip-3 lateTimepointCount = 0. Trailing trim removes Trip-3.
    //   Trip-2 has lateTimepointCount=1 → stays.
    // blastRadius = 1
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: null, 2: '08:41:00' }, // Trip-2: null at Stop 1, 6min late at Stop 2
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    // Trip-2 should have 2 timepoints observed (null skip + late)
    const trip2 = cascade.cascadedTrips[0];
    expect(trip2.tripName).toBe('Trip-2');

    // The null timepoint should appear with null deviation and isLate=false
    const nullTp = trip2.timepoints.find(tp => tp.stopName === 'Terminal North');
    expect(nullTp).toBeDefined();
    expect(nullTp!.observedDeparture).toBeNull();
    expect(nullTp!.deviationSeconds).toBeNull();
    expect(nullTp!.isLate).toBe(false);

    // The late timepoint at Stop B
    const lateTp = trip2.timepoints.find(tp => tp.stopName === 'Stop B');
    expect(lateTp).toBeDefined();
    expect(lateTp!.isLate).toBe(true);
    expect(lateTp!.deviationSeconds).toBe(360); // 6 min

    expect(trip2.lateTimepointCount).toBe(1);
    expect(cascade.blastRadius).toBe(1);
  });

  it('does not treat a fully missing-AVL downstream trip as recovery', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: null, 2: null }, // Trip-2 has no usable AVL at any timepoint
        2: { 1: '08:57:00', 2: '09:06:00' }, // Trip-3 is still late downstream
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.recoveredAtTrip).toBeNull();
    expect(cascade.cascadedTrips).toHaveLength(1);
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-3');
    expect(cascade.cascadedTrips[0].lateTimepointCount).toBe(2);
    expect(cascade.blastRadius).toBe(2);
  });

  it('sums totalLateSeconds across all late timepoints', () => {
    // Trip-2: Stop 1 dev=480s (late), Stop 2 dev=360s (late)
    // Trip-3: Stop 1 dev=360s (late), Stop 2 dev=240s (on-time, recovery)
    // totalLateSeconds = 480 + 360 + 360 = 1200
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' },
        2: { 1: '08:56:00', 2: '09:04:00' },
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.totalLateSeconds).toBe(1200);
  });

  it('ranks byStop by totalBlastRadius descending', () => {
    // Two incidents at different stops, one cascading, one not
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 4,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' }, // Trip-2 late (from Trip-1 incident)
      },
    });

    const cascadingIncident = makeIncident({
      tripName: 'Trip-1',
      block: '10-01',
      stopName: 'Bad Stop',
      stopId: 'BS',
    });
    const absorbedIncident = makeIncident({
      tripName: 'Trip-3',
      block: '10-01',
      stopName: 'Fine Stop',
      stopId: 'FS',
    });

    const result = buildDailyCascadeMetrics(records, [cascadingIncident, absorbedIncident]);

    expect(result.byStop.length).toBeGreaterThanOrEqual(1);
    const badStop = result.byStop.find(s => s.stopName === 'Bad Stop');
    const fineStop = result.byStop.find(s => s.stopName === 'Fine Stop');
    expect(badStop).toBeDefined();

    if (badStop && fineStop) {
      // Bad Stop should rank higher (first in sorted order)
      const badIdx = result.byStop.indexOf(badStop);
      const fineIdx = result.byStop.indexOf(fineStop);
      expect(badIdx).toBeLessThan(fineIdx);
      expect(badStop.totalBlastRadius).toBeGreaterThan(fineStop.totalBlastRadius);
    }
  });

  it('breaks chain on first on-time TP even when later TP in same trip is late', () => {
    // Trip-2 (i=0): TP1 on-time (dev=0), TP2 late (dev=480s)
    // Bug: old code with (lateCount > 0 || i > 0) would NOT break on TP1
    //       because lateCount=0 and i=0, allowing TP2-lateness to propagate.
    // Fix: any on-time TP breaks the chain unconditionally.
    //       TP1 on-time → chain absorbed → TP2 lateness should NOT count.
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        // Trip-2: first TP on-time, second TP late
        1: { 1: '08:25:00', 2: '08:43:00' }, // TP1: dev=0 (on-time), TP2: dev=480s (late)
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    // Chain should break at Trip-2 TP1 (on-time) → no late departures count
    // Trailing trim removes Trip-2 (0 late TPs) → cascadedTrips empty
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(0);
    expect(result.totalNonCascaded).toBe(1);
  });

  it('picks canonical (closest-to-schedule) observation when duplicates exist', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 2,
      baseHour: 8,
      intervalMin: 30,
    });

    // Add a duplicate observation for Trip-1 @ routeStopIndex 2 (Stop B).
    // The original is on-time (08:10:00), this duplicate is 8 min late (08:18:00).
    // Canonical = closest to schedule = 08:10:00 (on-time).
    records.push(makeRecord({
      block: '10-01',
      tripName: 'Trip-1',
      tripId: 'trip-guid-1',
      terminalDepartureTime: '08:00',
      routeStopIndex: 2,
      stopName: 'Stop B',
      stopId: 'SB',
      timePoint: true,
      arrivalTime: '08:10',
      stopTime: '08:10',
      observedArrivalTime: '08:18:00',
      observedDepartureTime: '08:18:00',
    }));

    // Also add a duplicate for Trip-2 @ routeStopIndex 1 with a late reading.
    // On-time default (08:30:00) should be chosen over this late one.
    records.push(makeRecord({
      block: '10-01',
      tripName: 'Trip-2',
      tripId: 'trip-guid-2',
      terminalDepartureTime: '08:30',
      routeStopIndex: 1,
      stopName: 'Terminal North',
      stopId: 'TN',
      timePoint: true,
      arrivalTime: '08:30',
      stopTime: '08:30',
      observedArrivalTime: '08:40:00',
      observedDepartureTime: '08:40:00',
    }));

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    // Canonical row for Trip-2 Stop 1 is on-time → no cascade
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(0);
  });
});
