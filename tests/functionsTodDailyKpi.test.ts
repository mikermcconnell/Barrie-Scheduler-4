import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  buildTodDailyKpiAutoIngestSummary,
  normalizeTodExcelRequestBytes,
} from '../functions/src/todDailyKpi';
import type { TodDailyKpiDataset, TodPickupMonthlyDataset, TodPickupSummary } from '../utils/todPickupTypes';

function workbookBytes(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Top Locations']]), 'KPI');
  return Buffer.from(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

function month(): TodPickupMonthlyDataset {
  return {
    month: '2026-07', importedAt: '', importedBy: 'user-1', sourceFileName: 'july.csv',
    rowCount: 10, mappableRows: 10, skippedRows: 0, totalPickups: 50,
    stops: [{ id: 'stop-1', name: 'Stop 1', lat: 44.38, lon: -79.69, pickups: 50 }],
  };
}

function day(date: string, trips: number): TodDailyKpiDataset {
  return {
    date, importedAt: '', importedBy: 'auto-ingest', sourceFileName: 'daily.xlsx',
    rawStoragePath: `teams/team-1/todPickupData/raw/${date}/source.xlsx`,
    rowCount: 2, totalCompletedTrips: trips, totalDropoffs: trips,
    locations: [{ id: 'stop-1', name: 'Stop 1', lat: 44.38, lon: -79.69, pickups: trips, dropoffs: trips }],
  };
}

describe('TOD daily KPI Cloud Function contract', () => {
  it('accepts either raw Excel bytes or Power Automate base64 attachment bytes', () => {
    const raw = workbookBytes();
    expect(normalizeTodExcelRequestBytes(raw)).toEqual(raw);
    expect(normalizeTodExcelRequestBytes(Buffer.from(raw.toString('base64'), 'utf8'))).toEqual(raw);
  });

  it('replaces the same service date and preserves monthly and other daily history', () => {
    const existing: TodPickupSummary = {
      months: [month()],
      dailyReports: [day('2026-08-22', 100), day('2026-08-23', 110)],
      metadata: { importedAt: '', importedBy: '', monthCount: 1, totalRows: 10, totalPickups: 50 },
      schemaVersion: 2,
    };

    const next = buildTodDailyKpiAutoIngestSummary(
      existing,
      day('2026-08-23', 126),
      'teams/team-1/todPickupData/new.json',
    );

    expect(next.months).toHaveLength(1);
    expect(next.dailyReports?.map(report => [report.date, report.totalCompletedTrips])).toEqual([
      ['2026-08-22', 100],
      ['2026-08-23', 126],
    ]);
    expect(next.metadata).toMatchObject({
      importedBy: 'auto-ingest',
      totalPickups: 50,
      dailyReportCount: 2,
      totalCompletedTrips: 226,
      storagePath: 'teams/team-1/todPickupData/new.json',
    });
  });

  it('keeps authentication, bounded input, archival, read-before-write, and optimistic pointer guards in source', () => {
    const source = readFileSync('functions/src/todDailyKpi.ts', 'utf8');
    expect(source).toContain("req.method !== 'POST'");
    expect(source).toContain('hasValidApiKey(req, INGEST_API_KEY.value())');
    expect(source).toContain('parseTodDailyKpiWorkbookBytes');
    expect(readFileSync('utils/todDailyKpiParser.ts', 'utf8')).toContain('MAX_TOD_DAILY_KPI_FILE_BYTES');
    expect(source).toContain('/raw/' + '$' + '{serviceDate}/');
    expect(source).toContain('loadExistingSummary(bucket, oldStoragePath)');
    expect(source).toContain('freshStoragePath !== oldStoragePath');
    expect(source).toContain('aborted to avoid overwriting it');
  });
});
