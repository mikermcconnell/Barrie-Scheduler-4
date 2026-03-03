/**
 * OD Route Estimation
 *
 * Matches OD pairs to GTFS routes spatially — "which route could have
 * carried passengers from A to B?" — picking the most direct route
 * (fewest intermediate stops). Supports multi-leg transfer detection
 * when no single route connects origin and destination.
 */

import { unzipSync } from 'fflate';
import type { ODMatrixDataSummary } from './odMatrixTypes';

function parseCsvRow(line: string): string[] {
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
            values.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }

    values.push(current.trim());
    return values;
}

function buildHeaderIndex(headerLine: string): Map<string, number> {
    const headers = parseCsvRow(headerLine).map(h => h.replace(/^\uFEFF/, '').trim());
    const index = new Map<string, number>();
    headers.forEach((h, i) => index.set(h, i));
    return index;
}

// ============ TYPES ============

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';
export type StationMatchType = 'exact' | 'contains' | 'alias' | 'coordinate' | 'unmatched';

export interface StationMatch {
    odName: string;
    gtfsStopName: string | null;
    matchType: StationMatchType;
    reason?: string;
    nearMatches?: string[];
}

export interface ODPairRouteMatch {
    origin: string;
    destination: string;
    journeys: number;
    routeId: string | null;
    routeShortName: string | null;
    routeLongName: string | null;
    intermediateStops: number;
    confidence: MatchConfidence;
    candidateCount: number;
    /** Top plausible candidate paths considered during matching */
    plausiblePaths?: string[];
    /** Transfer info — populated when match requires 2+ legs */
    transfer?: {
        viaStop: string;
        leg1RouteId: string;
        leg1RouteName: string;
        leg1Stops: number;
        leg2RouteId: string;
        leg2RouteName: string;
        leg2Stops: number;
        /** Ordered leg chain for 2+ leg matches */
        legs?: {
            routeId: string;
            routeName: string;
            boardStop: string;
            alightStop: string;
            intermediateStops: number;
        }[];
        /** All transfer points in order */
        transferStops?: string[];
    };
}

export interface RouteDistributionEntry {
    routeShortName: string;
    routeLongName: string;
    journeys: number;
    pairCount: number;
}

export interface ODRouteEstimationResult {
    matches: ODPairRouteMatch[];
    routeDistribution: RouteDistributionEntry[];
    unmatchedPairs: ODPairRouteMatch[];
    stationMatchReport: StationMatch[];
    totalMatched: number;
    totalUnmatched: number;
    /** Unmatched because origin or destination didn't resolve to a GTFS stop */
    unmatchedStationPairs: number;
    /** Unmatched because no GTFS route path connects the two resolved stops */
    unmatchedRoutePairs: number;
    matchedJourneys: number;
    totalJourneys: number;
}

// Internal types for GTFS parsing
interface GtfsRoute {
    routeId: string;
    shortName: string;
    longName: string;
}

interface GtfsStopMeta {
    name: string;
    lat: number | null;
    lon: number | null;
}

interface RouteStopSequence {
    routeId: string;
    shortName: string;
    longName: string;
    directionId: string;
    stopNames: string[];
}

// ============ KNOWN TRANSFER HUBS (priority ranking) ============

const TRANSFER_HUBS = new Set([
    'north bay',
    'sudbury',
    'cochrane',
    'sault ste marie',
    'thunder bay',
]);

// ============ KNOWN ALIASES ============

const STATION_ALIASES: Record<string, string[]> = {
    'toronto': ['UNION STATION BUS TERMINAL', 'TORONTO COACH TERMINAL', 'UNION STATION'],
    'union station': ['UNION STATION BUS TERMINAL', 'TORONTO COACH TERMINAL'],
    'barrie': ['BARRIE BUS TERMINAL'],
    'north bay': ['NORTH BAY BUS TERMINAL', 'NORTH BAY STATION'],
    'sudbury': ['SUDBURY BUS TERMINAL', 'SUDBURY STATION'],
    'timmins': ['TIMMINS BUS TERMINAL', 'TIMMINS STATION'],
    'cochrane': ['COCHRANE BUS TERMINAL', 'COCHRANE STATION'],
    'hearst': ['HEARST BUS TERMINAL', 'HEARST STATION'],
    'sault ste. marie': ['SAULT STE. MARIE BUS TERMINAL'],
    'sault ste marie': ['SAULT STE. MARIE BUS TERMINAL'],
    'gravenhurst': ['GRAVENHURST BUS TERMINAL', 'GRAVENHURST'],
    'huntsville': ['HUNTSVILLE BUS TERMINAL', 'HUNTSVILLE'],
    'parry sound': ['PARRY SOUND BUS TERMINAL', 'PARRY SOUND'],
};

// ============ GTFS ZIP PARSING ============

function extractTextFile(files: Record<string, Uint8Array>, name: string): string {
    const key = Object.keys(files).find(k => k.toLowerCase().endsWith(name.toLowerCase()));
    if (!key) throw new Error(`GTFS zip missing ${name}`);
    return new TextDecoder('utf-8').decode(files[key]);
}

function parseLines(text: string): string[] {
    return text.split(/\r?\n/).filter(line => line.trim().length > 0);
}

function parseRoutes(text: string): GtfsRoute[] {
    const lines = parseLines(text);
    if (lines.length < 2) return [];
    const idx = buildHeaderIndex(lines[0]);
    const routeIdCol = idx.get('route_id');
    const shortNameCol = idx.get('route_short_name');
    const longNameCol = idx.get('route_long_name');
    if (routeIdCol === undefined) return [];

    return lines.slice(1).map(line => {
        const cols = parseCsvRow(line);
        return {
            routeId: cols[routeIdCol] || '',
            shortName: shortNameCol !== undefined ? cols[shortNameCol] || '' : '',
            longName: longNameCol !== undefined ? cols[longNameCol] || '' : '',
        };
    }).filter(r => r.routeId);
}

function parseTrips(text: string): Map<string, { tripId: string; routeId: string; directionId: string }[]> {
    const lines = parseLines(text);
    if (lines.length < 2) return new Map();
    const idx = buildHeaderIndex(lines[0]);
    const tripIdCol = idx.get('trip_id');
    const routeIdCol = idx.get('route_id');
    const directionIdCol = idx.get('direction_id');
    if (tripIdCol === undefined || routeIdCol === undefined) return new Map();

    const byRouteDir = new Map<string, { tripId: string; routeId: string; directionId: string }[]>();

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i]);
        const tripId = cols[tripIdCol] || '';
        const routeId = cols[routeIdCol] || '';
        const directionId = directionIdCol !== undefined ? cols[directionIdCol] || '0' : '0';
        if (!tripId || !routeId) continue;

        const key = `${routeId}__${directionId}`;
        const arr = byRouteDir.get(key) || [];
        arr.push({ tripId, routeId, directionId });
        byRouteDir.set(key, arr);
    }

    return byRouteDir;
}

function parseStopTimes(text: string): Map<string, { stopId: string; sequence: number }[]> {
    const lines = parseLines(text);
    if (lines.length < 2) return new Map();
    const idx = buildHeaderIndex(lines[0]);
    const tripIdCol = idx.get('trip_id');
    const stopIdCol = idx.get('stop_id');
    const seqCol = idx.get('stop_sequence');
    if (tripIdCol === undefined || stopIdCol === undefined || seqCol === undefined) return new Map();

    const byTrip = new Map<string, { stopId: string; sequence: number }[]>();

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i]);
        const tripId = cols[tripIdCol] || '';
        const stopId = cols[stopIdCol] || '';
        const seq = Number.parseInt(cols[seqCol] || '0', 10);
        if (!tripId || !stopId) continue;

        const arr = byTrip.get(tripId) || [];
        arr.push({ stopId, sequence: seq });
        byTrip.set(tripId, arr);
    }

    return byTrip;
}

function parseStops(text: string): Map<string, GtfsStopMeta> {
    const lines = parseLines(text);
    if (lines.length < 2) return new Map();
    const idx = buildHeaderIndex(lines[0]);
    const stopIdCol = idx.get('stop_id');
    const stopNameCol = idx.get('stop_name');
    const stopLatCol = idx.get('stop_lat');
    const stopLonCol = idx.get('stop_lon');
    if (stopIdCol === undefined || stopNameCol === undefined) return new Map();

    const stopMap = new Map<string, GtfsStopMeta>();
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i]);
        const stopId = cols[stopIdCol] || '';
        const stopName = cols[stopNameCol] || '';
        if (!stopId || !stopName) continue;
        const latRaw = stopLatCol !== undefined ? cols[stopLatCol] : '';
        const lonRaw = stopLonCol !== undefined ? cols[stopLonCol] : '';
        const lat = latRaw ? Number.parseFloat(latRaw) : Number.NaN;
        const lon = lonRaw ? Number.parseFloat(lonRaw) : Number.NaN;
        stopMap.set(stopId, {
            name: stopName,
            lat: Number.isFinite(lat) ? lat : null,
            lon: Number.isFinite(lon) ? lon : null,
        });
    }

    return stopMap;
}

// ============ ROUTE→STOPS MAPPING ============

function buildRouteStopSequences(
    routes: GtfsRoute[],
    tripsByRouteDir: Map<string, { tripId: string; routeId: string; directionId: string }[]>,
    stopTimesByTrip: Map<string, { stopId: string; sequence: number }[]>,
    stopMetaMap: Map<string, GtfsStopMeta>,
): RouteStopSequence[] {
    const routeMap = new Map(routes.map(r => [r.routeId, r]));
    const sequences: RouteStopSequence[] = [];

    for (const [key, trips] of tripsByRouteDir) {
        const [routeId, directionId] = key.split('__');
        const route = routeMap.get(routeId);
        if (!route) continue;

        // Sort trips by stop count descending — longest first
        const sortedTrips = [...trips].sort((a, b) => {
            const aCount = stopTimesByTrip.get(a.tripId)?.length || 0;
            const bCount = stopTimesByTrip.get(b.tripId)?.length || 0;
            return bCount - aCount;
        });

        // Merge all trips into one unified stop sequence.
        // Start with the longest trip, then chain shorter trips
        // that extend beyond the current sequence.
        const mergedNames: string[] = [];
        const mergedSet = new Set<string>();

        for (const trip of sortedTrips) {
            const stops = stopTimesByTrip.get(trip.tripId) || [];
            if (stops.length === 0) continue;

            const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
            const names = sorted
                .map((s) => stopMetaMap.get(s.stopId)?.name || s.stopId)
                .filter(Boolean);

            if (mergedNames.length === 0) {
                // First (longest) trip — use as base
                for (const n of names) {
                    if (!mergedSet.has(n)) {
                        mergedNames.push(n);
                        mergedSet.add(n);
                    }
                }
                continue;
            }

            // Find the last overlap point between merged sequence and this trip
            let lastOverlapMergedIdx = -1;
            let lastOverlapTripIdx = -1;
            for (let ti = 0; ti < names.length; ti++) {
                const mi = mergedNames.indexOf(names[ti]);
                if (mi >= 0 && mi >= lastOverlapMergedIdx) {
                    lastOverlapMergedIdx = mi;
                    lastOverlapTripIdx = ti;
                }
            }

            if (lastOverlapTripIdx >= 0) {
                // Append stops from this trip that come AFTER the overlap point
                const insertAfterIdx = lastOverlapMergedIdx;
                const newStops = names.slice(lastOverlapTripIdx + 1)
                    .filter(n => !mergedSet.has(n));

                // Insert after the overlap position
                mergedNames.splice(insertAfterIdx + 1, 0, ...newStops);
                newStops.forEach(n => mergedSet.add(n));
            } else {
                // No overlap — check if this trip's first stop follows
                // the merged sequence's last stop geographically.
                // Append as extension.
                const newStops = names.filter(n => !mergedSet.has(n));
                for (const n of newStops) {
                    mergedNames.push(n);
                    mergedSet.add(n);
                }
            }
        }

        if (mergedNames.length >= 2) {
            sequences.push({
                routeId,
                shortName: route.shortName,
                longName: route.longName,
                directionId,
                stopNames: mergedNames,
            });
        }
    }

    return sequences;
}

// ============ STATION NAME MATCHING ============

const DIRECTIONAL_SUFFIX_RE = /\b(northbound|southbound|eastbound|westbound|nb|sb|eb|wb)\b/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const STATION_TOKEN_STOPWORDS = new Set([
    'station',
    'terminal',
    'bus',
    'stop',
    'the',
    'and',
    'de',
    'la',
    'le',
]);

function normalizeStationName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[.'’`]/g, '')
        .replace(/\s*-\s*/g, ' ')
        .replace(DIRECTIONAL_SUFFIX_RE, ' ')
        .replace(/\bhwy\b/g, 'highway')
        .replace(/\brd\b/g, 'road')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeStationName(normalizedName: string): string[] {
    return normalizedName
        .replace(NON_ALNUM_RE, ' ')
        .trim()
        .split(/\s+/)
        .filter(t => t.length > 1 && !STATION_TOKEN_STOPWORDS.has(t));
}

interface NormalizedStopName {
    original: string;
    normalized: string;
    tokenSet: Set<string>;
}

interface StationMatchResult {
    gtfsName: string | null;
    matchType: StationMatchType;
    reason: string;
    nearMatches?: string[];
}

function buildNormalizedStops(gtfsStopNames: string[]): NormalizedStopName[] {
    return gtfsStopNames.map((name) => {
        const normalized = normalizeStationName(name);
        return {
            original: name,
            normalized,
            tokenSet: new Set(tokenizeStationName(normalized)),
        };
    });
}

function pickBestTokenMatch(
    odTokens: string[],
    stops: NormalizedStopName[],
): NormalizedStopName | null {
    if (odTokens.length === 0) return null;

    let best: { stop: NormalizedStopName; score: number; slack: number } | null = null;

    for (const stop of stops) {
        const overlap = odTokens.reduce((count, token) => (
            stop.tokenSet.has(token) ? count + 1 : count
        ), 0);
        if (overlap === 0) continue;

        const missing = odTokens.length - overlap;
        if (missing > 1) continue;

        const score = overlap;
        const slack = Math.max(0, stop.tokenSet.size - overlap);
        if (!best || score > best.score || (score === best.score && slack < best.slack)) {
            best = { stop, score, slack };
        }
    }

    // For short names (<= 2 tokens), require full token coverage to avoid false positives.
    if (best && odTokens.length <= 2 && best.score < odTokens.length) {
        return null;
    }

    return best?.stop || null;
}

function buildAliasMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const [key, aliases] of Object.entries(STATION_ALIASES)) {
        map.set(normalizeStationName(key), aliases);
    }
    return map;
}

interface Coord {
    lat: number;
    lon: number;
}

interface GtfsCoordCandidate {
    name: string;
    normalized: string;
    lat: number;
    lon: number;
}

function haversineKm(a: Coord, b: Coord): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const r = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
}

function buildGtfsCoordCandidates(stopMetaMap: Map<string, GtfsStopMeta>): GtfsCoordCandidate[] {
    const out: GtfsCoordCandidate[] = [];
    const dedupe = new Set<string>();

    for (const meta of stopMetaMap.values()) {
        if (!meta.name || meta.lat === null || meta.lon === null) continue;
        const norm = normalizeStationName(meta.name);
        const key = `${norm}|${meta.lat.toFixed(6)}|${meta.lon.toFixed(6)}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        out.push({
            name: meta.name,
            normalized: norm,
            lat: meta.lat,
            lon: meta.lon,
        });
    }

    return out;
}

function findNearestGtfsStops(
    odCoord: Coord,
    candidates: GtfsCoordCandidate[],
): Array<{ candidate: GtfsCoordCandidate; distanceKm: number }> {
    return candidates
        .map(candidate => ({ candidate, distanceKm: haversineKm(odCoord, { lat: candidate.lat, lon: candidate.lon }) }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
}

function rankTokenCandidates(
    odTokens: string[],
    stops: NormalizedStopName[],
): Array<{ stop: NormalizedStopName; overlap: number; missing: number; extra: number }> {
    if (odTokens.length === 0) return [];
    const ranked: Array<{ stop: NormalizedStopName; overlap: number; missing: number; extra: number }> = [];

    for (const stop of stops) {
        const overlap = odTokens.reduce((count, token) => (
            stop.tokenSet.has(token) ? count + 1 : count
        ), 0);
        if (overlap === 0) continue;
        const missing = odTokens.length - overlap;
        const extra = Math.max(0, stop.tokenSet.size - overlap);
        ranked.push({ stop, overlap, missing, extra });
    }

    return ranked.sort((a, b) => {
        if (a.overlap !== b.overlap) return b.overlap - a.overlap;
        if (a.missing !== b.missing) return a.missing - b.missing;
        return a.extra - b.extra;
    });
}

function matchStation(
    odName: string,
    gtfsStops: NormalizedStopName[],
    aliasMap: Map<string, string[]>,
    odCoord: Coord | null,
    gtfsCoordCandidates: GtfsCoordCandidate[],
): StationMatchResult {
    const norm = normalizeStationName(odName);
    const odTokens = tokenizeStationName(norm);
    const aliasCandidates = aliasMap.get(norm) || [];

    // Tier 1: Exact match
    const exact = gtfsStops.find(g => g.normalized === norm);
    if (exact) {
        return {
            gtfsName: exact.original,
            matchType: 'exact',
            reason: 'Exact normalized station-name match.',
        };
    }

    // Tier 2: Contains match on normalized names.
    // Protect against very short names matching too broadly.
    const contains = norm.length >= 4
        ? gtfsStops.find(g => g.normalized.includes(norm) || norm.includes(g.normalized))
        : undefined;
    if (contains) {
        return {
            gtfsName: contains.original,
            matchType: 'contains',
            reason: 'Matched by normalized partial-name overlap.',
        };
    }

    // Tier 3: Token overlap match
    const tokenMatch = pickBestTokenMatch(odTokens, gtfsStops);
    if (tokenMatch) {
        return {
            gtfsName: tokenMatch.original,
            matchType: 'contains',
            reason: 'Matched by token overlap with GTFS stop name.',
        };
    }

    // Tier 4: Alias map
    if (aliasCandidates.length > 0) {
        for (const alias of aliasCandidates) {
            const aliasNorm = normalizeStationName(alias);
            const aliasMatch = gtfsStops.find(g => g.normalized === aliasNorm);
            if (aliasMatch) {
                return {
                    gtfsName: aliasMatch.original,
                    matchType: 'alias',
                    reason: `Matched via alias mapping (${alias}).`,
                };
            }
            const aliasContains = gtfsStops.find(
                g => g.normalized.includes(aliasNorm) || aliasNorm.includes(g.normalized)
            );
            if (aliasContains) {
                return {
                    gtfsName: aliasContains.original,
                    matchType: 'alias',
                    reason: `Matched via partial alias mapping (${alias}).`,
                };
            }
        }
    }

    const rankedCandidates = rankTokenCandidates(odTokens, gtfsStops);
    const nearMatches = uniqueStrings(
        rankedCandidates.slice(0, 3).map(c => c.stop.original),
    );

    if (!norm) {
        return {
            gtfsName: null,
            matchType: 'unmatched',
            reason: 'Station name is blank after normalization; name-based matching cannot run.',
            nearMatches,
        };
    }

    if (odTokens.length === 0) {
        return {
            gtfsName: null,
            matchType: 'unmatched',
            reason: 'Station name contains only generic words after cleanup; no distinctive tokens to match.',
            nearMatches,
        };
    }

    if (aliasCandidates.length > 0) {
        return {
            gtfsName: null,
            matchType: 'unmatched',
            reason: `Alias mapping exists (${aliasCandidates.join(', ')}) but none were found in current GTFS stop names.`,
            nearMatches,
        };
    }

    if (rankedCandidates.length > 0) {
        const best = rankedCandidates[0];
        const fallbackReason = `No safe match: closest GTFS names share only ${best.overlap}/${odTokens.length} key token(s).`;

        if (!odCoord) {
            return {
                gtfsName: null,
                matchType: 'unmatched',
                reason: `${fallbackReason} No OD coordinates available for coordinate fallback.`,
                nearMatches,
            };
        }

        const nearestByCoord = findNearestGtfsStops(odCoord, gtfsCoordCandidates);
        const nearest = nearestByCoord[0];
        const nearestNames = uniqueStrings(nearestByCoord.slice(0, 3).map(n => n.candidate.name));

        // Conservative threshold for coordinate fallback when names are weak.
        if (nearest && nearest.distanceKm <= 6) {
            return {
                gtfsName: nearest.candidate.name,
                matchType: 'coordinate',
                reason: `Name match was weak; matched by nearest coordinates (${nearest.distanceKm.toFixed(1)} km).`,
                nearMatches: nearestNames,
            };
        }

        return {
            gtfsName: null,
            matchType: 'unmatched',
            reason: nearest
                ? `${fallbackReason} Nearest GTFS stop is ${nearest.distanceKm.toFixed(1)} km away, above coordinate-match threshold.`
                : `${fallbackReason} No GTFS stops with valid coordinates were available for fallback.`,
            nearMatches: nearestNames.length > 0 ? nearestNames : nearMatches,
        };
    }

    if (!odCoord) {
        return {
            gtfsName: null,
            matchType: 'unmatched',
            reason: 'No comparable GTFS stop name found. No OD coordinates available for fallback.',
        };
    }

    const nearestByCoord = findNearestGtfsStops(odCoord, gtfsCoordCandidates);
    const nearest = nearestByCoord[0];
    const nearestNames = uniqueStrings(nearestByCoord.slice(0, 3).map(n => n.candidate.name));
    if (nearest && nearest.distanceKm <= 6) {
        return {
            gtfsName: nearest.candidate.name,
            matchType: 'coordinate',
            reason: `No name match found; matched by nearest coordinates (${nearest.distanceKm.toFixed(1)} km).`,
            nearMatches: nearestNames,
        };
    }

    return {
        gtfsName: null,
        matchType: 'unmatched',
        reason: nearest
            ? `No comparable GTFS stop name found, and nearest coordinate candidate is ${nearest.distanceKm.toFixed(1)} km away (too far).`
            : 'No comparable GTFS stop name found after exact, partial, token, alias, and coordinate checks.',
        nearMatches: nearestNames,
    };
}

// ============ SINGLE-ROUTE MATCHING ============

interface RouteCandidate {
    sequence: RouteStopSequence;
    originIdx: number;
    destIdx: number;
    intermediateStops: number;
}

interface IndexedRouteStopSequence {
    sequence: RouteStopSequence;
    normalizedStops: string[];
}

interface LegSegment {
    sequence: RouteStopSequence;
    originIdx: number;
    destIdx: number;
    fromStopNorm: string;
    fromStopName: string;
    toStopNorm: string;
    toStopName: string;
    intermediateStops: number;
}

interface MultiLegCandidate {
    legs: LegSegment[];
    totalStops: number;
    transferStops: string[];
    hubTransferCount: number;
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const key = value.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

function buildSequenceIndex(sequences: RouteStopSequence[]): IndexedRouteStopSequence[] {
    return sequences.map((sequence) => ({
        sequence,
        normalizedStops: sequence.stopNames.map(normalizeStationName),
    }));
}

function findRouteCandidates(
    originGtfs: string,
    destGtfs: string,
    indexedSequences: IndexedRouteStopSequence[],
): RouteCandidate[] {
    const originNorm = normalizeStationName(originGtfs);
    const destNorm = normalizeStationName(destGtfs);
    const candidates: RouteCandidate[] = [];

    for (const indexed of indexedSequences) {
        const originIdx = indexed.normalizedStops.indexOf(originNorm);
        const destIdx = indexed.normalizedStops.indexOf(destNorm);

        if (originIdx >= 0 && destIdx >= 0 && destIdx > originIdx) {
            candidates.push({
                sequence: indexed.sequence,
                originIdx,
                destIdx,
                intermediateStops: destIdx - originIdx - 1,
            });
        }
    }

    return candidates;
}

function determineSingleRouteConfidence(candidates: RouteCandidate[]): MatchConfidence {
    if (candidates.length === 0) return 'none';
    if (candidates.length === 1) return 'high';

    const sorted = [...candidates].sort((a, b) => a.intermediateStops - b.intermediateStops);
    if (sorted.length >= 2 && sorted[0].intermediateStops < sorted[1].intermediateStops) {
        return 'medium';
    }

    return 'low';
}

// ============ TRANSFER (MULTI-LEG) MATCHING ============

function buildOutgoingSegments(indexedSequences: IndexedRouteStopSequence[]): Map<string, LegSegment[]> {
    const outgoing = new Map<string, LegSegment[]>();

    for (const indexed of indexedSequences) {
        const { sequence, normalizedStops } = indexed;
        for (let i = 0; i < normalizedStops.length - 1; i++) {
            const fromStopNorm = normalizedStops[i];
            const fromStopName = sequence.stopNames[i];
            for (let j = i + 1; j < normalizedStops.length; j++) {
                const toStopNorm = normalizedStops[j];
                if (!toStopNorm || toStopNorm === fromStopNorm) continue;

                const list = outgoing.get(fromStopNorm) || [];
                list.push({
                    sequence,
                    originIdx: i,
                    destIdx: j,
                    fromStopNorm,
                    fromStopName,
                    toStopNorm,
                    toStopName: sequence.stopNames[j],
                    intermediateStops: j - i - 1,
                });
                outgoing.set(fromStopNorm, list);
            }
        }
    }

    return outgoing;
}

function findMultiLegCandidates(
    originGtfs: string,
    destGtfs: string,
    outgoingSegments: Map<string, LegSegment[]>,
    maxLegs = 4,
): MultiLegCandidate[] {
    const originNorm = normalizeStationName(originGtfs);
    const destNorm = normalizeStationName(destGtfs);
    if (!originNorm || !destNorm || originNorm === destNorm) return [];

    type SearchState = {
        currentStopNorm: string;
        legs: LegSegment[];
        totalStops: number;
        visitedStops: string[];
    };

    const queue: SearchState[] = [{
        currentStopNorm: originNorm,
        legs: [],
        totalStops: 0,
        visitedStops: [originNorm],
    }];

    const candidates: MultiLegCandidate[] = [];
    let bestLegCount: number | null = null;
    const bestByState = new Map<string, number>();

    while (queue.length > 0) {
        const state = queue.shift()!;
        if (state.legs.length >= maxLegs) continue;

        const options = outgoingSegments.get(state.currentStopNorm) || [];
        for (const option of options) {
            // Avoid loopback chains across routes.
            if (state.visitedStops.includes(option.toStopNorm)) continue;

            const nextLegs = [...state.legs, option];
            const nextStops = state.totalStops + option.intermediateStops;

            if (bestLegCount !== null && nextLegs.length > bestLegCount) {
                continue;
            }

            if (option.toStopNorm === destNorm) {
                const transferStops = nextLegs.slice(0, -1).map(l => l.toStopName);
                const hubTransferCount = transferStops.reduce((count, stop) => (
                    TRANSFER_HUBS.has(normalizeStationName(stop)) ? count + 1 : count
                ), 0);
                candidates.push({
                    legs: nextLegs,
                    totalStops: nextStops,
                    transferStops,
                    hubTransferCount,
                });
                bestLegCount = bestLegCount === null ? nextLegs.length : Math.min(bestLegCount, nextLegs.length);
                continue;
            }

            if (nextLegs.length >= maxLegs) continue;

            const stateKey = `${option.toStopNorm}|${nextLegs.length}`;
            const bestStopsForState = bestByState.get(stateKey);
            if (bestStopsForState !== undefined && nextStops >= bestStopsForState) {
                continue;
            }
            bestByState.set(stateKey, nextStops);

            queue.push({
                currentStopNorm: option.toStopNorm,
                legs: nextLegs,
                totalStops: nextStops,
                visitedStops: [...state.visitedStops, option.toStopNorm],
            });
        }
    }

    return candidates;
}

function pickBestTransferPath(candidates: MultiLegCandidate[]): { best: MultiLegCandidate; confidence: MatchConfidence } | null {
    if (candidates.length === 0) return null;

    const sorted = sortTransferCandidates(candidates);

    const best = sorted[0];
    const second = sorted[1];

    if (!second) {
        return { best, confidence: best.legs.length <= 2 ? 'high' : 'medium' };
    }

    if (best.legs.length < second.legs.length) {
        return { best, confidence: best.legs.length <= 2 ? 'high' : 'medium' };
    }
    if (best.totalStops < second.totalStops) {
        return { best, confidence: best.legs.length <= 2 ? 'medium' : 'low' };
    }

    return { best, confidence: 'low' };
}

function sortTransferCandidates(candidates: MultiLegCandidate[]): MultiLegCandidate[] {
    return [...candidates].sort((a, b) => {
        if (a.legs.length !== b.legs.length) return a.legs.length - b.legs.length;
        if (a.hubTransferCount !== b.hubTransferCount) return b.hubTransferCount - a.hubTransferCount;
        return a.totalStops - b.totalStops;
    });
}

function transferPathLabel(candidate: MultiLegCandidate): string {
    const routeChain = candidate.legs.map(leg => routeLabel(leg.sequence)).join(' → ');
    if (candidate.transferStops.length === 0) return routeChain;
    return `${routeChain} (via ${candidate.transferStops.join(' → ')})`;
}

// ============ ROUTE LABEL HELPERS ============

function routeLabel(seq: RouteStopSequence): string {
    return seq.longName || seq.shortName || seq.routeId;
}

// ============ MAIN EXPORT ============

export function estimateRoutes(
    gtfsZipBuffer: ArrayBuffer,
    data: ODMatrixDataSummary,
): ODRouteEstimationResult {
    // 1. Extract GTFS files from zip
    const zipData = new Uint8Array(gtfsZipBuffer);
    const files = unzipSync(zipData);

    // 2. Parse GTFS tables
    const routes = parseRoutes(extractTextFile(files, 'routes.txt'));
    const tripsByRouteDir = parseTrips(extractTextFile(files, 'trips.txt'));
    const stopTimesByTrip = parseStopTimes(extractTextFile(files, 'stop_times.txt'));
    const stopMetaMap = parseStops(extractTextFile(files, 'stops.txt'));

    // 3. Build route→stop sequences
    const sequences = buildRouteStopSequences(routes, tripsByRouteDir, stopTimesByTrip, stopMetaMap);
    const indexedSequences = buildSequenceIndex(sequences);
    const outgoingSegments = buildOutgoingSegments(indexedSequences);
    const gtfsCoordCandidates = buildGtfsCoordCandidates(stopMetaMap);

    // 4. Collect all unique GTFS stop names
    const allGtfsStopNames = [...new Set(
        sequences.flatMap(s => s.stopNames)
    )];
    const normalizedStops = buildNormalizedStops(allGtfsStopNames);
    const aliasMap = buildAliasMap();
    const odCoordsByNormName = new Map<string, Coord>();
    for (const station of data.stations) {
        const geo = station.geocode;
        if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) continue;
        odCoordsByNormName.set(normalizeStationName(station.name), { lat: geo.lat, lon: geo.lon });
    }

    // 5. Match OD station names to GTFS stops
    const uniqueODStations = [...new Set(
        data.pairs.flatMap(p => [p.origin, p.destination])
    )];

    const stationMatches = new Map<string, StationMatchResult>();
    const stationMatchReport: StationMatch[] = [];

    for (const odStation of uniqueODStations) {
        const odCoord = odCoordsByNormName.get(normalizeStationName(odStation)) || null;
        const match = matchStation(odStation, normalizedStops, aliasMap, odCoord, gtfsCoordCandidates);
        stationMatches.set(odStation, match);
        stationMatchReport.push({
            odName: odStation,
            gtfsStopName: match.gtfsName,
            matchType: match.matchType,
            reason: match.reason,
            nearMatches: match.nearMatches,
        });
    }

    // 6. Estimate routes for each OD pair
    const matches: ODPairRouteMatch[] = [];
    const unmatchedPairs: ODPairRouteMatch[] = [];
    let matchedJourneys = 0;
    let unmatchedStationPairs = 0;
    let unmatchedRoutePairs = 0;

    for (const pair of data.pairs) {
        const originMatch = stationMatches.get(pair.origin);
        const destMatch = stationMatches.get(pair.destination);

        // Station name unresolved — can't match
        if (!originMatch?.gtfsName || !destMatch?.gtfsName) {
            const noMatch: ODPairRouteMatch = {
                origin: pair.origin,
                destination: pair.destination,
                journeys: pair.journeys,
                routeId: null,
                routeShortName: null,
                routeLongName: null,
                intermediateStops: 0,
                confidence: 'none',
                candidateCount: 0,
            };
            matches.push(noMatch);
            unmatchedPairs.push(noMatch);
            unmatchedStationPairs++;
            continue;
        }

        // Try single-route match first
        const candidates = findRouteCandidates(originMatch.gtfsName, destMatch.gtfsName, indexedSequences);

        if (candidates.length > 0) {
            const sortedCandidates = [...candidates].sort((a, b) => a.intermediateStops - b.intermediateStops);
            const best = sortedCandidates[0];
            const confidence = determineSingleRouteConfidence(candidates);
            const plausiblePaths = uniqueStrings(
                sortedCandidates
                    .map(c => routeLabel(c.sequence))
                    .slice(0, 5),
            );
            matchedJourneys += pair.journeys;
            matches.push({
                origin: pair.origin,
                destination: pair.destination,
                journeys: pair.journeys,
                routeId: best.sequence.routeId,
                routeShortName: best.sequence.shortName,
                routeLongName: best.sequence.longName,
                intermediateStops: best.intermediateStops,
                confidence,
                candidateCount: candidates.length,
                plausiblePaths: plausiblePaths.length > 1 ? plausiblePaths.slice(0, 3) : undefined,
            });
            continue;
        }

        // No single route — try multi-leg transfer matching
        const transferCandidates = findMultiLegCandidates(originMatch.gtfsName, destMatch.gtfsName, outgoingSegments, 4);
        const transferResult = pickBestTransferPath(transferCandidates);

        if (transferResult) {
            const { best, confidence } = transferResult;
            const sortedTransferCandidates = sortTransferCandidates(transferCandidates);
            const plausiblePaths = uniqueStrings(
                sortedTransferCandidates.map(transferPathLabel).slice(0, 5),
            );
            const routeNames = best.legs.map(leg => routeLabel(leg.sequence));
            const routeIds = best.legs.map(leg => leg.sequence.routeId);
            const firstLeg = best.legs[0];
            const secondLeg = best.legs[1] || best.legs[0];
            matchedJourneys += pair.journeys;
            matches.push({
                origin: pair.origin,
                destination: pair.destination,
                journeys: pair.journeys,
                routeId: routeIds.join('+'),
                routeShortName: firstLeg.sequence.shortName,
                routeLongName: routeNames.join(' → '),
                intermediateStops: best.totalStops,
                confidence,
                candidateCount: transferCandidates.length,
                plausiblePaths: plausiblePaths.length > 1 ? plausiblePaths.slice(0, 3) : undefined,
                transfer: {
                    viaStop: best.transferStops[0] || secondLeg.toStopName,
                    leg1RouteId: firstLeg.sequence.routeId,
                    leg1RouteName: routeLabel(firstLeg.sequence),
                    leg1Stops: firstLeg.intermediateStops,
                    leg2RouteId: secondLeg.sequence.routeId,
                    leg2RouteName: routeLabel(secondLeg.sequence),
                    leg2Stops: secondLeg.intermediateStops,
                    transferStops: best.transferStops,
                    legs: best.legs.map((leg) => ({
                        routeId: leg.sequence.routeId,
                        routeName: routeLabel(leg.sequence),
                        boardStop: leg.fromStopName,
                        alightStop: leg.toStopName,
                        intermediateStops: leg.intermediateStops,
                    })),
                },
            });
            continue;
        }

        // Nothing found
        const noMatch: ODPairRouteMatch = {
            origin: pair.origin,
            destination: pair.destination,
            journeys: pair.journeys,
            routeId: null,
            routeShortName: null,
            routeLongName: null,
            intermediateStops: 0,
            confidence: 'none',
            candidateCount: 0,
        };
        matches.push(noMatch);
        unmatchedPairs.push(noMatch);
        unmatchedRoutePairs++;
    }

    // 7. Build route distribution (count each leg of transfers separately)
    const routeJourneys = new Map<string, { shortName: string; longName: string; journeys: number; pairCount: number }>();

    function addToDistribution(shortName: string, longName: string, journeys: number) {
        const existing = routeJourneys.get(longName) || {
            shortName,
            longName,
            journeys: 0,
            pairCount: 0,
        };
        existing.journeys += journeys;
        existing.pairCount += 1;
        routeJourneys.set(longName, existing);
    }

    for (const m of matches) {
        if (m.transfer) {
            const legEntries = m.transfer.legs && m.transfer.legs.length > 0
                ? m.transfer.legs.map(leg => leg.routeName)
                : [m.transfer.leg1RouteName, m.transfer.leg2RouteName];
            for (const legName of legEntries) {
                addToDistribution(m.routeShortName || '', legName, m.journeys);
            }
        } else if (m.routeLongName) {
            addToDistribution(m.routeShortName || '', m.routeLongName, m.journeys);
        }
    }

    const routeDistribution = [...routeJourneys.values()]
        .map(r => ({
            routeShortName: r.shortName,
            routeLongName: r.longName,
            journeys: r.journeys,
            pairCount: r.pairCount,
        }))
        .sort((a, b) => b.journeys - a.journeys);

    return {
        matches,
        routeDistribution,
        unmatchedPairs,
        stationMatchReport: stationMatchReport.sort((a, b) => {
            if (a.matchType === 'unmatched' && b.matchType !== 'unmatched') return -1;
            if (a.matchType !== 'unmatched' && b.matchType === 'unmatched') return 1;
            return a.odName.localeCompare(b.odName);
        }),
        totalMatched: matches.length - unmatchedPairs.length,
        totalUnmatched: unmatchedPairs.length,
        unmatchedStationPairs,
        unmatchedRoutePairs,
        matchedJourneys,
        totalJourneys: data.totalJourneys,
    };
}
