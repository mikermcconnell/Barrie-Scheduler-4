import { describe, expect, it } from 'vitest';
import type {
  DailySummary,
  PerformanceDataSummary,
  SegmentRuntimeObservation,
  TripStopSegmentObservation,
} from '../utils/performanceDataTypes';
import {
  PERFORMANCE_RUNTIME_LOGIC_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
} from '../utils/performanceDataTypes';
import {
  buildPerformanceImportHealth,
  buildPerformanceMetadataHealth,
} from '../utils/performanceImportHealth';

const EMPTY_OBSERVATIONS: SegmentRuntimeObservation[] = [];
const EMPTY_TRIP_SEGMENTS: TripStopSegmentObservation[] = [];

function makeDay(params: {
  date: string;
  schemaVersion?: number;
  stopEntries?: number;
  tripEntries?: number;
}): DailySummary {
  return {
    date: params.date,
    dayType: 'weekday',
    system: {
      otp: {
        total: 0,
        onTime: 0,
        early: 0,
        late: 0,
        onTimePercent: 0,
        earlyPercent: 0,
        latePercent: 0,
        avgDeviationSeconds: 0,
      },
      totalRidership: 0,
      totalBoardings: 0,
      totalAlightings: 0,
      vehicleCount: 0,
      tripCount: 0,
      wheelchairTrips: 0,
      avgSystemLoad: 0,
      peakLoad: 0,
    },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfiles: [],
    stopSegmentRuntimes: {
      entries: Array.from({ length: params.stopEntries ?? 0 }, (_, index) => ({
        routeId: '10',
        direction: 'CW',
        fromStopId: `s${index}`,
        toStopId: `s${index + 1}`,
        fromStopName: `Stop ${index}`,
        toStopName: `Stop ${index + 1}`,
        fromRouteStopIndex: index,
        toRouteStopIndex: index + 1,
        segmentName: `Stop ${index} to Stop ${index + 1}`,
        observations: EMPTY_OBSERVATIONS,
      })),
      totalObservations: 0,
      tripsWithData: params.stopEntries ?? 0,
    },
    tripStopSegmentRuntimes: {
      entries: Array.from({ length: params.tripEntries ?? 0 }, (_, index) => ({
        tripId: `trip-${index}`,
        tripName: `Trip ${index}`,
        routeId: '10',
        direction: 'CW',
        terminalDepartureTime: '12:00',
        segments: EMPTY_TRIP_SEGMENTS,
      })),
      totalObservations: 0,
      tripsWithData: params.tripEntries ?? 0,
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
    schemaVersion: params.schemaVersion ?? PERFORMANCE_SCHEMA_VERSION,
  };
}

function makeSummary(params: {
  importedAt: string;
  runtimeLogicVersion?: number;
  dailySummaries: DailySummary[];
}): PerformanceDataSummary {
  const dates = params.dailySummaries.map(day => day.date).sort();
  return {
    dailySummaries: params.dailySummaries,
    metadata: {
      importedAt: params.importedAt,
      importedBy: 'auto-ingest',
      dateRange: {
        start: dates[0],
        end: dates[dates.length - 1],
      },
      dayCount: params.dailySummaries.length,
      totalRecords: 0,
      runtimeLogicVersion: params.runtimeLogicVersion,
    },
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  };
}

describe('buildPerformanceImportHealth', () => {
  it('marks current, consistent imports as healthy', () => {
    const summary = makeSummary({
      importedAt: '2026-03-30T10:00:00Z',
      runtimeLogicVersion: PERFORMANCE_RUNTIME_LOGIC_VERSION,
      dailySummaries: [
        makeDay({ date: '2026-03-29', tripEntries: 2, stopEntries: 4 }),
        makeDay({ date: '2026-03-30', tripEntries: 2, stopEntries: 4 }),
      ],
    });

    const result = buildPerformanceImportHealth(summary, {
      now: new Date('2026-03-30T12:00:00Z'),
    });

    expect(result.overallStatus).toBe('healthy');
    expect(result.headline).toBe('Imports look healthy');
    expect(result.checks.every(check => check.status === 'healthy')).toBe(true);
  });

  it('flags stale mixed-history imports with weak trip-linked runtime coverage', () => {
    const summary = makeSummary({
      importedAt: '2026-03-24T07:49:06Z',
      dailySummaries: [
        makeDay({ date: '2026-03-16', schemaVersion: 6, stopEntries: 5, tripEntries: 0 }),
        makeDay({ date: '2026-03-22', schemaVersion: 7, stopEntries: 5, tripEntries: 2 }),
        makeDay({ date: '2026-03-23', schemaVersion: 6, stopEntries: 5, tripEntries: 0 }),
      ],
    });

    const result = buildPerformanceImportHealth(summary, {
      now: new Date('2026-03-30T12:00:00Z'),
    });

    expect(result.overallStatus).toBe('critical');
    expect(result.headline).toBe('Imports look broken or stale');
    expect(result.checks.find(check => check.id === 'import-recency')?.status).toBe('critical');
    expect(result.checks.find(check => check.id === 'service-coverage')?.status).toBe('critical');
    expect(result.checks.find(check => check.id === 'runtime-logic')?.status).toBe('warning');
    expect(result.checks.find(check => check.id === 'history-consistency')?.status).toBe('warning');
    expect(result.checks.find(check => check.id === 'trip-linked-runtimes')?.status).toBe('warning');
  });
});

describe('buildPerformanceMetadataHealth', () => {
  it('returns a healthy quick status when metadata is current', () => {
    const summary = makeSummary({
      importedAt: '2026-03-30T10:00:00Z',
      runtimeLogicVersion: PERFORMANCE_RUNTIME_LOGIC_VERSION,
      dailySummaries: [
        makeDay({ date: '2026-03-29' }),
        makeDay({ date: '2026-03-30' }),
      ],
    });

    const result = buildPerformanceMetadataHealth(summary.metadata, {
      now: new Date('2026-03-30T12:00:00Z'),
    });

    expect(result?.status).toBe('healthy');
    expect(result?.label).toBe('Import healthy');
  });

  it('returns a critical quick status when metadata is stale', () => {
    const summary = makeSummary({
      importedAt: '2026-03-24T07:49:06Z',
      dailySummaries: [
        makeDay({ date: '2026-03-23' }),
      ],
    });

    const result = buildPerformanceMetadataHealth(summary.metadata, {
      now: new Date('2026-03-30T12:00:00Z'),
    });

    expect(result?.status).toBe('critical');
    expect(result?.label).toBe('Import stale');
  });
});
