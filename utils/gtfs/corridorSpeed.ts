import stopTimesRaw from '../../gtfs/stop_times.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import shapesRaw from '../../gtfs/shapes.txt?raw';
import { DAY_TYPES, TIME_PERIODS, type DayType, type TimePeriod } from './corridorHeadway';
import type { DailySummary } from '../performanceDataTypes';
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

let cachedStaticModel: StaticSpeedModel | null = null;

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
                        return {
                            route,
                            sampleCount: routeAcc?.observedRuntimes.length ?? 0,
                            scheduledRuntimeMin: median(routeAcc?.scheduledRuntimes ?? []),
                            observedRuntimeMin: routeObservedRuntime,
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

export function buildCorridorSpeedIndex(
    dailySummaries: readonly DailySummary[],
): CorridorSpeedIndex {
    const staticModel = getStaticSpeedModel();
    return buildCorridorSpeedIndexFromData(staticModel.segments, staticModel.scheduledSamples, dailySummaries);
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
