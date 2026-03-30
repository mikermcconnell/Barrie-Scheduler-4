import { describe, expect, it } from 'vitest';
import { aggregateDailySummaries as aggregateFrontend } from '../utils/performanceDataAggregator';
import {
  PERFORMANCE_RUNTIME_LOGIC_VERSION as FRONTEND_RUNTIME_LOGIC_VERSION,
  PERFORMANCE_SCHEMA_VERSION as FRONTEND_SCHEMA_VERSION,
} from '../utils/performanceDataTypes';
import type { STREETSRecord as FrontendRecord } from '../utils/performanceDataTypes';
import { aggregateDailySummaries as aggregateBackend } from '../functions/src/aggregator';
import {
  PERFORMANCE_RUNTIME_LOGIC_VERSION as BACKEND_RUNTIME_LOGIC_VERSION,
  PERFORMANCE_SCHEMA_VERSION as BACKEND_SCHEMA_VERSION,
} from '../functions/src/types';

function makeRecord(overrides: Partial<FrontendRecord> = {}): FrontendRecord {
  return {
    vehicleLocationTPKey: 1,
    vehicleId: '2302',
    inBetween: false,
    isTripper: false,
    date: '2026-03-24',
    month: '2026-03',
    day: 'DAY_OF_WEEK',
    arrivalTime: '07:00',
    observedArrivalTime: '07:00:30',
    stopTime: '07:00',
    observedDepartureTime: '07:01:00',
    wheelchairUsageCount: 0,
    departureLoad: 10,
    boardings: 3,
    alightings: 1,
    apcSource: 1,
    block: '2-01',
    operatorId: '4486',
    tripName: '2A - 07:00',
    stopName: 'Stop A',
    routeName: 'ROUTE 2',
    branch: '2A FULL',
    routeId: '2A',
    routeStopIndex: 0,
    stopId: 'stop-a',
    direction: 'N',
    isDetour: false,
    stopLat: 44.38,
    stopLon: -79.69,
    timePoint: true,
    distance: 0,
    previousStopName: null,
    tripId: 'trip-001',
    internalTripId: 1,
    terminalDepartureTime: '07:00',
    ...overrides,
  };
}

describe('functions performance aggregation stays aligned with app runtime logic', () => {
  it('keeps the runtime logic version constant in sync', () => {
    expect(BACKEND_RUNTIME_LOGIC_VERSION).toBe(FRONTEND_RUNTIME_LOGIC_VERSION);
  });

  it('keeps the performance schema version constant in sync', () => {
    expect(BACKEND_SCHEMA_VERSION).toBe(FRONTEND_SCHEMA_VERSION);
  });

  it('uses downstream departure for non-terminal timepoint segments and downstream arrival at the terminal', () => {
    const records = [
      makeRecord({
        tripId: 'timepoint-trip',
        routeStopIndex: 0,
        stopId: 'park',
        stopName: 'Park Place',
        stopTime: '07:00',
        observedDepartureTime: '07:01:00',
        timePoint: true,
      }),
      makeRecord({
        tripId: 'timepoint-trip',
        routeStopIndex: 1,
        stopId: 'veterans',
        stopName: "Veteran's at Essa",
        arrivalTime: '07:05',
        observedArrivalTime: '07:06:00',
        stopTime: '07:05',
        observedDepartureTime: '07:09:00',
        timePoint: true,
      }),
      makeRecord({
        tripId: 'timepoint-trip',
        routeStopIndex: 2,
        stopId: 'cuthbert',
        stopName: 'Cuthbert Street',
        arrivalTime: '07:12',
        observedArrivalTime: '07:14:00',
        observedDepartureTime: '07:20:00',
        stopTime: '07:12',
        timePoint: true,
      }),
    ];

    const frontend = aggregateFrontend(records);
    const backend = aggregateBackend(records as any);

    expect(backend[0].segmentRuntimes?.entries).toEqual(frontend[0].segmentRuntimes?.entries);
    expect(backend[0].segmentRuntimes?.entries).toEqual([
      {
        routeId: '2A',
        direction: 'N',
        segmentName: "Park Place to Veteran's at Essa",
        observations: [{ runtimeMinutes: 8, timeBucket: '07:00' }],
      },
      {
        routeId: '2A',
        direction: 'N',
        segmentName: "Veteran's at Essa to Cuthbert Street",
        observations: [{ runtimeMinutes: 5, timeBucket: '07:00' }],
      },
    ]);
  });

  it('keeps stop-level and trip-linked segment runtimes aligned with the app-side dwell-aware logic', () => {
    const records = [
      makeRecord({
        tripId: 'stop-trip',
        routeStopIndex: 0,
        stopId: 'park',
        stopName: 'Park Place',
        stopTime: '07:00',
        observedDepartureTime: '07:01:00',
      }),
      makeRecord({
        tripId: 'stop-trip',
        routeStopIndex: 1,
        stopId: 'mid',
        stopName: 'Intermediate Stop',
        arrivalTime: '07:05',
        observedArrivalTime: '07:06:00',
        stopTime: '07:05',
        observedDepartureTime: '07:09:00',
        timePoint: false,
      }),
      makeRecord({
        tripId: 'stop-trip',
        routeStopIndex: 2,
        stopId: 'peggy',
        stopName: 'Peggy Hill',
        arrivalTime: '07:12',
        observedArrivalTime: '07:14:00',
        observedDepartureTime: '07:20:00',
        stopTime: '07:12',
        timePoint: true,
      }),
    ];

    const frontend = aggregateFrontend(records);
    const backend = aggregateBackend(records as any);

    expect(backend[0].stopSegmentRuntimes?.entries).toEqual(frontend[0].stopSegmentRuntimes?.entries);
    expect(backend[0].tripStopSegmentRuntimes?.entries).toEqual(frontend[0].tripStopSegmentRuntimes?.entries);
    expect(backend[0].tripStopSegmentRuntimes?.entries).toEqual([
      {
        tripId: 'stop-trip',
        tripName: '2A - 07:00',
        routeId: '2A',
        direction: 'N',
        terminalDepartureTime: '07:00',
        segments: [
          {
            fromStopId: 'park',
            toStopId: 'mid',
            fromRouteStopIndex: 0,
            toRouteStopIndex: 1,
            runtimeMinutes: 8,
            timeBucket: '07:00',
          },
          {
            fromStopId: 'mid',
            toStopId: 'peggy',
            fromRouteStopIndex: 1,
            toRouteStopIndex: 2,
            runtimeMinutes: 5,
            timeBucket: '07:00',
          },
        ],
      },
    ]);
  });

  it('subtracts planned control-point hold from non-terminal segment runtimes in both aggregators', () => {
    const records = [
      makeRecord({
        tripId: 'control-hold-trip',
        tripName: '7A - 07:00',
        terminalDepartureTime: '07:00',
        routeId: '7',
        direction: 'N',
        routeStopIndex: 0,
        stopId: 'park',
        stopName: 'Park Place',
        arrivalTime: '07:00',
        stopTime: '07:00',
        observedArrivalTime: '07:00:30',
        observedDepartureTime: '07:01:00',
      }),
      makeRecord({
        tripId: 'control-hold-trip',
        tripName: '7A - 07:00',
        terminalDepartureTime: '07:00',
        routeId: '7',
        direction: 'N',
        routeStopIndex: 1,
        stopId: 'dt',
        stopName: 'Downtown Hub',
        arrivalTime: '07:10',
        observedArrivalTime: '07:11:00',
        stopTime: '07:15',
        observedDepartureTime: '07:16:00',
        timePoint: true,
      }),
      makeRecord({
        tripId: 'control-hold-trip',
        tripName: '7A - 07:00',
        terminalDepartureTime: '07:00',
        routeId: '7',
        direction: 'N',
        routeStopIndex: 2,
        stopId: 'rose',
        stopName: 'Rose Street',
        arrivalTime: '07:27',
        observedArrivalTime: '07:28:00',
        stopTime: '07:27',
        timePoint: true,
      }),
    ];

    const frontend = aggregateFrontend(records);
    const backend = aggregateBackend(records as any);

    expect(backend[0].segmentRuntimes?.entries).toEqual(frontend[0].segmentRuntimes?.entries);
    expect(backend[0].stopSegmentRuntimes?.entries).toEqual(frontend[0].stopSegmentRuntimes?.entries);
    expect(backend[0].tripStopSegmentRuntimes?.entries).toEqual(frontend[0].tripStopSegmentRuntimes?.entries);
    expect(frontend[0].tripStopSegmentRuntimes?.entries).toEqual([
      {
        tripId: 'control-hold-trip',
        tripName: '7A - 07:00',
        routeId: '7',
        direction: 'N',
        terminalDepartureTime: '07:00',
        segments: [
          {
            fromStopId: 'park',
            toStopId: 'dt',
            fromRouteStopIndex: 0,
            toRouteStopIndex: 1,
            runtimeMinutes: 10,
            timeBucket: '07:00',
          },
          {
            fromStopId: 'dt',
            toStopId: 'rose',
            fromRouteStopIndex: 1,
            toRouteStopIndex: 2,
            runtimeMinutes: 12,
            timeBucket: '07:00',
          },
        ],
      },
    ]);
  });

  it('keeps ridership heatmaps and route stop deviations aligned with the app summary shape', () => {
    const records = [
      makeRecord({
        tripId: 'heatmap-trip-1',
        tripName: '2A - 07:00',
        terminalDepartureTime: '07:00',
        routeStopIndex: 0,
        stopId: 'stop-a',
        stopName: 'Stop A',
        boardings: 4,
        alightings: 0,
      }),
      makeRecord({
        tripId: 'heatmap-trip-1',
        tripName: '2A - 07:00',
        terminalDepartureTime: '07:00',
        routeStopIndex: 1,
        stopId: 'stop-b',
        stopName: 'Stop B',
        stopTime: '07:08',
        observedDepartureTime: '07:09:00',
        boardings: 1,
        alightings: 2,
      }),
      makeRecord({
        tripId: 'heatmap-trip-1',
        tripName: '2A - 07:00',
        terminalDepartureTime: '07:00',
        routeStopIndex: 2,
        stopId: 'stop-c',
        stopName: 'Stop C',
        stopTime: '07:16',
        observedDepartureTime: '07:17:00',
        boardings: 0,
        alightings: 3,
      }),
      makeRecord({
        tripId: 'heatmap-trip-2',
        tripName: '2A - 07:30',
        terminalDepartureTime: '07:30',
        routeStopIndex: 0,
        stopId: 'stop-a',
        stopName: 'Stop A',
        stopTime: '07:30',
        observedDepartureTime: '07:32:00',
        boardings: 5,
        alightings: 0,
      }),
      makeRecord({
        tripId: 'heatmap-trip-2',
        tripName: '2A - 07:30',
        terminalDepartureTime: '07:30',
        routeStopIndex: 1,
        stopId: 'stop-b',
        stopName: 'Stop B',
        stopTime: '07:38',
        observedDepartureTime: '07:41:00',
        boardings: 2,
        alightings: 2,
      }),
      makeRecord({
        tripId: 'heatmap-trip-2',
        tripName: '2A - 07:30',
        terminalDepartureTime: '07:30',
        routeStopIndex: 2,
        stopId: 'stop-c',
        stopName: 'Stop C',
        stopTime: '07:46',
        observedDepartureTime: '07:48:00',
        boardings: 0,
        alightings: 5,
      }),
    ];

    const frontend = aggregateFrontend(records);
    const backend = aggregateBackend(records as any);

    expect(backend[0].schemaVersion).toBe(BACKEND_SCHEMA_VERSION);
    expect(backend[0].ridershipHeatmaps).toEqual(frontend[0].ridershipHeatmaps);
    expect(backend[0].routeStopDeviations).toEqual(frontend[0].routeStopDeviations);
  });
});
