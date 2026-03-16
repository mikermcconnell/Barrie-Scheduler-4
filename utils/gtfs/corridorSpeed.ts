import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import shapesRaw from '../../gtfs/shapes.txt?raw';
import { DAY_TYPES, TIME_PERIODS, matchSegmentStopsInTrip, type DayType, type TimePeriod } from './corridorHeadway';
import { buildCorridorSegments, type CorridorSegment as GtfsCorridorSegment } from './corridorBuilder';
import type { DailySummary, DailyTripStopSegmentRuntimeEntry } from '../performanceDataTypes';
import { getRouteConfig } from '../config/routeDirectionConfig';
import {
    buildHeaderIndex,
    getRouteIdToShortName,
    getServiceFlagsById,
    parseCsvRow,
    parseGtfsTimeToMinutes,
} from '../transit-app/transitAppGtfsNormalization';
import { haversineDistance } from '../routing/geometryUtils';
import { getAllStopsWithCoords } from './gtfsStopLookup';

export type CorridorSpeedMetric = 'delay-minutes' | 'delay-percent' | 'observed-speed' | 'scheduled-speed';

export interface CorridorSpeedRouteBreakdown {
    route: string;
    sampleCount: number;
    scheduledRuntimeMin: number | null;
    observedRuntimeMin: number | null;
    runtimeDeltaMin: number | null;
    runtimeDeltaPct: number | null;
    scheduledSpeedKmh: number | null;
    observedSpeedKmh: number | null;
}

export interface CorridorSpeedSegment {
    id: string;
    fromStopId: string;
    toStopId: string;
    fromStopName: string;
    toStopName: string;
    directionId: string;
    routes: string[];
    geometry: [number, number][];
    lengthMeters: number;
    stopIds?: string[];
    sourceSegmentIds?: string[];
}

export interface CorridorSpeedStats {
    segmentId: string;
    directionId: string;
    period: TimePeriod;
    dayType: DayType;
    sampleCount: number;
    lowConfidence: boolean;
    corridorLengthMeters: number;
    scheduledRuntimeMin: number | null;
    observedRuntimeMin: number | null;
    runtimeDeltaMin: number | null;
    runtimeDeltaPct: number | null;
    scheduledSpeedKmh: number | null;
    observedSpeedKmh: number | null;
    routeBreakdown: CorridorSpeedRouteBreakdown[];
}

export interface ScheduledStopSegmentSample {
    segmentId: string;
    route: string;
    dayType: DayType;
    directionId: string;
    departureMinutes: number;
    runtimeMinutes: number;
}

export interface CorridorTraversalSample {
    segmentId: string;
    route: string;
    dayType: DayType;
    directionId: string;
    departureMinutes: number;
    runtimeMinutes: number;
}

export interface CorridorSpeedIndex {
    segments: CorridorSpeedSegment[];
    availableDirections: string[];
    statsBySegmentId: Map<string, Map<DayType, Map<TimePeriod, CorridorSpeedStats>>>;
}

interface GtfsTripMeta {
    route: string;
    serviceId: string;
    headsign: string;
    directionId: string;
    shapeId: string;
}

interface GtfsTripStopTime {
    stopId: string;
    stopSequence: number;
    arrivalMinutes: number | null;
    departureMinutes: number | null;
    shapeDistTraveled: number | null;
}

interface ShapePoint {
    lat: number;
    lon: number;
    distTraveled: number | null;
    sequence: number;
}

interface StaticSpeedModel {
    segments: CorridorSpeedSegment[];
    scheduledSamples: ScheduledStopSegmentSample[];
}

interface StaticCorridorTraversalModel {
    segments: CorridorSpeedSegment[];
    scheduledSamples: CorridorTraversalSample[];
}

interface RouteAccumulator {
    scheduledRuntimes: number[];
    observedRuntimes: number[];
}

interface StatAccumulator {
    scheduledRuntimes: number[];
    observedRuntimes: number[];
    routes: Map<string, RouteAccumulator>;
}

const ALL_DAY_TYPES = DAY_TYPES.map(day => day.id);
export const MIN_SAMPLE_COUNT = 8;
const MAX_SPEED_MAP_STOP_PAIRS = 5;
const MAX_SPEED_MAP_SEGMENT_LENGTH_METERS = 1200;

let cachedStaticModel: StaticSpeedModel | null = null;
let cachedStaticCorridorTraversalModel: StaticCorridorTraversalModel | null = null;

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function normalizeRouteId(routeId: string): string {
    return routeId.trim().toUpperCase();
}

export function normalizeStopName(value: string): string {
    return value
        .toUpperCase()
        .replace(/&/g, ' AND ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

export function getMatchingPeriods(minutes: number): TimePeriod[] {
    return TIME_PERIODS.filter(period => minutes >= period.startMinute && minutes < period.endMinute).map(period => period.id);
}

function toKmh(distanceMeters: number, runtimeMinutes: number | null): number | null {
    if (runtimeMinutes === null || runtimeMinutes <= 0) return null;
    return Math.round((((distanceMeters / 1000) / (runtimeMinutes / 60)) * 10)) / 10;
}

export function calculateCorridorLengthMeters(geometry: readonly [number, number][]): number {
    if (geometry.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < geometry.length; i++) {
        total += haversineDistance(
            geometry[i - 1][0],
            geometry[i - 1][1],
            geometry[i][0],
            geometry[i][1],
        );
    }
    return Math.round(total);
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

function mergeSegmentGeometries(segments: readonly CorridorSpeedSegment[]): [number, number][] {
    const merged: [number, number][] = [];

    for (const segment of segments) {
        for (const coordinate of segment.geometry) {
            if (merged.length > 0 && coordinatesEqual(merged[merged.length - 1], coordinate)) continue;
            merged.push(coordinate);
        }
    }

    return merged;
}

function chunkMatchedSegments(matchedSegments: readonly CorridorSpeedSegment[]): CorridorSpeedSegment[][] {
    const chunks: CorridorSpeedSegment[][] = [];
    let currentChunk: CorridorSpeedSegment[] = [];
    let currentLengthMeters = 0;

    for (const segment of matchedSegments) {
        const wouldExceedStopPairLimit = currentChunk.length >= MAX_SPEED_MAP_STOP_PAIRS;
        const wouldExceedLengthLimit = currentChunk.length > 0
            && (currentLengthMeters + segment.lengthMeters) > MAX_SPEED_MAP_SEGMENT_LENGTH_METERS;

        if (wouldExceedStopPairLimit || wouldExceedLengthLimit) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentLengthMeters = 0;
        }

        currentChunk.push(segment);
        currentLengthMeters += segment.lengthMeters;
    }

    if (currentChunk.length > 0) chunks.push(currentChunk);
    return chunks;
}

function resolveVariantDirection(routeShortName: string): string | null {
    const route = normalizeRouteId(routeShortName);
    const config = getRouteConfig(route);
    if (!config || config.segments.length !== 2) return null;

    const matchingSegments = config.segments.filter(segment => normalizeRouteId(segment.variant) === route);
    if (matchingSegments.length === 1) return matchingSegments[0].name;
    return null;
}

function resolveDirectionFromHeadsign(routeShortName: string, headsign: string): string | null {
    const config = getRouteConfig(routeShortName);
    if (!config) return null;
    if (config.segments.length === 1) return config.segments[0].name;

    const normalizedHeadsign = normalizeStopName(headsign);
    for (const segment of config.segments) {
        if (segment.terminus && normalizedHeadsign.includes(normalizeStopName(segment.terminus))) {
            return segment.name;
        }
    }

    return null;
}

export function resolveGtfsDirectionLabel(routeShortName: string, headsign: string, directionId: string): string {
    const variantDirection = resolveVariantDirection(routeShortName);
    if (variantDirection) return variantDirection;

    const fromHeadsign = resolveDirectionFromHeadsign(routeShortName, headsign);
    if (fromHeadsign) return fromHeadsign;

    const config = getRouteConfig(routeShortName);
    if (config?.segments.length === 1) return config.segments[0].name;

    const numericDirection = Number.parseInt(directionId, 10);
    if (config?.segments.length === 2 && Number.isFinite(numericDirection)) {
        return config.segments[numericDirection] ? config.segments[numericDirection].name : config.segments[0].name;
    }

    return 'Unknown';
}

export function resolveObservedDirectionLabel(routeId: string, direction: string): string {
    const normalizedDirection = direction.trim().toUpperCase();
    if (normalizedDirection === 'N' || normalizedDirection === 'NB' || normalizedDirection === 'NORTH') return 'North';
    if (normalizedDirection === 'S' || normalizedDirection === 'SB' || normalizedDirection === 'SOUTH') return 'South';
    if (normalizedDirection === 'CW' || normalizedDirection === 'CLOCKWISE') return 'Clockwise';
    if (normalizedDirection === 'CCW' || normalizedDirection === 'COUNTER CLOCKWISE' || normalizedDirection === 'COUNTER-CLOCKWISE') {
        return 'Counter-clockwise';
    }

    const variantDirection = resolveVariantDirection(routeId);
    if (variantDirection) return variantDirection;

    const config = getRouteConfig(routeId);
    if (config?.segments.length === 1) return config.segments[0].name;

    return 'Unknown';
}

function parseTripMetadata(): Map<string, GtfsTripMeta> {
    const routeMap = getRouteIdToShortName();
    const lines = tripsRaw.trim().split(/\r?\n/);
    const meta = new Map<string, GtfsTripMeta>();
    if (lines.length <= 1) return meta;

    const idx = buildHeaderIndex(lines[0]);
    const routeIdIdx = idx.get('route_id') ?? -1;
    const serviceIdIdx = idx.get('service_id') ?? -1;
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const headsignIdx = idx.get('trip_headsign') ?? -1;
    const directionIdx = idx.get('direction_id') ?? -1;
    const shapeIdIdx = idx.get('shape_id') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        const routeId = routeIdIdx >= 0 ? (values[routeIdIdx] || '') : '';
        const serviceId = serviceIdIdx >= 0 ? (values[serviceIdIdx] || '') : '';
        if (!tripId || !routeId || !serviceId) continue;

        meta.set(tripId, {
            route: routeMap.get(routeId) ?? routeId,
            serviceId,
            headsign: headsignIdx >= 0 ? (values[headsignIdx] || '') : '',
            directionId: directionIdx >= 0 ? (values[directionIdx] || '') : '',
            shapeId: shapeIdIdx >= 0 ? (values[shapeIdIdx] || '') : '',
        });
    }

    return meta;
}

function parseTripStopTimes(): Map<string, GtfsTripStopTime[]> {
    const lines = stopTimesRaw.trim().split(/\r?\n/);
    const byTrip = new Map<string, GtfsTripStopTime[]>();
    if (lines.length <= 1) return byTrip;

    const idx = buildHeaderIndex(lines[0]);
    const tripIdIdx = idx.get('trip_id') ?? -1;
    const stopIdIdx = idx.get('stop_id') ?? -1;
    const stopSequenceIdx = idx.get('stop_sequence') ?? -1;
    const arrivalIdx = idx.get('arrival_time') ?? -1;
    const departureIdx = idx.get('departure_time') ?? -1;
    const shapeDistIdx = idx.get('shape_dist_traveled') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const tripId = tripIdIdx >= 0 ? (values[tripIdIdx] || '') : '';
        const stopId = stopIdIdx >= 0 ? (values[stopIdIdx] || '') : '';
        if (!tripId || !stopId) continue;

        const stopSequence = Number.parseInt(stopSequenceIdx >= 0 ? (values[stopSequenceIdx] || '0') : '0', 10);
        const shapeDistRaw = shapeDistIdx >= 0 ? (values[shapeDistIdx] || '') : '';
        const shapeDistTraveled = shapeDistRaw ? Number.parseFloat(shapeDistRaw) : Number.NaN;

        const row: GtfsTripStopTime = {
            stopId,
            stopSequence: Number.isFinite(stopSequence) ? stopSequence : 0,
            arrivalMinutes: parseGtfsTimeToMinutes(arrivalIdx >= 0 ? values[arrivalIdx] : undefined),
            departureMinutes: parseGtfsTimeToMinutes(departureIdx >= 0 ? values[departureIdx] : undefined),
            shapeDistTraveled: Number.isFinite(shapeDistTraveled) ? shapeDistTraveled : null,
        };

        const existing = byTrip.get(tripId);
        if (existing) existing.push(row);
        else byTrip.set(tripId, [row]);
    }

    for (const tripRows of byTrip.values()) {
        tripRows.sort((a, b) => a.stopSequence - b.stopSequence);
    }

    return byTrip;
}

function parseShapes(): Map<string, ShapePoint[]> {
    const lines = shapesRaw.trim().split(/\r?\n/);
    const byShape = new Map<string, ShapePoint[]>();
    if (lines.length <= 1) return byShape;

    const idx = buildHeaderIndex(lines[0]);
    const shapeIdIdx = idx.get('shape_id') ?? -1;
    const latIdx = idx.get('shape_pt_lat') ?? -1;
    const lonIdx = idx.get('shape_pt_lon') ?? -1;
    const seqIdx = idx.get('shape_pt_sequence') ?? -1;
    const distIdx = idx.get('shape_dist_traveled') ?? -1;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCsvRow(line);
        const shapeId = shapeIdIdx >= 0 ? (values[shapeIdIdx] || '') : '';
        if (!shapeId) continue;

        const lat = Number.parseFloat(latIdx >= 0 ? (values[latIdx] || '') : '');
        const lon = Number.parseFloat(lonIdx >= 0 ? (values[lonIdx] || '') : '');
        const sequence = Number.parseInt(seqIdx >= 0 ? (values[seqIdx] || '0') : '0', 10);
        const distRaw = distIdx >= 0 ? (values[distIdx] || '') : '';
        const distTraveled = distRaw ? Number.parseFloat(distRaw) : Number.NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const row: ShapePoint = {
            lat,
            lon,
            sequence: Number.isFinite(sequence) ? sequence : 0,
            distTraveled: Number.isFinite(distTraveled) ? distTraveled : null,
        };

        const existing = byShape.get(shapeId);
        if (existing) existing.push(row);
        else byShape.set(shapeId, [row]);
    }

    for (const points of byShape.values()) {
        points.sort((a, b) => {
            if (a.distTraveled !== null && b.distTraveled !== null) return a.distTraveled - b.distTraveled;
            return a.sequence - b.sequence;
        });
    }

    return byShape;
}

function getServiceDayTypes(serviceId: string, flagsById: Map<string, { weekday: boolean; saturday: boolean; sunday: boolean }>): DayType[] {
    const flags = flagsById.get(serviceId);
    if (!flags) return [];

    const dayTypes: DayType[] = [];
    if (flags.weekday) dayTypes.push('weekday');
    if (flags.saturday) dayTypes.push('saturday');
    if (flags.sunday) dayTypes.push('sunday');
    return dayTypes;
}

function buildSegmentId(directionId: string, fromStopId: string, toStopId: string): string {
    return `${directionId}|${fromStopId}|${toStopId}`;
}

function dedupeGeometryPoints(points: [number, number][]): [number, number][] {
    const deduped: [number, number][] = [];
    for (const point of points) {
        const previous = deduped[deduped.length - 1];
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
            deduped.push(point);
        }
    }
    return deduped;
}

function extractTripSegmentGeometry(
    shapeId: string,
    fromStop: GtfsTripStopTime,
    toStop: GtfsTripStopTime,
    stopCoords: Map<string, { lat: number; lon: number; name: string }>,
    shapePointsById: Map<string, ShapePoint[]>,
): [number, number][] {
    const fromCoords = stopCoords.get(fromStop.stopId);
    const toCoords = stopCoords.get(toStop.stopId);
    const fallback: [number, number][] = [];
    if (fromCoords) fallback.push([fromCoords.lat, fromCoords.lon]);
    if (toCoords && (!fromCoords || fromCoords.lat !== toCoords.lat || fromCoords.lon !== toCoords.lon)) {
        fallback.push([toCoords.lat, toCoords.lon]);
    }

    const shapePoints = shapePointsById.get(shapeId);
    if (
        !shapePoints
        || shapePoints.length === 0
        || fromStop.shapeDistTraveled === null
        || toStop.shapeDistTraveled === null
        || toStop.shapeDistTraveled <= fromStop.shapeDistTraveled
    ) {
        return fallback;
    }

    const startDist = fromStop.shapeDistTraveled;
    const endDist = toStop.shapeDistTraveled;
    const middlePoints = shapePoints
        .filter(point => point.distTraveled !== null && point.distTraveled > startDist && point.distTraveled < endDist)
        .map(point => [point.lat, point.lon] as [number, number]);

    return dedupeGeometryPoints([
        ...(fromCoords ? [[fromCoords.lat, fromCoords.lon] as [number, number]] : []),
        ...middlePoints,
        ...(toCoords ? [[toCoords.lat, toCoords.lon] as [number, number]] : []),
    ]);
}

function buildStaticSpeedModel(): StaticSpeedModel {
    const tripMeta = parseTripMetadata();
    const tripStopTimes = parseTripStopTimes();
    const serviceFlags = getServiceFlagsById();
    const stopCoords = new Map<string, { lat: number; lon: number; name: string }>();
    for (const stop of getAllStopsWithCoords()) {
        stopCoords.set(stop.stop_id, { lat: stop.lat, lon: stop.lon, name: stop.stop_name });
    }
    const shapePointsById = parseShapes();

    const segmentsById = new Map<string, CorridorSpeedSegment>();
    const routeSetsBySegmentId = new Map<string, Set<string>>();
    const scheduledSamples: ScheduledStopSegmentSample[] = [];

    for (const [tripId, meta] of tripMeta.entries()) {
        const stopTimes = tripStopTimes.get(tripId);
        if (!stopTimes || stopTimes.length < 2) continue;

        const route = normalizeRouteId(meta.route);
        const directionId = resolveGtfsDirectionLabel(meta.route, meta.headsign, meta.directionId);
        const dayTypes = getServiceDayTypes(meta.serviceId, serviceFlags);
        if (dayTypes.length === 0) continue;

        for (let i = 0; i < stopTimes.length - 1; i++) {
            const fromStop = stopTimes[i];
            const toStop = stopTimes[i + 1];
            const departureMinutes = fromStop.departureMinutes ?? fromStop.arrivalMinutes;
            let arrivalMinutes = toStop.arrivalMinutes ?? toStop.departureMinutes;
            if (departureMinutes === null || arrivalMinutes === null) continue;
            if (arrivalMinutes < departureMinutes) arrivalMinutes += 24 * 60;

            const runtimeMinutes = arrivalMinutes - departureMinutes;
            if (!Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0 || runtimeMinutes > 60) continue;

            const fromCoords = stopCoords.get(fromStop.stopId);
            const toCoords = stopCoords.get(toStop.stopId);
            const fromStopName = fromCoords?.name ?? fromStop.stopId;
            const toStopName = toCoords?.name ?? toStop.stopId;
            const segmentId = buildSegmentId(directionId, fromStop.stopId, toStop.stopId);

            if (!segmentsById.has(segmentId)) {
                const geometry = extractTripSegmentGeometry(meta.shapeId, fromStop, toStop, stopCoords, shapePointsById);
                const lengthMeters = calculateCorridorLengthMeters(geometry);
                segmentsById.set(segmentId, {
                    id: segmentId,
                    fromStopId: fromStop.stopId,
                    toStopId: toStop.stopId,
                    fromStopName,
                    toStopName,
                    directionId,
                    routes: [],
                    geometry,
                    lengthMeters,
                });
                routeSetsBySegmentId.set(segmentId, new Set<string>());
            }

            const routeSet = routeSetsBySegmentId.get(segmentId);
            routeSet?.add(route);

            for (const dayType of dayTypes) {
                scheduledSamples.push({
                    segmentId,
                    route,
                    dayType,
                    directionId,
                    departureMinutes,
                    runtimeMinutes: Math.round(runtimeMinutes * 100) / 100,
                });
            }
        }
    }

    const segments = Array.from(segmentsById.values())
        .map(segment => ({
            ...segment,
            routes: Array.from(routeSetsBySegmentId.get(segment.id) ?? []).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
            geometry: segment.geometry.length >= 2 ? segment.geometry : dedupeGeometryPoints(segment.geometry),
            lengthMeters: segment.lengthMeters > 0
                ? segment.lengthMeters
                : calculateCorridorLengthMeters(segment.geometry),
        }))
        .sort((a, b) => {
            const byDirection = a.directionId.localeCompare(b.directionId);
            if (byDirection !== 0) return byDirection;
            const byFrom = a.fromStopName.localeCompare(b.fromStopName);
            if (byFrom !== 0) return byFrom;
            return a.toStopName.localeCompare(b.toStopName);
        });

    return { segments, scheduledSamples };
}

function getStaticSpeedModel(): StaticSpeedModel {
    if (!cachedStaticModel) cachedStaticModel = buildStaticSpeedModel();
    return cachedStaticModel;
}

function buildScheduledCorridorTraversalSamples(
    segments: readonly CorridorSpeedSegment[],
): CorridorTraversalSample[] {
    const tripMeta = parseTripMetadata();
    const tripStopTimes = parseTripStopTimes();
    const serviceFlags = getServiceFlagsById();
    const samples: CorridorTraversalSample[] = [];

    for (const [tripId, meta] of tripMeta.entries()) {
        const stopTimes = tripStopTimes.get(tripId);
        if (!stopTimes || stopTimes.length < 2) continue;

        const route = normalizeRouteId(meta.route);
        const directionId = resolveGtfsDirectionLabel(meta.route, meta.headsign, meta.directionId);
        const dayTypes = getServiceDayTypes(meta.serviceId, serviceFlags);
        if (dayTypes.length === 0) continue;

        const tripStopIds = stopTimes.map(stop => stop.stopId);

        for (const segment of segments) {
            if (segment.directionId !== directionId) continue;
            if (!segment.routes.includes(route)) continue;
            if (!segment.stopIds || segment.stopIds.length < 2) continue;

            const match = matchSegmentStopsInTrip(segment.stopIds, tripStopIds);
            if (!match) continue;

            const fromStop = stopTimes[match.startIndex];
            const toStop = stopTimes[match.endIndex];
            const departureMinutes = fromStop.departureMinutes ?? fromStop.arrivalMinutes;
            let arrivalMinutes = toStop.arrivalMinutes ?? toStop.departureMinutes;
            if (departureMinutes === null || arrivalMinutes === null) continue;
            if (arrivalMinutes < departureMinutes) arrivalMinutes += 24 * 60;

            const runtimeMinutes = arrivalMinutes - departureMinutes;
            if (!Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0 || runtimeMinutes > 120) continue;

            for (const dayType of dayTypes) {
                samples.push({
                    segmentId: segment.id,
                    route,
                    dayType,
                    directionId,
                    departureMinutes,
                    runtimeMinutes: Math.round(runtimeMinutes * 100) / 100,
                });
            }
        }
    }

    return samples;
}

function getStaticCorridorTraversalModel(): StaticCorridorTraversalModel {
    if (cachedStaticCorridorTraversalModel) return cachedStaticCorridorTraversalModel;

    const staticModel = getStaticSpeedModel();
    const rawIndex: CorridorSpeedIndex = {
        segments: staticModel.segments,
        availableDirections: [],
        statsBySegmentId: new Map(),
    };
    const segments = buildCorridorDirectionSegments(rawIndex, buildCorridorSegments());
    const scheduledSamples = buildScheduledCorridorTraversalSamples(segments);

    cachedStaticCorridorTraversalModel = {
        segments,
        scheduledSamples,
    };
    return cachedStaticCorridorTraversalModel;
}

function matchObservedCorridorTraversal(
    segment: CorridorSpeedSegment,
    tripEntry: DailyTripStopSegmentRuntimeEntry,
): { departureMinutes: number; runtimeMinutes: number } | null {
    const stopIds = segment.stopIds;
    if (!stopIds || stopIds.length < 2 || tripEntry.segments.length < (stopIds.length - 1)) return null;

    const expectedPairs = stopIds.slice(0, -1).map((fromStopId, index) => ({
        fromStopId,
        toStopId: stopIds[index + 1],
    }));

    for (let startIndex = 0; startIndex <= (tripEntry.segments.length - expectedPairs.length); startIndex++) {
        const firstSegment = tripEntry.segments[startIndex];
        if (firstSegment.fromStopId !== expectedPairs[0]?.fromStopId || firstSegment.toStopId !== expectedPairs[0]?.toStopId) {
            continue;
        }

        let runtimeMinutes = firstSegment.runtimeMinutes;
        let matches = true;

        for (let offset = 1; offset < expectedPairs.length; offset++) {
            const expectedPair = expectedPairs[offset];
            const observedSegment = tripEntry.segments[startIndex + offset];
            if (
                !observedSegment
                || observedSegment.fromStopId !== expectedPair?.fromStopId
                || observedSegment.toStopId !== expectedPair?.toStopId
            ) {
                matches = false;
                break;
            }
            runtimeMinutes += observedSegment.runtimeMinutes;
        }

        if (!matches) continue;

        const departureMinutes = parseGtfsTimeToMinutes(firstSegment.timeBucket);
        if (departureMinutes === null) continue;

        return {
            departureMinutes,
            runtimeMinutes: Math.round(runtimeMinutes * 100) / 100,
        };
    }

    return null;
}

function buildObservedCorridorTraversalSamples(
    segments: readonly CorridorSpeedSegment[],
    dailySummaries: readonly DailySummary[],
): CorridorTraversalSample[] {
    const segmentsByRouteDirection = new Map<string, CorridorSpeedSegment[]>();
    for (const segment of segments) {
        for (const route of segment.routes) {
            const key = `${normalizeRouteId(route)}|${segment.directionId}`;
            const existing = segmentsByRouteDirection.get(key);
            if (existing) existing.push(segment);
            else segmentsByRouteDirection.set(key, [segment]);
        }
    }

    const samples: CorridorTraversalSample[] = [];

    for (const daySummary of dailySummaries) {
        const tripEntries = daySummary.tripStopSegmentRuntimes?.entries ?? [];
        for (const tripEntry of tripEntries) {
            const route = normalizeRouteId(tripEntry.routeId);
            const directionId = resolveObservedDirectionLabel(route, tripEntry.direction);
            const candidates = segmentsByRouteDirection.get(`${route}|${directionId}`) ?? [];

            for (const segment of candidates) {
                const match = matchObservedCorridorTraversal(segment, tripEntry);
                if (!match) continue;

                samples.push({
                    segmentId: segment.id,
                    route,
                    dayType: daySummary.dayType,
                    directionId,
                    departureMinutes: match.departureMinutes,
                    runtimeMinutes: match.runtimeMinutes,
                });
            }
        }
    }

    return samples;
}

function buildRawSegmentPairLookup(index: CorridorSpeedIndex): Map<string, CorridorSpeedSegment[]> {
    const lookup = new Map<string, CorridorSpeedSegment[]>();

    for (const segment of index.segments) {
        const key = `${segment.fromStopId}|${segment.toStopId}`;
        const existing = lookup.get(key);
        if (existing) existing.push(segment);
        else lookup.set(key, [segment]);
    }

    return lookup;
}

function buildCorridorDirectionSegments(
    rawIndex: CorridorSpeedIndex,
    corridorSegments: readonly GtfsCorridorSegment[],
): CorridorSpeedSegment[] {
    const pairLookup = buildRawSegmentPairLookup(rawIndex);
    const result: CorridorSpeedSegment[] = [];

    for (const corridor of corridorSegments) {
        if (corridor.stops.length < 2 || corridor.stopNames.length < 2 || corridor.geometry.length < 2) continue;

        const orderedPairKeys = corridor.stops.slice(0, -1).map((fromStopId, index) => `${fromStopId}|${corridor.stops[index + 1]}`);
        const directionIds = new Set<string>();

        for (const pairKey of orderedPairKeys) {
            for (const rawSegment of pairLookup.get(pairKey) ?? []) {
                if (rawSegment.routes.some(route => corridor.routes.includes(route))) {
                    directionIds.add(rawSegment.directionId);
                }
            }
        }

        for (const directionId of directionIds) {
            const matchedSegments: CorridorSpeedSegment[] = [];
            let hasFullCoverage = true;

            for (const pairKey of orderedPairKeys) {
                const match = (pairLookup.get(pairKey) ?? []).find(rawSegment =>
                    rawSegment.directionId === directionId
                    && rawSegment.routes.some(route => corridor.routes.includes(route)),
                );
                if (!match) {
                    hasFullCoverage = false;
                    break;
                }
                matchedSegments.push(match);
            }

            if (!hasFullCoverage || matchedSegments.length === 0) continue;

            const matchedChunks = chunkMatchedSegments(matchedSegments);

            matchedChunks.forEach((chunk, chunkIndex) => {
                if (chunk.length === 0) return;

                const routeSet = new Set<string>();
                for (const match of chunk) {
                    for (const route of match.routes) {
                        if (corridor.routes.includes(route)) routeSet.add(route);
                    }
                }

                const stopIds = [chunk[0].fromStopId, ...chunk.map(segment => segment.toStopId)];
                const stopNames = [chunk[0].fromStopName, ...chunk.map(segment => segment.toStopName)];
                const geometry = mergeSegmentGeometries(chunk);
                const segmentId = matchedChunks.length === 1
                    ? `${corridor.id}|${directionId}`
                    : `${corridor.id}|${directionId}|${chunkIndex + 1}`;

                result.push({
                    id: segmentId,
                    fromStopId: stopIds[0],
                    toStopId: stopIds[stopIds.length - 1],
                    fromStopName: stopNames[0],
                    toStopName: stopNames[stopNames.length - 1],
                    directionId,
                    routes: Array.from(routeSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
                    geometry,
                    lengthMeters: calculateCorridorLengthMeters(geometry),
                    stopIds,
                    sourceSegmentIds: chunk.map(segment => segment.id),
                });
            });
        }
    }

    return result.sort((a, b) => {
        const byDirection = a.directionId.localeCompare(b.directionId);
        if (byDirection !== 0) return byDirection;
        const byFrom = a.fromStopName.localeCompare(b.fromStopName);
        if (byFrom !== 0) return byFrom;
        return a.toStopName.localeCompare(b.toStopName);
    });
}

function sumValues(values: Array<number | null>): number | null {
    if (values.length === 0 || values.some(value => value === null)) return null;
    return Math.round(values.reduce((sum, value) => sum + (value ?? 0), 0) * 100) / 100;
}

function minPositive(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.min(...values);
}

export function buildCorridorSpeedMapIndexFromData(
    rawIndex: CorridorSpeedIndex,
    corridorSegments: readonly GtfsCorridorSegment[],
): CorridorSpeedIndex {
    const aggregatedSegments = buildCorridorDirectionSegments(rawIndex, corridorSegments);
    const statsBySegmentId = new Map<string, Map<DayType, Map<TimePeriod, CorridorSpeedStats>>>();
    const directionSet = new Set<string>();

    for (const segment of aggregatedSegments) {
        directionSet.add(segment.directionId);
        const sourceSegmentIds = segment.sourceSegmentIds ?? [];
        if (sourceSegmentIds.length === 0) continue;

        const byDay = new Map<DayType, Map<TimePeriod, CorridorSpeedStats>>();

        for (const dayType of ALL_DAY_TYPES) {
            const byPeriod = new Map<TimePeriod, CorridorSpeedStats>();

            for (const period of TIME_PERIODS.map(value => value.id)) {
                const sourceStats = sourceSegmentIds
                    .map(sourceSegmentId => rawIndex.statsBySegmentId.get(sourceSegmentId)?.get(dayType)?.get(period) ?? null);

                if (sourceStats.every(value => value === null)) continue;

                const scheduledRuntimeMin = sumValues(sourceStats.map(value => value?.scheduledRuntimeMin ?? null));
                const observedRuntimeMin = sumValues(sourceStats.map(value => value?.observedRuntimeMin ?? null));
                const sampleCount = observedRuntimeMin === null
                    ? 0
                    : minPositive(sourceStats.map(value => value?.sampleCount ?? 0).filter(value => value > 0));
                const runtimeDeltaMin =
                    scheduledRuntimeMin !== null && observedRuntimeMin !== null
                        ? Math.round((observedRuntimeMin - scheduledRuntimeMin) * 100) / 100
                        : null;
                const runtimeDeltaPct =
                    runtimeDeltaMin !== null && scheduledRuntimeMin !== null && scheduledRuntimeMin > 0
                        ? Math.round(((runtimeDeltaMin / scheduledRuntimeMin) * 100) * 10) / 10
                        : null;

                const routeBreakdown: CorridorSpeedRouteBreakdown[] = segment.routes
                    .map(route => {
                        const routeStats = sourceStats
                            .map(value => value?.routeBreakdown.find(routeValue => routeValue.route === route) ?? null);
                        const scheduledRouteRuntime = sumValues(routeStats.map(value => value?.scheduledRuntimeMin ?? null));
                        const observedRouteRuntime = sumValues(routeStats.map(value => value?.observedRuntimeMin ?? null));
                        const routeRuntimeDeltaMin =
                            scheduledRouteRuntime !== null && observedRouteRuntime !== null
                                ? Math.round((observedRouteRuntime - scheduledRouteRuntime) * 100) / 100
                                : null;
                        const routeRuntimeDeltaPct =
                            routeRuntimeDeltaMin !== null && scheduledRouteRuntime !== null && scheduledRouteRuntime > 0
                                ? Math.round(((routeRuntimeDeltaMin / scheduledRouteRuntime) * 100) * 10) / 10
                                : null;

                        return {
                            route,
                            sampleCount: observedRouteRuntime === null
                                ? 0
                                : minPositive(routeStats.map(value => value?.sampleCount ?? 0).filter(value => value > 0)),
                            scheduledRuntimeMin: scheduledRouteRuntime,
                            observedRuntimeMin: observedRouteRuntime,
                            runtimeDeltaMin: routeRuntimeDeltaMin,
                            runtimeDeltaPct: routeRuntimeDeltaPct,
                            scheduledSpeedKmh: toKmh(segment.lengthMeters, scheduledRouteRuntime),
                            observedSpeedKmh: toKmh(segment.lengthMeters, observedRouteRuntime),
                        };
                    })
                    .sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));

                byPeriod.set(period, {
                    segmentId: segment.id,
                    directionId: segment.directionId,
                    period,
                    dayType,
                    sampleCount,
                    lowConfidence: sampleCount > 0 && sampleCount < MIN_SAMPLE_COUNT,
                    corridorLengthMeters: segment.lengthMeters,
                    scheduledRuntimeMin,
                    observedRuntimeMin,
                    runtimeDeltaMin,
                    runtimeDeltaPct,
                    scheduledSpeedKmh: toKmh(segment.lengthMeters, scheduledRuntimeMin),
                    observedSpeedKmh: toKmh(segment.lengthMeters, observedRuntimeMin),
                    routeBreakdown,
                });
            }

            if (byPeriod.size > 0) byDay.set(dayType, byPeriod);
        }

        if (byDay.size > 0) statsBySegmentId.set(segment.id, byDay);
    }

    return {
        segments: aggregatedSegments,
        availableDirections: Array.from(directionSet).sort((a, b) => a.localeCompare(b)),
        statsBySegmentId,
    };
}

function createEmptyAccumulator(): StatAccumulator {
    return {
        scheduledRuntimes: [],
        observedRuntimes: [],
        routes: new Map<string, RouteAccumulator>(),
    };
}

function getOrCreateRouteAccumulator(acc: StatAccumulator, route: string): RouteAccumulator {
    const existing = acc.routes.get(route);
    if (existing) return existing;

    const created: RouteAccumulator = {
        scheduledRuntimes: [],
        observedRuntimes: [],
    };
    acc.routes.set(route, created);
    return created;
}

function getOrCreateStatAccumulator(
    map: Map<string, Map<DayType, Map<TimePeriod, StatAccumulator>>>,
    segmentId: string,
    dayType: DayType,
    period: TimePeriod,
): StatAccumulator {
    let byDay = map.get(segmentId);
    if (!byDay) {
        byDay = new Map<DayType, Map<TimePeriod, StatAccumulator>>();
        map.set(segmentId, byDay);
    }

    let byPeriod = byDay.get(dayType);
    if (!byPeriod) {
        byPeriod = new Map<TimePeriod, StatAccumulator>();
        byDay.set(dayType, byPeriod);
    }

    let acc = byPeriod.get(period);
    if (!acc) {
        acc = createEmptyAccumulator();
        byPeriod.set(period, acc);
    }

    return acc;
}

function buildObservedLookup(segments: readonly CorridorSpeedSegment[]): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const segment of segments) {
        for (const route of segment.routes) {
            lookup.set(
                `${normalizeRouteId(route)}|${segment.directionId}|${segment.fromStopId}|${segment.toStopId}`,
                segment.id,
            );
        }
    }
    return lookup;
}

function finalizeStats(
    segments: readonly CorridorSpeedSegment[],
    accumulators: Map<string, Map<DayType, Map<TimePeriod, StatAccumulator>>>,
): CorridorSpeedIndex {
    const statsBySegmentId = new Map<string, Map<DayType, Map<TimePeriod, CorridorSpeedStats>>>();
    const directionSet = new Set<string>();

    for (const segment of segments) {
        directionSet.add(segment.directionId);
        const byDayAcc = accumulators.get(segment.id);
        if (!byDayAcc) continue;

        const byDayStats = new Map<DayType, Map<TimePeriod, CorridorSpeedStats>>();
        for (const dayType of ALL_DAY_TYPES) {
            const byPeriodAcc = byDayAcc.get(dayType);
            if (!byPeriodAcc) continue;

            const byPeriodStats = new Map<TimePeriod, CorridorSpeedStats>();
            for (const period of TIME_PERIODS.map(value => value.id)) {
                const acc = byPeriodAcc.get(period);
                if (!acc) continue;

                const scheduledRuntimeMin = median(acc.scheduledRuntimes);
                const observedRuntimeMin = median(acc.observedRuntimes);
                const sampleCount = acc.observedRuntimes.length;
                const runtimeDeltaMin =
                    scheduledRuntimeMin !== null && observedRuntimeMin !== null
                        ? Math.round((observedRuntimeMin - scheduledRuntimeMin) * 100) / 100
                        : null;
                const runtimeDeltaPct =
                    runtimeDeltaMin !== null && scheduledRuntimeMin !== null && scheduledRuntimeMin > 0
                        ? Math.round(((runtimeDeltaMin / scheduledRuntimeMin) * 100) * 10) / 10
                        : null;

                const routeBreakdown: CorridorSpeedRouteBreakdown[] = segment.routes
                    .map(route => {
                        const routeAcc = acc.routes.get(route);
                        const routeObservedRuntime = median(routeAcc?.observedRuntimes ?? []);
                        const routeScheduledRuntime = median(routeAcc?.scheduledRuntimes ?? []);
                        const routeRuntimeDeltaMin =
                            routeScheduledRuntime !== null && routeObservedRuntime !== null
                                ? Math.round((routeObservedRuntime - routeScheduledRuntime) * 100) / 100
                                : null;
                        const routeRuntimeDeltaPct =
                            routeRuntimeDeltaMin !== null && routeScheduledRuntime !== null && routeScheduledRuntime > 0
                                ? Math.round(((routeRuntimeDeltaMin / routeScheduledRuntime) * 100) * 10) / 10
                                : null;
                        return {
                            route,
                            sampleCount: routeAcc?.observedRuntimes.length ?? 0,
                            scheduledRuntimeMin: routeScheduledRuntime,
                            observedRuntimeMin: routeObservedRuntime,
                            runtimeDeltaMin: routeRuntimeDeltaMin,
                            runtimeDeltaPct: routeRuntimeDeltaPct,
                            scheduledSpeedKmh: toKmh(segment.lengthMeters, routeScheduledRuntime),
                            observedSpeedKmh: toKmh(segment.lengthMeters, routeObservedRuntime),
                        };
                    })
                    .sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));

                byPeriodStats.set(period, {
                    segmentId: segment.id,
                    directionId: segment.directionId,
                    period,
                    dayType,
                    sampleCount,
                    lowConfidence: sampleCount > 0 && sampleCount < MIN_SAMPLE_COUNT,
                    corridorLengthMeters: segment.lengthMeters,
                    scheduledRuntimeMin,
                    observedRuntimeMin,
                    runtimeDeltaMin,
                    runtimeDeltaPct,
                    scheduledSpeedKmh: toKmh(segment.lengthMeters, scheduledRuntimeMin),
                    observedSpeedKmh: toKmh(segment.lengthMeters, observedRuntimeMin),
                    routeBreakdown,
                });
            }

            if (byPeriodStats.size > 0) byDayStats.set(dayType, byPeriodStats);
        }

        if (byDayStats.size > 0) statsBySegmentId.set(segment.id, byDayStats);
    }

    return {
        segments: [...segments],
        availableDirections: Array.from(directionSet).sort((a, b) => a.localeCompare(b)),
        statsBySegmentId,
    };
}

export function buildCorridorSpeedIndexFromData(
    segments: readonly CorridorSpeedSegment[],
    scheduledSamples: readonly ScheduledStopSegmentSample[],
    dailySummaries: readonly DailySummary[],
): CorridorSpeedIndex {
    const accumulators = new Map<string, Map<DayType, Map<TimePeriod, StatAccumulator>>>();

    for (const sample of scheduledSamples) {
        const periods = getMatchingPeriods(sample.departureMinutes);
        for (const period of periods) {
            const acc = getOrCreateStatAccumulator(accumulators, sample.segmentId, sample.dayType, period);
            acc.scheduledRuntimes.push(sample.runtimeMinutes);
            const routeAcc = getOrCreateRouteAccumulator(acc, sample.route);
            routeAcc.scheduledRuntimes.push(sample.runtimeMinutes);
        }
    }

    const observedLookup = buildObservedLookup(segments);
    for (const daySummary of dailySummaries) {
        const entries = daySummary.stopSegmentRuntimes?.entries ?? [];
        for (const entry of entries) {
            const directionId = resolveObservedDirectionLabel(entry.routeId, entry.direction);
            const route = normalizeRouteId(entry.routeId);
            const segmentId = observedLookup.get(`${route}|${directionId}|${entry.fromStopId}|${entry.toStopId}`);
            if (!segmentId) continue;

            for (const observation of entry.observations) {
                const bucketMinutes = parseGtfsTimeToMinutes(observation.timeBucket);
                if (bucketMinutes === null) continue;

                const periods = getMatchingPeriods(bucketMinutes);
                for (const period of periods) {
                    const acc = getOrCreateStatAccumulator(accumulators, segmentId, daySummary.dayType, period);
                    acc.observedRuntimes.push(observation.runtimeMinutes);
                    const routeAcc = getOrCreateRouteAccumulator(acc, route);
                    routeAcc.observedRuntimes.push(observation.runtimeMinutes);
                }
            }
        }
    }

    return finalizeStats(segments, accumulators);
}

export function buildCorridorSpeedIndexFromTraversalData(
    segments: readonly CorridorSpeedSegment[],
    scheduledSamples: readonly CorridorTraversalSample[],
    observedSamples: readonly CorridorTraversalSample[],
): CorridorSpeedIndex {
    const accumulators = new Map<string, Map<DayType, Map<TimePeriod, StatAccumulator>>>();

    for (const sample of scheduledSamples) {
        const periods = getMatchingPeriods(sample.departureMinutes);
        for (const period of periods) {
            const acc = getOrCreateStatAccumulator(accumulators, sample.segmentId, sample.dayType, period);
            acc.scheduledRuntimes.push(sample.runtimeMinutes);
            const routeAcc = getOrCreateRouteAccumulator(acc, sample.route);
            routeAcc.scheduledRuntimes.push(sample.runtimeMinutes);
        }
    }

    for (const sample of observedSamples) {
        const periods = getMatchingPeriods(sample.departureMinutes);
        for (const period of periods) {
            const acc = getOrCreateStatAccumulator(accumulators, sample.segmentId, sample.dayType, period);
            acc.observedRuntimes.push(sample.runtimeMinutes);
            const routeAcc = getOrCreateRouteAccumulator(acc, sample.route);
            routeAcc.observedRuntimes.push(sample.runtimeMinutes);
        }
    }

    return finalizeStats(segments, accumulators);
}

export function buildCorridorSpeedIndex(
    dailySummaries: readonly DailySummary[],
): CorridorSpeedIndex {
    const staticModel = getStaticSpeedModel();
    return buildCorridorSpeedIndexFromData(staticModel.segments, staticModel.scheduledSamples, dailySummaries);
}

export function buildCorridorSpeedMapIndex(
    dailySummaries: readonly DailySummary[],
): CorridorSpeedIndex {
    const staticCorridorModel = getStaticCorridorTraversalModel();
    const observedSamples = buildObservedCorridorTraversalSamples(staticCorridorModel.segments, dailySummaries);
    return buildCorridorSpeedIndexFromTraversalData(
        staticCorridorModel.segments,
        staticCorridorModel.scheduledSamples,
        observedSamples,
    );
}

export function getStatsForPeriod(
    index: CorridorSpeedIndex,
    dayType: DayType,
    period: TimePeriod,
    directionFilter: string | 'all' = 'all',
): Map<string, CorridorSpeedStats> {
    const result = new Map<string, CorridorSpeedStats>();
    for (const [segmentId, byDay] of index.statsBySegmentId.entries()) {
        const stats = byDay.get(dayType)?.get(period);
        if (!stats) continue;
        if (directionFilter !== 'all' && stats.directionId !== directionFilter) continue;
        result.set(segmentId, stats);
    }
    return result;
}

export function scopeStatsToRoute(
    stats: CorridorSpeedStats | null,
    route: string | 'all',
): CorridorSpeedStats | null {
    if (!stats || route === 'all') return stats;

    const routeStats = stats.routeBreakdown.find(value => value.route === route);
    if (!routeStats) return null;

    return {
        ...stats,
        sampleCount: routeStats.sampleCount,
        lowConfidence: routeStats.sampleCount > 0 && routeStats.sampleCount < MIN_SAMPLE_COUNT,
        scheduledRuntimeMin: routeStats.scheduledRuntimeMin,
        observedRuntimeMin: routeStats.observedRuntimeMin,
        runtimeDeltaMin: routeStats.runtimeDeltaMin,
        runtimeDeltaPct: routeStats.runtimeDeltaPct,
        scheduledSpeedKmh: routeStats.scheduledSpeedKmh,
        observedSpeedKmh: routeStats.observedSpeedKmh,
        routeBreakdown: [routeStats],
    };
}

export function getCorridorSpeedStyle(
    stats: CorridorSpeedStats | null,
    metric: CorridorSpeedMetric = 'delay-minutes',
): { color: string; weight: number; opacity: number } {
    if (!stats) return { color: '#d1d5db', weight: 2, opacity: 0.45 };
    if (stats.sampleCount === 0 || stats.observedRuntimeMin === null || stats.scheduledRuntimeMin === null) {
        return { color: '#cbd5e1', weight: 2, opacity: 0.45 };
    }
    if (stats.lowConfidence) return { color: '#9ca3af', weight: 3, opacity: 0.72 };

    const sampleWeight = Math.min(6, 2 + Math.floor(Math.min(stats.sampleCount, 24) / 6));
    if (metric === 'delay-percent') {
        const deltaPct = stats.runtimeDeltaPct ?? 0;
        if (deltaPct <= -10) return { color: '#16a34a', weight: sampleWeight, opacity: 0.88 };
        if (deltaPct <= 5) return { color: '#3b82f6', weight: sampleWeight, opacity: 0.84 };
        if (deltaPct <= 20) return { color: '#f59e0b', weight: sampleWeight, opacity: 0.88 };
        return { color: '#dc2626', weight: sampleWeight + 1, opacity: 0.92 };
    }

    if (metric === 'observed-speed' || metric === 'scheduled-speed') {
        const speed = metric === 'observed-speed' ? stats.observedSpeedKmh : stats.scheduledSpeedKmh;
        if (speed === null) return { color: '#cbd5e1', weight: 2, opacity: 0.45 };
        if (speed < 16) return { color: '#dc2626', weight: sampleWeight + 1, opacity: 0.92 };
        if (speed < 22) return { color: '#f59e0b', weight: sampleWeight, opacity: 0.88 };
        if (speed < 28) return { color: '#3b82f6', weight: sampleWeight, opacity: 0.84 };
        return { color: '#16a34a', weight: sampleWeight, opacity: 0.88 };
    }

    const delta = stats.runtimeDeltaMin ?? 0;
    if (delta <= -1.5) return { color: '#16a34a', weight: sampleWeight, opacity: 0.88 };
    if (delta <= 1) return { color: '#3b82f6', weight: sampleWeight, opacity: 0.84 };
    if (delta <= 3) return { color: '#f59e0b', weight: sampleWeight, opacity: 0.88 };
    return { color: '#dc2626', weight: sampleWeight + 1, opacity: 0.92 };
}

export function getMetricDisplayValue(stats: CorridorSpeedStats | null, metric: CorridorSpeedMetric): string {
    if (!stats) return 'No data';

    switch (metric) {
        case 'delay-minutes':
            return stats.runtimeDeltaMin === null
                ? 'No observed data'
                : `${stats.runtimeDeltaMin > 0 ? '+' : ''}${stats.runtimeDeltaMin.toFixed(1)} min`;
        case 'delay-percent':
            return stats.runtimeDeltaPct === null
                ? 'No observed data'
                : `${stats.runtimeDeltaPct > 0 ? '+' : ''}${stats.runtimeDeltaPct.toFixed(1)}%`;
        case 'observed-speed':
            return stats.observedSpeedKmh === null ? 'No observed data' : `${stats.observedSpeedKmh.toFixed(1)} km/h`;
        case 'scheduled-speed':
            return stats.scheduledSpeedKmh === null ? 'No scheduled data' : `${stats.scheduledSpeedKmh.toFixed(1)} km/h`;
        default:
            return 'No data';
    }
}
