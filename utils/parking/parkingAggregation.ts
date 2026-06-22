import {
  DEFAULT_PARKING_FLAG_RULES,
  PARKING_SCHEMA_VERSION,
  type ParkingDepartmentMonthlySummary,
  type ParkingFlagCode,
  type ParkingFlagRuleSettings,
  type ParkingMonthlyDataset,
  type ParkingPlatePattern,
  type ParkingRawRow,
  type ParkingSettings,
  type ParkingSummary,
} from './parkingTypes';

export function mergeParkingSettings(base: ParkingSettings, override: ParkingSettings): ParkingSettings {
  return {
    codeFamilies: override.codeFamilies ?? base.codeFamilies,
    spotLocations: override.spotLocations ?? base.spotLocations,
    flagRules: {
      ...DEFAULT_PARKING_FLAG_RULES,
      ...(base.flagRules || {}),
      ...(override.flagRules || {}),
    },
    updatedAt: override.updatedAt ?? base.updatedAt,
    updatedBy: override.updatedBy ?? base.updatedBy,
  };
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueCount(values: Iterable<string>): number {
  return new Set([...values].filter(Boolean)).size;
}

function dateToUtcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

function nextWorkdayUtcDay(day: number): number {
  const weekday = new Date(day * 86_400_000).getUTCDay();
  if (weekday === 5) return day + 3;
  if (weekday === 6) return day + 2;
  return day + 1;
}

function maxConsecutiveWeekdays(rows: ParkingRawRow[]): number {
  const days = [...new Map(rows
    .filter(row => isWeekday(row.weekday))
    .map(row => [row.startDate, dateToUtcDay(row.startDate)]),
  ).values()].sort((a, b) => a - b);

  let max = 0;
  let current = 0;
  let previous: number | null = null;
  for (const day of days) {
    if (previous == null || day === nextWorkdayUtcDay(previous)) {
      current += 1;
    } else {
      current = 1;
    }
    max = Math.max(max, current);
    previous = day;
  }
  return max;
}

function summarizeDepartmentRows(rows: ParkingRawRow[]): ParkingDepartmentMonthlySummary[] {
  const groups = new Map<string, ParkingRawRow[]>();
  for (const row of rows) {
    const key = `${row.department || 'Unmapped'}|${row.codeFamilyKey}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [department, codeFamilyKey] = key.split('|');
    const summary: ParkingDepartmentMonthlySummary = {
      month: group[0]?.startMonth || '',
      department,
      codeFamilyKey,
      totalValue: money(group.reduce((sum, row) => sum + row.discountAmount, 0)),
      sessionCount: group.length,
      uniquePlateCount: uniqueCount(group.map(row => row.plate)),
      previousValue: null,
      changeValue: null,
      changePercent: null,
      isHighUsage: false,
    };
    return summary;
  }).sort((a, b) => b.totalValue - a.totalValue || a.department.localeCompare(b.department));
}

function topSpot(rows: ParkingRawRow[]): { spotId: string; locationName: string; days: number } {
  const spots = new Map<string, { spotId: string; locationName: string; days: Set<string>; sessions: number }>();
  for (const row of rows) {
    const key = row.spotId || 'Unknown';
    const current = spots.get(key) || { spotId: key, locationName: row.locationName || key, days: new Set<string>(), sessions: 0 };
    current.days.add(row.startDate);
    current.sessions += 1;
    spots.set(key, current);
  }
  const sorted = [...spots.values()].sort((a, b) => b.days.size - a.days.size || b.sessions - a.sessions || a.spotId.localeCompare(b.spotId));
  const best = sorted[0];
  return { spotId: best?.spotId || '', locationName: best?.locationName || '', days: best?.days.size || 0 };
}

function buildPlatePattern(month: string, plate: string, rows: ParkingRawRow[], rules: ParkingFlagRuleSettings): ParkingPlatePattern {
  const activeDays = uniqueCount(rows.map(row => row.startDate));
  const longSessionCount = rows.filter(row => row.durationMinutes >= rules.longSessionHours * 60).length;
  const spot = topSpot(rows);
  const consecutiveWeekdays = maxConsecutiveWeekdays(rows);
  const unusualTimingCount = rows.filter(row => (
    row.isWeekend || row.startMinutes < rules.workdayStartHour * 60 || row.endMinutes > rules.workdayEndHour * 60
  )).length;
  const dailyCounts = new Map<string, number>();
  for (const row of rows) dailyCounts.set(row.startDate, (dailyCounts.get(row.startDate) || 0) + 1);
  const multipleDailySessionDays = [...dailyCounts.values()].filter(count => count >= rules.multipleDailySessions).length;
  const totalValue = money(rows.reduce((sum, row) => sum + row.discountAmount, 0));
  const flags: ParkingFlagCode[] = [];

  if (rows.some(row => row.hasMissingPlate)) flags.push('missing_plate');
  if (activeDays >= rules.plateActiveDaysPerMonth) flags.push('high_frequency');
  if (totalValue >= rules.plateMonthlyValueDollars) flags.push('high_value');
  if (longSessionCount >= rules.longSessionCount) flags.push('long_duration');
  if (spot.days >= rules.sameLocationDays) flags.push('same_location');
  if (consecutiveWeekdays >= rules.consecutiveWeekdays) flags.push('consecutive_weekdays');
  if (unusualTimingCount > 0) flags.push('unusual_timing');
  if (multipleDailySessionDays > 0) flags.push('multiple_daily_sessions');

  const departmentTotals = new Map<string, number>();
  for (const row of rows) departmentTotals.set(row.department || 'Unmapped', (departmentTotals.get(row.department || 'Unmapped') || 0) + row.discountAmount);
  const department = [...departmentTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'Unmapped';

  return {
    month,
    plate,
    displayPlate: plate || '(missing)',
    department,
    totalValue,
    sessionCount: rows.length,
    activeDays,
    longSessionCount,
    topSpotId: spot.spotId,
    topLocationName: spot.locationName,
    topLocationDays: spot.days,
    maxConsecutiveWeekdays: consecutiveWeekdays,
    unusualTimingCount,
    multipleDailySessionDays,
    flags,
  };
}

function summarizePlateRows(rows: ParkingRawRow[], rules: ParkingFlagRuleSettings): ParkingPlatePattern[] {
  const groups = new Map<string, ParkingRawRow[]>();
  for (const row of rows) {
    const key = `${row.startMonth}|${row.plate || '(missing)'}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [month, plate] = key.split('|');
      return buildPlatePattern(month, plate === '(missing)' ? '' : plate, group, rules);
    })
    .sort((a, b) => b.flags.length - a.flags.length || b.totalValue - a.totalValue || a.displayPlate.localeCompare(b.displayPlate));
}

export function buildParkingMonthAnalysis(rows: ParkingRawRow[], rules: ParkingFlagRuleSettings): {
  departmentSummaries: ParkingDepartmentMonthlySummary[];
  platePatterns: ParkingPlatePattern[];
} {
  return {
    departmentSummaries: summarizeDepartmentRows(rows),
    platePatterns: summarizePlateRows(rows, rules),
  };
}

function withMonthOverMonth(
  summaries: ParkingDepartmentMonthlySummary[],
  rules: ParkingFlagRuleSettings,
): ParkingDepartmentMonthlySummary[] {
  const sorted = [...summaries].sort((a, b) => a.month.localeCompare(b.month));
  const priorByDepartment = new Map<string, ParkingDepartmentMonthlySummary>();
  return sorted.map(summary => {
    const key = summary.department;
    const previous = priorByDepartment.get(key);
    const previousValue = previous?.totalValue ?? null;
    const changeValue = previousValue == null ? null : money(summary.totalValue - previousValue);
    const changePercent = previousValue == null
      ? null
      : previousValue === 0
        ? (summary.totalValue > 0 ? null : 0)
        : money(((summary.totalValue - previousValue) / previousValue) * 100);
    const hasSpike = previousValue === 0
      ? summary.totalValue > 0
      : changePercent != null && changePercent >= rules.departmentIncreasePercent;
    const next = {
      ...summary,
      previousValue,
      changeValue,
      changePercent,
      isHighUsage: summary.totalValue >= rules.departmentMonthlyValueDollars || hasSpike,
    };
    priorByDepartment.set(key, next);
    return next;
  }).sort((a, b) => b.month.localeCompare(a.month) || b.totalValue - a.totalValue || a.department.localeCompare(b.department));
}

function buildMetadata(months: ParkingMonthlyDataset[], importedBy: string): ParkingSummary['metadata'] {
  return {
    importedAt: new Date().toISOString(),
    importedBy,
    monthCount: months.length,
    totalRows: months.reduce((sum, month) => sum + month.rowCount, 0),
    totalValue: money(months.reduce((sum, month) => sum + month.totalValue, 0)),
  };
}

export function buildParkingSummary(
  months: ParkingMonthlyDataset[],
  importedBy: string,
  storagePath?: string,
  rules: ParkingFlagRuleSettings = DEFAULT_PARKING_FLAG_RULES,
): ParkingSummary {
  const sortedMonths = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const departmentSummaries = withMonthOverMonth(sortedMonths.flatMap(month => month.departmentSummaries), rules);
  const platePatterns = sortedMonths.flatMap(month => month.platePatterns)
    .sort((a, b) => b.month.localeCompare(a.month) || b.flags.length - a.flags.length || b.totalValue - a.totalValue);
  const metadata = buildMetadata(sortedMonths, importedBy);
  return {
    schemaVersion: PARKING_SCHEMA_VERSION,
    months: sortedMonths,
    departmentSummaries,
    platePatterns,
    metadata: { ...metadata, ...(storagePath ? { storagePath } : {}) },
  };
}

export function buildParkingReplacementSummary(
  existingSummary: ParkingSummary | null,
  dataset: ParkingMonthlyDataset,
  importedBy: string,
  storagePath: string,
  rules: ParkingFlagRuleSettings = DEFAULT_PARKING_FLAG_RULES,
): ParkingSummary {
  const keptMonths = (existingSummary?.months || []).filter(month => month.month !== dataset.month);
  return buildParkingSummary([...keptMonths, dataset], importedBy, storagePath, rules);
}

export function getLatestParkingMonth(summary: ParkingSummary | null | undefined): string | null {
  return [...(summary?.months || [])].map(month => month.month).sort().at(-1) ?? null;
}
