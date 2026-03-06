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
import { loadGtfsRouteShapes } from '../gtfs/gtfsShapesLoader';
import { findTripOptionsRaptor } from './studentPassRaptorAdapter';

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

export interface ZoneStopOption {
    stopId: string;
    stopName: string;
    lat: number;
    lon: number;
    distanceKm: number;
    walkMinutes: number;
    morningOptionCount: number;
    afternoonOptionCount: number;
    bestMorningArrivalMinutes?: number;
    bestAfternoonDepartureMinutes?: number;
}

export interface TripOptions {
    morningOptions: RouteOption[];
    afternoonOptions: RouteOption[];
    zoneStops: ZoneStopOption[];
    selectedZoneStopId: string | null;
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
    /** Street-level walk path as [lat, lon][] from Mapbox Directions API */
    geometry?: [number, number][];
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
    morningTransfer?: TransferInfo;
    morningTransfers?: TransferInfo[];
    afternoonTransfer?: TransferInfo;
    afternoonTransfers?: TransferInfo[];
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

// ─── RAPTOR-powered trip finding ─────────────────────────────────────────────
// The bespoke direct+transfer scanner has been replaced by the RAPTOR engine.
// These wrapper functions maintain backward compatibility.

/**
 * Find up to 3 morning + 3 afternoon route options for a zone → school trip.
 * Now powered by the RAPTOR engine.
 */
export function findTripOptions(
    zonePolygon: [number, number][],
    school: SchoolConfig
): TripOptions {
    return findTripOptionsRaptor(zonePolygon, school);
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
