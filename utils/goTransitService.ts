/**
 * GO Transit GTFS Service
 *
 * Fetches and caches GO Transit schedule data from Metrolinx GTFS.
 * Provides helper functions for getting Barrie line train times.
 */

import type { DayType } from './masterScheduleParser';
import type { ConnectionTime } from './connectionTypes';
import { generateConnectionId } from './connectionTypes';

// === TYPES ===

export interface GoStop {
    stop_id: string;
    stop_name: string;
    stop_code?: string;
    stop_lat?: number;
    stop_lon?: number;
}

export interface GoStopTime {
    trip_id: string;
    stop_id: string;
    arrival_time: string;    // HH:MM:SS format
    departure_time: string;
    stop_sequence: number;
}

export interface GoTrip {
    trip_id: string;
    route_id: string;
    service_id: string;
    trip_headsign?: string;
    direction_id?: string | number;
}

export interface GoCalendar {
    service_id: string;
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
}

export interface GoCalendarDate {
    service_id: string;
    date: string; // YYYYMMDD
    exception_type: string;
}

export interface GoTransitCache {
    fetchedAt: string;       // ISO timestamp
    barrieStops: GoStop[];
    stopTimes: GoStopTime[];
    trips: GoTrip[];
    calendar: GoCalendar[];
    calendarDates?: GoCalendarDate[];
}

export type GoDataSource = 'gtfs' | 'fallback';

// === CONSTANTS ===

const CACHE_KEY = 'goTransitGtfsCache';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const GO_GTFS_FEED_URL = 'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip';
const GTFS_PROXY_API = '/api/gtfs';

type GoDirection = 'southbound' | 'northbound';
type GoStationId = 'barrie-south' | 'allandale-waterfront';

const GO_STATIONS: Record<GoStationId, { stopId: string; stopCode: string; name: string }> = {
    'barrie-south': {
        stopId: 'BA',
        stopCode: '725', // Barrie Transit stop code near GO station
        name: 'Barrie South GO'
    },
    'allandale-waterfront': {
        stopId: 'AD',
        stopCode: '9003', // Barrie Transit stop code near GO station
        name: 'Barrie Allandale Waterfront GO'
    }
};

// Common weekday GO Train departure times from Barrie (southbound to Toronto)
// These are typical times - real data would come from GTFS
const STATIC_GO_TRAIN_TIMES_ALLANDALE = {
    southbound: [
        { time: 375, label: '6:15a Express' },       // 6:15 AM
        { time: 435, label: '7:15a Express' },       // 7:15 AM
        { time: 495, label: '8:15a Express' },       // 8:15 AM
        { time: 555, label: '9:15a' },               // 9:15 AM
        { time: 885, label: '2:45p' },               // 2:45 PM
        { time: 945, label: '3:45p' },               // 3:45 PM
        { time: 1005, label: '4:45p' },              // 4:45 PM
        { time: 1065, label: '5:45p' },              // 5:45 PM
    ],
    northbound: [
        { time: 510, label: '8:30a from Union' },    // 8:30 AM arrival
        { time: 990, label: '4:30p from Union' },    // 4:30 PM
        { time: 1050, label: '5:30p from Union' },   // 5:30 PM
        { time: 1110, label: '6:30p from Union' },   // 6:30 PM
        { time: 1170, label: '7:30p from Union' },   // 7:30 PM
        { time: 1350, label: '10:30p from Union' },  // 10:30 PM
    ]
};

const STATION_TIME_OFFSET_MINUTES: Record<GoStationId, number> = {
    'allandale-waterfront': 0,
    'barrie-south': 8
};

// Georgian College class bell times (class start times)
// Students need to arrive before these times
const GEORGIAN_CLASS_TIMES = [
    { time: 480, label: '8:00a Bell' },    // 8:00 AM
    { time: 540, label: '9:00a Bell' },    // 9:00 AM
    { time: 600, label: '10:00a Bell' },   // 10:00 AM
    { time: 660, label: '11:00a Bell' },   // 11:00 AM
    { time: 720, label: '12:00p Bell' },   // 12:00 PM
    { time: 780, label: '1:00p Bell' },    // 1:00 PM
    { time: 840, label: '2:00p Bell' },    // 2:00 PM
];

// === CACHE FUNCTIONS ===

/**
 * Get cached GTFS data from localStorage.
 */
export function getCachedData(): GoTransitCache | null {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;

        const data: GoTransitCache = JSON.parse(cached);
        const fetchedAt = new Date(data.fetchedAt).getTime();
        const now = Date.now();

        // Check if cache is expired
        if (now - fetchedAt > CACHE_MAX_AGE_MS) {
            console.log('GO Transit cache expired, will need refresh');
            return null;
        }

        // Invalidate legacy/placeholder cache shapes that force fallback forever.
        const hasUsableStops = Array.isArray(data.barrieStops) && data.barrieStops.length > 0;
        const hasUsableTimes = Array.isArray(data.stopTimes) && data.stopTimes.length > 0;
        const hasUsableTrips = Array.isArray(data.trips) && data.trips.length > 0;
        if (!hasUsableStops || !hasUsableTimes || !hasUsableTrips) {
            console.warn('GO Transit cache invalid/legacy; clearing and refetching');
            localStorage.removeItem(CACHE_KEY);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error reading GO Transit cache:', error);
        return null;
    }
}

/**
 * Save GTFS data to localStorage cache.
 */
function saveCacheData(data: GoTransitCache): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving GO Transit cache:', error);
    }
}

/**
 * Clear the GTFS cache.
 */
export function clearCache(): void {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch (error) {
        console.error('Error clearing GO Transit cache:', error);
    }
}

/**
 * Check if cache is fresh (less than max age).
 */
export function isCacheFresh(): boolean {
    const cached = getCachedData();
    return cached !== null;
}

/**
 * Get cache age in human-readable format.
 */
export function getCacheAge(): string | null {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;

        const data: GoTransitCache = JSON.parse(cached);
        const fetchedAt = new Date(data.fetchedAt);
        const now = new Date();
        const diffMs = now.getTime() - fetchedAt.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (diffHours > 0) {
            return `${diffHours}h ${diffMins}m ago`;
        }
        return `${diffMins}m ago`;
    } catch {
        return null;
    }
}

// === GTFS FETCH FUNCTIONS ===

/**
 * Fetch GO Transit GTFS data from Metrolinx.
 * Uses the existing server-side /api/gtfs proxy to bypass browser CORS
 * and parse the ZIP feed before filtering to Barrie train stations.
 */
export async function fetchGoTransitGTFS(): Promise<GoTransitCache> {
    const cached = getCachedData();
    if (cached) return cached;

    console.log('Fetching GO Transit GTFS via proxy API...');

    const response = await fetch(`${GTFS_PROXY_API}?url=${encodeURIComponent(GO_GTFS_FEED_URL)}`);
    if (!response.ok) {
        let details = '';
        try {
            const body = await response.json();
            details = body?.details || body?.error || '';
        } catch {
            // Ignore parse errors and throw status-level failure.
        }
        throw new Error(`GTFS fetch failed: ${response.status}${details ? ` (${details})` : ''}`);
    }

    const feed = await response.json() as {
        stops?: Array<{ stop_id: string; stop_name: string; stop_code?: string; stop_lat?: number; stop_lon?: number }>;
        stopTimes?: Array<{ trip_id: string; stop_id: string; arrival_time: string; departure_time: string; stop_sequence: number }>;
        trips?: Array<{ trip_id: string; route_id: string; service_id: string; trip_headsign?: string; direction_id?: string | number }>;
        calendar?: Array<{ service_id: string; monday: string | number; tuesday: string | number; wednesday: string | number; thursday: string | number; friday: string | number; saturday: string | number; sunday: string | number }>;
        calendarDates?: Array<{ service_id: string; date: string | number; exception_type: string | number }>;
    };

    const allStops = feed.stops || [];
    const matchedStops = allStops.filter(stop =>
        /barrie south go|allandale waterfront go/i.test(stop.stop_name || '')
        && !/ bus$/i.test(stop.stop_name || '')
    );
    if (matchedStops.length === 0) {
        throw new Error('No Barrie GO train stations found in GTFS feed');
    }

    const stopIdSet = new Set(matchedStops.map(s => s.stop_id));
    const stopTimes = (feed.stopTimes || [])
        .filter(st => stopIdSet.has(st.stop_id))
        .map(st => ({
            trip_id: st.trip_id,
            stop_id: st.stop_id,
            arrival_time: st.arrival_time,
            departure_time: st.departure_time,
            stop_sequence: Number(st.stop_sequence) || 0
        }));

    const tripIdSet = new Set(stopTimes.map(st => st.trip_id));
    const trips = (feed.trips || [])
        .filter(trip => tripIdSet.has(trip.trip_id))
        .map(trip => ({
            trip_id: trip.trip_id,
            route_id: trip.route_id,
            service_id: trip.service_id,
            trip_headsign: trip.trip_headsign,
            direction_id: trip.direction_id
        }));

    const serviceIdSet = new Set(trips.map(trip => trip.service_id));
    const calendar = (feed.calendar || [])
        .filter(c => serviceIdSet.has(c.service_id))
        .map(c => ({
            service_id: c.service_id,
            monday: String(c.monday),
            tuesday: String(c.tuesday),
            wednesday: String(c.wednesday),
            thursday: String(c.thursday),
            friday: String(c.friday),
            saturday: String(c.saturday),
            sunday: String(c.sunday)
        }));

    const calendarDates = (feed.calendarDates || [])
        .filter(cd => serviceIdSet.has(cd.service_id))
        .map(cd => ({
            service_id: cd.service_id,
            date: String(cd.date || ''),
            exception_type: String(cd.exception_type ?? '')
        }));

    const cache: GoTransitCache = {
        fetchedAt: new Date().toISOString(),
        barrieStops: matchedStops.map(s => ({
            stop_id: s.stop_id,
            stop_name: s.stop_name,
            stop_code: s.stop_code,
            stop_lat: s.stop_lat,
            stop_lon: s.stop_lon
        })),
        stopTimes,
        trips,
        calendar,
        calendarDates
    };

    saveCacheData(cache);
    return cache;
}

// === TEMPLATE DATA FUNCTIONS ===

/**
 * Get GO Train template data for pre-filling the Add Target form.
 * Includes common Barrie Line times.
 */
export function getGoTrainTemplateData(
    direction: 'southbound' | 'northbound',
    dayType: DayType
): {
    name: string;
    location: string;
    stopCode: string;
    icon: 'train';
    times: ConnectionTime[];
} {
    const times = direction === 'southbound'
        ? STATIC_GO_TRAIN_TIMES_ALLANDALE.southbound
        : STATIC_GO_TRAIN_TIMES_ALLANDALE.northbound;

    const connectionTimes: ConnectionTime[] = times.map(t => ({
        id: generateConnectionId(),
        time: t.time,
        label: t.label,
        eventType: direction === 'southbound' ? 'departure' : 'arrival',
        daysActive: [dayType],
        enabled: true
    }));

    return {
        name: direction === 'southbound'
            ? 'GO Train to Toronto'
            : 'GO Train from Toronto',
        location: 'Allandale Waterfront GO Station',
        stopCode: '9003',  // Allandale Waterfront platform
        icon: 'train',
        times: connectionTimes
    };
}

function getDayServiceFlag(dayType: DayType): keyof GoCalendar {
    if (dayType === 'Saturday') return 'saturday';
    if (dayType === 'Sunday') return 'sunday';
    return 'monday';
}

type ServiceDayAvailability = {
    Weekday: boolean;
    Saturday: boolean;
    Sunday: boolean;
};

function hasCalendarBaseline(calendar: GoCalendar | undefined): boolean {
    if (!calendar) return false;
    return String(calendar.monday) === '1'
        || String(calendar.tuesday) === '1'
        || String(calendar.wednesday) === '1'
        || String(calendar.thursday) === '1'
        || String(calendar.friday) === '1'
        || String(calendar.saturday) === '1'
        || String(calendar.sunday) === '1';
}

function getDayTypeForGtfsDate(dateStr: string): DayType | null {
    if (!/^\d{8}$/.test(dateStr)) return null;
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(4, 6));
    const day = Number(dateStr.slice(6, 8));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dayOfWeek === 0) return 'Sunday';
    if (dayOfWeek === 6) return 'Saturday';
    return 'Weekday';
}

function buildServiceDayAvailabilityMap(calendarDates: GoCalendarDate[] | undefined): Map<string, ServiceDayAvailability> {
    const byService = new Map<string, ServiceDayAvailability>();
    if (!Array.isArray(calendarDates)) return byService;

    for (const calendarDate of calendarDates) {
        if (!calendarDate?.service_id) continue;
        if (String(calendarDate.exception_type) !== '1') continue;
        const dayType = getDayTypeForGtfsDate(String(calendarDate.date || ''));
        if (!dayType) continue;

        const existing = byService.get(calendarDate.service_id) || {
            Weekday: false,
            Saturday: false,
            Sunday: false
        };
        existing[dayType] = true;
        byService.set(calendarDate.service_id, existing);
    }

    return byService;
}

function isServiceActiveForDay(
    calendar: GoCalendar | undefined,
    dayType: DayType,
    serviceId: string,
    derivedDayAvailability: Map<string, ServiceDayAvailability>
): boolean {
    if (hasCalendarBaseline(calendar)) {
        const dayFlag = getDayServiceFlag(dayType);
        return String(calendar?.[dayFlag] || '0') === '1';
    }

    const derived = derivedDayAvailability.get(serviceId);
    if (derived) return Boolean(derived[dayType]);

    // If neither calendar nor calendar_dates information exists, do not block data.
    return !calendar && derivedDayAvailability.size === 0;
}

function inferTripDirection(trip: GoTrip): GoDirection | null {
    const headsign = (trip.trip_headsign || '').toLowerCase();

    if (headsign.includes('union') || headsign.includes('toronto')) {
        return 'southbound';
    }
    if (headsign.includes('allandale') || headsign.includes('barrie')) {
        return 'northbound';
    }

    // Fallback inference when headsign is unavailable.
    if (trip.direction_id === '0' || trip.direction_id === 0) return 'southbound';
    if (trip.direction_id === '1' || trip.direction_id === 1) return 'northbound';
    return null;
}

function resolveStationStopId(stationId: GoStationId): string {
    const cache = getCachedData();
    const configured = GO_STATIONS[stationId];
    if (!cache?.barrieStops?.length) return configured.stopId;

    const aliases = stationId === 'barrie-south'
        ? ['barrie south go']
        : ['allandale waterfront go'];

    const byName = cache.barrieStops.find(stop => aliases.some(alias => stop.stop_name.toLowerCase().includes(alias)));
    if (byName?.stop_id) return byName.stop_id;

    return configured.stopId;
}

function getStaticTimesForStation(
    stationId: GoStationId,
    direction: GoDirection
): Array<{ time: number; label: string }> {
    const baseTimes = direction === 'southbound'
        ? STATIC_GO_TRAIN_TIMES_ALLANDALE.southbound
        : STATIC_GO_TRAIN_TIMES_ALLANDALE.northbound;

    const offset = STATION_TIME_OFFSET_MINUTES[stationId];
    return baseTimes.map(t => ({
        time: t.time + offset,
        label: t.label
    }));
}

// Georgian College stops from platformConfig (code -> name)
export const GEORGIAN_COLLEGE_STOPS: Array<{ code: string; name: string }> = [
    { code: '327', name: 'Georgian College (327)' },
    { code: '328', name: 'Georgian College (328)' },
    { code: '329', name: 'Georgian College (329)' },
    { code: '330', name: 'Georgian College Main (330)' },
    { code: '331', name: 'Georgian College (331)' },
    { code: '335', name: 'Georgian College (335)' },
];

/**
 * Get Georgian College template data for pre-filling the Add Target form.
 * Includes class bell times (Weekdays only).
 */
export function getGeorgianCollegeTemplateData(_dayType: DayType): {
    name: string;
    location: string;
    stopCode: string;
    stops: Array<{ code: string; name: string; enabled: boolean }>;
    icon: 'clock';
    times: ConnectionTime[];
    autoPopulateStops: boolean;
} {
    // Georgian College bells are Weekday only
    const connectionTimes: ConnectionTime[] = GEORGIAN_CLASS_TIMES.map(t => ({
        id: generateConnectionId(),
        time: t.time,
        label: t.label,
        eventType: 'departure',
        daysActive: ['Weekday'],
        enabled: true
    }));

    return {
        name: 'Georgian College Bells',
        location: 'Georgian College',
        stopCode: '330',  // Default to main stop
        stops: GEORGIAN_COLLEGE_STOPS.map(s => ({ ...s, enabled: true })),
        icon: 'clock',
        times: connectionTimes,
        autoPopulateStops: true  // Enable auto-populate by default
    };
}

/**
 * Get GO Train times for a specific stop from cached GTFS data.
 * Falls back to static times if no cache or stop not found.
 */
export function getGoTrainTimesForStop(
    stopId: string,
    dayType: DayType,
    direction: 'southbound' | 'northbound' = 'southbound'
): ConnectionTime[] {
    return getGoTrainTimesForStopDetailed(stopId, dayType, direction).times;
}

export function getGoTrainTimesForStopDetailed(
    stopId: string,
    dayType: DayType,
    direction: 'southbound' | 'northbound' = 'southbound'
): { times: ConnectionTime[]; source: GoDataSource } {
    const cache = getCachedData();
    if (cache && cache.stopTimes.length > 0 && cache.trips.length > 0) {
        const tripById = new Map(cache.trips.map(t => [t.trip_id, t]));
        const calendarByService = new Map(cache.calendar.map(c => [c.service_id, c]));
        const derivedDayAvailability = buildServiceDayAvailabilityMap(cache.calendarDates);
        const seen = new Set<number>();

        const extracted = cache.stopTimes
            .filter(st => st.stop_id === stopId)
            .map(st => {
                const trip = tripById.get(st.trip_id);
                if (!trip) return null;
                const inferredDirection = inferTripDirection(trip);
                if (inferredDirection !== direction) return null;
                const service = calendarByService.get(trip.service_id);
                if (!isServiceActiveForDay(service, dayType, trip.service_id, derivedDayAvailability)) return null;
                const minutes = parseGtfsTime(st.departure_time);
                if (!Number.isFinite(minutes)) return null;
                if (seen.has(minutes)) return null;
                seen.add(minutes);
                return {
                    time: minutes,
                    label: direction === 'southbound' ? 'to Toronto' : 'from Toronto'
                };
            })
            .filter((v): v is { time: number; label: string } => !!v)
            .sort((a, b) => a.time - b.time);

        if (extracted.length > 0) {
            return {
                times: extracted.map(t => ({
                    id: generateConnectionId(),
                    time: t.time,
                    label: t.label,
                    eventType: direction === 'southbound' ? 'departure' : 'arrival',
                    daysActive: [dayType],
                    enabled: true
                })),
                source: 'gtfs'
            };
        }
    }

    const stationId = Object.entries(GO_STATIONS).find(([, station]) => station.stopId === stopId)?.[0] as GoStationId | undefined;
    const fallbackTimes = stationId
        ? getStaticTimesForStation(stationId, direction)
        : getStaticTimesForStation('allandale-waterfront', direction);

    return {
        times: fallbackTimes.map(t => ({
            id: generateConnectionId(),
            time: t.time,
            label: t.label,
            eventType: direction === 'southbound' ? 'departure' : 'arrival',
            daysActive: [dayType],
            enabled: true
        })),
        source: 'fallback'
    };
}

export function getGoStationTemplateData(
    stationId: GoStationId,
    dayType: DayType,
    direction: GoDirection
): {
    name: string;
    location: string;
    stopCode: string;
    icon: 'train';
    defaultEventType: 'departure' | 'arrival';
    times: ConnectionTime[];
    dataSource: GoDataSource;
} {
    const station = GO_STATIONS[stationId];
    const timesResult = getGoTrainTimesForStopDetailed(resolveStationStopId(stationId), dayType, direction);
    const defaultEventType: 'departure' | 'arrival' = direction === 'southbound' ? 'departure' : 'arrival';
    const labeledTimes = timesResult.times
        .sort((a, b) => a.time - b.time)
        .map(t => ({ ...t, label: t.label || 'GO Train' }));

    return {
        name: `${station.name} ${defaultEventType === 'departure' ? 'Departures' : 'Arrivals'}`,
        location: station.name,
        stopCode: station.stopCode,
        icon: 'train',
        defaultEventType,
        times: labeledTimes,
        dataSource: timesResult.source
    };
}

/**
 * Get available Barrie Line GO stops.
 */
export function getBarrieGoStops(): Array<{ id: string; name: string; stopCode: string }> {
    return [
        { id: 'barrie-south', name: 'Barrie South GO', stopCode: '725' },
        { id: 'allandale-waterfront', name: 'Barrie Allandale Waterfront GO', stopCode: '9003' },
    ];
}

/**
 * Parse GTFS time string (HH:MM:SS) to minutes from midnight.
 * Handles times > 24:00:00 for after-midnight service.
 */
export function parseGtfsTime(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length < 2) return 0;

    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);

    return hours * 60 + mins;
}

// === QUICK TEMPLATE OPTIONS ===

export interface QuickTemplateOption {
    id: string;
    name: string;
    description: string;
    icon: 'train' | 'clock';
    getData: (dayType: DayType) => {
        name: string;
        location: string;
        stopCode: string;
        icon: 'train' | 'clock';
        times: ConnectionTime[];
        dataSource?: GoDataSource;
    };
}

export const QUICK_TEMPLATES: QuickTemplateOption[] = [
    {
        id: 'go-barrie-south-departures',
        name: 'Barrie South GO Departures',
        description: 'Meet trains before departure',
        icon: 'train',
        getData: (dayType) => getGoStationTemplateData('barrie-south', dayType, 'southbound')
    },
    {
        id: 'go-barrie-south-arrivals',
        name: 'Barrie South GO Arrivals',
        description: 'Connect after train arrival',
        icon: 'train',
        getData: (dayType) => getGoStationTemplateData('barrie-south', dayType, 'northbound')
    },
    {
        id: 'go-allandale-waterfront-departures',
        name: 'Barrie Allandale Waterfront GO Departures',
        description: 'Meet trains before departure',
        icon: 'train',
        getData: (dayType) => getGoStationTemplateData('allandale-waterfront', dayType, 'southbound')
    },
    {
        id: 'go-allandale-waterfront-arrivals',
        name: 'Barrie Allandale Waterfront GO Arrivals',
        description: 'Connect after train arrival',
        icon: 'train',
        getData: (dayType) => getGoStationTemplateData('allandale-waterfront', dayType, 'northbound')
    },
    {
        id: 'georgian',
        name: 'Georgian College Classes',
        description: 'Class start & end times (auto-applies to all Georgian stops)',
        icon: 'clock',
        getData: (dayType) => getGeorgianCollegeTemplateData(dayType)
    }
];
