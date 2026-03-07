// Core RAPTOR Engine — Round-Based Public Transit Routing
// Ported from BTTP src/services/localRouter.js

import { ROUTING_CONFIG } from './constants';
import { haversineDistance } from './geometryUtils';
import { getActiveServicesForDate } from './calendarService';
import { findNearbyStops } from './routingDataService';
import type {
  RoutingData,
  PlanTripOptions,
  RaptorResult,
  PathSegment,
  OriginWalkSegment,
  TransitSegment,
  TransferSegment,
  LabelEntry,
  NearbyStop,
  GtfsStopTime,
} from './types';
import { RoutingError, ROUTING_ERROR_CODES } from './types';

// ─── Internal Types ──────────────────────────────────────────────────

/** Per-round arrival labels: stopId → best arrival time at each round */
type RoundLabels = Record<string, number>;

/** Back-pointers for path reconstruction */
type Labels = Record<string, LabelEntry>;

// ─── Core Algorithm ──────────────────────────────────────────────────

/**
 * Run forward RAPTOR from origin stops to find optimal paths.
 *
 * Returns raw RaptorResults (not yet converted to Itineraries).
 */
function raptorForward(
  originStops: NearbyStop[],
  destStops: NearbyStop[],
  departureTime: number,
  routingData: RoutingData,
  activeServices: Set<string>,
  excludeTrips: Set<string> = new Set()
): RaptorResult[] {
  const { stopDepartures, transfers, routePatterns, tripStopTimes } = routingData;
  const maxRounds = ROUTING_CONFIG.MAX_TRANSFERS + 1;
  const maxTime = departureTime + ROUTING_CONFIG.TIME_WINDOW;

  // bestArrival[stopId] = best known arrival time (across all rounds)
  const bestArrival: Record<string, number> = {};

  // roundArrival[round][stopId] = best arrival time for this round
  const roundArrival: RoundLabels[] = [];

  // labels[round][stopId] = how we reached this stop in this round
  const labels: Labels[] = [];

  // Stops improved in the current round (for route scanning)
  let markedStops: Set<string>;

  // Destination stop IDs for quick lookup
  const destStopIds = new Set(destStops.map((ns) => ns.stop.stopId));

  // Initialize rounds
  for (let k = 0; k <= maxRounds; k++) {
    roundArrival.push({});
    labels.push({});
  }

  // ─── Round 0: Seed origin stops with walking times ───

  markedStops = new Set<string>();

  for (const ns of originStops) {
    const arrivalTime = departureTime + ns.walkSeconds;
    const stopId = ns.stop.stopId;

    roundArrival[0][stopId] = arrivalTime;
    bestArrival[stopId] = arrivalTime;
    labels[0][stopId] = { type: 'ORIGIN_WALK', walkSeconds: ns.walkSeconds };
    markedStops.add(stopId);
  }

  // ─── Rounds 1..maxRounds: Transit + Transfer ───

  for (let k = 1; k <= maxRounds; k++) {
    // Copy previous round's arrival times as starting point
    roundArrival[k] = { ...roundArrival[k - 1] };

    const newMarkedStops = new Set<string>();

    // ─── Transit phase: scan routes serving marked stops ───

    // Collect route-directions to scan
    const routesToScan = new Set<string>();
    for (const stopId of markedStops) {
      const deps = stopDepartures[stopId] || [];
      for (const dep of deps) {
        routesToScan.add(`${dep.routeId}_${dep.directionId}`);
      }
    }

    for (const routeKey of routesToScan) {
      const [routeId, directionId] = routeKey.split('_');
      const patterns = routePatterns[routeId]?.[directionId] || [];
      if (patterns.length === 0) continue;

      for (const pattern of patterns) {
        const stopSequence = pattern.stopSequence;
        let currentTrip: string | null = null;
        let currentTripStops: GtfsStopTime[] | null = null;
        let boardingStopId: string | null = null;
        let boardingTime = 0;
        let boardingSeqIdx = -1;
        let boardingDep: { headsign: string; directionId: number } | null = null;

        for (let seqPos = 0; seqPos < stopSequence.length; seqPos++) {
          const stopId = stopSequence[seqPos];

          if (currentTrip && currentTripStops && boardingSeqIdx >= 0) {
            const alightingStopTime = getTripStopAfter(currentTripStops, stopId, boardingSeqIdx);
            const arrivalTime = alightingStopTime?.arrivalTime ?? null;

            if (arrivalTime !== null && arrivalTime < maxTime && arrivalTime >= boardingTime) {
              if (arrivalTime < (bestArrival[stopId] ?? Infinity)) {
                bestArrival[stopId] = arrivalTime;
                roundArrival[k][stopId] = arrivalTime;
                labels[k][stopId] = {
                  type: 'TRANSIT',
                  tripId: currentTrip,
                  routeId,
                  directionId: Number(directionId),
                  headsign: boardingDep?.headsign ?? '',
                  boardingStopId: boardingStopId!,
                  boardingTime,
                };
                newMarkedStops.add(stopId);
              }
            }
          }

          const prevArrival = roundArrival[k - 1][stopId];
          if (prevArrival !== undefined) {
            const departure = getNextDepartureForRouteDirection(
              stopDepartures,
              stopId,
              routeId,
              Number(directionId),
              pattern.patternId,
              prevArrival,
              activeServices,
              excludeTrips
            );

            if (departure) {
              if (!currentTrip || departure.departureTime < boardingTime) {
                currentTrip = departure.tripId;
                currentTripStops = tripStopTimes[departure.tripId] || null;
                boardingStopId = stopId;
                boardingTime = departure.departureTime;
                boardingSeqIdx = currentTripStops
                  ? currentTripStops.findIndex(
                      (st) =>
                        st.stopId === stopId &&
                        st.departureTime >= prevArrival &&
                        isPickupAllowed(st.pickupType)
                    )
                  : -1;
                boardingDep = {
                  headsign: departure.headsign,
                  directionId: departure.directionId,
                };
              }
            }
          }
        }
      }
    }

    // ─── Transfer phase: walk between nearby stops ───

    const transferMarked = new Set<string>();

    for (const stopId of newMarkedStops) {
      const transferList = transfers[stopId] || [];

      for (const transfer of transferList) {
        const arrivalAtStop = roundArrival[k][stopId];
        if (arrivalAtStop === undefined) continue;

        const walkTime = Math.max(transfer.walkSeconds, ROUTING_CONFIG.MIN_TRANSFER_TIME);
        const arrivalAfterTransfer = arrivalAtStop + walkTime;

        if (arrivalAfterTransfer >= maxTime) continue;

        if (arrivalAfterTransfer < (bestArrival[transfer.toStopId] ?? Infinity)) {
          bestArrival[transfer.toStopId] = arrivalAfterTransfer;
          roundArrival[k][transfer.toStopId] = arrivalAfterTransfer;
          labels[k][transfer.toStopId] = {
            type: 'TRANSFER',
            fromStopId: stopId,
            walkSeconds: walkTime,
            walkMeters: transfer.walkMeters,
          };
          transferMarked.add(transfer.toStopId);
        }
      }
    }

    // Merge new marks for next round
    markedStops = new Set([...newMarkedStops, ...transferMarked]);

    // Early termination: no improvements this round
    if (markedStops.size === 0) break;
  }

  // ─── Collect results from destination stops ───

  const results: RaptorResult[] = [];

  for (const destNearby of destStops) {
    const stopId = destNearby.stop.stopId;
    const arrival = bestArrival[stopId];
    if (arrival === undefined) continue;

    // Find the best round for this stop
    let bestRound = -1;
    let bestTime = Infinity;
    for (let k = 0; k <= maxRounds; k++) {
      const t = roundArrival[k][stopId];
      if (t !== undefined && t < bestTime) {
        bestTime = t;
        bestRound = k;
      }
    }
    if (bestRound < 0) continue;

    const totalArrival = bestTime + destNearby.walkSeconds;
    const maxDuration = departureTime + ROUTING_CONFIG.MAX_TRIP_DURATION;
    if (totalArrival > maxDuration) continue;

    const path = reconstructPath(labels, tripStopTimes, stopId, bestRound);
    if (path.length === 0) continue;

    results.push({
      destinationStopId: stopId,
      walkToDestSeconds: destNearby.walkSeconds,
      arrivalTime: totalArrival,
      path,
    });
  }

  return deduplicateResults(results);
}

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Find the next departure from a stop for a specific route+direction.
 */
function getNextDepartureForRouteDirection(
  stopDepartures: Record<string, import('./types').Departure[]>,
  stopId: string,
  routeId: string,
  directionId: number,
  patternId: string,
  afterTime: number,
  activeServices: Set<string>,
  excludeTrips: Set<string>
): import('./types').Departure | null {
  const departures = stopDepartures[stopId] || [];

  for (const dep of departures) {
    if (dep.departureTime < afterTime) continue;
    if (dep.routeId !== routeId) continue;
    if (dep.directionId !== directionId) continue;
    if (dep.patternId !== patternId) continue;
    if (!activeServices.has(dep.serviceId)) continue;
    if (excludeTrips.has(dep.tripId)) continue;
    if (!isPickupAllowed(dep.pickupType)) continue;
    return dep;
  }

  return null;
}

/**
 * Get the arrival time of a trip at a specific stop (simple compound key lookup).
 * WARNING: Not safe for loop routes — use getTripArrivalAtStopAfter for route scanning.
 */
function getTripArrivalAtStop(
  stopTimesIndex: Record<string, GtfsStopTime>,
  tripId: string,
  stopId: string
): number | null {
  const key = `${tripId}_${stopId}`;
  const st = stopTimesIndex[key];
  return st?.arrivalTime ?? null;
}

/**
 * Get the arrival time at a stop AFTER a given boarding position.
 * Safe for loop routes where the same stop appears multiple times.
 */
function getTripStopAfter(
  tripStops: GtfsStopTime[],
  stopId: string,
  afterIdx: number
): GtfsStopTime | null {
  for (let i = afterIdx + 1; i < tripStops.length; i++) {
    if (tripStops[i].stopId === stopId && isDropOffAllowed(tripStops[i].dropOffType)) {
      return tripStops[i];
    }
  }
  return null;
}

/**
 * Reconstruct the path from labels (back-pointers).
 * Uses tripStopTimes for loop-route-safe arrival time lookups.
 */
function reconstructPath(
  labels: Labels[],
  tripStopTimes: Record<string, GtfsStopTime[]>,
  destStopId: string,
  round: number
): PathSegment[] {
  const path: PathSegment[] = [];
  let currentStop = destStopId;
  let k = round;

  while (k >= 0) {
    const label = labels[k][currentStop];
    if (!label) break;

    switch (label.type) {
      case 'ORIGIN_WALK': {
        const segment: OriginWalkSegment = {
          type: 'ORIGIN_WALK',
          toStopId: currentStop,
          walkSeconds: label.walkSeconds,
        };
        path.unshift(segment);
        return path; // Done — reached origin
      }

      case 'TRANSIT': {
        // Find alighting time: search trip's stops AFTER the boarding stop
        const tripStops = tripStopTimes[label.tripId] || [];
        const boardIdx = tripStops.findIndex(
          (st) =>
            st.stopId === label.boardingStopId &&
            st.departureTime >= label.boardingTime &&
            isPickupAllowed(st.pickupType)
        );
        const alightingStop = boardIdx >= 0 ? getTripStopAfter(tripStops, currentStop, boardIdx) : null;
        const alightingTime = alightingStop?.arrivalTime ?? 0;

        const segment: TransitSegment = {
          type: 'TRANSIT',
          tripId: label.tripId,
          routeId: label.routeId,
          directionId: label.directionId,
          headsign: label.headsign,
          boardingStopId: label.boardingStopId,
          alightingStopId: currentStop,
          boardingTime: label.boardingTime,
          alightingTime,
        };
        path.unshift(segment);
        currentStop = label.boardingStopId;
        // Move to previous round to find how we reached the boarding stop
        k--;
        break;
      }

      case 'TRANSFER': {
        const segment: TransferSegment = {
          type: 'TRANSFER',
          fromStopId: label.fromStopId,
          toStopId: currentStop,
          walkSeconds: label.walkSeconds,
          walkMeters: label.walkMeters,
        };
        path.unshift(segment);
        currentStop = label.fromStopId;
        // Transfer is within the same round — stay at this round
        // to find the TRANSIT that reached fromStopId
        break;
      }
    }
  }

  return path;
}

/**
 * Deduplicate results — keep the best per unique trip combination.
 */
function deduplicateResults(results: RaptorResult[]): RaptorResult[] {
  if (results.length <= 1) return results;

  // Create a signature for each result based on the trips used
  const seen = new Map<string, RaptorResult>();

  for (const result of results) {
    const tripSignature = getTransitSignature(result);

    const existing = seen.get(tripSignature);
    if (!existing || result.arrivalTime < existing.arrivalTime) {
      seen.set(tripSignature, result);
    }
  }

  return Array.from(seen.values()).sort(compareRaptorResults);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Plan a trip using the RAPTOR algorithm.
 *
 * Returns multiple itinerary options ranked by arrival time,
 * with multi-pass diversity to provide different route choices.
 */
export function planTripLocal(options: PlanTripOptions): RaptorResult[] {
  const {
    fromLat,
    fromLon,
    toLat,
    toLon,
    date,
    routingData,
    originStopIds,
    destinationStopIds,
  } = options;
  const time = options.time ?? date;

  // Check if origin and destination are too close (walkable)
  const directDistance = haversineDistance(fromLat, fromLon, toLat, toLon);
  if (directDistance < 50) {
    const walkMeters = Math.round(directDistance * ROUTING_CONFIG.WALK_DISTANCE_BUFFER);
    const walkSeconds = Math.round(walkMeters / ROUTING_CONFIG.WALK_SPEED);
    return [{
      destinationStopId: '',
      walkToDestSeconds: walkSeconds,
      arrivalTime: (time.getHours() * 3600) + (time.getMinutes() * 60) + time.getSeconds() + walkSeconds,
      path: [],
      directWalkMeters: walkMeters,
    }];
  }

  // Get active services for the query date
  const activeServices = getActiveServicesForDate(routingData.serviceCalendar, date);
  if (activeServices.size === 0) {
    throw new RoutingError(
      ROUTING_ERROR_CODES.NO_SERVICE,
      'No transit services operate on the selected date'
    );
  }

  // Find nearby stops for origin and destination
  const originStops = originStopIds?.length
    ? buildPinnedStops(originStopIds, fromLat, fromLon, routingData)
    : findNearbyStops(
        routingData.stops,
        fromLat,
        fromLon,
        ROUTING_CONFIG.MAX_WALK_TO_TRANSIT
      );
  if (originStops.length === 0) {
    throw new RoutingError(
      ROUTING_ERROR_CODES.OUTSIDE_SERVICE_AREA,
      'No transit stops found near origin'
    );
  }

  const destStops = destinationStopIds?.length
    ? buildPinnedStops(destinationStopIds, toLat, toLon, routingData)
    : findNearbyStops(
        routingData.stops,
        toLat,
        toLon,
        ROUTING_CONFIG.MAX_WALK_TO_TRANSIT
      );
  if (destStops.length === 0) {
    throw new RoutingError(
      ROUTING_ERROR_CODES.OUTSIDE_SERVICE_AREA,
      'No transit stops found near destination'
    );
  }

  // Convert departure time to seconds since midnight
  const departureTime = time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds();

  const allResults: RaptorResult[] = [];
  const exclusionQueue: Set<string>[] = [new Set<string>()];
  const queuedExclusions = new Set<string>([serializeTripSet(exclusionQueue[0])]);
  const exploredExclusions = new Set<string>();

  while (exclusionQueue.length > 0 && allResults.length < ROUTING_CONFIG.MAX_ITINERARIES) {
    const excludeTrips = exclusionQueue.shift();
    if (!excludeTrips) break;

    const exclusionKey = serializeTripSet(excludeTrips);
    queuedExclusions.delete(exclusionKey);
    if (exploredExclusions.has(exclusionKey)) continue;
    exploredExclusions.add(exclusionKey);

    const results = raptorForward(
      originStops,
      destStops,
      departureTime,
      routingData,
      activeServices,
      excludeTrips
    );

    const nextResult = results.find((candidate) =>
      !allResults.some((existing) => haveSameTransitSignature(existing, candidate))
    );
    if (!nextResult) {
      continue;
    }

    allResults.push(nextResult);

    const transitSegments = nextResult.path.filter(
      (segment): segment is TransitSegment => segment.type === 'TRANSIT'
    );
    for (const transitSegment of transitSegments) {
      const nextExcludeTrips = new Set(excludeTrips);
      nextExcludeTrips.add(transitSegment.tripId);
      const nextKey = serializeTripSet(nextExcludeTrips);
      if (exploredExclusions.has(nextKey) || queuedExclusions.has(nextKey)) {
        continue;
      }
      exclusionQueue.push(nextExcludeTrips);
      queuedExclusions.add(nextKey);
    }
  }

  if (allResults.length === 0) {
    throw new RoutingError(
      ROUTING_ERROR_CODES.NO_ROUTE_FOUND,
      'No route found between origin and destination'
    );
  }

  return deduplicateResults(allResults).slice(0, ROUTING_CONFIG.MAX_ITINERARIES);
}

// TODO: implement true reverse RAPTOR (arrive-by)

function isPickupAllowed(pickupType?: number): boolean {
  return (pickupType ?? 0) === 0;
}

function isDropOffAllowed(dropOffType?: number): boolean {
  return (dropOffType ?? 0) === 0;
}

function buildPinnedStops(
  stopIds: string[],
  lat: number,
  lon: number,
  routingData: RoutingData
): NearbyStop[] {
  return stopIds
    .map((stopId) => routingData.stopIndex[stopId])
    .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop))
    .map((stop) => {
      const directMeters = haversineDistance(lat, lon, stop.lat, stop.lon);
      const walkMeters = Math.round(directMeters);
      return {
        stop,
        walkMeters,
        walkSeconds: Math.round(
          (directMeters * ROUTING_CONFIG.WALK_DISTANCE_BUFFER) / ROUTING_CONFIG.WALK_SPEED
        ),
      };
    })
    .sort((a, b) => a.walkMeters - b.walkMeters);
}

function compareRaptorResults(a: RaptorResult, b: RaptorResult): number {
  if (a.arrivalTime !== b.arrivalTime) {
    return a.arrivalTime - b.arrivalTime;
  }

  const transferCmp = countTransitLegs(a.path) - countTransitLegs(b.path);
  if (transferCmp !== 0) {
    return transferCmp;
  }

  return getWalkSeconds(a) - getWalkSeconds(b);
}

function countTransitLegs(path: PathSegment[]): number {
  return path.filter((segment) => segment.type === 'TRANSIT').length;
}

function getWalkSeconds(result: RaptorResult): number {
  return result.walkToDestSeconds + result.path.reduce((sum, segment) => {
    if (segment.type === 'ORIGIN_WALK' || segment.type === 'TRANSFER') {
      return sum + segment.walkSeconds;
    }
    return sum;
  }, 0);
}

function haveSameTransitSignature(a: RaptorResult, b: RaptorResult): boolean {
  return getTransitSignature(a) === getTransitSignature(b);
}

function getTransitSignature(result: RaptorResult): string {
  return result.path
    .filter((segment): segment is TransitSegment => segment.type === 'TRANSIT')
    .map((segment) => segment.tripId)
    .join(',') || `WALK:${result.walkToDestSeconds}`;
}

function serializeTripSet(trips: Set<string>): string {
  return [...trips].sort().join(',');
}
