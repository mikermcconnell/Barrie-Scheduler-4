import type { DailySummary, DwellCascade } from '../performanceDataTypes';

export interface CascadeLateTripsByRouteRow {
  routeId: string;
  routeName: string;
  totalTrips: number;
  cascadeCausedTrips: number;
  otpPenaltyPp: number;
}

export interface CascadeLateDepartureImpactRow {
  routeId: string;
  routeName: string;
  lateDepartures: number;
  assessedDepartures: number;
  penaltyPct: number;
}

export function buildCascadeLateTripsByRoute(
  cascades: DwellCascade[],
  dailySummaries: DailySummary[],
): CascadeLateTripsByRouteRow[] {
  const routeMap = new Map<string, { routeId: string; routeName: string; totalTrips: number }>();
  for (const day of dailySummaries) {
    for (const route of day.byRoute ?? []) {
      const existing = routeMap.get(route.routeId);
      if (existing) {
        existing.totalTrips += route.tripCount;
      } else {
        routeMap.set(route.routeId, {
          routeId: route.routeId,
          routeName: route.routeName,
          totalTrips: route.tripCount,
        });
      }
    }
  }

  const uniqueLateTripsByRoute = new Map<string, Set<string>>();
  for (const cascade of cascades) {
    for (const trip of cascade.cascadedTrips) {
      if (trip.otpStatus !== 'late') continue;
      const tripKey = `${cascade.date}||${trip.tripId}`;
      const routeTrips = uniqueLateTripsByRoute.get(trip.routeId);
      if (routeTrips) routeTrips.add(tripKey);
      else uniqueLateTripsByRoute.set(trip.routeId, new Set([tripKey]));
    }
  }

  const rows: CascadeLateTripsByRouteRow[] = [];
  for (const [routeId, tripKeys] of uniqueLateTripsByRoute.entries()) {
    const routeInfo = routeMap.get(routeId);
    if (!routeInfo || tripKeys.size === 0) continue;

    rows.push({
      routeId,
      routeName: routeInfo.routeName,
      totalTrips: routeInfo.totalTrips,
      cascadeCausedTrips: tripKeys.size,
      otpPenaltyPp: routeInfo.totalTrips > 0 ? (tripKeys.size / routeInfo.totalTrips) * 100 : 0,
    });
  }

  return rows.sort((a, b) => b.otpPenaltyPp - a.otpPenaltyPp || b.cascadeCausedTrips - a.cascadeCausedTrips);
}

export function buildCascadeLateDepartureImpactByRoute(
  cascade: DwellCascade,
  dailySummaries: DailySummary[],
): CascadeLateDepartureImpactRow[] {
  const routeTotals = new Map<string, { routeName: string; assessedDepartures: number }>();
  for (const day of dailySummaries) {
    for (const route of day.byRoute ?? []) {
      const existing = routeTotals.get(route.routeId);
      if (existing) {
        existing.assessedDepartures += route.otp?.total ?? 0;
      } else {
        routeTotals.set(route.routeId, {
          routeName: route.routeName,
          assessedDepartures: route.otp?.total ?? 0,
        });
      }
    }
  }

  const lateDeparturesByRoute = new Map<string, { routeName: string; lateDepartures: number }>();
  for (const trip of cascade.cascadedTrips) {
    if (trip.lateTimepointCount <= 0) continue;
    const existing = lateDeparturesByRoute.get(trip.routeId);
    if (existing) {
      existing.lateDepartures += trip.lateTimepointCount;
    } else {
      lateDeparturesByRoute.set(trip.routeId, {
        routeName: trip.routeName,
        lateDepartures: trip.lateTimepointCount,
      });
    }
  }

  const rows: CascadeLateDepartureImpactRow[] = [];
  for (const [routeId, impact] of lateDeparturesByRoute.entries()) {
    const totals = routeTotals.get(routeId);
    const assessedDepartures = totals?.assessedDepartures ?? 0;
    rows.push({
      routeId,
      routeName: totals?.routeName ?? impact.routeName,
      lateDepartures: impact.lateDepartures,
      assessedDepartures,
      penaltyPct: assessedDepartures > 0 ? (impact.lateDepartures / assessedDepartures) * 100 : 0,
    });
  }

  return rows.sort((a, b) => b.lateDepartures - a.lateDepartures || a.routeId.localeCompare(b.routeId));
}
