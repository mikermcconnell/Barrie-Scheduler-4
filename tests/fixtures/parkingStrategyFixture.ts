import { buildParkingLocoMobiHistorySnapshot } from '../../utils/parking/parkingLocoMobiAggregation';
import type { ParkingLocoMobiParseResult, ParkingLocoMobiHistoryRow } from '../../utils/parking/parkingLocoMobiTypes';
import type { ParkingStrategyHistoryData } from '../../utils/parking/parkingStrategyHistoryService';
import type { ParkingStrategyLocations } from '../../utils/parking/parkingStrategyLocationService';
import { createParkingStrategyLocationLink } from '../../utils/parking/parkingStrategyModel';
import { DEFAULT_PARKING_SETTINGS, type ParkingSettings } from '../../utils/parking/parkingTypes';

function row(domain: string, meter: string, month: string, amount: number, hour: number): ParkingLocoMobiHistoryRow {
  return { vendor: 'locomobi', financialBasis: 'source_reported_amount', domain, meterId: meter, locationLabel: meter,
    activityDate: `${month}-15`, activityMonth: month, activityMinutes: hour * 60, weekday: 2, isWeekend: false,
    reportedAmount: amount, paymentChannel: 'visa', paymentChannelLabel: 'Visa', qualityFlags: amount === 0 ? ['zero_amount'] : [] };
}
export function parkingStrategyFixture() {
  const rows = [row('marina', 'MARINA 1', '2024-07', 20, 12), row('marina', 'MARINA 2', '2024-07', 10, 13), row('spiritcatcher', 'SPIRIT CATCHER', '2024-07', 5, 10), row('marina', 'MARINA 1', '2025-08', 40, 14), row('heritage', 'HERITAGE EAST', '2025-08', 0, 15)];
  const parsed: ParkingLocoMobiParseResult = {
    schemaVersion: 1, vendor: 'locomobi', financialBasis: 'source_reported_amount', rows,
    sourceTables: [{ fileName: 'browser-fixture.xlsx', sheetName: 'All', profile: 'consolidated_all', headerRowNumber: 1, sourceColumnCount: 23, sourceRowCount: 5, acceptedRowCount: 5, duplicateRowCount: 0, skippedRowCount: 0 }],
    ignoredSheets: [], warnings: [], coverage: { observedStartDate: '2024-07-15', observedEndDate: '2025-08-15', observedMonths: ['2024-07', '2025-08'], observedYears: [2024, 2025], activeDateCount: 2 },
    reconciliation: { sourceRowCount: 5, acceptedRowCount: 5, duplicateRowCount: 0, skippedRowCount: 0, zeroAmountRowCount: 1, negativeAmountRowCount: 0, missingPaymentChannelRowCount: 0, uniqueMeterCount: 4, uniqueMeterLocationCount: 4, totalReportedAmount: 75 },
  };
  const history: ParkingStrategyHistoryData = {
    snapshot: buildParkingLocoMobiHistorySnapshot(parsed),
    manifest: { schemaVersion: 1, historySchemaVersion: 1, revision: 1, vendor: 'locomobi', financialBasis: 'source_reported_amount', importFingerprint: 'fixture-1', importedAt: '2026-09-21T12:00:00Z', importedBy: 'browser-planner', aggregateStoragePath: 'teams/browser-team/parking/history/revision-1-fixture/aggregate.json', partitions: [], coverage: parsed.coverage, reconciliation: parsed.reconciliation },
  };
  const settings: ParkingSettings = { ...DEFAULT_PARKING_SETTINGS, revenueLocations: [
    { id: 'marina-lot', displayName: 'Marina Parking Lot', latitude: 44.385, longitude: -79.688, sourceRefs: [] },
    { id: 'spirit-lot', displayName: 'Spirit Catcher Parking Lot', latitude: 44.3869, longitude: -79.689648, sourceRefs: [] },
    { id: 'heritage-lot', displayName: 'Heritage Park Lot', latitude: 44.388, longitude: -79.685, sourceRefs: [] },
    { id: 'special-events', displayName: 'Special Events', locationKind: 'non_spatial', latitude: null, longitude: null, sourceRefs: [] },
  ] };
  const locations: ParkingStrategyLocations = { revision: 1, updatedAt: '', updatedBy: 'browser-planner', links: [
    createParkingStrategyLocationLink('marina', 'MARINA 1', 'marina-lot'), createParkingStrategyLocationLink('marina', 'MARINA 2', 'marina-lot'), createParkingStrategyLocationLink('spiritcatcher', 'SPIRIT CATCHER', 'spirit-lot'),
  ] };
  return { parsed, history, settings, locations };
}
