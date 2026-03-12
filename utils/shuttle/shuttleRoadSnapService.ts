import type { ShuttlePattern } from './shuttleTypes';

const CACHE_TTL_MS = 60 * 60 * 1000;
const COORD_PRECISION = 5;

interface CacheEntry {
    coordinates: [number, number][];
    expiresAt: number;
}

const snapCache = new Map<string, CacheEntry>();

export interface ShuttleRoadSnapResult {
    coordinates: [number, number][];
    source: 'mapbox' | 'fallback';
}

function roundCoord(value: number): number {
    return Math.round(value * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

function buildCacheKey(pattern: ShuttlePattern, waypoints: [number, number][]): string {
    return `${pattern}:${waypoints.map(([lon, lat]) => `${roundCoord(lon)},${roundCoord(lat)}`).join(';')}`;
}

function getCached(key: string): [number, number][] | null {
    const entry = snapCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        snapCache.delete(key);
        return null;
    }
    return entry.coordinates;
}

function setCached(key: string, coordinates: [number, number][]): void {
    snapCache.set(key, {
        coordinates,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

function buildRouteWaypoints(pattern: ShuttlePattern, waypoints: [number, number][]): [number, number][] {
    if (pattern === 'loop' && waypoints.length >= 3) {
        const first = waypoints[0];
        const last = waypoints[waypoints.length - 1];
        if (first[0] === last[0] && first[1] === last[1]) return waypoints;
        return [...waypoints, first];
    }

    if (pattern === 'out-and-back' && waypoints.length >= 2) {
        return [...waypoints, ...waypoints.slice(0, -1).reverse()];
    }

    return waypoints;
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

export async function snapShuttleWaypointsToRoad(
    waypoints: [number, number][],
    pattern: ShuttlePattern
): Promise<ShuttleRoadSnapResult> {
    if (waypoints.length < 2) {
        return {
            coordinates: waypoints,
            source: 'fallback',
        };
    }

    const fallbackCoordinates = buildRouteWaypoints(pattern, waypoints);
    const cacheKey = buildCacheKey(pattern, waypoints);
    const cached = getCached(cacheKey);
    if (cached) {
        return {
            coordinates: cached,
            source: 'mapbox',
        };
    }

    const token = getMapboxToken();
    if (!token) {
        return {
            coordinates: fallbackCoordinates,
            source: 'fallback',
        };
    }

    try {
        const routeWaypoints = buildRouteWaypoints(pattern, waypoints);
        const coordinatesParam = routeWaypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesParam}?geometries=geojson&overview=full&steps=false&access_token=${token}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Mapbox returned ${response.status}`);
        }

        const data = await response.json() as MapboxDirectionsResponse;
        if (data.code !== 'Ok' || !data.routes?.length) {
            throw new Error(`Mapbox returned code ${data.code}`);
        }

        const snappedCoordinates = data.routes[0].geometry.coordinates;
        setCached(cacheKey, snappedCoordinates);
        return {
            coordinates: snappedCoordinates,
            source: 'mapbox',
        };
    } catch {
        return {
            coordinates: fallbackCoordinates,
            source: 'fallback',
        };
    }
}
