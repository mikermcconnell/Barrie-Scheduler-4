import {
  PARKING_REVENUE_SCHEMA_VERSION,
  type ParkingRevenueAnalytics,
  type ParkingRevenueDataset,
  type ParkingRevenueFilters,
  type ParkingRevenueLocationMapping,
  type ParkingRevenueMapStatus,
  type ParkingRevenueLocationRef,
  type ParkingRevenueLocationSummary,
  type ParkingRevenueRawRow,
  type ParkingRevenueSource,
  type ParkingRevenueSummary,
  type ParkingRevenueTrendPoint,
  type ParkingSettings,
} from './parkingTypes';
import { getParkingCategoryDisplay, UNCATEGORIZED_PARKING_CATEGORY_ID } from './parkingCategories';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function locationKeyForRef(source: ParkingRevenueSource, sourceId: string): string {
  return `${source}:${normalizeText(sourceId).toUpperCase()}`;
}

export function buildParkingRevenueLocationLookup(settings: ParkingSettings): Map<string, ParkingRevenueLocationMapping> {
  const lookup = new Map<string, ParkingRevenueLocationMapping>();
  for (const location of settings.revenueLocations || []) {
    for (const ref of location.sourceRefs || []) {
      const key = locationKeyForRef(ref.source, ref.sourceId);
      if (key) lookup.set(key, location);
    }
  }
  return lookup;
}

function buildRevenueMetadata(datasets: ParkingRevenueDataset[], importedBy: string): ParkingRevenueSummary['metadata'] {
  return {
    importedAt: new Date().toISOString(),
    importedBy,
    datasetCount: datasets.length,
    monthCount: new Set(datasets.map(dataset => dataset.month)).size,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    totalRevenue: roundMoney(datasets.reduce((sum, dataset) => sum + dataset.totalRevenue, 0)),
  };
}

export function buildParkingRevenueSummary(
  datasets: ParkingRevenueDataset[],
  importedBy: string,
  storagePath?: string,
): ParkingRevenueSummary {
  const sortedDatasets = [...datasets].sort((a, b) => a.month.localeCompare(b.month) || a.source.localeCompare(b.source));
  return {
    schemaVersion: PARKING_REVENUE_SCHEMA_VERSION,
    datasets: sortedDatasets,
    metadata: {
      ...buildRevenueMetadata(sortedDatasets, importedBy),
      ...(storagePath ? { storagePath } : {}),
    },
  };
}

export function buildParkingRevenueReplacementSummary(
  existingSummary: ParkingRevenueSummary | null,
  datasets: ParkingRevenueDataset[],
  importedBy: string,
  storagePath: string,
): ParkingRevenueSummary {
  if (datasets.length === 0) throw new Error('Select at least one Parking revenue file to save.');
  const replacementKeys = new Set<string>();
  for (const dataset of datasets) {
    const key = `${dataset.month}|${dataset.source}`;
    if (replacementKeys.has(key)) {
      throw new Error('Parking revenue batch imports must contain different source/month combinations.');
    }
    replacementKeys.add(key);
  }
  const keptDatasets = (existingSummary?.datasets || []).filter(dataset => !replacementKeys.has(`${dataset.month}|${dataset.source}`));
  return buildParkingRevenueSummary([...keptDatasets, ...datasets], importedBy, storagePath);
}

function sourceLabel(source: ParkingRevenueSource): string {
  return source === 'hotspot' ? 'HotSpot app' : 'QR code';
}

function groupKeyForRow(row: ParkingRevenueRawRow, locationLookup?: Map<string, ParkingRevenueLocationMapping>): string {
  const currentMappedLocation = locationLookup?.get(locationKeyForRef(row.source, row.sourceId));
  return currentMappedLocation?.id || row.physicalLocationId || `${row.source}:${row.sourceId}`;
}

function groupNameForRow(row: ParkingRevenueRawRow): string {
  return row.physicalLocationName || row.sourceLabel || row.sourceId;
}

function rowMatchesDateSourceDayFilters(row: ParkingRevenueRawRow, filters: ParkingRevenueFilters): boolean {
  if (filters.months && filters.months.length > 0 && !filters.months.includes(row.startMonth)) return false;
  if (filters.source && filters.source !== 'all' && row.source !== filters.source) return false;
  if (filters.dayType === 'weekday' && row.isWeekend) return false;
  if (filters.dayType === 'weekend' && !row.isWeekend) return false;
  if (filters.dayType === 'saturday' && row.weekday !== 6) return false;
  if (filters.dayType === 'sunday' && row.weekday !== 0) return false;
  return true;
}

function rowMatchesHourFilters(row: ParkingRevenueRawRow, filters: ParkingRevenueFilters): boolean {
  const startHour = typeof filters.hourStart === 'number' ? Math.max(0, Math.min(23, filters.hourStart)) : 0;
  const endHour = typeof filters.hourEnd === 'number' ? Math.max(0, Math.min(23, filters.hourEnd)) : 23;
  const from = Math.min(startHour, endHour);
  const to = Math.max(startHour, endHour);
  const rowHour = Math.floor(row.startMinutes / 60);
  if (rowHour < from || rowHour > to) return false;
  return true;
}

function hourWindow(filters: ParkingRevenueFilters): { start: number; end: number; minutes: number } {
  const startHour = typeof filters.hourStart === 'number' ? Math.max(0, Math.min(23, filters.hourStart)) : 0;
  const endHour = typeof filters.hourEnd === 'number' ? Math.max(0, Math.min(23, filters.hourEnd)) : 23;
  const from = Math.min(startHour, endHour);
  const to = Math.max(startHour, endHour);
  return { start: from * 60, end: (to + 1) * 60, minutes: (to - from + 1) * 60 };
}

function paidMinutesForRow(row: ParkingRevenueRawRow, filters: ParkingRevenueFilters): number {
  const window = hourWindow(filters);
  const rowStart = Math.max(0, row.startMinutes);
  const rowEnd = Math.max(rowStart, row.endMinutes);
  let overlap = 0;
  const firstDay = Math.floor(rowStart / 1440) - 1;
  const lastDay = Math.floor(rowEnd / 1440) + 1;
  for (let day = firstDay; day <= lastDay; day += 1) {
    const windowStart = window.start + day * 1440;
    const windowEnd = window.end + day * 1440;
    overlap += Math.max(0, Math.min(rowEnd, windowEnd) - Math.max(rowStart, windowStart));
  }
  return Math.max(0, Math.min(row.durationMinutes, overlap));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function peakEntryFromCounts<T extends string | number>(counts: Map<T, number>): T | null {
  let bestValue: T | null = null;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (
      bestValue == null
      || count > bestCount
      || (count === bestCount && String(value).localeCompare(String(bestValue)) < 0)
    ) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

function peakEntry<T extends string | number>(values: Iterable<T>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return peakEntryFromCounts(counts);
}

interface LocationAccumulator {
  key: string;
  first: ParkingRevenueRawRow;
  mappedLocation?: ParkingRevenueLocationMapping;
  sourceIds: Map<string, ParkingRevenueLocationRef>;
  rowCount: number;
  totalRevenue: number;
  totalPaid: number;
  durationTotal: number;
  durationCount: number;
  uniquePlates: Set<string>;
  hotspotRevenue: number;
  qrRevenue: number;
  hourCounts: Map<number, number>;
  dayCounts: Map<string, number>;
  paidMinutes: number;
}

interface LocationSummaryIndex {
  summaries: ParkingRevenueLocationSummary[];
  categoryMemberships: Map<string, {
    keys: Set<string>;
    names: Set<string>;
  }>;
}

function addCount<T extends string | number>(counts: Map<T, number>, value: T): void {
  counts.set(value, (counts.get(value) || 0) + 1);
}

function createLocationAccumulator(
  key: string,
  row: ParkingRevenueRawRow,
  mappedLocation?: ParkingRevenueLocationMapping,
): LocationAccumulator {
  return {
    key,
    first: row,
    mappedLocation,
    sourceIds: new Map(),
    rowCount: 0,
    totalRevenue: 0,
    totalPaid: 0,
    durationTotal: 0,
    durationCount: 0,
    uniquePlates: new Set(),
    hotspotRevenue: 0,
    qrRevenue: 0,
    hourCounts: new Map(),
    dayCounts: new Map(),
    paidMinutes: 0,
  };
}

function addRowToLocationAccumulator(
  accumulator: LocationAccumulator,
  row: ParkingRevenueRawRow,
): void {
  accumulator.rowCount += 1;
  accumulator.totalRevenue += row.amount;
  accumulator.totalPaid += row.total;
  if (row.durationMinutes > 0) {
    accumulator.durationTotal += row.durationMinutes;
    accumulator.durationCount += 1;
  }
  if (row.plate) accumulator.uniquePlates.add(row.plate);
  if (row.source === 'hotspot') accumulator.hotspotRevenue += row.amount;
  if (row.source === 'qr') accumulator.qrRevenue += row.amount;
  addCount(accumulator.hourCounts, Math.floor(row.startMinutes / 60));
  addCount(accumulator.dayCounts, row.startDate);
  accumulator.sourceIds.set(locationKeyForRef(row.source, row.sourceId), {
    source: row.source,
    sourceId: row.sourceId,
    label: row.sourceLabel,
  });
}

function addPaidMinutesToLocationAccumulator(
  accumulator: LocationAccumulator,
  row: ParkingRevenueRawRow,
  filters: ParkingRevenueFilters,
): void {
  accumulator.paidMinutes += paidMinutesForRow(row, filters);
  accumulator.sourceIds.set(locationKeyForRef(row.source, row.sourceId), {
    source: row.source,
    sourceId: row.sourceId,
    label: row.sourceLabel,
  });
}

function buildLocationSummaryIndex(
  rows: ParkingRevenueRawRow[],
  settings: ParkingSettings,
  filtersForPaidMinutes?: ParkingRevenueFilters,
  paidMinuteRows: ParkingRevenueRawRow[] = rows,
): LocationSummaryIndex {
  const locationById = new Map((settings.revenueLocations || []).map(location => [location.id, location]));
  const locationLookup = buildParkingRevenueLocationLookup(settings);
  const groups = new Map<string, LocationAccumulator>();
  const getAccumulator = (row: ParkingRevenueRawRow): LocationAccumulator => {
    const key = groupKeyForRow(row, locationLookup);
    let accumulator = groups.get(key);
    if (!accumulator) {
      accumulator = createLocationAccumulator(
        key,
        row,
        locationById.get(key) || (row.physicalLocationId ? locationById.get(row.physicalLocationId) : undefined),
      );
      groups.set(key, accumulator);
    }
    return accumulator;
  };
  for (const row of rows) {
    addRowToLocationAccumulator(getAccumulator(row), row);
  }
  for (const row of paidMinuteRows) {
    addPaidMinutesToLocationAccumulator(getAccumulator(row), row, filtersForPaidMinutes || {});
  }

  const categoryMemberships = new Map<string, { keys: Set<string>; names: Set<string> }>();
  const summaries = [...groups.values()].map(accumulator => {
    const { key, first, mappedLocation } = accumulator;
    const locationKind = mappedLocation?.locationKind || 'physical';
    const hasReviewedCoordinates = locationKind === 'physical'
      && typeof mappedLocation?.latitude === 'number'
      && typeof mappedLocation?.longitude === 'number';
    const mapStatus: ParkingRevenueMapStatus = locationKind === 'non_spatial'
      ? 'not_applicable'
      : hasReviewedCoordinates ? 'mapped' : 'unmapped';
    const category = getParkingCategoryDisplay(settings, mappedLocation?.categoryId);
    const categoryKey = category.id || UNCATEGORIZED_PARKING_CATEGORY_ID;
    const membership = categoryMemberships.get(categoryKey) || {
      keys: new Set<string>(),
      names: new Set<string>(),
    };
    const displayName = mappedLocation?.displayName || groupNameForRow(first);
    membership.keys.add(key);
    membership.names.add(normalizeText(displayName).toLowerCase());
    categoryMemberships.set(categoryKey, membership);

    return {
      key,
      displayName,
      locationKind,
      mapStatus,
      sourceIds: mappedLocation?.sourceRefs?.length ? mappedLocation.sourceRefs : [...accumulator.sourceIds.values()],
      latitude: mappedLocation?.latitude ?? null,
      longitude: mappedLocation?.longitude ?? null,
      categoryId: category.id,
      categoryLabel: category.label,
      categoryColorHex: category.colorHex,
      isMapped: hasReviewedCoordinates,
      rowCount: accumulator.rowCount,
      totalRevenue: roundMoney(accumulator.totalRevenue),
      totalPaid: roundMoney(accumulator.totalPaid),
      paidMinutes: accumulator.paidMinutes,
      averageStayMinutes: accumulator.durationCount > 0 ? Math.round(accumulator.durationTotal / accumulator.durationCount) : 0,
      uniquePlateCount: accumulator.uniquePlates.size,
      hotspotRevenue: roundMoney(accumulator.hotspotRevenue),
      qrRevenue: roundMoney(accumulator.qrRevenue),
      peakHour: peakEntryFromCounts(accumulator.hourCounts),
      peakDay: peakEntryFromCounts(accumulator.dayCounts) || '',
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue || b.rowCount - a.rowCount || a.displayName.localeCompare(b.displayName));

  return { summaries, categoryMemberships };
}

function categoryMembershipForSummaries(
  index: LocationSummaryIndex,
  categoryId: ParkingRevenueFilters['categoryId'],
): { keys: Set<string>; names: Set<string> } | null {
  if (!categoryId || categoryId === 'all') return null;
  if (categoryId === UNCATEGORIZED_PARKING_CATEGORY_ID) {
    return index.categoryMemberships.get(UNCATEGORIZED_PARKING_CATEGORY_ID) || { keys: new Set(), names: new Set() };
  }
  return index.categoryMemberships.get(categoryId) || { keys: new Set(), names: new Set() };
}

function rowLocationKey(row: ParkingRevenueRawRow, locationLookup: Map<string, ParkingRevenueLocationMapping>): string {
  return groupKeyForRow(row, locationLookup);
}

function rowMatchesCategoryMembership(
  row: ParkingRevenueRawRow,
  membership: { keys: Set<string>; names: Set<string> },
  locationLookup: Map<string, ParkingRevenueLocationMapping>,
): boolean {
  if (membership.keys.has(rowLocationKey(row, locationLookup))) return true;
  if (String(row.physicalLocationId || '').trim() || String(row.sourceId || '').trim()) return false;
  const rowNames = [row.physicalLocationName, row.sourceLabel].map(value => normalizeText(value).toLowerCase()).filter(Boolean);
  return rowNames.some(name => membership.names.has(name));
}

interface TrendAccumulator {
  key: string;
  label: string;
  rowCount: number;
  totalRevenue: number;
  durationTotal: number;
  durationCount: number;
}

function buildTrend(rows: ParkingRevenueRawRow[], keyForRow: (row: ParkingRevenueRawRow) => string, labelForKey = (key: string) => key): ParkingRevenueTrendPoint[] {
  const groups = new Map<string, TrendAccumulator>();
  for (const row of rows) {
    const key = keyForRow(row);
    const group = groups.get(key) || {
      key,
      label: labelForKey(key),
      rowCount: 0,
      totalRevenue: 0,
      durationTotal: 0,
      durationCount: 0,
    };
    group.rowCount += 1;
    group.totalRevenue += row.amount;
    if (row.durationMinutes > 0) {
      group.durationTotal += row.durationMinutes;
      group.durationCount += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    key: group.key,
    label: group.label,
    rowCount: group.rowCount,
    totalRevenue: roundMoney(group.totalRevenue),
    averageStayMinutes: group.durationCount > 0 ? Math.round(group.durationTotal / group.durationCount) : 0,
  })).sort((a, b) => a.key.localeCompare(b.key));
}

export function buildParkingRevenueAnalytics(
  summary: ParkingRevenueSummary | null | undefined,
  settings: ParkingSettings,
  filters: ParkingRevenueFilters = {},
): ParkingRevenueAnalytics {
  const locationLookup = buildParkingRevenueLocationLookup(settings);
  const requestedMonths = filters.months?.length ? new Set(filters.months) : null;
  const periodRows: ParkingRevenueRawRow[] = [];
  const baseRows: ParkingRevenueRawRow[] = [];
  for (const dataset of summary?.datasets || []) {
    if (requestedMonths && !requestedMonths.has(dataset.month)) continue;
    if (filters.source && filters.source !== 'all' && dataset.source !== filters.source) continue;
    if (filters.importedBy && filters.importedBy !== 'all' && (dataset.importedBy || 'unknown') !== filters.importedBy) continue;
    for (const row of dataset.rows) {
      if (!rowMatchesDateSourceDayFilters(row, filters)) continue;
      periodRows.push(row);
      if (rowMatchesHourFilters(row, filters)) baseRows.push(row);
    }
  }

  const periodIndex = buildLocationSummaryIndex(periodRows, settings);
  const activeDayCategoryMembership = categoryMembershipForSummaries(periodIndex, filters.categoryId);
  const activeDayDates = new Set<string>();
  for (const row of periodRows) {
    if (activeDayCategoryMembership && !rowMatchesCategoryMembership(row, activeDayCategoryMembership, locationLookup)) continue;
    activeDayDates.add(row.startDate);
  }

  const rowCategoryMembership = categoryMembershipForSummaries(periodIndex, filters.categoryId);
  const rows = rowCategoryMembership
    ? baseRows.filter(row => rowMatchesCategoryMembership(row, rowCategoryMembership, locationLookup))
    : baseRows;
  const paidMinuteRows = (rowCategoryMembership
    ? periodRows.filter(row => rowMatchesCategoryMembership(row, rowCategoryMembership, locationLookup))
    : periodRows
  ).filter(row => paidMinutesForRow(row, filters) > 0);
  const finalIndex = buildLocationSummaryIndex(rows, settings, filters, paidMinuteRows);
  const locationSummaries = finalIndex.summaries;
  const durations = rows.map(row => row.durationMinutes).filter(value => value > 0);
  const window = hourWindow(filters);
  return {
    rows,
    locationSummaries,
    mappedLocationSummaries: locationSummaries.filter(location => location.isMapped),
    unmappedLocationSummaries: locationSummaries.filter(location => location.mapStatus === 'unmapped'),
    nonSpatialLocationSummaries: locationSummaries.filter(location => location.mapStatus === 'not_applicable'),
    totalRevenue: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
    totalPaid: roundMoney(rows.reduce((sum, row) => sum + row.total, 0)),
    rowCount: rows.length,
    paidMinutes: paidMinuteRows.reduce((sum, row) => sum + paidMinutesForRow(row, filters), 0),
    activeDayCount: activeDayDates.size,
    hourWindowMinutes: window.minutes,
    averageStayMinutes: average(durations),
    uniquePlateCount: new Set(rows.map(row => row.plate).filter(Boolean)).size,
    peakHour: peakEntry(rows.map(row => Math.floor(row.startMinutes / 60))),
    peakDay: peakEntry(rows.map(row => row.startDate)) || '',
    revenueByDay: buildTrend(rows, row => row.startDate),
    revenueByHour: buildTrend(rows, row => String(Math.floor(row.startMinutes / 60)).padStart(2, '0'), key => `${key}:00`),
    revenueByMonth: buildTrend(rows, row => row.startMonth),
  };
}

export function getParkingRevenueAvailableMonths(summary: ParkingRevenueSummary | null | undefined): string[] {
  return [...new Set((summary?.datasets || []).map(dataset => dataset.month))].sort();
}

export function getParkingRevenueSourceLabel(source: ParkingRevenueSource): string {
  return sourceLabel(source);
}
