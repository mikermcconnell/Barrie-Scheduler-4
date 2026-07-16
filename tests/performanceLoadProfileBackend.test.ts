import { describe, expect, it } from 'vitest';
import {
  buildLoadProfileMonthlyView,
  hydrateLoadProfileMonthlyViews,
} from '../functions/src/performanceLoadProfileView';
import { buildMonthlyLoadProfileViews } from '../utils/performanceLoadProfileView';
import type { PerformanceDataSummary as ClientPerformanceDataSummary } from '../utils/performanceDataTypes';
import {
  assertValidLoadProfilesRequest,
  canReadLoadProfiles,
  trimDayForDetailMode,
} from '../functions/src/sharedWorkspaceData';
import type {
  DailySummary,
  PerformanceDataSummary,
} from '../functions/src/types';

function dailySummary(): DailySummary {
  return {
    date: '2026-07-15',
    dayType: 'weekday',
    system: {} as DailySummary['system'],
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [{
      tripId: 'trip-1',
      tripName: 'Route 10 trip',
      block: '10-1',
      routeId: '10',
      routeName: 'NORTH LOOP',
      direction: 'CW',
      terminalDepartureTime: '08:00',
      otp: {} as DailySummary['byTrip'][number]['otp'],
      boardings: 20,
      maxLoad: 31,
    }],
    loadProfiles: [{
      routeId: '10',
      routeName: 'NORTH LOOP',
      direction: 'CW',
      tripCount: 1,
      stops: [],
    }],
    byOperatorDwell: { incidents: [{ operatorId: 'private' }] } as never,
    byCascade: { cascades: [{ operatorId: 'private' }] } as never,
    runtimePatterns: [{ routeId: '10' }] as never,
    dataQuality: {
      totalRecords: 12,
      inBetweenFiltered: 0,
      missingAVL: 0,
      missingAPC: 0,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 13,
  };
}

function summary(): PerformanceDataSummary {
  return {
    dailySummaries: [dailySummary()],
    metadata: {
      importedAt: '2026-07-16T00:00:00.000Z',
      importedBy: 'test',
      dateRange: { start: '2026-07-15', end: '2026-07-15' },
      dayCount: 1,
      totalRecords: 12,
    },
    schemaVersion: 13,
  };
}

describe('backend Load Profiles read model', () => {
  it('writes a versioned monthly projection without unrelated or operator evidence', () => {
    const view = buildLoadProfileMonthlyView(summary());

    expect(view.month).toBe('2026-07');
    expect(view.viewSchemaVersion).toBe(1);
    expect(view.dailySummaries[0]).toEqual({
      date: '2026-07-15',
      dayType: 'weekday',
      loadProfiles: summary().dailySummaries[0].loadProfiles,
      loadProfilePeakTrips: [{
        routeId: '10',
        routeName: 'NORTH LOOP',
        direction: 'CW',
        block: '10-1',
        terminalDepartureTime: '08:00',
        tripName: 'Route 10 trip',
        maxLoad: 31,
      }],
      dataQuality: summary().dailySummaries[0].dataQuality,
      schemaVersion: 13,
    });
    expect(JSON.stringify(view)).not.toContain('private');
    expect(JSON.stringify(view)).not.toContain('runtimePatterns');
  });

  it('keeps the manual-import and server-ingest JSON contracts identical', () => {
    const source = summary();
    const serverView = buildLoadProfileMonthlyView(source);
    const clientView = buildMonthlyLoadProfileViews(
      source as unknown as ClientPerformanceDataSummary,
    ).get('2026-07');

    expect(serverView).toEqual(clientView);
  });

  it('hydrates the compact view to the established dashboard summary shape', () => {
    const source = summary();
    const hydrated = hydrateLoadProfileMonthlyViews(
      [buildLoadProfileMonthlyView(source)],
      source.metadata,
    );

    expect(hydrated.dailySummaries[0].byTrip).toEqual([]);
    expect(hydrated.dailySummaries[0].loadProfilePeakTrips[0]).toMatchObject({
      routeId: '10',
      maxLoad: 31,
    });
    expect(hydrated.dailySummaries[0].loadProfiles).toHaveLength(1);
    expect(hydrated.dailySummaries[0].byOperatorDwell).toBeUndefined();
  });

  it('requires both Operations and Load Profiles access', () => {
    const token = { schedulerAdmin: false } as never;
    expect(canReadLoadProfiles({ accessLevel: 'admin' }, token)).toBe(true);
    expect(canReadLoadProfiles({ accessLevel: 'planner' }, token)).toBe(false);
    expect(canReadLoadProfiles({
      accessLevel: 'planner',
      workspaceOverrides: { operationsLoadProfiles: true },
    }, token)).toBe(true);
    expect(canReadLoadProfiles({
      accessLevel: 'admin',
      workspaceOverrides: { workspaceOperations: false },
    }, token)).toBe(false);
    expect(canReadLoadProfiles({
      accessLevel: 'internal',
      workspaceOverrides: { operationsLoadProfiles: false },
    }, token)).toBe(false);
  });

  it('requires a bounded date range for load-profile requests', () => {
    expect(() => assertValidLoadProfilesRequest({})).toThrow(/bounded date range/);
    expect(() => assertValidLoadProfilesRequest({
      dateRange: { start: '2026-01-01', end: '2026-07-15' },
    })).toThrow(/cannot exceed 120 days/);
    expect(() => assertValidLoadProfilesRequest({
      dateRange: { start: '2026-07-01', end: '2026-07-15' },
      routeId: '10',
    })).not.toThrow();
  });

  it('keeps peak-trip evidence in the legacy fallback while removing dwell evidence', () => {
    const trimmed = trimDayForDetailMode(dailySummary(), 'load-profiles');
    expect(trimmed.byTrip).toEqual([]);
    expect(trimmed.loadProfilePeakTrips).toHaveLength(1);
    expect(trimmed.byOperatorDwell).toBeUndefined();
    expect(trimmed.byCascade).toBeUndefined();
    expect(trimmed.runtimePatterns).toBeUndefined();
  });
});
