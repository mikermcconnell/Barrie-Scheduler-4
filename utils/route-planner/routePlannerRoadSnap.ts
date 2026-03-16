import type { RouteScenarioPattern, RouteStop } from './routePlannerTypes';

const CACHE_TTL_MS = 60 * 60 * 1000;
const COORD_PRECISION = 5;
const MAX_FULL_WAYPOINT_REROUTE_POINTS = 24;

interface CacheEntry {
    coordinates: [number, number][];
    expiresAt: number;
}

const segmentCache = new Map<string, CacheEntry>();

export interface RoutePlannerRoadSnapResult {
    coordinates: [number, number][];
    source: 'mapbox' | 'fallback';
    stopWaypoints: [number, number][];
}

interface MapboxRoute {
    geometry: {
        coordinates: [number, number][];
        type: 'LineString';
    };
}

interface MapboxDirectionsResponse {
    code: string;
    routes: MapboxRoute[];
}

interface TraversalNode {
    coordinate: [number, number];
    baseIndex: number;
}

function roundCoord(value: number): number {
    return Math.round(value * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

function buildSegmentCacheKey(from: [number, number], to: [number, number]): string {
    return `${roundCoord(from[0])},${roundCoord(from[1])}_${roundCoord(to[0])},${roundCoord(to[1])}`;
}

function getCachedSegment(key: string): [number, number][] | null {
    const entry = segmentCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        segmentCache.delete(key);
        return null;
    }
    return entry.coordinates;
}

function setCachedSegment(key: string, coordinates: [number, number][]): void {
    segmentCache.set(key, {
        coordinates,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

function buildTraversalWaypoints(pattern: RouteScenarioPattern, stopWaypoints: [number, number][]): [number, number][] {
    if (pattern === 'loop' && stopWaypoints.length >= 3) {
        const first = stopWaypoints[0];
        const last = stopWaypoints[stopWaypoints.length - 1];
        return coordinatesEqual(first, last)
            ? stopWaypoints
            : [...stopWaypoints, first];
    }

    if (pattern === 'out-and-back' && stopWaypoints.length >= 2) {
        return [...stopWaypoints, ...stopWaypoints.slice(0, -1).reverse()];
    }

    return stopWaypoints;
}

function buildTraversalNodes(pattern: RouteScenarioPattern, waypoints: [number, number][]): TraversalNode[] {
    const nodes = waypoints.map((coordinate, index) => ({ coordinate, baseIndex: index }));

    if (pattern === 'loop' && nodes.length >= 3) {
        return coordinatesEqual(nodes[0].coordinate, nodes[nodes.length - 1].coordinate)
            ? nodes
            : [...nodes, { ...nodes[0] }];
    }

    if (pattern === 'out-and-back' && nodes.length >= 2) {
        return [
            ...nodes,
            ...nodes.slice(0, -1).reverse(),
        ];
    }

    return nodes;
}

async function fetchRoadSegment(
    from: [number, number],
    to: [number, number],
    token: string | null
): Promise<{ coordinates: [number, number][]; source: 'mapbox' | 'fallback' }> {
    if (coordinatesEqual(from, to)) {
        return {
            coordinates: [from],
            source: 'fallback',
        };
    }

    const cacheKey = buildSegmentCacheKey(from, to);
    const cached = getCachedSegment(cacheKey);
    if (cached) {
        return {
            coordinates: cached,
            source: 'mapbox',
        };
    }

    if (!token) {
        return {
            coordinates: [from, to],
            source: 'fallback',
        };
    }

    try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&steps=false&access_token=${token}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Mapbox returned ${response.status}`);
        }

        const data = await response.json() as MapboxDirectionsResponse;
        if (data.code !== 'Ok' || !data.routes?.length) {
            throw new Error(`Mapbox returned code ${data.code}`);
        }

        const coordinates = data.routes[0].geometry.coordinates;
        setCachedSegment(cacheKey, coordinates);
        return {
            coordinates,
            source: 'mapbox',
        };
    } catch {
        return {
            coordinates: [from, to],
            source: 'fallback',
        };
    }
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

export function buildRouteStopWaypoints(stops: RouteStop[]): [number, number][] {
    return stops.map((stop) => [stop.longitude, stop.latitude]);
}

export function buildRouteStopSignature(stops: RouteStop[]): string {
    return stops
        .map((stop) => `${stop.id}:${stop.longitude.toFixed(5)},${stop.latitude.toFixed(5)}`)
        .join('|');
}

export function buildRouteWaypointSignature(waypoints: [number, number][]): string {
    return waypoints
        .map((coordinate, index) => `${index}:${coordinate[0].toFixed(5)},${coordinate[1].toFixed(5)}`)
        .join('|');
}

export async function snapRouteStopsToRoad(
    stops: RouteStop[],
    pattern: RouteScenarioPattern
): Promise<RoutePlannerRoadSnapResult> {
    const stopWaypoints = buildRouteStopWaypoints(stops);
    if (stopWaypoints.length < 2) {
        return {
            coordinates: stopWaypoints,
            source: 'fallback',
            stopWaypoints,
        };
    }

    const traversalWaypoints = buildTraversalWaypoints(pattern, stopWaypoints);
    const token = getMapboxToken();
    const segmentResults = await Promise.all(
        traversalWaypoints.slice(1).map((to, index) => fetchRoadSegment(traversalWaypoints[index], to, token))
    );

    return {
        coordinates: stitchSegmentCoordinates(segmentResults.map((result) => result.coordinates)),
        source: segmentResults.every((result) => result.source === 'mapbox') ? 'mapbox' : 'fallback',
        stopWaypoints,
    };
}

export async function snapRouteWaypointsToRoad(
    waypoints: [number, number][],
    pattern: RouteScenarioPattern,
    changedWaypointIndex: number
): Promise<{ coordinates: [number, number][]; source: 'mapbox' | 'fallback' }> {
    if (waypoints.length < 2) {
        return {
            coordinates: waypoints,
            source: 'fallback',
        };
    }

    const traversalNodes = buildTraversalNodes(pattern, waypoints);
    const token = getMapboxToken();
    const rerouteEntirePath = waypoints.length <= MAX_FULL_WAYPOINT_REROUTE_POINTS;
    const segmentResults = await Promise.all(
        traversalNodes.slice(1).map(async (toNode, index) => {
            const fromNode = traversalNodes[index];
            const touchesChangedWaypoint = rerouteEntirePath
                || fromNode.baseIndex === changedWaypointIndex
                || toNode.baseIndex === changedWaypointIndex;

            if (!touchesChangedWaypoint) {
                return {
                    coordinates: [fromNode.coordinate, toNode.coordinate] as [number, number][],
                    source: 'fallback' as const,
                };
            }

            return fetchRoadSegment(fromNode.coordinate, toNode.coordinate, token);
        })
    );

    return {
        coordinates: stitchSegmentCoordinates(segmentResults.map((result) => result.coordinates)),
        source: segmentResults
            .filter((result, index) => {
                if (rerouteEntirePath) return true;
                const fromNode = traversalNodes[index];
                const toNode = traversalNodes[index + 1];
                return fromNode.baseIndex === changedWaypointIndex || toNode.baseIndex === changedWaypointIndex;
            })
            .every((result) => result.source === 'mapbox')
                ? 'mapbox'
                : 'fallback',
    };
}
