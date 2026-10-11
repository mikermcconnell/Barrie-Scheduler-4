import type { ParkingLocoMobiAggregateValues, ParkingLocoMobiHistorySnapshot } from './parkingLocoMobiTypes';
import type { ParkingRevenueLocationMapping } from './parkingTypes';

export interface ParkingStrategyLocationLink {
  sourceKey: string;
  vendor: 'locomobi';
  domain: string;
  meterId: string;
  locationId: string;
}

export function parkingStrategySourceKey(domain: string, meterId: string): string {
  return JSON.stringify(['locomobi', domain, meterId]);
}

export function createParkingStrategyLocationLink(domain: string, meterId: string, locationId: string): ParkingStrategyLocationLink {
  return { sourceKey: parkingStrategySourceKey(domain, meterId), vendor: 'locomobi', domain, meterId, locationId };
}

export interface ParkingStrategyFilter {
  fromMonth?: string;
  toMonth?: string;
  areaKey?: string | null;
}

export interface ParkingStrategyArea extends ParkingLocoMobiAggregateValues {
  key: string;
  label: string;
  kind: 'source_domain' | 'reviewed_location';
  locationId: string | null;
  sourceKeys: string[];
}

export interface ParkingStrategyMeter extends ParkingLocoMobiAggregateValues {
  sourceKey: string;
  domain: string;
  meterId: string;
  locationLabel: string;
  locationId: string | null;
  areaKey: string;
}

export interface ParkingStrategyModel {
  periodAvailable: boolean;
  unavailableReason?: string;
  totals: ParkingLocoMobiAggregateValues;
  monthly: Array<ParkingLocoMobiAggregateValues & { month: string }>;
  areas: ParkingStrategyArea[];
  selectedArea: ParkingStrategyArea | null;
  meters: ParkingStrategyMeter[];
  hourlyCounts: number[] | null;
  observedMonths: string[];
}

const empty = (): ParkingLocoMobiAggregateValues => ({ rowCount: 0, totalReportedAmount: 0, zeroAmountRowCount: 0, negativeAmountRowCount: 0 });
function add(target: ParkingLocoMobiAggregateValues, value: ParkingLocoMobiAggregateValues): void {
  target.rowCount += value.rowCount;
  target.totalReportedAmount = Math.round((target.totalReportedAmount + value.totalReportedAmount + Number.EPSILON) * 100) / 100;
  target.zeroAmountRowCount += value.zeroAmountRowCount;
  target.negativeAmountRowCount += value.negativeAmountRowCount;
}

export function buildParkingStrategyModel(
  snapshot: ParkingLocoMobiHistorySnapshot,
  filter: ParkingStrategyFilter = {},
  links: ParkingStrategyLocationLink[] = [],
  locations: ParkingRevenueLocationMapping[] = [],
): ParkingStrategyModel {
  const observedMonths = snapshot.coverage.observedMonths.filter(month => (!filter.fromMonth || month >= filter.fromMonth) && (!filter.toMonth || month <= filter.toMonth));
  if (observedMonths.length === 0 || (snapshot.locationMonths && !snapshot.locationMonths.some(row => observedMonths.includes(row.month) && row.rowCount > 0))) {
    return { periodAvailable: false, unavailableReason: 'No supplied payment evidence covers this period. Missing periods are not zero activity.', totals: empty(), monthly: [], areas: [], selectedArea: null, meters: [], hourlyCounts: null, observedMonths };
  }
  if (!snapshot.locationMonths && (filter.fromMonth || filter.toMonth)) {
    return { periodAvailable: false, unavailableReason: 'Re-import the complete archive to enable period and location filtering.', totals: empty(), monthly: [], areas: [], selectedArea: null, meters: [], hourlyCounts: null, observedMonths };
  }
  const physical = new Map(locations.filter(location => location.locationKind !== 'non_spatial').map(location => [location.id, location]));
  const linkIndex = new Map(links.filter(link => link.vendor === 'locomobi' && link.sourceKey === parkingStrategySourceKey(link.domain, link.meterId)).map(link => [link.sourceKey, link]));
  const meterIndex = new Map<string, ParkingStrategyMeter>();
  const areaIndex = new Map<string, ParkingStrategyArea>();
  const rows = snapshot.locationMonths ? snapshot.locationMonths.filter(row => observedMonths.includes(row.month)) : snapshot.locations;
  for (const row of rows) {
    const sourceKey = parkingStrategySourceKey(row.domain, row.meterId);
    const link = linkIndex.get(sourceKey);
    const location = link ? physical.get(link.locationId) : undefined;
    const areaKey = location ? `location:${location.id}` : `domain:${row.domain}`;
    const meter = meterIndex.get(sourceKey) ?? { ...empty(), sourceKey, domain: row.domain, meterId: row.meterId, locationLabel: row.locationLabel, locationId: location?.id ?? null, areaKey };
    add(meter, row);
    meterIndex.set(sourceKey, meter);
    const area = areaIndex.get(areaKey) ?? { ...empty(), key: areaKey, label: location?.displayName ?? (row.domain || 'Unspecified source area'), kind: location ? 'reviewed_location' as const : 'source_domain' as const, locationId: location?.id ?? null, sourceKeys: [] };
    add(area, row);
    if (!area.sourceKeys.includes(sourceKey)) area.sourceKeys.push(sourceKey);
    areaIndex.set(areaKey, area);
  }
  const areas = [...areaIndex.values()].sort((a, b) => b.rowCount - a.rowCount || a.label.localeCompare(b.label));
  const selectedArea = filter.areaKey ? areaIndex.get(filter.areaKey) ?? null : null;
  const selectedKeys = filter.areaKey ? new Set(selectedArea?.sourceKeys ?? []) : null;
  const totals = empty();
  const monthlyIndex = new Map<string, ParkingLocoMobiAggregateValues & { month: string }>();
  let hourlyCounts: number[] | null = snapshot.locationMonths ? Array(24).fill(0) : null;
  for (const row of rows) {
    if (selectedKeys && !selectedKeys.has(parkingStrategySourceKey(row.domain, row.meterId))) continue;
    add(totals, row);
    if ('month' in row && typeof row.month === 'string') {
      const month = monthlyIndex.get(row.month) ?? { ...empty(), month: row.month };
      add(month, row);
      monthlyIndex.set(row.month, month);
      if ('hourlyCounts' in row && Array.isArray(row.hourlyCounts)) row.hourlyCounts.forEach((count, hour) => { if (hour < 24 && hourlyCounts) hourlyCounts[hour] += count; });
    }
  }
  if (!snapshot.locationMonths && !filter.areaKey) {
    snapshot.monthly.forEach(month => monthlyIndex.set(month.month, { ...month }));
    hourlyCounts = snapshot.hourly.map(hour => hour.rowCount);
  }
  return { periodAvailable: true, totals, monthly: [...monthlyIndex.values()].sort((a, b) => a.month.localeCompare(b.month)), areas, selectedArea,
    meters: [...meterIndex.values()].sort((a, b) => b.rowCount - a.rowCount || a.locationLabel.localeCompare(b.locationLabel)), hourlyCounts, observedMonths };
}
