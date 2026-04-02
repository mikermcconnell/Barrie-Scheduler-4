import { describe, expect, it } from 'vitest';
import type { DailySummary, PerformanceDataSummary } from '../utils/performanceDataTypes';
import { buildPerformanceOverviewSummary } from '../utils/performanceOverviewSummary';

function buildDay(date: string, index: number): DailySummary {
  return {
    date,
    dayType: 'weekday',
    system: {
      otp: {
        total: 100,
        onTime: 80,
        early: 10,
        late: 10,
        onTimePercent: 80,
        earlyPercent: 10,
        latePercent: 10,
        avgDeviationSeconds: 30,
      },
      totalRidership: 1000 + index,
      totalBoardings: 1000 + index,
      totalAlightings: 900 + index,
      vehicleCount: 12,
      tripCount: 40,
      wheelchairTrips: 2,
      avgSystemLoad: 18,
      peakLoad: 35,
    },
    byRoute: [],
    byHour: [],
    byStop: [{ stopId: 's1' } as DailySummary['byStop'][number]],
    byTrip: [],
    loadProfiles: [{ routeId: '1' } as DailySummary['loadProfiles'][number]],
    ridershipHeatmaps: [{ routeId: '1' } as NonNullable<DailySummary['ridershipHeatmaps']>[number]],
    missedTrips: {
      totalScheduled: 10,
      totalMatched: 9,
      totalMissed: 1,
      missedPct: 10,
      notPerformedCount: 1,
      lateOver15Count: 0,
      byRoute: [{ routeId: '1', count: 1, earliestDep: '06:00' }],
      trips: [{
        tripId: `trip-${index}`,
        routeId: '1',
        departure: '06:00',
        headsign: 'Terminal',
        blockId: 'B1',
        serviceId: 'WKD',
        missType: 'not_performed',
      }],
    },
    tripStopSegmentRuntimes: {
      entries: [],
      totalObservations: 0,
      tripsWithData: 0,
    },
    dataQuality: {
      totalRecords: 100 + index,
      inBetweenFiltered: 0,
      missingAVL: 0,
      missingAPC: 0,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 8,
  };
}

describe('buildPerformanceOverviewSummary', () => {
  it('keeps only the most recent 7 days and strips heavyweight detail arrays', () => {
    const summary: PerformanceDataSummary = {
      dailySummaries: [
        buildDay('2026-03-01', 1),
        buildDay('2026-03-02', 2),
        buildDay('2026-03-03', 3),
        buildDay('2026-03-04', 4),
        buildDay('2026-03-05', 5),
        buildDay('2026-03-06', 6),
        buildDay('2026-03-07', 7),
        buildDay('2026-03-08', 8),
      ],
      metadata: {
        importedAt: '2026-03-09T12:00:00.000Z',
        importedBy: 'auto-ingest',
        dateRange: { start: '2026-03-01', end: '2026-03-08' },
        dayCount: 8,
        totalRecords: 999,
      },
      schemaVersion: 8,
    };

    const overview = buildPerformanceOverviewSummary(summary);

    expect(overview.dailySummaries.map(day => day.date)).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ]);
    expect(overview.metadata.dateRange).toEqual({ start: '2026-03-02', end: '2026-03-08' });
    expect(overview.metadata.dayCount).toBe(7);
    expect(overview.dailySummaries.every(day => day.byStop.length === 0)).toBe(true);
    expect(overview.dailySummaries.every(day => day.loadProfiles.length === 0)).toBe(true);
    expect(overview.dailySummaries.every(day => day.ridershipHeatmaps === undefined)).toBe(true);
    expect(overview.dailySummaries.every(day => day.tripStopSegmentRuntimes === undefined)).toBe(true);
    expect(overview.dailySummaries.every(day => (day.missedTrips?.trips?.length ?? 0) === 0)).toBe(true);
  });
});
