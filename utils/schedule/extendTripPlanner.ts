import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import { MasterRouteTable, MasterTrip, validateRouteTable } from '../parsers/masterScheduleParser';
import { TimeUtils } from '../timeUtils';
import { stripScheduleDecorators } from './addTripPlanner';

export type ExtendTripMode = 'earlier' | 'later';

export interface ExtendTripModalContext {
  trip: MasterTrip;
  targetTable: MasterRouteTable;
  allSchedules: MasterRouteTable[];
  routeBaseName: string;
  currentStartIndex: number;
  currentEndIndex: number;
  templateTrip: MasterTrip | null;
}

export interface ExtendTripResult {
  mode: ExtendTripMode;
  stopName: string;
}

export interface ExtendTripPreview {
  schedules: MasterRouteTable[];
  updatedTrip: MasterTrip;
  availableEarlierStops: string[];
  availableLaterStops: string[];
  canExtendEarlier: boolean;
  canExtendLater: boolean;
  blockConflict: {
    tripId: string;
    blockId: string;
    routeName: string;
    startTime: number;
    endTime: number;
  } | null;
}

const getTripMinute = (trip: MasterTrip, stopName: string): number | null => {
  const stopMinute = (trip.stopMinutes as Record<string, number | string> | undefined)?.[stopName];
  if (typeof stopMinute === 'number' && Number.isFinite(stopMinute)) return stopMinute;

  const arrival = (trip.arrivalTimes as Record<string, string | number> | undefined)?.[stopName];
  if (arrival !== undefined && arrival !== null && arrival !== '') {
    const parsedArrival = TimeUtils.toMinutes(arrival);
    if (parsedArrival !== null) return parsedArrival;
  }

  const departure = (trip.stops as Record<string, string | number> | undefined)?.[stopName];
  if (departure !== undefined && departure !== null && departure !== '') {
    return TimeUtils.toMinutes(departure);
  }

  return null;
};

const getTemplateTimeline = (trip: MasterTrip, stopNames: string[]): number[] => {
  const explicit = stopNames.map(stop => getTripMinute(trip, stop));
  if (explicit.every(value => typeof value === 'number' && Number.isFinite(value))) {
    const normalized: number[] = [];
    let offset = 0;
    let previous: number | null = null;

    explicit.forEach(value => {
      let next = (value as number) + offset;
      if (previous !== null && next < previous - 720) {
        offset += 1440;
        next = (value as number) + offset;
      }
      normalized.push(next);
      previous = next;
    });

    return normalized;
  }

  const activeStartIndex = getActiveStartIndex(trip, stopNames);
  const activeEndIndex = getActiveEndIndex(trip, stopNames);
  const fallbackTravel = Math.max(0, trip.travelTime || (trip.endTime - trip.startTime));
  const stepCount = Math.max(1, activeEndIndex - activeStartIndex);
  const step = fallbackTravel / stepCount;

  return stopNames.map((_, index) => Math.round(trip.startTime + ((index - activeStartIndex) * step)));
};

const getActiveStartIndex = (trip: MasterTrip, stops: string[]): number => {
  if (typeof trip.startStopIndex === 'number') {
    return Math.max(0, Math.min(stops.length - 1, trip.startStopIndex));
  }

  const firstPresentIndex = stops.findIndex(stop => getTripMinute(trip, stop) !== null);
  return firstPresentIndex >= 0 ? firstPresentIndex : 0;
};

const getActiveEndIndex = (trip: MasterTrip, stops: string[]): number => {
  if (typeof trip.endStopIndex === 'number') {
    return Math.max(0, Math.min(stops.length - 1, trip.endStopIndex));
  }

  for (let index = stops.length - 1; index >= 0; index -= 1) {
    if (getTripMinute(trip, stops[index]) !== null) return index;
  }

  return Math.max(0, stops.length - 1);
};

const getActiveSpan = (trip: MasterTrip, stops: string[]): number => (
  getActiveEndIndex(trip, stops) - getActiveStartIndex(trip, stops)
);

const findTableAndTrip = (
  schedules: MasterRouteTable[],
  tripId: string
): { table: MasterRouteTable; trip: MasterTrip } | null => {
  for (const table of schedules) {
    const trip = table.trips.find(candidate => candidate.id === tripId);
    if (trip) return { table, trip };
  }

  return null;
};

const pickTemplateTrip = (table: MasterRouteTable, trip: MasterTrip): MasterTrip | null => {
  const candidates = table.trips
    .filter(candidate => candidate.direction === trip.direction && candidate.id !== trip.id)
    .sort((a, b) => {
      const spanDiff = getActiveSpan(b, table.stops) - getActiveSpan(a, table.stops);
      if (spanDiff !== 0) return spanDiff;

      const aDelta = Math.abs(getOperationalSortTime(a.startTime) - getOperationalSortTime(trip.startTime));
      const bDelta = Math.abs(getOperationalSortTime(b.startTime) - getOperationalSortTime(trip.startTime));
      return aDelta - bDelta;
    });

  return candidates[0] ?? null;
};

export const buildExtendTripModalContext = (
  schedules: MasterRouteTable[],
  tripId: string
): ExtendTripModalContext | null => {
  const found = findTableAndTrip(schedules, tripId);
  if (!found) return null;

  const { table, trip } = found;

  return {
    trip,
    targetTable: table,
    allSchedules: schedules,
    routeBaseName: stripScheduleDecorators(table.routeName),
    currentStartIndex: getActiveStartIndex(trip, table.stops),
    currentEndIndex: getActiveEndIndex(trip, table.stops),
    templateTrip: pickTemplateTrip(table, trip)
  };
};

const buildShiftedTimingForRange = (
  templateTrip: MasterTrip,
  table: MasterRouteTable,
  anchorIndex: number,
  anchorMinute: number,
  startIndex: number,
  endIndex: number
): {
  stops: Record<string, string>;
  arrivalTimes: Record<string, string>;
  stopMinutes: Record<string, number>;
} => {
  const fullTimeline = getTemplateTimeline(templateTrip, table.stops);
  const anchorTemplateMinute = fullTimeline[anchorIndex] ?? anchorMinute;
  const shift = anchorMinute - anchorTemplateMinute;
  const stops: Record<string, string> = {};
  const arrivalTimes: Record<string, string> = {};
  const stopMinutes: Record<string, number> = {};

  for (let index = startIndex; index <= endIndex; index += 1) {
    const stopName = table.stops[index];
    if (!stopName) continue;

    const minute = (fullTimeline[index] ?? anchorMinute) + shift;
    const templateArrival = (templateTrip.arrivalTimes as Record<string, string | number> | undefined)?.[stopName];
    const parsedArrival = templateArrival !== undefined && templateArrival !== null && templateArrival !== ''
      ? TimeUtils.toMinutes(templateArrival)
      : getTripMinute(templateTrip, stopName);
    const arrivalMinute = (parsedArrival ?? (fullTimeline[index] ?? anchorMinute)) + shift;

    stops[stopName] = TimeUtils.fromMinutes(minute);
    arrivalTimes[stopName] = TimeUtils.fromMinutes(arrivalMinute);
    stopMinutes[stopName] = minute;
  }

  return { stops, arrivalTimes, stopMinutes };
};

const getOccupiedEndTime = (trip: MasterTrip): number => trip.endTime + Math.max(0, trip.recoveryTime || 0);

const rangesOverlap = (
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean => startA < endB && endA > startB;

const getOverlapMinutes = (
  startA: number,
  endA: number,
  startB: number,
  endB: number
): number => {
  if (!rangesOverlap(startA, endA, startB, endB)) return 0;
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
};

const collectBlockConflict = (
  schedules: MasterRouteTable[],
  originalTrip: MasterTrip,
  updatedTrip: MasterTrip,
  updatedRouteName: string
): ExtendTripPreview['blockConflict'] => {
  for (const table of schedules) {
    for (const trip of table.trips) {
      if (trip.id === updatedTrip.id || trip.blockId !== updatedTrip.blockId) continue;

      const originalOverlapMinutes = getOverlapMinutes(
        originalTrip.startTime,
        getOccupiedEndTime(originalTrip),
        trip.startTime,
        getOccupiedEndTime(trip)
      );
      const updatedOverlapMinutes = getOverlapMinutes(
        updatedTrip.startTime,
        getOccupiedEndTime(updatedTrip),
        trip.startTime,
        getOccupiedEndTime(trip)
      );

      if (updatedOverlapMinutes > originalOverlapMinutes) {
        return {
          tripId: trip.id,
          blockId: trip.blockId,
          routeName: table.routeName || updatedRouteName,
          startTime: trip.startTime,
          endTime: trip.endTime
        };
      }
    }
  }

  return null;
};

export const applyExtendTripResultToSchedules = (
  schedules: MasterRouteTable[],
  context: ExtendTripModalContext,
  result: ExtendTripResult
): { schedules: MasterRouteTable[]; updatedTripId: string; blockConflict: ExtendTripPreview['blockConflict'] } => {
  const newSchedules = structuredClone(schedules) as MasterRouteTable[];
  const found = findTableAndTrip(newSchedules, context.trip.id);
  if (!found) {
    return {
      schedules: newSchedules,
      updatedTripId: context.trip.id,
      blockConflict: null
    };
  }

  const { table, trip } = found;
  const currentStartIndex = getActiveStartIndex(trip, table.stops);
  const currentEndIndex = getActiveEndIndex(trip, table.stops);
  const targetIndex = table.stops.indexOf(result.stopName);
  const templateTrip = pickTemplateTrip(table, trip) ?? trip;
  const lastStopIndex = Math.max(0, table.stops.length - 1);

  if (targetIndex < 0) {
    return {
      schedules: newSchedules,
      updatedTripId: trip.id,
      blockConflict: null
    };
  }

  const nextStartIndex = result.mode === 'earlier'
    ? Math.max(0, Math.min(targetIndex, currentStartIndex))
    : currentStartIndex;
  const nextEndIndex = result.mode === 'later'
    ? Math.min(lastStopIndex, Math.max(targetIndex, currentEndIndex))
    : currentEndIndex;

  const nextStops = { ...(trip.stops ?? {}) } as Record<string, string>;
  const nextArrivalTimes = { ...(trip.arrivalTimes ?? {}) } as Record<string, string>;
  const nextStopMinutes = { ...(trip.stopMinutes ?? {}) } as Record<string, number>;
  const nextRecoveryTimes = { ...(trip.recoveryTimes ?? {}) } as Record<string, number>;

  if (result.mode === 'earlier' && nextStartIndex < currentStartIndex) {
    const currentStartStopName = table.stops[currentStartIndex];
    const anchorMinute = currentStartStopName ? (getTripMinute(trip, currentStartStopName) ?? trip.startTime) : trip.startTime;
    const shifted = buildShiftedTimingForRange(templateTrip, table, currentStartIndex, anchorMinute, nextStartIndex, currentStartIndex - 1);

    Object.assign(nextStops, shifted.stops);
    Object.assign(nextArrivalTimes, shifted.arrivalTimes);
    Object.assign(nextStopMinutes, shifted.stopMinutes);
  }

  if (result.mode === 'later' && nextEndIndex > currentEndIndex) {
    const currentEndStopName = table.stops[currentEndIndex];
    const anchorMinute = currentEndStopName ? (getTripMinute(trip, currentEndStopName) ?? trip.endTime) : trip.endTime;
    const shifted = buildShiftedTimingForRange(templateTrip, table, currentEndIndex, anchorMinute, currentEndIndex + 1, nextEndIndex);

    Object.assign(nextStops, shifted.stops);
    Object.assign(nextArrivalTimes, shifted.arrivalTimes);
    Object.assign(nextStopMinutes, shifted.stopMinutes);
  }

  const nextStartStopName = table.stops[nextStartIndex];
  const nextEndStopName = table.stops[nextEndIndex];
  const nextStartTime = nextStartStopName ? (getTripMinute({ ...trip, stops: nextStops, arrivalTimes: nextArrivalTimes, stopMinutes: nextStopMinutes } as MasterTrip, nextStartStopName) ?? trip.startTime) : trip.startTime;
  const nextEndTime = nextEndStopName ? (getTripMinute({ ...trip, stops: nextStops, arrivalTimes: nextArrivalTimes, stopMinutes: nextStopMinutes } as MasterTrip, nextEndStopName) ?? trip.endTime) : trip.endTime;
  const preservedCurrentRecovery = trip.recoveryTime ?? 0;
  const templateRecovery = templateTrip.recoveryTime ?? preservedCurrentRecovery;
  const reachesTerminalNow = nextEndIndex === lastStopIndex;
  const alreadyAtTerminal = currentEndIndex === lastStopIndex;
  const nextRecoveryTime = reachesTerminalNow
    ? (alreadyAtTerminal ? preservedCurrentRecovery : templateRecovery)
    : 0;

  if (nextEndStopName) {
    Object.keys(nextRecoveryTimes).forEach(stopName => {
      if (stopName !== nextEndStopName) delete nextRecoveryTimes[stopName];
    });
    if (nextRecoveryTime > 0) {
      nextRecoveryTimes[nextEndStopName] = nextRecoveryTime;
    } else {
      delete nextRecoveryTimes[nextEndStopName];
    }
  }

  trip.stops = nextStops;
  trip.arrivalTimes = nextArrivalTimes;
  trip.stopMinutes = nextStopMinutes;
  trip.recoveryTimes = Object.keys(nextRecoveryTimes).length > 0 ? nextRecoveryTimes : undefined;
  trip.startStopIndex = nextStartIndex > 0 ? nextStartIndex : undefined;
  trip.endStopIndex = nextEndIndex < lastStopIndex ? nextEndIndex : undefined;
  trip.startTime = nextStartTime;
  trip.endTime = nextEndTime;
  trip.travelTime = Math.max(0, nextEndTime - nextStartTime);
  trip.recoveryTime = nextRecoveryTime;
  trip.cycleTime = trip.travelTime + nextRecoveryTime;

  newSchedules.forEach(routeTable => {
    routeTable.trips.sort((a, b) => getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime));
    validateRouteTable(routeTable);
  });

  return {
    schedules: newSchedules,
    updatedTripId: trip.id,
    blockConflict: collectBlockConflict(newSchedules, context.trip, trip, table.routeName)
  };
};

export const buildExtendTripPreview = (
  context: ExtendTripModalContext,
  result: ExtendTripResult
): ExtendTripPreview => {
  const availableEarlierStops = context.targetTable.stops.slice(0, context.currentStartIndex);
  const availableLaterStops = context.targetTable.stops.slice(context.currentEndIndex + 1);
  const applied = applyExtendTripResultToSchedules(context.allSchedules, context, result);
  const found = findTableAndTrip(applied.schedules, context.trip.id);

  return {
    schedules: applied.schedules,
    updatedTrip: found?.trip ?? context.trip,
    availableEarlierStops,
    availableLaterStops,
    canExtendEarlier: availableEarlierStops.length > 0,
    canExtendLater: availableLaterStops.length > 0,
    blockConflict: applied.blockConflict
  };
};
