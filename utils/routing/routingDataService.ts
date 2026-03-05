// Routing Data Service — builds pre-computed indexes for RAPTOR
// Ported from BTTP src/services/routingDataService.js

import { ROUTING_CONFIG } from './constants';
import { buildServiceCalendar } from './calendarService';
import { haversineDistance } from './geometryUtils';
import type {
  GtfsStop,
  GtfsTrip,
  GtfsStopTime,
  GtfsData,
  RoutingData,
  Departure,
  Transfer,
  NearbyStop,
  ServiceCalendar,
  CalendarEntry,
} from './types';

/**
 * Derive reference date and window size from GTFS calendar entries.
 * Ensures the service calendar covers the full GTFS validity period.
 */
function getCalendarSpan(calendar: CalendarEntry[]): { referenceDate: Date; daysAhead: number } {
  if (calendar.length === 0) {
    return { referenceDate: new Date(), daysAhead: 30 };
  }

  const startDates = calendar.map((c) => c.startDate).sort();
  const endDates = calendar.map((c) => c.endDate).sort();

  const earliest = startDates[0];
  const latest = endDates[endDates.length - 1];

  const refYear = parseInt(earliest.substring(0, 4), 10);
  const refMonth = parseInt(earliest.substring(4, 6), 10) - 1;
  const refDay = parseInt(earliest.substring(6, 8), 10);
  const referenceDate = new Date(refYear, refMonth, refDay);

  const endYear = parseInt(latest.substring(0, 4), 10);
  const endMonth = parseInt(latest.substring(4, 6), 10) - 1;
  const endDay = parseInt(latest.substring(6, 8), 10);
  const endDate = new Date(endYear, endMonth, endDay);

  const daysAhead = Math.ceil((endDate.getTime() - referenceDate.getTime()) / 86400000) + 1;

  return { referenceDate, daysAhead };
}

/**
 * Build stop departures index.
 * Maps each stop to all departures from that stop, sorted by time.
 */
export function buildStopDeparturesIndex(
  stopTimes: GtfsStopTime[],
  trips: GtfsTrip[]
): Record<string, Departure[]> {
  const index: Record<string, Departure[]> = {};

  const tripMap: Record<string, GtfsTrip> = {};
  for (const trip of trips) {
    tripMap[trip.tripId] = trip;
  }

  for (const st of stopTimes) {
    if (st.departureTime == null) continue;

    const trip = tripMap[st.tripId];
    if (!trip) continue;

    if (!index[st.stopId]) {
      index[st.stopId] = [];
    }

    index[st.stopId].push({
      tripId: st.tripId,
      routeId: trip.routeId,
      serviceId: trip.serviceId,
      directionId: trip.directionId,
      headsign: trip.headsign,
      departureTime: st.departureTime,
      arrivalTime: st.arrivalTime,
      stopSequence: st.stopSequence,
      pickupType: st.pickupType,
    });
  }

  // Sort each stop's departures by time
  for (const stopId of Object.keys(index)) {
    index[stopId].sort((a, b) => a.departureTime - b.departureTime);
  }

  return index;
}

/**
 * Build route stop sequences.
 * Maps each route+direction to an ordered list of stop IDs.
 */
export function buildRouteStopSequences(
  stopTimes: GtfsStopTime[],
  trips: GtfsTrip[]
): Record<string, Record<string, string[]>> {
  const sequences: Record<string, Record<string, string[]>> = {};

  const tripMap: Record<string, GtfsTrip> = {};
  for (const trip of trips) {
    tripMap[trip.tripId] = trip;
  }

  // Group stop times by trip
  const tripStops: Record<string, { stopId: string; sequence: number }[]> = {};
  for (const st of stopTimes) {
    if (!tripStops[st.tripId]) {
      tripStops[st.tripId] = [];
    }
    tripStops[st.tripId].push({
      stopId: st.stopId,
      sequence: st.stopSequence,
    });
  }

  // For each trip, extract the stop sequence (first trip per route-direction is canonical)
  for (const tripId of Object.keys(tripStops)) {
    const trip = tripMap[tripId];
    if (!trip) continue;

    const routeId = trip.routeId;
    const directionId = String(trip.directionId);

    tripStops[tripId].sort((a, b) => a.sequence - b.sequence);
    const stopSequence = tripStops[tripId].map((s) => s.stopId);

    if (!sequences[routeId]) {
      sequences[routeId] = {};
    }
    if (!sequences[routeId][directionId]) {
      sequences[routeId][directionId] = stopSequence;
    }
  }

  return sequences;
}

/**
 * Build transfer graph (walking connections between nearby stops).
 * Uses a grid-based spatial index for O(n) performance instead of O(n²).
 */
export function buildTransferGraph(
  stops: GtfsStop[],
  maxWalkMeters: number = ROUTING_CONFIG.MAX_WALK_FOR_TRANSFER
): Record<string, Transfer[]> {
  const transfers: Record<string, Transfer[]> = {};
  const walkSpeed = ROUTING_CONFIG.WALK_SPEED;
  const buffer = ROUTING_CONFIG.WALK_DISTANCE_BUFFER;

  // Build spatial grid index (~500m cells at mid-latitudes)
  const gridSize = 0.005;
  const grid: Record<string, GtfsStop[]> = {};

  for (const stop of stops) {
    const gridX = Math.floor(stop.lon / gridSize);
    const gridY = Math.floor(stop.lat / gridSize);
    const key = `${gridX},${gridY}`;
    if (!grid[key]) {
      grid[key] = [];
    }
    grid[key].push(stop);
  }

  // For each stop, find nearby stops in adjacent grid cells
  for (const stop of stops) {
    transfers[stop.stopId] = [];

    const gridX = Math.floor(stop.lon / gridSize);
    const gridY = Math.floor(stop.lat / gridSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gridX + dx},${gridY + dy}`;
        const nearby = grid[key] || [];

        for (const other of nearby) {
          if (other.stopId === stop.stopId) continue;

          const distance = haversineDistance(stop.lat, stop.lon, other.lat, other.lon);

          if (distance <= maxWalkMeters) {
            const walkDistance = distance * buffer;
            const walkSeconds = Math.round(walkDistance / walkSpeed);

            transfers[stop.stopId].push({
              toStopId: other.stopId,
              walkMeters: Math.round(distance),
              walkSeconds,
            });
          }
        }
      }
    }

    transfers[stop.stopId].sort((a, b) => a.walkMeters - b.walkMeters);
  }

  return transfers;
}

/** Find stops near a given coordinate */
export function findNearbyStops(
  stops: GtfsStop[],
  lat: number,
  lon: number,
  maxMeters: number = ROUTING_CONFIG.MAX_WALK_TO_TRANSIT
): NearbyStop[] {
  const walkSpeed = ROUTING_CONFIG.WALK_SPEED;
  const buffer = ROUTING_CONFIG.WALK_DISTANCE_BUFFER;
  const nearby: NearbyStop[] = [];

  for (const stop of stops) {
    const distance = haversineDistance(lat, lon, stop.lat, stop.lon);

    if (distance <= maxMeters) {
      const walkDistance = distance * buffer;
      nearby.push({
        stop,
        walkMeters: Math.round(distance),
        walkSeconds: Math.round(walkDistance / walkSpeed),
      });
    }
  }

  nearby.sort((a, b) => a.walkMeters - b.walkMeters);
  return nearby;
}

/** Build trip index for fast lookup by tripId */
export function buildTripIndex(trips: GtfsTrip[]): Record<string, GtfsTrip> {
  const index: Record<string, GtfsTrip> = {};
  for (const trip of trips) {
    index[trip.tripId] = trip;
  }
  return index;
}

/** Build stop index for fast lookup by stopId */
export function buildStopIndex(stops: GtfsStop[]): Record<string, GtfsStop> {
  const index: Record<string, GtfsStop> = {};
  for (const stop of stops) {
    index[stop.stopId] = stop;
  }
  return index;
}

/** Build index mapping each stop to routes that serve it */
export function buildStopRoutesIndex(
  stopDepartures: Record<string, Departure[]>
): Record<string, Set<string>> {
  const index: Record<string, Set<string>> = {};

  for (const stopId of Object.keys(stopDepartures)) {
    const routes = new Set<string>();
    for (const dep of stopDepartures[stopId]) {
      routes.add(dep.routeId);
    }
    index[stopId] = routes;
  }

  return index;
}

/** Build O(1) stop time lookup by compound key "tripId_stopId" */
export function buildStopTimesIndex(
  stopTimes: GtfsStopTime[]
): Record<string, GtfsStopTime> {
  const index: Record<string, GtfsStopTime> = {};
  for (const st of stopTimes) {
    const key = `${st.tripId}_${st.stopId}`;
    index[key] = st;
  }
  return index;
}

/**
 * Build trip stop times index: tripId → stop times sorted by sequence.
 * Essential for loop routes where a trip visits the same stop twice.
 */
export function buildTripStopTimesIndex(
  stopTimes: GtfsStopTime[]
): Record<string, GtfsStopTime[]> {
  const index: Record<string, GtfsStopTime[]> = {};
  for (const st of stopTimes) {
    if (!index[st.tripId]) {
      index[st.tripId] = [];
    }
    index[st.tripId].push(st);
  }
  // Sort each trip's stop times by sequence
  for (const tripId of Object.keys(index)) {
    index[tripId].sort((a, b) => a.stopSequence - b.stopSequence);
  }
  return index;
}

/** Build complete routing data structures from GTFS data */
export function buildRoutingData(gtfsData: GtfsData): RoutingData {
  const { stops, trips, stopTimes, calendar, calendarDates } = gtfsData;

  const stopDepartures = buildStopDeparturesIndex(stopTimes, trips);
  const routeStopSequences = buildRouteStopSequences(stopTimes, trips);
  const transfers = buildTransferGraph(stops);
  const tripIndex = buildTripIndex(trips);
  const stopIndex = buildStopIndex(stops);
  const stopRoutes = buildStopRoutesIndex(stopDepartures);

  // Derive reference date and window from GTFS calendar validity range
  // so the service calendar covers the full GTFS dataset regardless of today's date
  const { referenceDate, daysAhead } = getCalendarSpan(calendar);
  const serviceCalendar = buildServiceCalendar(calendar, calendarDates, daysAhead, referenceDate);
  const stopTimesIndex = buildStopTimesIndex(stopTimes);
  const tripStopTimes = buildTripStopTimesIndex(stopTimes);

  return {
    stopDepartures,
    routeStopSequences,
    transfers,
    tripIndex,
    stopIndex,
    stopRoutes,
    serviceCalendar,
    stopTimesIndex,
    tripStopTimes,
    stops,
    trips,
    stopTimes,
  };
}

/**
 * Get departures from a stop after a given time, filtered by active services.
 * Departures are pre-sorted by time, so we scan linearly.
 */
export function getDeparturesAfter(
  stopDepartures: Record<string, Departure[]>,
  stopId: string,
  afterTime: number,
  activeServices: Set<string>,
  limit = 10
): Departure[] {
  const departures = stopDepartures[stopId] || [];
  const results: Departure[] = [];

  for (const dep of departures) {
    if (dep.departureTime >= afterTime && activeServices.has(dep.serviceId)) {
      results.push(dep);
      if (results.length >= limit) break;
    }
  }

  return results;
}

/**
 * Find the next departure from a stop for a specific route.
 */
export function getNextDepartureForRoute(
  stopDepartures: Record<string, Departure[]>,
  stopId: string,
  routeId: string,
  afterTime: number,
  activeServices: Set<string>
): Departure | null {
  const departures = stopDepartures[stopId] || [];

  for (const dep of departures) {
    if (
      dep.departureTime >= afterTime &&
      dep.routeId === routeId &&
      activeServices.has(dep.serviceId)
    ) {
      return dep;
    }
  }

  return null;
}
