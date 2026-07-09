import {
  type ParkingRevenueAnalytics,
  type ParkingRevenueLocationSummary,
  type ParkingRevenueRawRow,
  type ParkingRevenueSource,
  type ParkingRevenueTrendPoint,
} from './parkingTypes';

export interface ParkingCapacityInfo {
  spaces: number | null;
  sourceLabel?: string;
}

export interface ParkingAnalysisChartPoint {
  key: string;
  label: string;
  revenue: number;
  sessions: number;
  averageStayMinutes: number;
}

export interface ParkingSourceMixPoint {
  key: ParkingRevenueSource;
  label: string;
  revenue: number;
  sessions: number;
}

export interface ParkingLotComparisonPoint {
  key: string;
  label: string;
  categoryId?: string | null;
  categoryLabel?: string;
  categoryColorHex?: string;
  revenue: number;
  sessions: number;
  paidMinutes: number;
  averageStayMinutes: number;
  uniquePlates: number;
  spaces: number | null;
  revenuePerSpace: number | null;
  sessionsPerSpace: number | null;
  utilizationPercent: number | null;
  lotCount?: number;
  capacityCoveredLotCount?: number;
  capacityCoveredRevenue?: number;
  capacityCoveredSessions?: number;
  capacityCoveredPaidMinutes?: number;
}

export interface ParkingMonthlyUtilizationInput {
  month: string;
  analytics: ParkingRevenueAnalytics;
  capacityByLocationKey: Record<string, ParkingCapacityInfo>;
}

export interface ParkingUtilizationTrendPoint {
  key: string;
  label: string;
  utilizationPercent: number | null;
  paidMinutes: number;
  availableSpaceMinutes: number;
  spaces: number | null;
  activeDayCount: number;
  hourWindowMinutes: number;
  totalLotCount: number;
  capacityCoveredLotCount: number;
}

export type ParkingTrendFormat = 'money' | 'number' | 'duration';
export type ParkingTrendDirection = 'up' | 'down' | 'flat' | 'none';

export interface ParkingTrendComparison {
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  changeValue: number | null;
  changePercent: number | null;
  currentLabel: string;
  comparisonLabel: string;
  format: ParkingTrendFormat;
  direction: ParkingTrendDirection;
}

export interface ParkingTrendHighlight {
  label: string;
  value: number;
  changeValue: number;
  changePercent: number | null;
}

export interface ParkingTrendOverview {
  targetMonth: string;
  scopeLabel: string;
  comparisonCards: ParkingTrendComparison[];
  monthlyRevenueTrend: ParkingAnalysisChartPoint[];
  weekdayTrend: ParkingAnalysisChartPoint[];
  saturdayTrend: ParkingAnalysisChartPoint[];
  sundayTrend: ParkingAnalysisChartPoint[];
  fastestGrowingLot: ParkingTrendHighlight | null;
}

export interface ParkingSelectedLotAnalysis {
  key: string;
  displayName: string;
  revenueRank: number;
  sessionRank: number;
  revenueSharePercent: number;
  sessionSharePercent: number;
  systemAverageStayMinutes: number;
  spaces: number | null;
  revenuePerSpace: number | null;
  sessionsPerSpace: number | null;
  paidMinutes: number;
  utilizationPercent: number | null;
  hourlyProfile: ParkingAnalysisChartPoint[];
  dailyTrend: ParkingAnalysisChartPoint[];
  monthlyTrend: ParkingAnalysisChartPoint[];
  sourceMix: ParkingSourceMixPoint[];
}

export interface ParkingPlannerAnalysis {
  monthlyTrend: ParkingAnalysisChartPoint[];
  hourlyProfile: ParkingAnalysisChartPoint[];
  dailyTrend: ParkingAnalysisChartPoint[];
  sourceMix: ParkingSourceMixPoint[];
  topLotsByRevenue: ParkingLotComparisonPoint[];
  capacityRows: ParkingLotComparisonPoint[];
  categoryComparisonRows: ParkingLotComparisonPoint[];
  insights: string[];
  selectedLot: ParkingSelectedLotAnalysis | null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sourceKey(source: ParkingRevenueSource, sourceId: string): string {
  return `${source}:${String(sourceId ?? '').trim().toUpperCase()}`;
}

function monthLabel(month: string): string {
  const [year, rawMonth] = month.split('-');
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(rawMonth) - 1];
  return monthName && year ? `${monthName} ${year}` : month;
}

function previousMonth(month: string): string {
  const [year, rawMonth] = month.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(rawMonth)) return '';
  const previous = new Date(Date.UTC(year, rawMonth - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sameMonthLastYear(month: string): string {
  const [year, rawMonth] = month.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(rawMonth)) return '';
  return `${year - 1}-${String(rawMonth).padStart(2, '0')}`;
}

function latestMonth(rows: ParkingRevenueRawRow[]): string {
  return [...new Set(rows.map(row => row.startMonth).filter(Boolean))].sort().at(-1) || '';
}

function rowsForMonth(rows: ParkingRevenueRawRow[], month: string): ParkingRevenueRawRow[] {
  return rows.filter(row => row.startMonth === month);
}

function revenueForRows(rows: ParkingRevenueRawRow[]): number {
  return roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
}

function trendDirection(changeValue: number | null): ParkingTrendDirection {
  if (changeValue == null) return 'none';
  if (changeValue > 0) return 'up';
  if (changeValue < 0) return 'down';
  return 'flat';
}

function comparisonCard(
  key: string,
  label: string,
  rows: ParkingRevenueRawRow[],
  targetMonth: string,
  comparisonMonth: string,
  format: ParkingTrendFormat,
  valueForRows: (monthRows: ParkingRevenueRawRow[]) => number,
): ParkingTrendComparison {
  const currentRows = rowsForMonth(rows, targetMonth);
  const previousRows = rowsForMonth(rows, comparisonMonth);
  const value = valueForRows(currentRows);
  const previousValue = previousRows.length > 0 ? valueForRows(previousRows) : null;
  const changeValue = previousValue == null ? null : roundMoney(value - previousValue);
  const changePercent = previousValue && previousValue > 0 ? roundOne(((value - previousValue) / previousValue) * 100) : null;

  return {
    key,
    label,
    value,
    previousValue,
    changeValue,
    changePercent,
    currentLabel: monthLabel(targetMonth) || 'Current period',
    comparisonLabel: monthLabel(comparisonMonth) || 'Prior period',
    format,
    direction: trendDirection(changeValue),
  };
}

function buildActiveDayMonthlyTrend(
  rows: ParkingRevenueRawRow[],
  includeRow: (row: ParkingRevenueRawRow) => boolean,
): ParkingAnalysisChartPoint[] {
  const groups = new Map<string, {
    key: string;
    revenue: number;
    sessions: number;
    durationTotal: number;
    durationCount: number;
    activeDates: Set<string>;
  }>();
  for (const row of rows) {
    if (!includeRow(row)) continue;
    const group = groups.get(row.startMonth) || {
      key: row.startMonth,
      revenue: 0,
      sessions: 0,
      durationTotal: 0,
      durationCount: 0,
      activeDates: new Set<string>(),
    };
    group.revenue += row.amount;
    group.sessions += 1;
    if (row.durationMinutes > 0) {
      group.durationTotal += row.durationMinutes;
      group.durationCount += 1;
    }
    group.activeDates.add(row.startDate);
    groups.set(row.startMonth, group);
  }

  return [...groups.values()].map(group => {
    const activeDays = Math.max(1, group.activeDates.size);
    return {
      key: group.key,
      label: monthLabel(group.key),
      revenue: roundMoney(group.revenue / activeDays),
      sessions: roundOne(group.sessions / activeDays),
      averageStayMinutes: group.durationCount > 0 ? Math.round(group.durationTotal / group.durationCount) : 0,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function lotTrendKey(row: ParkingRevenueRawRow): string {
  return row.physicalLocationId || sourceKey(row.source, row.sourceId);
}

function lotTrendLabel(row: ParkingRevenueRawRow): string {
  return row.physicalLocationName || row.sourceLabel || row.sourceId || 'Unnamed lot';
}

function buildFastestGrowingLot(rows: ParkingRevenueRawRow[], targetMonth: string): ParkingTrendHighlight | null {
  const comparisonMonth = previousMonth(targetMonth);
  if (!targetMonth || !comparisonMonth) return null;

  const currentRows = rowsForMonth(rows, targetMonth);
  const previousRows = rowsForMonth(rows, comparisonMonth);
  if (currentRows.length === 0 || previousRows.length === 0) return null;

  const groups = new Map<string, { label: string; current: number; previous: number }>();
  for (const row of previousRows) {
    const key = lotTrendKey(row);
    const group = groups.get(key) || { label: lotTrendLabel(row), current: 0, previous: 0 };
    group.previous += row.amount;
    groups.set(key, group);
  }
  for (const row of currentRows) {
    const key = lotTrendKey(row);
    const group = groups.get(key) || { label: lotTrendLabel(row), current: 0, previous: 0 };
    group.current += row.amount;
    groups.set(key, group);
  }

  const best = [...groups.values()]
    .map(group => {
      const changeValue = roundMoney(group.current - group.previous);
      return {
        label: group.label,
        value: roundMoney(group.current),
        changeValue,
        changePercent: group.previous > 0 ? roundOne((changeValue / group.previous) * 100) : null,
      };
    })
    .filter(group => group.changeValue > 0)
    .sort((a, b) => b.changeValue - a.changeValue || a.label.localeCompare(b.label))[0];

  return best || null;
}

function toChartPoint(point: ParkingRevenueTrendPoint): ParkingAnalysisChartPoint {
  return {
    key: point.key,
    label: point.label,
    revenue: point.totalRevenue,
    sessions: point.rowCount,
    averageStayMinutes: point.averageStayMinutes,
  };
}

function buildTrend(
  rows: ParkingRevenueRawRow[],
  keyForRow: (row: ParkingRevenueRawRow) => string,
  labelForKey = (key: string) => key,
): ParkingAnalysisChartPoint[] {
  const groups = new Map<string, {
    key: string;
    label: string;
    revenue: number;
    sessions: number;
    durationTotal: number;
    durationCount: number;
  }>();
  for (const row of rows) {
    const key = keyForRow(row);
    const group = groups.get(key) || {
      key,
      label: labelForKey(key),
      revenue: 0,
      sessions: 0,
      durationTotal: 0,
      durationCount: 0,
    };
    group.revenue += row.amount;
    group.sessions += 1;
    if (row.durationMinutes > 0) {
      group.durationTotal += row.durationMinutes;
      group.durationCount += 1;
    }
    groups.set(key, group);
  }

  return [...groups.values()].map(group => ({
    key: group.key,
    label: group.label,
    revenue: roundMoney(group.revenue),
    sessions: group.sessions,
    averageStayMinutes: group.durationCount > 0 ? Math.round(group.durationTotal / group.durationCount) : 0,
  })).sort((a, b) => a.key.localeCompare(b.key));
}

function buildHourlyProfile(rows: ParkingRevenueRawRow[]): ParkingAnalysisChartPoint[] {
  const byHour = new Map<string, {
    revenue: number;
    sessions: number;
    durationTotal: number;
    durationCount: number;
  }>();

  for (const row of rows) {
    const rowStart = Math.max(0, row.startMinutes);
    const duration = Math.max(1, row.durationMinutes || row.endMinutes - row.startMinutes || 1);
    const rowEnd = rowStart + duration;

    for (let segmentStart = rowStart; segmentStart < rowEnd;) {
      const hour = Math.floor((segmentStart % 1440) / 60);
      const nextHourBoundary = Math.floor(segmentStart / 60) * 60 + 60;
      const segmentEnd = Math.min(rowEnd, nextHourBoundary);
      const overlap = Math.max(0, segmentEnd - segmentStart);
      if (overlap <= 0) continue;

      const key = String(hour).padStart(2, '0');
      const bucket = byHour.get(key) || {
        revenue: 0,
        sessions: 0,
        durationTotal: 0,
        durationCount: 0,
      };
      bucket.revenue += row.amount * (overlap / duration);
      bucket.sessions += 1;
      if (row.durationMinutes > 0) {
        bucket.durationTotal += row.durationMinutes;
        bucket.durationCount += 1;
      }
      byHour.set(key, bucket);
      segmentStart = segmentEnd;
    }
  }

  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    const bucket = byHour.get(key);
    return bucket ? {
      key,
      label: `${key}:00`,
      revenue: roundMoney(bucket.revenue),
      sessions: bucket.sessions,
      averageStayMinutes: bucket.durationCount > 0 ? Math.round(bucket.durationTotal / bucket.durationCount) : 0,
    } : {
      key,
      label: `${key}:00`,
      revenue: 0,
      sessions: 0,
      averageStayMinutes: 0,
    };
  });
}

function buildSourceMix(rows: ParkingRevenueRawRow[]): ParkingSourceMixPoint[] {
  const totals = new Map<ParkingRevenueSource, { revenue: number; sessions: number }>([
    ['hotspot', { revenue: 0, sessions: 0 }],
    ['qr', { revenue: 0, sessions: 0 }],
  ]);
  for (const row of rows) {
    const total = totals.get(row.source);
    if (!total) continue;
    total.revenue += row.amount;
    total.sessions += 1;
  }
  return (['hotspot', 'qr'] as ParkingRevenueSource[]).map(source => {
    const total = totals.get(source) || { revenue: 0, sessions: 0 };
    return {
      key: source,
      label: source === 'hotspot' ? 'HotSpot app' : 'QR code',
      revenue: roundMoney(total.revenue),
      sessions: total.sessions,
    };
  });
}

function rowBelongsToLocation(row: ParkingRevenueRawRow, location: ParkingRevenueLocationSummary): boolean {
  if (row.physicalLocationId) return row.physicalLocationId === location.key;
  const refs = new Set(location.sourceIds.map(ref => sourceKey(ref.source, ref.sourceId)));
  if (String(row.sourceId || '').trim()) {
    const rowSourceKey = sourceKey(row.source, row.sourceId);
    return location.key === rowSourceKey || refs.has(rowSourceKey);
  }
  const rowNames = [row.physicalLocationName, row.sourceLabel].map(normalizeText).filter(Boolean);
  return rowNames.includes(normalizeText(location.displayName));
}

export function buildParkingTrendOverview(
  analytics: ParkingRevenueAnalytics,
  selectedLocation: ParkingRevenueLocationSummary | null | undefined,
  requestedTargetMonth?: string,
  comparisonAnalytics?: ParkingRevenueAnalytics,
): ParkingTrendOverview {
  const scopedRows = selectedLocation ? analytics.rows.filter(row => rowBelongsToLocation(row, selectedLocation)) : analytics.rows;
  const comparisonRows = comparisonAnalytics?.rows || analytics.rows;
  const scopedComparisonRows = selectedLocation ? comparisonRows.filter(row => rowBelongsToLocation(row, selectedLocation)) : comparisonRows;
  const targetMonth = requestedTargetMonth || latestMonth(scopedRows) || latestMonth(scopedComparisonRows) || latestMonth(analytics.rows);
  const previous = previousMonth(targetMonth);
  const lastYear = sameMonthLastYear(targetMonth);

  return {
    targetMonth,
    scopeLabel: selectedLocation?.displayName || 'All parking lots',
    comparisonCards: [
      comparisonCard('revenue-mom', 'Total revenue MoM', scopedComparisonRows, targetMonth, previous, 'money', revenueForRows),
      comparisonCard('sessions-mom', 'Sessions MoM', scopedComparisonRows, targetMonth, previous, 'number', rows => rows.length),
      comparisonCard('stay-mom', 'Avg stay MoM', scopedComparisonRows, targetMonth, previous, 'duration', rows => average(rows.map(row => row.durationMinutes).filter(value => value > 0))),
      comparisonCard('revenue-yoy', 'Revenue YoY', scopedComparisonRows, targetMonth, lastYear, 'money', revenueForRows),
    ],
    monthlyRevenueTrend: buildTrend(scopedRows, row => row.startMonth, monthLabel),
    weekdayTrend: buildActiveDayMonthlyTrend(scopedRows, row => row.weekday >= 1 && row.weekday <= 5),
    saturdayTrend: buildActiveDayMonthlyTrend(scopedRows, row => row.weekday === 6),
    sundayTrend: buildActiveDayMonthlyTrend(scopedRows, row => row.weekday === 0),
    fastestGrowingLot: buildFastestGrowingLot(comparisonRows, targetMonth),
  };
}

function capacityForLocation(
  location: ParkingRevenueLocationSummary,
  capacityByLocationKey: Record<string, ParkingCapacityInfo>,
): ParkingCapacityInfo {
  return capacityByLocationKey[location.key] || { spaces: null };
}

function withCapacity(
  location: ParkingRevenueLocationSummary,
  capacityByLocationKey: Record<string, ParkingCapacityInfo>,
  activeDayCount = 0,
  hourWindowMinutes = 1440,
): ParkingLotComparisonPoint {
  const capacity = capacityForLocation(location, capacityByLocationKey);
  const spaces = capacity.spaces && capacity.spaces > 0 ? capacity.spaces : null;
  const paidMinutes = location.paidMinutes || 0;
  const availableSpaceMinutes = spaces && activeDayCount > 0 ? spaces * activeDayCount * hourWindowMinutes : 0;
  return {
    key: location.key,
    label: location.displayName,
    categoryId: location.categoryId ?? null,
    categoryLabel: location.categoryLabel || 'Uncategorized',
    categoryColorHex: location.categoryColorHex,
    revenue: location.totalRevenue,
    sessions: location.rowCount,
    paidMinutes,
    averageStayMinutes: location.averageStayMinutes,
    uniquePlates: location.uniquePlateCount,
    spaces,
    revenuePerSpace: spaces ? roundMoney(location.totalRevenue / spaces) : null,
    sessionsPerSpace: spaces ? roundMoney(location.rowCount / spaces) : null,
    utilizationPercent: availableSpaceMinutes > 0 ? roundOne((paidMinutes / availableSpaceMinutes) * 100) : null,
  };
}

function percentShare(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function sortByRevenuePerSpace(a: ParkingLotComparisonPoint, b: ParkingLotComparisonPoint): number {
  return (b.revenuePerSpace ?? -1) - (a.revenuePerSpace ?? -1)
    || (b.utilizationPercent ?? -1) - (a.utilizationPercent ?? -1)
    || b.revenue - a.revenue
    || b.sessions - a.sessions;
}

function sortByUtilization(a: ParkingLotComparisonPoint, b: ParkingLotComparisonPoint): number {
  return (b.utilizationPercent ?? -1) - (a.utilizationPercent ?? -1)
    || (b.revenuePerSpace ?? -1) - (a.revenuePerSpace ?? -1)
    || b.revenue - a.revenue
    || b.sessions - a.sessions;
}

function buildSelectedLotAnalysis(
  analytics: ParkingRevenueAnalytics,
  selectedLocation: ParkingRevenueLocationSummary,
  capacityByLocationKey: Record<string, ParkingCapacityInfo>,
): ParkingSelectedLotAnalysis {
  const selectedRows = analytics.rows.filter(row => rowBelongsToLocation(row, selectedLocation));
  const revenueRank = analytics.locationSummaries
    .slice()
    .sort((a, b) => b.totalRevenue - a.totalRevenue || a.displayName.localeCompare(b.displayName))
    .findIndex(location => location.key === selectedLocation.key) + 1;
  const sessionRank = analytics.locationSummaries
    .slice()
    .sort((a, b) => b.rowCount - a.rowCount || a.displayName.localeCompare(b.displayName))
    .findIndex(location => location.key === selectedLocation.key) + 1;
  const comparison = withCapacity(selectedLocation, capacityByLocationKey, analytics.activeDayCount || 0, analytics.hourWindowMinutes || 1440);

  return {
    key: selectedLocation.key,
    displayName: selectedLocation.displayName,
    revenueRank: revenueRank || analytics.locationSummaries.length,
    sessionRank: sessionRank || analytics.locationSummaries.length,
    revenueSharePercent: percentShare(selectedLocation.totalRevenue, analytics.totalRevenue),
    sessionSharePercent: percentShare(selectedLocation.rowCount, analytics.rowCount),
    systemAverageStayMinutes: analytics.averageStayMinutes,
    spaces: comparison.spaces,
    revenuePerSpace: comparison.revenuePerSpace,
    sessionsPerSpace: comparison.sessionsPerSpace,
    paidMinutes: comparison.paidMinutes,
    utilizationPercent: comparison.utilizationPercent,
    hourlyProfile: buildHourlyProfile(selectedRows),
    dailyTrend: buildTrend(selectedRows, row => row.startDate),
    monthlyTrend: buildTrend(selectedRows, row => row.startMonth),
    sourceMix: buildSourceMix(selectedRows),
  };
}

function buildInsights(
  analytics: ParkingRevenueAnalytics,
  topLotsByRevenue: ParkingLotComparisonPoint[],
  capacityRows: ParkingLotComparisonPoint[],
  selectedLot: ParkingSelectedLotAnalysis | null,
): string[] {
  if (analytics.rowCount === 0) {
    return ['Upload parking revenue files to start building planner insights.'];
  }

  const insights: string[] = [];
  const busiestLot = analytics.locationSummaries.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
  const highestRevenueLot = topLotsByRevenue[0];
  const longestStayLot = analytics.locationSummaries.slice().sort((a, b) => b.averageStayMinutes - a.averageStayMinutes)[0];
  const strongestRevenuePerSpaceLot = capacityRows
    .filter(lot => lot.revenuePerSpace != null)
    .slice()
    .sort(sortByRevenuePerSpace)[0];
  const strongestUtilizationLot = capacityRows
    .filter(lot => lot.utilizationPercent != null)
    .slice()
    .sort(sortByUtilization)[0];

  if (highestRevenueLot) insights.push(`${highestRevenueLot.label} leads revenue at ${highestRevenueLot.revenue.toLocaleString(undefined, { style: 'currency', currency: 'CAD' })}.`);
  if (busiestLot) insights.push(`${busiestLot.displayName} has the most sessions with ${busiestLot.rowCount.toLocaleString()} visits.`);
  if (analytics.peakHour != null) insights.push(`The system-wide peak starts around ${String(analytics.peakHour).padStart(2, '0')}:00.`);
  if (longestStayLot && longestStayLot.averageStayMinutes > analytics.averageStayMinutes) insights.push(`${longestStayLot.displayName} has the longest average stay at ${Math.round(longestStayLot.averageStayMinutes / 60 * 10) / 10} hours.`);
  if (strongestRevenuePerSpaceLot?.revenuePerSpace != null) insights.push(`${strongestRevenuePerSpaceLot.label} generates the most revenue per known space.`);
  if (strongestUtilizationLot?.utilizationPercent != null) insights.push(`${strongestUtilizationLot.label} has the strongest estimated utilization at ${strongestUtilizationLot.utilizationPercent.toFixed(1)}%.`);
  if (selectedLot) insights.push(`${selectedLot.displayName} represents ${selectedLot.revenueSharePercent}% of filtered revenue and ranks #${selectedLot.revenueRank} by revenue.`);

  return insights.slice(0, 6);
}

function buildCategoryComparisonRows(
  lots: ParkingLotComparisonPoint[],
  activeDayCount: number,
  hourWindowMinutes: number,
): ParkingLotComparisonPoint[] {
  const groups = new Map<string, ParkingLotComparisonPoint[]>();
  for (const lot of lots) {
    const key = lot.categoryId || 'uncategorized';
    groups.set(key, [...(groups.get(key) || []), lot]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const knownCapacityLots = group.filter(lot => lot.spaces != null && lot.spaces > 0);
    const sessions = group.reduce((sum, lot) => sum + lot.sessions, 0);
    const revenue = roundMoney(group.reduce((sum, lot) => sum + lot.revenue, 0));
    const capacityCoveredSessions = knownCapacityLots.reduce((sum, lot) => sum + lot.sessions, 0);
    const capacityCoveredRevenue = roundMoney(knownCapacityLots.reduce((sum, lot) => sum + lot.revenue, 0));
    const spaces = knownCapacityLots.length > 0
      ? knownCapacityLots.reduce((sum, lot) => sum + (lot.spaces || 0), 0)
      : null;
    const paidMinutes = group.reduce((sum, lot) => sum + lot.paidMinutes, 0);
    const capacityCoveredPaidMinutes = knownCapacityLots.reduce((sum, lot) => sum + lot.paidMinutes, 0);
    const availableSpaceMinutes = spaces && activeDayCount > 0 ? spaces * activeDayCount * hourWindowMinutes : 0;
    const weightedStaySessions = group.reduce((sum, lot) => sum + (lot.averageStayMinutes > 0 ? Math.max(lot.sessions, 1) : 0), 0);
    const weightedStayTotal = group.reduce((sum, lot) => sum + (lot.averageStayMinutes > 0 ? lot.averageStayMinutes * Math.max(lot.sessions, 1) : 0), 0);
    return {
      key,
      label: group[0]?.categoryLabel || 'Uncategorized',
      categoryId: key === 'uncategorized' ? null : key,
      categoryLabel: group[0]?.categoryLabel || 'Uncategorized',
      categoryColorHex: group[0]?.categoryColorHex,
      revenue,
      sessions,
      paidMinutes,
      averageStayMinutes: weightedStaySessions > 0 ? Math.round(weightedStayTotal / weightedStaySessions) : 0,
      uniquePlates: group.reduce((sum, lot) => sum + lot.uniquePlates, 0),
      spaces,
      revenuePerSpace: spaces ? roundMoney(capacityCoveredRevenue / spaces) : null,
      sessionsPerSpace: spaces ? roundMoney(capacityCoveredSessions / spaces) : null,
      utilizationPercent: availableSpaceMinutes > 0 ? roundOne((capacityCoveredPaidMinutes / availableSpaceMinutes) * 100) : null,
      lotCount: group.length,
      capacityCoveredLotCount: knownCapacityLots.length,
      capacityCoveredRevenue,
      capacityCoveredSessions,
      capacityCoveredPaidMinutes,
    };
  }).sort((a, b) => sortByRevenuePerSpace(a, b) || a.label.localeCompare(b.label));
}

function locationsMatch(
  candidate: ParkingRevenueLocationSummary,
  selected: ParkingRevenueLocationSummary,
): boolean {
  if (candidate.key === selected.key) return true;
  const selectedRefs = new Set(selected.sourceIds.map(ref => sourceKey(ref.source, ref.sourceId)));
  return candidate.sourceIds.some(ref => selectedRefs.has(sourceKey(ref.source, ref.sourceId)));
}

export function buildParkingMonthlyUtilizationTrend(
  periods: ParkingMonthlyUtilizationInput[],
  selectedLocation?: ParkingRevenueLocationSummary | null,
): ParkingUtilizationTrendPoint[] {
  return periods.map(({ month, analytics, capacityByLocationKey }) => {
    const locations = selectedLocation
      ? analytics.locationSummaries.filter(location => locationsMatch(location, selectedLocation))
      : analytics.locationSummaries;
    const coveredLocations = locations.filter(location => {
      const spaces = capacityForLocation(location, capacityByLocationKey).spaces;
      return spaces != null && spaces > 0;
    });
    const spaces = coveredLocations.reduce(
      (sum, location) => sum + (capacityForLocation(location, capacityByLocationKey).spaces || 0),
      0,
    );
    const paidMinutes = coveredLocations.reduce((sum, location) => sum + (location.paidMinutes || 0), 0);
    const activeDayCount = analytics.activeDayCount || 0;
    const hourWindowMinutes = analytics.hourWindowMinutes || 1440;
    const availableSpaceMinutes = spaces > 0 && activeDayCount > 0
      ? spaces * activeDayCount * hourWindowMinutes
      : 0;
    return {
      key: month,
      label: monthLabel(month),
      utilizationPercent: availableSpaceMinutes > 0 ? roundOne((paidMinutes / availableSpaceMinutes) * 100) : null,
      paidMinutes,
      availableSpaceMinutes,
      spaces: spaces > 0 ? spaces : null,
      activeDayCount,
      hourWindowMinutes,
      totalLotCount: locations.length,
      capacityCoveredLotCount: coveredLocations.length,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export function buildParkingPlannerAnalysis(
  analytics: ParkingRevenueAnalytics,
  selectedLocation: ParkingRevenueLocationSummary | null | undefined,
  capacityByLocationKey: Record<string, ParkingCapacityInfo> = {},
): ParkingPlannerAnalysis {
  const activeDayCount = analytics.activeDayCount || 0;
  const hourWindowMinutes = analytics.hourWindowMinutes || 1440;
  const lotComparisonRows = analytics.locationSummaries
    .map(location => withCapacity(location, capacityByLocationKey, activeDayCount, hourWindowMinutes));
  const topLotsByRevenue = analytics.locationSummaries
    .map(location => withCapacity(location, capacityByLocationKey, activeDayCount, hourWindowMinutes))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions || a.label.localeCompare(b.label))
    .slice(0, 10);
  const capacityRows = analytics.locationSummaries
    .map(location => withCapacity(location, capacityByLocationKey, activeDayCount, hourWindowMinutes))
    .filter(location => location.spaces != null)
    .sort(sortByRevenuePerSpace);
  const categoryComparisonRows = buildCategoryComparisonRows(lotComparisonRows, activeDayCount, hourWindowMinutes);
  const selectedLot = selectedLocation ? buildSelectedLotAnalysis(analytics, selectedLocation, capacityByLocationKey) : null;

  return {
    monthlyTrend: analytics.revenueByMonth.map(toChartPoint),
    hourlyProfile: buildHourlyProfile(analytics.rows),
    dailyTrend: analytics.revenueByDay.map(toChartPoint),
    sourceMix: buildSourceMix(analytics.rows),
    topLotsByRevenue,
    capacityRows,
    categoryComparisonRows,
    insights: buildInsights(analytics, topLotsByRevenue, capacityRows, selectedLot),
    selectedLot,
  };
}
