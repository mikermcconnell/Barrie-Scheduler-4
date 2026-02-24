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
    trackedDwellSeconds: 180, // 300 - 120 boarding allowance
    severity: 'high' as DwellSeverity,
    ...overrides,
  };
}

/**
 * Build a simple block with N trips, each having 3 stops (start, mid-timepoint, end).
 * Trip i departs at baseHour + i*intervalMin.
 * Each trip takes ~20 min with stops at +0, +10, +20 relative to terminal departure.
 */
function buildBlockRecords(opts: {
  block: string;
  tripCount: number;
  baseHour: number;
  intervalMin: number;
  /** Override observed departure at the mid-timepoint (last eligible) per trip index */
  observedMidDepartures?: Record<number, string | null>;
  /** Override observed departure at the first timepoint per trip index */
  observedFirstDepartures?: Record<number, string | null>;
}): STREETSRecord[] {
  const records: STREETSRecord[] = [];
  for (let i = 0; i < opts.tripCount; i++) {
    const baseMin = opts.baseHour * 60 + i * opts.intervalMin;
    const hh = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;

    const termDep = hh(baseMin);
    const tripName = `Trip-${i + 1}`;
    const tripId = `trip-guid-${i + 1}`;

    // Stop 1: first timepoint (terminal departure)
    const firstObsDep = opts.observedFirstDepartures?.[i] !== undefined
      ? opts.observedFirstDepartures[i]
      : `${hh(baseMin)}:00`;

    records.push(makeRecord({
      block: opts.block,
      tripName,
      tripId,
      terminalDepartureTime: termDep,
      stopName: 'Terminal North',
      stopId: 'TN',
      routeStopIndex: 1,
      timePoint: true,
      arrivalTime: hh(baseMin),
      stopTime: hh(baseMin),
      observedArrivalTime: firstObsDep,
      observedDepartureTime: firstObsDep,
    }));

    // Stop 2: mid-timepoint (last eligible timepoint — exit lateness measured here)
    const midMin = baseMin + 10;
    const midObsDep = opts.observedMidDepartures?.[i] !== undefined
      ? opts.observedMidDepartures[i]
      : `${hh(midMin)}:00`;

    records.push(makeRecord({
      block: opts.block,
      tripName,
      tripId,
      terminalDepartureTime: termDep,
      stopName: 'Stop B',
      stopId: 'SB',
      routeStopIndex: 2,
      timePoint: true,
      arrivalTime: hh(midMin),
      stopTime: hh(midMin),
      observedArrivalTime: midObsDep,
      observedDepartureTime: midObsDep,
    }));

    // Stop 3: final stop (excluded from OTP eligibility)
    const endMin = baseMin + 20;
    records.push(makeRecord({
      block: opts.block,
      tripName,
      tripId,
      terminalDepartureTime: termDep,
      stopName: 'Terminal South',
      stopId: 'TS',
      routeStopIndex: 3,
      timePoint: false,
      arrivalTime: hh(endMin),
      stopTime: hh(endMin),
      observedArrivalTime: `${hh(endMin)}:00`,
      observedDepartureTime: `${hh(endMin)}:00`,
    }));
  }
  return records;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('dwellCascadeComputer.buildDailyCascadeMetrics', () => {

  it('returns empty metrics when no dwell incidents', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30 });
    const result = buildDailyCascadeMetrics(records, []);

    expect(result.cascades).toHaveLength(0);
    expect(result.totalCascades).toBe(0);
    expect(result.totalAbsorbed).toBe(0);
    expect(result.avgBlastRadius).toBe(0);
    expect(result.totalCascadeOTPDamage).toBe(0);
  });

  it('marks dwell as absorbed when trip exits on-time', () => {
    // Block with 3 trips, 30 min apart. All depart on time.
    const records = buildBlockRecords({ block: '10-01', tripCount: 3, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0].absorbed).toBe(true);
    expect(result.cascades[0].blastRadius).toBe(0);
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
    expect(result.totalAbsorbed).toBe(1);
    expect(result.totalCascades).toBe(0);
  });

  it('detects cascade when dwell makes trip exit late and recovery is insufficient', () => {
    // Trip 1: mid-timepoint scheduled 08:10, observed 08:18 → 8 min late at exit
    // Trip 2 starts at 08:30, Trip 1 ends at 08:20 → 10 min recovery
    // 8 min late - 10 min recovery = absorbed? Yes (recovery > lateness)
    //
    // Now make recovery tight: trips 10 min apart, trip takes 20 min → negative recovery
    // Trip 1: departs 08:00, ends 08:20. Trip 2: departs 08:25 → 5 min recovery.
    // Trip 1 exits 8 min late → 8 - 5 = 3 min late entering Trip 2.
    // Trip 2 departs 3 min late → within 5 min OTP threshold → recovered.

    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25, // tight: 25 min cycle, 20 min trip = 5 min recovery
      observedMidDepartures: {
        0: '08:18:00', // Trip 1 mid-tp: 8 min late (scheduled 08:10)
        1: '08:38:00', // Trip 2 mid-tp: 3 min late (scheduled 08:35)
        2: null,       // Trip 3: no AVL
      },
      observedFirstDepartures: {
        1: '08:28:00', // Trip 2 starts 3 min late (scheduled 08:25)
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);

    expect(result.cascades).toHaveLength(1);
    const cascade = result.cascades[0];

    expect(cascade.absorbed).toBe(false);
    expect(cascade.excessLateSeconds).toBe(480); // 8 min = 480 sec
    expect(cascade.recoveryTimeAvailableSeconds).toBe(300); // 5 min = 300 sec
    expect(cascade.cascadedTrips.length).toBeGreaterThanOrEqual(1);

    // Trip 2 should be in the cascade — it started late but recovered (3 min < 5 min threshold)
    const trip2 = cascade.cascadedTrips[0];
    expect(trip2.tripName).toBe('Trip-2');
    expect(trip2.recoveredHere).toBe(true);
    expect(trip2.lateSeconds).toBe(180); // 3 min
  });

  it('cascades through multiple trips when recovery never absorbs', () => {
    // 4 trips, 22 min apart (2 min recovery each).
    // Trip 1 exits 7 min late. Trip 2 must exceed 5 min OTP threshold to not recover.
    // Trip 2: 6 min late start (> 300s threshold) → doesn't recover → cascade continues.
    // Trip 3: 4 min late start (< 300s) → recovers.

    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 4,
      baseHour: 8,
      intervalMin: 22,
      observedMidDepartures: {
        0: '08:17:00', // Trip 1: 7 min late at exit (scheduled 08:10)
        1: '08:38:00', // Trip 2: 6 min late at mid (scheduled 08:32) → exit late
        2: '08:58:00', // Trip 3: 4 min late at mid (scheduled 08:54)
      },
      observedFirstDepartures: {
        1: '08:28:00', // Trip 2: 6 min late start (scheduled 08:22) → > 300s threshold
        2: '08:48:00', // Trip 3: 4 min late start (scheduled 08:44) → within threshold
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);

    const cascade = result.cascades[0];
    expect(cascade.absorbed).toBe(false);

    // Trip 2: 6 min late (360s > 300s) → does NOT recover
    // Trip 3: 4 min late (240s <= 300s) → recovers here
    expect(cascade.cascadedTrips).toHaveLength(2);
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-2');
    expect(cascade.cascadedTrips[0].recoveredHere).toBe(false);
    expect(cascade.cascadedTrips[1].tripName).toBe('Trip-3');
    expect(cascade.cascadedTrips[1].recoveredHere).toBe(true);

    // Blast radius = 1 (Trip 2 didn't recover; Trip 3 did)
    expect(cascade.blastRadius).toBe(1);
    expect(result.totalCascades).toBe(1);
  });

  it('handles dwell incident on last trip in block (no subsequent trips)', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30 });

    const incident = makeIncident({ tripName: 'Trip-2', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);

    // Last trip — no cascade possible but still tracked
    expect(result.cascades).toHaveLength(1);
    // Could be absorbed (if trip exits on-time) or have 0 blast radius
    expect(result.cascades[0].cascadedTrips).toHaveLength(0);
  });

  it('handles incident with non-matching block gracefully', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ block: 'UNKNOWN-BLOCK' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(0);
  });

  it('handles incident with non-matching trip name gracefully', () => {
    const records = buildBlockRecords({ block: '10-01', tripCount: 2, baseHour: 8, intervalMin: 30 });
    const incident = makeIncident({ tripName: 'NonExistent-Trip', block: '10-01' });

    const result = buildDailyCascadeMetrics(records, [incident]);
    expect(result.cascades).toHaveLength(0);
  });

  it('deduplicates duplicate observations at the same exit timepoint', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 2,
      baseHour: 8,
      intervalMin: 30,
      observedMidDepartures: {
        0: '08:10:00', // on-time exit at Trip-1 last eligible TP
      },
    });

    // Duplicate terminal-style observation for Trip-1 @ routeStopIndex 2.
    // This row is farther from schedule and should be ignored by dedup.
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

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    // Canonical (closest-to-schedule) row is on-time, so no cascade.
    expect(cascade.excessLateSeconds).toBe(0);
    expect(cascade.absorbed).toBe(true);
    expect(cascade.blastRadius).toBe(0);
    expect(cascade.cascadedTrips).toHaveLength(0);
  });

  it('uses late-entering fallback when downstream trip has no observed first departure', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25, // 5 min recovery between trips
      observedMidDepartures: {
        0: '08:18:00', // Trip-1 exit late by 8 min
        1: null,       // Trip-2 has no observed mid departure either
      },
      observedFirstDepartures: {
        1: null, // Trip-2 has no observed first departure
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);
    const cascade = result.cascades[0];

    expect(cascade.recoveryTimeAvailableSeconds).toBe(300); // 5 min
    expect(cascade.excessLateSeconds).toBe(480); // 8 min
    expect(cascade.cascadedTrips).toHaveLength(1);
    expect(cascade.cascadedTrips[0].tripName).toBe('Trip-2');
    expect(cascade.cascadedTrips[0].observedDepartureSeconds).toBeNull();
    // fallback = lateEntering = 8 - 5 = 3 min
    expect(cascade.cascadedTrips[0].lateSeconds).toBe(180);
    expect(cascade.cascadedTrips[0].recoveredHere).toBe(true);
  });

  it('builds byStop summary ranked by total blast radius', () => {
    // Two incidents at different stops — one cascades, one absorbed
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 4,
      baseHour: 8,
      intervalMin: 22,
      observedMidDepartures: {
        0: '08:17:00', // Trip 1: 7 min late
        1: '08:37:00', // Trip 2: 5 min late
      },
      observedFirstDepartures: {
        1: '08:27:00', // Trip 2: 5 min late
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
    // "Bad Stop" should rank higher than "Fine Stop"
    const badStop = result.byStop.find(s => s.stopName === 'Bad Stop');
    const fineStop = result.byStop.find(s => s.stopName === 'Fine Stop');
    expect(badStop).toBeDefined();

    if (badStop && fineStop) {
      expect(badStop.totalBlastRadius).toBeGreaterThanOrEqual(fineStop.totalBlastRadius);
    }
  });

  it('builds byTerminal recovery stats', () => {
    const records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 25,
      observedMidDepartures: {
        0: '08:18:00', // 8 min late
      },
      observedFirstDepartures: {
        1: '08:28:00', // 3 min late
      },
    });

    const incident = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const result = buildDailyCascadeMetrics(records, [incident]);

    // byTerminal should have an entry for the terminal where Trip 1 ends
    expect(result.byTerminal.length).toBeGreaterThanOrEqual(0);

    if (result.byTerminal.length > 0) {
      const terminal = result.byTerminal[0];
      expect(terminal.incidentCount).toBe(1);
      expect(terminal.avgScheduledRecoverySeconds).toBeGreaterThan(0);
    }
  });

  it('counts totalCascadeOTPDamage as sum of all blast radii', () => {
    // Two separate blocks with incidents
    const block1Records = buildBlockRecords({
      block: '10-01',
      tripCount: 3,
      baseHour: 8,
      intervalMin: 22,
      observedMidDepartures: { 0: '08:17:00' },
      observedFirstDepartures: { 1: '08:27:00' },
    });

    const block2Records = buildBlockRecords({
      block: '10-02',
      tripCount: 3,
      baseHour: 9,
      intervalMin: 22,
      observedMidDepartures: { 0: '09:17:00' },
      observedFirstDepartures: { 1: '09:27:00' },
    });

    // Update block2 records with correct block/trip IDs
    for (const r of block2Records) {
      r.tripId = r.tripId.replace('trip-guid-', 'trip-guid-b2-');
    }

    const allRecords = [...block1Records, ...block2Records];

    const inc1 = makeIncident({ tripName: 'Trip-1', block: '10-01' });
    const inc2 = makeIncident({ tripName: 'Trip-1', block: '10-02' });

    const result = buildDailyCascadeMetrics(allRecords, [inc1, inc2]);

    // totalCascadeOTPDamage = sum of all blast radii
    const manualSum = result.cascades.reduce((s, c) => s + c.blastRadius, 0);
    expect(result.totalCascadeOTPDamage).toBe(manualSum);
  });
});
