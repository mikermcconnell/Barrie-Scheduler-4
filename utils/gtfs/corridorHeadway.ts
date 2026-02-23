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
    departureMinutes: number;
}

function parseTripStopPassages(): TripStopPassage[] {
    const passages: TripStopPassage[] = [];
    const lines = stopTimesRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) return passages;

    const idx = buildHeaderIndex(lines[0]);
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const stopIdIdx = idx.get('stop_id') ?? -1;
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

        passages.push({ tripId, stopId, departureMinutes: depMin });
    }

    return passages;
}

// ─── Main Export ──────────────────────────────────────────────────────────

let cachedPassages: TripStopPassage[] | null = null;
let cachedTripRoute: Map<string, { route: string; serviceId: string }> | null = null;
let cachedServiceFlags: Map<string, ServiceFlags> | null = null;

function ensureCaches(): {
    passages: TripStopPassage[];
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

/**
 * Compute headway for all corridor segments for a given time period and day type.
 *
 * A trip "passes through" a segment if it visits the segment's first stop
 * during the specified time window, on a matching day type.
 */
export function computeCorridorHeadways(
    segments: CorridorSegment[],
    period: TimePeriod,
    dayType: DayType,
): Map<string, SegmentHeadway> {
    const { passages, tripRoute, serviceFlags } = ensureCaches();
    const periodDef = TIME_PERIODS.find(p => p.id === period)!;

    // Build a lookup: stopId → list of (tripId, departureMinutes)
    // filtered by day type and time period
    const stopTrips = new Map<string, { tripId: string; route: string; depMin: number }[]>();

    for (const p of passages) {
        const info = tripRoute.get(p.tripId);
        if (!info) continue;

        const flags = serviceFlags.get(info.serviceId);
        if (!flags) continue;

        // Day type filter
        if (dayType === 'weekday' && !flags.weekday) continue;
        if (dayType === 'saturday' && !flags.saturday) continue;
        if (dayType === 'sunday' && !flags.sunday) continue;

        // Time period filter
        if (p.departureMinutes < periodDef.startMinute || p.departureMinutes >= periodDef.endMinute) continue;

        const arr = stopTrips.get(p.stopId);
        const entry = { tripId: p.tripId, route: info.route, depMin: p.departureMinutes };
        if (arr) arr.push(entry);
        else stopTrips.set(p.stopId, [entry]);
    }

    // For each segment, count distinct trips passing through first stop
    // (using first stop as the entry point for the segment)
    const result = new Map<string, SegmentHeadway>();

    for (const seg of segments) {
        const firstStopId = seg.stops[0];
        const tripsAtEntry = stopTrips.get(firstStopId) || [];

        // Only count trips from routes that are part of this segment
        const segRouteSet = new Set(seg.routes);
        const relevantTrips = tripsAtEntry.filter(t => segRouteSet.has(t.route));

        // Deduplicate by tripId (a trip only counts once per segment)
        const seenTrips = new Set<string>();
        const routeCounts = new Map<string, number>();
        for (const t of relevantTrips) {
            if (seenTrips.has(t.tripId)) continue;
            seenTrips.add(t.tripId);
            routeCounts.set(t.route, (routeCounts.get(t.route) || 0) + 1);
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
