import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { TimeUtils } from '../timeUtils';

export interface MasterRecoveryTransferResult {
  tables: MasterRouteTable[];
  appliedCount: number;
  skippedCount: number;
}

const normalizeStopName = (value: string): string => (
  value
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/^(arrive|arrival|depart|departure)\s+/i, '')
    .replace(/[()[\]{}'".,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
);

const normalizeSequentialMinute = (rawMinute: number | null, previousMinute: number | null): number | null => {
  if (rawMinute === null) return null;
  let minute = rawMinute;
  if (previousMinute !== null) {
    while (minute < previousMinute) minute += 1440;
  }
  return minute;
};

const getStopLookup = (stops: string[]): Map<string, string> => {
  const lookup = new Map<string, string>();
  stops.forEach(stop => {
    lookup.set(normalizeStopName(stop), stop);
  });
  return lookup;
};

const getRecoveryAtStop = (
  recoveryTimes: Record<string, number> | undefined,
  stopName: string
): number => {
  const normalized = normalizeStopName(stopName);
  for (const [candidateStop, minutes] of Object.entries(recoveryTimes ?? {})) {
    if (normalizeStopName(candidateStop) === normalized) {
      return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
    }
  }
  return 0;
};

const getActiveEndStop = (trip: MasterTrip, table: MasterRouteTable): string | null => {
  if (typeof trip.endStopIndex === 'number') {
    return table.stops[Math.max(0, Math.min(table.stops.length - 1, trip.endStopIndex))] ?? null;
  }

  for (let index = table.stops.length - 1; index >= 0; index -= 1) {
    const stop = table.stops[index];
    if (stop && (trip.stops?.[stop] || trip.arrivalTimes?.[stop])) return stop;
  }

  return table.stops[table.stops.length - 1] ?? null;
};

const getActiveStartStop = (trip: MasterTrip, table: MasterRouteTable): string | null => {
  if (typeof trip.startStopIndex === 'number') {
    return table.stops[Math.max(0, Math.min(table.stops.length - 1, trip.startStopIndex))] ?? null;
  }

  for (let index = 0; index < table.stops.length; index += 1) {
    const stop = table.stops[index];
    if (stop && (trip.stops?.[stop] || trip.arrivalTimes?.[stop])) return stop;
  }

  return table.stops[0] ?? null;
};

const mapRecoveryTimesToGeneratedStops = (
  masterTrip: MasterTrip,
  masterTable: MasterRouteTable,
  generatedTrip: MasterTrip,
  generatedTable: MasterRouteTable
): Record<string, number> => {
  const generatedStopLookup = getStopLookup(generatedTable.stops);
  const mapped: Record<string, number> = {};

  Object.entries(masterTrip.recoveryTimes ?? {}).forEach(([masterStop, rawMinutes]) => {
    const minutes = Number.isFinite(rawMinutes) ? Math.max(0, rawMinutes) : 0;
    const generatedStop = generatedStopLookup.get(normalizeStopName(masterStop));
    if (generatedStop) mapped[generatedStop] = minutes;
  });

  if (Object.keys(mapped).length > 0) return mapped;

  const fallbackRecovery = Number.isFinite(masterTrip.recoveryTime)
    ? Math.max(0, masterTrip.recoveryTime || 0)
    : 0;

  const masterEndStop = getActiveEndStop(masterTrip, masterTable);
  const generatedStop = masterEndStop
    ? generatedStopLookup.get(normalizeStopName(masterEndStop))
    : null;
  const fallbackStop = generatedStop ?? getActiveEndStop(generatedTrip, generatedTable);
  if (fallbackStop) mapped[fallbackStop] = fallbackRecovery;

  return mapped;
};

const applyRecoveryTimesToTrip = (
  trip: MasterTrip,
  table: MasterRouteTable,
  recoveryTimes: Record<string, number>
): MasterTrip => {
  const nextTrip: MasterTrip = JSON.parse(JSON.stringify(trip));
  const nextStops: Record<string, string> = { ...(nextTrip.stops ?? {}) };
  const nextArrivalTimes: Record<string, string> = { ...(nextTrip.arrivalTimes ?? {}) };
  const nextStopMinutes: Record<string, number> = { ...(nextTrip.stopMinutes ?? {}) };

  let previousBaseDeparture: number | null = null;
  let cumulativeDelta = 0;
  let firstDeparture: number | null = null;
  let lastDeparture: number | null = null;

  table.stops.forEach(stop => {
    const existingDepartureRaw = typeof nextStopMinutes[stop] === 'number'
      ? nextStopMinutes[stop]
      : TimeUtils.toMinutes(nextStops[stop]);
    const oldRecovery = getRecoveryAtStop(trip.recoveryTimes, stop);
    const existingArrivalRaw = TimeUtils.toMinutes(nextArrivalTimes[stop]);
    const inferredArrivalRaw = existingDepartureRaw === null ? null : existingDepartureRaw - oldRecovery;
    const baseArrivalRaw = existingArrivalRaw ?? inferredArrivalRaw;
    const baseArrival = normalizeSequentialMinute(baseArrivalRaw, previousBaseDeparture);

    if (baseArrival === null) return;

    const arrival = baseArrival + cumulativeDelta;
    const newRecovery = getRecoveryAtStop(recoveryTimes, stop);
    const departure = arrival + newRecovery;

    nextArrivalTimes[stop] = TimeUtils.fromMinutes(arrival);
    nextStops[stop] = TimeUtils.fromMinutes(departure);
    nextStopMinutes[stop] = departure;

    if (firstDeparture === null) firstDeparture = departure;
    lastDeparture = departure;

    previousBaseDeparture = normalizeSequentialMinute(existingDepartureRaw, baseArrival) ?? baseArrival + oldRecovery;
    cumulativeDelta += newRecovery - oldRecovery;
  });

  const totalRecovery = Object.values(recoveryTimes).reduce((sum, minutes) => (
    sum + Math.max(0, Number.isFinite(minutes) ? minutes : 0)
  ), 0);

  return {
    ...nextTrip,
    stops: nextStops,
    arrivalTimes: nextArrivalTimes,
    stopMinutes: nextStopMinutes,
    recoveryTimes,
    recoveryTime: totalRecovery,
    startTime: firstDeparture ?? nextTrip.startTime,
    endTime: lastDeparture ?? nextTrip.endTime,
    travelTime: Math.max(0, (lastDeparture ?? nextTrip.endTime) - (firstDeparture ?? nextTrip.startTime) - totalRecovery),
    cycleTime: Math.max(0, (lastDeparture ?? nextTrip.endTime) - (firstDeparture ?? nextTrip.startTime)),
    endTimeIncludesRecovery: true,
  };
};

const shiftTimeRecord = (
  record: Record<string, string> | undefined,
  deltaMinutes: number
): Record<string, string> | undefined => {
  if (!record) return record;

  return Object.fromEntries(
    Object.entries(record).map(([stop, value]) => {
      const minutes = TimeUtils.toMinutes(value);
      return [stop, minutes === null ? value : TimeUtils.fromMinutes(minutes + deltaMinutes)];
    })
  );
};

const shiftTripBy = (trip: MasterTrip, deltaMinutes: number): void => {
  if (deltaMinutes === 0) return;

  trip.startTime += deltaMinutes;
  trip.endTime += deltaMinutes;
  trip.stops = shiftTimeRecord(trip.stops, deltaMinutes) ?? trip.stops;
  trip.arrivalTimes = shiftTimeRecord(trip.arrivalTimes, deltaMinutes);

  if (trip.stopMinutes) {
    trip.stopMinutes = Object.fromEntries(
      Object.entries(trip.stopMinutes).map(([stop, minutes]) => [stop, minutes + deltaMinutes])
    );
  }
};

const getStopDepartureMinute = (
  trip: MasterTrip,
  stopName: string | null,
  fallbackMinute: number
): number => {
  if (!stopName) return fallbackMinute;
  const stopMinute = trip.stopMinutes?.[stopName];
  if (typeof stopMinute === 'number' && Number.isFinite(stopMinute)) return stopMinute;

  const parsed = TimeUtils.toMinutes(trip.stops?.[stopName]);
  return parsed ?? fallbackMinute;
};

const enforceSameBlockContinuity = (tables: MasterRouteTable[]): void => {
  const tripsByBlock = new Map<string, Array<{ table: MasterRouteTable; trip: MasterTrip }>>();

  tables.forEach(table => {
    table.trips.forEach(trip => {
      const blockTrips = tripsByBlock.get(trip.blockId) ?? [];
      blockTrips.push({ table, trip });
      tripsByBlock.set(trip.blockId, blockTrips);
    });
  });

  tripsByBlock.forEach(blockTrips => {
    const orderedTrips = [...blockTrips].sort((a, b) => (
      getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
    ));

    for (let index = 0; index < orderedTrips.length - 1; index += 1) {
      const current = orderedTrips[index];
      const next = orderedTrips[index + 1];
      const currentEndStop = getActiveEndStop(current.trip, current.table);
      const nextStartStop = getActiveStartStop(next.trip, next.table);

      if (!currentEndStop || !nextStartStop) continue;
      if (normalizeStopName(currentEndStop) !== normalizeStopName(nextStartStop)) continue;

      const linkedDeparture = getStopDepartureMinute(current.trip, currentEndStop, current.trip.endTime);
      const nextStart = getStopDepartureMinute(next.trip, nextStartStop, next.trip.startTime);
      shiftTripBy(next.trip, linkedDeparture - nextStart);
    }
  });
};

const findNearestMasterTrip = (
  generatedTrip: MasterTrip,
  masterCandidates: Array<{ table: MasterRouteTable; trip: MasterTrip }>
): { table: MasterRouteTable; trip: MasterTrip } | null => {
  const sameDirection = masterCandidates.filter(({ trip }) => trip.direction === generatedTrip.direction);
  const candidates = sameDirection.length > 0 ? sameDirection : masterCandidates;
  if (candidates.length === 0) return null;

  const generatedStart = getOperationalSortTime(generatedTrip.startTime);
  return [...candidates].sort((a, b) => {
    const aStartDelta = Math.abs(getOperationalSortTime(a.trip.startTime) - generatedStart);
    const bStartDelta = Math.abs(getOperationalSortTime(b.trip.startTime) - generatedStart);
    if (aStartDelta !== bStartDelta) return aStartDelta - bStartDelta;
    return Math.abs(getOperationalSortTime(a.trip.endTime) - getOperationalSortTime(generatedTrip.endTime))
      - Math.abs(getOperationalSortTime(b.trip.endTime) - getOperationalSortTime(generatedTrip.endTime));
  })[0] ?? null;
};

export const copyNearestMasterRecoveryToGenerated = (
  generatedTables: MasterRouteTable[],
  masterTables: MasterRouteTable[]
): MasterRecoveryTransferResult => {
  const masterCandidates = masterTables.flatMap(table => (
    table.trips.map(trip => ({ table, trip }))
  ));

  let appliedCount = 0;
  let skippedCount = 0;

  const tables = generatedTables.map(table => ({
    ...table,
    stopIds: { ...(table.stopIds ?? {}) },
    trips: table.trips.map(trip => {
      const nearest = findNearestMasterTrip(trip, masterCandidates);
      if (!nearest) {
        skippedCount += 1;
        return { ...trip };
      }

      const recoveryTimes = mapRecoveryTimesToGeneratedStops(nearest.trip, nearest.table, trip, table);
      const hasRecoveryTemplate = Object.keys(recoveryTimes).length > 0;
      if (!hasRecoveryTemplate) {
        skippedCount += 1;
        return { ...trip };
      }

      appliedCount += 1;
      return applyRecoveryTimesToTrip(trip, table, recoveryTimes);
    })
  }));

  if (appliedCount > 0) {
    enforceSameBlockContinuity(tables);
  }

  return { tables, appliedCount, skippedCount };
};
