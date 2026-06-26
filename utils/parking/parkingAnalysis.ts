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
  revenue: number;
  sessions: number;
  averageStayMinutes: number;
  uniquePlates: number;
  spaces: number | null;
  revenuePerSpace: number | null;
  sessionsPerSpace: number | null;
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
  const groups = new Map<string, ParkingRevenueRawRow[]>();
  for (const row of rows.filter(includeRow)) {
    groups.set(row.startMonth, [...(groups.get(row.startMonth) || []), row]);
  }

  return [...groups.entries()].map(([month, group]) => {
    const activeDays = Math.max(1, new Set(group.map(row => row.startDate)).size);
    return {
      key: month,
      label: monthLabel(month),
      revenue: roundMoney(group.reduce((sum, row) => sum + row.amount, 0) / activeDays),
      sessions: roundOne(group.length / activeDays),
      averageStayMinutes: average(group.map(row => row.durationMinutes).filter(value => value > 0)),
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
  const groups = new Map<string, ParkingRevenueRawRow[]>();
  for (const row of rows) {
    const key = keyForRow(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: labelForKey(key),
    revenue: roundMoney(group.reduce((sum, row) => sum + row.amount, 0)),
    sessions: group.length,
    averageStayMinutes: average(group.map(row => row.durationMinutes).filter(value => value > 0)),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

function buildHourlyProfile(rows: ParkingRevenueRawRow[]): ParkingAnalysisChartPoint[] {
  const byHour = new Map(buildTrend(
    rows,
    row => String(Math.floor(row.startMinutes / 60)).padStart(2, '0'),
    key => `${key}:00`,
  ).map(point => [point.key, point]));

  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    return byHour.get(key) || {
      key,
      label: `${key}:00`,
      revenue: 0,
      sessions: 0,
      averageStayMinutes: 0,
    };
  });
}

function buildSourceMix(rows: ParkingRevenueRawRow[]): ParkingSourceMixPoint[] {
  return (['hotspot', 'qr'] as ParkingRevenueSource[]).map(source => {
    const sourceRows = rows.filter(row => row.source === source);
    return {
      key: source,
      label: source === 'hotspot' ? 'HotSpot app' : 'QR code',
      revenue: roundMoney(sourceRows.reduce((sum, row) => sum + row.amount, 0)),
      sessions: sourceRows.length,
    };
  });
}

function rowBelongsToLocation(row: ParkingRevenueRawRow, location: ParkingRevenueLocationSummary): boolean {
  if (row.physicalLocationId && row.physicalLocationId === location.key) return true;
  const refs = new Set(location.sourceIds.map(ref => sourceKey(ref.source, ref.sourceId)));
  if (refs.has(sourceKey(row.source, row.sourceId))) return true;
  const rowNames = [row.physicalLocationName, row.sourceLabel].map(normalizeText).filter(Boolean);
  return rowNames.includes(normalizeText(location.displayName));
}

export function buildParkingTrendOverview(
  analytics: ParkingRevenueAnalytics,
  selectedLocation: ParkingRevenueLocationSummary | null | undefined,
  requestedTargetMonth?: string,
): ParkingTrendOverview {
  const scopedRows = selectedLocation ? analytics.rows.filter(row => rowBelongsToLocation(row, selectedLocation)) : analytics.rows;
  const targetMonth = requestedTargetMonth || latestMonth(scopedRows) || latestMonth(analytics.rows);
  const previous = previousMonth(targetMonth);
  const lastYear = sameMonthLastYear(targetMonth);

  return {
    targetMonth,
    scopeLabel: selectedLocation?.displayName || 'All parking lots',
    comparisonCards: [
      comparisonCard('revenue-mom', 'Revenue MoM', scopedRows, targetMonth, previous, 'money', revenueForRows),
      comparisonCard('sessions-mom', 'Sessions MoM', scopedRows, targetMonth, previous, 'number', rows => rows.length),
      comparisonCard('stay-mom', 'Avg stay MoM', scopedRows, targetMonth, previous, 'duration', rows => average(rows.map(row => row.durationMinutes).filter(value => value > 0))),
      comparisonCard('revenue-yoy', 'Revenue YoY', scopedRows, targetMonth, lastYear, 'money', revenueForRows),
    ],
    weekdayTrend: buildActiveDayMonthlyTrend(scopedRows, row => row.weekday >= 1 && row.weekday <= 5),
    saturdayTrend: buildActiveDayMonthlyTrend(scopedRows, row => row.weekday === 6),
    sundayTrend: buildActiveDayMonthlyTrend(scopedRows, row => row.weekday === 0),
    fastestGrowingLot: buildFastestGrowingLot(analytics.rows, targetMonth),
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
): ParkingLotComparisonPoint {
  const capacity = capacityForLocation(location, capacityByLocationKey);
  const spaces = capacity.spaces && capacity.spaces > 0 ? capacity.spaces : null;
  return {
    key: location.key,
    label: location.displayName,
    revenue: location.totalRevenue,
    sessions: location.rowCount,
    averageStayMinutes: location.averageStayMinutes,
    uniquePlates: location.uniquePlateCount,
    spaces,
    revenuePerSpace: spaces ? roundMoney(location.totalRevenue / spaces) : null,
    sessionsPerSpace: spaces ? roundMoney(location.rowCount / spaces) : null,
  };
}

function percentShare(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
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
  const comparison = withCapacity(selectedLocation, capacityByLocationKey);

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
  const strongestCapacityLot = capacityRows[0];

  if (highestRevenueLot) insights.push(`${highestRevenueLot.label} leads revenue at ${highestRevenueLot.revenue.toLocaleString(undefined, { style: 'currency', currency: 'CAD' })}.`);
  if (busiestLot) insights.push(`${busiestLot.displayName} has the most sessions with ${busiestLot.rowCount.toLocaleString()} visits.`);
  if (analytics.peakHour != null) insights.push(`The system-wide peak starts around ${String(analytics.peakHour).padStart(2, '0')}:00.`);
  if (longestStayLot && longestStayLot.averageStayMinutes > analytics.averageStayMinutes) insights.push(`${longestStayLot.displayName} has the longest average stay at ${Math.round(longestStayLot.averageStayMinutes / 60 * 10) / 10} hours.`);
  if (strongestCapacityLot?.revenuePerSpace != null) insights.push(`${strongestCapacityLot.label} generates the most revenue per known space.`);
  if (selectedLot) insights.push(`${selectedLot.displayName} represents ${selectedLot.revenueSharePercent}% of filtered revenue and ranks #${selectedLot.revenueRank} by revenue.`);

  return insights.slice(0, 6);
}

export function buildParkingPlannerAnalysis(
  analytics: ParkingRevenueAnalytics,
  selectedLocation: ParkingRevenueLocationSummary | null | undefined,
  capacityByLocationKey: Record<string, ParkingCapacityInfo> = {},
): ParkingPlannerAnalysis {
  const topLotsByRevenue = analytics.locationSummaries
    .map(location => withCapacity(location, capacityByLocationKey))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions || a.label.localeCompare(b.label))
    .slice(0, 10);
  const capacityRows = analytics.locationSummaries
    .map(location => withCapacity(location, capacityByLocationKey))
    .filter(location => location.spaces != null)
    .sort((a, b) => (b.revenuePerSpace as number) - (a.revenuePerSpace as number) || b.revenue - a.revenue);
  const selectedLot = selectedLocation ? buildSelectedLotAnalysis(analytics, selectedLocation, capacityByLocationKey) : null;

  return {
    monthlyTrend: analytics.revenueByMonth.map(toChartPoint),
    hourlyProfile: buildHourlyProfile(analytics.rows),
    dailyTrend: analytics.revenueByDay.map(toChartPoint),
    sourceMix: buildSourceMix(analytics.rows),
    topLotsByRevenue,
    capacityRows,
    insights: buildInsights(analytics, topLotsByRevenue, capacityRows, selectedLot),
    selectedLot,
  };
}
