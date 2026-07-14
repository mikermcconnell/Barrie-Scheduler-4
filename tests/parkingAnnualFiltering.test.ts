import { describe, expect, it } from 'vitest';
import {
  buildParkingObservationDrilldown,
  filterParkingObservationRows,
} from '../utils/parking/parkingObservations';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingMonthlyDataset,
  type ParkingRawRow,
} from '../utils/parking/parkingTypes';

function row(id: string, overrides: Partial<ParkingRawRow> = {}): ParkingRawRow {
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
    totalValue: rows.reduce((sum, item) => sum + item.discountAmount, 0),
    departmentSummaries: [],
    platePatterns: [],
    sourceFileName: `${monthKey}.xlsx`,
    importedAt: '2026-07-14T00:00:00.000Z',
    importedBy: 'user-1',
  };
}

describe('Parking annual observation filtering', () => {
  it('keeps one-pass annual aggregation equivalent to every drilldown scope', () => {
    const januaryRows = [
      row('jan-transit-late', { startDate: '2026-01-20', startMinutes: 600, discountAmount: 10 }),
      row('jan-transit-early', { startDate: '2026-01-05', discountAmount: 15 }),
      row('jan-fire', { codeFamilyKey: 'BFES', discountCode: 'BFES26', department: 'Fire', discountAmount: 30 }),
      row('jan-ignored', { codeFamilyKey: 'HR', discountCode: 'HR2026', department: 'Human Resources', discountAmount: 50 }),
    ];
    const februaryRows = [
      row('feb-transit', { startMonth: '2026-02', startDate: '2026-02-10', discountAmount: 20 }),
      row('feb-operations', {
        startMonth: '2026-02',
        startDate: '2026-02-12',
        codeFamilyKey: 'OPS',
        discountCode: 'OPS2026',
        department: 'Operations',
        discountAmount: 40,
      }),
      row('feb-parking-pass', {
        startMonth: '2026-02',
        codeFamilyKey: 'P1',
        department: 'City staff underground parking',
        discountAmount: 100,
      }),
    ];
    const priorYearRows = [row('prior-year', {
      startMonth: '2025-12',
      startDate: '2025-12-01',
      discountAmount: 200,
    })];
    const months = [
      month('2026-01', januaryRows),
      month('2026-02', februaryRows),
      month('2025-12', priorYearRows),
    ];
    const settings = {
      ...DEFAULT_PARKING_SETTINGS,
      codeFamilies: [
        ...DEFAULT_PARKING_SETTINGS.codeFamilies,
        { familyKey: 'HR', codes: ['HR2026'], department: 'Human Resources', ignoreData: true },
      ],
    };
    const sourceOrder = months.flatMap(dataset => dataset.rows.map(item => item.id));
    const annualScope = { year: '2026', label: 'All observed values' };

    const annualRows = filterParkingObservationRows(months, settings, annualScope);
    const annualDrilldown = buildParkingObservationDrilldown(months, settings, annualScope);

    expect(annualRows.map(item => item.id)).toEqual([
      'jan-transit-late',
      'jan-transit-early',
      'jan-fire',
      'feb-transit',
      'feb-operations',
    ]);
    expect(annualDrilldown.rows.map(item => item.id).sort()).toEqual(annualRows.map(item => item.id).sort());
    expect(annualDrilldown.totalValue).toBe(annualRows.reduce((sum, item) => sum + item.discountAmount, 0));

    const scopes = [
      { month: '2026-01', codeFamilyKey: 'TP', department: 'Transit', expected: 25 },
      { month: '2026-01', codeFamilyKey: 'BFES', department: 'Fire', expected: 30 },
      { month: '2026-02', codeFamilyKey: 'TP', department: 'Transit', expected: 20 },
      { month: '2026-02', codeFamilyKey: 'OPS', department: 'Operations', expected: 40 },
    ];
    for (const scope of scopes) {
      const annualAggregate = annualRows
        .filter(item => item.startMonth === scope.month)
        .filter(item => item.codeFamilyKey === scope.codeFamilyKey && item.department === scope.department)
        .reduce((sum, item) => sum + item.discountAmount, 0);
      const drilldown = buildParkingObservationDrilldown(months, settings, {
        year: '2026',
        month: scope.month,
        codeFamilyKey: scope.codeFamilyKey,
        department: scope.department,
        label: `${scope.department} ${scope.month}`,
      });

      expect(annualAggregate).toBe(scope.expected);
      expect(drilldown.totalValue).toBe(annualAggregate);
    }

    expect(months.flatMap(dataset => dataset.rows.map(item => item.id))).toEqual(sourceOrder);
  });
});
