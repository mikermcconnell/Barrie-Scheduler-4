// Core RAPTOR Engine — Round-Based Public Transit Routing
// Ported from BTTP src/services/localRouter.js

import { ROUTING_CONFIG } from './constants';
import { haversineDistance } from './geometryUtils';
import { getActiveServicesForDate } from './calendarService';
import { findNearbyStops, getDeparturesAfter } from './routingDataService';
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
  const { stopDepartures, transfers, routeStopSequences, stopTimesIndex, tripStopTimes } = routingData;
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
      const stopSequence = routeStopSequences[routeId]?.[directionId];
      if (!stopSequence || stopSequence.length === 0) continue;

      // Find earliest boarding point on this route
      let currentTrip: string | null = null;
      let currentTripStops: GtfsStopTime[] | null = null;
      let boardingStopId: string | null = null;
      let boardingTime = 0;
      let boardingSeqIdx = -1; // position in currentTripStops where we boarded
      let boardingDep: { headsign: string; directionId: number } | null = null;

      for (let seqPos = 0; seqPos < stopSequence.length; seqPos++) {
        const stopId = stopSequence[seqPos];

        // Check if we can alight here (only if we boarded a trip)
        if (currentTrip && currentTripStops && boardingSeqIdx >= 0) {
          // Find this stop in the trip's stop times AFTER the boarding position
          const arrivalTime = getTripArrivalAtStopAfter(
            currentTripStops,
            stopId,
            boardingSeqIdx
          );

          if (arrivalTime !== null && arrivalTime < maxTime && arrivalTime >= boardingTime) {
            // Can we improve the best known arrival at this stop?
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

        // Check if we can board a trip at this stop
        const prevArrival = roundArrival[k - 1][stopId];
        if (prevArrival !== undefined) {
          const departure = getNextDepartureForRouteDirection(
            stopDepartures,
            stopId,
            routeId,
            Number(directionId),
            prevArrival,
            activeServices,
            excludeTrips
          );

          if (departure) {
            // Board this trip if it's earlier than current trip at this stop
            if (!currentTrip || departure.departureTime < boardingTime) {
              currentTrip = departure.tripId;
              currentTripStops = tripStopTimes[departure.tripId] || null;
              boardingStopId = stopId;
              boardingTime = departure.departureTime;
              // Find the boarding position in the trip's stop times
              boardingSeqIdx = currentTripStops
                ? currentTripStops.findIndex(
                    (st) => st.stopId === stopId && st.departureTime >= prevArrival
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

    // ─── Transfer phase: walk between nearby stops ───

    const transferMarked = new Set<string>();

    for (const stopId of newMarkedStops) {
      const transferList = transfers[stopId] || [];

      for (const transfer of transferList) {
        const arrivalAtStop = roundArrival[k][stopId];
        if (arrivalAtStop === undefined) continue;

        const walkTime = Math.max(transfer.walkSeconds, ROUTING_CONFIG.MIN_TRANSFER_TIME);
        const arrivalAfterTransfer = arrivalAtStop + walkTime + ROUTING_CONFIG.TRANSFER_PENALTY;

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
  afterTime: number,
  activeServices: Set<string>,
  excludeTrips: Set<string>
): import('./types').Departure | null {
  const departures = stopDepartures[stopId] || [];

  for (const dep of departures) {
    if (dep.departureTime < afterTime) continue;
    if (dep.routeId !== routeId) continue;
    if (dep.directionId !== directionId) continue;
    if (!activeServices.has(dep.serviceId)) continue;
    if (excludeTrips.has(dep.tripId)) continue;
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
function getTripArrivalAtStopAfter(
  tripStops: GtfsStopTime[],
  stopId: string,
  afterIdx: number
): number | null {
  for (let i = afterIdx + 1; i < tripStops.length; i++) {
    if (tripStops[i].stopId === stopId) {
      return tripStops[i].arrivalTime;
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
          (st) => st.stopId === label.boardingStopId && st.departureTime >= label.boardingTime
        );
        const alightingTime = boardIdx >= 0
          ? (getTripArrivalAtStopAfter(tripStops, currentStop, boardIdx) ?? 0)
          : 0;

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
    const tripSignature = result.path
      .filter((seg): seg is TransitSegment => seg.type === 'TRANSIT')
      .map((seg) => seg.tripId)
      .join(',');

    const existing = seen.get(tripSignature);
    if (!existing || result.arrivalTime < existing.arrivalTime) {
      seen.set(tripSignature, result);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.arrivalTime - b.arrivalTime);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Plan a trip using the RAPTOR algorithm.
 *
 * Returns multiple itinerary options ranked by arrival time,
 * with multi-pass diversity to provide different route choices.
 */
export function planTripLocal(options: PlanTripOptions): RaptorResult[] {
  const { fromLat, fromLon, toLat, toLon, date, routingData } = options;
  const time = options.time ?? date;

  // Check if origin and destination are too close (walkable)
  const directDistance = haversineDistance(fromLat, fromLon, toLat, toLon);
  if (directDistance < 50) {
    throw new RoutingError(
      ROUTING_ERROR_CODES.NO_ROUTE_FOUND,
      'Origin and destination are within 50m — walk instead'
    );
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
  const originStops = findNearbyStops(
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

  const destStops = findNearbyStops(
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

  // Multi-pass: run RAPTOR multiple times, excluding trips from prior passes
  const allResults: RaptorResult[] = [];
  const excludeTrips = new Set<string>();

  for (let pass = 0; pass < ROUTING_CONFIG.MAX_ITINERARIES; pass++) {
    const results = raptorForward(
      originStops,
      destStops,
      departureTime,
      routingData,
      activeServices,
      excludeTrips
    );

    if (results.length === 0) break;

    // Take the best result from this pass
    const best = results[0];
    allResults.push(best);

    // Exclude trips used in this result for next pass
    for (const seg of best.path) {
      if (seg.type === 'TRANSIT') {
        excludeTrips.add(seg.tripId);
      }
    }
  }

  if (allResults.length === 0) {
    throw new RoutingError(
      ROUTING_ERROR_CODES.NO_ROUTE_FOUND,
      'No route found between origin and destination'
    );
  }

  return deduplicateResults(allResults);
}

// TODO: implement true reverse RAPTOR (arrive-by)
