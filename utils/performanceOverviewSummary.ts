import type { DailySummary, PerformanceDataSummary } from './performanceDataTypes';
import { compareDateStrings } from './performanceDateUtils';

const DEFAULT_OVERVIEW_DAY_COUNT = 7;

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
