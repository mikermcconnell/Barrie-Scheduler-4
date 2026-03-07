import { ROUTING_CONFIG } from '../routing/constants';
import type { RoutingData, GtfsStopTime } from '../routing/types';
import type { TripLeg } from './studentPassUtils';

export interface SharedTransferOptimizationResult {
  tripLegs: TripLeg[];
  transferWaitOverrides: Array<number | null>;
}

function secondsToMinutes(secondsSinceMidnight: number): number {
  return Math.floor(secondsSinceMidnight / 60);
}

function matchesMinute(valueSeconds: number, expectedMinutes: number): boolean {
  return secondsToMinutes(valueSeconds) === expectedMinutes;
}

function findStopIndex(
  tripStops: GtfsStopTime[],
  stopId: string,
  expectedMinutes: number,
  timeField: 'arrivalTime' | 'departureTime',
  startIndex = 0
): number {
  for (let i = startIndex; i < tripStops.length; i++) {
    const stopTime = tripStops[i];
    if (stopTime.stopId !== stopId) continue;
    if (!matchesMinute(stopTime[timeField], expectedMinutes)) continue;
    return i;
  }
  return -1;
}

export function optimizeSharedTransferStops(
  tripLegs: TripLeg[],
  routingData: RoutingData
): SharedTransferOptimizationResult {
  if (tripLegs.length <= 1) {
    return {
      tripLegs,
      transferWaitOverrides: [],
    };
  }

  const optimizedLegs = tripLegs.map((leg) => ({ ...leg }));
  const transferWaitOverrides = new Array<number | null>(tripLegs.length - 1).fill(null);

  for (let legIndex = 0; legIndex < optimizedLegs.length - 1; legIndex++) {
    const currentLeg = optimizedLegs[legIndex];
    const nextLeg = optimizedLegs[legIndex + 1];

    const currentTripStops = routingData.tripStopTimes[currentLeg.tripId] ?? [];
    const nextTripStops = routingData.tripStopTimes[nextLeg.tripId] ?? [];
    if (currentTripStops.length === 0 || nextTripStops.length === 0) continue;

    const currentBoardIdx = findStopIndex(
      currentTripStops,
      currentLeg.fromStopId,
      currentLeg.departureMinutes,
      'departureTime'
    );
    if (currentBoardIdx < 0) continue;

    const currentAlightIdx = findStopIndex(
      currentTripStops,
      currentLeg.toStopId,
      currentLeg.arrivalMinutes,
      'arrivalTime',
      currentBoardIdx + 1
    );
    if (currentAlightIdx < 0) continue;

    const nextBoardIdx = findStopIndex(
      nextTripStops,
      nextLeg.fromStopId,
      nextLeg.departureMinutes,
      'departureTime'
    );
    if (nextBoardIdx < 0) continue;

    const nextAlightIdx = findStopIndex(
      nextTripStops,
      nextLeg.toStopId,
      nextLeg.arrivalMinutes,
      'arrivalTime',
      nextBoardIdx + 1
    );
    if (nextAlightIdx < 0) continue;

    let bestCandidate:
      | {
          stopId: string;
          currentArrivalTime: number;
          nextDepartureTime: number;
        }
      | null = null;

    const sharedTransferStopAlreadyChosen = currentLeg.toStopId === nextLeg.fromStopId;
    const currentSearchStart = sharedTransferStopAlreadyChosen
      ? currentBoardIdx + 1
      : currentAlightIdx + 1;
    const currentSearchEnd = sharedTransferStopAlreadyChosen
      ? currentAlightIdx
      : currentTripStops.length;

    for (let i = currentSearchStart; i < currentSearchEnd; i++) {
      const currentStopTime = currentTripStops[i];
      const earliestCompatibleNextIdx = (() => {
        for (let j = nextBoardIdx + 1; j < nextAlightIdx; j++) {
          const nextStopTime = nextTripStops[j];
          if (nextStopTime.stopId !== currentStopTime.stopId) continue;
          const slackSeconds = nextStopTime.departureTime - currentStopTime.arrivalTime;
          if (slackSeconds < ROUTING_CONFIG.MIN_TRANSFER_TIME) continue;
          return j;
        }
        return -1;
      })();

      if (earliestCompatibleNextIdx < 0) continue;

      const nextStopTime = nextTripStops[earliestCompatibleNextIdx];
      bestCandidate = {
        stopId: currentStopTime.stopId,
        currentArrivalTime: currentStopTime.arrivalTime,
        nextDepartureTime: nextStopTime.departureTime,
      };
      break;
    }

    if (!bestCandidate) continue;

    const stopName = routingData.stopIndex[bestCandidate.stopId]?.stopName ?? currentLeg.toStop;
    currentLeg.toStopId = bestCandidate.stopId;
    currentLeg.toStop = stopName;
    currentLeg.arrivalMinutes = secondsToMinutes(bestCandidate.currentArrivalTime);

    nextLeg.fromStopId = bestCandidate.stopId;
    nextLeg.fromStop = stopName;
    nextLeg.departureMinutes = secondsToMinutes(bestCandidate.nextDepartureTime);

    transferWaitOverrides[legIndex] = Math.max(
      0,
      nextLeg.departureMinutes - currentLeg.arrivalMinutes
    );
  }

  return {
    tripLegs: optimizedLegs,
    transferWaitOverrides,
  };
}
