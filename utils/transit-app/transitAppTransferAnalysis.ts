import routesRaw from '../../gtfs/routes.txt?raw';
import stopsRaw from '../../gtfs/stops.txt?raw';
import type {
    GoLinkedTransferSummary,
    TransferConnectionTargetCandidate,
    TransferDayType,
    TransferNormalizationCoverage,
    TransferPairSummary,
    TransferPattern,
    TransferSeason,
    TransferTripAnchor,
    TransferTimeBand,
    TransferType,
    TransferVolumeRow,
    TransitAppTransferAnalysis,
    TransitAppTripLegRow,
} from './transitAppTypes';

const TRANSFER_ANALYSIS_SCHEMA_VERSION = 1;
const MAX_REASONABLE_TRANSFER_WAIT_MINUTES = 180;
const MAX_VOLUME_MATRIX_ROWS = 1000;
const MAX_TOP_TRANSFER_PAIRS = 15;
const MAX_GO_LINKED_ROWS = 30;
const MAX_CONNECTION_TARGETS = 30;
const MAX_LEGACY_TRANSFER_PATTERNS = 50;
const MAX_TRIP_ANCHORS = 3;

type NormalizedAgency = 'barrie' | 'go' | 'regional' | 'unknown';

interface NormalizedRouteRef {
    routeLabel: string;
    routeId: string | null;
    agency: NormalizedAgency;
}

interface NormalizedStopRef {
    stopName: string;
    stopId: string | null;
    stopCode: string | null;
}

interface TransferEvent {
    fromRoute: string;
    toRoute: string;
    fromRouteId: string | null;
    toRouteId: string | null;
    fromAgency: NormalizedAgency;
    toAgency: NormalizedAgency;
    fromStopName: string;
    toStopName: string;
    transferStopName: string;
    transferStopId: string | null;
    transferStopCode: string | null;
    timeBand: TransferTimeBand;
    dayType: TransferDayType;
    season: TransferSeason;
    transferType: TransferType;
    waitMinutes: number;
    fromArrivalMinute: number;
    toDepartureMinute: number;
}

interface TransferAnalysisResult {
    transferPatterns: TransferPattern[];
    transferAnalysis: TransitAppTransferAnalysis;
}

interface NormalizationCounters {
    routeReferencesMatched: number;
    routeReferencesTotal: number;
    stopReferencesMatched: number;
    stopReferencesTotal: number;
}

interface GtfsRouteRecord {
    routeId: string;
    routeShortName: string;
}

interface GtfsStopRecord {
    stopId: string;
    stopCode: string | null;
    stopName: string;
    lat: number;
    lon: number;
}

let cachedRoutesByShortName: Map<string, GtfsRouteRecord> | null = null;
let cachedStopsByCanonicalName: Map<string, GtfsStopRecord> | null = null;
let cachedStops: GtfsStopRecord[] | null = null;

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
    const map = new Map<string, number>();
    headers.forEach((h, i) => map.set(h, i));
    return map;
}

function parseUtcDate(value: string): Date | null {
    if (!value) return null;
    const dt = new Date(value.replace(' UTC', 'Z'));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function canonicalText(value: string): string {
    return normalizeWhitespace(value)
        .toUpperCase()
        .replace(/&/g, ' AND ')
        .replace(/[^A-Z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function canonicalRoute(route: string): string {
    return canonicalText(route)
        .replace(/^BARRIE TRANSIT\s+/, '')
        .replace(/^ROUTE\s+/, '')
        .replace(/\s+/g, '');
}

function toRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 10000;
}

function inferTimeBand(date: Date): TransferTimeBand {
    const hour = date.getUTCHours();
    if (hour >= 6 && hour < 9) return 'am_peak';
    if (hour >= 9 && hour < 15) return 'midday';
    if (hour >= 15 && hour < 18) return 'pm_peak';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'overnight';
}

function inferDayType(date: Date): TransferDayType {
    const day = date.getUTCDay();
    if (day === 0) return 'sunday';
    if (day === 6) return 'saturday';
    return 'weekday';
}

function inferSeason(date: Date): TransferSeason {
    const month = date.getUTCMonth() + 1;
    if (month === 1) return 'jan';
    if (month === 7) return 'jul';
    if (month === 9) return 'sep';
    return 'other';
}

function classifyTransferType(fromAgency: NormalizedAgency, toAgency: NormalizedAgency): TransferType {
    if (fromAgency === 'barrie' && toAgency === 'barrie') return 'barrie_to_barrie';
    if (fromAgency === 'barrie' && toAgency === 'go') return 'barrie_to_go';
    if (fromAgency === 'go' && toAgency === 'barrie') return 'go_to_barrie';
    if (fromAgency === 'barrie' && toAgency === 'regional') return 'barrie_to_regional';
    if (fromAgency === 'regional' && toAgency === 'barrie') return 'regional_to_barrie';
    if (fromAgency === 'regional' && toAgency === 'regional') return 'regional_to_regional';
    return 'other';
}

function getRoutesByShortName(): Map<string, GtfsRouteRecord> {
    if (cachedRoutesByShortName) return cachedRoutesByShortName;

    const map = new Map<string, GtfsRouteRecord>();
    const lines = routesRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) {
        cachedRoutesByShortName = map;
        return map;
    }

    const idx = buildHeaderIndex(lines[0]);
    const routeIdIdx = idx.get('route_id') ?? -1;
    const shortNameIdx = idx.get('route_short_name') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvRow(lines[i]);
        const routeId = routeIdIdx >= 0 ? (row[routeIdIdx] || '') : '';
        const routeShortName = shortNameIdx >= 0 ? (row[shortNameIdx] || '') : '';
        if (!routeId || !routeShortName) continue;
        map.set(canonicalRoute(routeShortName), { routeId, routeShortName: normalizeWhitespace(routeShortName) });
    }

    cachedRoutesByShortName = map;
    return map;
}

function getStopsByCanonicalName(): { byName: Map<string, GtfsStopRecord>; all: GtfsStopRecord[] } {
    if (cachedStopsByCanonicalName && cachedStops) {
        return { byName: cachedStopsByCanonicalName, all: cachedStops };
    }

    const byName = new Map<string, GtfsStopRecord>();
    const all: GtfsStopRecord[] = [];
    const lines = stopsRaw.trim().split(/\r?\n/);
    if (lines.length <= 1) {
        cachedStopsByCanonicalName = byName;
        cachedStops = all;
        return { byName, all };
    }

    const idx = buildHeaderIndex(lines[0]);
    const stopIdIdx = idx.get('stop_id') ?? -1;
    const stopCodeIdx = idx.get('stop_code') ?? -1;
    const stopNameIdx = idx.get('stop_name') ?? -1;
    const latIdx = idx.get('stop_lat') ?? -1;
    const lonIdx = idx.get('stop_lon') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvRow(lines[i]);
        const stopId = stopIdIdx >= 0 ? (row[stopIdIdx] || '') : '';
        const stopName = stopNameIdx >= 0 ? (row[stopNameIdx] || '') : '';
        if (!stopId || !stopName) continue;

        const record: GtfsStopRecord = {
            stopId,
            stopCode: stopCodeIdx >= 0 ? (row[stopCodeIdx] || null) : null,
            stopName: normalizeWhitespace(stopName),
            lat: latIdx >= 0 ? Number.parseFloat(row[latIdx] || '0') : 0,
            lon: lonIdx >= 0 ? Number.parseFloat(row[lonIdx] || '0') : 0,
        };

        all.push(record);
        const canonical = canonicalText(record.stopName);
        if (canonical && !byName.has(canonical)) {
            byName.set(canonical, record);
        }
    }

    cachedStopsByCanonicalName = byName;
    cachedStops = all;
    return { byName, all };
}

function inferAgency(serviceName: string, routeId: string | null): NormalizedAgency {
    const canonicalService = canonicalText(serviceName);
    if (routeId) return 'barrie';
    if (canonicalService.includes('GO')) return 'go';
    if (canonicalService.includes('BARRIE TRANSIT')) return 'barrie';
    if (canonicalService.includes('TRANSIT') || canonicalService.includes('TTC') || canonicalService.includes('YRT')) {
        return 'regional';
    }
    return 'unknown';
}

function normalizeRouteReference(routeShortName: string, serviceName: string): NormalizedRouteRef {
    const normalizedRoute = normalizeWhitespace(routeShortName);
    const routeKey = canonicalRoute(routeShortName);
    const routeRecord = routeKey ? getRoutesByShortName().get(routeKey) : undefined;
    const routeId = routeRecord?.routeId || null;
    const agency = inferAgency(serviceName, routeId);
    return {
        routeLabel: routeRecord?.routeShortName || normalizedRoute,
        routeId,
        agency,
    };
}

function findNearestStop(lat: number, lon: number): GtfsStopRecord | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
        return null;
    }

    const { all } = getStopsByCanonicalName();
    let best: GtfsStopRecord | null = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const stop of all) {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
        const dLat = stop.lat - lat;
        const dLon = stop.lon - lon;
        const distanceSquared = (dLat * dLat) + (dLon * dLon);
        if (distanceSquared < bestDistanceSquared) {
            bestDistanceSquared = distanceSquared;
            best = stop;
        }
    }

    // ~350m threshold at Barrie latitude.
    const maxDistanceSquared = 0.000016;
    if (!best || bestDistanceSquared > maxDistanceSquared) {
        return null;
    }
    return best;
}

function normalizeStopReference(
    stopNameRaw: string,
    lat: number,
    lon: number,
    cache: Map<string, NormalizedStopRef>
): NormalizedStopRef {
    const stopName = normalizeWhitespace(stopNameRaw);
    const cacheKey = `${canonicalText(stopName)}|${Math.round(lat * 10000)}|${Math.round(lon * 10000)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { byName } = getStopsByCanonicalName();
    const canonicalName = canonicalText(stopName);
    let matched: GtfsStopRecord | undefined;
    if (canonicalName) {
        matched = byName.get(canonicalName);
    }
    if (!matched) {
        matched = findNearestStop(lat, lon) || undefined;
    }

    const normalized: NormalizedStopRef = {
        stopName: matched?.stopName || stopName || '',
        stopId: matched?.stopId || null,
        stopCode: matched?.stopCode || null,
    };
    cache.set(cacheKey, normalized);
    return normalized;
}

function isTransitLeg(leg: TransitAppTripLegRow): boolean {
    return canonicalText(leg.mode) === 'TRANSIT';
}

function compareByStartTimeAsc(a: TransitAppTripLegRow, b: TransitAppTripLegRow): number {
    const aDate = parseUtcDate(a.start_time);
    const bDate = parseUtcDate(b.start_time);
    if (aDate && bDate) return aDate.getTime() - bDate.getTime();
    return a.start_time.localeCompare(b.start_time);
}

function isNearDuplicateLeg(a: TransitAppTripLegRow, b: TransitAppTripLegRow): boolean {
    if (!a || !b) return false;

    const routeA = canonicalRoute(a.route_short_name);
    const routeB = canonicalRoute(b.route_short_name);
    if (!routeA || !routeB || routeA !== routeB) return false;
    if (canonicalText(a.service_name) !== canonicalText(b.service_name)) return false;
    if (canonicalText(a.start_stop_name) !== canonicalText(b.start_stop_name)) return false;
    if (canonicalText(a.end_stop_name) !== canonicalText(b.end_stop_name)) return false;

    const startA = parseUtcDate(a.start_time);
    const startB = parseUtcDate(b.start_time);
    const endA = parseUtcDate(a.end_time);
    const endB = parseUtcDate(b.end_time);
    if (!startA || !startB || !endA || !endB) return false;

    const startDiff = Math.abs(startA.getTime() - startB.getTime());
    const endDiff = Math.abs(endA.getTime() - endB.getTime());
    return startDiff <= 120000 && endDiff <= 120000;
}

function dedupeConsecutiveLegs(legs: TransitAppTripLegRow[]): TransitAppTripLegRow[] {
    if (legs.length <= 1) return legs;
    const deduped: TransitAppTripLegRow[] = [];
    for (const leg of legs) {
        const last = deduped[deduped.length - 1];
        if (last && isNearDuplicateLeg(last, leg)) continue;
        deduped.push(leg);
    }
    return deduped;
}

function buildChainFingerprint(legs: TransitAppTripLegRow[]): string {
    const parts: string[] = [];
    for (const leg of legs) {
        const start = parseUtcDate(leg.start_time);
        const bucket = start ? Math.floor(start.getTime() / 300000) : 0;
        parts.push([
            canonicalRoute(leg.route_short_name),
            canonicalText(leg.start_stop_name),
            canonicalText(leg.end_stop_name),
            String(bucket),
        ].join(':'));
    }
    return parts.join('|');
}

function dominantTimeBands(counts: Map<TransferTimeBand, number>): TransferTimeBand[] {
    return Array.from(counts.entries())
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([band]) => band);
}

function minuteOfDay(date: Date): number {
    return (date.getUTCHours() * 60) + date.getUTCMinutes();
}

function formatMinuteOfDay(minute: number): string {
    const safeMinute = Number.isFinite(minute) ? minute : 0;
    const clamped = ((Math.floor(safeMinute) % 1440) + 1440) % 1440;
    const hours = Math.floor(clamped / 60);
    const minutes = clamped % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dominantTripAnchors(counts: Map<number, number>): TransferTripAnchor[] {
    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
    if (total <= 0) return [];

    return Array.from(counts.entries())
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TRIP_ANCHORS)
        .map(([minute, count]) => ({
            minuteOfDay: minute,
            timeLabel: formatMinuteOfDay(minute),
            count,
            sharePct: Math.round((count / total) * 100),
        }));
}

function buildNormalizationCoverage(counters: NormalizationCounters): TransferNormalizationCoverage {
    return {
        routeReferencesMatched: counters.routeReferencesMatched,
        routeReferencesTotal: counters.routeReferencesTotal,
        routeMatchRate: toRate(counters.routeReferencesMatched, counters.routeReferencesTotal),
        stopReferencesMatched: counters.stopReferencesMatched,
        stopReferencesTotal: counters.stopReferencesTotal,
        stopMatchRate: toRate(counters.stopReferencesMatched, counters.stopReferencesTotal),
    };
}

function isGoLinked(type: TransferType): boolean {
    return type === 'barrie_to_go' || type === 'go_to_barrie';
}

export function analyzeTransferConnections(
    goTripLegs: TransitAppTripLegRow[],
    tappedTripLegs: TransitAppTripLegRow[]
): TransferAnalysisResult {
    const inputLegs = [...goTripLegs, ...tappedTripLegs].filter(isTransitLeg);
    const legsByTrip = new Map<string, TransitAppTripLegRow[]>();
    for (const leg of inputLegs) {
        if (!leg.user_trip_id) continue;
        const existing = legsByTrip.get(leg.user_trip_id);
        if (existing) existing.push(leg);
        else legsByTrip.set(leg.user_trip_id, [leg]);
    }

    const dedupeChainFingerprints = new Set<string>();
    const transferEvents: TransferEvent[] = [];
    const stopCache = new Map<string, NormalizedStopRef>();
    const normalizationCounters: NormalizationCounters = {
        routeReferencesMatched: 0,
        routeReferencesTotal: 0,
        stopReferencesMatched: 0,
        stopReferencesTotal: 0,
    };

    let tripChainsProcessed = 0;
    let tripChainsDeduplicated = 0;

    for (const [, tripLegs] of legsByTrip) {
        if (tripLegs.length < 2) continue;
        tripChainsProcessed++;

        const sorted = [...tripLegs].sort(compareByStartTimeAsc);
        const dedupedLegs = dedupeConsecutiveLegs(sorted);
        if (dedupedLegs.length < 2) continue;

        const fingerprint = buildChainFingerprint(dedupedLegs);
        if (dedupeChainFingerprints.has(fingerprint)) {
            tripChainsDeduplicated++;
            continue;
        }
        dedupeChainFingerprints.add(fingerprint);

        for (let i = 0; i < dedupedLegs.length - 1; i++) {
            const current = dedupedLegs[i];
            const next = dedupedLegs[i + 1];

            if (!current.route_short_name || !next.route_short_name) continue;

            const fromRoute = normalizeRouteReference(current.route_short_name, current.service_name);
            const toRoute = normalizeRouteReference(next.route_short_name, next.service_name);
            if (!fromRoute.routeLabel || !toRoute.routeLabel) continue;
            if (fromRoute.routeLabel === toRoute.routeLabel && fromRoute.routeId === toRoute.routeId) continue;

            normalizationCounters.routeReferencesTotal += 2;
            if (fromRoute.routeId) normalizationCounters.routeReferencesMatched++;
            if (toRoute.routeId) normalizationCounters.routeReferencesMatched++;

            const currentEnd = parseUtcDate(current.end_time);
            const nextStart = parseUtcDate(next.start_time);
            if (!currentEnd || !nextStart) continue;

            const waitMinutes = (nextStart.getTime() - currentEnd.getTime()) / 60000;
            if (waitMinutes < 0 || waitMinutes > MAX_REASONABLE_TRANSFER_WAIT_MINUTES) continue;

            const transferStopRaw = current.end_stop_name || next.start_stop_name;
            const transferLat = current.end_latitude || next.start_latitude;
            const transferLon = current.end_longitude || next.start_longitude;
            const transferStop = normalizeStopReference(transferStopRaw, transferLat, transferLon, stopCache);
            normalizationCounters.stopReferencesTotal++;
            if (transferStop.stopId) normalizationCounters.stopReferencesMatched++;

            const transferType = classifyTransferType(fromRoute.agency, toRoute.agency);
            const event: TransferEvent = {
                fromRoute: fromRoute.routeLabel,
                toRoute: toRoute.routeLabel,
                fromRouteId: fromRoute.routeId,
                toRouteId: toRoute.routeId,
                fromAgency: fromRoute.agency,
                toAgency: toRoute.agency,
                fromStopName: normalizeWhitespace(current.end_stop_name || ''),
                toStopName: normalizeWhitespace(next.start_stop_name || ''),
                transferStopName: transferStop.stopName || normalizeWhitespace(transferStopRaw) || '',
                transferStopId: transferStop.stopId,
                transferStopCode: transferStop.stopCode,
                timeBand: inferTimeBand(nextStart),
                dayType: inferDayType(nextStart),
                season: inferSeason(nextStart),
                transferType,
                waitMinutes,
                fromArrivalMinute: minuteOfDay(currentEnd),
                toDepartureMinute: minuteOfDay(nextStart),
            };
            transferEvents.push(event);
        }
    }

    const volumeMap = new Map<string, { row: Omit<TransferVolumeRow, 'count' | 'avgWaitMinutes' | 'minWaitMinutes' | 'maxWaitMinutes'>; count: number; totalWait: number; minWait: number; maxWait: number }>();
    const topPairMap = new Map<string, {
        seed: Omit<TransferPairSummary, 'totalCount' | 'avgWaitMinutes' | 'dominantTimeBands'>;
        totalCount: number;
        totalWait: number;
        timeBands: Map<TransferTimeBand, number>;
        fromTripMinutes: Map<number, number>;
        toTripMinutes: Map<number, number>;
    }>();
    const goLinkedMap = new Map<string, {
        seed: Omit<GoLinkedTransferSummary, 'totalCount' | 'avgWaitMinutes'>;
        totalCount: number;
        totalWait: number;
    }>();
    const targetMap = new Map<string, {
        seed: Omit<TransferConnectionTargetCandidate, 'timeBands' | 'totalTransfers' | 'priorityTier'>;
        totalTransfers: number;
        timeBands: Map<TransferTimeBand, number>;
        fromTripMinutes: Map<number, number>;
        toTripMinutes: Map<number, number>;
    }>();
    const legacyPatternMap = new Map<string, {
        count: number;
        waits: number[];
        transferStopName: string;
        transferStopId: string | null;
        transferStopCode: string | null;
        barrieStopCount: number;
        nonBarrieStopCount: number;
        fromTripMinutes: Map<number, number>;
        toTripMinutes: Map<number, number>;
    }>();

    for (const event of transferEvents) {
        const volumeKey = [
            event.fromRoute,
            event.toRoute,
            event.transferStopName,
            event.timeBand,
            event.dayType,
            event.season,
            event.transferType,
        ].join('|');
        const existingVolume = volumeMap.get(volumeKey);
        if (existingVolume) {
            existingVolume.count++;
            existingVolume.totalWait += event.waitMinutes;
            existingVolume.minWait = Math.min(existingVolume.minWait, event.waitMinutes);
            existingVolume.maxWait = Math.max(existingVolume.maxWait, event.waitMinutes);
        } else {
            volumeMap.set(volumeKey, {
                row: {
                    fromRoute: event.fromRoute,
                    toRoute: event.toRoute,
                    fromRouteId: event.fromRouteId,
                    toRouteId: event.toRouteId,
                    transferStopName: event.transferStopName,
                    transferStopId: event.transferStopId,
                    transferStopCode: event.transferStopCode,
                    timeBand: event.timeBand,
                    dayType: event.dayType,
                    season: event.season,
                    transferType: event.transferType,
                },
                count: 1,
                totalWait: event.waitMinutes,
                minWait: event.waitMinutes,
                maxWait: event.waitMinutes,
            });
        }

        const topPairKey = [
            event.fromRoute,
            event.toRoute,
            event.transferStopName,
            event.transferType,
        ].join('|');
        const existingPair = topPairMap.get(topPairKey);
        if (existingPair) {
            existingPair.totalCount++;
            existingPair.totalWait += event.waitMinutes;
            existingPair.timeBands.set(event.timeBand, (existingPair.timeBands.get(event.timeBand) || 0) + 1);
            existingPair.fromTripMinutes.set(event.fromArrivalMinute, (existingPair.fromTripMinutes.get(event.fromArrivalMinute) || 0) + 1);
            existingPair.toTripMinutes.set(event.toDepartureMinute, (existingPair.toTripMinutes.get(event.toDepartureMinute) || 0) + 1);
        } else {
            const timeBands = new Map<TransferTimeBand, number>();
            timeBands.set(event.timeBand, 1);
            const fromTripMinutes = new Map<number, number>();
            fromTripMinutes.set(event.fromArrivalMinute, 1);
            const toTripMinutes = new Map<number, number>();
            toTripMinutes.set(event.toDepartureMinute, 1);
            topPairMap.set(topPairKey, {
                seed: {
                    fromRoute: event.fromRoute,
                    toRoute: event.toRoute,
                    fromRouteId: event.fromRouteId,
                    toRouteId: event.toRouteId,
                    transferStopName: event.transferStopName,
                    transferStopId: event.transferStopId,
                    transferStopCode: event.transferStopCode,
                    transferType: event.transferType,
                },
                totalCount: 1,
                totalWait: event.waitMinutes,
                timeBands,
                fromTripMinutes,
                toTripMinutes,
            });
        }

        if (isGoLinked(event.transferType)) {
            const goKey = [
                event.fromRoute,
                event.toRoute,
                event.transferStopName,
                event.timeBand,
                event.transferType,
            ].join('|');
            const existingGo = goLinkedMap.get(goKey);
            if (existingGo) {
                existingGo.totalCount++;
                existingGo.totalWait += event.waitMinutes;
            } else {
                goLinkedMap.set(goKey, {
                    seed: {
                        fromRoute: event.fromRoute,
                        toRoute: event.toRoute,
                        fromRouteId: event.fromRouteId,
                        toRouteId: event.toRouteId,
                        transferStopName: event.transferStopName,
                        transferStopId: event.transferStopId,
                        transferStopCode: event.transferStopCode,
                        timeBand: event.timeBand,
                        transferType: event.transferType,
                    },
                    totalCount: 1,
                    totalWait: event.waitMinutes,
                });
            }
        }

        const targetKey = [
            event.fromRoute,
            event.toRoute,
            event.transferStopName,
            event.transferStopId || '',
        ].join('|');
        const existingTarget = targetMap.get(targetKey);
        if (existingTarget) {
            existingTarget.totalTransfers++;
            existingTarget.timeBands.set(event.timeBand, (existingTarget.timeBands.get(event.timeBand) || 0) + 1);
            existingTarget.fromTripMinutes.set(event.fromArrivalMinute, (existingTarget.fromTripMinutes.get(event.fromArrivalMinute) || 0) + 1);
            existingTarget.toTripMinutes.set(event.toDepartureMinute, (existingTarget.toTripMinutes.get(event.toDepartureMinute) || 0) + 1);
            if (isGoLinked(event.transferType)) {
                existingTarget.seed.goLinked = true;
            }
        } else {
            const timeBands = new Map<TransferTimeBand, number>();
            timeBands.set(event.timeBand, 1);
            const fromTripMinutes = new Map<number, number>();
            fromTripMinutes.set(event.fromArrivalMinute, 1);
            const toTripMinutes = new Map<number, number>();
            toTripMinutes.set(event.toDepartureMinute, 1);
            targetMap.set(targetKey, {
                seed: {
                    fromRoute: event.fromRoute,
                    toRoute: event.toRoute,
                    fromRouteId: event.fromRouteId,
                    toRouteId: event.toRouteId,
                    locationStopName: event.transferStopName,
                    locationStopId: event.transferStopId,
                    locationStopCode: event.transferStopCode,
                    goLinked: isGoLinked(event.transferType),
                },
                totalTransfers: 1,
                timeBands,
                fromTripMinutes,
                toTripMinutes,
            });
        }

        const legacyKey = `${event.fromRoute}->${event.toRoute}|${event.fromStopName}->${event.toStopName}`;
        const existingLegacy = legacyPatternMap.get(legacyKey);
        const isBarrieTransferStop = Boolean(event.transferStopId);
        if (existingLegacy) {
            existingLegacy.count++;
            existingLegacy.waits.push(event.waitMinutes);
            existingLegacy.fromTripMinutes.set(event.fromArrivalMinute, (existingLegacy.fromTripMinutes.get(event.fromArrivalMinute) || 0) + 1);
            existingLegacy.toTripMinutes.set(event.toDepartureMinute, (existingLegacy.toTripMinutes.get(event.toDepartureMinute) || 0) + 1);
            if (!existingLegacy.transferStopId && event.transferStopId) {
                existingLegacy.transferStopName = event.transferStopName;
                existingLegacy.transferStopId = event.transferStopId;
                existingLegacy.transferStopCode = event.transferStopCode;
            }
            if (isBarrieTransferStop) existingLegacy.barrieStopCount++;
            else existingLegacy.nonBarrieStopCount++;
        } else {
            legacyPatternMap.set(legacyKey, {
                count: 1,
                waits: [event.waitMinutes],
                transferStopName: event.transferStopName,
                transferStopId: event.transferStopId,
                transferStopCode: event.transferStopCode,
                barrieStopCount: isBarrieTransferStop ? 1 : 0,
                nonBarrieStopCount: isBarrieTransferStop ? 0 : 1,
                fromTripMinutes: new Map([[event.fromArrivalMinute, 1]]),
                toTripMinutes: new Map([[event.toDepartureMinute, 1]]),
            });
        }
    }

    const volumeMatrix: TransferVolumeRow[] = Array.from(volumeMap.values())
        .map(entry => ({
            ...entry.row,
            count: entry.count,
            avgWaitMinutes: Math.round(entry.totalWait / entry.count),
            minWaitMinutes: Math.round(entry.minWait),
            maxWaitMinutes: Math.round(entry.maxWait),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_VOLUME_MATRIX_ROWS);

    const topTransferPairs: TransferPairSummary[] = Array.from(topPairMap.values())
        .map(entry => ({
            ...entry.seed,
            totalCount: entry.totalCount,
            avgWaitMinutes: Math.round(entry.totalWait / entry.totalCount),
            dominantTimeBands: dominantTimeBands(entry.timeBands),
            fromTripAnchors: dominantTripAnchors(entry.fromTripMinutes),
            toTripAnchors: dominantTripAnchors(entry.toTripMinutes),
        }))
        .sort((a, b) => b.totalCount - a.totalCount)
        .slice(0, MAX_TOP_TRANSFER_PAIRS);

    const goLinkedSummary: GoLinkedTransferSummary[] = Array.from(goLinkedMap.values())
        .map(entry => ({
            ...entry.seed,
            totalCount: entry.totalCount,
            avgWaitMinutes: Math.round(entry.totalWait / entry.totalCount),
        }))
        .sort((a, b) => b.totalCount - a.totalCount)
        .slice(0, MAX_GO_LINKED_ROWS);

    const connectionTargetCandidates = Array.from(targetMap.values())
        .map(entry => ({
            ...entry.seed,
            totalTransfers: entry.totalTransfers,
            timeBands: dominantTimeBands(entry.timeBands),
            fromTripAnchors: dominantTripAnchors(entry.fromTripMinutes),
            toTripAnchors: dominantTripAnchors(entry.toTripMinutes),
        }))
        .sort((a, b) => b.totalTransfers - a.totalTransfers)
        .slice(0, MAX_CONNECTION_TARGETS)
        .map((entry, idx): TransferConnectionTargetCandidate => {
            let priorityTier: TransferConnectionTargetCandidate['priorityTier'] = 'low';
            if (entry.goLinked) {
                priorityTier = 'high';
            } else if (idx < 5) {
                priorityTier = 'high';
            } else if (idx < 15) {
                priorityTier = 'medium';
            }
            return {
                ...entry,
                priorityTier,
            };
        });

    const transferPatterns: TransferPattern[] = Array.from(legacyPatternMap.entries())
        .map(([key, entry]) => {
            const [routePart, stopPart] = key.split('|');
            const [fromRoute, toRoute] = routePart.split('->');
            const [fromStop, toStop] = stopPart.split('->');
            const sortedWaits = [...entry.waits].sort((a, b) => a - b);
            return {
                fromRoute: fromRoute || '',
                toRoute: toRoute || '',
                fromStop: fromStop || '',
                toStop: toStop || '',
                transferStopName: entry.transferStopName,
                transferStopId: entry.transferStopId,
                transferStopCode: entry.transferStopCode,
                barrieTransferStop: entry.barrieStopCount > entry.nonBarrieStopCount,
                fromTripAnchors: dominantTripAnchors(entry.fromTripMinutes),
                toTripAnchors: dominantTripAnchors(entry.toTripMinutes),
                count: entry.count,
                avgWaitMinutes: Math.round(entry.waits.reduce((sum, wait) => sum + wait, 0) / entry.waits.length),
                minWaitMinutes: Math.round(sortedWaits[0] || 0),
                maxWaitMinutes: Math.round(sortedWaits[sortedWaits.length - 1] || 0),
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_LEGACY_TRANSFER_PATTERNS);

    const routePairs = new Set(transferEvents.map(e => `${e.fromRoute}|${e.toRoute}`));
    const transferStops = new Set(transferEvents.map(e => e.transferStopName).filter(Boolean));
    const goLinkedTransferEvents = transferEvents.filter(e => isGoLinked(e.transferType)).length;

    return {
        transferPatterns,
        transferAnalysis: {
            schemaVersion: TRANSFER_ANALYSIS_SCHEMA_VERSION,
            totals: {
                tripChainsProcessed,
                tripChainsDeduplicated,
                transferEvents: transferEvents.length,
                goLinkedTransferEvents,
                uniqueRoutePairs: routePairs.size,
                uniqueTransferStops: transferStops.size,
            },
            normalization: buildNormalizationCoverage(normalizationCounters),
            volumeMatrix,
            topTransferPairs,
            goLinkedSummary,
            connectionTargets: connectionTargetCandidates,
        },
    };
}
