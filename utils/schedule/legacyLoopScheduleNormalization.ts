import { getRouteConfig } from '../config/routeDirectionConfig';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';

const baseStopName = (stopName: string): string => stopName.replace(/\s*\(\d+\)\s*$/, '').trim();

const isLegacyArrivalDeparturePair = (
    table: MasterRouteTable,
    arrivalStop: string,
    departureStop: string,
): boolean => {
    const arrivalCode = table.stopIds?.[arrivalStop];
    const departureCode = table.stopIds?.[departureStop];
    if (!arrivalCode || arrivalCode !== departureCode) return false;
    if (baseStopName(arrivalStop).toLowerCase() !== baseStopName(departureStop).toLowerCase()) return false;
    return table.trips.some(trip => Object.prototype.hasOwnProperty.call(trip.recoveryTimes || {}, arrivalStop));
};

const normalizeTrip = (
    trip: MasterTrip,
    pairs: Array<{ arrivalStop: string; departureStop: string }>,
): MasterTrip => {
    const normalized: MasterTrip = {
        ...trip,
        stops: { ...trip.stops },
        stopMinutes: trip.stopMinutes ? { ...trip.stopMinutes } : undefined,
        arrivalTimes: { ...(trip.arrivalTimes || {}) },
        recoveryTimes: trip.recoveryTimes ? { ...trip.recoveryTimes } : undefined,
        endTimeIncludesRecovery: true,
    };

    pairs.forEach(({ arrivalStop, departureStop }) => {
        const arrival = normalized.arrivalTimes?.[arrivalStop] || normalized.stops[arrivalStop];
        const departure = normalized.stops[departureStop];
        if (arrival) normalized.arrivalTimes![arrivalStop] = arrival;
        if (departure) normalized.stops[arrivalStop] = departure;

        if (normalized.stopMinutes) {
            const departureMinute = normalized.stopMinutes[departureStop];
            if (departureMinute !== undefined) normalized.stopMinutes[arrivalStop] = departureMinute;
            delete normalized.stopMinutes[departureStop];
        }
        delete normalized.stops[departureStop];
        delete normalized.arrivalTimes![departureStop];
        if (normalized.recoveryTimes) delete normalized.recoveryTimes[departureStop];
    });

    return normalized;
};

/**
 * Collapses legacy loop schedules that represented one physical recovery stop
 * as consecutive ARR and DEP columns. Canonical schedules keep one stop column
 * and store arrival/departure values separately.
 */
export const normalizeLegacyLoopScheduleTable = (
    routeNumber: string,
    table: MasterRouteTable,
): MasterRouteTable => {
    if (getRouteConfig(routeNumber)?.segments.length !== 1 || table.stops.length < 2) return table;

    const pairs: Array<{ arrivalStop: string; departureStop: string }> = [];
    for (let index = 0; index < table.stops.length - 1; index += 1) {
        const arrivalStop = table.stops[index];
        const departureStop = table.stops[index + 1];
        if (isLegacyArrivalDeparturePair(table, arrivalStop, departureStop)) {
            pairs.push({ arrivalStop, departureStop });
            index += 1;
        }
    }
    if (pairs.length === 0) return table;

    const removedStops = new Set(pairs.map(pair => pair.departureStop));
    const stopIds = Object.fromEntries(
        Object.entries(table.stopIds || {}).filter(([stopName]) => !removedStops.has(stopName)),
    );

    return {
        ...table,
        stops: table.stops.filter(stopName => !removedStops.has(stopName)),
        stopIds,
        trips: table.trips.map(trip => normalizeTrip(trip, pairs)),
    };
};
