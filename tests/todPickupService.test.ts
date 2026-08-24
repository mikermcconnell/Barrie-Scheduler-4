import { describe, expect, it } from 'vitest';
import {
  assertTodPickupStoragePathUnchanged,
  buildTodDailyKpiReplacementSummary,
  buildTodPickupReplacementSummary,
  normalizeTodPickupStoragePath,
} from '../utils/todPickupService';
import type { TodDailyKpiDataset, TodPickupMonthlyDataset, TodPickupSummary } from '../utils/todPickupTypes';

function dataset(month: string, pickups: number): TodPickupMonthlyDataset {
  return {
    month,
    importedAt: '2026-06-01T00:00:00.000Z',
    importedBy: 'user-1',
    sourceFileName: `${month}.csv`,
    rowCount: pickups,
    mappableRows: pickups,
    skippedRows: 0,
    totalPickups: pickups,
    stops: [
      {
        id: `${month}-stop`,
        name: 'Test Stop',
        lat: 44.38,
        lon: -79.69,
        pickups,
      },
    ],
  };
}

function dailyReport(date: string, trips: number): TodDailyKpiDataset {
  return {
    date,
    importedAt: '2026-08-24T00:00:00.000Z',
    importedBy: 'user-1',
    sourceFileName: `${date}.xlsx`,
    rowCount: 2,
    totalCompletedTrips: trips,
    totalDropoffs: trips,
    locations: [{
      id: 'stop-1', name: 'Stop 1', lat: 44.38, lon: -79.69, pickups: trips, dropoffs: trips,
    }],
  };
}

describe('todPickupService replacement summary', () => {
  it('replaces the selected month while preserving other months', () => {
    const existing: TodPickupSummary = {
      months: [dataset('2026-04', 4), dataset('2026-05', 5)],
      metadata: {
        importedAt: '',
        importedBy: 'old-user',
        monthCount: 2,
        totalRows: 9,
        totalPickups: 9,
        storagePath: 'old-path.json',
      },
      schemaVersion: 1,
    };

    const next = buildTodPickupReplacementSummary(
      existing,
      dataset('2026-05', 10),
      'user-2',
      'new-path.json',
    );

    expect(next.months.map(month => [month.month, month.totalPickups])).toEqual([
      ['2026-04', 4],
      ['2026-05', 10],
    ]);
    expect(next.metadata).toMatchObject({
      importedBy: 'user-2',
      monthCount: 2,
      totalRows: 14,
      totalPickups: 14,
      storagePath: 'new-path.json',
    });
  });

  it('normalizes and checks storage paths for concurrent import protection', () => {
    expect(normalizeTodPickupStoragePath('old-path.json')).toBe('old-path.json');
    expect(normalizeTodPickupStoragePath('')).toBeNull();
    expect(normalizeTodPickupStoragePath(undefined)).toBeNull();

    expect(() => assertTodPickupStoragePathUnchanged('old-path.json', 'old-path.json')).not.toThrow();
    expect(() => assertTodPickupStoragePathUnchanged('old-path.json', 'new-path.json')).toThrow(
      'TOD pickup data changed while importing. Refresh and try again.',
    );
  });

  it('replaces one daily KPI date while preserving monthly and other daily data', () => {
    const existing: TodPickupSummary = {
      months: [dataset('2026-07', 50)],
      dailyReports: [dailyReport('2026-08-22', 100), dailyReport('2026-08-23', 110)],
      metadata: { importedAt: '', importedBy: 'old-user', monthCount: 1, totalRows: 50, totalPickups: 50 },
      schemaVersion: 2,
    };

    const next = buildTodDailyKpiReplacementSummary(
      existing,
      dailyReport('2026-08-23', 126),
      'user-2',
      'new-path.json',
    );

    expect(next.months).toHaveLength(1);
    expect(next.dailyReports?.map(report => [report.date, report.totalCompletedTrips])).toEqual([
      ['2026-08-22', 100],
      ['2026-08-23', 126],
    ]);
    expect(next.metadata).toMatchObject({
      dailyReportCount: 2,
      dailyDateRange: { start: '2026-08-22', end: '2026-08-23' },
      totalCompletedTrips: 226,
      storagePath: 'new-path.json',
    });
  });
});
