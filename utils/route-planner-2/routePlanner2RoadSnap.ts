import type {
    RoutePlanner2RuntimeFailureCode,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
} from './routePlanner2Types';
import { buildRoutePlanner2StopSegmentPaths } from './routePlanner2Segments';

import { getClientMapboxToken } from '../mapboxToken';
export type RoutePlanner2RoadSnapSource = 'mapbox' | 'fallback';

export interface RoutePlanner2RoadSnapResult {
    coordinates: [number, number][];
    source: RoutePlanner2RoadSnapSource;
    durationSeconds?: number;
    distanceMeters?: number;
    roadLabels?: RoutePlanner2RoadLabelGeometry[];
    failure?: RoutePlanner2RoadSnapFailure;
}

export interface RoutePlanner2RoadSnapFailure {
    code: RoutePlanner2RuntimeFailureCode;
    message: string;
}

export interface RoutePlanner2RoadLabelGeometry {
    name: string;
    coordinates: [number, number][];
}

export interface RoutePlanner2ScenarioRoadSnapResult extends RoutePlanner2RoadSnapResult {
    segmentEstimates: RoutePlanner2SegmentRuntime[];
    segmentGeometries: Array<{
        id: string;
        fromStopId: string;
        toStopId: string;
        coordinates: [number, number][];
        source: RoutePlanner2RoadSnapSource;
        roadLabels?: RoutePlanner2RoadLabelGeometry[];
    }>;
    failures: RoutePlanner2RoadSnapFailure[];
}

export interface RoutePlanner2RoadSnapProgress {
    totalSegments: number;
    completedSegments: number;
    segmentEstimate?: RoutePlanner2SegmentRuntime;
    segmentGeometry?: RoutePlanner2ScenarioRoadSnapResult['segmentGeometries'][number];
}

interface MapboxDirectionsRoute {
    geometry?: {
        coordinates?: [number, number][];
        type?: 'LineString';
    };
    duration?: number;
    distance?: number;
    legs?: Array<{
        steps?: Array<{
            name?: string;
            geometry?: {
                coordinates?: [number, number][];
                type?: 'LineString';
            };
        }>;
    }>;
}

interface MapboxDirectionsResponse {
    code?: string;
    routes?: MapboxDirectionsRoute[];
}

interface SnapOptions {
    token?: string | null;
    fetchImpl?: typeof fetch;
    concurrency?: number;
    signal?: AbortSignal;
    onProgress?: (progress: RoutePlanner2RoadSnapProgress) => void;
    forceRefresh?: boolean;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const COORD_PRECISION = 5;

const segmentCache = new Map<string, { result: RoutePlanner2RoadSnapResult; expiresAt: number }>();

function getMapboxToken(): string | null {
    return getClientMapboxToken();
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

function normalizeRoadName(value: string | undefined): string | null {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    return normalized || null;
}

function buildRoadLabelsFromRoute(route: MapboxDirectionsRoute | undefined): RoutePlanner2RoadLabelGeometry[] {
    const labels: RoutePlanner2RoadLabelGeometry[] = [];
    const steps = route?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];

    steps.forEach((step) => {
        const name = normalizeRoadName(step.name);
        const coordinates = step.geometry?.coordinates;
        if (!name || !coordinates || coordinates.length < 2) return;

        const previous = labels[labels.length - 1];
        if (previous && previous.name.toLocaleLowerCase() === name.toLocaleLowerCase()) {
            previous.coordinates = stitchSegmentCoordinates([previous.coordinates, coordinates]);
            return;
        }

        labels.push({ name, coordinates });
    });

    return labels;
}

async function fetchRoadSegment(
    from: [number, number],
    to: [number, number],
    token: string | null,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    forceRefresh = false,
): Promise<RoutePlanner2RoadSnapResult> {
    if (signal?.aborted) throw new DOMException('Route snap cancelled.', 'AbortError');

    if (coordinatesEqual(from, to)) {
        return { coordinates: [from], source: 'fallback', distanceMeters: 0 };
    }

    const cacheKey = buildSegmentCacheKey(from, to);
    const cached = forceRefresh ? null : getCachedSegment(cacheKey);
    if (cached) return cached;

    if (!token) return {
        coordinates: [from, to],
        source: 'fallback',
        distanceMeters: distanceMetersBetween(from, to),
        failure: { code: 'missing-token', message: 'Mapbox access is unavailable. The accepted runtime was retained.' },
    };

    try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&steps=true&access_token=${token}`;
        const response = signal ? await fetchImpl(url, { signal }) : await fetchImpl(url);
        if (!response.ok) {
            const failureCode: RoutePlanner2RuntimeFailureCode = response.status === 401 || response.status === 403
                ? 'authentication'
                : response.status === 429
                    ? 'rate-limit'
                    : 'network';
            return {
                coordinates: [from, to],
                source: 'fallback',
                distanceMeters: distanceMetersBetween(from, to),
                failure: {
                    code: failureCode,
                    message: failureCode === 'authentication'
                        ? 'Mapbox authorization failed. The accepted runtime was retained.'
                        : failureCode === 'rate-limit'
                            ? 'Mapbox request capacity was reached. The accepted runtime was retained.'
                            : 'Mapbox could not complete the request. The accepted runtime was retained.',
                },
            };
        }

        const data = await response.json() as MapboxDirectionsResponse;
        const coordinates = data.routes?.[0]?.geometry?.coordinates;
        if (data.code !== 'Ok' || !coordinates?.length) {
            return {
                coordinates: [from, to],
                source: 'fallback',
                distanceMeters: distanceMetersBetween(from, to),
                failure: {
                    code: data.code === 'NoRoute' || data.code === 'NoSegment' ? 'no-route' : 'invalid-response',
                    message: data.code === 'NoRoute' || data.code === 'NoSegment'
                        ? 'Mapbox could not find a usable road route for one or more segments. The accepted runtime was retained.'
                        : 'Mapbox returned an incomplete route. The accepted runtime was retained.',
                },
            };
        }

        const route = data.routes[0];
        const result = {
            coordinates,
            source: 'mapbox' as const,
            durationSeconds: route?.duration,
            distanceMeters: route?.distance,
            roadLabels: buildRoadLabelsFromRoute(route),
        };
        setCachedSegment(cacheKey, result);
        return result;
    } catch {
        if (signal?.aborted) throw new DOMException('Route snap cancelled.', 'AbortError');
        return {
            coordinates: [from, to],
            source: 'fallback',
            distanceMeters: distanceMetersBetween(from, to),
            failure: { code: 'network', message: 'Mapbox could not be reached. The accepted runtime was retained.' },
        };
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
    signal?: AbortSignal,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < items.length) {
            if (signal?.aborted) throw new DOMException('Route snap cancelled.', 'AbortError');
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index]!, index);
        }
    }

    const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
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
        waypoints.slice(1).map((to, index) => fetchRoadSegment(
            waypoints[index],
            to,
            token,
            fetchImpl,
            options.signal,
            options.forceRefresh,
        )),
    );
    const durationSeconds = segmentResults.every((result) => typeof result.durationSeconds === 'number')
        ? segmentResults.reduce((sum, result) => sum + (result.durationSeconds ?? 0), 0)
        : undefined;
    const distanceMeters = segmentResults.every((result) => typeof result.distanceMeters === 'number')
        ? segmentResults.reduce((sum, result) => sum + (result.distanceMeters ?? 0), 0)
        : undefined;
    const roadLabels = segmentResults.flatMap((result) => result.roadLabels ?? []);

    return {
        coordinates: stitchSegmentCoordinates(segmentResults.map((result) => result.coordinates)),
        source: segmentResults.every((result) => result.source === 'mapbox') ? 'mapbox' : 'fallback',
        durationSeconds,
        distanceMeters,
        roadLabels,
        failure: segmentResults.find((result) => result.failure)?.failure,
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

function buildSegmentRuntimeEstimate(
    segment: ReturnType<typeof buildRoutePlanner2StopSegmentPaths>[number],
    result: RoutePlanner2RoadSnapResult | undefined,
    now: string,
): RoutePlanner2SegmentRuntime {
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
            ? result?.failure?.message ?? 'Mapbox travel time was unavailable; using distance and default speed.'
            : undefined,
        fallbackCode: source === 'fallback' ? result?.failure?.code : undefined,
    };
}

export function buildRoutePlanner2FallbackRoadSnapResult(scenario: RoutePlanner2Scenario): RoutePlanner2ScenarioRoadSnapResult {
    const segments = buildRoutePlanner2StopSegmentPaths(scenario);
    const now = new Date().toISOString();
    const segmentGeometries = segments.map((segment) => ({
        id: segment.id,
        fromStopId: segment.fromStopId,
        toStopId: segment.toStopId,
        coordinates: segment.coordinates,
        source: 'fallback' as const,
    }));
    const segmentEstimates = segments.map((segment) => buildSegmentRuntimeEstimate(segment, {
        coordinates: segment.coordinates,
        source: 'fallback',
        distanceMeters: distanceMetersForPath(segment.coordinates),
    }, now));
    const coordinates = segments.length > 0
        ? stitchSegmentCoordinates(segmentGeometries.map((segment) => segment.coordinates))
        : [...scenario.alignment]
            .sort((a, b) => a.sequence - b.sequence)
            .map((point): [number, number] => [point.lng, point.lat]);

    return {
        coordinates,
        source: 'fallback',
        distanceMeters: distanceMetersForPath(coordinates),
        segmentEstimates,
        segmentGeometries,
        failures: [],
    };
}

export async function snapRoutePlanner2ScenarioToRoad(
    scenario: RoutePlanner2Scenario,
    options: SnapOptions = {},
): Promise<RoutePlanner2ScenarioRoadSnapResult> {
    const segments = buildRoutePlanner2StopSegmentPaths(scenario);
    if (segments.length === 0) {
        return buildRoutePlanner2FallbackRoadSnapResult(scenario);
    }

    const now = new Date().toISOString();
    const concurrency = options.concurrency ?? 3;
    let completedSegments = 0;
    const segmentResults = await mapWithConcurrency(
        segments,
        concurrency,
        async (segment) => {
            const result = await snapRoutePlanner2WaypointsToRoad(segment.coordinates, options);
            const segmentEstimate = buildSegmentRuntimeEstimate(segment, result, now);
            const segmentGeometry = {
                id: segment.id,
                fromStopId: segment.fromStopId,
                toStopId: segment.toStopId,
                coordinates: result.coordinates,
                source: result.source,
                roadLabels: result.roadLabels,
            };
            completedSegments += 1;
            options.onProgress?.({
                totalSegments: segments.length,
                completedSegments,
                segmentEstimate,
                segmentGeometry,
            });
            return { result, segmentEstimate, segmentGeometry };
        },
        options.signal,
    );
    const results = segmentResults.map((item) => item.result);
    const segmentEstimates = segmentResults.map((item) => item.segmentEstimate);
    const segmentGeometries = segmentResults.map((item) => item.segmentGeometry);
    const failures = segmentResults.flatMap((item) => item.result.failure ? [item.result.failure] : []);

    return {
        coordinates: stitchSegmentCoordinates(results.map((result) => result.coordinates)),
        source: results.every((result) => result.source === 'mapbox') ? 'mapbox' : 'fallback',
        durationSeconds: results.every((result) => typeof result.durationSeconds === 'number')
            ? results.reduce((sum, result) => sum + (result.durationSeconds ?? 0), 0)
            : undefined,
        distanceMeters: distanceMetersForPath(stitchSegmentCoordinates(results.map((result) => result.coordinates))),
        segmentEstimates,
        segmentGeometries,
        failures,
    };
}
