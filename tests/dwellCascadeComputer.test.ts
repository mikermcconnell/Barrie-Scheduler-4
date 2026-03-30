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

function buildSameTripStoryRecords(opts: {
  sameTripObservedDeparture?: string | null;
  laterTripObservedDepartures?: Record<number, string | null>;
}): STREETSRecord[] {
  const makeTrip = (
    tripName: string,
    tripId: string,
    terminalDepartureTime: string,
    stopTimes: Array<{
      stopName: string;
      stopId: string;
      idx: number;
      tp: boolean;
      sched: string;
      obsArrival?: string | null;
      obsDeparture?: string | null;
    }>,
  ): STREETSRecord[] => (
    stopTimes.map(stop => makeRecord({
      block: '10-02',
      tripName,
      tripId,
      terminalDepartureTime,
      stopName: stop.stopName,
      stopId: stop.stopId,
      routeStopIndex: stop.idx,
      timePoint: stop.tp,
      arrivalTime: stop.sched,
      stopTime: stop.sched,
      observedArrivalTime: stop.obsArrival === undefined ? `${stop.sched}:00` : stop.obsArrival,
      observedDepartureTime: stop.obsDeparture === undefined ? `${stop.sched}:00` : stop.obsDeparture,
    }))
  );

  return [
    ...makeTrip('Trip-1', 'trip-guid-1', '08:00', [
      { stopName: 'Terminal North', stopId: 'TN', idx: 1, tp: true, sched: '08:00' },
      { stopName: 'Stop B', stopId: 'SB', idx: 2, tp: true, sched: '08:10', obsArrival: '08:10:00', obsDeparture: '08:15:00' },
      { stopName: 'Midway', stopId: 'MW', idx: 3, tp: true, sched: '08:18', obsDeparture: opts.sameTripObservedDeparture },
      { stopName: 'Terminal South', stopId: 'TS', idx: 4, tp: false, sched: '08:25' },
    ]),
    ...makeTrip('Trip-2', 'trip-guid-2', '08:30', [
      { stopName: 'Terminal North', stopId: 'TN', idx: 1, tp: true, sched: '08:30', obsDeparture: opts.laterTripObservedDepartures?.[1] },
      { stopName: 'Stop C', stopId: 'SC', idx: 2, tp: true, sched: '08:40', obsDeparture: opts.laterTripObservedDepartures?.[2] },
      { stopName: 'Midway', stopId: 'MW', idx: 3, tp: true, sched: '08:48', obsDeparture: opts.laterTripObservedDepartures?.[3] },
      { stopName: 'Terminal South', stopId: 'TS', idx: 4, tp: false, sched: '08:55' },
    ]),
  ];
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

  it('records immediate full recovery when all downstream trips are on-time', () => {
    // All trips depart on-time. The first downstream trip should be retained as the
    // zero-recovery milestone rather than trimmed away.
    const records = buildBlockRecords({
      block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    const cascade = result.cascades[0];
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(1);
    expect(cascade.backUnderThresholdAtTrip).toBe('Trip-2');
    expect(cascade.backUnderThresholdAtStop).toBe('Terminal North');
    expect(cascade.recoveredAtTrip).toBe('Trip-2');
    expect(cascade.recoveredAtStop).toBe('Terminal North');
    expect(cascade.totalLateSeconds).toBe(0);
    expect(result.totalNonCascaded).toBe(1);
    expect(result.totalCascaded).toBe(0);
  });

  it('traces the remainder of the incident trip before later trips and can recover on the same trip', () => {
    const records = buildSameTripStoryRecords({
      sameTripObservedDeparture: '08:18:00', // same-trip downstream point is back to zero
      laterTripObservedDepartures: {
        1: '08:36:00',
        2: '08:46:00',
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-02' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.sameTripObserved).toBe(true);
    expect(cascade.sameTripImpact).toBeTruthy();
    expect(cascade.sameTripImpact?.phase).toBe('same-trip');
    expect(cascade.sameTripImpact?.tripName).toBe('Trip-1');
    expect(cascade.sameTripImpact?.timepoints).toHaveLength(1);
    expect(cascade.sameTripImpact?.timepoints[0].stopName).toBe('Midway');
    expect(cascade.sameTripImpact?.timepoints[0].deviationSeconds).toBe(0);
    expect(cascade.sameTripImpact?.recoveredHere).toBe(true);
    expect(cascade.backUnderThresholdAtTrip).toBe('Trip-1');
    expect(cascade.backUnderThresholdAtStop).toBe('Midway');
    expect(cascade.recoveredAtTrip).toBe('Trip-1');
    expect(cascade.recoveredAtStop).toBe('Midway');
    expect(cascade.cascadedTrips).toHaveLength(0);
    expect(cascade.affectedTripCount).toBe(0);
    expect(cascade.blastRadius).toBe(0);
  });

  it('includes same-trip impact first, then later-trip carryover when delay survives the incident trip', () => {
    const records = buildSameTripStoryRecords({
      sameTripObservedDeparture: '08:24:00', // +6 min on the incident trip
      laterTripObservedDepartures: {
        1: '08:34:00', // +4 min, now back under threshold
        2: '08:40:00', // +0 min, recovered to zero
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-02' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.sameTripObserved).toBe(true);
    expect(cascade.sameTripImpact?.tripName).toBe('Trip-1');
    expect(cascade.sameTripImpact?.lateTimepointCount).toBe(1);
    expect(cascade.sameTripImpact?.affectedTimepointCount).toBe(1);
    expect(cascade.sameTripImpact?.timepoints[0].deviationSeconds).toBe(360);

    expect(cascade.cascadedTrips).toHaveLength(1);
    expect(cascade.cascadedTrips[0].phase).toBe('later-trip');
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-2');
    expect(cascade.cascadedTrips[0].affectedTimepointCount).toBe(1);
    expect(cascade.cascadedTrips[0].lateTimepointCount).toBe(0);
    expect(cascade.backUnderThresholdAtTrip).toBe('Trip-2');
    expect(cascade.backUnderThresholdAtStop).toBe('Terminal North');
    expect(cascade.recoveredAtTrip).toBe('Trip-2');
    expect(cascade.recoveredAtStop).toBe('Stop C');
    expect(cascade.affectedTripCount).toBe(1);
  });

  it('tracks back-under-threshold separately from full recovery', () => {
    // 3 trips, 25 min apart (5 min recovery between 20 min trips).
    //
    // Trip-2 (i=0, base 08:25):
    //   Stop 1 (Terminal North): sched 08:25, obs 08:33 → dev=480s (8min) → LATE
    //   Stop 2 (Stop B):         sched 08:35, obs 08:41 → dev=360s (6min) → LATE
    //   lateTimepointCount = 2
    //
    // Trip-3 (i=1, base 08:50):
    //   Stop 1 (Terminal North): sched 08:50, obs 08:56 → dev=360s (6min) → LATE
    //   Stop 2 (Stop B):         sched 09:00, obs 09:04 → dev=240s (4min) → below OTP threshold
    //     → threshold milestone recorded here, but the route is still carrying delay
    //   lateTimepointCount = 1
    //
    // blastRadius = 2 + 1 = 3
    // totalLateSeconds = 480 + 360 + 360 + 240 = 1440
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' }, // Trip-2: +8min, +6min
        2: { 1: '08:56:00', 2: '09:04:00' }, // Trip-3: +6min, +4min (below threshold, not zero)
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    const cascade = result.cascades[0];

    expect(cascade.cascadedTrips).toHaveLength(2);
    expect(cascade.blastRadius).toBe(3);
    expect(cascade.totalLateSeconds).toBe(1440);

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

    // Trip-3: first TP late, second TP drops below threshold but is still delayed
    const trip3 = cascade.cascadedTrips[1];
    expect(trip3.tripName).toBe('Trip-3');
    expect(trip3.lateTimepointCount).toBe(1);
    expect(trip3.affectedTimepointCount).toBe(2);
    expect(trip3.backUnderThresholdAtStop).toBe('Stop B');
    expect(trip3.recoveredAtStop).toBeNull();
    // Trip-3 has 2 timepoints in output (late one + the below-threshold point)
    expect(trip3.timepoints).toHaveLength(2);
    expect(trip3.timepoints[0].isLate).toBe(true);
    expect(trip3.timepoints[0].deviationSeconds).toBe(360);
    expect(trip3.timepoints[1].isLate).toBe(false);
    expect(trip3.timepoints[1].deviationSeconds).toBe(240);

    // Top-level milestone fields
    expect(cascade.backUnderThresholdAtTrip).toBe('Trip-3');
    expect(cascade.backUnderThresholdAtStop).toBe('Stop B');
    expect(cascade.recoveredAtTrip).toBeNull();
    expect(cascade.recoveredAtStop).toBeNull();
    expect(cascade.affectedTripCount).toBe(2);

    expect(result.totalCascaded).toBe(1);
  });

  it('continues tracing until attributed delay reaches zero', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 4,
      baseHour: 8,
      intervalMin: 25,
      observedDepartures: {
        1: { 1: '08:33:00', 2: '08:41:00' }, // Trip-2: +8min, +6min
        2: { 1: '08:56:00', 2: '09:04:00' }, // Trip-3: +6min, +4min
        3: { 1: '09:17:00', 2: '09:25:00' }, // Trip-4: +2min, then zero
      },
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.cascadedTrips).toHaveLength(3);
    expect(cascade.backUnderThresholdAtTrip).toBe('Trip-3');
    expect(cascade.backUnderThresholdAtStop).toBe('Stop B');
    expect(cascade.recoveredAtTrip).toBe('Trip-4');
    expect(cascade.recoveredAtStop).toBe('Stop B');
    expect(cascade.affectedTripCount).toBe(3);
    expect(cascade.totalLateSeconds).toBe(1560);

    const trip4 = cascade.cascadedTrips[2];
    expect(trip4.backUnderThresholdAtStop).toBe('Terminal North');
    expect(trip4.recoveredAtStop).toBe('Stop B');
    expect(trip4.recoveredHere).toBe(true);
    expect(trip4.timepoints[0].deviationSeconds).toBe(120);
    expect(trip4.timepoints[1].deviationSeconds).toBe(0);
  });

  it('keeps the first downstream trip when full recovery happens immediately', () => {
    const records = buildBlockRecords({
      block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30,
    });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0].blastRadius).toBe(0);
    expect(result.cascades[0].cascadedTrips).toHaveLength(1);
    expect(result.cascades[0].recoveredAtTrip).toBe('Trip-2');
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

    expect(cascade.cascadedTrips).toHaveLength(2);
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-2');
    expect(cascade.cascadedTrips[0].routeId).toBe('20');
    expect(cascade.cascadedTrips[0].lateTimepointCount).toBe(2);
    expect(cascade.cascadedTrips[1].tripName).toBe('Trip-3');
    expect(cascade.recoveredAtTrip).toBe('Trip-3');
    expect(cascade.blastRadius).toBe(2);
  });

  it('skips timepoints with null observed departures without breaking chain', () => {
    // Trip-2 (i=0): Stop 1 null obs → skip, Stop 2 late → lateCount=1
    // Trip-3 (i=1): Stop 1 on-time → full recovery at the first stop.
    // The recovery trip should now be preserved.
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
    expect(cascade.cascadedTrips).toHaveLength(2);
    expect(cascade.recoveredAtTrip).toBe('Trip-3');
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
    // Trip-3: Stop 1 dev=360s (late), Stop 2 dev=240s (below threshold, not zero)
    // totalLateSeconds = 480 + 360 + 360 + 240 = 1440
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

    expect(cascade.totalLateSeconds).toBe(1440);
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

    // Chain should break at Trip-2 TP1 (on-time) and preserve the recovery trip
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(1);
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

    // Canonical row for Trip-2 Stop 1 is on-time → immediate recovery
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(1);
  });
});
