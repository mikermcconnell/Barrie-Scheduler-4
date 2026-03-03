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
    observedDepartureTime: '10:03:00',
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

describe('classifyDwell', () => {
  it('returns null for dwell < 2 minutes (normal boarding)', () => {
    expect(classifyDwell(60)).toBeNull();    // 1 min
    expect(classifyDwell(90)).toBeNull();    // 1.5 min
    expect(classifyDwell(119)).toBeNull();   // just under 2 min
  });

  it('returns moderate for 2-5 min raw dwell', () => {
    expect(classifyDwell(120)).toBe('moderate');  // exactly 2 min
    expect(classifyDwell(180)).toBe('moderate');  // 3 min
    expect(classifyDwell(300)).toBe('moderate');  // exactly 5 min
  });

  it('returns high for > 5 min raw dwell', () => {
    expect(classifyDwell(301)).toBe('high');   // just over 5 min
    expect(classifyDwell(600)).toBe('high');   // 10 min
  });
});

// ─── Aggregation integration tests ──────────────────────────────────

describe('buildOperatorDwellMetrics (via aggregateDailySummaries)', () => {
  it('does not flag dwell < 2 min', () => {
    const records = [
      // 1 min dwell: 10:00:00 → 10:01:00
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:01:00',
        timePoint: true,
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell).toBeDefined();
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
    expect(day.byOperatorDwell!.incidents).toHaveLength(0);
  });

  it('flags 3 min raw dwell as moderate with tracked = 60s', () => {
    const records = [
      // 3 min dwell: 10:00:00 → 10:03:00
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:03:00',
        timePoint: true,
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].severity).toBe('moderate');
    expect(dwell.incidents[0].rawDwellSeconds).toBe(180);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(60); // 180 - 120
  });

  it('flags 6 min raw dwell as high with tracked = 240s', () => {
    const records = [
      // 6 min dwell: 10:00:00 → 10:06:00
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:06:00',
        timePoint: true,
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;
    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].severity).toBe('high');
    expect(dwell.incidents[0].rawDwellSeconds).toBe(360);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(240); // 360 - 120
  });

  it('excludes non-timepoint records', () => {
    const records = [
      // 5 min dwell but NOT a timepoint
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
        timePoint: true,
      }),
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: null,
        timePoint: true,
        tripId: 'trip-002',
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    expect(day.byOperatorDwell!.totalIncidents).toBe(0);
  });

  it('deduplicates duplicate trip+stop observations using closest-to-schedule row', () => {
    const records = [
      // Same trip+stop appears twice (terminal duplicate pattern)
      makeRecord({
        tripId: 'trip-dup',
        stopId: 'S100',
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:06:00', // farther from schedule
        vehicleLocationTPKey: 1001,
      }),
      makeRecord({
        tripId: 'trip-dup',
        stopId: 'S100',
        stopTime: '10:00',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:03:00', // closer to schedule
        vehicleLocationTPKey: 1002,
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(180);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(60);
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
        observedDepartureTime: '10:03:00', // moderate (tracked 60)
        vehicleLocationTPKey: 5001,
      }),
      makeRecord({
        tripId: 'trip-loop',
        stopId: 'S500',
        routeStopIndex: 17,
        stopTime: '10:30',
        observedArrivalTime: '10:30:00',
        observedDepartureTime: '10:36:00', // high (tracked 240)
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
    expect(dwell.byOperator[0].totalTrackedDwellSeconds).toBe(300);
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
        observedArrivalTime: '10:20:00',
        observedDepartureTime: '10:23:00', // moderate (tracked 60)
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents).toHaveLength(1);
    expect(dwell.incidents[0].tripName).toBe('good-time-trip');
    expect(dwell.incidents[0].rawDwellSeconds).toBe(180);
    expect(dwell.incidents[0].trackedDwellSeconds).toBe(60);
    expect(dwell.totalTrackedDwellMinutes).toBe(1);
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
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(0);
    expect(dwell.incidents).toHaveLength(0);
  });

  it('aggregates correctly across multiple operators', () => {
    const records = [
      // OP001: 3 min dwell (moderate)
      makeRecord({
        operatorId: 'OP001',
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:03:00',
        timePoint: true,
        tripId: 'trip-001',
      }),
      // OP001: 6 min dwell (high)
      makeRecord({
        operatorId: 'OP001',
        observedArrivalTime: '11:00:00',
        observedDepartureTime: '11:06:00',
        timePoint: true,
        tripId: 'trip-002',
        stopId: 'S200',
        stopName: 'Park Place',
      }),
      // OP002: 4 min dwell (moderate)
      makeRecord({
        operatorId: 'OP002',
        observedArrivalTime: '12:00:00',
        observedDepartureTime: '12:04:00',
        timePoint: true,
        tripId: 'trip-003',
      }),
    ];

    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(3);
    expect(dwell.byOperator).toHaveLength(2);

    // OP001 has 2 incidents → sorted first
    const op1 = dwell.byOperator.find(o => o.operatorId === 'OP001')!;
    expect(op1.totalIncidents).toBe(2);
    expect(op1.moderateCount).toBe(1);
    expect(op1.highCount).toBe(1);
    // tracked: 60 + 240 = 300
    expect(op1.totalTrackedDwellSeconds).toBe(300);
    expect(op1.avgTrackedDwellSeconds).toBe(150);

    // OP002 has 1 incident
    const op2 = dwell.byOperator.find(o => o.operatorId === 'OP002')!;
    expect(op2.totalIncidents).toBe(1);
    expect(op2.moderateCount).toBe(1);
    expect(op2.highCount).toBe(0);
    // tracked: 240 - 120 = 120
    expect(op2.totalTrackedDwellSeconds).toBe(120);
  });

  it('filters zero-tracked-dwell incidents from cascade input', () => {
    // rawDwell = 120s (exactly at threshold), trackedDwell = 0s
    // Should appear in byOperatorDwell but NOT produce a cascade entry
    const records = [
      makeRecord({
        observedArrivalTime: '10:00:00',
        observedDepartureTime: '10:02:00', // 120s raw = exactly threshold, tracked = 0
        timePoint: true,
        tripId: 'trip-zero-tracked',
        tripName: '10 - 10FD - 10:00',
        block: '10-01',
      }),
      // Add a second trip on the same block so cascade has something to trace
      makeRecord({
        observedArrivalTime: '10:30:00',
        observedDepartureTime: '10:31:00',
        timePoint: true,
        tripId: 'trip-downstream',
        tripName: '10 - 10FD - 10:30',
        block: '10-01',
        terminalDepartureTime: '10:30',
        stopTime: '10:30',
        arrivalTime: '10:30',
      }),
    ];
    const [day] = aggregateDailySummaries(records);

    // Incident DOES appear in dwell metrics (rawDwell >= threshold)
    expect(day.byOperatorDwell!.totalIncidents).toBe(1);
    expect(day.byOperatorDwell!.incidents[0].trackedDwellSeconds).toBe(0);

    // But cascade should NOT contain this zero-tracked incident
    expect(day.byCascade!.cascades).toHaveLength(0);
  });

  it('handles post-midnight rollover', () => {
    const records = [
      // Arrival at 23:58:00, departure at 00:04:00 next day = 6 min dwell
      makeRecord({
        observedArrivalTime: '23:58:00',
        observedDepartureTime: '00:04:00',
        timePoint: true,
      }),
    ];
    const [day] = aggregateDailySummaries(records);
    const dwell = day.byOperatorDwell!;

    expect(dwell.totalIncidents).toBe(1);
    expect(dwell.incidents[0].rawDwellSeconds).toBe(360); // 6 min
    expect(dwell.incidents[0].severity).toBe('high');
  });
});
