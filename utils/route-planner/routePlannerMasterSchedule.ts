import type { DayType, MasterScheduleContent, MasterScheduleEntry } from '../masterScheduleTypes';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import { getRouteConfig, isLoop } from '../config/routeDirectionConfig';
import { getAllStopsWithCoords, type GtfsStopWithCoords } from '../gtfs/gtfsStopLookup';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type { RouteStop } from './routePlannerTypes';
import { calculateHeadways } from '../schedule/scheduleEditorUtils';

export interface RoutePlannerMasterServiceSeed {
    routeNumber: string;
    dayType: DayType;
    updatedAt: Date;
    firstDeparture: string;
    lastDeparture: string;
    frequencyMinutes: number;
    layoverMinutes: number;
    seededStops: RouteStop[];
}

const PEAK_WINDOWS = [
    { startMinute: 420, endMinute: 540 },
    { startMinute: 900, endMinute: 1080 },
] as const;

function normalizeRouteNumber(value: string): string {
    return value.replace(/^route\s+/i, '').trim().toUpperCase();
}

function normalizeStopKey(value: string): string {
    return value.trim().toUpperCase();
}

function formatClockValue(minutes: number): string {
    const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalizedMinutes / 60);
    const mins = normalizedMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function parseClockValue(value: string): number | null {
    const normalized = value.trim();
    const twentyFourHourMatch = /^(\d{1,2}):(\d{2})$/.exec(normalized);
    if (twentyFourHourMatch) {
        const hours = Number(twentyFourHourMatch[1]);
        const minutes = Number(twentyFourHourMatch[2]);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            return (hours * 60) + minutes;
        }
    }

    const twelveHourMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(normalized);
    if (!twelveHourMatch) return null;

    let hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2]);
    const period = twelveHourMatch[3]?.toUpperCase();
    if (minutes < 0 || minutes > 59) return null;
    if (period === 'AM' && hours === 12) hours = 0;
    if (period === 'PM' && hours < 12) hours += 12;
    if (hours < 0 || hours > 23) return null;
    return (hours * 60) + minutes;
}

function byOperationalTime(left: number, right: number): number {
    return getOperationalSortTime(left) - getOperationalSortTime(right);
}

function pickMedian(values: number[]): number | null {
    if (values.length === 0) return null;
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);

    if (ordered.length % 2 === 1) {
        return ordered[middle] ?? null;
    }

    const lower = ordered[middle - 1];
    const upper = ordered[middle];
    if (lower === undefined || upper === undefined) return null;
    return Math.round((lower + upper) / 2);
}

function collectPeakHeadways(trips: MasterTrip[]): number[] {
    const headwaysByTripId = calculateHeadways(trips);

    return trips.flatMap((trip) => {
        const headway = headwaysByTripId[trip.id];
        if (!Number.isFinite(headway) || headway <= 0) return [];

        const inPeakWindow = PEAK_WINDOWS.some((window) =>
            trip.startTime >= window.startMinute && trip.startTime < window.endMinute
        );

        return inPeakWindow ? [Math.round(headway)] : [];
    });
}

function getTripStopTime(trip: MasterTrip, stopName: string): number | null {
    const stopMinutes = trip.stopMinutes?.[stopName];
    if (typeof stopMinutes === 'number' && Number.isFinite(stopMinutes)) return stopMinutes;

    const stopTime = trip.stops?.[stopName];
    if (typeof stopTime !== 'string' || !stopTime.trim()) return null;
    return parseClockValue(stopTime);
}

function pickPrimaryTable(content: MasterScheduleContent, routeNumber: string): MasterRouteTable {
    const northTable = content.northTable;
    const southTable = content.southTable;
    const northScore = (northTable.stops?.length ?? 0) + ((northTable.trips?.length ?? 0) * 10);
    const southScore = (southTable.stops?.length ?? 0) + ((southTable.trips?.length ?? 0) * 10);
    const routeConfig = getRouteConfig(routeNumber);

    if (isLoop(routeConfig)) {
        return northScore >= southScore ? northTable : southTable;
    }

    if ((northTable.stops?.length ?? 0) > 0 || (northTable.trips?.length ?? 0) > 0) {
        return northTable;
    }

    return southTable;
}

function pickRepresentativeTrip(table: MasterRouteTable): MasterTrip | null {
    return [...table.trips]
        .map((trip) => ({
            trip,
            resolvedStopCount: table.stops.reduce((count, stopName) => (
                getTripStopTime(trip, stopName) !== null ? count + 1 : count
            ), 0),
        }))
        .sort((left, right) => {
            if (right.resolvedStopCount !== left.resolvedStopCount) {
                return right.resolvedStopCount - left.resolvedStopCount;
            }
            return byOperationalTime(left.trip.startTime, right.trip.startTime);
        })[0]?.trip ?? null;
}

function buildGtfsStopLookups(): {
    byId: Map<string, GtfsStopWithCoords>;
    byCode: Map<string, GtfsStopWithCoords>;
    byName: Map<string, GtfsStopWithCoords>;
} {
    const byId = new Map<string, GtfsStopWithCoords>();
    const byCode = new Map<string, GtfsStopWithCoords>();
    const byName = new Map<string, GtfsStopWithCoords>();

    for (const stop of getAllStopsWithCoords()) {
        byId.set(normalizeStopKey(stop.stop_id), stop);
        if (stop.stop_code) {
            byCode.set(normalizeStopKey(stop.stop_code), stop);
        }
        if (!byName.has(normalizeStopKey(stop.stop_name))) {
            byName.set(normalizeStopKey(stop.stop_name), stop);
        }
    }

    return { byId, byCode, byName };
}

function matchGtfsStop(
    stopName: string,
    stopCode: string | undefined,
    lookups: ReturnType<typeof buildGtfsStopLookups>
): GtfsStopWithCoords | null {
    if (stopCode) {
        const normalizedCode = normalizeStopKey(stopCode);
        const exactIdMatch = lookups.byId.get(normalizedCode);
        if (exactIdMatch) return exactIdMatch;

        const codeMatch = lookups.byCode.get(normalizedCode);
        if (codeMatch) return codeMatch;
    }

    return lookups.byName.get(normalizeStopKey(stopName)) ?? null;
}

function buildSeededStops(table: MasterRouteTable, firstDeparture: string): RouteStop[] {
    if (!table.stops.length) return [];

    const representativeTrip = pickRepresentativeTrip(table);
    const firstDepartureMinutes = parseClockValue(firstDeparture);
    const referenceStopTime = representativeTrip
        ? table.stops.map((stopName) => getTripStopTime(representativeTrip, stopName)).find((time): time is number => time !== null)
        : null;
    const lookups = buildGtfsStopLookups();

    return table.stops.flatMap((stopName, index) => {
        const matchedStop = matchGtfsStop(stopName, table.stopIds?.[stopName], lookups);
        if (!matchedStop) return [];

        const role = index === 0 || index === table.stops.length - 1 ? 'terminal' as const : 'timed' as const;
        const stopTime = representativeTrip ? getTripStopTime(representativeTrip, stopName) : null;
        const plannedOffsetMinutes = (
            role === 'timed'
            && stopTime !== null
            && referenceStopTime !== null
        )
            ? Math.max(1, getOperationalSortTime(stopTime) - getOperationalSortTime(referenceStopTime))
            : null;
        const timeLabel = (
            firstDepartureMinutes !== null
            && plannedOffsetMinutes !== null
        )
            ? formatClockValue(firstDepartureMinutes + plannedOffsetMinutes)
            : firstDeparture;

        return [{
            id: `master-${matchedStop.stop_id}-${index + 1}`,
            name: matchedStop.stop_name,
            kind: 'existing' as const,
            sourceStopId: matchedStop.stop_id,
            role,
            latitude: matchedStop.lat,
            longitude: matchedStop.lon,
            timeLabel,
            plannedOffsetMinutes,
        }];
    });
}

function deriveLayoverMinutes(table: MasterRouteTable): number {
    const recoveries = table.trips
        .map((trip) => trip.recoveryTime)
        .filter((value): value is number => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value));

    return pickMedian(recoveries) ?? 5;
}

export function findMostRecentMasterScheduleEntry(
    entries: MasterScheduleEntry[],
    routeId: string
): MasterScheduleEntry | null {
    const normalizedRouteId = normalizeRouteNumber(routeId);

    return entries
        .filter((entry) => normalizeRouteNumber(entry.routeNumber) === normalizedRouteId)
        .sort((left, right) => {
            const leftTimestamp = (left.publishedAt ?? left.updatedAt).getTime();
            const rightTimestamp = (right.publishedAt ?? right.updatedAt).getTime();
            return rightTimestamp - leftTimestamp;
        })[0] ?? null;
}

export function deriveRoutePlannerMasterServiceSeed(
    entry: MasterScheduleEntry,
    content: MasterScheduleContent
): RoutePlannerMasterServiceSeed | null {
    const allTrips = [...content.northTable.trips, ...content.southTable.trips];
    if (allTrips.length === 0) return null;

    const orderedDepartures = [...allTrips]
        .map((trip) => trip.startTime)
        .filter((time): time is number => Number.isFinite(time))
        .sort(byOperationalTime);

    const firstDepartureMinutes = orderedDepartures[0];
    const lastDepartureMinutes = orderedDepartures[orderedDepartures.length - 1];

    if (firstDepartureMinutes === undefined || lastDepartureMinutes === undefined) {
        return null;
    }

    const peakHeadways = collectPeakHeadways(allTrips);
    const fallbackHeadways = Object.values(calculateHeadways(allTrips))
        .filter((value): value is number => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value));
    const frequencyMinutes = pickMedian(peakHeadways) ?? pickMedian(fallbackHeadways) ?? 20;
    const primaryTable = pickPrimaryTable(content, entry.routeNumber);
    const firstDeparture = formatClockValue(firstDepartureMinutes);

    return {
        routeNumber: entry.routeNumber,
        dayType: entry.dayType,
        updatedAt: entry.publishedAt ?? entry.updatedAt,
        firstDeparture,
        lastDeparture: formatClockValue(lastDepartureMinutes),
        frequencyMinutes,
        layoverMinutes: deriveLayoverMinutes(primaryTable),
        seededStops: buildSeededStops(primaryTable, firstDeparture),
    };
}
