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
const NOMINATIM_RESULT_LIMIT = 5;
const MIN_ACCEPT_SCORE = 6;
const HIGH_CONFIDENCE_SCORE = 14;
const CANADA_BOUNDS = {
    minLat: 41.0,
    maxLat: 84.0,
    minLon: -141.5,
    maxLon: -52.0,
};
const ONTARIO_BOUNDS = {
    minLat: 41.7,
    maxLat: 56.9,
    minLon: -95.2,
    maxLon: -74.3,
};
const KNOWN_OUT_OF_PROVINCE: Record<string, { lat: number; lon: number }> = {
    'winnipeg': { lat: 49.8951, lon: -97.1384 },
};
const STOPWORDS = new Set([
    'the', 'and', 'of', 'at', 'in', 'on', 'to', 'for',
]);
const TRANSIT_KEYWORDS = [
    'station', 'terminal', 'transit', 'airport', 'hospital',
    'university', 'college', 'centre', 'center', 'rail', 'bus',
];
const REGION_PENALTIES = ['new york', 'michigan', 'wisconsin', 'north dakota', 'minnesota', 'vermont'];
const EXPANSION_PATTERNS: Array<[RegExp, string]> = [
    [/\bHwy\b/gi, 'Highway'],
    [/\bUniv\b/gi, 'University'],
    [/\bCtr\b/gi, 'Centre'],
    [/\bHosp\b/gi, 'Hospital'],
    [/\bJct\b/gi, 'Junction'],
    [/\bSt\b\./gi, 'Street'],
    [/\s+/g, ' '],
];
const STATION_QUERY_ALIASES: Record<string, string[]> = {
    'toronto - union station bus terminal': [
        'Union Station Bus Terminal, Toronto, Ontario, Canada',
        'Toronto Coach Terminal, Toronto, Ontario, Canada',
    ],
    'toronto - union station train': [
        'Union Station, Toronto, Ontario, Canada',
    ],
    'toronto - vaughan - highway 407 terminal': [
        'Highway 407 Bus Terminal, Vaughan, Ontario, Canada',
    ],
    'pearson airport terminal 1': [
        'Toronto Pearson International Airport Terminal 1, Mississauga, Ontario, Canada',
    ],
    'ottawa - via rail': [
        'Ottawa VIA Rail Station, Ottawa, Ontario, Canada',
    ],
    'kanata - oc transpo terry fox': [
        'Terry Fox Station, Kanata, Ontario, Canada',
    ],
    'mcmaster university': [
        'McMaster University, Hamilton, Ontario, Canada',
    ],
    'ontario tech university oshawa': [
        'Ontario Tech University, Oshawa, Ontario, Canada',
    ],
    'north bay - education centre - main campus': [
        'Canadore College Main Campus, North Bay, Ontario, Canada',
    ],
    'north bay - education centre - lower residence': [
        'Canadore College Residence, North Bay, Ontario, Canada',
    ],
    'timmins - timmins and district hospital': [
        'Timmins and District Hospital, Timmins, Ontario, Canada',
    ],
    'new liskeard - temiskaming hospital': [
        'Temiskaming Hospital, New Liskeard, Ontario, Canada',
    ],
    'sudbury - health sciences north': [
        'Health Sciences North, Sudbury, Ontario, Canada',
    ],
    'ottawa - hospital - general campus': [
        'The Ottawa Hospital General Campus, Ottawa, Ontario, Canada',
    ],
    'ottawa - cheo': [
        'CHEO, Ottawa, Ontario, Canada',
    ],
    'sault area hospital': [
        'Sault Area Hospital, Sault Ste. Marie, Ontario, Canada',
    ],
    'sault college': [
        'Sault College, Sault Ste. Marie, Ontario, Canada',
    ],
    'thunder bay - regional health sciences centre': [
        'Thunder Bay Regional Health Sciences Centre, Thunder Bay, Ontario, Canada',
    ],
    'thunder bay - lakehead university': [
        'Lakehead University, Thunder Bay, Ontario, Canada',
    ],
    'king city go station': [
        'King City GO Station, King City, Ontario, Canada',
    ],
    // Ontario Northland stops — disambiguate names that exist in other provinces
    'renfrew': ['Renfrew, Ontario, Canada'],
    'north bay': ['North Bay, Ontario, Canada'],
    'cochrane': ['Cochrane, Ontario, Canada'],
    'huntsville': ['Huntsville, Ontario, Canada'],
    'marathon': ['Marathon, Ontario, Canada'],
    'deep river': ['Deep River, Ontario, Canada'],
    'pembroke': ['Pembroke, Ontario, Canada'],
    'dryden': ['Dryden, Ontario, Canada'],
    'blind river': ['Blind River, Ontario, Canada'],
    'parry sound': ['Parry Sound, Ontario, Canada'],
    'orillia': ['Orillia, Ontario, Canada'],
    'gravenhurst': ['Gravenhurst, Ontario, Canada'],
    'bracebridge': ['Bracebridge, Ontario, Canada'],
    'sudbury': ['Sudbury, Ontario, Canada'],
    'timmins': ['Timmins, Ontario, Canada'],
    'kirkland lake': ['Kirkland Lake, Ontario, Canada'],
    'kenora': ['Kenora, Ontario, Canada'],
    'thunder bay': ['Thunder Bay, Ontario, Canada'],
    'sault ste marie': ['Sault Ste. Marie, Ontario, Canada'],
    'mattawa': ['Mattawa, Ontario, Canada'],
    'sturgeon falls': ['Sturgeon Falls, Ontario, Canada'],
    'espanola': ['Espanola, Ontario, Canada'],
    'petawawa': ['Petawawa, Ontario, Canada'],
    'arnprior': ['Arnprior, Ontario, Canada'],
    'cobalt': ['Cobalt, Ontario, Canada'],
    'haileybury': ['Haileybury, Ontario, Canada'],
    'englehart': ['Englehart, Ontario, Canada'],
    'temagami': ['Temagami, Ontario, Canada'],
    'kapuskasing': ['Kapuskasing, Ontario, Canada'],
    'hearst': ['Hearst, Ontario, Canada'],
    'elliot lake': ['Elliot Lake, Ontario, Canada'],
    'wawa': ['Wawa, Ontario, Canada'],
    'thessalon': ['Thessalon, Ontario, Canada'],
};

interface NominatimCandidate {
    lat: string;
    lon: string;
    display_name: string;
    class?: string;
    type?: string;
    importance?: number;
}

interface ScoringContext {
    stationTokens: string[];
    cityTokens: string[];
    placeTokens: string[];
    hasCityPlaceFormat: boolean;
}

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

export function isWithinCanada(lat: number, lon: number): boolean {
    return lat >= CANADA_BOUNDS.minLat
        && lat <= CANADA_BOUNDS.maxLat
        && lon >= CANADA_BOUNDS.minLon
        && lon <= CANADA_BOUNDS.maxLon;
}

// Backward-compatible alias for existing imports.
export const isWithinOntario = isWithinCanada;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function sanitizeStationName(name: string): string {
    return normalizeWhitespace(name.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+/g, ' - '));
}

function expandAbbreviations(value: string): string {
    return EXPANSION_PATTERNS.reduce(
        (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
        value,
    ).trim();
}

function normalizeAliasKey(name: string): string {
    return sanitizeStationName(expandAbbreviations(name)).toLowerCase();
}

function splitCityPlace(name: string): { city: string | null; place: string } {
    const parts = name.split(' - ').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return {
            city: parts[0],
            place: parts.slice(1).join(' '),
        };
    }
    return { city: null, place: name };
}

export function passesCityGate(displayName: string, city: string | null): boolean {
    if (!city) return true;
    const normalizedDisplay = displayName.toLowerCase();
    // Normalize punctuation so "Sault Ste. Marie" matches "Sault Ste Marie"
    const normalizedCity = city.toLowerCase().replace(/[.]/g, '');
    const normalizedDisplayClean = normalizedDisplay.replace(/[.]/g, '');
    return normalizedDisplayClean.includes(normalizedCity);
}

export function buildCityConstrainedQueries(city: string | null, place: string): string[] {
    if (!city) return [];
    const queries = [
        `${place}, ${city}, Ontario, Canada`,
        `${place} ${city}, Ontario, Canada`,
        `${city} ${place}, Ontario, Canada`,
    ];
    return dedupeQueries(queries);
}

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(t => t.trim())
        .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function dedupeQueries(queries: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    queries.forEach((q) => {
        const normalized = normalizeWhitespace(q).toLowerCase();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        out.push(normalizeWhitespace(q));
    });
    return out;
}

function buildScoringContext(name: string): ScoringContext {
    const expanded = expandAbbreviations(sanitizeStationName(name));
    const { city, place } = splitCityPlace(expanded);
    const stationTokens = tokenize(expanded);
    const cityTokens = city ? tokenize(city) : [];
    const placeTokens = tokenize(place);

    return {
        stationTokens,
        cityTokens,
        placeTokens,
        hasCityPlaceFormat: !!city,
    };
}

async function fetchCandidates(query: string): Promise<NominatimCandidate[]> {
    const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: String(NOMINATIM_RESULT_LIMIT),
        countrycodes: 'ca',
        addressdetails: '1',
        viewbox: '-95.2,56.9,-74.3,41.7',
        bounded: '0',
    });

    const response = await fetch(`${NOMINATIM_BASE}?${params}`, {
        headers: { 'User-Agent': 'BarrieTransitScheduler/1.0' },
    });
    if (!response.ok) return [];

    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed as NominatimCandidate[] : [];
}

function scoreCandidate(
    candidate: NominatimCandidate,
    context: ScoringContext,
    query: string,
): number {
    const display = candidate.display_name.toLowerCase();
    const metadata = `${candidate.class || ''} ${candidate.type || ''}`.toLowerCase();
    let score = 0;

    if (display.includes(query.toLowerCase())) {
        score += 3;
    }

    const stationMatches = context.stationTokens.filter(t => display.includes(t)).length;
    score += Math.min(8, stationMatches * 1.25);

    if (context.placeTokens.length > 0) {
        const placeMatches = context.placeTokens.filter(t => display.includes(t)).length;
        score += Math.min(8, placeMatches * 1.5);
    }

    if (context.hasCityPlaceFormat && context.cityTokens.length > 0) {
        const cityMatches = context.cityTokens.filter(t => display.includes(t)).length;
        if (cityMatches === context.cityTokens.length) score += 6;
        else if (cityMatches > 0) score += 2;
        else score -= 3;
    }

    const keywordHits = TRANSIT_KEYWORDS.filter(k => display.includes(k) || metadata.includes(k)).length;
    score += Math.min(6, keywordHits * 2);

    if (display.includes('ontario')) score += 5;
    REGION_PENALTIES.forEach((needle) => {
        if (display.includes(needle)) score -= 8;
    });

    const importance = typeof candidate.importance === 'number' ? candidate.importance : 0;
    score += Math.min(2, Math.max(0, importance) * 2);

    if (!context.hasCityPlaceFormat && context.stationTokens.length <= 2 && keywordHits === 0) {
        score -= 1;
    }

    return score;
}

async function geocodeStation(name: string): Promise<GeocodedLocation | null> {
    const queries = buildSearchQueries(name);
    const context = buildScoringContext(name);
    const { city, place } = splitCityPlace(expandAbbreviations(sanitizeStationName(name)));
    let best: { candidate: NominatimCandidate; score: number } | null = null;

    for (const q of queries) {
        try {
            const results = await fetchCandidates(q);
            for (const result of results) {
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                if (!isWithinCanada(lat, lon)) continue;

                const score = scoreCandidate(result, context, q);
                if (!best || score > best.score) {
                    best = { candidate: result, score };
                }
            }

            if (best && best.score >= HIGH_CONFIDENCE_SCORE) {
                break;
            }
        } catch {
            // Try next query variant
        }
    }

    // City gate check: if station has "City - Place" format, verify best result is in the right city
    if (best && best.score >= MIN_ACCEPT_SCORE && city && !passesCityGate(best.candidate.display_name, city)) {
        const retryQueries = buildCityConstrainedQueries(city, place);
        let retryBest: { candidate: NominatimCandidate; score: number } | null = null;

        for (const q of retryQueries) {
            try {
                const results = await fetchCandidates(q);
                for (const result of results) {
                    const lat = parseFloat(result.lat);
                    const lon = parseFloat(result.lon);
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                    if (!isWithinCanada(lat, lon)) continue;
                    if (!passesCityGate(result.display_name, city)) continue;

                    const score = scoreCandidate(result, context, q);
                    if (!retryBest || score > retryBest.score) {
                        retryBest = { candidate: result, score };
                    }
                }
            } catch {
                // Try next retry query
            }
        }

        if (retryBest && retryBest.score >= MIN_ACCEPT_SCORE) {
            best = retryBest;
        } else {
            return null;
        }
    }

    if (best && best.score >= MIN_ACCEPT_SCORE) {
        const lat = parseFloat(best.candidate.lat);
        const lon = parseFloat(best.candidate.lon);
        return {
            lat,
            lon,
            displayName: best.candidate.display_name,
            source: 'auto',
            confidence: best.score >= HIGH_CONFIDENCE_SCORE ? 'high' : 'medium',
        };
    }

    return null;
}

function buildSearchQueries(name: string): string[] {
    const queries: string[] = [];
    const cleaned = sanitizeStationName(name);
    const expanded = expandAbbreviations(cleaned);
    const aliasQueries = STATION_QUERY_ALIASES[normalizeAliasKey(expanded)] || [];
    const { city, place } = splitCityPlace(expanded);

    queries.push(...aliasQueries);

    // Full name + Canada context
    queries.push(`${expanded}, Canada`);

    if (cleaned !== expanded) {
        queries.push(`${cleaned}, Canada`);
    }

    if (city && place) {
        queries.push(`${place}, ${city}, Canada`);
        queries.push(`${place} station, ${city}, Canada`);
        queries.push(`${place} terminal, ${city}, Canada`);
        queries.push(`${city} ${place}, Canada`);
    } else {
        queries.push(`${expanded} station, Canada`);
        queries.push(`${expanded} terminal, Canada`);
    }

    return dedupeQueries(queries);
}

function isWithinOntarioBounds(lat: number, lon: number): boolean {
    return lat >= ONTARIO_BOUNDS.minLat
        && lat <= ONTARIO_BOUNDS.maxLat
        && lon >= ONTARIO_BOUNDS.minLon
        && lon <= ONTARIO_BOUNDS.maxLon;
}

function validateGeocodeResults(cache: GeocodeCache, failed: string[]): string[] {
    const flagged: string[] = [];
    for (const [name, location] of Object.entries(cache.stations)) {
        const normalized = name.toLowerCase().trim();
        if (KNOWN_OUT_OF_PROVINCE[normalized]) continue;
        if (location.source === 'manual') continue;
        if (!isWithinOntarioBounds(location.lat, location.lon)) {
            delete cache.stations[name];
            flagged.push(name);
        }
    }
    // Add flagged stations to failed list (avoid duplicates)
    const failedSet = new Set(failed);
    for (const name of flagged) {
        if (!failedSet.has(name)) {
            failed.push(name);
        }
    }
    return flagged;
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
        const cachedLocation = cache.stations[station.name];
        if (cachedLocation && isWithinCanada(cachedLocation.lat, cachedLocation.lon)) {
            cached++;
            report('cached');
            continue;
        }
        if (cachedLocation && !isWithinCanada(cachedLocation.lat, cachedLocation.lon)) {
            delete cache.stations[station.name];
        }

        // Exact match failed — try case-insensitive fallback
        if (!cachedLocation) {
            const nameLower = station.name.toLowerCase();
            const match = Object.entries(cache.stations).find(
                ([key]) => key.toLowerCase() === nameLower
            );
            if (match) {
                cache.stations[station.name] = match[1];
                cached++;
                report('cached');
                continue;
            }
        }

        report('geocoding');
        const result = await geocodeStation(station.name);

        if (result && isWithinCanada(result.lat, result.lon)) {
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

    // Move out-of-Ontario results (except known exceptions) to manual review
    validateGeocodeResults(cache, failed);

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
