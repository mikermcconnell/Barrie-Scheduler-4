import type { RoutePlanner2Scenario, RoutePlanner2SegmentRuntime } from './routePlanner2Types';
import { buildRoutePlanner2StopSegmentPaths } from './routePlanner2Segments';

export type RoutePlanner2RoadSnapSource = 'mapbox' | 'fallback';

export interface RoutePlanner2RoadSnapResult {
    coordinates: [number, number][];
    source: RoutePlanner2RoadSnapSource;
    durationSeconds?: number;
    distanceMeters?: number;
}

export interface RoutePlanner2ScenarioRoadSnapResult extends RoutePlanner2RoadSnapResult {
    segmentEstimates: RoutePlanner2SegmentRuntime[];
}

interface MapboxDirectionsRoute {
    geometry?: {
        coordinates?: [number, number][];
        type?: 'LineString';
    };
    duration?: number;
    distance?: number;
}

interface MapboxDirectionsResponse {
    code?: string;
    routes?: MapboxDirectionsRoute[];
}

interface SnapOptions {
    token?: string | null;
    fetchImpl?: typeof fetch;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const COORD_PRECISION = 5;

const segmentCache = new Map<string, { result: RoutePlanner2RoadSnapResult; expiresAt: number }>();

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

function roundCoord(value: number): number {
    return Math.round(value * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

function buildSegmentCacheKey(from: [number, number], to: [number, number]): string {
    return `${roundCoord(from[0])},${roundCoord(from[1])}_${roundCoord(to[0])},${roundCoord(to[1])}`;
}

function getCachedSegment(key: string): RoutePlanner2RoadSnapResult | null {
    const entry = segmentCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        segmentCache.delete(key);
        return null;
    }
    return entry.result;
}

function setCachedSegment(key: string, result: RoutePlanner2RoadSnapResult): void {
    segmentCache.set(key, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

function distanceMetersBetween(from: [number, number], to: [number, number]): number {
    const radiusMeters = 6371000;
    const toRadians = (degrees: number) => degrees * Math.PI / 180;
    const dLat = toRadians(to[1] - from[1]);
    const dLng = toRadians(to[0] - from[0]);
    const lat1 = toRadians(from[1]);
    const lat2 = toRadians(to[1]);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radiusMeters * Math.asin(Math.sqrt(a));
}

function distanceMetersForPath(coordinates: [number, number][]): number {
    return coordinates.slice(1).reduce((sum, coordinate, index) => (
        sum + distanceMetersBetween(coordinates[index], coordinate)
    ), 0);
}

function stitchSegmentCoordinates(segments: [number, number][][]): [number, number][] {
    const stitched: [number, number][] = [];

    segments.forEach((segment, index) => {
        if (segment.length === 0) return;
        if (index === 0) {
            stitched.push(...segment);
            return;
        }

        const [first, ...rest] = segment;
        if (!stitched.length || !coordinatesEqual(stitched[stitched.length - 1], first)) {
            stitched.push(first);
        }
        stitched.push(...rest);
    });

    return stitched;
}

async function fetchRoadSegment(
    from: [number, number],
    to: [number, number],
    token: string | null,
    fetchImpl: typeof fetch,
): Promise<RoutePlanner2RoadSnapResult> {
    if (coordinatesEqual(from, to)) {
        return { coordinates: [from], source: 'fallback', distanceMeters: 0 };
    }

    const cacheKey = buildSegmentCacheKey(from, to);
    const cached = getCachedSegment(cacheKey);
    if (cached) return cached;

    if (!token) return { coordinates: [from, to], source: 'fallback', distanceMeters: distanceMetersBetween(from, to) };

    try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&steps=false&access_token=${token}`;
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`Mapbox returned ${response.status}`);

        const data = await response.json() as MapboxDirectionsResponse;
        const coordinates = data.routes?.[0]?.geometry?.coordinates;
        if (data.code !== 'Ok' || !coordinates?.length) {
            throw new Error(`Mapbox returned code ${data.code ?? 'unknown'}`);
        }

        const result = {
            coordinates,
            source: 'mapbox' as const,
            durationSeconds: data.routes[0]?.duration,
            distanceMeters: data.routes[0]?.distance,
        };
        setCachedSegment(cacheKey, result);
        return result;
    } catch {
        return { coordinates: [from, to], source: 'fallback', distanceMeters: distanceMetersBetween(from, to) };
    }
}

export async function snapRoutePlanner2WaypointsToRoad(
    waypoints: [number, number][],
    options: SnapOptions = {},
): Promise<RoutePlanner2RoadSnapResult> {
    if (waypoints.length < 2) return { coordinates: waypoints, source: 'fallback' };

    const token = Object.prototype.hasOwnProperty.call(options, 'token')
        ? options.token ?? null
        : getMapboxToken();
    const fetchImpl = options.fetchImpl ?? fetch;
    const segmentResults = await Promise.all(
        waypoints.slice(1).map((to, index) => fetchRoadSegment(waypoints[index], to, token, fetchImpl)),
    );
    const durationSeconds = segmentResults.every((result) => typeof result.durationSeconds === 'number')
        ? segmentResults.reduce((sum, result) => sum + (result.durationSeconds ?? 0), 0)
        : undefined;
    const distanceMeters = segmentResults.every((result) => typeof result.distanceMeters === 'number')
        ? segmentResults.reduce((sum, result) => sum + (result.distanceMeters ?? 0), 0)
        : undefined;

    return {
        coordinates: stitchSegmentCoordinates(segmentResults.map((result) => result.coordinates)),
        source: segmentResults.every((result) => result.source === 'mapbox') ? 'mapbox' : 'fallback',
        durationSeconds,
        distanceMeters,
    };
}

function roundSegmentRuntime(durationSeconds: number | undefined): number | null {
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
    return Math.max(1, Math.round(durationSeconds / 60));
}

function fallbackRuntimeFromDistance(distanceMeters: number | undefined): number | null {
    if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
    const driveMinutes = (distanceMeters / 1000 / 22) * 60;
    return Math.max(2, Math.ceil(driveMinutes + 1));
}

export async function snapRoutePlanner2ScenarioToRoad(
    scenario: RoutePlanner2Scenario,
    options: SnapOptions = {},
): Promise<RoutePlanner2ScenarioRoadSnapResult> {
    const segments = buildRoutePlanner2StopSegmentPaths(scenario);
    if (segments.length === 0) {
        const coordinates = [...scenario.alignment]
            .sort((a, b) => a.sequence - b.sequence)
            .map((point): [number, number] => [point.lng, point.lat]);
        return { coordinates, source: 'fallback', segmentEstimates: [] };
    }

    const results = await Promise.all(segments.map((segment) => snapRoutePlanner2WaypointsToRoad(segment.coordinates, options)));
    const now = new Date().toISOString();
    const segmentEstimates = segments.map((segment, index): RoutePlanner2SegmentRuntime => {
        const result = results[index];
        const mapboxRuntime = roundSegmentRuntime(result?.durationSeconds);
        const fallbackRuntime = fallbackRuntimeFromDistance(result?.distanceMeters);
        const source = result?.source === 'mapbox' && mapboxRuntime != null ? 'mapbox' : 'fallback';

        return {
            id: segment.id,
            fromStopId: segment.fromStopId,
            toStopId: segment.toStopId,
            runtimeMinutes: source === 'mapbox' ? mapboxRuntime : fallbackRuntime,
            source,
            confidence: source === 'mapbox' ? 'medium' : 'low',
            distanceKm: typeof result?.distanceMeters === 'number'
                ? Number((result.distanceMeters / 1000).toFixed(2))
                : undefined,
            durationSeconds: result?.durationSeconds,
            pathFingerprint: segment.pathFingerprint,
            updatedAt: now,
            fallbackReason: source === 'fallback'
                ? 'Mapbox travel time was unavailable; using distance and default speed.'
                : undefined,
        };
    });

    return {
        coordinates: stitchSegmentCoordinates(results.map((result) => result.coordinates)),
        source: results.every((result) => result.source === 'mapbox') ? 'mapbox' : 'fallback',
        durationSeconds: results.every((result) => typeof result.durationSeconds === 'number')
            ? results.reduce((sum, result) => sum + (result.durationSeconds ?? 0), 0)
            : undefined,
        distanceMeters: distanceMetersForPath(stitchSegmentCoordinates(results.map((result) => result.coordinates))),
        segmentEstimates,
    };
}
