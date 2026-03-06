/**
 * Student Pass RAPTOR Adapter
 *
 * Replaces the bespoke direct+transfer scanner in studentPassUtils.ts
 * with RAPTOR-based routing. Maps RAPTOR Itinerary → StudentPassResult.
 */

import { buildRoutingData } from '../routing/routingDataService';
import { loadGtfsData } from '../routing/gtfsAdapter';
import { getActiveServicesForDate } from '../routing/calendarService';
import { ROUTING_CONFIG } from '../routing/constants';
import { planTripLocal } from '../routing/raptorEngine';
import { buildItinerary } from '../routing/itineraryBuilder';
import { getWalkingDirections } from '../routing/walkingService';
import { getRouteColor } from '../config/routeColors';
import { RoutingError } from '../routing/types';
import type { RoutingData, Itinerary, TransitLeg } from '../routing/types';
import { decodePolyline } from '../../components/shared/mapUtils';
import {
  findStopsInZone,
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
  WalkLeg,
  ZoneStopOption,
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

export interface StudentPassServiceDateInfo {
  minDate: string;
  maxDate: string;
  defaultDate: string;
  defaultDateWarning: string | null;
}

export interface StudentPassSearchParams {
  serviceDate?: Date;
  zoneStopId?: string | null;
  zoneOrigin?: [number, number] | null;
}

interface StopSearchResult {
  zoneStop: ZoneStopOption;
  validMorning: Itinerary[];
  afternoonItineraries: Itinerary[];
}

interface AfternoonCandidate {
  itinerary: Itinerary;
  zoneStop: ZoneStopOption;
  allItinerariesForStop: Itinerary[];
}

const AUTO_SEARCH_STOP_LIMIT = 8;
const STUDENT_SOFT_WALK_LIMIT_MINUTES = 8;
const STUDENT_HARD_WALK_LIMIT_MINUTES = 15;
const STUDENT_WALK_PENALTY_PER_MINUTE = 3;
const STUDENT_TRANSFER_PENALTY_MINUTES = 10;
const STUDENT_WAIT_PENALTY_DIVISOR = 2;

function normalizeDate(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromServiceKey(dateStr: string): Date {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);
  return new Date(year, month, day);
}

function isWeekday(date: Date): boolean {
  const dow = date.getDay();
  return dow >= 1 && dow <= 5;
}

function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function getActiveServiceDates(routingData: RoutingData): Date[] {
  return Object.keys(routingData.serviceCalendar)
    .filter((dateStr) => routingData.serviceCalendar[dateStr]?.size > 0)
    .sort()
    .map(fromServiceKey);
}

function pickDefaultServiceDate(routingData: RoutingData, referenceDate: Date): Date {
  const activeDates = getActiveServiceDates(routingData);
  if (activeDates.length === 0) return normalizeDate(referenceDate);

  const target = normalizeDate(referenceDate).getTime();
  const weekdayDates = activeDates.filter(isWeekday);
  const candidates = weekdayDates.length > 0 ? weekdayDates : activeDates;

  for (let i = candidates.length - 1; i >= 0; i--) {
    if (normalizeDate(candidates[i]).getTime() <= target) {
      return normalizeDate(candidates[i]);
    }
  }

  return normalizeDate(candidates[0]);
}

export function getStudentPassServiceDateInfo(referenceDate = new Date()): StudentPassServiceDateInfo {
  const routingData = getRoutingData();
  const activeDates = getActiveServiceDates(routingData);
  if (activeDates.length === 0) {
    const fallback = normalizeDate(referenceDate);
    return {
      minDate: toInputDate(fallback),
      maxDate: toInputDate(fallback),
      defaultDate: toInputDate(fallback),
      defaultDateWarning: 'No active GTFS service dates are available in the bundled feed.',
    };
  }

  const minDate = normalizeDate(activeDates[0]);
  const maxDate = normalizeDate(activeDates[activeDates.length - 1]);
  const preferred = pickDefaultServiceDate(routingData, referenceDate);
  const today = normalizeDate(referenceDate);

  let defaultDateWarning: string | null = null;
  if (preferred.getTime() !== today.getTime()) {
    defaultDateWarning = `GTFS feed covers ${formatDisplayDate(minDate)} to ${formatDisplayDate(maxDate)}. Using ${formatDisplayDate(preferred)} for Student Pass planning.`;
  }

  return {
    minDate: toInputDate(minDate),
    maxDate: toInputDate(maxDate),
    defaultDate: toInputDate(preferred),
    defaultDateWarning,
  };
}

function buildZoneStopCandidate(
  stopId: string,
  stopName: string,
  lat: number,
  lon: number,
  zoneOrigin: [number, number]
): ZoneStopOption {
  const walk = buildStudentWalkLeg(zoneOrigin[0], zoneOrigin[1], lat, lon, `Walk to ${stopName}`);
  return {
    stopId,
    stopName,
    lat,
    lon,
    distanceKm: walk.distanceKm,
    walkMinutes: walk.walkMinutes,
    morningOptionCount: 0,
    afternoonOptionCount: 0,
  };
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
  const transitLegIndices = itin.legs
    .map((leg, index) => ({ leg, index }))
    .filter((entry): entry is { leg: TransitLeg; index: number } => entry.leg.mode === 'BUS');

  for (let i = 0; i < transitLegIndices.length - 1; i++) {
    const current = transitLegIndices[i];
    const next = transitLegIndices[i + 1];
    const alightTime = current.leg.endTime;
    const boardTime = next.leg.startTime;
    const transferWalkMinutes = itin.legs
      .slice(current.index + 1, next.index)
      .filter((leg) => leg.mode === 'WALK')
      .reduce((sum, leg) => sum + Math.round(leg.duration / 60), 0);
    const waitMinutes = Math.max(0, Math.round((boardTime - alightTime) / 60000) - transferWalkMinutes);
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
  direction: 'morning' | 'afternoon',
  zoneStop: ZoneStopOption,
  zoneOrigin: [number, number]
): StudentPassResult {
  const tripLegs = itineraryToTripLegs(itin);
  const transfers = extractTransfers(itin);
  const isDirect = tripLegs.length <= 1;

  const allStops = getAllStopsWithCoords();
  const stopById = new Map(allStops.map((s) => [s.stop_id, s]));

  const morningLegs = direction === 'morning' ? tripLegs : [];
  const afternoonLegs = direction === 'afternoon' ? tripLegs : [];

  const result: StudentPassResult = {
    found: tripLegs.length > 0,
    isDirect,
    morningLegs,
    afternoonLegs,
    zoneCentroid: zoneOrigin,
  };

  // Transfer info
  if (direction === 'morning') {
    if (transfers.length === 1) {
      result.transfer = transfers[0];
      result.morningTransfer = transfers[0];
    } else if (transfers.length >= 2) {
      result.transfers = transfers;
      result.morningTransfers = transfers;
    }
  } else if (transfers.length === 1) {
    result.afternoonTransfer = transfers[0];
  } else if (transfers.length >= 2) {
    result.afternoonTransfers = transfers;
  }

  // Walking legs and route shapes
  if (direction === 'morning' && morningLegs.length > 0) {
    const lastLeg = morningLegs[morningLegs.length - 1];
    const alightStop = stopById.get(lastLeg.toStopId);

    result.walkToStop = buildStudentWalkLeg(
      zoneOrigin[0], zoneOrigin[1],
      zoneStop.lat, zoneStop.lon,
      `Walk to ${zoneStop.stopName}`
    );
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
    const boardStop = stopById.get(firstLeg.fromStopId);

    if (boardStop) {
      result.walkFromSchool = buildStudentWalkLeg(
        school.lat, school.lon,
        boardStop.lat, boardStop.lon,
        `Walk to ${boardStop.stop_name}`
      );
    }
    result.walkToZone = buildStudentWalkLeg(
      zoneStop.lat, zoneStop.lon,
      zoneOrigin[0], zoneOrigin[1],
      'Walk home'
    );
    result.afternoonRouteShapes = buildRouteShapes(afternoonLegs, false);
  }

  return result;
}

function computeFrequencyPerHour(
  firstLeg: TripLeg | undefined,
  routingData: RoutingData,
  activeServices: Set<string>
): number | undefined {
  if (!firstLeg) return undefined;
  const routeId = routingData.tripIndex[firstLeg.tripId]?.routeId;
  if (!routeId) return undefined;

  const departures = routingData.stopDepartures[firstLeg.fromStopId] || [];
  const windowStart = Math.max(0, firstLeg.departureMinutes * 60 - 1800);
  const windowEnd = firstLeg.departureMinutes * 60 + 1800;
  const matchingTripIds = new Set(
    departures
      .filter((dep) =>
        dep.routeId === routeId &&
        dep.departureTime >= windowStart &&
        dep.departureTime <= windowEnd &&
        activeServices.has(dep.serviceId)
      )
      .map((dep) => dep.tripId)
  );

  return matchingTripIds.size > 0 ? matchingTripIds.size : undefined;
}

function getBestMorningSortValue(itinerary: Itinerary): number {
  return itinerary.endTime;
}

function computeStudentWalkPenalty(walkMinutes: number): number {
  if (walkMinutes <= STUDENT_SOFT_WALK_LIMIT_MINUTES) return 0;

  const overSoft = walkMinutes - STUDENT_SOFT_WALK_LIMIT_MINUTES;
  const hardWalkPenalty = walkMinutes > STUDENT_HARD_WALK_LIMIT_MINUTES
    ? 40 + (walkMinutes - STUDENT_HARD_WALK_LIMIT_MINUTES) * 6
    : 0;

  return overSoft * STUDENT_WALK_PENALTY_PER_MINUTE + hardWalkPenalty;
}

function computeStudentTripPenalty(itinerary: Itinerary): number {
  const walkMinutes = itinerary.walkTime / 60;
  const waitMinutes = itinerary.waitingTime / 60;

  return (
    itinerary.transfers * STUDENT_TRANSFER_PENALTY_MINUTES +
    computeStudentWalkPenalty(walkMinutes) +
    waitMinutes / STUDENT_WAIT_PENALTY_DIVISOR
  );
}

function compareMorningItineraries(a: Itinerary, b: Itinerary): number {
  const penaltyCmp = computeStudentTripPenalty(a) - computeStudentTripPenalty(b);
  if (penaltyCmp !== 0) return penaltyCmp;

  const arrivalCmp = getBestMorningSortValue(b) - getBestMorningSortValue(a);
  if (arrivalCmp !== 0) return arrivalCmp;

  const durationCmp = a.duration - b.duration;
  if (durationCmp !== 0) return durationCmp;

  return a.startTime - b.startTime;
}

function compareAfternoonItineraries(a: Itinerary, b: Itinerary): number {
  const penaltyCmp = computeStudentTripPenalty(a) - computeStudentTripPenalty(b);
  if (penaltyCmp !== 0) return penaltyCmp;

  const departureCmp = a.startTime - b.startTime;
  if (departureCmp !== 0) return departureCmp;

  const transferCmp = a.transfers - b.transfers;
  if (transferCmp !== 0) return transferCmp;

  const walkCmp = a.walkTime - b.walkTime;
  if (walkCmp !== 0) return walkCmp;

  const durationCmp = a.duration - b.duration;
  if (durationCmp !== 0) return durationCmp;

  return a.startTime - b.startTime;
}

function buildStopSearchResults(
  zoneStops: ZoneStopOption[],
  school: SchoolConfig,
  queryDate: Date,
  routingData: RoutingData
): StopSearchResult[] {
  const bellStartMinutes = parseTimeToMinutes(school.bellStart + ':00');
  const bellEndMinutes = parseTimeToMinutes(school.bellEnd + ':00');
  const morningLookbackMinutes = Math.ceil(ROUTING_CONFIG.MAX_TRIP_DURATION / 60);

  return zoneStops.map((zoneStop) => {
    const morningTime = new Date(queryDate);
    morningTime.setHours(0, 0, 0, 0);
    morningTime.setMinutes(Math.max(0, bellStartMinutes - morningLookbackMinutes));

    const morningItineraries = runRaptorSafe(
      zoneStop.lat,
      zoneStop.lon,
      school.lat,
      school.lon,
      queryDate,
      morningTime,
      routingData,
      { originStopId: zoneStop.stopId }
    );

    const bellCutoffMs =
      new Date(queryDate).setHours(0, 0, 0, 0) +
      bellStartMinutes * 60000 +
      5 * 60000;
    const validMorning = morningItineraries
      .filter((itin) => itin.endTime <= bellCutoffMs)
      .sort(compareMorningItineraries);

    const afternoonTime = new Date(queryDate);
    afternoonTime.setHours(0, 0, 0, 0);
    afternoonTime.setMinutes(bellEndMinutes);

    const afternoonItineraries = runRaptorSafe(
      school.lat,
      school.lon,
      zoneStop.lat,
      zoneStop.lon,
      queryDate,
      afternoonTime,
      routingData,
      { destinationStopId: zoneStop.stopId }
    ).sort(compareAfternoonItineraries);
    const bestAfternoonDepartureMinutes = afternoonItineraries.length > 0
      ? Math.min(...afternoonItineraries.map((itin) => unixMsToMinutes(itin.startTime)))
      : undefined;

    return {
      zoneStop: {
        ...zoneStop,
        morningOptionCount: validMorning.length,
        afternoonOptionCount: afternoonItineraries.length,
        bestMorningArrivalMinutes: validMorning[0]
          ? unixMsToMinutes(validMorning[0].endTime)
          : undefined,
        bestAfternoonDepartureMinutes,
      },
      validMorning,
      afternoonItineraries,
    };
  });
}

function pickDefaultStopSearch(stopSearches: StopSearchResult[]): StopSearchResult | null {
  if (stopSearches.length === 0) return null;

  const ranked = [...stopSearches].sort((a, b) => {
    const aMorning = a.validMorning[0];
    const bMorning = b.validMorning[0];
    if (aMorning && bMorning) {
      const morningCmp = compareMorningItineraries(aMorning, bMorning);
      if (morningCmp !== 0) return morningCmp;
    } else if (aMorning || bMorning) {
      return aMorning ? -1 : 1;
    }

    if (a.afternoonItineraries[0] && b.afternoonItineraries[0]) {
      const pmCmp = compareAfternoonItineraries(a.afternoonItineraries[0], b.afternoonItineraries[0]);
      if (pmCmp !== 0) return pmCmp;
    } else if (a.afternoonItineraries[0] || b.afternoonItineraries[0]) {
      return a.afternoonItineraries[0] ? -1 : 1;
    }

    const walkPenaltyCmp =
      computeStudentWalkPenalty(a.zoneStop.walkMinutes) -
      computeStudentWalkPenalty(b.zoneStop.walkMinutes);
    if (walkPenaltyCmp !== 0) return walkPenaltyCmp;

    return a.zoneStop.walkMinutes - b.zoneStop.walkMinutes;
  });

  return ranked[0] ?? null;
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Find trip options using RAPTOR engine.
 * Replaces the bespoke findTripOptions() scanner.
 */
export function findTripOptionsRaptor(
  zonePolygon: [number, number][],
  school: SchoolConfig,
  params: StudentPassSearchParams = {}
): TripOptions {
  const routingData = getRoutingData();
  const serviceDateInfo = getStudentPassServiceDateInfo(params.serviceDate ?? new Date());
  const queryDate = params.serviceDate
    ? normalizeDate(params.serviceDate)
    : normalizeDate(new Date(`${serviceDateInfo.defaultDate}T00:00:00`));
  const zoneOrigin = params.zoneOrigin ?? getPolygonCentroid(zonePolygon);
  const zoneStopCandidates = findStopsInZone(zonePolygon)
    .map((stop) => buildZoneStopCandidate(stop.stop_id, stop.stop_name, stop.lat, stop.lon, zoneOrigin));

  if (zoneStopCandidates.length === 0) {
    return {
      morningOptions: [],
      afternoonOptions: [],
      zoneStops: [],
      selectedZoneStopId: null,
    };
  }

  const sortedZoneStops = [...zoneStopCandidates].sort((a, b) => a.walkMinutes - b.walkMinutes);
  const nearestStops = sortedZoneStops.slice(0, AUTO_SEARCH_STOP_LIMIT);
  const autoSearchStops = params.zoneStopId
    ? [
        ...(sortedZoneStops.find((stop) => stop.stopId === params.zoneStopId)
          ? [sortedZoneStops.find((stop) => stop.stopId === params.zoneStopId)!]
          : []),
        ...nearestStops.filter((stop) => stop.stopId !== params.zoneStopId),
      ]
    : nearestStops;
  const stopSearches = buildStopSearchResults(autoSearchStops, school, queryDate, routingData);
  const defaultStopSearch = pickDefaultStopSearch(stopSearches);
  const selectedStopSearch = (params.zoneStopId
    ? stopSearches.find((search) => search.zoneStop.stopId === params.zoneStopId)
    : null) ?? defaultStopSearch;

  if (!selectedStopSearch) {
    return {
      morningOptions: [],
      afternoonOptions: [],
      zoneStops: sortedZoneStops,
      selectedZoneStopId: null,
    };
  }

  const stopSearchById = new Map(stopSearches.map((search) => [search.zoneStop.stopId, search.zoneStop]));
  const zoneStops = [...sortedZoneStops]
    .map((stop) => stopSearchById.get(stop.stopId) ?? stop)
    .sort((a, b) => {
      if (b.morningOptionCount !== a.morningOptionCount) {
        return b.morningOptionCount - a.morningOptionCount;
      }
      if (b.afternoonOptionCount !== a.afternoonOptionCount) {
        return b.afternoonOptionCount - a.afternoonOptionCount;
      }
      return a.walkMinutes - b.walkMinutes;
    });

  const activeServices = getActiveServicesForDate(routingData.serviceCalendar, queryDate);

  const afternoonCandidates = stopSearches
    .flatMap((search): AfternoonCandidate[] =>
      search.afternoonItineraries.map((itinerary) => ({
        itinerary,
        zoneStop: search.zoneStop,
        allItinerariesForStop: search.afternoonItineraries,
      }))
    )
    .sort((a, b) => compareAfternoonItineraries(a.itinerary, b.itinerary));

  // ── Build morning options (up to 3) for the selected stop ──
  const morningOptions: RouteOption[] = [];
  const seenMorningRoutes = new Set<string>();

  for (const itin of selectedStopSearch.validMorning) {
    if (morningOptions.length >= 3) break;

    const routeKey = getRouteKey(itin);
    if (seenMorningRoutes.has(routeKey)) continue;
    seenMorningRoutes.add(routeKey);

    const spResult = itineraryToStudentPassResult(
      itin,
      zonePolygon,
      school,
      'morning',
      selectedStopSearch.zoneStop,
      zoneOrigin
    );
    spResult.frequencyPerHour = computeFrequencyPerHour(
      spResult.morningLegs[0],
      routingData,
      activeServices
    );

    // Add first afternoon leg to morning result for preview
    if (afternoonCandidates.length > 0) {
      const bestAfternoonCandidate = afternoonCandidates[0];
      const pmPreview = itineraryToStudentPassResult(
        bestAfternoonCandidate.itinerary,
        zonePolygon,
        school,
        'afternoon',
        bestAfternoonCandidate.zoneStop,
        zoneOrigin
      );
      if (pmPreview.afternoonLegs.length > 0) {
        spResult.afternoonLegs = pmPreview.afternoonLegs;
        spResult.afternoonRouteShapes = pmPreview.afternoonRouteShapes;
        spResult.walkFromSchool = pmPreview.walkFromSchool;
        spResult.walkToZone = pmPreview.walkToZone;
        spResult.afternoonTransfer = pmPreview.afternoonTransfer;
        spResult.afternoonTransfers = pmPreview.afternoonTransfers;
        spResult.nextAfternoonDepartureMinutes = pmPreview.afternoonLegs[0].departureMinutes;
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

  // ── Build afternoon options (up to 3) across candidate alighting stops ──
  const afternoonOptions: RouteOption[] = [];
  const seenAfternoonRoutes = new Set<string>();

  for (const candidate of afternoonCandidates) {
    if (afternoonOptions.length >= 3) break;

    const itin = candidate.itinerary;
    const routeKey = `${getRouteKey(itin)}|${candidate.zoneStop.stopId}`;
    if (seenAfternoonRoutes.has(routeKey)) continue;
    seenAfternoonRoutes.add(routeKey);

    const spResult = itineraryToStudentPassResult(
      itin,
      zonePolygon,
      school,
      'afternoon',
      candidate.zoneStop,
      zoneOrigin
    );

    // Copy morning legs from first morning option for preview
    if (morningOptions.length > 0) {
      spResult.morningLegs = morningOptions[0].result.morningLegs;
      spResult.routeShapes = morningOptions[0].result.routeShapes;
      spResult.walkToStop = morningOptions[0].result.walkToStop;
      spResult.walkToSchool = morningOptions[0].result.walkToSchool;
      spResult.transfer = morningOptions[0].result.transfer;
      spResult.transfers = morningOptions[0].result.transfers;
      spResult.morningTransfer = morningOptions[0].result.morningTransfer;
      spResult.morningTransfers = morningOptions[0].result.morningTransfers;
      spResult.frequencyPerHour = morningOptions[0].result.frequencyPerHour;
    }

    const pmLegs = spResult.afternoonLegs;
    const firstPmLeg = pmLegs[0];
    const departStr = firstPmLeg ? minutesToDisplayTime(firstPmLeg.departureMinutes) : '';

    // Find next bus departure
    const nextItin = candidate.allItinerariesForStop.find((it) => it.startTime > itin.startTime);
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

  return {
    morningOptions,
    afternoonOptions,
    zoneStops,
    selectedZoneStopId: selectedStopSearch.zoneStop.stopId,
  };
}

// ─── Walk Enrichment ─────────────────────────────────────────────────

/**
 * Enrich a StudentPassResult's walk legs with Mapbox street-level geometry.
 * Returns a new result with updated walk distances, times, and path coordinates.
 * Falls back gracefully to original data if Mapbox is unavailable.
 */
export async function enrichStudentPassWalks(
  result: StudentPassResult
): Promise<StudentPassResult> {
  if (!result.found) return result;

  const enriched = { ...result };

  const enrichWalk = async (
    walk: WalkLeg | undefined
  ): Promise<WalkLeg | undefined> => {
    if (!walk) return undefined;
    const directions = await getWalkingDirections(
      walk.fromLat, walk.fromLon, walk.toLat, walk.toLon
    );
    const geometry = directions.geometry
      ? decodePolyline(directions.geometry)
      : undefined;
    return {
      ...walk,
      distanceKm: directions.distance / 1000,
      walkMinutes: Math.round(directions.duration / 60),
      geometry,
    };
  };

  const [walkToStop, walkToSchool, walkFromSchool, walkToZone] =
    await Promise.all([
      enrichWalk(result.walkToStop),
      enrichWalk(result.walkToSchool),
      enrichWalk(result.walkFromSchool),
      enrichWalk(result.walkToZone),
    ]);

  if (walkToStop) enriched.walkToStop = walkToStop;
  if (walkToSchool) enriched.walkToSchool = walkToSchool;
  if (walkFromSchool) enriched.walkFromSchool = walkFromSchool;
  if (walkToZone) enriched.walkToZone = walkToZone;

  return enriched;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Run RAPTOR safely, catching RoutingError and returning empty array.
 */
function runRaptorSafe(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  date: Date, time: Date,
  routingData: RoutingData,
  stopSelection: { originStopId?: string; destinationStopId?: string } = {}
): Itinerary[] {
  try {
    const results = planTripLocal({
      fromLat, fromLon, toLat, toLon,
      date, time, routingData,
      originStopIds: stopSelection.originStopId ? [stopSelection.originStopId] : undefined,
      destinationStopIds: stopSelection.destinationStopId ? [stopSelection.destinationStopId] : undefined,
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
