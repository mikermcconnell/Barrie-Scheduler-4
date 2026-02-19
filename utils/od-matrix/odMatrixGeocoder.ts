/**
 * OD Matrix Geocoder
 *
 * Geocodes station names via OpenStreetMap Nominatim.
 * Rate-limited to 1 req/1.1s per Nominatim usage policy.
 * Uses Firebase geocode cache to skip already-geocoded stations.
 */

import type { GeocodedLocation, GeocodeCache, ODStation } from './odMatrixTypes';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const RATE_LIMIT_MS = 1100; // 1.1 seconds between requests

interface GeocodeProgress {
    current: number;
    total: number;
    stationName: string;
    status: 'geocoding' | 'cached' | 'failed' | 'skipped' | 'success';
}

interface GeocodeResult {
    cache: GeocodeCache;
    geocoded: number;
    cached: number;
    failed: string[];
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeStation(name: string): Promise<GeocodedLocation | null> {
    const queries = buildSearchQueries(name);

    for (const q of queries) {
        try {
            const params = new URLSearchParams({
                q,
                format: 'json',
                limit: '1',
                countrycodes: 'ca',
            });

            const response = await fetch(`${NOMINATIM_BASE}?${params}`, {
                headers: { 'User-Agent': 'BarrieTransitScheduler/1.0' },
            });

            if (!response.ok) continue;

            const results = await response.json();
            if (results.length > 0) {
                const result = results[0];
                const nameMatch = result.display_name.toLowerCase().includes(name.toLowerCase().split(' - ')[0].trim());
                return {
                    lat: parseFloat(result.lat),
                    lon: parseFloat(result.lon),
                    displayName: result.display_name,
                    source: 'auto',
                    confidence: nameMatch ? 'high' : 'medium',
                };
            }
        } catch {
            // Try next query variant
        }
    }

    return null;
}

function buildSearchQueries(name: string): string[] {
    const queries: string[] = [];
    const trimmed = name.trim();

    // Full name + Ontario context
    queries.push(`${trimmed}, Ontario, Canada`);

    // If name has " - " separator (e.g. "Toronto - Yorkdale"), try the specific part
    if (trimmed.includes(' - ')) {
        const parts = trimmed.split(' - ');
        if (parts.length === 2) {
            queries.push(`${parts[1].trim()}, ${parts[0].trim()}, Ontario, Canada`);
            queries.push(`${parts[1].trim()} station, Ontario, Canada`);
        }
    }

    // Try as a train station
    queries.push(`${trimmed} station, Ontario, Canada`);

    return queries;
}

export async function geocodeStations(
    stations: ODStation[],
    existingCache: GeocodeCache | null,
    onProgress?: (progress: GeocodeProgress) => void,
    abortSignal?: AbortSignal,
): Promise<GeocodeResult> {
    const cache: GeocodeCache = {
        stations: { ...(existingCache?.stations || {}) },
        lastUpdated: '',
    };

    let geocoded = 0;
    let cached = 0;
    const failed: string[] = [];

    for (let i = 0; i < stations.length; i++) {
        if (abortSignal?.aborted) break;

        const station = stations[i];
        const report = (status: GeocodeProgress['status']) =>
            onProgress?.({ current: i + 1, total: stations.length, stationName: station.name, status });

        // Check cache first
        if (cache.stations[station.name]) {
            cached++;
            report('cached');
            continue;
        }

        report('geocoding');
        const result = await geocodeStation(station.name);

        if (result) {
            cache.stations[station.name] = result;
            geocoded++;
            report('success');
        } else {
            failed.push(station.name);
            report('failed');
        }

        // Rate limit (skip delay on last station)
        if (i < stations.length - 1) {
            await delay(RATE_LIMIT_MS);
        }
    }

    cache.lastUpdated = new Date().toISOString();

    return { cache, geocoded, cached, failed };
}

export function applyGeocodesToStations(
    stations: ODStation[],
    cache: GeocodeCache
): ODStation[] {
    return stations.map(station => ({
        ...station,
        geocode: cache.stations[station.name] || null,
    }));
}
