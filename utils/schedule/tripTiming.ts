import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';

export const getActiveEndStopName = (table: MasterRouteTable, trip: MasterTrip): string | null => {
    const endIndex = Math.min(table.stops.length - 1, trip.endStopIndex ?? table.stops.length - 1);
    for (let index = endIndex; index >= 0; index -= 1) {
        const stopName = table.stops[index];
        if (trip.stops?.[stopName] || trip.stopMinutes?.[stopName] !== undefined) return stopName;
    }
    return table.stops[endIndex] ?? null;
};

/** Return the time at which the vehicle is available for its next trip. */
export const getOccupiedEndTime = (table: MasterRouteTable, trip: MasterTrip): number => {
    const terminalStop = getActiveEndStopName(table, trip);
    if (!terminalStop) return trip.endTime;

    const terminalRecovery = trip.recoveryTimes?.[terminalStop]
        ?? (trip.recoveryTimes && Object.keys(trip.recoveryTimes).length > 0 ? 0 : trip.recoveryTime)
        ?? 0;
    const legacyDepartureIncludesRecovery = trip.endTimeIncludesRecovery === undefined
        && trip.recoveryTimes !== undefined
        && Object.prototype.hasOwnProperty.call(trip.recoveryTimes, terminalStop)
        && trip.stopMinutes?.[terminalStop] === trip.endTime
        && trip.arrivalTimes?.[terminalStop] === undefined;
    const includesRecovery = trip.endTimeIncludesRecovery ?? legacyDepartureIncludesRecovery;

    return trip.endTime + (includesRecovery ? 0 : Math.max(0, terminalRecovery));
};

export const normalizeTripTime = (trip: MasterTrip, minutes: number): number => {
    const operationalStart = getOperationalSortTime(trip.startTime);
    let adjusted = getOperationalSortTime(minutes);
    // Only a large backwards jump is a service-day rollover. Smaller reversals
    // remain invalid and must still be surfaced by schedule review.
    if (adjusted < operationalStart - 720) adjusted += 1440;
    return adjusted;
};

export const getOperationalStartTime = (trip: MasterTrip): number => getOperationalSortTime(trip.startTime);
export const getOperationalEndTime = (trip: MasterTrip): number => normalizeTripTime(trip, trip.endTime);
export const getOperationalOccupiedEndTime = (table: MasterRouteTable, trip: MasterTrip): number => (
    normalizeTripTime(trip, getOccupiedEndTime(table, trip))
);
