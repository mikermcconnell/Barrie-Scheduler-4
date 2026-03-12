/**
 * Corridor Builder
 *
 * Detects shared corridors where multiple routes traverse the same
 * consecutive stop pairs, then extracts GTFS shape geometry for each segment.
 *
 * Algorithm:
 * 1. Parse stop_times.txt → ordered stop sequence per trip
 * 2. Canonical stop sequence per route+direction (trip with most stops)
 * 3. Edge index: consecutive (stopA, stopB) → set of routes
 * 4. Merge consecutive edges shared by the same route set → corridor segments
 * 5. Attach shape geometry by snapping stops to the nearest route polyline
 */

import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import routesRaw from '../../gtfs/routes.txt?raw';
import {
    parseCsvRow,
    buildHeaderIndex,
    getRouteIdToShortName,
} from '../transit-app/transitAppGtfsNormalization';
import { getAllStopsWithCoords, type GtfsStopWithCoords } from './gtfsStopLookup';
import { loadGtfsRouteShapes, pointToPolylineDistanceKm } from './gtfsShapesLoader';

// ─── Types ────────────────────────────────────────────────────────────────

export interface CorridorSegment {
    id: string;
    stops: string[];          // ordered stop_ids in this segment
    stopNames: string[];      // ordered stop names
    routes: string[];         // route short names that share this segment
    routeColors: string[];    // hex colors (without #) for each route
    geometry: [number, number][]; // [lat, lon][] polyline
    isShared: boolean;        // true if 2+ routes
}

interface StopTimeEntry {
    tripId: string;
    stopId: string;
    stopSequence: number;
    departureMinutes: number | null;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────

function parseRouteColors(): Map<string, string> {
    const colorMap = new Map<string, string>();
    const lines = routesRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) return colorMap;

    const idx = buildHeaderIndex(lines[0]);
    const routeIdIdx = idx.get('route_id') ?? -1;
    const shortNameIdx = idx.get('route_short_name') ?? -1;
    const colorIdx = idx.get('route_color') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const shortName = (shortNameIdx >= 0 ? values[shortNameIdx] : values[routeIdIdx]) || '';
        const color = (colorIdx >= 0 ? values[colorIdx] : '') || '888888';
        if (shortName) colorMap.set(shortName.toUpperCase(), color.replace('#', ''));
    }
    return colorMap;
}

function parseTripDirections(): Map<string, string> {
    const tripDirMap = new Map<string, string>();
    const lines = tripsRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) return tripDirMap;

    const idx = buildHeaderIndex(lines[0]);
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const dirIdx = idx.get('direction_id') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        const dir = dirIdx >= 0 ? (values[dirIdx] || '0') : '0';
        if (tripId) tripDirMap.set(tripId, dir);
    }
    return tripDirMap;
}

function parseStopTimes(): StopTimeEntry[] {
    const entries: StopTimeEntry[] = [];
    const lines = stopTimesRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) return entries;

    const idx = buildHeaderIndex(lines[0]);
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const stopIdIdx = idx.get('stop_id') ?? -1;
    const seqIdx = idx.get('stop_sequence') ?? -1;
    const depIdx = idx.get('departure_time') ?? -1;
    const arrIdx = idx.get('arrival_time') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        const stopId = stopIdIdx >= 0 ? (values[stopIdIdx] || '') : '';
        if (!tripId || !stopId) continue;

        const seqRaw = seqIdx >= 0 ? values[seqIdx] : '';
        const stopSequence = parseInt(seqRaw || '0', 10);

        // Parse departure time for frequency computation later
        let depMin: number | null = null;
        const depStr = depIdx >= 0 ? values[depIdx] : undefined;
        const arrStr = arrIdx >= 0 ? values[arrIdx] : undefined;
        const timeStr = depStr || arrStr;
        if (timeStr) {
            const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (match) {
                const h = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                if (Number.isFinite(h) && Number.isFinite(m) && m >= 0 && m < 60) {
                    depMin = h * 60 + m;
                }
            }
        }

        entries.push({ tripId, stopId, stopSequence, departureMinutes: depMin });
    }

    return entries;
}

/** Build ordered stop sequence per trip. */
function buildTripStopSequences(entries: StopTimeEntry[]): Map<string, { stopId: string; depMin: number | null }[]> {
    const byTrip = new Map<string, StopTimeEntry[]>();
    for (const e of entries) {
        const arr = byTrip.get(e.tripId);
        if (arr) arr.push(e);
        else byTrip.set(e.tripId, [e]);
    }

    const sequences = new Map<string, { stopId: string; depMin: number | null }[]>();
    for (const [tripId, stops] of byTrip) {
        stops.sort((a, b) => a.stopSequence - b.stopSequence);
        sequences.set(tripId, stops.map(s => ({ stopId: s.stopId, depMin: s.departureMinutes })));
    }
    return sequences;
}

/** For each route+direction, collect all unique ordered stop sequences. */
function getRouteDirectionSequences(
    tripSequences: Map<string, { stopId: string; depMin: number | null }[]>,
    tripDirMap: Map<string, string>,
    tripToRouteService: Map<string, { route: string; serviceId: string }>,
): Map<string, string[][]> {
    const sequences = new Map<string, string[][]>();
    const seen = new Map<string, Set<string>>();

    for (const [tripId, stopSeq] of tripSequences) {
        const info = tripToRouteService.get(tripId);
        if (!info) continue;
        const dir = tripDirMap.get(tripId) || '0';
        const key = `${info.route}|${dir}`;
        const stops = stopSeq.map(s => s.stopId);
        if (stops.length < 2) continue;
        const signature = stops.join('>');

        let seqSeen = seen.get(key);
        if (!seqSeen) {
            seqSeen = new Set<string>();
            seen.set(key, seqSeen);
        }
        if (seqSeen.has(signature)) continue;
        seqSeen.add(signature);

        const existing = sequences.get(key);
        if (existing) existing.push(stops);
        else sequences.set(key, [stops]);
    }

    return sequences;
}

/** Build edge index: (stopA, stopB) → set of routes. */
function buildEdgeIndex(routeDirectionSequences: Map<string, string[][]>): Map<string, Set<string>> {
    const edgeRoutes = new Map<string, Set<string>>();

    for (const [key, sequences] of routeDirectionSequences) {
        const route = key.split('|')[0];
        for (const stops of sequences) {
            for (let i = 0; i < stops.length - 1; i++) {
                const edgeKey = `${stops[i]}→${stops[i + 1]}`;
                const existing = edgeRoutes.get(edgeKey);
                if (existing) existing.add(route);
                else edgeRoutes.set(edgeKey, new Set([route]));
            }
        }
    }

    return edgeRoutes;
}

/** Merge consecutive edges with the same route set into corridor segments. */
function mergeEdgesIntoSegments(
    routeDirectionSequences: Map<string, string[][]>,
    edgeRoutes: Map<string, Set<string>>,
): { stops: string[]; routes: string[] }[] {
    const segments = new Map<string, { stops: string[]; routes: string[] }>();

    // For each unique sequence, walk through and group consecutive edges with same route set.
    // De-duplicate final merged segments by route-set + ordered stop chain.
    for (const sequences of routeDirectionSequences.values()) {
        for (const stops of sequences) {
            for (let i = 0; i < stops.length - 1; i++) {
                const edgeKey = `${stops[i]}→${stops[i + 1]}`;
                const routeSet = edgeRoutes.get(edgeKey);
                if (!routeSet) continue;

                const routeSetKey = Array.from(routeSet).sort().join(',');
                const segStops = [stops[i]];

                let j = i + 1;
                while (j < stops.length - 1) {
                    const nextEdge = `${stops[j]}→${stops[j + 1]}`;
                    const nextRoutes = edgeRoutes.get(nextEdge);
                    if (!nextRoutes) break;
                    const nextKey = Array.from(nextRoutes).sort().join(',');
                    if (nextKey !== routeSetKey) break;
                    segStops.push(stops[j]);
                    j++;
                }
                segStops.push(stops[j < stops.length ? j : stops.length - 1]);

                const dedupeKey = `${routeSetKey}|${segStops.join('>')}`;
                if (!segments.has(dedupeKey)) {
                    segments.set(dedupeKey, {
                        stops: segStops,
                        routes: Array.from(routeSet).sort(),
                    });
                }
            }
        }
    }

    return Array.from(segments.values());
}

/** Extract shape geometry for a segment by snapping stops to the best route polyline. */
function extractSegmentGeometry(
    segStops: string[],
    segRoutes: string[],
    stopCoords: Map<string, GtfsStopWithCoords>,
    routeShapes: ReturnType<typeof loadGtfsRouteShapes>,
): [number, number][] {
    if (segStops.length < 2) return [];

    const firstStop = stopCoords.get(segStops[0]);
    const lastStop = stopCoords.get(segStops[segStops.length - 1]);
    if (!firstStop || !lastStop) {
        // Fallback: straight lines between stops
        return segStops
            .map(sid => stopCoords.get(sid))
            .filter((s): s is GtfsStopWithCoords => !!s)
            .map(s => [s.lat, s.lon] as [number, number]);
    }

    // Find the best matching route shape
    let bestShape: [number, number][] | null = null;
    let bestDist = Infinity;

    for (const shape of routeShapes) {
        if (!segRoutes.some(r => r === shape.routeShortName || r === shape.routeShortName.toUpperCase())) continue;
        if (shape.points.length < 2) continue;

        const d1 = pointToPolylineDistanceKm([firstStop.lat, firstStop.lon], shape.points);
        const d2 = pointToPolylineDistanceKm([lastStop.lat, lastStop.lon], shape.points);
        const totalDist = d1 + d2;
        if (totalDist < bestDist) {
            bestDist = totalDist;
            bestShape = shape.points;
        }
    }

    if (!bestShape || bestDist > 2) {
        // Fallback: straight lines between stop coordinates
        return segStops
            .map(sid => stopCoords.get(sid))
            .filter((s): s is GtfsStopWithCoords => !!s)
            .map(s => [s.lat, s.lon] as [number, number]);
    }

    // Find nearest shape point indices for first and last stop
    const findNearestIdx = (lat: number, lon: number): number => {
        let bestIdx = 0;
        let bestD = Infinity;
        for (let i = 0; i < bestShape!.length; i++) {
            const dx = bestShape![i][0] - lat;
            const dy = bestShape![i][1] - lon;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; bestIdx = i; }
        }
        return bestIdx;
    };

    const startIdx = findNearestIdx(firstStop.lat, firstStop.lon);
    const endIdx = findNearestIdx(lastStop.lat, lastStop.lon);

    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const sliced = bestShape.slice(lo, hi + 1);

    // Ensure correct direction
    if (startIdx > endIdx) sliced.reverse();

    return sliced.length >= 2 ? sliced : [
        [firstStop.lat, firstStop.lon],
        [lastStop.lat, lastStop.lon],
    ];
}

// ─── Main Export ──────────────────────────────────────────────────────────

let cachedCorridors: CorridorSegment[] | null = null;

export function buildCorridorSegments(): CorridorSegment[] {
    if (cachedCorridors) return cachedCorridors;

    const routeIdToShortName = getRouteIdToShortName();
    const tripDirMap = parseTripDirections();
    const routeColors = parseRouteColors();

    // Build trip → route+service mapping
    const tripToRouteService = new Map<string, { route: string; serviceId: string }>();
    const tripLines = tripsRaw.trim().split(/\r?\n/);
    if (tripLines.length > 1) {
        const idx = buildHeaderIndex(tripLines[0]);
        const routeIdIdx = idx.get('route_id') ?? -1;
        const serviceIdIdx = idx.get('service_id') ?? -1;
        const tripIdIdx = idx.get('trip_id') ?? -1;

        for (let i = 1; i < tripLines.length; i++) {
            const line = tripLines[i].trim();
            if (!line) continue;
            const values = parseCsvRow(line);
            const routeId = routeIdIdx >= 0 ? (values[routeIdIdx] || '') : '';
            const serviceId = serviceIdIdx >= 0 ? (values[serviceIdIdx] || '') : '';
            const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
            if (!tripId || !routeId || !serviceId) continue;
            const routeShortName = routeIdToShortName.get(routeId);
            if (!routeShortName) continue;
            tripToRouteService.set(tripId, { route: routeShortName, serviceId });
        }
    }

    // Parse stop times and build sequences
    const stopTimeEntries = parseStopTimes();
    const tripSequences = buildTripStopSequences(stopTimeEntries);
    const routeDirectionSequences = getRouteDirectionSequences(tripSequences, tripDirMap, tripToRouteService);

    // Build edge index and merge into segments
    const edgeIndex = buildEdgeIndex(routeDirectionSequences);
    const rawSegments = mergeEdgesIntoSegments(routeDirectionSequences, edgeIndex);

    // Get stop coordinates and route shapes for geometry
    const stopsWithCoords = getAllStopsWithCoords();
    const stopCoords = new Map<string, GtfsStopWithCoords>();
    for (const s of stopsWithCoords) stopCoords.set(s.stop_id, s);

    const routeShapes = loadGtfsRouteShapes();

    // Build final segments with geometry
    const segments: CorridorSegment[] = [];
    for (let i = 0; i < rawSegments.length; i++) {
        const raw = rawSegments[i];
        if (raw.stops.length < 2) continue;

        const geometry = extractSegmentGeometry(raw.stops, raw.routes, stopCoords, routeShapes);
        if (geometry.length < 2) continue;

        const stopNames = raw.stops.map(sid => {
            const s = stopCoords.get(sid);
            return s ? s.stop_name : sid;
        });

        const colors = raw.routes.map(r => routeColors.get(r) || '888888');

        segments.push({
            id: `seg-${i}`,
            stops: raw.stops,
            stopNames,
            routes: raw.routes,
            routeColors: colors,
            geometry,
            isShared: raw.routes.length >= 2,
        });
    }

    cachedCorridors = segments;
    return segments;
}

/** Get all stop_ids that appear as junction points (where corridors diverge/converge). */
export function getCorridorJunctionStops(segments: CorridorSegment[]): Set<string> {
    const stopSegmentCount = new Map<string, number>();
    for (const seg of segments) {
        // Count first and last stops of each segment
        const first = seg.stops[0];
        const last = seg.stops[seg.stops.length - 1];
        stopSegmentCount.set(first, (stopSegmentCount.get(first) || 0) + 1);
        if (first !== last) {
            stopSegmentCount.set(last, (stopSegmentCount.get(last) || 0) + 1);
        }
    }

    const junctions = new Set<string>();
    for (const [stopId, count] of stopSegmentCount) {
        if (count >= 2) junctions.add(stopId);
    }
    return junctions;
}
