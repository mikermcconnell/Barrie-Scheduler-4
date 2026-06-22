import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { buildParkingReplacementSummary, getLatestParkingMonth } from '../utils/parking/parkingAggregation';
import { createParkingExportWorkbook, exportParkingWorkbook } from '../utils/parking/parkingExport';
import { getParkingCodeFamilyKey, parseParkingDurationMinutes, parseParkingFile, parseParkingWorkbook } from '../utils/parking/parkingParser';
import {
  assertParkingStoragePathUnchanged,
  normalizeParkingStoragePath,
  readParkingSettingsFromDocument,
  rebuildParkingSummaryWithRules,
} from '../utils/parking/parkingService';
import { DEFAULT_PARKING_SETTINGS, type ParkingMonthlyDataset, type ParkingSettings } from '../utils/parking/parkingTypes';

vi.mock('xlsx', async importOriginal => {
  const actual = await importOriginal<typeof import('xlsx')>();
  return {
    ...actual,
    writeFile: vi.fn(),
  };
});

function workbookBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const settings: ParkingSettings = {
  ...DEFAULT_PARKING_SETTINGS,
  codeFamilies: [
    { familyKey: 'RS', codes: ['RS2025', 'RS2026'], department: 'Recreation Services' },
    { familyKey: 'IF', codes: ['IF2026'], department: 'Infrastructure' },
  ],
  spotLocations: [
    { spotId: '7100', locationName: 'Waterfront Lot' },
    { spotId: '1430', locationName: 'Downtown Lot' },
  ],
};

function hotSpotRows(extraRows: unknown[][] = []): unknown[][] {
  return [
    ['HotSpot'],
    ['Licence Plate', 'Start Time', 'Spot Id/Tap Token', 'Length', 'Tap Signs/Spot', 'Discount Code', 'Description', 'Discount Amount'],
    ['ABC123', '2026-06-01 09:00:00 EDT', '7100', '6h0m', 'Spot', 'RS2026', 'Recreation Services', '50.00 $'],
    ['ABC123', '2026-06-02 09:00:00 EDT', '7100', '6h0m', 'Spot', 'RS2026', 'Recreation Services', '50.00 $'],
    ['ABC123', '2026-06-03 09:00:00 EDT', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '10.00 $'],
    ['XYZ999', '2026-06-08 18:30:00 EDT', '1430', '1h0m', 'Spot', 'IF2026', 'Infrastructure', '2.00 $'],
    ...extraRows,
  ];
}

function dataset(month: string, totalValue: number): ParkingMonthlyDataset {
  const parsed = parseParkingWorkbook(workbookBuffer(hotSpotRows()), {
    fileName: `${month}.xlsx`,
    importedBy: 'user-1',
    settings,
  }).dataset;
  return {
    ...parsed,
    month,
    totalValue,
    rows: parsed.rows.map(row => ({ ...row, startMonth: month })),
    departmentSummaries: parsed.departmentSummaries.map(row => ({ ...row, month, totalValue })),
  };
}

describe('parking parser and aggregation', () => {
  it('normalizes HotSpot rows, maps code families, and flags plate patterns', () => {
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings,
    });

    expect(result.unmappedCodeFamilies).toEqual([]);
    expect(result.dataset.month).toBe('2026-06');
    expect(result.dataset.rowCount).toBe(4);
    expect(result.dataset.totalValue).toBe(112);
    expect(result.dataset.rows[0]).toMatchObject({
      plate: 'ABC123',
      department: 'Recreation Services',
      codeFamilyKey: 'RS',
      locationName: 'Waterfront Lot',
      durationMinutes: 360,
      discountAmount: 50,
    });

    const abc = result.dataset.platePatterns.find(pattern => pattern.plate === 'ABC123');
    expect(abc?.flags).toEqual(expect.arrayContaining(['high_value', 'long_duration', 'consecutive_weekdays']));
    const xyz = result.dataset.platePatterns.find(pattern => pattern.plate === 'XYZ999');
    expect(xyz?.flags).toContain('unusual_timing');
  });

  it('requires unmapped discount code families before save', () => {
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows([
      ['NEW1', '2026-06-09 09:00:00 EDT', '1000', '1h0m', 'Spot', 'AB2026', 'Access Barrie', '1.00 $'],
    ])), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings,
    });

    expect(result.unmappedCodeFamilies).toEqual([
      expect.objectContaining({ familyKey: 'AB', codes: ['AB2026'], rowCount: 1 }),
    ]);
  });

  it('rejects files containing more than one month', () => {
    expect(() => parseParkingWorkbook(workbookBuffer(hotSpotRows([
      ['JULY1', '2026-07-01 09:00:00 EDT', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '1.00 $'],
    ])), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings,
    })).toThrow('Parking imports must contain one month at a time.');
  });

  it('rolls yearly codes into a family key', () => {
    expect(getParkingCodeFamilyKey('RS2026')).toBe('RS');
    expect(getParkingCodeFamilyKey('BFES25')).toBe('BFES');
    expect(getParkingCodeFamilyKey('')).toBe('');
    expect(parseParkingDurationMinutes('')).toBeNull();
    expect(parseParkingDurationMinutes('bad data')).toBeNull();
  });

  it('maps future-year discount codes by department short form', () => {
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows([
      ['FUTURE1', '2026-06-09 09:00:00 EDT', '1000', '1h0m', 'Spot', 'IF2026', 'Infrastructure', '1.00 $'],
    ])), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: {
        ...settings,
        codeFamilies: [
          { familyKey: '', codes: ['IF2025'], department: 'Infrastructure' },
        ],
      },
    });

    expect(result.unmappedCodeFamilies).toEqual([
      expect.objectContaining({ familyKey: 'RS', codes: ['RS2026'], rowCount: 3 }),
    ]);
    expect(result.dataset.rows.find(row => row.plate === 'FUTURE1')).toMatchObject({
      discountCode: 'IF2026',
      codeFamilyKey: 'IF',
      department: 'Infrastructure',
    });
  });

  it('uses seeded default department mappings when no Parking settings exist yet', () => {
    const firstRunSettings = readParkingSettingsFromDocument(undefined);
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: firstRunSettings,
    });

    expect(result.unmappedCodeFamilies).toEqual([]);
    expect(result.dataset.departmentSummaries.map(row => row.department)).toEqual(
      expect.arrayContaining(['Recreation Services', 'Infrastructure']),
    );
  });

  it('reports skipped rows and missing plates as warnings', () => {
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows([
      ['', '2026-06-10 09:00:00 EDT', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '5.00 $'],
      ['SKIP1', '', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '5.00 $'],
    ])), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      '1 rows were skipped because required HotSpot fields were missing or invalid.',
      '1 rows have missing licence plates and were flagged for review.',
    ]));
    expect(result.dataset.platePatterns.find(pattern => pattern.displayPlate === '(missing)')?.flags).toContain('missing_plate');
  });

  it('rejects malformed and non-Excel Parking files', async () => {
    expect(() => parseParkingWorkbook(workbookBuffer([['Not HotSpot']]), {
      fileName: 'bad.xlsx',
      importedBy: 'user-1',
      settings,
    })).toThrow('Could not find the HotSpot header row.');

    expect(() => parseParkingWorkbook(workbookBuffer([
      ['Licence Plate', 'Start Time', 'Spot Id/Tap Token', 'Length', 'Tap Signs/Spot', 'Discount Code', 'Description', 'Discount Amount'],
      ['BAD1', '', '7100', '', 'Spot', '', '', ''],
    ]), {
      fileName: 'empty.xlsx',
      importedBy: 'user-1',
      settings,
    })).toThrow('did not contain any importable usage rows');

    await expect(parseParkingFile(new File(['plain text'], 'HotSpot.csv'), 'user-1', settings)).rejects.toThrow('Upload a HotSpot Excel file');
  });

  it('parses a File object upload', async () => {
    const file = {
      name: 'HotSpot.xlsx',
      arrayBuffer: async () => workbookBuffer(hotSpotRows()),
    } as File;
    const result = await parseParkingFile(file, 'user-1', settings);

    expect(result.dataset.rowCount).toBe(4);
  });
});

describe('parking replacement and export', () => {
  it('replaces a month and recalculates month-over-month summaries', () => {
    const existing = buildParkingReplacementSummary(null, dataset('2026-05', 100), 'user-1', 'old.json', settings.flagRules);
    const next = buildParkingReplacementSummary(existing, dataset('2026-06', 300), 'user-2', 'new.json', settings.flagRules);

    expect(next.months.map(month => month.month)).toEqual(['2026-05', '2026-06']);
    expect(next.metadata).toMatchObject({ importedBy: 'user-2', monthCount: 2, storagePath: 'new.json' });
    expect(next.departmentSummaries.some(row => row.month === '2026-06' && row.previousValue !== null)).toBe(true);
  });

  it('flags department high usage for high totals or significant month-over-month increases', () => {
    const highTotal = buildParkingReplacementSummary(null, dataset('2026-06', 300), 'user-1', 'parking.json', settings.flagRules);
    expect(highTotal.departmentSummaries.some(row => row.month === '2026-06' && row.isHighUsage)).toBe(true);

    const strictRules = {
      ...settings.flagRules,
      departmentMonthlyValueDollars: 9999,
      departmentIncreasePercent: 50,
    };
    const existing = buildParkingReplacementSummary(null, dataset('2026-05', 10), 'user-1', 'old.json', strictRules);
    const increased = buildParkingReplacementSummary(existing, dataset('2026-06', 100), 'user-1', 'new.json', strictRules);

    expect(increased.departmentSummaries.some(row => (
      row.month === '2026-06' &&
      row.changePercent != null &&
      row.changePercent >= 50 &&
      row.isHighUsage
    ))).toBe(true);
  });

  it('creates the clean report workbook sheets', () => {
    const summary = buildParkingReplacementSummary(null, dataset('2026-06', 112), 'user-1', 'parking.json', settings.flagRules);
    const workbook = createParkingExportWorkbook(summary);

    expect(workbook.SheetNames).toEqual(['Overview', 'Department Summary', 'Flagged Plates', 'Raw Rows']);
  });

  it('normalizes and protects storage path replacement', () => {
    expect(normalizeParkingStoragePath('parking.json')).toBe('parking.json');
    expect(normalizeParkingStoragePath('')).toBeNull();
    expect(() => assertParkingStoragePathUnchanged('old.json', 'old.json')).not.toThrow();
    expect(() => assertParkingStoragePathUnchanged('old.json', 'new.json')).toThrow('Parking data changed while importing. Refresh and try again.');
  });

  it('recalculates plate flags when thresholds change', () => {
    const summary = buildParkingReplacementSummary(null, dataset('2026-06', 112), 'user-1', 'parking.json', settings.flagRules);
    const original = summary.platePatterns.find(pattern => pattern.plate === 'ABC123');
    expect(original?.flags).toContain('high_value');

    const stricter = rebuildParkingSummaryWithRules(summary, 'user-1', 'parking.json', {
      ...settings,
      flagRules: {
        ...settings.flagRules,
        plateMonthlyValueDollars: 999,
      },
    });
    const recalculated = stricter.platePatterns.find(pattern => pattern.plate === 'ABC123');
    expect(recalculated?.flags).not.toContain('high_value');
  });

  it('handles non-consecutive weekdays and latest month lookups', () => {
    const parsed = parseParkingWorkbook(workbookBuffer(hotSpotRows([
      ['GAP1', '2026-06-01 09:00:00 EDT', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '1.00 $'],
      ['GAP1', '2026-06-05 09:00:00 EDT', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '1.00 $'],
    ])), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings,
    });
    const gap = parsed.dataset.platePatterns.find(pattern => pattern.plate === 'GAP1');
    expect(gap?.maxConsecutiveWeekdays).toBe(1);

    const summary = buildParkingReplacementSummary(null, parsed.dataset, 'user-1', 'parking.json', settings.flagRules);
    expect(getLatestParkingMonth(summary)).toBe('2026-06');
    expect(getLatestParkingMonth(null)).toBeNull();
  });

  it('exports the Parking workbook file', () => {
    const summary = buildParkingReplacementSummary(null, dataset('2026-06', 112), 'user-1', 'parking.json', settings.flagRules);
    vi.mocked(XLSX.writeFile).mockClear();

    exportParkingWorkbook(summary, 'parking.xlsx');

    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.objectContaining({ SheetNames: ['Overview', 'Department Summary', 'Flagged Plates', 'Raw Rows'] }), 'parking.xlsx');
  });
});
