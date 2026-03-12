/**
 * Corridor Headway
 *
 * Computes trips/hour per corridor segment for each time period and day type,
 * then derives headway (minutes between buses) for styling and display.
 * Uses stop_times.txt departure times matched against corridor segment stop pairs.
 */

import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import {
    parseCsvRow,
    buildHeaderIndex,
    parseGtfsTimeToMinutes,
    getRouteIdToShortName,
    getServiceFlagsById,
    getTripToRouteAndService,
    type ServiceFlags,
} from '../transit-app/transitAppGtfsNormalization';
import type { CorridorSegment } from './corridorBuilder';

// ─── Types ────────────────────────────────────────────────────────────────

export type TimePeriod = 'am-peak' | 'midday' | 'pm-peak' | 'evening' | 'full-day';
export type DayType = 'weekday' | 'saturday' | 'sunday';

export interface TimePeriodDef {
    id: TimePeriod;
    label: string;
    startMinute: number; // inclusive
    endMinute: number;   // exclusive
    hours: number;       // span in hours (for trips/hour)
}

export const TIME_PERIODS: TimePeriodDef[] = [
    { id: 'am-peak',  label: 'AM Peak',  startMinute: 420,  endMinute: 540,  hours: 2 },
    { id: 'midday',   label: 'Midday',   startMinute: 540,  endMinute: 900,  hours: 6 },
    { id: 'pm-peak',  label: 'PM Peak',  startMinute: 900,  endMinute: 1080, hours: 3 },
    { id: 'evening',  label: 'Evening',  startMinute: 1080, endMinute: 1380, hours: 5 },
    { id: 'full-day', label: 'Full Day', startMinute: 300,  endMinute: 1500, hours: 20 },
];

export const DAY_TYPES: { id: DayType; label: string }[] = [
    { id: 'weekday',  label: 'Weekday' },
    { id: 'saturday', label: 'Saturday' },
    { id: 'sunday',   label: 'Sunday' },
];

export interface SegmentHeadway {
    segmentId: string;
    combinedTripsPerHour: number;
    combinedHeadwayMin: number | null; // null = no service
    totalTrips: number;
    routeBreakdown: { route: string; trips: number; tripsPerHour: number; headwayMin: number | null }[];
}

/** Convert trips/hour to headway in minutes. Returns null if no trips. */
export function tripsPerHourToHeadway(tph: number): number | null {
    if (tph <= 0) return null;
    return Math.round(60 / tph);
}

/** Format headway as human-readable string. */
export function formatHeadway(headwayMin: number | null): string {
    if (headwayMin === null) return 'No service';
    if (headwayMin <= 1) return '~1 min';
    return `${headwayMin} min`;
}

// ─── Internal: Parse trip stop passages ───────────────────────────────────

interface TripStopPassage {
    tripId: string;
    stopId: string;
    stopSequence: number;
    departureMinutes: number;
}

interface MatchedSegmentTrip {
    tripId: string;
    route: string;
    serviceId: string;
    departureMinutes: number;
}

function parseTripStopPassages(): Map<string, TripStopPassage[]> {
    const passages = new Map<string, TripStopPassage[]>();
    const lines = stopTimesRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) return passages;

    const idx = buildHeaderIndex(lines[0]);
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const stopIdIdx = idx.get('stop_id') ?? -1;
    const stopSequenceIdx = idx.get('stop_sequence') ?? -1;
    const depIdx = idx.get('departure_time') ?? -1;
    const arrIdx = idx.get('arrival_time') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        const stopId = stopIdIdx >= 0 ? (values[stopIdIdx] || '') : '';
        if (!tripId || !stopId) continue;

        const depMin = parseGtfsTimeToMinutes(depIdx >= 0 ? values[depIdx] : undefined)
            ?? parseGtfsTimeToMinutes(arrIdx >= 0 ? values[arrIdx] : undefined);
        if (depMin === null) continue;

        const stopSequence = Number.parseInt(stopSequenceIdx >= 0 ? (values[stopSequenceIdx] || '0') : '0', 10);
        const entry: TripStopPassage = {
            tripId,
            stopId,
            stopSequence: Number.isFinite(stopSequence) ? stopSequence : 0,
            departureMinutes: depMin,
        };

        const existing = passages.get(tripId);
        if (existing) existing.push(entry);
        else passages.set(tripId, [entry]);
    }

    for (const tripStops of passages.values()) {
        tripStops.sort((a, b) => a.stopSequence - b.stopSequence);
    }

    return passages;
}

export function matchSegmentStopsInTrip(
    segmentStops: readonly string[],
    tripStops: readonly string[],
): { startIndex: number; endIndex: number } | null {
    if (segmentStops.length < 2 || tripStops.length < 2) return null;

    let tripCursor = 0;
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < segmentStops.length; i++) {
        let foundIndex = -1;
        for (let j = tripCursor; j < tripStops.length; j++) {
            if (tripStops[j] === segmentStops[i]) {
                foundIndex = j;
                break;
            }
        }

        if (foundIndex === -1) return null;
        if (i === 0) startIndex = foundIndex;
        if (i === segmentStops.length - 1) endIndex = foundIndex;
        tripCursor = foundIndex + 1;
    }

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) return null;
    return { startIndex, endIndex };
}

// ─── Main Export ──────────────────────────────────────────────────────────

let cachedPassages: Map<string, TripStopPassage[]> | null = null;
let cachedTripRoute: Map<string, { route: string; serviceId: string }> | null = null;
let cachedServiceFlags: Map<string, ServiceFlags> | null = null;
let cachedMatchedTrips: { signature: string; bySegmentId: Map<string, MatchedSegmentTrip[]> } | null = null;

function ensureCaches(): {
    passages: Map<string, TripStopPassage[]>;
    tripRoute: Map<string, { route: string; serviceId: string }>;
    serviceFlags: Map<string, ServiceFlags>;
} {
    if (!cachedPassages) cachedPassages = parseTripStopPassages();
    if (!cachedTripRoute) {
        const routeMap = getRouteIdToShortName();
        cachedTripRoute = getTripToRouteAndService(routeMap);
    }
    if (!cachedServiceFlags) cachedServiceFlags = getServiceFlagsById();
    return {
        passages: cachedPassages,
        tripRoute: cachedTripRoute,
        serviceFlags: cachedServiceFlags,
    };
}

function serviceMatchesDayType(flags: ServiceFlags, dayType: DayType): boolean {
    if (dayType === 'weekday') return flags.weekday;
    if (dayType === 'saturday') return flags.saturday;
    return flags.sunday;
}

function getMatchedTripsBySegment(
    segments: CorridorSegment[],
    passages: Map<string, TripStopPassage[]>,
    tripRoute: Map<string, { route: string; serviceId: string }>,
): Map<string, MatchedSegmentTrip[]> {
    const signature = segments.map(segment => segment.id).join('|');
    if (cachedMatchedTrips?.signature === signature) {
        return cachedMatchedTrips.bySegmentId;
    }

    const bySegmentId = new Map<string, MatchedSegmentTrip[]>();

    for (const segment of segments) {
        const routeSet = new Set(segment.routes);
        const matches: MatchedSegmentTrip[] = [];

        for (const [tripId, tripStops] of passages.entries()) {
            const info = tripRoute.get(tripId);
            if (!info || !routeSet.has(info.route)) continue;

            const match = matchSegmentStopsInTrip(
                segment.stops,
                tripStops.map(stop => stop.stopId),
            );
            if (!match) continue;

            matches.push({
                tripId,
                route: info.route,
                serviceId: info.serviceId,
                departureMinutes: tripStops[match.startIndex].departureMinutes,
            });
        }

        bySegmentId.set(segment.id, matches);
    }

    cachedMatchedTrips = { signature, bySegmentId };
    return bySegmentId;
}

/**
 * Compute headway for all corridor segments for a given time period and day type.
 *
 * A trip "passes through" a segment only when the trip stop order matches
 * the segment stop order, preventing opposite-direction trips from being
 * counted on the same corridor segment.
 */
export function computeCorridorHeadways(
    segments: CorridorSegment[],
    period: TimePeriod,
    dayType: DayType,
): Map<string, SegmentHeadway> {
    const { passages, tripRoute, serviceFlags } = ensureCaches();
    const periodDef = TIME_PERIODS.find(p => p.id === period)!;
    const matchedTripsBySegment = getMatchedTripsBySegment(segments, passages, tripRoute);

    const result = new Map<string, SegmentHeadway>();

    for (const seg of segments) {
        const relevantTrips = matchedTripsBySegment.get(seg.id) || [];
        const seenTrips = new Set<string>();
        const routeCounts = new Map<string, number>();
        for (const trip of relevantTrips) {
            const flags = serviceFlags.get(trip.serviceId);
            if (!flags || !serviceMatchesDayType(flags, dayType)) continue;
            if (trip.departureMinutes < periodDef.startMinute || trip.departureMinutes >= periodDef.endMinute) continue;
            if (seenTrips.has(trip.tripId)) continue;

            seenTrips.add(trip.tripId);
            routeCounts.set(trip.route, (routeCounts.get(trip.route) || 0) + 1);
        }

        const totalTrips = seenTrips.size;
        const tripsPerHour = periodDef.hours > 0 ? totalTrips / periodDef.hours : 0;

        const routeBreakdown = seg.routes.map(route => {
            const trips = routeCounts.get(route) || 0;
            const routeTph = periodDef.hours > 0 ? trips / periodDef.hours : 0;
            return {
                route,
                trips,
                tripsPerHour: routeTph,
                headwayMin: tripsPerHourToHeadway(routeTph),
            };
        });

        const combinedTph = Math.round(tripsPerHour * 10) / 10;
        result.set(seg.id, {
            segmentId: seg.id,
            combinedTripsPerHour: combinedTph,
            combinedHeadwayMin: tripsPerHourToHeadway(combinedTph),
            totalTrips,
            routeBreakdown,
        });
    }

    return result;
}

/** Get headway color and weight based on headway in minutes. Lower headway = higher frequency = bolder. */
export function getHeadwayStyle(headwayMin: number | null, isShared: boolean): {
    color: string;
    weight: number;
    opacity: number;
} {
    if (!isShared) {
        return { color: '#888888', weight: 2, opacity: 0.6 };
    }

    if (headwayMin === null) return { color: '#9ca3af', weight: 3, opacity: 0.50 };
    if (headwayMin <= 10)    return { color: '#ef4444', weight: 9, opacity: 0.90 };
    if (headwayMin <= 15)    return { color: '#f97316', weight: 7, opacity: 0.85 };
    if (headwayMin <= 20)    return { color: '#22c55e', weight: 5, opacity: 0.80 };
    if (headwayMin <= 30)    return { color: '#3b82f6', weight: 4, opacity: 0.75 };
    return { color: '#9ca3af', weight: 3, opacity: 0.60 };
}
