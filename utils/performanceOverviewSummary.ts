import type { DailySummary, PerformanceDataSummary } from './performanceDataTypes';
import { compareDateStrings } from './performanceDateUtils';

const DEFAULT_OVERVIEW_DAY_COUNT = 7;
const DEFAULT_REPORT_DAY_COUNT = 56;
const DEFAULT_REPORT_MISSED_TRIP_DETAIL_DAY_COUNT = 7;

function buildOverviewDay(day: DailySummary): DailySummary {
  return {
    ...day,
    byStop: [],
    loadProfiles: [],
    missedTrips: day.missedTrips
      ? {
        ...day.missedTrips,
        trips: [],
      }
      : day.missedTrips,
    ridershipHeatmaps: undefined,
    byOperatorDwell: undefined,
    byCascade: undefined,
    segmentRuntimes: undefined,
    stopSegmentRuntimes: undefined,
    tripStopSegmentRuntimes: undefined,
    routeStopDeviations: undefined,
    byRouteHour: undefined,
  };
}

export function buildPerformanceOverviewSummary(
  summary: PerformanceDataSummary,
  dayCount = DEFAULT_OVERVIEW_DAY_COUNT,
): PerformanceDataSummary {
  const sortedDays = [...summary.dailySummaries].sort((a, b) => compareDateStrings(a.date, b.date));
  const overviewDays = sortedDays.slice(-dayCount).map(buildOverviewDay);
  const overviewDates = overviewDays.map(day => day.date);
  const totalRecords = overviewDays.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0);

  return {
    ...summary,
    dailySummaries: overviewDays,
    metadata: {
      ...summary.metadata,
      dateRange: overviewDates.length > 0
        ? { start: overviewDates[0], end: overviewDates[overviewDates.length - 1] }
        : summary.metadata.dateRange,
      dayCount: overviewDays.length,
      totalRecords,
    },
  };
}

function buildReportDwellMetrics(day: DailySummary, isLatestDay: boolean): DailySummary['byOperatorDwell'] {
  const dwell = day.byOperatorDwell;
  if (!dwell) return undefined;

  return {
    incidents: isLatestDay ? dwell.incidents : [],
    byOperator: isLatestDay ? dwell.byOperator : [],
    totalIncidents: dwell.totalIncidents,
    totalTrackedDwellMinutes: dwell.totalTrackedDwellMinutes,
    totalStopVisits: dwell.totalStopVisits,
    totalServiceHours: dwell.totalServiceHours,
    incidentsPer1kVisits: dwell.incidentsPer1kVisits,
    incidentsPer100ServiceHours: dwell.incidentsPer100ServiceHours,
  };
}

function buildReportDay(
  day: DailySummary,
  latestDate: string | undefined,
  missedTripDetailDates: Set<string>,
): DailySummary {
  const isLatestDay = !!latestDate && day.date === latestDate;
  const keepMissedTripDetails = missedTripDetailDates.has(day.date);

  return {
    ...day,
    byRoute: isLatestDay ? day.byRoute : [],
    byHour: isLatestDay ? day.byHour : [],
    byStop: isLatestDay ? day.byStop : [],
    byTrip: [],
    loadProfiles: [],
    missedTrips: day.missedTrips
      ? {
        ...day.missedTrips,
        trips: keepMissedTripDetails ? (day.missedTrips.trips || []) : [],
      }
      : day.missedTrips,
    ridershipHeatmaps: undefined,
    byOperatorDwell: buildReportDwellMetrics(day, isLatestDay),
    byCascade: undefined,
    segmentRuntimes: undefined,
    stopSegmentRuntimes: undefined,
    tripStopSegmentRuntimes: undefined,
    routeStopDeviations: undefined,
    byRouteHour: undefined,
  };
}

export function buildPerformanceReportSummary(
  summary: PerformanceDataSummary,
  dayCount = DEFAULT_REPORT_DAY_COUNT,
  missedTripDetailDayCount = DEFAULT_REPORT_MISSED_TRIP_DETAIL_DAY_COUNT,
): PerformanceDataSummary {
  const sortedDays = [...summary.dailySummaries].sort((a, b) => compareDateStrings(a.date, b.date));
  const reportDaysSource = sortedDays.slice(-dayCount);
  const latestDate = reportDaysSource.at(-1)?.date;
  const missedTripDetailDates = new Set(
    reportDaysSource
      .slice(-missedTripDetailDayCount)
      .map(day => day.date),
  );
  const reportDays = reportDaysSource.map(day => buildReportDay(day, latestDate, missedTripDetailDates));
  const reportDates = reportDays.map(day => day.date);
  const totalRecords = reportDays.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0);

  return {
    ...summary,
    dailySummaries: reportDays,
    metadata: {
      ...summary.metadata,
      dateRange: reportDates.length > 0
        ? { start: reportDates[0], end: reportDates[reportDates.length - 1] }
        : summary.metadata.dateRange,
      dayCount: reportDays.length,
      totalRecords,
    },
  };
}
