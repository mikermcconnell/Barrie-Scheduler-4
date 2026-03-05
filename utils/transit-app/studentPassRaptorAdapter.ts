/**
 * Student Pass RAPTOR Adapter
 *
 * Replaces the bespoke direct+transfer scanner in studentPassUtils.ts
 * with RAPTOR-based routing. Maps RAPTOR Itinerary → StudentPassResult.
 */

import { loadGtfsData } from '../routing/gtfsAdapter';
import { buildRoutingData } from '../routing/routingDataService';
import { buildServiceCalendar } from '../routing/calendarService';
import { planTripLocal } from '../routing/raptorEngine';
import { buildItinerary } from '../routing/itineraryBuilder';
import { getRouteColor } from '../config/routeColors';
import { RoutingError } from '../routing/types';
import type { RoutingData, Itinerary, Leg, TransitLeg } from '../routing/types';
import {
  findStopsInZone,
  findNearestStopToSchool,
  getPolygonCentroid,
  parseTimeToMinutes,
  minutesToDisplayTime,
  getTransferQuality,
  buildWalkLeg as buildStudentWalkLeg,
  getRouteShapeSegment,
} from './studentPassUtils';
import type {
  SchoolConfig,
  TripOptions,
  RouteOption,
  StudentPassResult,
  TripLeg,
  TransferInfo,
  RouteShapeSegment,
} from './studentPassUtils';
import { getAllStopsWithCoords } from '../gtfs/gtfsStopLookup';

// ─── Cached Routing Data ────────────────────────────────────────────

let cachedRoutingData: RoutingData | null = null;

function getRoutingData(): RoutingData {
  if (cachedRoutingData) return cachedRoutingData;

  const gtfsData = loadGtfsData();
  cachedRoutingData = buildRoutingData(gtfsData);
  return cachedRoutingData;
}

// ─── Itinerary → StudentPassResult Mapping ──────────────────────────

/**
 * Convert a RAPTOR Itinerary to the StudentPassResult TripLeg format.
 */
function itineraryToTripLegs(itin: Itinerary): TripLeg[] {
  const legs: TripLeg[] = [];

  for (const leg of itin.legs) {
    if (leg.mode !== 'BUS') continue;

    const transitLeg = leg as TransitLeg;
    const routeShortName = transitLeg.route.shortName;

    legs.push({
      routeShortName,
      routeColor: getRouteColor(routeShortName),
      tripId: transitLeg.tripId,
      fromStopId: transitLeg.from.stopId ?? '',
      toStopId: transitLeg.to.stopId ?? '',
      departureMinutes: unixMsToMinutes(transitLeg.startTime),
      arrivalMinutes: unixMsToMinutes(transitLeg.endTime),
      fromStop: transitLeg.from.name,
      toStop: transitLeg.to.name,
    });
  }

  return legs;
}

/**
 * Extract transfer info between consecutive transit legs.
 */
function extractTransfers(itin: Itinerary): TransferInfo[] {
  const transfers: TransferInfo[] = [];
  const transitLegs = itin.legs.filter((l): l is TransitLeg => l.mode === 'BUS');

  for (let i = 0; i < transitLegs.length - 1; i++) {
    const alightTime = transitLegs[i].endTime;
    const boardTime = transitLegs[i + 1].startTime;
    const waitMinutes = Math.round((boardTime - alightTime) / 60000);
    transfers.push(getTransferQuality(waitMinutes));
  }

  return transfers;
}

/**
 * Convert Unix ms timestamp to minutes from midnight.
 */
function unixMsToMinutes(unixMs: number): number {
  const d = new Date(unixMs);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Build route shape segments for display on the map.
 */
function buildRouteShapes(legs: TripLeg[], isDashedAfterFirst: boolean): RouteShapeSegment[] {
  const allStops = getAllStopsWithCoords();
  const stopById = new Map(allStops.map((s) => [s.stop_id, s]));
  const shapes: RouteShapeSegment[] = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const fromStop = stopById.get(leg.fromStopId);
    const toStop = stopById.get(leg.toStopId);
    if (fromStop && toStop) {
      const points = getRouteShapeSegment(
        leg.routeShortName,
        fromStop.lat, fromStop.lon,
        toStop.lat, toStop.lon
      );
      shapes.push({
        routeShortName: leg.routeShortName,
        routeColor: leg.routeColor,
        points,
        isDashed: isDashedAfterFirst && i > 0,
      });
    }
  }

  return shapes;
}

/**
 * Convert a RAPTOR Itinerary to a StudentPassResult.
 */
function itineraryToStudentPassResult(
  itin: Itinerary,
  polygon: [number, number][],
  school: SchoolConfig,
  direction: 'morning' | 'afternoon'
): StudentPassResult {
  const tripLegs = itineraryToTripLegs(itin);
  const transfers = extractTransfers(itin);
  const isDirect = tripLegs.length <= 1;

  const centroid = getPolygonCentroid(polygon);
  const allStops = getAllStopsWithCoords();
  const stopById = new Map(allStops.map((s) => [s.stop_id, s]));

  const morningLegs = direction === 'morning' ? tripLegs : [];
  const afternoonLegs = direction === 'afternoon' ? tripLegs : [];

  const result: StudentPassResult = {
    found: tripLegs.length > 0,
    isDirect,
    morningLegs,
    afternoonLegs,
    zoneCentroid: centroid,
  };

  // Transfer info
  if (transfers.length === 1) {
    result.transfer = transfers[0];
  } else if (transfers.length >= 2) {
    result.transfers = transfers;
  }

  // Walking legs and route shapes
  if (direction === 'morning' && morningLegs.length > 0) {
    const firstLeg = morningLegs[0];
    const lastLeg = morningLegs[morningLegs.length - 1];
    const boardingStop = stopById.get(firstLeg.fromStopId);
    const alightStop = stopById.get(lastLeg.toStopId);

    if (boardingStop) {
      result.walkToStop = buildStudentWalkLeg(
        centroid[0], centroid[1],
        boardingStop.lat, boardingStop.lon,
        `Walk to ${boardingStop.stop_name}`
      );
    }
    if (alightStop) {
      result.walkToSchool = buildStudentWalkLeg(
        alightStop.lat, alightStop.lon,
        school.lat, school.lon,
        `Walk to ${school.name}`
      );
    }
    result.routeShapes = buildRouteShapes(morningLegs, true);
  }

  if (direction === 'afternoon' && afternoonLegs.length > 0) {
    const firstLeg = afternoonLegs[0];
    const lastLeg = afternoonLegs[afternoonLegs.length - 1];
    const boardStop = stopById.get(firstLeg.fromStopId);
    const alightStop = stopById.get(lastLeg.toStopId);

    if (boardStop) {
      result.walkFromSchool = buildStudentWalkLeg(
        school.lat, school.lon,
        boardStop.lat, boardStop.lon,
        `Walk to ${boardStop.stop_name}`
      );
    }
    if (alightStop) {
      result.walkToZone = buildStudentWalkLeg(
        alightStop.lat, alightStop.lon,
        centroid[0], centroid[1],
        'Walk home'
      );
    }
    result.afternoonRouteShapes = buildRouteShapes(afternoonLegs, false);
  }

  return result;
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Find trip options using RAPTOR engine.
 * Replaces the bespoke findTripOptions() scanner.
 */
export function findTripOptionsRaptor(
  zonePolygon: [number, number][],
  school: SchoolConfig
): TripOptions {
  const routingData = getRoutingData();
  const centroid = getPolygonCentroid(zonePolygon);
  const bellStartMinutes = parseTimeToMinutes(school.bellStart + ':00');
  const bellEndMinutes = parseTimeToMinutes(school.bellEnd + ':00');

  // Use a weekday within the GTFS validity range for service calendar
  // The calendar was built with a reference date in buildRoutingData
  const queryDate = getQueryDate(routingData);

  // ── Morning: zone → school (arrive before bell) ──
  // Search departing 90 min before bell, filter results arriving before bell
  const morningDepartMinutes = Math.max(0, bellStartMinutes - 90);
  const morningTime = new Date(queryDate);
  morningTime.setHours(0, 0, 0, 0);
  morningTime.setMinutes(morningDepartMinutes);

  const morningItineraries = runRaptorSafe(
    centroid[0], centroid[1],
    school.lat, school.lon,
    queryDate, morningTime,
    routingData
  );

  // Filter: must arrive before bell (with 5-min grace)
  const bellCutoffMs = new Date(queryDate).setHours(0, 0, 0, 0) + bellStartMinutes * 60000 + 5 * 60000;
  const validMorning = morningItineraries.filter((itin) => itin.endTime <= bellCutoffMs);

  // Sort by latest arrival (closest to bell = least waiting)
  validMorning.sort((a, b) => b.endTime - a.endTime);

  // ── Afternoon: school → zone (depart after bell) ──
  const afternoonTime = new Date(queryDate);
  afternoonTime.setHours(0, 0, 0, 0);
  afternoonTime.setMinutes(bellEndMinutes);

  const afternoonItineraries = runRaptorSafe(
    school.lat, school.lon,
    centroid[0], centroid[1],
    queryDate, afternoonTime,
    routingData
  );

  // Sort by earliest departure
  afternoonItineraries.sort((a, b) => a.startTime - b.startTime);

  // ── Build morning options (up to 3) ──
  const morningOptions: RouteOption[] = [];
  const seenMorningRoutes = new Set<string>();

  for (const itin of validMorning) {
    if (morningOptions.length >= 3) break;

    const routeKey = getRouteKey(itin);
    if (seenMorningRoutes.has(routeKey)) continue;
    seenMorningRoutes.add(routeKey);

    const spResult = itineraryToStudentPassResult(itin, zonePolygon, school, 'morning');

    // Add first afternoon leg to morning result for preview
    if (afternoonItineraries.length > 0) {
      const pmItin = afternoonItineraries[0];
      const pmLegs = itineraryToTripLegs(pmItin);
      if (pmLegs.length > 0) {
        spResult.afternoonLegs = pmLegs;
        spResult.nextAfternoonDepartureMinutes = pmLegs[0].departureMinutes;
      }
    }

    const transitLegs = spResult.morningLegs;
    const isDirect = transitLegs.length <= 1;
    const lastLeg = transitLegs[transitLegs.length - 1];
    const arrivalStr = lastLeg ? minutesToDisplayTime(lastLeg.arrivalMinutes) : '';
    const routeNames = transitLegs.map((l) => l.routeShortName).join('→');

    morningOptions.push({
      id: `am-${morningOptions.length + 1}`,
      label: isDirect
        ? `Rt ${routeNames} Direct — arrive ${arrivalStr}`
        : `Rt ${routeNames} Transfer — arrive ${arrivalStr}`,
      result: spResult,
    });
  }

  // ── Build afternoon options (up to 3) ──
  const afternoonOptions: RouteOption[] = [];
  const seenAfternoonRoutes = new Set<string>();

  for (const itin of afternoonItineraries) {
    if (afternoonOptions.length >= 3) break;

    const routeKey = getRouteKey(itin);
    if (seenAfternoonRoutes.has(routeKey)) continue;
    seenAfternoonRoutes.add(routeKey);

    const spResult = itineraryToStudentPassResult(itin, zonePolygon, school, 'afternoon');

    // Copy morning legs from first morning option for preview
    if (morningOptions.length > 0) {
      spResult.morningLegs = morningOptions[0].result.morningLegs;
      spResult.routeShapes = morningOptions[0].result.routeShapes;
      spResult.walkToStop = morningOptions[0].result.walkToStop;
      spResult.walkToSchool = morningOptions[0].result.walkToSchool;
    }

    const pmLegs = spResult.afternoonLegs;
    const firstPmLeg = pmLegs[0];
    const departStr = firstPmLeg ? minutesToDisplayTime(firstPmLeg.departureMinutes) : '';

    // Find next bus departure
    const nextItin = afternoonItineraries.find((it) => it.startTime > itin.startTime);
    if (nextItin) {
      const nextLegs = itineraryToTripLegs(nextItin);
      if (nextLegs.length > 0) {
        spResult.nextAfternoonDepartureMinutes = nextLegs[0].departureMinutes;
      }
    }

    afternoonOptions.push({
      id: `pm-${afternoonOptions.length + 1}`,
      label: firstPmLeg
        ? `Rt ${firstPmLeg.routeShortName} — depart ${departStr}`
        : 'No afternoon service',
      result: spResult,
    });
  }

  return { morningOptions, afternoonOptions };
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Run RAPTOR safely, catching RoutingError and returning empty array.
 */
function runRaptorSafe(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  date: Date, time: Date,
  routingData: RoutingData
): Itinerary[] {
  try {
    const results = planTripLocal({
      fromLat, fromLon, toLat, toLon,
      date, time, routingData,
    });

    return results.map((r) =>
      buildItinerary(r, routingData, date, fromLat, fromLon, toLat, toLon)
    );
  } catch (e) {
    if (e instanceof RoutingError) return [];
    throw e;
  }
}

/**
 * Get a unique key for the route combination in an itinerary.
 */
function getRouteKey(itin: Itinerary): string {
  return itin.legs
    .filter((l): l is TransitLeg => l.mode === 'BUS')
    .map((l) => `${l.route.shortName}-${l.tripId}`)
    .join('|');
}

/**
 * Get a valid query date within the service calendar range.
 * Finds the first weekday with active services.
 */
function getQueryDate(routingData: RoutingData): Date {
  const calendar = routingData.serviceCalendar;
  const dateStrs = Object.keys(calendar).sort();

  for (const dateStr of dateStrs) {
    const services = calendar[dateStr];
    if (services && services.size > 0) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1;
      const day = parseInt(dateStr.substring(6, 8), 10);
      const d = new Date(year, month, day);
      const dow = d.getDay();
      // Prefer weekdays (Mon-Fri)
      if (dow >= 1 && dow <= 5) return d;
    }
  }

  // Fallback: use first date with services
  for (const dateStr of dateStrs) {
    const services = calendar[dateStr];
    if (services && services.size > 0) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10) - 1;
      const day = parseInt(dateStr.substring(6, 8), 10);
      return new Date(year, month, day);
    }
  }

  return new Date();
}
