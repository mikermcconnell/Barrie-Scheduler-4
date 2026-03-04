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
import { loadGtfsRouteShapes } from '../gtfs/gtfsShapesLoader';

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

export interface RouteOption {
    id: string;
    label: string;
    result: StudentPassResult;
}

export interface TripOptions {
    morningOptions: RouteOption[];
    afternoonOptions: RouteOption[];
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
    /** Stop id where this leg begins */
    fromStopId: string;
    /** Stop id where this leg ends */
    toStopId: string;
    /** Departure from zone stop or transfer stop (minutes from midnight) */
    departureMinutes: number;
    /** Arrival at school stop or transfer stop (minutes from midnight) */
    arrivalMinutes: number;
    /** Stop name where this leg begins */
    fromStop: string;
    /** Stop name where this leg ends */
    toStop: string;
}

export interface WalkLeg {
    fromLat: number;
    fromLon: number;
    toLat: number;
    toLon: number;
    distanceKm: number;
    /** Walking time in minutes at ~5 km/h */
    walkMinutes: number;
    label: string;
}

export interface RouteShapeSegment {
    routeShortName: string;
    routeColor: string;
    /** Actual GTFS shape points for this route segment [lat, lon][] */
    points: [number, number][];
    isDashed: boolean;
}

export interface StudentPassResult {
    found: boolean;
    isDirect: boolean;
    morningLegs: TripLeg[];
    afternoonLegs: TripLeg[];
    transfer?: TransferInfo;
    /** Transfer info for 2-transfer trips (length 2) */
    transfers?: TransferInfo[];
    /** Next afternoon bus departure (minutes from midnight), if available */
    nextAfternoonDepartureMinutes?: number;
    /** Trips per hour on key route during AM peak (approx) */
    frequencyPerHour?: number;
    /** Centroid of the drawn zone polygon */
    zoneCentroid?: [number, number];
    /** Walk from zone centroid to boarding stop */
    walkToStop?: WalkLeg;
    /** Walk from alighting stop to school */
    walkToSchool?: WalkLeg;
    /** Actual GTFS route shape segments for map display (morning) */
    routeShapes?: RouteShapeSegment[];
    /** Afternoon route shape segments */
    afternoonRouteShapes?: RouteShapeSegment[];
    /** Walk from school to afternoon boarding stop */
    walkFromSchool?: WalkLeg;
    /** Walk from afternoon alighting stop back to zone centroid */
    walkToZone?: WalkLeg;
}

export const BARRIE_SCHOOLS: SchoolConfig[] = [
    {
        id: 'barrie-north',
        name: 'Barrie North Collegiate',
        lat: 44.4012,
        lon: -79.6901,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'eastview',
        name: 'Eastview Secondary',
        lat: 44.4049,
        lon: -79.6616,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'innisdale',
        name: 'Innisdale Secondary',
        lat: 44.3594,
        lon: -79.6854,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'maple-ridge',
        name: 'Maple Ridge Secondary',
        lat: 44.3509,
        lon: -79.6086,
        bellStart: '08:45',
        bellEnd: '15:10',
    },
    {
        id: 'st-josephs',
        name: "St. Joseph's High",
        lat: 44.4125,
        lon: -79.6837,
        bellStart: '08:30',
        bellEnd: '15:00',
    },
    {
        id: 'bear-creek',
        name: 'Bear Creek Secondary',
        lat: 44.3319,
        lon: -79.7337,
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

// ─── Polygon centroid ─────────────────────────────────────────────────────────

/**
 * Compute centroid (average lat/lon) of a polygon.
 */
export function getPolygonCentroid(polygon: [number, number][]): [number, number] {
    let latSum = 0;
    let lonSum = 0;
    for (const [lat, lon] of polygon) {
        latSum += lat;
        lonSum += lon;
    }
    return [latSum / polygon.length, lonSum / polygon.length];
}

// ─── Walking helpers ──────────────────────────────────────────────────────────

const WALK_SPEED_KMH = 5;

/**
 * Build a WalkLeg between two points.
 */
export function buildWalkLeg(
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number,
    label: string
): WalkLeg {
    const distanceKm = haversineKm(fromLat, fromLon, toLat, toLon);
    const walkMinutes = Math.round((distanceKm / WALK_SPEED_KMH) * 60);
    return { fromLat, fromLon, toLat, toLon, distanceKm, walkMinutes, label };
}

// ─── GTFS shape segment extraction ───────────────────────────────────────────

/**
 * Find the closest index on a polyline to a given point (by haversine).
 */
function findClosestPointIndex(
    polyline: [number, number][],
    lat: number,
    lon: number
): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < polyline.length; i++) {
        const d = haversineKm(lat, lon, polyline[i][0], polyline[i][1]);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/**
 * Extract the sub-polyline of a route shape between two stops.
 * Returns the GTFS shape points clipped to the segment, or a straight line fallback.
 */
export function getRouteShapeSegment(
    routeShortName: string,
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number
): [number, number][] {
    const shapes = loadGtfsRouteShapes();
    const shape = shapes.find(
        (s) => s.routeShortName.toUpperCase() === routeShortName.toUpperCase()
    );

    if (!shape || shape.points.length < 2) {
        // Fallback: straight line
        return [[fromLat, fromLon], [toLat, toLon]];
    }

    const startIdx = findClosestPointIndex(shape.points, fromLat, fromLon);
    const endIdx = findClosestPointIndex(shape.points, toLat, toLon);

    if (startIdx === endIdx) {
        return [[fromLat, fromLon], [toLat, toLon]];
    }

    // Extract segment in correct direction
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const segment = shape.points.slice(lo, hi + 1);

    // If start was after end in the shape, reverse so it flows from → to
    if (startIdx > endIdx) {
        segment.reverse();
    }

    return segment;
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

// ─── Transfer clusters ───────────────────────────────────────────────────────

/**
 * Build clusters of co-located stops (within 150m).
 * Returns a map where each stop_id maps to the Set of all stop_ids in its cluster.
 */
function buildTransferClusters(): Map<string, Set<string>> {
    const stops = getAllStopsWithCoords();
    const CLUSTER_RADIUS_KM = 0.15; // 150m

    // Union-Find: merge stops within radius
    const parent = new Map<string, string>();
    for (const s of stops) parent.set(s.stop_id, s.stop_id);

    function find(id: string): string {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root)!;
        let cur = id;
        while (cur !== root) {
            const next = parent.get(cur)!;
            parent.set(cur, root);
            cur = next;
        }
        return root;
    }

    function union(a: string, b: string): void {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    }

    // O(n²) but n ≈ 500 stops in Barrie — fine
    for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
            const dist = haversineKm(stops[i].lat, stops[i].lon, stops[j].lat, stops[j].lon);
            if (dist <= CLUSTER_RADIUS_KM) {
                union(stops[i].stop_id, stops[j].stop_id);
            }
        }
    }

    // Group by root
    const groups = new Map<string, Set<string>>();
    for (const s of stops) {
        const root = find(s.stop_id);
        const set = groups.get(root) ?? new Set<string>();
        set.add(s.stop_id);
        groups.set(root, set);
    }

    // Build per-stop lookup
    const result = new Map<string, Set<string>>();
    for (const cluster of groups.values()) {
        for (const id of cluster) {
            result.set(id, cluster);
        }
    }
    return result;
}

let cachedTransferClusters: Map<string, Set<string>> | null = null;
function getTransferClusters(): Map<string, Set<string>> {
    if (!cachedTransferClusters) cachedTransferClusters = buildTransferClusters();
    return cachedTransferClusters;
}

export function getClusterStopIds(stopId: string): Set<string> {
    const clusters = getTransferClusters();
    return clusters.get(stopId) ?? new Set([stopId]);
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

// ─── Core algorithm ───────────────────────────────────────────────────────────

interface DirectCandidate {
    zoneDepMinutes: number;
    schoolArrMinutes: number;
    travelMinutes: number;
    tripId: string;
    routeShortName: string;
    zoneStopId: string;
    distToCentroid: number;
}

/**
 * Find up to 3 morning direct route options within 30 min of bell start.
 * Groups by route short name, picks best candidate per route, sorts by latest arrival.
 */
function findMorningDirectOptions(
    zoneStopIds: Set<string>,
    schoolStopId: string,
    bellStartMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>,
    centroid: [number, number],
    stopCoords: Map<string, { lat: number; lon: number }>
): { leg: TripLeg }[] {
    const candidates: DirectCandidate[] = [];

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip) continue;
        if (!weekdayServiceIds.has(trip.serviceId)) continue;

        const route = routes.get(trip.routeId);
        if (!route) continue;

        const schoolEntry = stopTimes.find((st) => st.stopId === schoolStopId);
        if (!schoolEntry) continue;

        // 30-min window: must arrive within 30 min before bell and not after bell
        if (schoolEntry.arrivalMinutes > bellStartMinutes) continue;
        if (schoolEntry.arrivalMinutes < bellStartMinutes - 30) continue;

        // Find zone stop closest to centroid on this trip
        let bestZoneSt: ParsedStopTime | null = null;
        let bestDist = Infinity;
        for (const st of stopTimes) {
            if (!zoneStopIds.has(st.stopId)) continue;
            if (st.stopSequence >= schoolEntry.stopSequence) continue;
            const coords = stopCoords.get(st.stopId);
            const dist = coords
                ? haversineKm(centroid[0], centroid[1], coords.lat, coords.lon)
                : Infinity;
            if (dist < bestDist) {
                bestDist = dist;
                bestZoneSt = st;
            }
        }
        if (!bestZoneSt) continue;

        candidates.push({
            zoneDepMinutes: bestZoneSt.departureMinutes,
            schoolArrMinutes: schoolEntry.arrivalMinutes,
            travelMinutes: schoolEntry.arrivalMinutes - bestZoneSt.departureMinutes,
            tripId,
            routeShortName: route.routeShortName,
            zoneStopId: bestZoneSt.stopId,
            distToCentroid: bestDist,
        });
    }

    // Group by route short name — pick best candidate per route (latest arrival, then closest to centroid)
    const byRoute = new Map<string, DirectCandidate>();
    for (const c of candidates) {
        const existing = byRoute.get(c.routeShortName);
        if (
            !existing ||
            c.schoolArrMinutes > existing.schoolArrMinutes ||
            (c.schoolArrMinutes === existing.schoolArrMinutes && c.distToCentroid < existing.distToCentroid)
        ) {
            byRoute.set(c.routeShortName, c);
        }
    }

    // Sort by latest arrival (closest to bell) first
    const sorted = Array.from(byRoute.values()).sort(
        (a, b) => b.schoolArrMinutes - a.schoolArrMinutes
    );

    const stopIdToName = getStopIdToName();
    return sorted.slice(0, 3).map((c) => ({
        leg: {
            routeShortName: c.routeShortName,
            routeColor: getRouteColor(c.routeShortName),
            tripId: c.tripId,
            fromStopId: c.zoneStopId,
            toStopId: schoolStopId,
            departureMinutes: c.zoneDepMinutes,
            arrivalMinutes: c.schoolArrMinutes,
            fromStop: stopIdToName.get(c.zoneStopId) ?? c.zoneStopId,
            toStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
        },
    }));
}

interface TransferCandidate {
    qualityScore: number;
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
    comboKey: string;
}

/**
 * Find up to 3 morning 1-transfer route options within 30 min of bell start.
 * Groups by route-A + route-B combo, picks best per combo, sorts by quality then arrival.
 */
function findMorningTransferOptions(
    zoneStopIds: Set<string>,
    schoolStopId: string,
    bellStartMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>,
    centroid: [number, number],
    stopCoords: Map<string, { lat: number; lon: number }>
): {
    legA: TripLeg;
    legB: TripLeg;
    transfer: TransferInfo;
    transferStopName: string;
}[] {
    const routeATrips = new Map<string, string[]>();
    const routeBTrips = new Map<string, string[]>();

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

    const stopIdToName = getStopIdToName();
    const candidates: TransferCandidate[] = [];

    for (const [aRouteId, aTripIds] of routeATrips) {
        for (const [bRouteId, bTripIds] of routeBTrips) {
            if (aRouteId === bRouteId) continue;

            for (const aTripId of aTripIds) {
                const aStops = tripStopIndex.get(aTripId);
                if (!aStops) continue;

                let zoneEntry: ParsedStopTime | null = null;
                let zoneIdx = -1;
                let bestDist = Infinity;
                for (let si = 0; si < aStops.length; si++) {
                    const st = aStops[si];
                    if (!zoneStopIds.has(st.stopId)) continue;
                    const coords = stopCoords.get(st.stopId);
                    const dist = coords ? haversineKm(centroid[0], centroid[1], coords.lat, coords.lon) : Infinity;
                    if (dist < bestDist) {
                        bestDist = dist;
                        zoneEntry = st;
                        zoneIdx = si;
                    }
                }
                if (!zoneEntry || zoneIdx === -1) continue;

                const aSubsequentStops = aStops.slice(zoneIdx + 1);

                for (const bTripId of bTripIds) {
                    const bStops = tripStopIndex.get(bTripId);
                    if (!bStops) continue;

                    const schoolIdx = bStops.findIndex((st) => st.stopId === schoolStopId);
                    if (schoolIdx === -1) continue;

                    const bSchoolSt = bStops[schoolIdx];
                    // 30-min window
                    if (bSchoolSt.arrivalMinutes > bellStartMinutes) continue;
                    if (bSchoolSt.arrivalMinutes < bellStartMinutes - 30) continue;

                    const bPrecedingStops = bStops.slice(0, schoolIdx);
                    const bStopIds = new Set(bPrecedingStops.map((s) => s.stopId));

                    for (const aSt of aSubsequentStops) {
                        if (!bStopIds.has(aSt.stopId)) continue;

                        const transferStopId = aSt.stopId;
                        const aArrivalAtTransfer = aSt.arrivalMinutes;

                        const bTransferEntry = bPrecedingStops.find(
                            (s) => s.stopId === transferStopId && s.departureMinutes >= aArrivalAtTransfer
                        );
                        if (!bTransferEntry) continue;

                        const waitMinutes = bTransferEntry.departureMinutes - aArrivalAtTransfer;
                        if (waitMinutes < 0 || waitMinutes > 30) continue;

                        const quality = getTransferQuality(waitMinutes);
                        const qualityScore = quality.quality === 'good' ? 2 : 1;

                        const aRoute = routes.get(aRouteId);
                        const bRoute = routes.get(bRouteId);
                        const comboKey = `${aRoute?.routeShortName ?? aRouteId}→${bRoute?.routeShortName ?? bRouteId}`;

                        candidates.push({
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
                            comboKey,
                        });
                    }
                }
            }
        }
    }

    // Group by route combo — pick best per combo (highest quality, then latest arrival)
    const byCombo = new Map<string, TransferCandidate>();
    for (const c of candidates) {
        const existing = byCombo.get(c.comboKey);
        if (
            !existing ||
            c.qualityScore > existing.qualityScore ||
            (c.qualityScore === existing.qualityScore && c.bArrivalAtSchool > existing.bArrivalAtSchool)
        ) {
            byCombo.set(c.comboKey, c);
        }
    }

    // Sort by quality (descending) then arrival (latest first)
    const sorted = Array.from(byCombo.values()).sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        return b.bArrivalAtSchool - a.bArrivalAtSchool;
    });

    return sorted.slice(0, 3).map((best) => {
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
                fromStopId: best.aZoneStopId,
                toStopId: best.transferStopId,
                departureMinutes: best.zoneDepMinutes,
                arrivalMinutes: best.aArrivalAtTransfer,
                fromStop: stopIdToName.get(best.aZoneStopId) ?? best.aZoneStopId,
                toStop: transferStopName,
            },
            legB: {
                routeShortName: bShortName,
                routeColor: getRouteColor(bShortName),
                tripId: best.bTripId,
                fromStopId: best.transferStopId,
                toStopId: schoolStopId,
                departureMinutes: best.bDepFromTransfer,
                arrivalMinutes: best.bArrivalAtSchool,
                fromStop: transferStopName,
                toStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
            },
            transfer: getTransferQuality(best.waitMinutes),
            transferStopName,
        };
    });
}

/**
 * Find best 2-transfer morning trip: Route A (zone) → transfer1 → Route B → transfer2 → Route C (school).
 * Works backward from school (C-first) for efficiency since school-serving trips are the smallest bucket.
 */
export function findBestMorning2Transfer(
    zoneStopIds: Set<string>,
    schoolStopId: string,
    bellStartMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>,
    centroid: [number, number],
    stopCoords: Map<string, { lat: number; lon: number }>
): {
    legA: TripLeg;
    legB: TripLeg;
    legC: TripLeg;
    transfer1: TransferInfo;
    transfer2: TransferInfo;
} | null {
    const MAX_WAIT = 30;
    const MAX_TOTAL = 90;
    const stopIdToName = getStopIdToName();

    // Classify trips: C = serves school, A = serves zone
    const cTripIds: string[] = [];
    const aTripIds: string[] = [];

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServiceIds.has(trip.serviceId)) continue;

        if (stopTimes.some((st) => st.stopId === schoolStopId)) cTripIds.push(tripId);
        if (stopTimes.some((st) => zoneStopIds.has(st.stopId))) aTripIds.push(tripId);
    }

    let best: {
        score: number;
        zoneDepMinutes: number;
        totalMinutes: number;
        aTripId: string; aRouteId: string; aZoneStopId: string; aArrAtT1: number;
        bTripId: string; bRouteId: string; bT1StopId: string; bDepFromT1: number; bArrAtT2: number; bT2StopId: string;
        cTripId: string; cRouteId: string; cT2StopId: string; cDepFromT2: number; cArrAtSchool: number;
        wait1: number; wait2: number;
    } | null = null;

    for (const cTripId of cTripIds) {
        const cStops = tripStopIndex.get(cTripId);
        if (!cStops) continue;
        const cTrip = trips.get(cTripId);
        if (!cTrip) continue;

        const schoolIdx = cStops.findIndex((st) => st.stopId === schoolStopId);
        if (schoolIdx === -1) continue;
        if (cStops[schoolIdx].arrivalMinutes > bellStartMinutes) continue;

        // Transfer2 candidates: stops BEFORE school on C
        const cPrecedingStops = cStops.slice(0, schoolIdx);

        for (const cT2Entry of cPrecedingStops) {
            const t2Cluster = getClusterStopIds(cT2Entry.stopId);

            // Find B trips that serve any stop in transfer2 cluster
            for (const [bTripId, bStops] of tripStopIndex) {
                const bTrip = trips.get(bTripId);
                if (!bTrip || !weekdayServiceIds.has(bTrip.serviceId)) continue;
                if (bTrip.routeId === cTrip.routeId) continue; // different route required

                // Find B's stop in the transfer2 cluster
                const bT2Idx = bStops.findIndex((st) => t2Cluster.has(st.stopId));
                if (bT2Idx === -1) continue;

                const bT2Entry = bStops[bT2Idx];
                const wait2 = cT2Entry.departureMinutes - bT2Entry.arrivalMinutes;
                if (wait2 < 0 || wait2 > MAX_WAIT) continue;

                // Transfer1 candidates: stops BEFORE transfer2 on B
                const bPrecedingStops = bStops.slice(0, bT2Idx);

                for (const bT1Entry of bPrecedingStops) {
                    const t1Cluster = getClusterStopIds(bT1Entry.stopId);

                    // Find A trips serving zone THEN a stop in transfer1 cluster
                    for (const aTripId of aTripIds) {
                        const aStops = tripStopIndex.get(aTripId);
                        if (!aStops) continue;
                        const aTrip = trips.get(aTripId);
                        if (!aTrip) continue;
                        if (aTrip.routeId === bTrip.routeId) continue;

                        // Find zone stop closest to centroid on A
                        let aZoneEntry: ParsedStopTime | null = null;
                        let aZoneIdx = -1;
                        let bestDist = Infinity;
                        for (let si = 0; si < aStops.length; si++) {
                            const st = aStops[si];
                            if (!zoneStopIds.has(st.stopId)) continue;
                            const coords = stopCoords.get(st.stopId);
                            const dist = coords ? haversineKm(centroid[0], centroid[1], coords.lat, coords.lon) : Infinity;
                            if (dist < bestDist) {
                                bestDist = dist;
                                aZoneEntry = st;
                                aZoneIdx = si;
                            }
                        }
                        if (!aZoneEntry || aZoneIdx === -1) continue;

                        // Find A's stop in transfer1 cluster (after zone stop)
                        const aT1Entry = aStops.slice(aZoneIdx + 1).find((st) => t1Cluster.has(st.stopId));
                        if (!aT1Entry) continue;

                        const wait1 = bT1Entry.departureMinutes - aT1Entry.arrivalMinutes;
                        if (wait1 < 0 || wait1 > MAX_WAIT) continue;

                        const totalMinutes = cStops[schoolIdx].arrivalMinutes - aZoneEntry.departureMinutes;
                        if (totalMinutes > MAX_TOTAL) continue;

                        // Score: prefer both "good" quality transfers, then latest zone departure, then shortest total
                        const q1 = getTransferQuality(wait1);
                        const q2 = getTransferQuality(wait2);
                        const qualityScore = (q1.quality === 'good' ? 2 : 1) + (q2.quality === 'good' ? 2 : 1);
                        const score = qualityScore * 10000 + aZoneEntry.departureMinutes * 10 - totalMinutes;

                        if (best === null || score > best.score) {
                            best = {
                                score,
                                zoneDepMinutes: aZoneEntry.departureMinutes,
                                totalMinutes,
                                aTripId, aRouteId: aTrip.routeId, aZoneStopId: aZoneEntry.stopId, aArrAtT1: aT1Entry.arrivalMinutes,
                                bTripId, bRouteId: bTrip.routeId, bT1StopId: bT1Entry.stopId, bDepFromT1: bT1Entry.departureMinutes, bArrAtT2: bT2Entry.arrivalMinutes, bT2StopId: bT2Entry.stopId,
                                cTripId, cRouteId: cTrip.routeId, cT2StopId: cT2Entry.stopId, cDepFromT2: cT2Entry.departureMinutes, cArrAtSchool: cStops[schoolIdx].arrivalMinutes,
                                wait1, wait2,
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
    const cRoute = routes.get(best.cRouteId);
    const aName = aRoute?.routeShortName ?? best.aRouteId;
    const bName = bRoute?.routeShortName ?? best.bRouteId;
    const cName = cRoute?.routeShortName ?? best.cRouteId;

    return {
        legA: {
            routeShortName: aName,
            routeColor: getRouteColor(aName),
            tripId: best.aTripId,
            fromStopId: best.aZoneStopId,
            toStopId: best.bT1StopId,
            departureMinutes: best.zoneDepMinutes,
            arrivalMinutes: best.aArrAtT1,
            fromStop: stopIdToName.get(best.aZoneStopId) ?? best.aZoneStopId,
            toStop: stopIdToName.get(best.bT1StopId) ?? best.bT1StopId,
        },
        legB: {
            routeShortName: bName,
            routeColor: getRouteColor(bName),
            tripId: best.bTripId,
            fromStopId: best.bT1StopId,
            toStopId: best.bT2StopId,
            departureMinutes: best.bDepFromT1,
            arrivalMinutes: best.bArrAtT2,
            fromStop: stopIdToName.get(best.bT1StopId) ?? best.bT1StopId,
            toStop: stopIdToName.get(best.bT2StopId) ?? best.bT2StopId,
        },
        legC: {
            routeShortName: cName,
            routeColor: getRouteColor(cName),
            tripId: best.cTripId,
            fromStopId: best.cT2StopId,
            toStopId: schoolStopId,
            departureMinutes: best.cDepFromT2,
            arrivalMinutes: best.cArrAtSchool,
            fromStop: stopIdToName.get(best.cT2StopId) ?? best.cT2StopId,
            toStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
        },
        transfer1: getTransferQuality(best.wait1),
        transfer2: getTransferQuality(best.wait2),
    };
}

interface AfternoonCandidate {
    depMinutes: number;
    arrMinutes: number;
    tripId: string;
    routeShortName: string;
    zoneStopId: string;
}

/**
 * Find up to 3 afternoon return options within 30 min of bell end.
 * Groups by route short name, picks earliest departure per route.
 */
export function findAfternoonOptions(
    schoolStopId: string,
    zoneStopIds: Set<string>,
    bellEndMinutes: number,
    trips: Map<string, ParsedTrip>,
    routes: Map<string, ParsedRoute>,
    weekdayServiceIds: Set<string>,
    tripStopIndex: Map<string, ParsedStopTime[]>
): { leg: TripLeg; nextDepartureMinutes?: number }[] {
    const stopIdToName = getStopIdToName();
    const candidates: AfternoonCandidate[] = [];

    for (const [tripId, stopTimes] of tripStopIndex) {
        const trip = trips.get(tripId);
        if (!trip || !weekdayServiceIds.has(trip.serviceId)) continue;

        const route = routes.get(trip.routeId);
        if (!route) continue;

        const schoolIdx = stopTimes.findIndex((st) => st.stopId === schoolStopId);
        if (schoolIdx === -1) continue;

        const schoolEntry = stopTimes[schoolIdx];
        // 30-min window: depart >= bell end, depart <= bell end + 30
        if (schoolEntry.departureMinutes < bellEndMinutes) continue;
        if (schoolEntry.departureMinutes > bellEndMinutes + 30) continue;

        const zoneEntry = stopTimes.slice(schoolIdx + 1).find((st) => zoneStopIds.has(st.stopId));
        if (!zoneEntry) continue;

        candidates.push({
            depMinutes: schoolEntry.departureMinutes,
            arrMinutes: zoneEntry.arrivalMinutes,
            tripId,
            routeShortName: route.routeShortName,
            zoneStopId: zoneEntry.stopId,
        });
    }

    // Group by route — pick earliest departure per route
    const byRoute = new Map<string, AfternoonCandidate>();
    for (const c of candidates) {
        const existing = byRoute.get(c.routeShortName);
        if (!existing || c.depMinutes < existing.depMinutes) {
            byRoute.set(c.routeShortName, c);
        }
    }

    // Sort by earliest departure first
    const sorted = Array.from(byRoute.values()).sort(
        (a, b) => a.depMinutes - b.depMinutes
    );

    // Find "next bus" time: earliest departure across ALL candidates after the first option
    const allDepartures = candidates.map((c) => c.depMinutes).sort((a, b) => a - b);

    return sorted.slice(0, 3).map((c) => {
        const nextDep = allDepartures.find((d) => d > c.depMinutes);
        return {
            leg: {
                routeShortName: c.routeShortName,
                routeColor: getRouteColor(c.routeShortName),
                tripId: c.tripId,
                fromStopId: schoolStopId,
                toStopId: c.zoneStopId,
                departureMinutes: c.depMinutes,
                arrivalMinutes: c.arrMinutes,
                fromStop: stopIdToName.get(schoolStopId) ?? schoolStopId,
                toStop: stopIdToName.get(c.zoneStopId) ?? c.zoneStopId,
            },
            nextDepartureMinutes: nextDep,
        };
    });
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

// ─── Result enrichment ────────────────────────────────────────────────────────

/**
 * Enrich a found result with walking legs, centroid, and GTFS shape segments.
 */
function enrichResult(
    result: StudentPassResult,
    zonePolygon: [number, number][],
    school: SchoolConfig
): StudentPassResult {
    if (!result.found) return result;

    const centroid = getPolygonCentroid(zonePolygon);
    const allStops = getAllStopsWithCoords();
    const stopById = new Map(allStops.map((s) => [s.stop_id, s]));

    // Walk to boarding stop (from polygon centroid)
    const firstLeg = result.morningLegs[0];
    const boardingStop = firstLeg ? stopById.get(firstLeg.fromStopId) : null;

    let walkToStop: WalkLeg | undefined;
    if (boardingStop) {
        walkToStop = buildWalkLeg(
            centroid[0], centroid[1],
            boardingStop.lat, boardingStop.lon,
            `Walk to ${boardingStop.stop_name}`
        );
    }

    // Walk from alighting stop to school
    const lastLeg = result.morningLegs[result.morningLegs.length - 1];
    const alightStop = lastLeg ? stopById.get(lastLeg.toStopId) : null;

    let walkToSchool: WalkLeg | undefined;
    if (alightStop) {
        walkToSchool = buildWalkLeg(
            alightStop.lat, alightStop.lon,
            school.lat, school.lon,
            `Walk to ${school.name}`
        );
    }

    // Build GTFS route shape segments for each morning leg
    const routeShapes: RouteShapeSegment[] = [];
    for (let i = 0; i < result.morningLegs.length; i++) {
        const leg = result.morningLegs[i];
        const fromStop = stopById.get(leg.fromStopId);
        const toStop = stopById.get(leg.toStopId);
        if (fromStop && toStop) {
            const points = getRouteShapeSegment(
                leg.routeShortName,
                fromStop.lat, fromStop.lon,
                toStop.lat, toStop.lon
            );
            routeShapes.push({
                routeShortName: leg.routeShortName,
                routeColor: leg.routeColor,
                points,
                isDashed: i > 0, // second leg (transfer Route B) is dashed
            });
        }
    }

    // ── Afternoon enrichment ──
    const afternoonRouteShapes: RouteShapeSegment[] = [];
    let walkFromSchool: WalkLeg | undefined;
    let walkToZone: WalkLeg | undefined;

    if (result.afternoonLegs.length > 0) {
        // Walk from school to afternoon boarding stop
        const pmFirstLeg = result.afternoonLegs[0];
        const pmBoardStop = stopById.get(pmFirstLeg.fromStopId);
        if (pmBoardStop) {
            walkFromSchool = buildWalkLeg(
                school.lat, school.lon,
                pmBoardStop.lat, pmBoardStop.lon,
                `Walk to ${pmBoardStop.stop_name}`
            );
        }

        // Afternoon route shapes
        for (const leg of result.afternoonLegs) {
            const fromStop = stopById.get(leg.fromStopId);
            const toStop = stopById.get(leg.toStopId);
            if (fromStop && toStop) {
                const points = getRouteShapeSegment(
                    leg.routeShortName,
                    fromStop.lat, fromStop.lon,
                    toStop.lat, toStop.lon
                );
                afternoonRouteShapes.push({
                    routeShortName: leg.routeShortName,
                    routeColor: leg.routeColor,
                    points,
                    isDashed: false,
                });
            }
        }

        // Walk from afternoon alighting stop back to zone centroid
        const pmLastLeg = result.afternoonLegs[result.afternoonLegs.length - 1];
        const pmAlightStop = stopById.get(pmLastLeg.toStopId);
        if (pmAlightStop) {
            walkToZone = buildWalkLeg(
                pmAlightStop.lat, pmAlightStop.lon,
                centroid[0], centroid[1],
                'Walk home'
            );
        }
    }

    return {
        ...result,
        zoneCentroid: centroid,
        walkToStop,
        walkToSchool,
        routeShapes,
        afternoonRouteShapes,
        walkFromSchool,
        walkToZone,
    };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Find up to 3 morning + 3 afternoon route options for a zone → school trip.
 */
export function findTripOptions(
    zonePolygon: [number, number][],
    school: SchoolConfig
): TripOptions {
    const bellStartMinutes = parseTimeToMinutes(school.bellStart + ':00');
    const bellEndMinutes = parseTimeToMinutes(school.bellEnd + ':00');

    const trips = loadTrips();
    const routes = loadRoutes();
    const weekdayServiceIds = loadWeekdayServiceIds();
    const tripStopIndex = getTripStopTimesIndex();

    const zoneStops = findStopsInZone(zonePolygon);
    const zoneStopIds = new Set(zoneStops.map((s) => s.stop_id));

    const empty: TripOptions = { morningOptions: [], afternoonOptions: [] };

    if (zoneStopIds.size === 0) return empty;

    const schoolStop = findNearestStopToSchool(school);
    if (!schoolStop) return empty;
    const schoolStopId = schoolStop.stop_id;

    const centroid = getPolygonCentroid(zonePolygon);
    const allStops = getAllStopsWithCoords();
    const stopCoords = new Map(allStops.map(s => [s.stop_id, { lat: s.lat, lon: s.lon }]));

    // Collect morning direct options
    const directOptions = findMorningDirectOptions(
        zoneStopIds, schoolStopId, bellStartMinutes,
        trips, routes, weekdayServiceIds, tripStopIndex, centroid, stopCoords
    );

    // Collect morning transfer options
    const transferOptions = findMorningTransferOptions(
        zoneStopIds, schoolStopId, bellStartMinutes,
        trips, routes, weekdayServiceIds, tripStopIndex, centroid, stopCoords
    );

    // Afternoon options (same school stop regardless of morning choice)
    const pmResults = findAfternoonOptions(
        schoolStopId, zoneStopIds, bellEndMinutes,
        trips, routes, weekdayServiceIds, tripStopIndex
    );
    const pmFirst = pmResults[0];

    // Merge morning options: direct first, then transfers, cap at 3
    const morningOptions: RouteOption[] = [];

    for (const d of directOptions) {
        if (morningOptions.length >= 3) break;
        const freq = calculateFrequency(
            d.leg.routeShortName, trips, routes, weekdayServiceIds, tripStopIndex
        );

        const result = enrichResult({
            found: true,
            isDirect: true,
            morningLegs: [d.leg],
            afternoonLegs: pmFirst ? [pmFirst.leg] : [],
            nextAfternoonDepartureMinutes: pmFirst?.nextDepartureMinutes,
            frequencyPerHour: freq,
        }, zonePolygon, school);

        morningOptions.push({
            id: `am-${morningOptions.length + 1}`,
            label: `Rt ${d.leg.routeShortName} Direct — arrive ${minutesToDisplayTime(d.leg.arrivalMinutes)}`,
            result,
        });
    }

    for (const t of transferOptions) {
        if (morningOptions.length >= 3) break;
        const freq = calculateFrequency(
            t.legA.routeShortName, trips, routes, weekdayServiceIds, tripStopIndex
        );

        const result = enrichResult({
            found: true,
            isDirect: false,
            morningLegs: [t.legA, t.legB],
            afternoonLegs: pmFirst ? [pmFirst.leg] : [],
            transfer: t.transfer,
            nextAfternoonDepartureMinutes: pmFirst?.nextDepartureMinutes,
            frequencyPerHour: freq,
        }, zonePolygon, school);

        morningOptions.push({
            id: `am-${morningOptions.length + 1}`,
            label: `Rt ${t.legA.routeShortName}→${t.legB.routeShortName} Transfer — arrive ${minutesToDisplayTime(t.legB.arrivalMinutes)}`,
            result,
        });
    }

    // Try 2-transfer if we still have room
    if (morningOptions.length < 3) {
        const twoTransferResult = findBestMorning2Transfer(
            zoneStopIds, schoolStopId, bellStartMinutes,
            trips, routes, weekdayServiceIds, tripStopIndex, centroid, stopCoords
        );

        if (twoTransferResult) {
            const freq = calculateFrequency(
                twoTransferResult.legA.routeShortName, trips, routes, weekdayServiceIds, tripStopIndex
            );

            const result = enrichResult({
                found: true,
                isDirect: false,
                morningLegs: [twoTransferResult.legA, twoTransferResult.legB, twoTransferResult.legC],
                afternoonLegs: pmFirst ? [pmFirst.leg] : [],
                transfers: [twoTransferResult.transfer1, twoTransferResult.transfer2],
                nextAfternoonDepartureMinutes: pmFirst?.nextDepartureMinutes,
                frequencyPerHour: freq,
            }, zonePolygon, school);

            morningOptions.push({
                id: `am-${morningOptions.length + 1}`,
                label: `Rt ${twoTransferResult.legA.routeShortName}→${twoTransferResult.legB.routeShortName}→${twoTransferResult.legC.routeShortName} 2-Transfer — arrive ${minutesToDisplayTime(twoTransferResult.legC.arrivalMinutes)}`,
                result,
            });
        }
    }

    // Afternoon option cards
    const afternoonOptions: RouteOption[] = pmResults.map((pm, i) => {
        const result = enrichResult({
            found: true,
            isDirect: true,
            morningLegs: morningOptions[0]?.result.morningLegs ?? [],
            afternoonLegs: [pm.leg],
            nextAfternoonDepartureMinutes: pm.nextDepartureMinutes,
        }, zonePolygon, school);

        return {
            id: `pm-${i + 1}`,
            label: `Rt ${pm.leg.routeShortName} — depart ${minutesToDisplayTime(pm.leg.departureMinutes)}`,
            result,
        };
    });

    return { morningOptions, afternoonOptions };
}

/**
 * Backward-compatible wrapper: returns the single best trip (first morning option).
 */
export function findBestTrip(
    zonePolygon: [number, number][],
    school: SchoolConfig
): StudentPassResult {
    const options = findTripOptions(zonePolygon, school);

    if (options.morningOptions.length > 0) {
        return options.morningOptions[0].result;
    }

    return { found: false, isDirect: false, morningLegs: [], afternoonLegs: [] };
}
