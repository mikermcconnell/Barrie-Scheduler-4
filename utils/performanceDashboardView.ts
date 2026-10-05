import type {
  DailySummary,
  PerformanceDashboardViewMode,
  PerformanceDataSummary,
  PerformanceDetailMode,
} from './performanceDataTypes';
import { buildLoadProfilePeakTrips } from './performanceLoadProfileView';

export const PERFORMANCE_DASHBOARD_VIEW_MODES = [
  'overview',
  'otp',
  'ridership',
  'operator-dwell',
] as const satisfies readonly PerformanceDashboardViewMode[];

export function getPerformanceMonthlyPaths(
  metadata: PerformanceDataSummary['metadata'],
  routeId?: string | null,
  detailMode?: PerformanceDetailMode,
  dateRange?: { start: string; end: string },
): Record<string, string> | undefined {
  const routePaths = routeId && routeId !== 'all'
    ? metadata.routeMonthlyStoragePaths?.[routeId]
    : undefined;
  const fallbackPaths = routePaths || metadata.monthlyStoragePaths;

  if (detailMode && PERFORMANCE_DASHBOARD_VIEW_MODES.includes(detailMode as PerformanceDashboardViewMode)) {
    const dashboardPaths = metadata.dashboardMonthlyStoragePaths?.[detailMode as PerformanceDashboardViewMode];
    const requiredMonths = Object.keys(fallbackPaths || {}).filter(month => (
      !dateRange || (month >= dateRange.start.slice(0, 7) && month <= dateRange.end.slice(0, 7))
    ));
    const isComplete = dashboardPaths
      && Object.keys(dashboardPaths).length > 0
      && (requiredMonths.length === 0 || requiredMonths.every(month => !!dashboardPaths[month]));
    if (isComplete) return dashboardPaths;
  }

  return fallbackPaths;
}

function trimMissedTrips(day: DailySummary, keepTripDetails: boolean): DailySummary['missedTrips'] {
  return day.missedTrips
    ? {
        ...day.missedTrips,
        trips: keepTripDetails ? (day.missedTrips.trips || []) : [],
      }
    : day.missedTrips;
}

export function trimDayForDetailMode(
  day: DailySummary,
  mode: PerformanceDetailMode = 'all',
): DailySummary {
  if (mode === 'all') return day;

  const base: DailySummary = {
    ...day,
    byStop: [],
    byTrip: [],
    loadProfilePeakTrips: undefined,
    loadProfiles: [],
    ridershipHeatmaps: undefined,
    byOperatorDwell: undefined,
    byCascade: undefined,
    segmentRuntimes: undefined,
    stopSegmentRuntimes: undefined,
    tripStopSegmentRuntimes: undefined,
    runtimePatterns: undefined,
    routeStopDeviations: undefined,
    byRouteHour: undefined,
  };

  switch (mode) {
    case 'overview':
      return {
        ...base,
        byTrip: day.byTrip,
        missedTrips: trimMissedTrips(day, false),
      };
    case 'otp':
      return {
        ...base,
        byTrip: day.byTrip,
        routeStopDeviations: day.routeStopDeviations,
        byRouteHour: day.byRouteHour,
        missedTrips: trimMissedTrips(day, true),
      };
    case 'ridership':
      return {
        ...base,
        byStop: day.byStop,
        loadProfiles: day.loadProfiles,
        ridershipHeatmaps: day.ridershipHeatmaps,
        byRouteHour: day.byRouteHour,
        missedTrips: trimMissedTrips(day, false),
      };
    case 'load-profiles':
      return {
        ...base,
        loadProfilePeakTrips: day.loadProfilePeakTrips ?? buildLoadProfilePeakTrips(day),
        loadProfiles: day.loadProfiles,
        missedTrips: trimMissedTrips(day, false),
      };
    case 'operator-dwell':
      return {
        ...base,
        loadProfiles: day.loadProfiles,
        byOperatorDwell: day.byOperatorDwell,
        byCascade: day.byCascade,
        missedTrips: trimMissedTrips(day, false),
      };
    default:
      return day;
  }
}

export function buildPerformanceDashboardView(
  summary: PerformanceDataSummary,
  mode: PerformanceDashboardViewMode,
): PerformanceDataSummary {
  return {
    ...summary,
    dailySummaries: summary.dailySummaries.map(day => trimDayForDetailMode(day, mode)),
  };
}
