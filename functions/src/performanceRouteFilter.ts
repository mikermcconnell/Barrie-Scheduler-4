import type {
  DailySummary,
  HourMetrics,
  OTPBreakdown,
  PerformanceDataSummary,
  RouteMetrics,
  SystemMetrics,
} from './types';

export interface PerformanceRouteOption {
  routeId: string;
  routeName: string;
}

const EMPTY_OTP: OTPBreakdown = {
  total: 0,
  onTime: 0,
  early: 0,
  late: 0,
  onTimePercent: 0,
  earlyPercent: 0,
  latePercent: 0,
  avgDeviationSeconds: 0,
};

function routeMatches(routeId: string | undefined, selectedRouteId: string): boolean {
  return (routeId || '').trim().toUpperCase() === selectedRouteId.trim().toUpperCase();
}

function mergeOtp(breakdowns: OTPBreakdown[]): OTPBreakdown {
  const total = breakdowns.reduce((sum, otp) => sum + (otp.total || 0), 0);
  const onTime = breakdowns.reduce((sum, otp) => sum + (otp.onTime || 0), 0);
  const early = breakdowns.reduce((sum, otp) => sum + (otp.early || 0), 0);
  const late = breakdowns.reduce((sum, otp) => sum + (otp.late || 0), 0);
  const weightedDeviation = breakdowns.reduce(
    (sum, otp) => sum + ((otp.avgDeviationSeconds || 0) * (otp.total || 0)),
    0,
  );

  if (total === 0) return { ...EMPTY_OTP };

  return {
    total,
    onTime,
    early,
    late,
    onTimePercent: (onTime / total) * 100,
    earlyPercent: (early / total) * 100,
    latePercent: (late / total) * 100,
    avgDeviationSeconds: weightedDeviation / total,
  };
}

function buildRouteScopedSystem(original: SystemMetrics, routes: RouteMetrics[]): SystemMetrics {
  if (routes.length === 0) {
    return {
      ...original,
      otp: { ...EMPTY_OTP },
      totalRidership: 0,
      totalBoardings: 0,
      totalAlightings: 0,
      tripCount: 0,
      wheelchairTrips: 0,
      avgSystemLoad: 0,
      peakLoad: 0,
    };
  }

  const tripCount = routes.reduce((sum, route) => sum + (route.tripCount || 0), 0);
  const weightedLoad = routes.reduce(
    (sum, route) => sum + ((route.avgLoad || 0) * (route.tripCount || 0)),
    0,
  );

  return {
    ...original,
    otp: mergeOtp(routes.map(route => route.otp)),
    totalRidership: routes.reduce((sum, route) => sum + (route.ridership || 0), 0),
    totalBoardings: routes.reduce((sum, route) => sum + (route.ridership || 0), 0),
    totalAlightings: routes.reduce((sum, route) => sum + (route.alightings || 0), 0),
    tripCount,
    wheelchairTrips: routes.reduce((sum, route) => sum + (route.wheelchairTrips || 0), 0),
    avgSystemLoad: tripCount > 0 ? weightedLoad / tripCount : 0,
    peakLoad: Math.max(0, ...routes.map(route => route.maxLoad || 0)),
  };
}

function buildRouteScopedHours(day: DailySummary, selectedRouteId: string): HourMetrics[] {
  const routeHours = (day.byRouteHour || []).filter(row => routeMatches(row.routeId, selectedRouteId));
  if (routeHours.length === 0) return day.byHour;

  return routeHours.map(row => ({
    hour: row.hour,
    otp: row.otp ?? { ...EMPTY_OTP },
    boardings: row.boardings || 0,
    alightings: row.alightings || 0,
    avgLoad: row.avgLoad || 0,
  }));
}

function filterDayByRoute(day: DailySummary, selectedRouteId: string): DailySummary {
  const byRoute = day.byRoute.filter(route => routeMatches(route.routeId, selectedRouteId));
  const byTrip = day.byTrip.filter(trip => routeMatches(trip.routeId, selectedRouteId));
  const loadProfiles = day.loadProfiles.filter(profile => routeMatches(profile.routeId, selectedRouteId));
  const routeStopDeviations = day.routeStopDeviations?.filter(profile => routeMatches(profile.routeId, selectedRouteId));
  const byRouteHour = day.byRouteHour?.filter(row => routeMatches(row.routeId, selectedRouteId));
  const ridershipHeatmaps = day.ridershipHeatmaps?.filter(profile => routeMatches(profile.routeId, selectedRouteId));
  const segmentRuntimeEntries = day.segmentRuntimes?.entries.filter(entry => routeMatches(entry.routeId, selectedRouteId)) ?? [];
  const stopSegmentRuntimeEntries = day.stopSegmentRuntimes?.entries.filter(entry => routeMatches(entry.routeId, selectedRouteId)) ?? [];
  const tripStopSegmentRuntimeEntries = day.tripStopSegmentRuntimes?.entries.filter(entry => routeMatches(entry.routeId, selectedRouteId)) ?? [];
  const missedTrips = day.missedTrips
    ? {
      ...day.missedTrips,
      byRoute: day.missedTrips.byRoute.filter(row => routeMatches(row.routeId, selectedRouteId)),
      trips: day.missedTrips.trips?.filter(trip => routeMatches(trip.routeId, selectedRouteId)),
    }
    : day.missedTrips;
  const byOperatorDwell = day.byOperatorDwell
    ? {
      ...day.byOperatorDwell,
      incidents: day.byOperatorDwell.incidents.filter(incident => routeMatches(incident.routeId, selectedRouteId)),
    }
    : day.byOperatorDwell;
  const byCascade = day.byCascade
    ? {
      ...day.byCascade,
      cascades: day.byCascade.cascades.filter(cascade => routeMatches(cascade.routeId, selectedRouteId)),
      byStop: day.byCascade.byStop.filter(row => routeMatches(row.routeId, selectedRouteId)),
      byTerminal: day.byCascade.byTerminal.filter(row => routeMatches(row.routeId, selectedRouteId)),
    }
    : day.byCascade;

  return {
    ...day,
    system: buildRouteScopedSystem(day.system, byRoute),
    byRoute,
    byHour: buildRouteScopedHours(day, selectedRouteId),
    byStop: day.byStop
      .map(stop => {
        const routeBreakdown = stop.routeBreakdown?.filter(row => routeMatches(row.routeId, selectedRouteId));
        const routeValues = routeBreakdown?.[0];
        return {
          ...stop,
          routeCount: routeBreakdown && routeBreakdown.length > 0 ? routeBreakdown.length : stop.routeCount,
          routes: stop.routes.filter(routeId => routeMatches(routeId, selectedRouteId)),
          routeBreakdown,
          boardings: routeValues?.boardings ?? stop.boardings,
          alightings: routeValues?.alightings ?? stop.alightings,
          hourlyBoardings: routeValues?.hourlyBoardings ?? stop.hourlyBoardings,
          hourlyAlightings: routeValues?.hourlyAlightings ?? stop.hourlyAlightings,
        };
      })
      .filter(stop => stop.routes.length > 0 || (stop.routeBreakdown?.length ?? 0) > 0),
    byTrip,
    loadProfiles,
    missedTrips,
    byOperatorDwell,
    byCascade,
    ridershipHeatmaps,
    routeStopDeviations,
    byRouteHour,
    segmentRuntimes: day.segmentRuntimes
      ? {
        entries: segmentRuntimeEntries,
        totalObservations: segmentRuntimeEntries.reduce((sum, entry) => sum + entry.observations.length, 0),
        tripsWithData: segmentRuntimeEntries.length,
      }
      : day.segmentRuntimes,
    stopSegmentRuntimes: day.stopSegmentRuntimes
      ? {
        entries: stopSegmentRuntimeEntries,
        totalObservations: stopSegmentRuntimeEntries.reduce((sum, entry) => sum + entry.observations.length, 0),
        tripsWithData: stopSegmentRuntimeEntries.length,
      }
      : day.stopSegmentRuntimes,
    tripStopSegmentRuntimes: day.tripStopSegmentRuntimes
      ? {
        entries: tripStopSegmentRuntimeEntries,
        totalObservations: tripStopSegmentRuntimeEntries.reduce((sum, entry) => sum + entry.segments.length, 0),
        tripsWithData: tripStopSegmentRuntimeEntries.length,
      }
      : day.tripStopSegmentRuntimes,
  };
}

export function getAvailablePerformanceRoutes(summary: PerformanceDataSummary | null | undefined): PerformanceRouteOption[] {
  const routeMap = new Map<string, PerformanceRouteOption>();
  for (const day of summary?.dailySummaries || []) {
    for (const route of day.byRoute || []) {
      if (!route.routeId) continue;
      routeMap.set(route.routeId, {
        routeId: route.routeId,
        routeName: route.routeName || `Route ${route.routeId}`,
      });
    }
  }

  return Array.from(routeMap.values())
    .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }));
}

export function filterPerformanceSummaryByRoute(
  summary: PerformanceDataSummary | null | undefined,
  selectedRouteId?: string | null,
): PerformanceDataSummary | null {
  if (!summary) return null;
  if (!selectedRouteId || selectedRouteId === 'all') return summary;

  const dailySummaries = summary.dailySummaries.map(day => filterDayByRoute(day, selectedRouteId));
  const totalRecords = dailySummaries.reduce((sum, day) => sum + (day.dataQuality?.totalRecords || 0), 0);

  return {
    ...summary,
    dailySummaries,
    metadata: {
      ...summary.metadata,
      dayCount: dailySummaries.length,
      totalRecords,
    },
  };
}
