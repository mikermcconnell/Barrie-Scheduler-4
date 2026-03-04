/**
 * Student Pass Utilities
 *
 * GTFS trip-finding algorithm for student transit pass planning.
 * Finds direct and 1-transfer routes from a school zone to a school.
 */

import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import routesRaw from '../../gtfs/routes.txt?raw';
import calendarRaw from '../../gtfs/calendar.txt?raw';

import { getAllStopsWithCoords } from '../gtfs/gtfsStopLookup';
import type { GtfsStopWithCoords } from '../gtfs/gtfsStopLookup';
import { getRouteColor } from '../config/routeColors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchoolConfig {
    id: string;
    name: string;
    lat: number;
    lon: number;
    /** Bell start time as "HH:MM" */
    bellStart: string;
    /** Bell end time as "HH:MM" */
    bellEnd: string;
}

export type TransferQuality = 'tight' | 'good' | 'ok' | 'long';

export interface TransferInfo {
    quality: TransferQuality;
    /** Color hex for display */
    color: string;
    label: string;
    waitMinutes: number;
}

export interface TripLeg {
    routeShortName: string;
    routeColor: string;
    tripId: string;
    /** Departure from zone stop or transfer stop (minutes from midnight) */
    departureMinutes: number;
    /** Arrival at school stop or transfer stop (minutes from midnight) */
    arrivalMinutes: number;
    /** Stop name where this leg begins */
    fromStop: string;
    /** Stop name where this leg ends */
    toStop: string;
}

export interface StudentPassResult {
    found: boolean;
    isDirect: boolean;
    morningLegs: TripLeg[];
    afternoonLegs: TripLeg[];
    transfer?: TransferInfo;
    /** Next afternoon bus departure (minutes from midnight), if available */
    nextAfternoonDepartureMinutes?: number;
    /** Trips per hour on key route during AM peak (approx) */
    frequencyPerHour?: number;
}

export const BARRIE_SCHOOLS: SchoolConfig[] = [
    {
        id: 'barrie-north',
        name: 'Barrie North Collegiate',
        lat: 44.4112,
        lon: -79.6755,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'eastview',
        name: 'Eastview Secondary',
        lat: 44.3832,
        lon: -79.6636,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'innisdale',
        name: 'Innisdale Secondary',
        lat: 44.3916,
        lon: -79.7101,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'maple-ridge',
        name: 'Maple Ridge Secondary',
        lat: 44.3378,
        lon: -79.6658,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'st-josephs',
        name: "St. Joseph's High",
        lat: 44.3772,
        lon: -79.7143,
        bellStart: '08:30',
        bellEnd: '15:00',
    },
    {
        id: 'bear-creek',
        name: 'Bear Creek Secondary',
        lat: 44.3951,
        lon: -79.7362,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'georgian-college',
        name: 'Georgian College',
        lat: 44.4098,
        lon: -79.6634,
        bellStart: '08:00',
        bellEnd: '17:00',
    },
];

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon test.
 * @param point [lat, lon]
 * @param polygon Array of [lat, lon] vertices (closed or open ring)
 */
export function isPointInPolygon(
    point: [number, number],
    polygon: [number, number][]
): boolean {
    if (polygon.length < 3) return false;

    const [px, py] = point;
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];

        const intersects =
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

        if (intersects) inside = !inside;
    }

    return inside;
}

/**
 * Haversine distance in km between two lat/lon pairs.
 */
function haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find all GTFS stops inside or within bufferKm of a polygon.
 * Uses 200 m (0.2 km) buffer by default.
 */
export function findStopsInZone(
    polygon: [number, number][],
    bufferKm = 0.2
): GtfsStopWithCoords[] {
    const stops = getAllStopsWithCoords();
    return stops.filter((stop) => {
        if (isPointInPolygon([stop.lat, stop.lon], polygon)) return true;
        // Buffer: check if any polygon vertex is within bufferKm
        // (approximation — project point onto polygon and check nearest edge)
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const [alat, alon] = polygon[i];
            const [blat, blon] = polygon[j];

            // Closest point on segment to stop (flat-earth approximation for t)
            const dxAB = blon - alon;
            const dyAB = blat - alat;
            const dxAP = stop.lon - alon;
            const dyAP = stop.lat - alat;
            const lenSq = dxAB * dxAB + dyAB * dyAB;

            let closestLat: number, closestLon: number;
            if (lenSq === 0) {
                closestLat = alat;
                closestLon = alon;
            } else {
                const t = Math.max(0, Math.min(1, (dxAP * dxAB + dyAP * dyAB) / lenSq));
                closestLat = alat + t * dyAB;
                closestLon = alon + t * dxAB;
            }

            if (haversineKm(stop.lat, stop.lon, closestLat, closestLon) <= bufferKm) {
                return true;
            }
        }
        return false;
    });
}

/**
 * Find the single nearest GTFS stop to a school (by haversine distance).
 */
export function findNearestStopToSchool(school: SchoolConfig): GtfsStopWithCoords | null {
    const stops = getAllStopsWithCoords();
    let best: GtfsStopWithCoords | null = null;
    let bestDist = Infinity;

    for (const stop of stops) {
        const d = haversineKm(school.lat, school.lon, stop.lat, stop.lon);
        if (d < bestDist) {
            bestDist = d;
            best = stop;
        }
    }

    return best;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Parse "HH:MM:SS" or "HH:MM" GTFS time string to minutes from midnight.
 * Handles post-midnight values (e.g., "25:10:00" = 1510 min).
 */
export function parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.trim().split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return h * 60 + m;
}

/**
 * Format minutes from midnight as "H:MM AM/PM".
 */
export function minutesToDisplayTime(minutes: number): string {
    const normalized = minutes % 1440;
    let h = Math.floor(normalized / 60);
    const m = normalized % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, '0')} ${period}`;
}

// ─── GTFS data loaders (cached) ───────────────────────────────────────────────

interface ParsedStopTime {
    tripId: string;
    stopId: string;
    arrivalMinutes: number;
    departureMinutes: number;
    stopSequence: number;
}

interface ParsedTrip {
    tripId: string;
    routeId: string;
    serviceId: string;
}

interface ParsedRoute {
    routeId: string;
    routeShortName: string;
}

interface ParsedCalendar {
    serviceId: string;
    weekday: boolean;
}

// Module-level caches — parse once per session
let cachedStopTimes: ParsedStopTime[] | null = null;
let cachedTrips: Map<string, ParsedTrip> | null = null;
let cachedRoutes: Map<string, ParsedRoute> | null = null;
let cachedWeekdayServiceIds: Set<string> | null = null;

function parseCsvRowSimple(line: string): string[] {
    // Fast split — stop_times last column (stop_headsign) may have commas but we don't need it
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            values.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    values.push(current);
    return values;
}

function buildHeaderMap(headerLine: string): Map<string, number> {
    const headers = headerLine
        .replace(/^\uFEFF/, '')
        .split(',')
        .map((h) => h.trim().replace(/"/g, ''));
    const map = new Map<string, number>();
    headers.forEach((h, i) => map.set(h, i));
    return map;
}

export function loadStopTimes(): ParsedStopTime[] {
    if (cachedStopTimes) return cachedStopTimes;

    const lines = stopTimesRaw.trim().split(/\r?\n/);
    if (lines.length < 2) return (cachedStopTimes = []);

    const hdr = buildHeaderMap(lines[0]);
    const tripIdx = hdr.get('trip_id') ?? -1;
    const arrIdx = hdr.get('arrival_time') ?? -1;
    const depIdx = hdr.get('departure_time') ?? -1;
    const stopIdx = hdr.get('stop_id') ?? -1;
    const seqIdx = hdr.get('stop_sequence') ?? -1;

    const results: ParsedStopTime[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCsvRowSimple(line);
        const tripId = cols[tripIdx]?.trim();
        const stopId = cols[stopIdx]?.trim();
        const seqStr = cols[seqIdx]?.trim();
        const arrStr = cols[arrIdx]?.trim();
        const depStr = cols[depIdx]?.trim() || arrStr;
        if (!tripId || !stopId) continue;

        const stopSequence = parseInt(seqStr || '0', 10);
        const arrivalMinutes = arrStr ? parseTimeToMinutes(arrStr) : 0;
        const departureMinutes = depStr ? parseTimeToMinutes(depStr) : arrivalMinutes;

        results.push({ tripId, stopId, arrivalMinutes, departureMinutes, stopSequence });
    }

    cachedStopTimes = results;
    return results;
}

export function loadTrips(): Map<string, ParsedTrip> {
    if (cachedTrips) return cachedTrips;

    const lines = tripsRaw.trim().split(/\r?\n/);
    const map = new Map<string, ParsedTrip>();
    if (lines.length < 2) return (cachedTrips = map);

    const hdr = buildHeaderMap(lines[0]);
    const routeIdx = hdr.get('route_id') ?? -1;
    const svcIdx = hdr.get('service_id') ?? -1;
    const tripIdx = hdr.get('trip_id') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCsvRowSimple(line);
        const tripId = cols[tripIdx]?.trim();
        const routeId = cols[routeIdx]?.trim();
        const serviceId = cols[svcIdx]?.trim();
        if (!tripId || !routeId || !serviceId) continue;
        map.set(tripId, { tripId, routeId, serviceId });
    }

    cachedTrips = map;
    return map;
}

export function loadRoutes(): Map<string, ParsedRoute> {
    if (cachedRoutes) return cachedRoutes;

    const lines = routesRaw.trim().split(/\r?\n/);
    const map = new Map<string, ParsedRoute>();
    if (lines.length < 2) return (cachedRoutes = map);

    const hdr = buildHeaderMap(lines[0]);
    const routeIdx = hdr.get('route_id') ?? -1;
    const shortIdx = hdr.get('route_short_name') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCsvRowSimple(line);
        const routeId = cols[routeIdx]?.trim();
        const shortName = cols[shortIdx]?.trim();
        if (!routeId || !shortName) continue;
        map.set(routeId, { routeId, routeShortName: shortName });
    }

    cachedRoutes = map;
    return map;
}

export function loadWeekdayServiceIds(): Set<string> {
    if (cachedWeekdayServiceIds) return cachedWeekdayServiceIds;

    const lines = calendarRaw.trim().split(/\r?\n/);
    const set = new Set<string>();
    if (lines.length < 2) return (cachedWeekdayServiceIds = set);

    const hdr = buildHeaderMap(lines[0]);
    const svcIdx = hdr.get('service_id') ?? -1;
    const monIdx = hdr.get('monday') ?? -1;
    const tueIdx = hdr.get('tuesday') ?? -1;
    const wedIdx = hdr.get('wednesday') ?? -1;
    const thuIdx = hdr.get('thursday') ?? -1;
    const friIdx = hdr.get('friday') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCsvRowSimple(line);
        const svcId = cols[svcIdx]?.trim();
        if (!svcId) continue;

        const weekdaySum =
            parseInt(cols[monIdx] || '0', 10) +
            parseInt(cols[tueIdx] || '0', 10) +
            parseInt(cols[wedIdx] || '0', 10) +
            parseInt(cols[thuIdx] || '0', 10) +
            parseInt(cols[friIdx] || '0', 10);

        if (weekdaySum > 0) set.add(svcId);
    }

    cachedWeekdayServiceIds = set;
    return set;
}

// ─── Transfer quality ─────────────────────────────────────────────────────────

/**
 * Rate transfer wait time and return quality metadata.
 */
export function getTransferQuality(waitMinutes: number): TransferInfo {
    if (waitMinutes < 5) {
        return {
            quality: 'tight',
            color: '#EF4444',
            label: 'Tight connection',
            waitMinutes,
        };
    }
    if (waitMinutes <= 10) {
        return {
            quality: 'good',
            color: '#22C55E',
            label: 'Good connection',
            waitMinutes,
        };
    }
    if (waitMinutes <= 15) {
        return {
            quality: 'ok',
            color: '#F59E0B',
            label: 'OK connection',
            waitMinutes,
        };
    }
    return {
        quality: 'long',
        color: '#EF4444',
        label: 'Long wait',
        waitMinutes,
    };
}

// ─── Index helpers ────────────────────────────────────────────────────────────

/**
 * Build a map of stop_id → stop name using the coords data.
 */
function buildStopIdToName(): Map<string, string> {
    const stops = getAllStopsWithCoords();
    const map = new Map<string, string>();
    for (const s of stops) {
        map.set(s.stop_id, s.stop_name);
    }
    return map;
}

let cachedStopIdToName: Map<string, string> | null = null;
function getStopIdToName(): Map<string, string> {
    if (!cachedStopIdToName) cachedStopIdToName = buildStopIdToName();
    return cachedStopIdToName;
}

/**
 * Build a map: trip_id → sorted stop times array (by sequence).
 */
function buildTripStopTimesIndex(
    stopTimes: ParsedStopTime[]
): Map<string, ParsedStopTime[]> {
    const index = new Map<string, ParsedStopTime[]>();
    for (const st of stopTimes) {
        const arr = index.get(st.tripId);
        if (arr) arr.push(st);
        else index.set(st.tripId, [st]);
    }
    // Sort each trip's stop times by sequence
    for (const arr of index.values()) {
        arr.sort((a, b) => a.stopSequence - b.stopSequence);
    }
    return index;
}

let cachedTripStopTimesIndex: Map<string, ParsedStopTime[]> | null = null;
function getTripStopTimesIndex(): Map<string, ParsedStopTime[]> {
    if (!cachedTripStopTimesIndex) {
        cachedTripStopTimesIndex = buildTripStopTimesIndex(loadStopTimes());
    }
    return cachedTripStopTimesIndex;
}

/**
 * Build a map: stop_id → list of { tripId, stopSequence, arrivalMinutes, departureMinutes }.
 */
function buildStopToTripsIndex(
    stopTimes: ParsedStopTime[]
): Map<string, ParsedStopTime[]> {
    const index = new Map<string, ParsedStopTime[]>();
    for (const st of stopTimes) {
        const arr = index.get(st.stopId);
        if (arr) arr.push(st);
        else index.set(st.stopId, [st]);
    }
    return index;
}

let cachedStopToTripsIndex: Map<string, ParsedStopTime[]> | null = null;
function getStopToTripsIndex(): Map<string, ParsedStopTime[]> {
    if (!cachedStopToTripsIndex) {
        cachedStopToTripsIndex = buildStopToTripsIndex(loadStopTimes());
    }
    return cachedStopToTripsIndex;
}

// ─── Core algorithm ───────────────────────────────────────────────────────────

/**
 * Find the best morning trip (direct or 1-transfer) from zone stops to school.
 *
 * @param zoneStopIds  Set of stop_ids in the student's zone
 * @param schoolStopId The stop_id nearest to the school
 * @param bellStartMinutes School bell start time in minutes from midnight
 */
function findBestMorningDirect(
    zoneStopIds: Set<string>,
    schoolStopId: string,
    bellStartMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>
): {
    leg: TripLeg;
} | null {
    // Candidate: { zoneDepMinutes, schoolArrMinutes, travelMinutes, tripId, routeShortName, zoneStopId }
    let best: {
        zoneDepMinutes: number;
        schoolArrMinutes: number;
        travelMinutes: number;
        tripId: string;
        routeShortName: string;
        zoneStopId: string;
    } | null = null;

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip) continue;
        if (!weekdayServiceIds.has(trip.serviceId)) continue;

        const route = routes.get(trip.routeId);
        if (!route) continue;

        // Find zone stop visit and school stop visit in sequence order
        let zoneEntry: ParsedStopTime | null = null;
        let schoolEntry: ParsedStopTime | null = null;

        for (const st of stopTimes) {
            if (zoneStopIds.has(st.stopId) && zoneEntry === null) {
                zoneEntry = st;
            }
            if (st.stopId === schoolStopId && zoneEntry !== null && st.stopSequence > zoneEntry.stopSequence) {
                schoolEntry = st;
                break;
            }
        }

        if (!zoneEntry || !schoolEntry) continue;
        if (schoolEntry.arrivalMinutes > bellStartMinutes) continue;

        const travelMinutes = schoolEntry.arrivalMinutes - zoneEntry.departureMinutes;

        // Rank: latest departure first (minimize wait), then shortest travel
        const isBetter =
            best === null ||
            zoneEntry.departureMinutes > best.zoneDepMinutes ||
            (zoneEntry.departureMinutes === best.zoneDepMinutes && travelMinutes < best.travelMinutes);

        if (isBetter) {
            best = {
                zoneDepMinutes: zoneEntry.departureMinutes,
                schoolArrMinutes: schoolEntry.arrivalMinutes,
                travelMinutes,
                tripId,
                routeShortName: route.routeShortName,
                zoneStopId: zoneEntry.stopId,
            };
        }
    }

    if (!best) return null;

    const stopIdToName = getStopIdToName();
    return {
        leg: {
            routeShortName: best.routeShortName,
            routeColor: getRouteColor(best.routeShortName),
            tripId: best.tripId,
            departureMinutes: best.zoneDepMinutes,
            arrivalMinutes: best.schoolArrMinutes,
            fromStop: stopIdToName.get(best.zoneStopId) ?? best.zoneStopId,
            toStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
        },
    };
}

/**
 * Find the best morning 1-transfer trip from zone stops to school.
 */
function findBestMorningTransfer(
    zoneStopIds: Set<string>,
    schoolStopId: string,
    bellStartMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>,
    stopToTripsIndex: Map<string, ParsedStopTime[]>
): {
    legA: TripLeg;
    legB: TripLeg;
    transfer: TransferInfo;
    transferStopName: string;
} | null {
    // Find Route A candidates: trips that serve any zone stop
    // Find Route B candidates: trips that serve the school stop
    // Find shared transfer stops

    // Build set of route_ids for A (serve zone) and B (serve school)
    const routeATrips = new Map<string, string[]>(); // routeId → tripIds that serve zone stops
    const routeBTrips = new Map<string, string[]>(); // routeId → tripIds that serve school stop

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServiceIds.has(trip.serviceId)) continue;

        const servesZone = stopTimes.some((st) => zoneStopIds.has(st.stopId));
        const servesSchool = stopTimes.some((st) => st.stopId === schoolStopId);

        if (servesZone) {
            const arr = routeATrips.get(trip.routeId) ?? [];
            arr.push(tripId);
            routeATrips.set(trip.routeId, arr);
        }
        if (servesSchool) {
            const arr = routeBTrips.get(trip.routeId) ?? [];
            arr.push(tripId);
            routeBTrips.set(trip.routeId, arr);
        }
    }

    // For each route B trip, collect the stop_ids it serves (before school stop, in order)
    // For each route A trip, collect the stop_ids it serves (after zone stop, in order)
    // Find overlapping stop_ids = potential transfer points

    // This is O(A × B) — acceptable for city-scale GTFS (<1000 trips)
    const stopIdToName = getStopIdToName();

    let best: {
        qualityScore: number; // 2=good, 1=ok/tight/long, for ranking
        zoneDepMinutes: number;
        transferStopId: string;
        aTripId: string;
        aRouteId: string;
        aZoneStopId: string;
        aArrivalAtTransfer: number;
        bTripId: string;
        bRouteId: string;
        bDepFromTransfer: number;
        bArrivalAtSchool: number;
        waitMinutes: number;
    } | null = null;

    for (const [aRouteId, aTripIds] of routeATrips) {
        for (const [bRouteId, bTripIds] of routeBTrips) {
            if (aRouteId === bRouteId) continue; // same route — not a real transfer

            // For each A trip, find zone stop entry and its subsequent stops
            for (const aTripId of aTripIds) {
                const aStops = tripStopIndex.get(aTripId);
                if (!aStops) continue;

                // Find first zone stop in this trip
                const zoneIdx = aStops.findIndex((st) => zoneStopIds.has(st.stopId));
                if (zoneIdx === -1) continue;

                const zoneEntry = aStops[zoneIdx];

                // Stops reachable after zone entry
                const aSubsequentStops = aStops.slice(zoneIdx + 1);

                // For each B trip, find school stop entry and its preceding stops
                for (const bTripId of bTripIds) {
                    const bStops = tripStopIndex.get(bTripId);
                    if (!bStops) continue;

                    const schoolIdx = bStops.findIndex((st) => st.stopId === schoolStopId);
                    if (schoolIdx === -1) continue;
                    if (bStops[schoolIdx].arrivalMinutes > bellStartMinutes) continue;

                    const bPrecedingStops = bStops.slice(0, schoolIdx);

                    // Find shared stops between A (after zone) and B (before school)
                    const bStopIds = new Set(bPrecedingStops.map((s) => s.stopId));

                    for (const aSt of aSubsequentStops) {
                        if (!bStopIds.has(aSt.stopId)) continue;

                        const transferStopId = aSt.stopId;
                        const aArrivalAtTransfer = aSt.arrivalMinutes;

                        // Find B's departure from this transfer stop
                        const bTransferEntry = bPrecedingStops.find(
                            (s) => s.stopId === transferStopId && s.departureMinutes >= aArrivalAtTransfer
                        );
                        if (!bTransferEntry) continue;

                        const waitMinutes = bTransferEntry.departureMinutes - aArrivalAtTransfer;
                        if (waitMinutes < 0 || waitMinutes > 30) continue;

                        const bSchoolSt = bStops[schoolIdx];
                        const quality = getTransferQuality(waitMinutes);

                        // Rank: prefer 'good' quality (score 2), then latest A departure, then shortest total
                        const qualityScore = quality.quality === 'good' ? 2 : 1;
                        const isBetter =
                            best === null ||
                            qualityScore > best.qualityScore ||
                            (qualityScore === best.qualityScore &&
                                zoneEntry.departureMinutes > best.zoneDepMinutes);

                        if (isBetter) {
                            best = {
                                qualityScore,
                                zoneDepMinutes: zoneEntry.departureMinutes,
                                transferStopId,
                                aTripId,
                                aRouteId,
                                aZoneStopId: zoneEntry.stopId,
                                aArrivalAtTransfer,
                                bTripId,
                                bRouteId,
                                bDepFromTransfer: bTransferEntry.departureMinutes,
                                bArrivalAtSchool: bSchoolSt.arrivalMinutes,
                                waitMinutes,
                            };
                        }
                    }
                }
            }
        }
    }

    if (!best) return null;

    const aRoute = routes.get(best.aRouteId);
    const bRoute = routes.get(best.bRouteId);
    const aShortName = aRoute?.routeShortName ?? best.aRouteId;
    const bShortName = bRoute?.routeShortName ?? best.bRouteId;
    const transferStopName = stopIdToName.get(best.transferStopId) ?? best.transferStopId;

    return {
        legA: {
            routeShortName: aShortName,
            routeColor: getRouteColor(aShortName),
            tripId: best.aTripId,
            departureMinutes: best.zoneDepMinutes,
            arrivalMinutes: best.aArrivalAtTransfer,
            fromStop: stopIdToName.get(best.aZoneStopId) ?? best.aZoneStopId,
            toStop: transferStopName,
        },
        legB: {
            routeShortName: bShortName,
            routeColor: getRouteColor(bShortName),
            tripId: best.bTripId,
            departureMinutes: best.bDepFromTransfer,
            arrivalMinutes: best.bArrivalAtSchool,
            fromStop: transferStopName,
            toStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
        },
        transfer: getTransferQuality(best.waitMinutes),
        transferStopName,
    };
}

/**
 * Find afternoon return trip from school to zone stops.
 * Returns first bus departing school ≥ bellEndMinutes, and next bus time.
 */
export function findAfternoonTrip(
    schoolStopId: string,
    zoneStopIds: Set<string>,
    bellEndMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>
): { leg: TripLeg; nextDepartureMinutes?: number } | null {
    const stopIdToName = getStopIdToName();

    let first: {
        depMinutes: number;
        arrMinutes: number;
        tripId: string;
        routeShortName: string;
        zoneStopId: string;
    } | null = null;

    let second: { depMinutes: number } | null = null;

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServiceIds.has(trip.serviceId)) continue;

        const route = routes.get(trip.routeId);
        if (!route) continue;

        // School stop must appear before a zone stop
        const schoolIdx = stopTimes.findIndex((st) => st.stopId === schoolStopId);
        if (schoolIdx === -1) continue;

        const schoolEntry = stopTimes[schoolIdx];
        if (schoolEntry.departureMinutes < bellEndMinutes) continue;

        // Find zone stop after school
        const zoneEntry = stopTimes.slice(schoolIdx + 1).find((st) => zoneStopIds.has(st.stopId));
        if (!zoneEntry) continue;

        const depMin = schoolEntry.departureMinutes;

        if (first === null || depMin < first.depMinutes) {
            if (first !== null) {
                // Former first becomes candidate for second
                if (second === null || first.depMinutes < second.depMinutes) {
                    second = { depMinutes: first.depMinutes };
                }
            }
            first = {
                depMinutes: depMin,
                arrMinutes: zoneEntry.arrivalMinutes,
                tripId,
                routeShortName: route.routeShortName,
                zoneStopId: zoneEntry.stopId,
            };
        } else if (second === null || depMin < second.depMinutes) {
            if (depMin > first.depMinutes) {
                second = { depMinutes: depMin };
            }
        }
    }

    if (!first) return null;

    return {
        leg: {
            routeShortName: first.routeShortName,
            routeColor: getRouteColor(first.routeShortName),
            tripId: first.tripId,
            departureMinutes: first.depMinutes,
            arrivalMinutes: first.arrMinutes,
            fromStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
            toStop: stopIdToName.get(first.zoneStopId) ?? first.zoneStopId,
        },
        nextDepartureMinutes: second?.depMinutes,
    };
}

/**
 * Calculate approximate trips per hour for a route during AM peak (7-9 AM).
 */
export function calculateFrequency(
    routeShortName: string,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>
): number {
    const AM_PEAK_START = 7 * 60; // 7:00 AM
    const AM_PEAK_END = 9 * 60; // 9:00 AM

    // Find route_id for this short name
    const matchingRouteIds = new Set<string>();
    for (const [routeId, route] of routes) {
        if (route.routeShortName.toUpperCase() === routeShortName.toUpperCase()) {
            matchingRouteIds.add(routeId);
        }
    }

    let count = 0;
    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServiceIds.has(trip.serviceId)) continue;
        if (!matchingRouteIds.has(trip.routeId)) continue;

        // Use first stop departure to determine if this trip is in AM peak
        const firstSt = stopTimes[0];
        if (!firstSt) continue;
        if (firstSt.departureMinutes >= AM_PEAK_START && firstSt.departureMinutes < AM_PEAK_END) {
            count++;
        }
    }

    // 2-hour window → trips per hour
    return count / 2;
}

/**
 * Find routes that serve a given set of stops (for showing connecting route options).
 */
export function findConnectingRoutes(
    stopIds: Set<string>,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>
): string[] {
    const routeShortNames = new Set<string>();

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServiceIds.has(trip.serviceId)) continue;

        const servesStop = stopTimes.some((st) => stopIds.has(st.stopId));
        if (!servesStop) continue;

        const route = routes.get(trip.routeId);
        if (route) routeShortNames.add(route.routeShortName);
    }

    return Array.from(routeShortNames).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
    );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Find the best transit option from a student's zone to a school.
 *
 * @param zonePolygon  Array of [lat, lon] vertices defining the student's zone
 * @param school       School configuration (bell times, coordinates)
 */
export function findBestTrip(
    zonePolygon: [number, number][],
    school: SchoolConfig
): StudentPassResult {
    const bellStartMinutes = parseTimeToMinutes(school.bellStart + ':00');
    const bellEndMinutes = parseTimeToMinutes(school.bellEnd + ':00');

    // Load / use cached GTFS data
    const trips = loadTrips();
    const routes = loadRoutes();
    const weekdayServiceIds = loadWeekdayServiceIds();
    const tripStopIndex = getTripStopTimesIndex();
    const stopToTripsIndex = getStopToTripsIndex();

    // Find zone stops
    const zoneStops = findStopsInZone(zonePolygon);
    const zoneStopIds = new Set(zoneStops.map((s) => s.stop_id));

    if (zoneStopIds.size === 0) {
        return { found: false, isDirect: false, morningLegs: [], afternoonLegs: [] };
    }

    // Find nearest stop to school
    const schoolStop = findNearestStopToSchool(school);
    if (!schoolStop) {
        return { found: false, isDirect: false, morningLegs: [], afternoonLegs: [] };
    }
    const schoolStopId = schoolStop.stop_id;

    // Try direct trip first
    const directResult = findBestMorningDirect(
        zoneStopIds,
        schoolStopId,
        bellStartMinutes,
        trips,
        routes,
        weekdayServiceIds,
        tripStopIndex
    );

    if (directResult) {
        // Find afternoon return
        const afternoonResult = findAfternoonTrip(
            schoolStopId,
            zoneStopIds,
            bellEndMinutes,
            trips,
            routes,
            weekdayServiceIds,
            tripStopIndex
        );

        const freq = calculateFrequency(
            directResult.leg.routeShortName,
            trips,
            routes,
            weekdayServiceIds,
            tripStopIndex
        );

        return {
            found: true,
            isDirect: true,
            morningLegs: [directResult.leg],
            afternoonLegs: afternoonResult ? [afternoonResult.leg] : [],
            nextAfternoonDepartureMinutes: afternoonResult?.nextDepartureMinutes,
            frequencyPerHour: freq,
        };
    }

    // Try 1-transfer trip
    const transferResult = findBestMorningTransfer(
        zoneStopIds,
        schoolStopId,
        bellStartMinutes,
        trips,
        routes,
        weekdayServiceIds,
        tripStopIndex,
        stopToTripsIndex
    );

    if (transferResult) {
        const afternoonResult = findAfternoonTrip(
            schoolStopId,
            zoneStopIds,
            bellEndMinutes,
            trips,
            routes,
            weekdayServiceIds,
            tripStopIndex
        );

        const freq = calculateFrequency(
            transferResult.legA.routeShortName,
            trips,
            routes,
            weekdayServiceIds,
            tripStopIndex
        );

        return {
            found: true,
            isDirect: false,
            morningLegs: [transferResult.legA, transferResult.legB],
            afternoonLegs: afternoonResult ? [afternoonResult.leg] : [],
            transfer: transferResult.transfer,
            nextAfternoonDepartureMinutes: afternoonResult?.nextDepartureMinutes,
            frequencyPerHour: freq,
        };
    }

    return { found: false, isDirect: false, morningLegs: [], afternoonLegs: [] };
}
