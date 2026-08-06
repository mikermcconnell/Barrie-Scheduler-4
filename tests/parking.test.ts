import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { buildParkingReplacementSummary, buildParkingReplacementSummaryForMonths, buildParkingSummary, getLatestParkingMonth } from '../utils/parking/parkingAggregation';
import { buildParkingPlannerAnalysis } from '../utils/parking/parkingAnalysis';
import { getParkingCodeOverridesForYear, getParkingCodesForYear } from '../utils/parking/parkingCodeRules';
import { createParkingExportWorkbook, exportParkingWorkbook } from '../utils/parking/parkingExport';
import { getParkingCodeFamilyKey, parseParkingDurationMinutes, parseParkingFile, parseParkingWorkbook } from '../utils/parking/parkingParser';
import {
  buildParkingRevenueAnalytics,
  buildParkingRevenueReplacementSummary,
} from '../utils/parking/parkingRevenue';
import {
  parseParkingRevenueFile,
  parseParkingRevenueDurationMinutes,
  parseParkingRevenueWorkbook,
} from '../utils/parking/parkingRevenueParser';
import {
  buildParkingMapRevenueCoverage,
  buildParkingRevenueMapDisplayLocations,
  getParkingMapMetricValue,
} from '../utils/parking/parkingMapDisplay';
import {
  fetchBarriePublicParkingLocations,
  findPublicParkingLocationFallback,
} from '../utils/parking/publicParkingLocations';
import {
  mergeParkingRevenueLocationMappings,
  parseParkingLocationWorkbook,
} from '../utils/parking/parkingLocationWorkbook';
import {
  countMissingDefaultParkingRevenueLocations,
  DEFAULT_PARKING_REVENUE_LOCATIONS,
} from '../utils/parking/parkingDefaultLocations';
import {
  assertParkingStoragePathUnchanged,
  normalizeParkingStoragePath,
  readParkingSettingsFromDocument,
  rebuildParkingSummaryWithRules,
} from '../utils/parking/parkingService';
import { DEFAULT_PARKING_SETTINGS, type ParkingMonthlyDataset, type ParkingSettings } from '../utils/parking/parkingTypes';
import type { ParkingRevenueLocationSummary } from '../utils/parking/parkingTypes';

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

  it('excludes code families marked ignoreData from Parking summaries', () => {
    const ignoredSettings: ParkingSettings = {
      ...settings,
      codeFamilies: settings.codeFamilies.map(mapping => (
        mapping.familyKey === 'IF' ? { ...mapping, ignoreData: true } : mapping
      )),
    };
    const parsed = parseParkingWorkbook(workbookBuffer(hotSpotRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: ignoredSettings,
    }).dataset;

    const summary = buildParkingSummary([parsed], 'user-1', undefined, ignoredSettings);

    expect(summary.months[0].rows.some(row => row.codeFamilyKey === 'IF')).toBe(false);
    expect(summary.months[0].rowCount).toBe(3);
    expect(summary.months[0].totalValue).toBe(110);
    expect(summary.departmentSummaries.map(row => row.department)).not.toContain('Infrastructure');
    expect(summary.platePatterns.map(pattern => pattern.department)).not.toContain('Infrastructure');
  });

  it('supports two-digit yearly codes and manual yearly overrides', () => {
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows([
      ['SHORT1', '2026-06-10 09:00:00 EDT', '7100', '1h0m', 'Spot', 'BFES26', 'Fire', '5.00 $'],
      ['ALT1', '2026-06-10 10:00:00 EDT', '7100', '1h0m', 'Spot', 'EC2026', 'Economic', '5.00 $'],
    ])), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: {
        ...settings,
        codeFamilies: [
          ...settings.codeFamilies,
          { familyKey: 'BFES', codes: ['BFES25', 'BFES26'], activeYears: [2025, 2026], yearCodeFormat: 'yy', department: 'Barrie Fire' },
          { familyKey: 'ECD', codes: ['ECD2026'], activeYears: [2026], yearCodeFormat: 'yyyy', codeOverrides: { 2026: ['EC2026'] }, department: 'Economic and Creative Development' },
        ],
      },
    });

    expect(result.unmappedCodeFamilies).toEqual([]);
    expect(result.dataset.rows.find(row => row.plate === 'SHORT1')).toMatchObject({
      discountCode: 'BFES26',
      codeFamilyKey: 'BFES',
      department: 'Barrie Fire',
    });
    expect(result.dataset.rows.find(row => row.plate === 'ALT1')).toMatchObject({
      discountCode: 'EC2026',
      codeFamilyKey: 'EC',
      department: 'Economic and Creative Development',
    });
    expect(getParkingCodesForYear({ familyKey: 'BFES', codes: [], activeYears: [2026], yearCodeFormat: 'yy', department: 'Barrie Fire' }, 2026)).toEqual(['BFES26']);
    expect(getParkingCodeOverridesForYear({ familyKey: 'ECD', codes: [], activeYears: [2026], yearCodeFormat: 'yyyy', codeOverrides: { 2026: ['EC2026'] }, department: 'Economic' }, 2026)).toEqual(['EC2026']);
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

  it('replaces multiple different months in one batch', () => {
    const existing = buildParkingReplacementSummary(null, dataset('2026-04', 75), 'user-1', 'old.json', settings);
    const next = buildParkingReplacementSummaryForMonths(existing, [
      dataset('2026-05', 100),
      dataset('2026-06', 300),
    ], 'user-2', 'batch.json', settings);

    expect(next.months.map(month => month.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(next.metadata).toMatchObject({ importedBy: 'user-2', monthCount: 3, storagePath: 'batch.json' });
    expect(next.departmentSummaries.some(row => row.month === '2026-06' && row.previousValue !== null)).toBe(true);
  });

  it('rejects batch imports with duplicate months', () => {
    expect(() => buildParkingReplacementSummaryForMonths(null, [
      dataset('2026-06', 100),
      dataset('2026-06', 200),
    ], 'user-1', 'batch.json', settings)).toThrow('different months');
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

  it('persists department legend sort settings from Firestore settings', () => {
    const loaded = readParkingSettingsFromDocument({
      settings: {
        ...settings,
        departmentLegendSort: { key: 'department', direction: 'desc' },
      },
    });

    expect(loaded.departmentLegendSort).toEqual({ key: 'department', direction: 'desc' });
  });

  it('loads bundled ParkingLatLong coordinates into default Parking settings', () => {
    const loaded = readParkingSettingsFromDocument(undefined);
    const collier = loaded.revenueLocations?.find(location => location.id === 'hotspot-1322');

    expect(DEFAULT_PARKING_REVENUE_LOCATIONS.length).toBe(105);
    expect(countMissingDefaultParkingRevenueLocations(loaded.revenueLocations)).toBe(0);
    expect(collier).toMatchObject({
      displayName: 'Collier Street Parkade',
      latitude: 44.390066,
      longitude: -79.688843,
      capacitySpaces: 303,
    });
    expect(collier?.sourceRefs.map(ref => `${ref.source}:${ref.sourceId}`)).toEqual(['hotspot:1322', 'qr:1322']);
    expect(loaded.revenueLocationCategories?.map(category => category.id)).toEqual(expect.arrayContaining(['downtown', 'waterfront', 'hybrid', 'marina', 'hospital', 'allandale-go', 'special-events']));
    expect(loaded.revenueLocations?.every(location => Boolean(location.categoryId))).toBe(true);
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-1322')?.categoryId).toBe('downtown');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-1430')?.categoryId).toBe('downtown');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-7100')?.categoryId).toBe('waterfront');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-5100')?.categoryId).toBe('hybrid');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-5200')?.categoryId).toBe('hybrid');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-5300')?.categoryId).toBe('hybrid');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-5000')?.categoryId).toBe('marina');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-8105')?.categoryId).toBe('hospital');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-9105')?.categoryId).toBe('allandale-go');
    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-9000')).toMatchObject({
      displayName: 'Special Events',
      locationKind: 'non_spatial',
      latitude: null,
      longitude: null,
      capacitySpaces: null,
      categoryId: 'special-events',
      sourceRefs: [
        { source: 'hotspot', sourceId: '9000', label: 'Special Events' },
        { source: 'qr', sourceId: '9000', label: 'Event Parking' },
      ],
    });
  });

  it('does not materialize undefined location kinds when persisted settings are loaded again', () => {
    const firstLoad = readParkingSettingsFromDocument(undefined);
    const reloaded = readParkingSettingsFromDocument({
      settings: JSON.parse(JSON.stringify(firstLoad)),
    });

    expect(reloaded.revenueLocations?.filter(location => (
      Object.prototype.hasOwnProperty.call(location, 'locationKind')
      && location.locationKind === undefined
    ))).toEqual([]);
  });

  it('migrates the legacy H-Block default category from Hospital to Downtown', () => {
    const loaded = readParkingSettingsFromDocument({
      settings: {
        ...DEFAULT_PARKING_SETTINGS,
        revenueLocations: [
          {
            id: 'hotspot-1430',
            displayName: 'H-Block Parking Lot',
            latitude: 44.392072,
            longitude: -79.689572,
            capacitySpaces: 174,
            categoryId: 'hospital',
            sourceRefs: [{ source: 'hotspot', sourceId: '1430', label: 'H-Block Parking Lot' }],
          },
        ],
      },
    });

    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-1430')?.categoryId).toBe('downtown');
  });

  it('does not reapply seeded lot categories after a reviewed location is explicitly uncategorized', () => {
    const loaded = readParkingSettingsFromDocument({
      settings: {
        ...DEFAULT_PARKING_SETTINGS,
        revenueLocations: [
          {
            id: 'hotspot-5100',
            displayName: 'Spirit Catcher Parking Lot',
            latitude: 44.3869,
            longitude: -79.689648,
            capacitySpaces: 74,
            categoryId: null,
            sourceRefs: [{ source: 'hotspot', sourceId: '5100', label: 'Spirit Catcher Parking Lot' }],
          },
        ],
      },
    });

    expect(loaded.revenueLocations?.find(location => location.id === 'hotspot-5100')?.categoryId).toBeNull();
  });

  it('upgrades an existing HotSpot 9000 mapping to the seeded non-spatial kind', () => {
    const loaded = readParkingSettingsFromDocument({
      settings: {
        ...DEFAULT_PARKING_SETTINGS,
        revenueLocations: [{
          id: 'custom-events',
          displayName: 'Annual Events',
          latitude: null,
          longitude: null,
          sourceRefs: [{ source: 'hotspot', sourceId: '9000', label: 'Annual Events' }],
        }],
      },
    });

    expect(loaded.revenueLocations?.find(location => location.id === 'custom-events')).toMatchObject({
      displayName: 'Annual Events',
      locationKind: 'non_spatial',
      categoryId: 'special-events',
    });
  });

  it('adds missing default lot IDs without overwriting custom reviewed coordinates', () => {
    const loaded = readParkingSettingsFromDocument({
      settings: {
        ...DEFAULT_PARKING_SETTINGS,
        revenueLocations: [
          {
            id: 'custom-collier',
            displayName: 'Planner-reviewed Collier',
            latitude: 44.1,
            longitude: -79.1,
            sourceRefs: [{ source: 'hotspot', sourceId: '1322', label: 'Planner-reviewed Collier' }],
          },
        ],
      },
    });
    const collier = loaded.revenueLocations?.find(location => location.id === 'custom-collier');

    expect(countMissingDefaultParkingRevenueLocations(loaded.revenueLocations)).toBe(0);
    expect(collier).toMatchObject({
      displayName: 'Planner-reviewed Collier',
      latitude: 44.1,
      longitude: -79.1,
      capacitySpaces: 303,
    });
    expect(collier?.sourceRefs.map(ref => `${ref.source}:${ref.sourceId}`)).toEqual(['hotspot:1322', 'qr:1322']);
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

  it('suppresses plate indicators for departments marked ignore flags', () => {
    const ignoredSettings: ParkingSettings = {
      ...settings,
      codeFamilies: settings.codeFamilies.map(mapping => (
        mapping.familyKey === 'RS' ? { ...mapping, ignoreFlags: true } : mapping
      )),
    };
    const result = parseParkingWorkbook(workbookBuffer(hotSpotRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: ignoredSettings,
    });

    expect(result.dataset.platePatterns.find(pattern => pattern.plate === 'ABC123')?.flags).toEqual([]);
    expect(result.dataset.platePatterns.find(pattern => pattern.plate === 'XYZ999')?.flags).toContain('unusual_timing');

    const summary = buildParkingReplacementSummary(null, result.dataset, 'user-1', 'parking.json', ignoredSettings);
    expect(summary.platePatterns.find(pattern => pattern.plate === 'ABC123')?.flags).toEqual([]);
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

describe('parking revenue parser and analytics', () => {
  it('rejects oversized revenue workbooks before reading them', async () => {
    const arrayBuffer = vi.fn();
    const file = {
      name: 'oversized.xlsx',
      size: 25 * 1024 * 1024 + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(parseParkingRevenueFile(file, 'user-1', settings)).rejects.toThrow('25 MB or smaller');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  function revenueSettings(): ParkingSettings {
    return {
      ...DEFAULT_PARKING_SETTINGS,
      revenueLocations: [
        {
          id: 'collier-parkade',
          displayName: 'Collier Parkade',
          latitude: 44.389,
          longitude: -79.69,
          sourceRefs: [
            { source: 'hotspot', sourceId: '1322', label: 'COLLIER PARKADE' },
            { source: 'qr', sourceId: '1322', label: 'Collier Parkade' },
          ],
        },
      ],
    };
  }

  it('parses HotSpot app revenue workbooks and uses Amount as revenue', () => {
    const result = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'User', 'Plate', 'Make', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'user', 'ABC123', 'Honda', '2.21  $', '0.29  $', '2.50  $', '0.25', 'Wallet Transaction'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 10:00:00', 'user', 'XYZ999', 'Ford', '8.85  $', '1.15  $', '10.00  $', '1', 'visa'],
    ]), {
      fileName: 'Hotspot Parking Revenue_Jan 2026.xlsx',
      importedBy: 'user-1',
      settings: revenueSettings(),
    });

    expect(result.dataset.source).toBe('hotspot');
    expect(result.dataset.month).toBe('2026-01');
    expect(result.dataset.rowCount).toBe(2);
    expect(result.dataset.totalRevenue).toBe(11.06);
    expect(result.dataset.totalPaid).toBe(12.5);
    expect(result.dataset.rows[0]).toMatchObject({
      source: 'hotspot',
      sourceId: '1322',
      sourceLabel: 'COLLIER PARKADE',
      physicalLocationId: 'collier-parkade',
      durationMinutes: 15,
      amount: 2.21,
      total: 2.5,
    });
    expect(result.dataset.rows.every(row => row.source === 'hotspot')).toBe(true);
  });

  it('parses QR revenue workbooks and keeps zero-amount activity', () => {
    const result = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'Meter #', 'Tap Sign', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '8105', 'Gallie Court On Street', '2026-01-31 18:00:32', 'HBFWR', '0.00', '0.00', '0.00', '1', 'Wallet Transaction'],
      ['', '1322', 'Collier Parkade', '2026-01-31 16:01:41', 'CDHM437', '1.28', '0.17', '1.45', '0.972', 'visa'],
    ]), {
      fileName: 'Hotsport QR Code Revenue_Jan 2026.xlsx',
      importedBy: 'user-1',
      settings: revenueSettings(),
    });

    expect(result.dataset.source).toBe('qr');
    expect(result.dataset.rowCount).toBe(2);
    expect(result.dataset.totalRevenue).toBe(1.28);
    expect(result.dataset.rows[0]).toMatchObject({
      sourceId: '8105',
      physicalLocationId: null,
      durationMinutes: 60,
      amount: 0,
    });
    expect(result.warnings).toContain('1 revenue rows have $0 Amount and are included in activity counts.');
    expect(parseParkingRevenueDurationMinutes('0.972')).toBe(58);
    expect(parseParkingRevenueDurationMinutes('0')).toBe(0);
  });

  it('corrects shifted QR export columns and maps QR 9000 to Special Events', () => {
    const settings = readParkingSettingsFromDocument(undefined);
    const result = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'Meter #', 'Tap Sign', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type', 'Moneris ID'],
      ['', '9000', 'Event Parking', '2026-07-31 18:00:00', 'EVENT1', '13.27 $', '1.73 $', '0.35 $', '15.00 $', '1', 'mastercard'],
    ]), { fileName: 'shifted-qr.xlsx', importedBy: 'user-1', settings });
    const summary = buildParkingRevenueReplacementSummary(null, [result.dataset], 'user-1', 'revenue.json');
    const analytics = buildParkingRevenueAnalytics(summary, settings, { categoryId: 'special-events' });

    expect(result.dataset).toMatchObject({
      rowCount: 1,
      totalRevenue: 13.27,
      totalTax: 1.73,
      totalPaid: 15,
    });
    expect(result.dataset.rows[0]).toMatchObject({
      physicalLocationId: 'hotspot-9000',
      durationMinutes: 60,
      total: 15,
      paymentType: 'mastercard',
    });
    expect(result.warnings).toContain('The QR export used shifted Total, Length, and Card Type columns; their positions were corrected during import.');
    expect(analytics).toMatchObject({ rowCount: 1, totalRevenue: 13.27 });
    expect(analytics.locationSummaries[0]).toMatchObject({
      locationKind: 'non_spatial',
      categoryId: 'special-events',
    });
  });

  it('replaces revenue by source/month and aggregates reviewed physical locations', () => {
    const settings = revenueSettings();
    const hotspot = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'ABC123', '10.00', '1.30', '11.30', '1', 'Wallet Transaction'],
    ]), { fileName: 'app.xlsx', importedBy: 'user-1', settings }).dataset;
    const qr = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'Meter #', 'Tap Sign', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'Collier Parkade', '2026-01-31 10:00:00', 'XYZ999', '5.00', '0.65', '5.65', '2', 'visa'],
    ]), { fileName: 'qr.xlsx', importedBy: 'user-1', settings }).dataset;

    const summary = buildParkingRevenueReplacementSummary(null, [hotspot, qr], 'user-1', 'revenue.json');
    const analytics = buildParkingRevenueAnalytics(summary, settings);
    const collier = analytics.locationSummaries.find(location => location.key === 'collier-parkade');

    expect(summary.datasets.map(dataset => `${dataset.month}:${dataset.source}`)).toEqual(['2026-01:hotspot', '2026-01:qr']);
    expect(analytics.totalRevenue).toBe(15);
    expect(collier).toMatchObject({
      displayName: 'Collier Parkade',
      isMapped: true,
      totalRevenue: 15,
      rowCount: 2,
      hotspotRevenue: 10,
      qrRevenue: 5,
    });
  });

  it('filters revenue analytics by uploader', () => {
    const settings = revenueSettings();
    const madisonDataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'MADISON', '10.00', '1.30', '11.30', '1', 'visa'],
    ]), { fileName: 'madison.xlsx', importedBy: 'madison.shortt', settings }).dataset;
    const otherDataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-02-01 09:00:00', 'OTHER', '5.00', '0.65', '5.65', '1', 'visa'],
    ]), { fileName: 'other.xlsx', importedBy: 'user-2', settings }).dataset;

    const summary = buildParkingRevenueReplacementSummary(null, [madisonDataset, otherDataset], 'user-1', 'revenue.json');

    expect(buildParkingRevenueAnalytics(summary, settings, { importedBy: 'madison.shortt' }).totalRevenue).toBe(10);
    expect(buildParkingRevenueAnalytics(summary, settings, { importedBy: 'user-2' }).totalRevenue).toBe(5);
    expect(buildParkingRevenueAnalytics(summary, settings, { importedBy: 'all' }).totalRevenue).toBe(15);
  });

  it('does not scan rows from monthly datasets outside the requested period', () => {
    const settings = revenueSettings();
    const januaryDataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'JAN', '10.00', '1.30', '11.30', '1', 'visa'],
    ]), { fileName: 'january.xlsx', importedBy: 'user-1', settings }).dataset;
    const februaryDataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-02-01 09:00:00', 'FEB', '20.00', '2.60', '22.60', '1', 'visa'],
    ]), { fileName: 'february.xlsx', importedBy: 'user-1', settings }).dataset;
    Object.defineProperty(februaryDataset, 'rows', {
      configurable: true,
      get: () => {
        throw new Error('Unrelated month rows were scanned');
      },
    });
    const summary = buildParkingRevenueReplacementSummary(
      null,
      [januaryDataset, februaryDataset],
      'user-1',
      'revenue.json',
    );

    expect(buildParkingRevenueAnalytics(summary, settings, { months: ['2026-01'] }).totalRevenue).toBe(10);
  });

  it('filters revenue analytics by weekdays, Saturdays, and Sundays separately', () => {
    const settings = revenueSettings();
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-30 09:00:00', 'WEEKDAY', '10.00', '1.30', '11.30', '1', 'visa'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 10:00:00', 'SATURDAY', '20.00', '2.60', '22.60', '1', 'visa'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-25 11:00:00', 'SUNDAY', '30.00', '3.90', '33.90', '1', 'visa'],
    ]), { fileName: 'app.xlsx', importedBy: 'user-1', settings }).dataset;

    const summary = buildParkingRevenueReplacementSummary(null, [dataset], 'user-1', 'revenue.json');

    expect(buildParkingRevenueAnalytics(summary, settings, { dayType: 'weekday' }).totalRevenue).toBe(10);
    expect(buildParkingRevenueAnalytics(summary, settings, { dayType: 'saturday' }).totalRevenue).toBe(20);
    expect(buildParkingRevenueAnalytics(summary, settings, { dayType: 'sunday' }).totalRevenue).toBe(30);
    expect(buildParkingRevenueAnalytics(summary, settings, { dayType: 'weekend' }).totalRevenue).toBe(50);
  });

  it('filters revenue by lot category and estimates time-based utilization', () => {
    const settings: ParkingSettings = {
      ...DEFAULT_PARKING_SETTINGS,
      revenueLocations: [
        {
          id: 'collier-parkade',
          displayName: 'Collier Parkade',
          latitude: 44.389,
          longitude: -79.69,
          capacitySpaces: 10,
          categoryId: 'downtown',
          sourceRefs: [{ source: 'hotspot', sourceId: '1322', label: 'Collier Parkade' }],
        },
        {
          id: 'marina-lot',
          displayName: 'Marina Lot',
          latitude: 44.38,
          longitude: -79.68,
          capacitySpaces: 5,
          categoryId: 'marina',
          sourceRefs: [{ source: 'hotspot', sourceId: '5000', label: 'Marina Lot' }],
        },
      ],
    };
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'Collier Parkade', '2026-01-01 09:30:00', 'ABC123', '20.00', '2.60', '22.60', '2', 'visa'],
      ['', '5000', 'Marina Lot', '2026-01-01 10:00:00', 'MARINA', '10.00', '1.30', '11.30', '1', 'visa'],
      ['', '1322', 'Collier Parkade', '2026-01-02 09:00:00', 'XYZ999', '5.00', '0.65', '5.65', '1', 'visa'],
      ['', '1322', 'Collier Parkade', '2026-01-03 15:00:00', 'LATE', '7.00', '0.91', '7.91', '1', 'visa'],
    ]), { fileName: 'app.xlsx', importedBy: 'user-1', settings }).dataset;

    const summary = buildParkingRevenueReplacementSummary(null, [dataset], 'user-1', 'revenue.json');
    const downtown = buildParkingRevenueAnalytics(summary, settings, { categoryId: 'downtown', hourStart: 9, hourEnd: 10 });
    const planner = buildParkingPlannerAnalysis(downtown, null, {
      'collier-parkade': { spaces: 10 },
    });

    expect(downtown.totalRevenue).toBe(25);
    expect(downtown.locationSummaries.map(location => location.categoryLabel)).toEqual(['Downtown']);
    expect(downtown.paidMinutes).toBe(150);
    expect(downtown.activeDayCount).toBe(3);
    expect(planner.capacityRows[0]).toMatchObject({
      key: 'collier-parkade',
      spaces: 10,
      paidMinutes: 150,
      utilizationPercent: 4.2,
    });
    expect(planner.categoryComparisonRows[0]).toMatchObject({
      key: 'downtown',
      label: 'Downtown',
      spaces: 10,
      utilizationPercent: 4.2,
    });
  });

  it('classifies HotSpot 9000 as non-spatial Special Events revenue', () => {
    const settings = readParkingSettingsFromDocument(undefined);
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '9000', 'Special Events', '2026-07-01 18:00:00', 'EVENT1', '25.00', '3.25', '28.25', '3', 'visa'],
    ]), { fileName: 'special-events.xlsx', importedBy: 'user-1', settings }).dataset;
    const summary = buildParkingRevenueReplacementSummary(null, [dataset], 'user-1', 'revenue.json');

    const analytics = buildParkingRevenueAnalytics(summary, settings, { categoryId: 'special-events' });
    const planner = buildParkingPlannerAnalysis(analytics, analytics.locationSummaries[0]);
    const displayLocations = buildParkingRevenueMapDisplayLocations(analytics.locationSummaries, new Map());
    const coverage = buildParkingMapRevenueCoverage(analytics.locationSummaries, displayLocations);

    expect(analytics).toMatchObject({
      totalRevenue: 25,
      rowCount: 1,
      mappedLocationSummaries: [],
      unmappedLocationSummaries: [],
    });
    expect(analytics.nonSpatialLocationSummaries).toHaveLength(1);
    expect(analytics.locationSummaries[0]).toMatchObject({
      key: 'hotspot-9000',
      displayName: 'Special Events',
      locationKind: 'non_spatial',
      mapStatus: 'not_applicable',
      categoryId: 'special-events',
      categoryLabel: 'Special Events',
      isMapped: false,
    });
    expect(displayLocations).toEqual([]);
    expect(planner.selectedLot?.rows).toHaveLength(1);
    expect(planner.selectedLot?.rows[0]).toMatchObject({ source: 'hotspot', sourceId: '9000', amount: 25 });
    expect(coverage).toEqual({
      coveredRevenue: 0,
      spatialRevenue: 0,
      uncoveredSpatialRevenue: 0,
      nonSpatialRevenue: 25,
      coveragePercent: null,
    });
  });

  it('counts paid-minute overlap without adding out-of-window sessions or revenue', () => {
    const settings: ParkingSettings = {
      ...DEFAULT_PARKING_SETTINGS,
      revenueLocations: [{
        id: 'lot-a',
        displayName: 'Lot A',
        latitude: 44.39,
        longitude: -79.69,
        capacitySpaces: 10,
        categoryId: 'downtown',
        sourceRefs: [{ source: 'hotspot', sourceId: '100', label: 'Lot A' }],
      }],
    };
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '100', 'Lot A', '2026-01-01 08:30:00', 'EARLY', '20.00', '2.60', '22.60', '2', 'visa'],
      ['', '100', 'Lot A', '2026-01-01 11:00:00', 'BOUNDARY', '10.00', '1.30', '11.30', '1', 'visa'],
    ]), { fileName: 'overlap.xlsx', importedBy: 'user-1', settings }).dataset;
    const summary = buildParkingRevenueReplacementSummary(null, [dataset], 'user-1', 'revenue.json');

    const result = buildParkingRevenueAnalytics(summary, settings, { hourStart: 9, hourEnd: 10 });

    expect(result).toMatchObject({ rowCount: 0, totalRevenue: 0, paidMinutes: 90 });
    expect(result.locationSummaries).toHaveLength(1);
    expect(result.locationSummaries[0]).toMatchObject({
      key: 'lot-a',
      rowCount: 0,
      totalRevenue: 0,
      paidMinutes: 90,
    });
  });

  it('wraps overnight paid-minute overlap into after-midnight hour filters', () => {
    const settings: ParkingSettings = {
      ...DEFAULT_PARKING_SETTINGS,
      revenueLocations: [{
        id: 'overnight-lot',
        displayName: 'Overnight Lot',
        latitude: 44.39,
        longitude: -79.69,
        capacitySpaces: 10,
        categoryId: 'downtown',
        sourceRefs: [{ source: 'hotspot', sourceId: '100', label: 'Overnight Lot' }],
      }],
    };
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '100', 'Overnight Lot', '2026-01-01 23:30:00', 'NIGHT', '20.00', '2.60', '22.60', '2', 'visa'],
    ]), { fileName: 'overnight.xlsx', importedBy: 'user-1', settings }).dataset;
    const summary = buildParkingRevenueReplacementSummary(null, [dataset], 'user-1', 'revenue.json');

    const result = buildParkingRevenueAnalytics(summary, settings, { hourStart: 0, hourEnd: 1 });

    expect(result).toMatchObject({ rowCount: 0, totalRevenue: 0, paidMinutes: 90 });
    expect(result.locationSummaries[0]).toMatchObject({ rowCount: 0, paidMinutes: 90 });
  });

  it('keeps same-named locations isolated when filtering by category', () => {
    const settings: ParkingSettings = {
      ...DEFAULT_PARKING_SETTINGS,
      revenueLocations: [
        {
          id: 'downtown-bayfield',
          displayName: 'Bayfield Street Parking',
          latitude: 44.39,
          longitude: -79.69,
          categoryId: 'downtown',
          sourceRefs: [{ source: 'hotspot', sourceId: '100', label: 'Bayfield Street Parking' }],
        },
        {
          id: 'waterfront-bayfield',
          displayName: 'Bayfield Street Parking',
          latitude: 44.38,
          longitude: -79.68,
          categoryId: 'waterfront',
          sourceRefs: [{ source: 'hotspot', sourceId: '200', label: 'Bayfield Street Parking' }],
        },
      ],
    };
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '100', 'Bayfield Street Parking', '2026-01-01 09:00:00', 'DOWN', '10.00', '1.30', '11.30', '1', 'visa'],
      ['', '200', 'Bayfield Street Parking', '2026-01-01 09:00:00', 'WATER', '20.00', '2.60', '22.60', '1', 'visa'],
    ]), { fileName: 'same-name.xlsx', importedBy: 'user-1', settings }).dataset;
    const summary = buildParkingRevenueReplacementSummary(null, [dataset], 'user-1', 'revenue.json');

    const result = buildParkingRevenueAnalytics(summary, settings, { categoryId: 'downtown' });

    expect(result.totalRevenue).toBe(10);
    expect(result.rows.map(entry => entry.sourceId)).toEqual(['100']);
    expect(result.locationSummaries.map(entry => entry.key)).toEqual(['downtown-bayfield']);
  });

  it('applies reviewed map locations to already-imported revenue rows', () => {
    const importedWithoutMapping = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'ABC123', '10.00', '1.30', '11.30', '1', 'Wallet Transaction'],
    ]), { fileName: 'app.xlsx', importedBy: 'user-1', settings: DEFAULT_PARKING_SETTINGS }).dataset;

    const summary = buildParkingRevenueReplacementSummary(null, [importedWithoutMapping], 'user-1', 'revenue.json');
    const analytics = buildParkingRevenueAnalytics(summary, revenueSettings());
    const collier = analytics.locationSummaries.find(location => location.key === 'collier-parkade');

    expect(collier).toMatchObject({
      displayName: 'Collier Parkade',
      isMapped: true,
      latitude: 44.389,
      longitude: -79.69,
      totalRevenue: 10,
    });
  });
});

describe('parking location workbook parser', () => {
  it('imports City parking coordinates, groups duplicate HotSpot IDs, and keeps spaces', () => {
    const result = parseParkingLocationWorkbook(workbookBuffer([
      ['Please note that these coordinates are provided in GCS_WGS_1984.'],
      ['OBJECTID *', 'Parking Name', 'Lot Address/ Parking Location', 'Number of Spaces', 'Common Name', 'Hot Spot ID', 'Longitude', 'Latitude'],
      [1, 'Heritage Park Lot', '5 Simcoe St', 24, 'Heritage Park Lot', 1130, -79.685086, 44.388601],
      [2, 'Heritage Park Lot', '5 Simcoe St', 8, 'Heritage Park Lot', 1130, -79.685024, 44.388883],
      [3, 'Skipped Lot', 'Unknown', 1, 'Skipped Lot', '<Null>', -79.68, 44.38],
    ]));

    expect(result.rowCount).toBe(2);
    expect(result.skippedRows).toBe(1);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]).toMatchObject({
      id: 'hotspot-1130',
      displayName: 'Heritage Park Lot',
      capacitySpaces: 32,
      sourceRefs: [
        { source: 'hotspot', sourceId: '1130', label: 'Heritage Park Lot' },
        { source: 'qr', sourceId: '1130', label: 'Heritage Park Lot' },
      ],
    });
    expect(result.mappings[0].latitude).toBeCloseTo(44.388672, 6);
    expect(result.mappings[0].longitude).toBeCloseTo(-79.68507, 6);
    expect(result.warnings).toContain('1 rows were skipped because they were missing Hot Spot ID or valid coordinates.');
  });

  it('merges imported reviewed locations over existing locations with the same source IDs', () => {
    const merged = mergeParkingRevenueLocationMappings([
      {
        id: 'old-collier',
        displayName: 'Old Collier',
        latitude: 44,
        longitude: -79,
        sourceRefs: [{ source: 'hotspot', sourceId: '1322', label: 'Old Collier' }],
      },
    ], [
      {
        id: 'hotspot-1322',
        displayName: 'Collier Street Parkade',
        latitude: 44.389,
        longitude: -79.69,
        capacitySpaces: 299,
        sourceRefs: [
          { source: 'hotspot', sourceId: '1322', label: 'Collier Street Parkade' },
          { source: 'qr', sourceId: '1322', label: 'Collier Street Parkade' },
        ],
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'hotspot-1322',
      displayName: 'Collier Street Parkade',
      latitude: 44.389,
      longitude: -79.69,
      capacitySpaces: 299,
    });
    expect(merged[0].sourceRefs.map(ref => `${ref.source}:${ref.sourceId}`)).toEqual(['hotspot:1322', 'qr:1322']);
  });
});

describe('public parking location fallback', () => {
  const summaryFor = (sourceId: string, displayName = 'Collier Parkade'): ParkingRevenueLocationSummary => ({
    key: `hotspot:${sourceId}`,
    displayName,
    locationKind: 'physical',
    mapStatus: 'unmapped',
    sourceIds: [{ source: 'hotspot', sourceId, label: displayName }],
    latitude: null,
    longitude: null,
    isMapped: false,
    rowCount: 1,
    totalRevenue: 10,
    totalPaid: 11.3,
    averageStayMinutes: 60,
    uniquePlateCount: 1,
    hotspotRevenue: 10,
    qrRevenue: 0,
    peakHour: 9,
    peakDay: '2026-01-31',
  });

  it('fetches City parking polygons, merges duplicate HotSpot IDs, and uses weighted coordinates', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: {
              OBJECTID: 1,
              PARKINGID: 'A',
              PARKING_NAME: 'Collier Street Parkade',
              CARTONAME: 'Collier Parkade',
              ADDRESS: '31 Collier St',
              HOTSPOT_ID: '1322',
              NUMSPACES: 1,
              TYPE: 'Lot',
              CLASSIFICATION: 'Municipal',
            },
            geometry: { rings: [[[-79, 44]]] },
          },
          {
            attributes: {
              OBJECTID: 2,
              PARKINGID: 'B',
              PARKING_NAME: 'Collier Street Parkade',
              CARTONAME: 'Collier Parkade',
              ADDRESS: '31 Collier St',
              HOTSPOT_ID: '1322',
              NUMSPACES: 3,
              TYPE: 'Lot',
              CLASSIFICATION: 'Municipal',
            },
            geometry: { rings: [[[-80, 45]]] },
          },
        ],
      }),
    } as Response));

    const locations = await fetchBarriePublicParkingLocations(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/query?'));
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({
      id: 'hotspot-1322',
      hotspotId: '1322',
      objectIds: [1, 2],
      numSpaces: 4,
      latitude: 44.75,
      longitude: -79.75,
    });
  });

  it('matches public locations by HotSpot ID first', () => {
    const match = findPublicParkingLocationFallback(summaryFor('1322', 'Some label'), [
      {
        id: 'hotspot-1322',
        objectIds: [1],
        hotspotId: '1322',
        parkingId: 'A',
        name: 'Collier Street Parkade',
        commonName: 'Collier Parkade',
        address: '31 Collier St',
        latitude: 44.39,
        longitude: -79.69,
        numSpaces: 300,
        type: 'Lot',
        classification: 'Municipal',
        sourceUrl: 'source',
      },
    ]);

    expect(match).toMatchObject({ matchType: 'hotspot-id', confidence: 'high' });
  });

  it('never assigns a public map fallback to a non-spatial revenue group', () => {
    const specialEvents = {
      ...summaryFor('9000', 'Special Events'),
      locationKind: 'non_spatial' as const,
      mapStatus: 'not_applicable' as const,
    };
    const match = findPublicParkingLocationFallback(specialEvents, [{
      id: 'hotspot-9000',
      objectIds: [1],
      hotspotId: '9000',
      parkingId: 'EVENT',
      name: 'Special Events',
      commonName: 'Special Events',
      address: '',
      latitude: 44.39,
      longitude: -79.69,
      numSpaces: null,
      type: 'Event',
      classification: 'Event',
      sourceUrl: 'source',
    }]);

    expect(match).toBeNull();
  });

  it('falls back to matching by lot name', () => {
    const match = findPublicParkingLocationFallback(summaryFor('9999', 'Heritage Park Lot'), [
      {
        id: 'public-1',
        objectIds: [1],
        hotspotId: '',
        parkingId: 'A',
        name: 'Heritage Park Parking Lot',
        commonName: 'Heritage Park Lot',
        address: '5 Simcoe St',
        latitude: 44.38,
        longitude: -79.69,
        numSpaces: 40,
        type: 'Lot',
        classification: 'Municipal',
        sourceUrl: 'source',
      },
    ]);

    expect(match).toMatchObject({ matchType: 'name', confidence: 'medium' });
  });

  it('groups public fallback display pins by physical City lot', () => {
    const publicMatch = {
      location: {
        id: 'hotspot-1322',
        objectIds: [1],
        hotspotId: '1322',
        parkingId: 'A',
        name: 'Collier Street Parkade',
        commonName: 'Collier Parkade',
        address: '31 Collier St',
        latitude: 44.39,
        longitude: -79.69,
        numSpaces: 300,
        type: 'Lot',
        classification: 'Municipal',
        sourceUrl: 'source',
      },
      matchType: 'hotspot-id' as const,
      confidence: 'high' as const,
    };
    const sourceA = summaryFor('1322', 'Collier HotSpot');
    const sourceB: ParkingRevenueLocationSummary = {
      ...summaryFor('8105', 'Collier QR'),
      key: 'qr:8105',
      sourceIds: [{ source: 'qr', sourceId: '8105', label: 'Collier QR' }],
      rowCount: 3,
      totalRevenue: 25,
      totalPaid: 28.25,
      averageStayMinutes: 90,
      uniquePlateCount: 3,
      hotspotRevenue: 0,
      qrRevenue: 25,
    };
    const publicMatches = new Map([
      [sourceA.key, publicMatch],
      [sourceB.key, publicMatch],
    ]);

    const displayLocations = buildParkingRevenueMapDisplayLocations([sourceA, sourceB], publicMatches);

    expect(displayLocations).toHaveLength(1);
    expect(displayLocations[0]).toMatchObject({
      key: 'public:hotspot-1322',
      displayName: 'Collier Parkade (2 IDs)',
      coordinateSource: 'public',
      aggregateCount: 2,
      rowCount: 4,
      totalRevenue: 35,
      hotspotRevenue: 10,
      qrRevenue: 25,
      capacitySpaces: 300,
    });
    expect(displayLocations[0].sourceLocationKeys).toEqual([sourceA.key, sourceB.key]);
    expect(getParkingMapMetricValue(displayLocations[0], 'revenuePerSpace')).toBeCloseTo(35 / 300);
  });

  it('keeps reviewed map locations as exact individual display pins', () => {
    const reviewed: ParkingRevenueLocationSummary = {
      ...summaryFor('1322', 'Collier Parkade'),
      key: 'collier-parkade',
      latitude: 44.389,
      longitude: -79.69,
      mapStatus: 'mapped',
      isMapped: true,
      totalRevenue: 42,
      rowCount: 5,
    };

    const displayLocations = buildParkingRevenueMapDisplayLocations([reviewed], new Map());

    expect(displayLocations).toHaveLength(1);
    expect(displayLocations[0]).toMatchObject({
      key: 'collier-parkade',
      displayName: 'Collier Parkade',
      coordinateSource: 'reviewed',
      latitude: 44.389,
      longitude: -79.69,
      aggregateCount: 1,
      totalRevenue: 42,
    });
    expect(getParkingMapMetricValue(displayLocations[0], 'sessions')).toBe(5);
  });

  it('keeps nearby distinct parking lots separate', () => {
    const first: ParkingRevenueLocationSummary = {
      ...summaryFor('1322', 'Collier Street Parkade'),
      key: 'collier',
      latitude: 44.389,
      longitude: -79.69,
      mapStatus: 'mapped',
      isMapped: true,
      totalRevenue: 100,
      rowCount: 10,
    };
    const nearby: ParkingRevenueLocationSummary = {
      ...summaryFor('1323', 'Dunlop Street On-Street'),
      key: 'dunlop',
      latitude: 44.3892,
      longitude: -79.6902,
      mapStatus: 'mapped',
      isMapped: true,
      totalRevenue: 50,
      rowCount: 5,
    };
    const distant: ParkingRevenueLocationSummary = {
      ...summaryFor('9999', 'Waterfront Lot'),
      key: 'waterfront',
      latitude: 44.405,
      longitude: -79.66,
      mapStatus: 'mapped',
      isMapped: true,
      totalRevenue: 25,
      rowCount: 3,
    };
    const displayLocations = buildParkingRevenueMapDisplayLocations([first, nearby, distant], new Map());

    expect(displayLocations).toHaveLength(3);
    expect(displayLocations.map(location => location.key)).toEqual(['collier', 'dunlop', 'waterfront']);
    expect(displayLocations.find(location => location.key === 'collier')).toMatchObject({
      displayName: 'Collier Street Parkade',
      aggregateCount: 1,
      totalRevenue: 100,
    });
    expect(displayLocations.find(location => location.key === 'dunlop')).toMatchObject({
      displayName: 'Dunlop Street On-Street',
      aggregateCount: 1,
      totalRevenue: 50,
    });
  });
});
