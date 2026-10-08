import { RouteMetrics } from './types';

export function apcDiscrepancyPctForRoute(route: RouteMetrics): number {
  if (typeof route.apcDiscrepancyPct === 'number') return route.apcDiscrepancyPct;
  const baseline = Math.max(route.ridership, route.alightings, 1);
  return Math.round((Math.abs(route.ridership - route.alightings) * 1000) / baseline) / 10;
}

export function apcStatusForRoute(route: RouteMetrics): 'ok' | 'review' | 'suspect' {
  if (route.apcStatus === 'review' || route.apcStatus === 'suspect' || route.apcStatus === 'ok') {
    return route.apcStatus;
  }
  const discrepancyPct = apcDiscrepancyPctForRoute(route);
  if (discrepancyPct >= 50) return 'suspect';
  if (discrepancyPct >= 25) return 'review';
  return 'ok';
}
