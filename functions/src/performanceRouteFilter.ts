import type {
  DailySummary,
  HourMetrics,
  OperatorDwellMetrics,
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

const MERGED_AB_ROUTES = new Set(['2', '7', '12']);

function getMergedCanonicalRouteId(routeId: string | undefined): string | null {
  const normalized = (routeId || '').trim().toUpperCase();
  const match = normalized.match(/^(\d+)([AB])$/);
  if (!match) return null;
  return MERGED_AB_ROUTES.has(match[1]) ? match[1] : null;
}

function routeMatches(routeId: string | undefined, selectedRouteId: string): boolean {
  const normalizedRouteId = (routeId || '').trim().toUpperCase();
  const normalizedSelectedRouteId = selectedRouteId.trim().toUpperCase();
  if (normalizedRouteId === normalizedSelectedRouteId) return true;
  return getMergedCanonicalRouteId(normalizedRouteId) === normalizedSelectedRouteId;
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
  if (routeHours.length === 0) return [];

  const byHour = new Map<number, typeof routeHours>();
  for (const row of routeHours) {
    byHour.set(row.hour, [...(byHour.get(row.hour) || []), row]);
  }

  return Array.from(byHour.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, rows]) => {
      const otp = mergeOtp(rows.map(row => row.otp ?? { ...EMPTY_OTP }));
      const loadWeight = rows.reduce((sum, row) => sum + (row.otp?.total || 0), 0);
      const avgLoad = loadWeight > 0
        ? rows.reduce((sum, row) => sum + ((row.avgLoad || 0) * (row.otp?.total || 0)), 0) / loadWeight
        : rows.reduce((sum, row) => sum + (row.avgLoad || 0), 0) / rows.length;

      return {
        hour,
        otp,
        boardings: rows.reduce((sum, row) => sum + (row.boardings || 0), 0),
        alightings: rows.reduce((sum, row) => sum + (row.alightings || 0), 0),
        avgLoad,
      };
    });
}

function sumHourlyArrays(arrays: Array<number[] | undefined>): number[] | undefined {
  const populated = arrays.filter((values): values is number[] => Array.isArray(values));
  if (populated.length === 0) return undefined;
  const length = Math.max(...populated.map(values => values.length));
  return Array.from({ length }, (_, index) =>
    populated.reduce((sum, values) => sum + (values[index] || 0), 0)
  );
}

function buildRouteScopedDwell(
  dwell: OperatorDwellMetrics | undefined,
  selectedRouteId: string,
): OperatorDwellMetrics | undefined {
  if (!dwell) return undefined;
  const incidents = dwell.incidents.filter(incident => routeMatches(incident.routeId, selectedRouteId));
  const byOperatorIncidents = new Map<string, typeof incidents>();
  for (const incident of incidents) {
    byOperatorIncidents.set(incident.operatorId, [
      ...(byOperatorIncidents.get(incident.operatorId) || []),
      incident,
    ]);
  }

  const byOperator = Array.from(byOperatorIncidents.entries()).map(([operatorId, rows]) => {
    const moderateCount = rows.filter(row => row.severity === 'moderate').length;
    const highCount = rows.filter(row => row.severity === 'high').length;
    const totalTrackedDwellSeconds = rows.reduce((sum, row) => sum + row.trackedDwellSeconds, 0);
    return {
      operatorId,
      moderateCount,
      highCount,
      totalIncidents: moderateCount + highCount,
      totalTrackedDwellSeconds,
      avgTrackedDwellSeconds: rows.length > 0 ? totalTrackedDwellSeconds / rows.length : 0,
    };
  }).sort((a, b) => b.totalTrackedDwellSeconds - a.totalTrackedDwellSeconds);

  const reportable = incidents.filter(row => row.severity === 'moderate' || row.severity === 'high');
  return {
    incidents,
    byOperator,
    totalIncidents: reportable.length,
    totalTrackedDwellMinutes: incidents.reduce((sum, row) => sum + row.trackedDwellSeconds, 0) / 60,
    totalReportableDwellMinutes: reportable.reduce((sum, row) => sum + row.trackedDwellSeconds, 0) / 60,
    // Stop visits and service hours are not stored by route. Omitting them is
    // safer than presenting system-wide denominators as route-specific rates.
    totalStopVisits: undefined,
    totalServiceHours: undefined,
    incidentsPer1kVisits: undefined,
    incidentsPer100ServiceHours: undefined,
  };
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
      ...(() => {
        const byRoute = day.missedTrips!.byRoute.filter(row => routeMatches(row.routeId, selectedRouteId));
        const trips = day.missedTrips!.trips?.filter(trip => routeMatches(trip.routeId, selectedRouteId));
        const hasCompleteTripDetails = (day.missedTrips!.trips?.length || 0) === day.missedTrips!.totalMissed;
        const totalMissed = byRoute.reduce((sum, row) => sum + row.count, 0);
        return {
          // The stored per-route schema has missed counts but no scheduled or
          // matched denominators. Clear those unavailable values rather than
          // leaking the system-wide missed-trip percentage into a route view.
          totalScheduled: 0,
          totalMatched: 0,
          totalMissed,
          missedPct: 0,
          notPerformedCount: hasCompleteTripDetails
            ? (trips || []).filter(trip => trip.missType === 'not_performed').length
            : 0,
          lateOver15Count: hasCompleteTripDetails
            ? (trips || []).filter(trip => trip.missType === 'late_over_15').length
            : 0,
          byRoute,
          trips,
        };
      })(),
    }
    : day.missedTrips;
  const byOperatorDwell = buildRouteScopedDwell(day.byOperatorDwell, selectedRouteId);
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
        const routeValues = routeBreakdown && routeBreakdown.length > 0
          ? {
            routeId: selectedRouteId,
            boardings: routeBreakdown.reduce((sum, row) => sum + (row.boardings || 0), 0),
            alightings: routeBreakdown.reduce((sum, row) => sum + (row.alightings || 0), 0),
            hourlyBoardings: sumHourlyArrays(routeBreakdown.map(row => row.hourlyBoardings)),
            hourlyAlightings: sumHourlyArrays(routeBreakdown.map(row => row.hourlyAlightings)),
          }
          : undefined;
        return {
          ...stop,
          routeCount: routeValues ? 1 : stop.routeCount,
          routes: stop.routes.filter(routeId => routeMatches(routeId, selectedRouteId)),
          routeBreakdown: routeValues ? [routeValues] : routeBreakdown,
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
      const canonicalRouteId = getMergedCanonicalRouteId(route.routeId);
      if (canonicalRouteId && !routeMap.has(canonicalRouteId)) {
        routeMap.set(canonicalRouteId, {
          routeId: canonicalRouteId,
          routeName: `Route ${canonicalRouteId}`,
        });
      }
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
