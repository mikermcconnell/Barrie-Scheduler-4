import type { MasterTrip } from '../parsers/masterScheduleParser';
import { TimeUtils } from '../timeUtils';

const GRID_MAX_TRAVEL_MINUTES = 240;
const GRID_WRAP_THRESHOLD_MINUTES = 240;

const normalizeStopLabel = (value: string): string => (
    value
        .split('(')[0]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
);

export const isSamePhysicalStop = (fromStop: string, toStop: string): boolean => (
    normalizeStopLabel(fromStop) === normalizeStopLabel(toStop)
);

export const isStationaryTravelSegment = (segmentName: string): boolean => {
    const [fromStop, toStop] = segmentName.split(' to ');
    if (!fromStop || !toStop) return false;
    return isSamePhysicalStop(fromStop, toStop);
};

export const normalizeTripGridMinutes = (rawMinutes: number, referenceMinutes: number): number => {
    let adjusted = rawMinutes;

    while (adjusted < referenceMinutes - GRID_WRAP_THRESHOLD_MINUTES) {
        adjusted += 1440;
    }

    while (adjusted >= referenceMinutes + 1440) {
        adjusted -= 1440;
    }

    return adjusted;
};

const getTripGridMinutes = (
    trip: MasterTrip,
    stopName: string,
    kind: 'departure' | 'arrival'
): number | null => {
    if (kind === 'departure' && trip.stopMinutes?.[stopName] !== undefined) {
        return trip.stopMinutes[stopName];
    }

    const timeStr = kind === 'arrival'
        ? trip.arrivalTimes?.[stopName] || trip.stops[stopName]
        : trip.stops[stopName];

    if (!timeStr) return null;
    return TimeUtils.toMinutes(timeStr);
};

export const resolveGridSegmentTimes = (
    trip: MasterTrip,
    fromStop: string,
    toStop: string
): { departure: number; arrival: number; travelMinutes: number } | null => {
    const rawDeparture = getTripGridMinutes(trip, fromStop, 'departure');
    const rawArrival = getTripGridMinutes(trip, toStop, 'arrival');

    if (rawDeparture === null || rawArrival === null) return null;

    const departure = normalizeTripGridMinutes(rawDeparture, trip.startTime);
    let arrival = normalizeTripGridMinutes(rawArrival, departure);

    while (arrival < departure) {
        arrival += 1440;
    }

    const travelMinutes = arrival - departure;
    if (travelMinutes < 0 || travelMinutes > GRID_MAX_TRAVEL_MINUTES) {
        return null;
    }

    return { departure, arrival, travelMinutes };
};

export const calculateGridTravelMinutes = (
    trip: MasterTrip,
    fromStop: string,
    toStop: string
): number | null => {
    const segment = resolveGridSegmentTimes(trip, fromStop, toStop);
    return segment?.travelMinutes ?? null;
};
