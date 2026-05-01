import { getAllStopsWithCoords, type GtfsStopWithCoords } from '../gtfs/gtfsStopLookup';
import type { RoutePlanner2Stop } from './routePlanner2Types';

export type RoutePlanner2StopMatchQuality = 'exact-code' | 'name' | 'nearby';

export interface RoutePlanner2GtfsStopMatch {
  routePlannerStopId: string;
  gtfsStopId: string;
  gtfsStopName: string;
  quality: RoutePlanner2StopMatchQuality;
  distanceMeters?: number;
}

const NEARBY_STOP_MAX_METERS = 100;
const EARTH_RADIUS_METERS = 6371000;

function normalize(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function getDistanceMeters(
  routePlannerStop: RoutePlanner2Stop,
  gtfsStop: GtfsStopWithCoords,
): number {
  const dLat = toRadians(gtfsStop.lat - routePlannerStop.lat);
  const dLon = toRadians(gtfsStop.lon - routePlannerStop.lng);
  const lat1 = toRadians(routePlannerStop.lat);
  const lat2 = toRadians(gtfsStop.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function toMatch(
  stop: RoutePlanner2Stop,
  gtfsStop: GtfsStopWithCoords,
  quality: RoutePlanner2StopMatchQuality,
  distanceMeters?: number,
): RoutePlanner2GtfsStopMatch {
  return {
    routePlannerStopId: stop.id,
    gtfsStopId: gtfsStop.stop_id,
    gtfsStopName: gtfsStop.stop_name,
    quality,
    ...(distanceMeters === undefined ? {} : { distanceMeters }),
  };
}

export function matchRoutePlanner2StopToGtfsStop(
  stop: RoutePlanner2Stop,
  gtfsStops: readonly GtfsStopWithCoords[] = getAllStopsWithCoords(),
): RoutePlanner2GtfsStopMatch | null {
  const stopCode = normalize(stop.stopCode);

  if (stopCode) {
    const byCode = gtfsStops.find((gtfsStop) => (
      normalize(gtfsStop.stop_id) === stopCode
      || normalize(gtfsStop.stop_code) === stopCode
    ));

    if (byCode) {
      return toMatch(stop, byCode, 'exact-code');
    }
  }

  const stopName = normalize(stop.name);

  if (stopName) {
    const byName = gtfsStops.find((gtfsStop) => normalize(gtfsStop.stop_name) === stopName);

    if (byName) {
      return toMatch(stop, byName, 'name');
    }
  }

  let nearestStop: GtfsStopWithCoords | null = null;
  let nearestDistanceMeters = NEARBY_STOP_MAX_METERS;

  for (const gtfsStop of gtfsStops) {
    const distanceMeters = getDistanceMeters(stop, gtfsStop);

    if (distanceMeters <= nearestDistanceMeters) {
      nearestStop = gtfsStop;
      nearestDistanceMeters = distanceMeters;
    }
  }

  if (!nearestStop) {
    return null;
  }

  return toMatch(stop, nearestStop, 'nearby', nearestDistanceMeters);
}
