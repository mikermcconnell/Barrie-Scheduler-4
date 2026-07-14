import { describe, expect, it } from 'vitest';
import { buildParkingDepartmentDrilldownRows } from '../components/workspaces/ParkingWorkspace';
import { DEFAULT_PARKING_SETTINGS, type ParkingRawRow, type ParkingSettings } from '../utils/parking/parkingTypes';

const rawRow = (overrides: Partial<ParkingRawRow>): ParkingRawRow => ({
  id: 'row',
  plate: 'ABC123',
  hasMissingPlate: false,
  startRaw: '2026-01-02 09:00',
  startDate: '2026-01-02',
  startMonth: '2026-01',
  startMinutes: 540,
  endMinutes: 600,
  weekday: 5,
  isWeekend: false,
  spotId: '100',
  locationName: 'Lot 100',
  durationMinutes: 60,
  tapType: 'Spot',
  discountCode: 'TA2026',
  codeFamilyKey: 'TA',
  department: 'Transit Administration',
  description: 'Shared parking',
  discountAmount: 10,
  ...overrides,
});

describe('parking department drill-down aggregation', () => {
  it('groups code families by department and keeps observations newest first', () => {
    const rows = buildParkingDepartmentDrilldownRows([
      rawRow({ id: 'older', codeFamilyKey: 'TA', discountAmount: 10, startDate: '2026-01-01' }),
      rawRow({ id: 'newer', codeFamilyKey: 'TB', discountCode: 'TB2026', discountAmount: 5, startDate: '2026-01-03' }),
    ], DEFAULT_PARKING_SETTINGS, '2026-01');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ department: 'Transit Administration', totalValue: 15 });
    // One use is one matching raw observation, even when observations group
    // into the same department rather than representing unique plates/codes.
    expect(rows[0].rows).toHaveLength(2);
    expect(rows[0].rows.map(row => row.id)).toEqual(['newer', 'older']);
  });

  it('counts each matching raw row as a use, including repeated plates and codes', () => {
    const rows = buildParkingDepartmentDrilldownRows([
      rawRow({ id: 'first', plate: 'SAME1', discountCode: 'TA2026', discountAmount: 4 }),
      rawRow({ id: 'second', plate: 'SAME1', discountCode: 'TA2026', discountAmount: 6 }),
      rawRow({ id: 'third', plate: 'SAME1', discountCode: 'TA2026', discountAmount: 8 }),
    ], DEFAULT_PARKING_SETTINGS, '2026-01');

    expect(rows).toHaveLength(1);
    expect(rows[0].totalValue).toBe(18);
    expect(rows[0].rows).toHaveLength(3);
  });

  it('respects ignore data, excludes parking-pass codes, keeps Unmapped, and scopes the month', () => {
    const settings: ParkingSettings = {
      ...DEFAULT_PARKING_SETTINGS,
      codeFamilies: [
        ...DEFAULT_PARKING_SETTINGS.codeFamilies,
        { familyKey: 'IGN', department: 'Ignored Department', codes: ['IGN2026'], ignoreData: true },
      ],
    };
    const rows = buildParkingDepartmentDrilldownRows([
      rawRow({ id: 'ignored', codeFamilyKey: 'IGN', department: 'Ignored Department' }),
      rawRow({ id: 'pass', codeFamilyKey: 'P1', department: 'Parking pass' }),
      rawRow({ id: 'unmapped', codeFamilyKey: 'OLD', department: '', discountAmount: 7 }),
      rawRow({ id: 'other-month', codeFamilyKey: 'OLD', department: '', startMonth: '2026-02', discountAmount: 20 }),
    ], settings, '2026-01');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ department: 'Unmapped', totalValue: 7 });
    expect(rows[0].rows.map(row => row.id)).toEqual(['unmapped']);
  });
});
