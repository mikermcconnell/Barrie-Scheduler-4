import type { ResidentialGrowthGeocode, ResidentialGrowthGeocodeCache, ResidentialGrowthRecord } from './types';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const BARRIE_BBOX = '-79.85,44.25,-79.55,44.50';

function normalizeAddressKey(address: string): string {
    return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildQuery(address: string): string {
    const trimmed = address.trim();
    if (/barrie/i.test(trimmed)) return trimmed;
    return `${trimmed}, Barrie, Ontario, Canada`;
}

interface MapboxFeature {
    center?: [number, number];
    place_name?: string;
    relevance?: number;
}

interface MapboxResponse {
    features?: MapboxFeature[];
}

export function createEmptyResidentialGrowthGeocodeCache(): ResidentialGrowthGeocodeCache {
    return { addresses: {}, lastUpdated: new Date().toISOString() };
}

export async function geocodeResidentialGrowthAddress(address: string): Promise<ResidentialGrowthGeocode | null> {
    if (!MAPBOX_TOKEN || !address.trim()) return null;

    const query = encodeURIComponent(buildQuery(address));
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&country=ca&limit=1&bbox=${BARRIE_BBOX}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as MapboxResponse;
    const feature = data.features?.[0];
    if (!feature?.center) return null;

    const relevance = feature.relevance ?? 0;
    return {
        lon: feature.center[0],
        lat: feature.center[1],
        displayName: feature.place_name || address,
        source: 'mapbox',
        confidence: relevance >= 0.9 ? 'high' : relevance >= 0.75 ? 'medium' : 'low',
    };
}

export async function geocodeResidentialGrowthRecords(
    records: ResidentialGrowthRecord[],
    cache: ResidentialGrowthGeocodeCache | null,
    onProgress?: (done: number, total: number, address: string) => void,
): Promise<{ records: ResidentialGrowthRecord[]; cache: ResidentialGrowthGeocodeCache; failed: string[] }> {
    const nextCache: ResidentialGrowthGeocodeCache = cache
        ? { addresses: { ...cache.addresses }, lastUpdated: new Date().toISOString() }
        : createEmptyResidentialGrowthGeocodeCache();
    const failed: string[] = [];
    let done = 0;

    const uniqueAddresses = Array.from(new Set(records.map((record) => record.address).filter(Boolean)));
    for (const address of uniqueAddresses) {
        const key = normalizeAddressKey(address);
        if (!nextCache.addresses[key]) {
            onProgress?.(done, uniqueAddresses.length, address);
            const geocode = await geocodeResidentialGrowthAddress(address);
            if (geocode) nextCache.addresses[key] = geocode;
            else failed.push(address);
        }
        done += 1;
        onProgress?.(done, uniqueAddresses.length, address);
    }

    const withGeocodes = records.map((record) => {
        const geocode = nextCache.addresses[normalizeAddressKey(record.address)] ?? null;
        const warnings = geocode
            ? record.warnings.filter((warning) => warning !== 'Address could not be geocoded.')
            : Array.from(new Set([...record.warnings, 'Address could not be geocoded.']));
        return { ...record, geocode, warnings };
    });

    return { records: withGeocodes, cache: nextCache, failed };
}
