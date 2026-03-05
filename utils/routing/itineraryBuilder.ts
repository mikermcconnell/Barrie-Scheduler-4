// Itinerary Builder — converts RaptorResult → Itinerary
// Ported from BTTP src/services/itineraryBuilder.js

import { ROUTING_CONFIG } from './constants';
import { haversineDistance } from './geometryUtils';
import type {
  RaptorResult,
  RoutingData,
  Itinerary,
  Leg,
  WalkLeg,
  TransitLeg,
  Place,
  RouteInfo,
  TransitSegment,
} from './types';

let itineraryCounter = 0;

function nextItineraryId(): string {
  return `itin_${++itineraryCounter}_${Date.now()}`;
}

/**
 * Convert seconds since midnight to a Unix timestamp (ms) for a given date.
 */
function secondsToUnixMs(secondsSinceMidnight: number, date: Date): number {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d.getTime() + secondsSinceMidnight * 1000;
}

/**
 * Build a Place from a stop ID.
 */
function makePlace(stopId: string, routingData: RoutingData): Place {
  const stop = routingData.stopIndex[stopId];
  return {
    name: stop?.stopName ?? stopId,
    stopId,
    lat: stop?.lat ?? 0,
    lon: stop?.lon ?? 0,
  };
}

/**
 * Build a Place from coordinates (for origin/destination).
 */
function makePlaceFromCoords(name: string, lat: number, lon: number): Place {
  return { name, lat, lon };
}

/**
 * Get route info for a route ID.
 */
function getRouteInfo(routeId: string, routingData: RoutingData): RouteInfo {
  // Look up route from the routing data
  // Routes aren't indexed in RoutingData — search trips for route info
  const trip = routingData.trips.find((t) => t.routeId === routeId);
  return {
    id: routeId,
    shortName: routeId,
    longName: trip?.headsign ?? routeId,
    color: '0000FF',
  };
}

/**
 * Get intermediate stops between boarding and alighting on a trip.
 * Uses tripStopTimes for loop-route safety.
 */
function getIntermediateStops(
  segment: TransitSegment,
  routingData: RoutingData
): Place[] {
  const tripStops = routingData.tripStopTimes[segment.tripId] || [];

  // Find boarding position (matching stop and time)
  const boardIdx = tripStops.findIndex(
    (st) => st.stopId === segment.boardingStopId && st.departureTime >= segment.boardingTime
  );
  if (boardIdx < 0) return [];

  // Find alighting position AFTER boarding
  let alightIdx = -1;
  for (let i = boardIdx + 1; i < tripStops.length; i++) {
    if (tripStops[i].stopId === segment.alightingStopId) {
      alightIdx = i;
      break;
    }
  }

  if (alightIdx < 0 || alightIdx <= boardIdx + 1) return [];

  return tripStops
    .slice(boardIdx + 1, alightIdx)
    .map((st) => makePlace(st.stopId, routingData));
}

/**
 * Build a walk leg.
 */
function buildWalkLeg(
  from: Place,
  to: Place,
  startTime: number,
  walkSeconds: number,
  date: Date
): WalkLeg {
  const distance = haversineDistance(from.lat, from.lon, to.lat, to.lon) * ROUTING_CONFIG.WALK_DISTANCE_BUFFER;
  return {
    mode: 'WALK',
    startTime: secondsToUnixMs(startTime, date),
    endTime: secondsToUnixMs(startTime + walkSeconds, date),
    duration: walkSeconds,
    distance: Math.round(distance),
    from,
    to,
    route: null,
    headsign: null,
    tripId: null,
    intermediateStops: null,
    legGeometry: null,
  };
}

/**
 * Build a transit leg.
 */
function buildTransitLeg(
  segment: TransitSegment,
  routingData: RoutingData,
  date: Date
): TransitLeg {
  const from = makePlace(segment.boardingStopId, routingData);
  const to = makePlace(segment.alightingStopId, routingData);
  const route = getRouteInfo(segment.routeId, routingData);
  const intermediateStops = getIntermediateStops(segment, routingData);

  // Get accurate times from tripStopTimes (loop-route safe)
  const tripStops = routingData.tripStopTimes[segment.tripId] || [];
  const boardIdx = tripStops.findIndex(
    (st) => st.stopId === segment.boardingStopId && st.departureTime >= segment.boardingTime
  );

  const startTimeSec = boardIdx >= 0 ? tripStops[boardIdx].departureTime : segment.boardingTime;

  let endTimeSec = segment.alightingTime;
  if (boardIdx >= 0) {
    for (let i = boardIdx + 1; i < tripStops.length; i++) {
      if (tripStops[i].stopId === segment.alightingStopId) {
        endTimeSec = tripStops[i].arrivalTime;
        break;
      }
    }
  }
  const duration = endTimeSec - startTimeSec;

  const distance = haversineDistance(from.lat, from.lon, to.lat, to.lon) * ROUTING_CONFIG.WALK_DISTANCE_BUFFER;

  return {
    mode: 'BUS',
    startTime: secondsToUnixMs(startTimeSec, date),
    endTime: secondsToUnixMs(endTimeSec, date),
    duration,
    distance: Math.round(distance),
    from,
    to,
    route,
    headsign: segment.headsign,
    tripId: segment.tripId,
    intermediateStops,
    legGeometry: null, // TODO: geometry enrichment (Phase 5)
  };
}

/**
 * Merge consecutive transit legs on the same route into a single leg.
 * This happens when RAPTOR boards the same route at different rounds.
 */
function mergeSameRouteLegs(legs: Leg[]): Leg[] {
  if (legs.length <= 1) return legs;

  const merged: Leg[] = [];
  let i = 0;

  while (i < legs.length) {
    const current = legs[i];

    if (
      current.mode === 'BUS' &&
      i + 1 < legs.length &&
      legs[i + 1].mode === 'BUS' &&
      current.route?.id === (legs[i + 1] as TransitLeg).route?.id &&
      current.tripId === (legs[i + 1] as TransitLeg).tripId
    ) {
      // Merge: keep first leg's start, use second leg's end
      const next = legs[i + 1] as TransitLeg;
      const mergedLeg: TransitLeg = {
        ...current,
        endTime: next.endTime,
        duration: Math.round((next.endTime - current.startTime) / 1000),
        to: next.to,
        distance: current.distance + next.distance,
        intermediateStops: [
          ...(current.intermediateStops ?? []),
          current.to,
          ...(next.intermediateStops ?? []),
        ],
      };
      merged.push(mergedLeg);
      i += 2;
    } else {
      merged.push(current);
      i++;
    }
  }

  return merged;
}

/**
 * Build a complete Itinerary from a RaptorResult.
 */
export function buildItinerary(
  result: RaptorResult,
  routingData: RoutingData,
  date: Date,
  originLat?: number,
  originLon?: number,
  destLat?: number,
  destLon?: number
): Itinerary {
  const legs: Leg[] = [];
  let currentTimeSec = 0;

  for (const segment of result.path) {
    switch (segment.type) {
      case 'ORIGIN_WALK': {
        const toStop = makePlace(segment.toStopId, routingData);
        const from = originLat != null && originLon != null
          ? makePlaceFromCoords('Origin', originLat, originLon)
          : makePlaceFromCoords('Origin', toStop.lat, toStop.lon);

        // Walk time is baked into the departure — compute start time
        const boardingKey = result.path.find((s) => s.type === 'TRANSIT');
        let walkEndTime: number;
        if (boardingKey && boardingKey.type === 'TRANSIT') {
          walkEndTime = boardingKey.boardingTime;
        } else {
          walkEndTime = segment.walkSeconds;
        }
        const walkStartTime = walkEndTime - segment.walkSeconds;
        currentTimeSec = walkEndTime;

        if (segment.walkSeconds > 0) {
          legs.push(buildWalkLeg(from, toStop, walkStartTime, segment.walkSeconds, date));
        }
        break;
      }

      case 'TRANSIT': {
        legs.push(buildTransitLeg(segment, routingData, date));
        // Use alightingTime from the segment (already computed loop-safe by the engine)
        currentTimeSec = segment.alightingTime;
        break;
      }

      case 'TRANSFER': {
        const from = makePlace(segment.fromStopId, routingData);
        const to = makePlace(segment.toStopId, routingData);
        legs.push(buildWalkLeg(from, to, currentTimeSec, segment.walkSeconds, date));
        currentTimeSec += segment.walkSeconds;
        break;
      }
    }
  }

  // Add final walk from last stop to destination
  if (result.walkToDestSeconds > 0) {
    const lastStop = result.destinationStopId;
    const from = makePlace(lastStop, routingData);
    const to = destLat != null && destLon != null
      ? makePlaceFromCoords('Destination', destLat, destLon)
      : makePlaceFromCoords('Destination', from.lat, from.lon);
    legs.push(buildWalkLeg(from, to, currentTimeSec, result.walkToDestSeconds, date));
  }

  // Merge same-route legs
  const mergedLegs = mergeSameRouteLegs(legs);

  // Calculate totals
  let walkTime = 0;
  let transitTime = 0;
  let walkDistance = 0;
  let transfers = 0;

  for (const leg of mergedLegs) {
    if (leg.mode === 'WALK') {
      walkTime += leg.duration;
      walkDistance += leg.distance;
    } else {
      transitTime += leg.duration;
    }
  }

  // Count transfers = number of transit legs - 1 (minimum 0)
  const transitLegs = mergedLegs.filter((l) => l.mode === 'BUS');
  transfers = Math.max(0, transitLegs.length - 1);

  // Calculate waiting time
  const startTime = mergedLegs[0]?.startTime ?? secondsToUnixMs(0, date);
  const endTime = mergedLegs[mergedLegs.length - 1]?.endTime ?? startTime;
  const totalDuration = Math.round((endTime - startTime) / 1000);
  const waitingTime = Math.max(0, totalDuration - walkTime - transitTime);

  return {
    id: nextItineraryId(),
    duration: totalDuration,
    startTime,
    endTime,
    walkTime,
    transitTime,
    waitingTime,
    walkDistance: Math.round(walkDistance),
    transfers,
    legs: mergedLegs,
  };
}
