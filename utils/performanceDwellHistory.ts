/**
 * Compact per-day operator dwell series kept in the report snapshot, and the
 * weekly roll-up the daily email ranks against.
 */

/** Dwell before this date predates the current detection logic. */
export const DWELL_HISTORY_START_DATE = '2026-03-09';
/** Weeks compared against: everything since the start date, capped to a rolling year. */
export const DWELL_COMPARISON_WEEKS = 52;
/** Weeks with fewer days of data than this are left out (missing imports). */
const MIN_DAYS_PER_WEEK = 5;
/** Earlier weeks needed before a percentile is shown. */
const MIN_COMPARISON_WEEKS = 4;
const TREND_WEEKS = 4;

export interface DwellHistoryDay {
  date: string;
  dayType: string;
  /** Moderate and high dwell, minutes. */
  reportableDwellMinutes: number;
  tripCount: number;
}

interface DwellSourceIncident {
  severity: string;
  trackedDwellSeconds: number;
}

interface DwellSourceDay {
  date: string;
  dayType: string;
  system: { tripCount: number };
  byOperatorDwell?: {
    incidents?: DwellSourceIncident[];
    totalReportableDwellMinutes?: number;
    totalTrackedDwellMinutes?: number;
  };
}

/** Moderate and high dwell for one day, falling back to stored totals when incidents were stripped. */
export function dayReportableDwellMinutes(day: DwellSourceDay): number {
  const dwell = day.byOperatorDwell;
  if (!dwell) return 0;
  const incidents = dwell.incidents ?? [];
  if (incidents.length > 0) {
    return incidents
      .filter(incident => incident.severity === 'moderate' || incident.severity === 'high')
      .reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0) / 60;
  }
  return dwell.totalReportableDwellMinutes ?? dwell.totalTrackedDwellMinutes ?? 0;
}

export function buildDwellHistory(days: DwellSourceDay[]): DwellHistoryDay[] {
  return days
    .filter(day => day.date >= DWELL_HISTORY_START_DATE && !!day.byOperatorDwell && day.system.tripCount > 0)
    .map(day => ({
      date: day.date,
      dayType: day.dayType,
      reportableDwellMinutes: Math.round(dayReportableDwellMinutes(day) * 10) / 10,
      tripCount: day.system.tripCount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface DwellWeek {
  /** Monday. */
  weekStart: string;
  /** Sunday. */
  weekEnd: string;
  days: number;
  dwellHours: number;
  trips: number;
  /** Moderate and high dwell minutes per 100 trips. */
  minutesPer100Trips: number;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

/** Complete Monday–Sunday weeks ending on or before `latestDate`, oldest first. */
export function buildDwellWeeks(history: DwellHistoryDay[], latestDate: string): DwellWeek[] {
  const byWeek = new Map<string, DwellHistoryDay[]>();
  for (const day of history) {
    if (day.date > latestDate) continue;
    const weekStart = mondayOf(day.date);
    byWeek.set(weekStart, [...(byWeek.get(weekStart) ?? []), day]);
  }

  return [...byWeek.entries()]
    .map(([weekStart, days]) => ({ weekStart, weekEnd: shiftDate(weekStart, 6), days }))
    .filter(week => week.weekEnd <= latestDate && week.days.length >= MIN_DAYS_PER_WEEK)
    .map(({ weekStart, weekEnd, days }) => {
      const minutes = days.reduce((sum, day) => sum + day.reportableDwellMinutes, 0);
      const trips = days.reduce((sum, day) => sum + day.tripCount, 0);
      return {
        weekStart,
        weekEnd,
        days: days.length,
        dwellHours: minutes / 60,
        trips,
        minutesPer100Trips: trips > 0 ? (minutes / trips) * 100 : 0,
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface WeeklyDwellSummary {
  /** Weeks in the comparison window, oldest first; the last is the reported week. */
  weeks: DwellWeek[];
  lastWeek: DwellWeek;
  /** Share of earlier weeks with a lower rate than the reported week, 0–100. */
  percentile: number;
  medianPer100Trips: number;
  /** Change in the 4-week average rate vs the 4 weeks before, percent; null without 8 weeks. */
  trendPercent: number | null;
  recentAvgPer100Trips: number | null;
  priorAvgPer100Trips: number | null;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Ranks the latest complete week; null until there are enough earlier weeks to compare. */
export function summarizeWeeklyDwell(history: DwellHistoryDay[], latestDate: string): WeeklyDwellSummary | null {
  const weeks = buildDwellWeeks(history, latestDate).slice(-DWELL_COMPARISON_WEEKS);
  if (weeks.length < MIN_COMPARISON_WEEKS + 1) return null;

  const lastWeek = weeks[weeks.length - 1];
  const earlier = weeks.slice(0, -1);
  const lower = earlier.filter(week => week.minutesPer100Trips < lastWeek.minutesPer100Trips).length;
  const hasTrend = weeks.length >= TREND_WEEKS * 2;
  const recentAvg = hasTrend ? average(weeks.slice(-TREND_WEEKS).map(week => week.minutesPer100Trips)) : null;
  const priorAvg = hasTrend
    ? average(weeks.slice(-TREND_WEEKS * 2, -TREND_WEEKS).map(week => week.minutesPer100Trips))
    : null;

  return {
    weeks,
    lastWeek,
    percentile: Math.round((lower / earlier.length) * 100),
    medianPer100Trips: median(weeks.map(week => week.minutesPer100Trips)),
    trendPercent: recentAvg !== null && priorAvg ? ((recentAvg - priorAvg) / priorAvg) * 100 : null,
    recentAvgPer100Trips: recentAvg,
    priorAvgPer100Trips: priorAvg,
  };
}
