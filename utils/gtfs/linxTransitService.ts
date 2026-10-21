/**
 * LINX (Simcoe County) GTFS Service
 *
 * Reads LINX bus times at Barrie stops from the public static GTFS feed so the
 * app can offer them as connection targets (like GO trains).
 * The feed has no calendar.txt: service is defined only by calendar_dates.txt.
 */

import type { DayType } from '../parsers/masterScheduleParser';
import type { ConnectionTime } from '../connections/connectionTypes';
import { generateConnectionId } from '../connections/connectionTypes';
import { parseGtfsTime } from './goTransitService';

export const LINX_GTFS_FEED_URL = 'https://metrolinx.tmix.se/gtfs/gtfs-simcoe.zip';

const GTFS_PROXY_API = '/api/gtfs';
const CACHE_KEY = 'linxTransitGtfsCache';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ~24h
const LOOKAHEAD_DAYS = 21;

export interface LinxStop {
    stopId: string;
    name: string;
    lat?: number;
    lon?: number;
}

/** Compact stop time at a Barrie stop. first/last say if the trip starts/ends here. */
export interface LinxStopTime {
    tripId: string;
    stopId: string;
    arr: string;
    dep: string;
    first: boolean;
    last: boolean;
}

export interface LinxTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
    headsign?: string;
}

export interface LinxRoute {
    routeId: string;
    shortName: string;
    longName: string;
}

export interface LinxCalendarDate {
    serviceId: string;
    date: string; // YYYYMMDD
    exceptionType: number; // 1 added, 2 removed
}

export interface LinxFeed {
    fetchedAt: string;
    feedVersion?: string;
    feedEndDate?: string;
    stops: LinxStop[];
    stopTimes: LinxStopTime[];
    trips: LinxTrip[];
    routes: LinxRoute[];
    calendarDates: LinxCalendarDate[];
}

export interface LinxStopEvent {
    time: number;
    routeShortName: string;
    routeLongName: string;
    headsign?: string;
    eventType: 'departure' | 'arrival';
}

// === CACHE ===

function readCache(): LinxFeed | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw) as LinxFeed;
        const age = Date.now() - new Date(data.fetchedAt).getTime();
        if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS) return null;
        if (!Array.isArray(data.stops) || !Array.isArray(data.stopTimes) || !Array.isArray(data.trips)
            || !Array.isArray(data.routes) || !Array.isArray(data.calendarDates)) {
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

function writeCache(feed: LinxFeed): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(feed));
    } catch (error) {
        console.error('Error saving LINX cache:', error);
    }
}

// === FETCH ===

interface ProxyFeed {
    stops?: Array<{ stop_id: string; stop_name: string; stop_lat?: number; stop_lon?: number }>;
    stopTimes?: Array<{ trip_id: string; stop_id: string; arrival_time: string; departure_time: string; stop_sequence: number | string }>;
    trips?: Array<{ trip_id: string; route_id: string; service_id: string; trip_headsign?: string }>;
    routes?: Array<{ route_id: string; route_short_name?: string; route_long_name?: string }>;
    calendarDates?: Array<{ service_id: string; date: string | number; exception_type: string | number }>;
    feedInfo?: { feedVersion?: string; feedEndDate?: string };
}

/**
 * Fetch the LINX feed through the /api/gtfs proxy (browser cannot fetch the zip: CORS).
 * Keeps only stops with "Barrie" in the name, plus their trips, routes and calendar dates.
 */
export async function fetchLinxFeed(options: { forceRefresh?: boolean } = {}): Promise<LinxFeed> {
    if (!options.forceRefresh) {
        const cached = readCache();
        if (cached) return cached;
    }

    const response = await fetch(`${GTFS_PROXY_API}?url=${encodeURIComponent(LINX_GTFS_FEED_URL)}`);
    if (!response.ok) {
        let details = '';
        try {
            const body = await response.json();
            details = body?.details || body?.error || '';
        } catch {
            // ignore
        }
        throw new Error(`LINX GTFS fetch failed: ${response.status}${details ? ` (${details})` : ''}`);
    }

    const raw = await response.json() as ProxyFeed;

    const barrieStops = (raw.stops || []).filter(s => /barrie/i.test(s.stop_name || ''));
    const stopIdSet = new Set(barrieStops.map(s => s.stop_id));

    // First and last stop_sequence of every trip, so we can tell starts from ends.
    const range = new Map<string, { min: number; max: number }>();
    for (const st of raw.stopTimes || []) {
        const seq = Number(st.stop_sequence) || 0;
        const r = range.get(st.trip_id);
        if (!r) range.set(st.trip_id, { min: seq, max: seq });
        else {
            if (seq < r.min) r.min = seq;
            if (seq > r.max) r.max = seq;
        }
    }

    const stopTimes: LinxStopTime[] = (raw.stopTimes || [])
        .filter(st => stopIdSet.has(st.stop_id))
        .map(st => {
            const seq = Number(st.stop_sequence) || 0;
            const r = range.get(st.trip_id)!;
            return {
                tripId: st.trip_id,
                stopId: st.stop_id,
                arr: st.arrival_time,
                dep: st.departure_time,
                first: seq === r.min && r.min !== r.max,
                last: seq === r.max && r.min !== r.max
            };
        });

    const tripIds = new Set(stopTimes.map(st => st.tripId));
    const trips: LinxTrip[] = (raw.trips || [])
        .filter(t => tripIds.has(t.trip_id))
        .map(t => ({ tripId: t.trip_id, routeId: t.route_id, serviceId: t.service_id, headsign: t.trip_headsign || undefined }));

    const routeIds = new Set(trips.map(t => t.routeId));
    const routes: LinxRoute[] = (raw.routes || [])
        .filter(r => routeIds.has(r.route_id))
        .map(r => ({ routeId: r.route_id, shortName: r.route_short_name || '', longName: r.route_long_name || '' }));

    const serviceIds = new Set(trips.map(t => t.serviceId));
    const calendarDates: LinxCalendarDate[] = (raw.calendarDates || [])
        .filter(cd => serviceIds.has(cd.service_id))
        .map(cd => ({
            serviceId: cd.service_id,
            date: String(cd.date || ''),
            exceptionType: Number(cd.exception_type) || 1
        }));

    const feed: LinxFeed = {
        fetchedAt: new Date().toISOString(),
        feedVersion: raw.feedInfo?.feedVersion || undefined,
        feedEndDate: raw.feedInfo?.feedEndDate || undefined,
        stops: barrieStops.map(s => ({
            stopId: s.stop_id,
            name: s.stop_name,
            lat: typeof s.stop_lat === 'number' && s.stop_lat !== 0 ? s.stop_lat : undefined,
            lon: typeof s.stop_lon === 'number' && s.stop_lon !== 0 ? s.stop_lon : undefined
        })),
        stopTimes,
        trips,
        routes,
        calendarDates
    };

    writeCache(feed);
    return feed;
}

export function getLinxBarrieStops(feed: LinxFeed): LinxStop[] {
    return feed.stops.filter(s => /barrie/i.test(s.name || ''));
}

// === DAY SELECTION ===

function toGtfsDate(d: Date): string {
    return `${d.getFullYear()}${`${d.getMonth() + 1}`.padStart(2, '0')}${`${d.getDate()}`.padStart(2, '0')}`;
}

function matchesDayType(d: Date, dayType: DayType): boolean {
    const dow = d.getDay();
    if (dayType === 'Saturday') return dow === 6;
    if (dayType === 'Sunday') return dow === 0;
    return dow >= 1 && dow <= 5;
}

/** Service IDs active on a date: added (1) and not removed (2). */
function activeServicesOn(feed: LinxFeed, dateStr: string): Set<string> {
    const added = new Set<string>();
    const removed = new Set<string>();
    for (const cd of feed.calendarDates) {
        if (cd.date !== dateStr) continue;
        if (cd.exceptionType === 2) removed.add(cd.serviceId);
        else if (cd.exceptionType === 1) added.add(cd.serviceId);
    }
    removed.forEach(id => added.delete(id));
    return added;
}

function pickServiceDate(feed: LinxFeed, dayType: DayType, referenceDate: Date): Set<string> | null {
    const base = new Date(referenceDate);
    base.setHours(12, 0, 0, 0);
    for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset += 1) {
        const candidate = new Date(base);
        candidate.setDate(base.getDate() + offset);
        if (!matchesDayType(candidate, dayType)) continue;
        const active = activeServicesOn(feed, toGtfsDate(candidate));
        if (active.size > 0) return active;
    }
    return null;
}

// === EVENTS ===

/**
 * Events at the given stops on the next matching service day.
 * Trip ends here = arrival. Trip starts here = departure.
 * Passing through = departure, plus an arrival only if the times differ.
 */
export function getLinxEventsForDay(
    feed: LinxFeed,
    stopIds: string[],
    dayType: DayType,
    referenceDate: Date = new Date()
): LinxStopEvent[] {
    const activeServices = pickServiceDate(feed, dayType, referenceDate);
    if (!activeServices) return [];

    const stopSet = new Set(stopIds);
    const tripById = new Map(feed.trips.map(t => [t.tripId, t]));
    const routeById = new Map(feed.routes.map(r => [r.routeId, r]));
    const seen = new Set<string>();
    const events: LinxStopEvent[] = [];

    const push = (time: number, route: LinxRoute | undefined, headsign: string | undefined, eventType: 'departure' | 'arrival') => {
        if (!Number.isFinite(time)) return;
        const routeShortName = route?.shortName || '';
        const key = `${time}|${routeShortName}|${eventType}`;
        if (seen.has(key)) return;
        seen.add(key);
        events.push({ time, routeShortName, routeLongName: route?.longName || '', headsign, eventType });
    };

    for (const st of feed.stopTimes) {
        if (!stopSet.has(st.stopId)) continue;
        const trip = tripById.get(st.tripId);
        if (!trip || !activeServices.has(trip.serviceId)) continue;
        const route = routeById.get(trip.routeId);
        const arr = parseGtfsTime(st.arr || st.dep || '');
        const dep = parseGtfsTime(st.dep || st.arr || '');

        if (st.last) {
            push(arr, route, trip.headsign, 'arrival');
        } else if (st.first) {
            push(dep, route, trip.headsign, 'departure');
        } else {
            push(dep, route, trip.headsign, 'departure');
            if (arr !== dep) push(arr, route, trip.headsign, 'arrival');
        }
    }

    return events.sort((a, b) => a.time - b.time || a.routeShortName.localeCompare(b.routeShortName));
}

// === CONNECTION TIMES ===

/** The place at the far end of a route, e.g. "Barrie-Orillia" -> "Orillia". */
function farEndName(event: LinxStopEvent): string {
    const long = event.routeLongName.trim();
    const m = long.match(/^barrie\s*[-–]\s*(.+)$/i) || long.match(/^(.+?)\s*[-–]\s*barrie$/i);
    if (m && m[1].trim()) return m[1].trim();
    return event.headsign?.trim() || long;
}

export function toConnectionTimes(
    events: LinxStopEvent[],
    dayType: DayType,
    eventType: 'departure' | 'arrival'
): ConnectionTime[] {
    return events
        .filter(e => e.eventType === eventType)
        .map(e => {
            const place = farEndName(e);
            const route = e.routeShortName ? `LINX ${e.routeShortName}` : 'LINX';
            const direction = eventType === 'departure' ? 'to' : 'from';
            return {
                id: generateConnectionId(),
                time: e.time,
                label: place ? `${route} ${direction} ${place}` : route,
                eventType,
                daysActive: [dayType],
                enabled: true
            };
        });
}
