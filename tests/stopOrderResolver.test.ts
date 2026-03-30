import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_SCHEMA_VERSION,
} from '../utils/performanceDataTypes';
import type {
  DailyStopSegmentRuntimeEntry,
  DailySummary,
  DailyTripStopSegmentRuntimeEntry,
  DayType,
} from '../utils/performanceDataTypes';
import { resolveStopOrderFromPerformance } from '../utils/newSchedule/stopOrderResolver';

function makeSummary(params: {
  date: string;
  dayType: DayType;
  routeNames?: Record<string, string>;
  stopEntries?: DailyStopSegmentRuntimeEntry[];
  tripEntries?: DailyTripStopSegmentRuntimeEntry[];
}): DailySummary {
  const routeNames = params.routeNames || {};
  const stopEntries = params.stopEntries || [];
  const tripEntries = params.tripEntries || [];

  return {
    date: params.date,
    dayType: params.dayType,
    system: {
      otp: { total: 0, onTime: 0, early: 0, late: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0 },
      totalRidership: 0,
      totalBoardings: 0,
      totalAlightings: 0,
      vehicleCount: 0,
      tripCount: 0,
      wheelchairTrips: 0,
      avgSystemLoad: 0,
      peakLoad: 0,
    },
    byRoute: Object.keys(routeNames).map(routeId => ({
      routeId,
      routeName: routeNames[routeId],
      tripCount: 0,
      otp: { total: 0, onTime: 0, early: 0, late: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0 },
      totalBoardings: 0,
      totalAlightings: 0,
      avgLoad: 0,
      peakLoad: 0,
      wheelchairTrips: 0,
    })),
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfiles: [],
    segmentRuntimes: {
      entries: [],
      totalObservations: 0,
      tripsWithData: 0,
    },
    stopSegmentRuntimes: {
      entries: stopEntries,
      totalObservations: stopEntries.reduce((sum, entry) => sum + entry.observations.length, 0),
      tripsWithData: stopEntries.length,
    },
    tripStopSegmentRuntimes: {
      entries: tripEntries,
      totalObservations: tripEntries.reduce((sum, entry) => sum + entry.segments.length, 0),
      tripsWithData: tripEntries.length,
    },
    dataQuality: {
      totalRecords: 0,
      inBetweenFiltered: 0,
      missingAVL: 0,
      missingAPC: 0,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  } as unknown as DailySummary;
}

function buildNorthStopEntries(): DailyStopSegmentRuntimeEntry[] {
  return [
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'gm',
      toStopId: 'dt',
      fromStopName: 'Georgian Mall',
      toStopName: 'Downtown Hub (Platform 2)',
      fromRouteStopIndex: 1,
      toRouteStopIndex: 2,
      segmentName: 'Georgian Mall to Downtown Hub (Platform 2)',
      observations: [{ timeBucket: '12:00', runtimeMinutes: 10 }],
    },
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'dt',
      toStopId: 'pp',
      fromStopName: 'Downtown Hub (Platform 2)',
      toStopName: 'Park Place Terminal',
      fromRouteStopIndex: 2,
      toRouteStopIndex: 3,
      segmentName: 'Downtown Hub (Platform 2) to Park Place Terminal',
      observations: [{ timeBucket: '12:00', runtimeMinutes: 11 }],
    },
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'pp',
      toStopId: 'sg',
      fromStopName: 'Park Place Terminal',
      toStopName: 'Barrie South GO Station',
      fromRouteStopIndex: 3,
      toRouteStopIndex: 4,
      segmentName: 'Park Place Terminal to Barrie South GO Station',
      observations: [{ timeBucket: '12:00', runtimeMinutes: 12 }],
    },
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'dt',
      toStopId: 'pp',
      fromStopName: 'Downtown Hub (Platform 2)',
      toStopName: 'Park Place Terminal',
      fromRouteStopIndex: 2,
      toRouteStopIndex: 3,
      segmentName: 'Downtown Hub (Platform 2) to Park Place Terminal',
      observations: [{ timeBucket: '06:00', runtimeMinutes: 11 }],
    },
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'pp',
      toStopId: 'sg',
      fromStopName: 'Park Place Terminal',
      toStopName: 'Barrie South GO Station',
      fromRouteStopIndex: 3,
      toRouteStopIndex: 4,
      segmentName: 'Park Place Terminal to Barrie South GO Station',
      observations: [{ timeBucket: '06:00', runtimeMinutes: 12 }],
    },
  ];
}

function buildSouthStopEntries(): DailyStopSegmentRuntimeEntry[] {
  return [
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'sg',
      toStopId: 'pp',
      fromStopName: 'Barrie South GO Station',
      toStopName: 'Park Place Terminal',
      fromRouteStopIndex: 1,
      toRouteStopIndex: 2,
      segmentName: 'Barrie South GO Station to Park Place Terminal',
      observations: [{ timeBucket: '12:30', runtimeMinutes: 12 }],
    },
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'pp',
      toStopId: 'dt',
      fromStopName: 'Park Place Terminal',
      toStopName: 'Downtown Hub (Platform 2)',
      fromRouteStopIndex: 2,
      toRouteStopIndex: 3,
      segmentName: 'Park Place Terminal to Downtown Hub (Platform 2)',
      observations: [{ timeBucket: '12:30', runtimeMinutes: 11 }],
    },
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'dt',
      toStopId: 'gm',
      fromStopName: 'Downtown Hub (Platform 2)',
      toStopName: 'Georgian Mall',
      fromRouteStopIndex: 3,
      toRouteStopIndex: 4,
      segmentName: 'Downtown Hub (Platform 2) to Georgian Mall',
      observations: [{ timeBucket: '12:30', runtimeMinutes: 10 }],
    },
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'pp',
      toStopId: 'dt',
      fromStopName: 'Park Place Terminal',
      toStopName: 'Downtown Hub (Platform 2)',
      fromRouteStopIndex: 2,
      toRouteStopIndex: 3,
      segmentName: 'Park Place Terminal to Downtown Hub (Platform 2)',
      observations: [{ timeBucket: '06:30', runtimeMinutes: 11 }],
    },
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'dt',
      toStopId: 'gm',
      fromStopName: 'Downtown Hub (Platform 2)',
      toStopName: 'Georgian Mall',
      fromRouteStopIndex: 3,
      toRouteStopIndex: 4,
      segmentName: 'Downtown Hub (Platform 2) to Georgian Mall',
      observations: [{ timeBucket: '06:30', runtimeMinutes: 10 }],
    },
  ];
}

function buildFullNorthTrip(dateToken: string): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `north-full-${dateToken}`,
    tripName: `12A ${dateToken} full`,
    routeId: '12A',
    direction: 'N',
    terminalDepartureTime: '12:10',
    segments: [
      { fromStopId: 'gm', toStopId: 'dt', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 10, timeBucket: '12:00' },
      { fromStopId: 'dt', toStopId: 'pp', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 11, timeBucket: '12:00' },
      { fromStopId: 'pp', toStopId: 'sg', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 12, timeBucket: '12:30' },
    ],
  };
}

function buildPartialNorthTrip(dateToken: string, index: number): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `north-partial-${dateToken}-${index}`,
    tripName: `12A ${dateToken} partial ${index}`,
    routeId: '12A',
    direction: 'N',
    terminalDepartureTime: index % 2 === 0 ? '06:10' : '07:10',
    segments: [
      { fromStopId: 'dt', toStopId: 'pp', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 11, timeBucket: '06:00' },
      { fromStopId: 'pp', toStopId: 'sg', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 12, timeBucket: '06:30' },
    ],
  };
}

function buildFullSouthTrip(dateToken: string): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `south-full-${dateToken}`,
    tripName: `12B ${dateToken} full`,
    routeId: '12B',
    direction: 'S',
    terminalDepartureTime: '12:40',
    segments: [
      { fromStopId: 'sg', toStopId: 'pp', fromRouteStopIndex: 1, toRouteStopIndex: 2, runtimeMinutes: 12, timeBucket: '12:30' },
      { fromStopId: 'pp', toStopId: 'dt', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 11, timeBucket: '12:30' },
      { fromStopId: 'dt', toStopId: 'gm', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 10, timeBucket: '13:00' },
    ],
  };
}

function buildPartialSouthTrip(dateToken: string, index: number): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `south-partial-${dateToken}-${index}`,
    tripName: `12B ${dateToken} partial ${index}`,
    routeId: '12B',
    direction: 'S',
    terminalDepartureTime: index % 2 === 0 ? '06:40' : '07:40',
    segments: [
      { fromStopId: 'pp', toStopId: 'dt', fromRouteStopIndex: 2, toRouteStopIndex: 3, runtimeMinutes: 11, timeBucket: '06:30' },
      { fromStopId: 'dt', toStopId: 'gm', fromRouteStopIndex: 3, toRouteStopIndex: 4, runtimeMinutes: 10, timeBucket: '07:00' },
    ],
  };
}

function buildSparseNorthStopEntries(): DailyStopSegmentRuntimeEntry[] {
  return [
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'pw',
      toStopId: 'dt',
      fromStopName: 'Prince William Way at Empire',
      toStopName: 'Downtown Hub (Platform 2)',
      fromRouteStopIndex: 0,
      toRouteStopIndex: 16,
      segmentName: 'Prince William Way at Empire to Downtown Hub (Platform 2)',
      observations: [{ timeBucket: '10:00', runtimeMinutes: 10 }],
    },
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'dt',
      toStopId: 'pp',
      fromStopName: 'Downtown Hub (Platform 2)',
      toStopName: 'Park Place Terminal',
      fromRouteStopIndex: 16,
      toRouteStopIndex: 28,
      segmentName: 'Downtown Hub (Platform 2) to Park Place Terminal',
      observations: [{ timeBucket: '10:00', runtimeMinutes: 11 }],
    },
    {
      routeId: '12A',
      direction: 'N',
      fromStopId: 'pp',
      toStopId: 'sg',
      fromStopName: 'Park Place Terminal',
      toStopName: 'Barrie South GO Station',
      fromRouteStopIndex: 28,
      toRouteStopIndex: 53,
      segmentName: 'Park Place Terminal to Barrie South GO Station',
      observations: [{ timeBucket: '10:30', runtimeMinutes: 12 }],
    },
  ];
}

function buildSparseSouthStopEntries(): DailyStopSegmentRuntimeEntry[] {
  return [
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'sg',
      toStopId: 'pp',
      fromStopName: 'Barrie South GO Station',
      toStopName: 'Park Place Terminal',
      fromRouteStopIndex: 0,
      toRouteStopIndex: 21,
      segmentName: 'Barrie South GO Station to Park Place Terminal',
      observations: [{ timeBucket: '10:30', runtimeMinutes: 12 }],
    },
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'pp',
      toStopId: 'dt',
      fromStopName: 'Park Place Terminal',
      toStopName: 'Downtown Hub (Platform 2)',
      fromRouteStopIndex: 21,
      toRouteStopIndex: 44,
      segmentName: 'Park Place Terminal to Downtown Hub (Platform 2)',
      observations: [{ timeBucket: '11:00', runtimeMinutes: 11 }],
    },
    {
      routeId: '12B',
      direction: 'S',
      fromStopId: 'dt',
      toStopId: 'pw',
      fromStopName: 'Downtown Hub (Platform 2)',
      toStopName: 'Prince William Way at Empire',
      fromRouteStopIndex: 44,
      toRouteStopIndex: 71,
      segmentName: 'Downtown Hub (Platform 2) to Prince William Way at Empire',
      observations: [{ timeBucket: '11:00', runtimeMinutes: 10 }],
    },
  ];
}

function buildSparseFullNorthTrip(dateToken: string): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `sparse-north-full-${dateToken}`,
    tripName: `12A ${dateToken} sparse full`,
    routeId: '12A',
    direction: 'N',
    terminalDepartureTime: '10:05',
    segments: [
      { fromStopId: 'pw', toStopId: 'dt', fromRouteStopIndex: 0, toRouteStopIndex: 16, runtimeMinutes: 10, timeBucket: '10:00' },
      { fromStopId: 'dt', toStopId: 'pp', fromRouteStopIndex: 16, toRouteStopIndex: 28, runtimeMinutes: 11, timeBucket: '10:00' },
      { fromStopId: 'pp', toStopId: 'sg', fromRouteStopIndex: 28, toRouteStopIndex: 53, runtimeMinutes: 12, timeBucket: '10:30' },
    ],
  };
}

function buildSparsePartialNorthTrip(dateToken: string): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `sparse-north-partial-${dateToken}`,
    tripName: `12A ${dateToken} sparse partial`,
    routeId: '12A',
    direction: 'N',
    terminalDepartureTime: '07:05',
    segments: [
      { fromStopId: 'dt', toStopId: 'pp', fromRouteStopIndex: 16, toRouteStopIndex: 28, runtimeMinutes: 11, timeBucket: '07:00' },
      { fromStopId: 'pp', toStopId: 'sg', fromRouteStopIndex: 28, toRouteStopIndex: 53, runtimeMinutes: 12, timeBucket: '07:30' },
    ],
  };
}

function buildSparseFullSouthTrip(dateToken: string): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `sparse-south-full-${dateToken}`,
    tripName: `12B ${dateToken} sparse full`,
    routeId: '12B',
    direction: 'S',
    terminalDepartureTime: '10:40',
    segments: [
      { fromStopId: 'sg', toStopId: 'pp', fromRouteStopIndex: 0, toRouteStopIndex: 21, runtimeMinutes: 12, timeBucket: '10:30' },
      { fromStopId: 'pp', toStopId: 'dt', fromRouteStopIndex: 21, toRouteStopIndex: 44, runtimeMinutes: 11, timeBucket: '11:00' },
      { fromStopId: 'dt', toStopId: 'pw', fromRouteStopIndex: 44, toRouteStopIndex: 71, runtimeMinutes: 10, timeBucket: '11:00' },
    ],
  };
}

function buildSparsePartialSouthTrip(dateToken: string): DailyTripStopSegmentRuntimeEntry {
  return {
    tripId: `sparse-south-partial-${dateToken}`,
    tripName: `12B ${dateToken} sparse partial`,
    routeId: '12B',
    direction: 'S',
    terminalDepartureTime: '07:40',
    segments: [
      { fromStopId: 'pp', toStopId: 'dt', fromRouteStopIndex: 21, toRouteStopIndex: 44, runtimeMinutes: 11, timeBucket: '07:30' },
      { fromStopId: 'dt', toStopId: 'pw', fromRouteStopIndex: 44, toRouteStopIndex: 71, runtimeMinutes: 10, timeBucket: '08:00' },
    ],
  };
}

describe('stopOrderResolver.resolveStopOrderFromPerformance', () => {
  it('accepts the complete midday Route 12 pattern over more frequent partial trips as a smoke test gate', () => {
    const summaries: DailySummary[] = ['2026-03-24', '2026-03-25', '2026-03-26'].map((date, dayIndex) => (
      makeSummary({
        date,
        dayType: 'weekday',
        routeNames: { '12A': 'Georgian Mall', '12B': 'Barrie South GO' },
        stopEntries: [
          ...buildNorthStopEntries(),
          ...buildSouthStopEntries(),
        ],
        tripEntries: [
          buildFullNorthTrip(date),
          buildFullSouthTrip(date),
          buildPartialNorthTrip(date, dayIndex * 2),
          buildPartialNorthTrip(date, (dayIndex * 2) + 1),
          buildPartialSouthTrip(date, dayIndex * 2),
          buildPartialSouthTrip(date, (dayIndex * 2) + 1),
        ],
      })
    ));

    const result = resolveStopOrderFromPerformance(summaries, {
      routeId: '12',
      dayType: 'weekday',
      patternAnchorStops: {
        North: ['Georgian Mall', 'Barrie South GO Station'],
        South: ['Barrie South GO Station', 'Georgian Mall'],
      },
    });

    expect(result.decision).toBe('accept');
    expect(result.confidence).toBe('high');
    expect(result.resolvedDirections.North?.source).toBe('observed-midday-pattern');
    expect(result.resolvedDirections.South?.source).toBe('observed-midday-pattern');
    expect(result.resolvedDirections.North?.stopIds).toEqual(['gm', 'dt', 'pp', 'sg']);
    expect(result.resolvedDirections.South?.stopIds).toEqual(['sg', 'pp', 'dt', 'gm']);
    expect(result.resolvedDirections.North?.tripCountUsed).toBe(3);
    expect(result.resolvedDirections.South?.tripCountUsed).toBe(3);
  });

  it('blocks when a bidirectional route is missing one direction', () => {
    const summaries: DailySummary[] = [
      makeSummary({
        date: '2026-03-24',
        dayType: 'weekday',
        routeNames: { '12A': 'Georgian Mall' },
        stopEntries: buildNorthStopEntries(),
        tripEntries: [buildFullNorthTrip('2026-03-24')],
      }),
    ];

    const result = resolveStopOrderFromPerformance(summaries, {
      routeId: '12',
      dayType: 'weekday',
      patternAnchorStops: {
        North: ['Georgian Mall', 'Barrie South GO Station'],
        South: ['Barrie South GO Station', 'Georgian Mall'],
      },
    });

    expect(result.decision).toBe('blocked');
    expect(result.resolvedDirections.North?.stopIds).toEqual(['gm', 'dt', 'pp', 'sg']);
    expect(result.resolvedDirections.South).toBeUndefined();
    expect(result.warnings).toContain('Missing resolved stop order for South.');
  });

  it('keeps zero-based sparse route-stop indexes from disqualifying the dominant full pattern', () => {
    const summaries: DailySummary[] = ['2026-03-23', '2026-03-30'].map((date) => (
      makeSummary({
        date,
        dayType: 'sunday',
        routeNames: { '12A': 'Prince William Way', '12B': 'Barrie South GO' },
        stopEntries: [
          ...buildSparseNorthStopEntries(),
          ...buildSparseSouthStopEntries(),
        ],
        tripEntries: [
          buildSparseFullNorthTrip(date),
          buildSparseFullSouthTrip(date),
          buildSparsePartialNorthTrip(date),
          buildSparsePartialSouthTrip(date),
        ],
      })
    ));

    const result = resolveStopOrderFromPerformance(summaries, {
      routeId: '12',
      dayType: 'sunday',
      patternAnchorStops: {
        North: ['Prince William Way at Empire', 'Barrie South GO Station'],
        South: ['Barrie South GO Station', 'Prince William Way at Empire'],
      },
    });

    expect(result.decision).toBe('accept');
    expect(result.confidence).toBe('high');
    expect(result.resolvedDirections.North?.stopIds).toEqual(['pw', 'dt', 'pp', 'sg']);
    expect(result.resolvedDirections.South?.stopIds).toEqual(['sg', 'pp', 'dt', 'pw']);
    expect(result.resolvedDirections.North?.tripCountUsed).toBe(2);
    expect(result.resolvedDirections.South?.tripCountUsed).toBe(2);
    expect(result.resolvedDirections.North?.skippedIndexCount).toBe(0);
    expect(result.resolvedDirections.South?.skippedIndexCount).toBe(0);
  });

  it('does not let repeated clean patterns lose just because skipped-index penalties were summed across trips', () => {
    const makeManyTrips = (
      date: string,
      direction: 'North' | 'South',
      count: number,
    ): DailyTripStopSegmentRuntimeEntry[] => Array.from({ length: count }, (_, index) => {
      const base = direction === 'North'
        ? buildSparseFullNorthTrip(date)
        : buildSparseFullSouthTrip(date);
      return {
        ...base,
        tripId: `${base.tripId}-${index}`,
        tripName: `${base.tripName} ${index}`,
        terminalDepartureTime: direction === 'North'
          ? `${10 + Math.floor(index / 2)}:${index % 2 === 0 ? '05' : '35'}`
          : `${10 + Math.floor(index / 2)}:${index % 2 === 0 ? '40' : '55'}`,
      };
    });

    const summaries: DailySummary[] = ['2026-03-23', '2026-03-30'].map((date) => (
      makeSummary({
        date,
        dayType: 'sunday',
        routeNames: { '12A': 'Prince William Way', '12B': 'Barrie South GO' },
        stopEntries: [
          ...buildSparseNorthStopEntries(),
          ...buildSparseSouthStopEntries(),
        ],
        tripEntries: [
          ...makeManyTrips(date, 'North', 6),
          ...makeManyTrips(date, 'South', 6),
          buildSparsePartialNorthTrip(date),
          buildSparsePartialSouthTrip(date),
        ],
      })
    ));

    const result = resolveStopOrderFromPerformance(summaries, {
      routeId: '12',
      dayType: 'sunday',
      patternAnchorStops: {
        North: ['Prince William Way at Empire', 'Barrie South GO Station'],
        South: ['Barrie South GO Station', 'Prince William Way at Empire'],
      },
    });

    expect(result.decision).toBe('accept');
    expect(result.confidence).toBe('high');
    expect(result.resolvedDirections.North?.stopIds).toEqual(['pw', 'dt', 'pp', 'sg']);
    expect(result.resolvedDirections.South?.stopIds).toEqual(['sg', 'pp', 'dt', 'pw']);
    expect(result.resolvedDirections.North?.tripCountUsed).toBe(12);
    expect(result.resolvedDirections.South?.tripCountUsed).toBe(12);
    expect(result.resolvedDirections.North?.skippedIndexCount).toBe(0);
    expect(result.resolvedDirections.South?.skippedIndexCount).toBe(0);
  });

  it('accepts a single-day dominant pattern when many clean trips agree and midday evidence is present', () => {
    const date = '2026-03-29';
    const makeManyTrips = (
      direction: 'North' | 'South',
      count: number,
    ): DailyTripStopSegmentRuntimeEntry[] => Array.from({ length: count }, (_, index) => {
      const base = direction === 'North'
        ? buildSparseFullNorthTrip(date)
        : buildSparseFullSouthTrip(date);
      return {
        ...base,
        tripId: `${base.tripId}-single-day-${index}`,
        tripName: `${base.tripName} single-day ${index}`,
        terminalDepartureTime: direction === 'North'
          ? `${9 + Math.floor(index / 2)}:${index % 2 === 0 ? '05' : '35'}`
          : `${8 + Math.floor(index / 2)}:${index % 2 === 0 ? '10' : '40'}`,
      };
    });

    const result = resolveStopOrderFromPerformance([
      makeSummary({
        date,
        dayType: 'sunday',
        routeNames: { '12A': 'Prince William Way', '12B': 'Barrie South GO' },
        stopEntries: [
          ...buildSparseNorthStopEntries(),
          ...buildSparseSouthStopEntries(),
        ],
        tripEntries: [
          ...makeManyTrips('North', 8),
          ...makeManyTrips('South', 8),
          buildSparsePartialNorthTrip(date),
          buildSparsePartialSouthTrip(date),
        ],
      }),
    ], {
      routeId: '12',
      dayType: 'sunday',
      patternAnchorStops: {
        North: ['Prince William Way at Empire', 'Barrie South GO Station'],
        South: ['Barrie South GO Station', 'Prince William Way at Empire'],
      },
    });

    expect(result.decision).toBe('accept');
    expect(result.confidence).toBe('high');
    expect(result.resolvedDirections.North?.tripCountUsed).toBe(8);
    expect(result.resolvedDirections.South?.tripCountUsed).toBe(8);
  });
});
