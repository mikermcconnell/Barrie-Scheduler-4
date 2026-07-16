import { describe, expect, it } from 'vitest';
import {
  buildMonthlyLoadProfileViews,
  hydrateLoadProfileMonthlyViews,
  projectLoadProfileDay,
} from '../utils/performanceLoadProfileView';
import { mergePerformanceSummaryMetadata } from '../utils/performanceDataService';
import {
  LOAD_PROFILE_VIEW_SCHEMA_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
  type DailySummary,
  type PerformanceDataSummary,
} from '../utils/performanceDataTypes';

const emptyOtp = {
  total: 0,
  onTime: 0,
  early: 0,
  late: 0,
  onTimePercent: 0,
  earlyPercent: 0,
  latePercent: 0,
  avgDeviationSeconds: 0,
};

function makeDay(
  date: string,
  profileCount = 1,
  stopsPerProfile = 2,
  tripCount = 2,
): DailySummary {
  return {
    date,
    dayType: 'weekday',
    system: {
      otp: emptyOtp,
      totalRidership: 0,
      totalBoardings: 0,
      totalAlightings: 0,
      vehicleCount: 0,
      tripCount,
      wheelchairTrips: 0,
      avgSystemLoad: 0,
      peakLoad: 0,
    },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: Array.from({ length: tripCount }, (_, index) => ({
      tripId: `${date}-trip-${index}`,
      tripName: `Route trip ${index}`,
      block: `block-${index % 20}`,
      routeId: `${(index % Math.max(profileCount, 1)) + 1}`,
      routeName: `Route ${(index % Math.max(profileCount, 1)) + 1}`,
      direction: index % 2 === 0 ? 'North' : 'South',
      terminalDepartureTime: `${String(5 + (index % 18)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
      otp: emptyOtp,
      boardings: 0,
      maxLoad: index === tripCount - 1 ? 0 : 10 + (index % 50),
    })),
    loadProfiles: Array.from({ length: profileCount }, (_, profileIndex) => ({
      routeId: `${profileIndex + 1}`,
      routeName: `Route ${profileIndex + 1}`,
      direction: profileIndex % 2 === 0 ? 'North' : 'South',
      tripCount,
      stops: Array.from({ length: stopsPerProfile }, (_, stopIndex) => ({
        stopName: `Representative stop name ${stopIndex}`,
        stopId: `stop-${stopIndex % 20}`,
        routeStopIndex: stopIndex,
        occurrenceIndex: stopIndex >= 20 ? 1 : 0,
        avgBoardings: stopIndex % 8,
        avgAlightings: stopIndex % 7,
        avgLoad: stopIndex % 35,
        loadObservationCount: tripCount,
        maxLoad: stopIndex % 50,
        isTimepoint: stopIndex % 4 === 0,
      })),
    })),
    dataQuality: {
      totalRecords: 1_000,
      inBetweenFiltered: 10,
      missingAVL: 20,
      missingAPC: 30,
      detourRecords: 2,
      tripperRecords: 3,
      loadCapped: 4,
      apcExcludedFromLoad: 30,
    },
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  };
}

function makeSummary(days: DailySummary[]): PerformanceDataSummary {
  return {
    dailySummaries: days,
    metadata: {
      importedAt: '2026-07-16T12:00:00.000Z',
      importedBy: 'test-user',
      dateRange: { start: days[0].date, end: days[days.length - 1].date },
      dayCount: days.length,
      totalRecords: days.length * 1_000,
      runtimeLogicVersion: 4,
    },
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
  };
}

describe('Load Profiles monthly view projection', () => {
  it('keeps occurrence-aware profiles and only the trip fields needed for peak-load ranking', () => {
    const day = makeDay('2026-07-15', 1, 22, 3);
    const projected = projectLoadProfileDay(day);

    expect(projected.loadProfiles[0].stops[20].occurrenceIndex).toBe(1);
    expect(projected.loadProfilePeakTrips).toHaveLength(2);
    expect(projected.loadProfilePeakTrips[0]).toEqual({
      routeId: '1',
      routeName: 'Route 1',
      direction: 'North',
      block: 'block-0',
      terminalDepartureTime: '05:00',
      tripName: 'Route trip 0',
      maxLoad: 10,
    });
    expect(projected).not.toHaveProperty('system');
    expect(projected).not.toHaveProperty('byStop');
    expect(projected).not.toHaveProperty('ridershipHeatmaps');
  });

  it('splits views by month, versions them, and hydrates the legacy dashboard contract', () => {
    const summary = makeSummary([
      makeDay('2026-06-30'),
      makeDay('2026-07-01'),
      makeDay('2026-07-02'),
    ]);
    const views = buildMonthlyLoadProfileViews(summary);

    expect([...views.keys()]).toEqual(['2026-06', '2026-07']);
    expect(views.get('2026-07')).toMatchObject({
      viewSchemaVersion: LOAD_PROFILE_VIEW_SCHEMA_VERSION,
      month: '2026-07',
      schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      metadata: {
        dateRange: { start: '2026-07-01', end: '2026-07-02' },
        dayCount: 2,
        totalRecords: 2_000,
      },
    });

    const hydrated = hydrateLoadProfileMonthlyViews([...views.values()], summary.metadata);
    expect(hydrated.dailySummaries).toHaveLength(3);
    expect(hydrated.dailySummaries[0].loadProfiles).toHaveLength(1);
    expect(hydrated.dailySummaries[0].byTrip).toEqual([]);
    expect(hydrated.dailySummaries[0].loadProfilePeakTrips).toHaveLength(1);
  });

  it('keeps the metadata pointer when Firestore metadata is merged into a downloaded summary', () => {
    const summary = makeSummary([makeDay('2026-07-01')]);
    const paths = {
      '2026-07': 'teams/team-1/performanceViews/load-profiles/generation-1-2026-07.json',
    };

    const merged = mergePerformanceSummaryMetadata(summary, {
      ...summary.metadata,
      loadProfileMonthlyStoragePaths: paths,
    });

    expect(merged.metadata.loadProfileMonthlyStoragePaths).toEqual(paths);
  });

  it('keeps a representative 31-day view below the 10 MB uncompressed payload budget', () => {
    const days = Array.from({ length: 31 }, (_, index) =>
      makeDay(`2026-07-${String(index + 1).padStart(2, '0')}`, 18, 65, 600)
    );
    const view = buildMonthlyLoadProfileViews(makeSummary(days)).get('2026-07');
    const payloadBytes = new TextEncoder().encode(JSON.stringify(view)).byteLength;

    expect(payloadBytes).toBeLessThan(10 * 1024 * 1024);
  });
});
