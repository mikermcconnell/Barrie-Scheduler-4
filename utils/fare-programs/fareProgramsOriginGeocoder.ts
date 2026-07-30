import { getClientMapboxToken, normalizeMapboxToken } from '../mapboxToken';
import { findStopCoords } from '../gtfs/gtfsStopLookup';
const BARRIE_BBOX = {
    west: -79.85,
    south: 44.25,
    east: -79.55,
    north: 44.50,
};
const BARRIE_PROXIMITY = { longitude: -79.69, latitude: 44.38 };
const GEOCODE_CONCURRENCY = 6;

interface MapboxFeature {
    id?: string;
    place_type?: string[];
    center?: [number, number];
    relevance?: number;
}

interface MapboxResponse {
    features?: MapboxFeature[];
}

export interface FareProgramOriginGeocode {
    originId: string;
    latitude: number;
    longitude: number;
    relevance: number;
    source: 'gtfs-stop' | 'mapbox';
}

export interface FareProgramOriginGeocodeProgress {
    completed: number;
    total: number;
    label: string;
}

export interface FareProgramGeocodableOrigin {
    id: string;
    label: string;
    geocodeQuery: string;
}

export function buildFareProgramOriginGeocodeUrl(query: string, token: string): string {
    const searchText = `${query}, Barrie, Ontario, Canada`;
    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchText)}.json`);
    url.searchParams.set('access_token', normalizeMapboxToken(token) ?? '');
    url.searchParams.set('autocomplete', 'false');
    url.searchParams.set('country', 'ca');
    url.searchParams.set('bbox', `${BARRIE_BBOX.west},${BARRIE_BBOX.south},${BARRIE_BBOX.east},${BARRIE_BBOX.north}`);
    url.searchParams.set('proximity', `${BARRIE_PROXIMITY.longitude},${BARRIE_PROXIMITY.latitude}`);
    url.searchParams.set('limit', '1');
    return url.toString();
}

function withinBarrie(latitude: number, longitude: number): boolean {
    return longitude >= BARRIE_BBOX.west
        && longitude <= BARRIE_BBOX.east
        && latitude >= BARRIE_BBOX.south
        && latitude <= BARRIE_BBOX.north;
}

export async function geocodeFareProgramOrigins(
    origins: FareProgramGeocodableOrigin[],
    options: {
        token?: string | null;
        fetcher?: typeof fetch;
        onProgress?: (progress: FareProgramOriginGeocodeProgress) => void;
    } = {},
): Promise<{ geocodes: FareProgramOriginGeocode[]; failedOriginIds: string[] }> {
    const token = normalizeMapboxToken(options.token) ?? getClientMapboxToken();
    if (!token) throw new Error('Mapbox token is not configured.');

    const fetcher = options.fetcher ?? fetch;
    const geocodes: FareProgramOriginGeocode[] = [];
    const failedOriginIds: string[] = [];
    let nextIndex = 0;
    let completed = 0;

    async function processNext(): Promise<void> {
        while (nextIndex < origins.length) {
            const origin = origins[nextIndex];
            nextIndex += 1;
            try {
                const stopCoords = findStopCoords(undefined, origin.geocodeQuery)
                    ?? findStopCoords(undefined, origin.label);
                if (stopCoords) {
                    geocodes.push({
                        originId: origin.id,
                        latitude: stopCoords.lat,
                        longitude: stopCoords.lon,
                        relevance: 1,
                        source: 'gtfs-stop',
                    });
                    continue;
                }
                const response = await fetcher(buildFareProgramOriginGeocodeUrl(origin.geocodeQuery, token));
                if (!response.ok) throw new Error(`Mapbox returned ${response.status}.`);
                const data = await response.json() as MapboxResponse;
                const feature = data.features?.[0];
                const [longitude, latitude] = feature?.center ?? [];
                const featureTypes = feature?.place_type ?? [];
                const isGenericPlace = featureTypes.some(type => ['place', 'region', 'country'].includes(type))
                    || /^place\./.test(feature?.id ?? '');
                if (isGenericPlace || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !withinBarrie(latitude, longitude)) {
                    throw new Error('No result inside Barrie.');
                }
                geocodes.push({
                    originId: origin.id,
                    latitude,
                    longitude,
                    relevance: feature?.relevance ?? 0,
                    source: 'mapbox',
                });
            } catch {
                failedOriginIds.push(origin.id);
            } finally {
                completed += 1;
                options.onProgress?.({ completed, total: origins.length, label: origin.label });
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(GEOCODE_CONCURRENCY, Math.max(1, origins.length)) }, () => processNext()),
    );

    return { geocodes, failedOriginIds };
}
