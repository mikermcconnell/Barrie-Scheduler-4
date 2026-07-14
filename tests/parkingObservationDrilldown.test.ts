import { describe, expect, it } from 'vitest';
import { buildParkingObservationDrilldown } from '../utils/parking/parkingObservations';
import { DEFAULT_PARKING_SETTINGS, type ParkingMonthlyDataset, type ParkingRawRow } from '../utils/parking/parkingTypes';

function rawRow(id: string, overrides: Partial<ParkingRawRow> = {}): ParkingRawRow {
  return {
    id,
    plate: `PLATE-${id}`,
    hasMissingPlate: false,
    startRaw: '2026-01-15 08:00',
    startDate: '2026-01-15',
    startMonth: '2026-01',
    startMinutes: 480,
    endMinutes: 540,
    weekday: 4,
    isWeekend: false,
    spotId: 'A1',
    locationName: 'City Hall',
    durationMinutes: 60,
    tapType: 'Sign',
    discountCode: 'TP2026',
    codeFamilyKey: 'TP',
    department: 'Transit',
    description: 'Transit staff',
    discountAmount: 10,
    ...overrides,
  };
}

function month(monthKey: string, rows: ParkingRawRow[]): ParkingMonthlyDataset {
  return {
    month: monthKey,
    rows,
    rowCount: rows.length,
    skippedRows: 0,
    totalValue: rows.reduce((sum, row) => sum + row.discountAmount, 0),
    departmentSummaries: [],
    platePatterns: [],
    sourceFileName: `${monthKey}.xlsx`,
    importedAt: '2026-07-14T00:00:00.000Z',
    importedBy: 'user-1',
  };
}

describe('annual parking raw observation drilldown', () => {
  const months = [
    month('2026-01', [
      rawRow('jan-transit'),
      rawRow('jan-other-family', { codeFamilyKey: 'OPS', discountCode: 'OPS2026', department: 'Transit', discountAmount: 20 }),
      rawRow('jan-fire', { codeFamilyKey: 'BFES', discountCode: 'BFES26', department: 'Fire', discountAmount: 30 }),
    ]),
    month('2026-02', [
      rawRow('feb-transit', { startMonth: '2026-02', startDate: '2026-02-20', discountAmount: 40 }),
      rawRow('parking-pass', { startMonth: '2026-02', codeFamilyKey: 'P1', department: 'City staff underground parking', discountAmount: 100 }),
    ]),
    month('2025-12', [rawRow('prior-year', { startMonth: '2025-12', startDate: '2025-12-01', discountAmount: 50 })]),
  ];

  it('selects a month and exact department-code family cell', () => {
    const result = buildParkingObservationDrilldown(months, DEFAULT_PARKING_SETTINGS, {
      year: '2026', month: '2026-01', codeFamilyKey: 'TP', department: 'Transit', label: 'Transit · January 2026',
    });
    expect(result.rows.map(row => row.id)).toEqual(['jan-transit']);
    expect(result.totalValue).toBe(10);
  });

  it('selects monthly, department annual, and grand totals', () => {
    const monthly = buildParkingObservationDrilldown(months, DEFAULT_PARKING_SETTINGS, {
      year: '2026', month: '2026-01', label: 'January total',
    });
    expect(monthly.rows).toHaveLength(3);
    expect(monthly.totalValue).toBe(60);

    const annualDepartment = buildParkingObservationDrilldown(months, DEFAULT_PARKING_SETTINGS, {
      year: '2026', codeFamilyKey: 'TP', department: 'Transit', label: 'Transit annual total',
    });
    expect(annualDepartment.rows.map(row => row.id)).toEqual(['feb-transit', 'jan-transit']);
    expect(annualDepartment.totalValue).toBe(50);

    const grandTotal = buildParkingObservationDrilldown(months, DEFAULT_PARKING_SETTINGS, {
      year: '2026', label: 'All observed values',
    });
    expect(grandTotal.rows.map(row => row.id)).not.toContain('parking-pass');
    expect(grandTotal.rows.map(row => row.id)).not.toContain('prior-year');
    expect(grandTotal.totalValue).toBe(100);
  });

  it('excludes ignored department mappings', () => {
    const settings = {
      ...DEFAULT_PARKING_SETTINGS,
      codeFamilies: [
        ...DEFAULT_PARKING_SETTINGS.codeFamilies,
        { familyKey: 'BFES', department: 'Fire', codes: ['BFES26'], ignoreData: true },
      ],
    };
    const result = buildParkingObservationDrilldown(months, settings, {
      year: '2026', label: 'All observed values',
    });
    expect(result.rows.map(row => row.id)).not.toContain('jan-fire');
    expect(result.totalValue).toBe(70);
  });
});
