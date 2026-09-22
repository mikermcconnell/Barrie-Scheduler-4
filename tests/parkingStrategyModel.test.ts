import { describe, expect, it } from 'vitest';
import { buildParkingLocoMobiHistorySnapshot } from '../utils/parking/parkingLocoMobiAggregation';
import { buildParkingStrategyModel, createParkingStrategyLocationLink } from '../utils/parking/parkingStrategyModel';
import type { ParkingLocoMobiParseResult } from '../utils/parking/parkingLocoMobiTypes';
import type { ParkingRevenueLocationMapping } from '../utils/parking/parkingTypes';

function fixture() {
  const rows = [
    { meterId: '1', activityMonth: '2024-06', reportedAmount: 10, activityMinutes: 60 },
    { meterId: '2', activityMonth: '2024-06', reportedAmount: 0, activityMinutes: 120 },
    { meterId: '1', activityMonth: '2025-07', reportedAmount: 25, activityMinutes: 180 },
  ].map(row => ({ vendor: 'locomobi', financialBasis: 'source_reported_amount', domain: 'Marina', locationLabel: `Marina ${row.meterId}`, activityDate: `${row.activityMonth}-01`, weekday: 1, isWeekend: false, paymentChannel: 'cash', paymentChannelLabel: 'Cash', qualityFlags: row.reportedAmount === 0 ? ['zero_amount'] : [], ...row }));
  return buildParkingLocoMobiHistorySnapshot({ schemaVersion: 1, vendor: 'locomobi', financialBasis: 'source_reported_amount', rows, sourceTables: [], ignoredSheets: [], warnings: [], reconciliation: {}, coverage: { observedMonths: ['2024-06', '2025-07'], observedYears: [2024, 2025] } } as unknown as ParkingLocoMobiParseResult);
}

describe('Parking strategy cross-filter model', () => {
  it('reconciles compact monthly meters to archive totals and 24-hour counts', () => {
    const snapshot = fixture();
    expect(snapshot.locationMonths?.reduce((sum, row) => sum + row.rowCount, 0)).toBe(3);
    expect(snapshot.locationMonths?.every(row => row.hourlyCounts.length === 24 && row.hourlyCounts.reduce((a, b) => a + b, 0) === row.rowCount)).toBe(true);
    const model = buildParkingStrategyModel(snapshot, { fromMonth: '2024-01', toMonth: '2024-12' });
    expect(model.totals).toMatchObject({ rowCount: 2, totalReportedAmount: 10, zeroAmountRowCount: 1 });
    expect(model.meters).toHaveLength(2);
    expect(model.hourlyCounts?.[3]).toBe(0);
    expect(model.monthly.map(month => month.month)).toEqual(['2024-06']);
  });

  it('groups reviewed physical links while keeping unknown and non-spatial links in source domains', () => {
    const links = [createParkingStrategyLocationLink('Marina', '1', 'lot')];
    const locations: ParkingRevenueLocationMapping[] = [{ id: 'lot', displayName: 'Reviewed marina', latitude: 44, longitude: -79, sourceRefs: [] }];
    const model = buildParkingStrategyModel(fixture(), { fromMonth: '2024-01', toMonth: '2024-12', areaKey: 'location:lot' }, links, locations);
    expect(model.areas).toHaveLength(2);
    expect(model.selectedArea?.label).toBe('Reviewed marina');
    expect(model.totals.rowCount).toBe(1);
    expect(model.totals.totalReportedAmount).toBe(10);
    expect(model.meters).toHaveLength(2);
    expect(model.hourlyCounts?.reduce((a, b) => a + b, 0)).toBe(1);
    expect(buildParkingStrategyModel(fixture(), {}, links, []).areas[0].kind).toBe('source_domain');
    expect(buildParkingStrategyModel(fixture(), {}, links, [{ ...locations[0], locationKind: 'non_spatial' }]).areas[0].kind).toBe('source_domain');
  });

  it('keeps old archives usable without pretending period or selected-area hourly detail exists', () => {
    const snapshot = fixture();
    delete snapshot.locationMonths;
    expect(buildParkingStrategyModel(snapshot).totals.rowCount).toBe(3);
    expect(buildParkingStrategyModel(snapshot, { fromMonth: '2024-01' }).periodAvailable).toBe(false);
    const selected = buildParkingStrategyModel(snapshot, { areaKey: 'domain:Marina' });
    expect(selected.totals.rowCount).toBe(3);
    expect(selected.hourlyCounts).toBeNull();
    expect(selected.monthly).toEqual([]);
  });

  it('does not replace a missing selected area with whole-archive figures', () => {
    const model = buildParkingStrategyModel(fixture(), { areaKey: 'location:missing' });
    expect(model.totals.rowCount).toBe(0);
    expect(model.selectedArea).toBeNull();
    expect(model.monthly).toEqual([]);
  });

  it('marks absent periods and empty aggregate indexes unavailable, while preserving observed zero-dollar records', () => {
    const snapshot = fixture();
    const absent = buildParkingStrategyModel(snapshot, { fromMonth: '2023-01', toMonth: '2023-12' });
    expect(absent.periodAvailable).toBe(false);
    expect(absent.unavailableReason).toContain('No supplied payment evidence');
    expect(absent.monthly).toEqual([]);
    expect(buildParkingStrategyModel({ ...snapshot, locationMonths: [] }).periodAvailable).toBe(false);
    const zeroOnly = { ...snapshot, locationMonths: snapshot.locationMonths?.filter(row => row.totalReportedAmount === 0) };
    const observed = buildParkingStrategyModel(zeroOnly, { fromMonth: '2024-06', toMonth: '2024-06' });
    expect(observed.periodAvailable).toBe(true);
    expect(observed.totals).toMatchObject({ rowCount: 1, totalReportedAmount: 0, zeroAmountRowCount: 1 });
  });
});
