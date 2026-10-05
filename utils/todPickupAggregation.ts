import type { TodDailyKpiDataset, TodDailyKpiLocation } from './todPickupTypes';
import type { StopMetrics } from './performanceDataTypes';

export type TodActivityMetric = 'activity' | 'pickups' | 'dropoffs';

export type StopActivitySource = 'fixed-route' | 'transit-on-demand' | 'combined';

export interface CombinedStopActivityLocation extends Pick<
  StopMetrics,
  | 'stopName'
  | 'stopId'
  | 'lat'
  | 'lon'
  | 'boardings'
  | 'alightings'
  | 'routeCount'
  | 'routes'
  | 'hourlyBoardings'
  | 'hourlyAlightings'
  | 'routeBreakdown'
> {
  activitySource: StopActivitySource;
  fixedRouteBoardings: number;
  fixedRouteAlightings: number;
  todPickups: number;
  todDropoffs: number;
}

type MutableLocation = TodDailyKpiLocation & {
  coordinateWeight: number;
  latWeightedSum: number;
  lonWeightedSum: number;
};

export function getTodActivityValue(
  location: TodDailyKpiLocation,
  metric: TodActivityMetric,
): number {
  if (metric === 'pickups') return location.pickups;
  if (metric === 'dropoffs') return location.dropoffs;
  return location.pickups + location.dropoffs;
}

function normalizedStopCode(value: string): string | null {
  const match = value.trim().match(/^(?:stop[-\s:]*)?(\d+)$/i);
  if (!match) return null;
  return String(Number(match[1]));
}

function todStopCode(location: TodDailyKpiLocation): string | null {
  return normalizedStopCode(location.id) ?? normalizedStopCode(location.name);
}

export function mergeTodIntoStopActivity(
  fixedRouteStops: StopMetrics[],
  todLocations: TodDailyKpiLocation[],
): CombinedStopActivityLocation[] {
  const merged = fixedRouteStops.map((stop): CombinedStopActivityLocation => ({
    stopName: stop.stopName,
    stopId: stop.stopId,
    lat: stop.lat,
    lon: stop.lon,
    boardings: stop.boardings,
    alightings: stop.alightings,
    routeCount: stop.routeCount,
    routes: stop.routes,
    hourlyBoardings: stop.hourlyBoardings,
    hourlyAlightings: stop.hourlyAlightings,
    routeBreakdown: stop.routeBreakdown,
    activitySource: 'fixed-route',
    fixedRouteBoardings: stop.boardings,
    fixedRouteAlightings: stop.alightings,
    todPickups: 0,
    todDropoffs: 0,
  }));
  const fixedIndexByStopCode = new Map<string, number>();

  merged.forEach((stop, index) => {
    const code = normalizedStopCode(stop.stopId);
    if (code && !fixedIndexByStopCode.has(code)) fixedIndexByStopCode.set(code, index);
  });

  for (const location of todLocations) {
    const code = todStopCode(location);
    const fixedIndex = code ? fixedIndexByStopCode.get(code) : undefined;
    if (fixedIndex !== undefined) {
      const stop = merged[fixedIndex];
      stop.boardings += location.pickups;
      stop.alightings += location.dropoffs;
      stop.todPickups += location.pickups;
      stop.todDropoffs += location.dropoffs;
      stop.activitySource = 'combined';
      continue;
    }

    merged.push({
      stopName: location.name,
      stopId: `tod:${location.id}`,
      lat: location.lat,
      lon: location.lon,
      boardings: location.pickups,
      alightings: location.dropoffs,
      routeCount: 0,
      routes: [],
      activitySource: 'transit-on-demand',
      fixedRouteBoardings: 0,
      fixedRouteAlightings: 0,
      todPickups: location.pickups,
      todDropoffs: location.dropoffs,
    });
  }

  return merged;
}

export function aggregateTodDailyLocations(
  reports: TodDailyKpiDataset[],
  includedDates: string[],
): TodDailyKpiLocation[] {
  const selectedDates = new Set(includedDates);
  const locations = new Map<string, MutableLocation>();

  for (const report of reports) {
    if (!selectedDates.has(report.date)) continue;

    for (const location of report.locations) {
      const coordinateWeight = Math.max(location.pickups + location.dropoffs, 1);
      const current = locations.get(location.id);
      if (current) {
        current.name = location.name;
        current.pickups += location.pickups;
        current.dropoffs += location.dropoffs;
        current.coordinateWeight += coordinateWeight;
        current.latWeightedSum += location.lat * coordinateWeight;
        current.lonWeightedSum += location.lon * coordinateWeight;
      } else {
        locations.set(location.id, {
          ...location,
          coordinateWeight,
          latWeightedSum: location.lat * coordinateWeight,
          lonWeightedSum: location.lon * coordinateWeight,
        });
      }
    }
  }

  return [...locations.values()]
    .map(({ coordinateWeight, latWeightedSum, lonWeightedSum, ...location }) => ({
      ...location,
      lat: latWeightedSum / coordinateWeight,
      lon: lonWeightedSum / coordinateWeight,
    }))
    .sort((a, b) => (
      (b.pickups + b.dropoffs) - (a.pickups + a.dropoffs)
      || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    ));
}
