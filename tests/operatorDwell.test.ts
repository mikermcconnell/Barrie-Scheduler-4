import { describe, it, expect } from 'vitest';
import {
  classifyDwell,
  DWELL_THRESHOLDS,
  type STREETSRecord,
} from '../utils/performanceDataTypes';
import { aggregateDailySummaries } from '../utils/performanceDataAggregator';

// ─── Helper ──────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<STREETSRecord> = {}): STREETSRecord {
  return {
    vehicleLocationTPKey: 1,
    vehicleId: 'V100',
    inBetween: false,
    isTripper: false,
    date: '2025-01-06',
    month: '2025-01',
    day: 'MONDAY',
    arrivalTime: '10:00',
    observedArrivalTime: '10:00:00',
    stopTime: '10:00',
    observedDepartureTime: '10:04:00', // 4 min late → passes 3-min gate
    wheelchairUsageCount: 0,
    departureLoad: 10,
    boardings: 5,
    alightings: 3,
    apcSource: 1,
    block: '10-01',
    operatorId: 'OP001',
    tripName: '10 - 10FD - 10:00',
    stopName: 'Downtown Hub',
    routeName: 'NORTH LOOP',
    branch: '10 FULL',
    routeId: '10',
    routeStopIndex: 1,
    stopId: 'S100',
    direction: 'CW',
    isDetour: false,
    stopLat: 44.3894,
    stopLon: -79.6903,
    timePoint: true,
    distance: 0,
    previousStopName: null,
    tripId: 'trip-001',
    internalTripId: 1,
    terminalDepartureTime: '10:00',
    ...overrides,
  };
}

// ─── classifyDwell unit tests ────────────────────────────────────────
// Gate: <= 180s (3 min) → null, >180 to 300 → moderate, >300 → high

describe('classifyDwell', () => {
  it('returns null for dwell <= 0', () => {
    expect(classifyDwell(0)).toBeNull();
    expect(classifyDwell(-10)).toBeNull();
  });

  it('returns minor for dwell > 0 and <= 2 min', () => {
    expect(classifyDwell(1)).toBe('minor');
    expect(classifyDwell(60)).toBe('minor');   // 1 min
    expect(classifyDwell(120)).toBe('minor');  // exactly 2 min
  });

  it('returns moderate for > 2 to 5 min dwell', () => {
    expect(classifyDwell(121)).toBe('moderate');  // just over 2 min
    expect(classifyDwell(180)).toBe('moderate');  // 3 min
    expect(classifyDwell(300)).toBe('moderate');  // exactly 5 min
  });

  it('returns high for > 5 min dwell', () => {
    expect(classifyDwell(301)).toBe('high');   // just over 5 min
    expect(classifyDwell(600)).toBe('high');   // 10 min
  });
});

// ─── Aggregation integration tests ──────────────────────────────────
//
// Legacy-matching dwell formula:
//   Gate: departing > 3 min late (depLatenessSec > 180)
//   Branch 1 (arrSec <= schedDepSec): dwell = depLateness
//   Branch 2 (arrSec > schedDepSec): dwell = rawDwell (no buffer subtraction)
//   classifyDwell(dwell): <= 180 → null, <=300 → moderate, >300 → high

describe('buildOperatorDwellMetrics (via aggregateDailySummaries)', () => {
  it('does not flag dwell <= 3 min (below gate)', () => {
    const records = [
      // 3 min late: dep 10:03 vs sched 10:00 → depLateness=180 → gate rejects (<=180)
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:03:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
  });

  it('flags 4 min late departure as moderate (branch 1: on-time arrival)', () => {
    // arr on time (10:00), sched dep 10:00, actual dep 10:04
    // depLateness=240 > 180 gate, arrSec==schedDep → branch 1, dwell=240, classifyDwell(240)=moderate
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:04:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].severity).toBe('moderate');
    expect(dwell.incidents[0].rawDwellSeconds).toBe(240);    // depSec - arrSec
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(240); // depLateness
  });

  it('flags 6 min late departure as high (branch 1: on-time arrival)', () => {
    // arr on time, dep 6 min late → depLateness=360, dwell=360 > 300 → high
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:06:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].severity).toBe('high');
    expect(dwell.incidents[0].rawDwellSeconds).toBe(360);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(360);
  });

  it('uses raw dwell for late arrivals (branch 2) — high', () => {
    // arr 2 min late past sched dep, stays 6 min at stop → rawDwell=360
    // depLateness = 8 min > gate, arrSec > schedDep → branch 2, dwell = rawDwell = 360
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '10:02:00',
        observedDepartureTime: '10:08:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(360);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(360);
    expect(dwell.incidents[0].severity).toBe('high');
  });

  it('minor dwell at late arrivals — contributes hours but not incident count', () => {
    // arr 4 min late, boards for 1 min → rawDwell=60, minor severity
    // depLateness=300 > gate, branch 2, dwell=60 → minor
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '10:04:00',
        observedDepartureTime: '10:05:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    // Minor events don't count as incidents
    expect(dwell.totalIncidents).toBe(0);
    // But they DO contribute to total dwell hours
    expect(dwell.totalTrackedDwellMinutes).toBe(1); // 60s = 1 min
    // And they exist in the incidents array
    expect(dwell.incidents.length).toBe(1);
    expect(dwell.incidents[0].severity).toBe('minor');
  });

  it('counts moderate dwell at late arrivals (branch 2) — above boarding floor', () => {
    // arr 2 min late, boards for 3 min → rawDwell=180, above 120s floor, ≤300 → moderate
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '10:02:00',
        observedDepartureTime: '10:05:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(180);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(180);
    expect(dwell.incidents[0].severity).toBe('moderate');
  });

  it('excludes non-timepoint records', () => {
    const records = [
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:05:00',
        timePoint: false,
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
  });

  it('excludes records with null arrival or departure', () => {
    const records = [
      makeRecord({
        observedArrivalTime: null,
        observedDepartureTime: '10:05:00',
      }),
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: null,
        tripId: 'trip-002',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
  });

  it('deduplicates duplicate trip+stop observations using closest-to-schedule row', () => {
    // Two records for same trip+stop. Closest-to-schedule dep wins (10:04, 4 min late).
    const records = [
      makeRecord({
        tripId: 'trip-dup',
        stopId: 'S100',
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:08:00', // farther from schedule (8 min)
        vehicleLocationTPKey: 1001,
      }),
      makeRecord({
        tripId: 'trip-dup',
        stopId: 'S100',
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:04:00', // closer to schedule (4 min)
        vehicleLocationTPKey: 1002,
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    // Picks closest (4 min dep). Branch 1 (on time arr). dwell = depLateness = 240
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(240);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(240);
    expect(dwell.incidents[0].severity).toBe('moderate');
  });

  it('treats repeated same-stop visits in one trip as distinct incidents when routeStopIndex differs', () => {
    const records = [
      makeRecord({
        tripId: 'trip-loop',
        stopId: 'S500',
        routeStopIndex: 4,
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:04:00', // 4 min late → moderate (dwell=240)
        vehicleLocationTPKey: 5001,
      }),
      makeRecord({
        tripId: 'trip-loop',
        stopId: 'S500',
        routeStopIndex: 17,
        stopTime: '10:30',
        observedArrivalTime: '10:30:00',
        observedDepartureTime: '10:36:00', // 6 min late → high (dwell=360)
        vehicleLocationTPKey: 5002,
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(2);
    expect(dwell.byOperator).toHaveLength(1);
    expect(dwell.byOperator[0].totalIncidents).toBe(2);
    expect(dwell.byOperator[0].moderateCount).toBe(1);
    expect(dwell.byOperator[0].highCount).toBe(1);
    expect(dwell.byOperator[0].totalTrackedDwellSeconds).toBe(600); // 240 + 360
  });

  it('skips malformed observed time values instead of producing NaN dwell metrics', () => {
    const records = [
      makeRecord({
        tripId: 'trip-bad-time',
        tripName: 'bad-time-trip',
        observedArrivalTime: 'TBD',
        observedDepartureTime: '10:10:00',
      }),
      makeRecord({
        tripId: 'trip-good-time',
        tripName: 'good-time-trip',
        stopId: 'S220',
        stopTime: '10:20',
        observedArrivalTime: '10:20:00',
        observedDepartureTime: '10:24:00', // 4 min late → moderate, dwell=240
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents).toHaveLength(1);
    expect(dwell.incidents[0].tripName).toBe('good-time-trip');
    expect(dwell.incidents[0].rawDwellSeconds).toBe(240);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(240);
    expect(dwell.totalTrackedDwellMinutes).toBe(4);
  });

  it('does not treat small same-day dep<arr ordering noise as a midnight rollover', () => {
    const records = [
      makeRecord({
        tripId: 'trip-order-noise',
        observedArrivalTime: '10:00:02',
        observedDepartureTime: '10:00:00',
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
  });

  it('aggregates correctly across multiple operators', () => {
    const records = [
      // OP001: 4 min late → moderate (dwell=240)
      makeRecord({
        operatorId: 'OP001',
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:04:00',
        tripId: 'trip-001',
      }),
      // OP001: 6 min late → high (dwell=360)
      makeRecord({
        operatorId: 'OP001',
        stopTime: '11:00',
        observedArrivalTime: '11:00:00',
        observedDepartureTime: '11:06:00',
        tripId: 'trip-002',
        stopId: 'S200',
        stopName: 'Park Place',
      }),
      // OP002: 4 min late → moderate (dwell=240)
      makeRecord({
        operatorId: 'OP002',
        stopTime: '12:00',
        observedArrivalTime: '12:00:00',
        observedDepartureTime: '12:04:00',
        tripId: 'trip-003',
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(3);
    expect(dwell.byOperator).toHaveLength(2);

    const op1 = dwell.byOperator.find(o => o.operatorId === 'OP001')!;
    expect(op1.totalIncidents).toBe(2);
    expect(op1.moderateCount).toBe(1);
    expect(op1.highCount).toBe(1);
    expect(op1.totalTrackedDwellSeconds).toBe(600); // 240 + 360
    expect(op1.avgTrackedDwellSeconds).toBe(300);

    const op2 = dwell.byOperator.find(o => o.operatorId === 'OP002')!;
    expect(op2.totalIncidents).toBe(1);
    expect(op2.moderateCount).toBe(1);
    expect(op2.highCount).toBe(0);
    expect(op2.totalTrackedDwellSeconds).toBe(240);
  });

  it('early arrival at terminal — no dwell when departure on time', () => {
    // Bus arrives 5 min early, departs on schedule → depLateness = 0 → below gate
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '09:55:00',
        observedDepartureTime: '10:00:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
  });

  it('early arrival at terminal — dwell only for excess past sched dep', () => {
    // Bus arrives 5 min early, departs 4 min late → depLateness=240 > gate
    // arrSec (09:55=35700) < schedDep (10:00=36000) → branch 1 → dwell = 240
    // rawDwell = 10:04 - 09:55 = 540s
    const records = [
      makeRecord({
        stopTime: '10:00',
        observedArrivalTime: '09:55:00',
        observedDepartureTime: '10:04:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(240);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(540);
  });

  it('handles post-midnight rollover', () => {
    // Arrival at 23:58, sched dep 23:58, dep at 00:04 next day
    // rawDwell = 360 (6 min), depLateness = 360, branch 1, dwell = 360 → high
    const records = [
      makeRecord({
        stopTime: '23:58',
        observedArrivalTime: '23:58:00',
        observedDepartureTime: '00:04:00',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(360);
    expect(dwell.incidents[0].severity).toBe('high');
  });
});
