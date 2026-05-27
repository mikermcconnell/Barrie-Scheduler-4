import type { TimePeriod } from '../gtfs/corridorHeadway';
import { getRouteColor } from '../config/routeColors';
import type {
    RoutePlanner2RoutePoint,
    RoutePlanner2RouteFamilyReference,
    RoutePlanner2PlanningPeriod,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2ServiceAssumptions,
    RoutePlanner2Stop,
} from './routePlanner2Types';

const BLOCK_CYCLE_OUTLIER_MULTIPLIER = 1.35;
const BLOCK_CYCLE_OUTLIER_BUFFER_MINUTES = 30;
// Keep this local to avoid loading the bundled GTFS corridor index just to import patterns.
const TIME_PERIODS: Array<{ id: TimePeriod; label: string; startMinute: number; endMinute: number }> = [
    { id: 'am-peak', label: 'AM Peak', startMinute: 420, endMinute: 540 },
    { id: 'midday', label: 'Midday', startMinute: 540, endMinute: 900 },
    { id: 'pm-peak', label: 'PM Peak', startMinute: 900, endMinute: 1080 },
    { id: 'evening', label: 'Evening', startMinute: 1080, endMinute: 1380 },
    { id: 'full-day', label: 'Full Day', startMinute: 300, endMinute: 1500 },
];

export interface RoutePlanner2GtfsRoute {
    route_id: string;
    route_short_name: string;
    route_long_name?: string;
    route_type?: number;
    route_color?: string;
}

export interface RoutePlanner2GtfsStop {
    stop_id: string;
    stop_code?: string;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
}

export interface RoutePlanner2GtfsTrip {
    route_id: string;
    service_id: string;
    trip_id: string;
    trip_headsign?: string;
    direction_id?: number;
    block_id?: string;
    shape_id?: string;
}

export interface RoutePlanner2GtfsStopTime {
    trip_id: string;
    arrival_time?: string;
    departure_time?: string;
    stop_id: string;
    stop_sequence: number;
}

export interface RoutePlanner2GtfsCalendar {
    service_id: string;
    monday?: number;
    tuesday?: number;
    wednesday?: number;
    thursday?: number;
    friday?: number;
    saturday?: number;
    sunday?: number;
    start_date?: string;
    end_date?: string;
}

export interface RoutePlanner2GtfsShapeRecord {
    shape_id: string;
    shape_pt_lat: number;
    shape_pt_lon: number;
    shape_pt_sequence: number;
    shape_dist_traveled?: number;
}

export interface RoutePlanner2GtfsImportFeed {
    routes: RoutePlanner2GtfsRoute[];
    stops: RoutePlanner2GtfsStop[];
    trips: RoutePlanner2GtfsTrip[];
    stopTimes: RoutePlanner2GtfsStopTime[];
    calendar?: RoutePlanner2GtfsCalendar[];
    calendarDates?: unknown[];
    shapes?: RoutePlanner2GtfsShapeRecord[];
    feedInfo?: {
        feedVersion?: string;
        feedStartDate?: string;
        feedEndDate?: string;
    };
}

export interface RoutePlanner2GtfsShapePoint {
    lat: number;
    lng: number;
    sequence: number;
}

export interface RoutePlanner2GtfsImportStop {
    stopId: string;
    gtfsStopId: string;
    stopCode?: string;
    name: string;
    lat: number;
    lng: number;
    sequence: number;
    arrivalMinutes?: number;
    departureMinutes?: number;
}

export interface RoutePlanner2GtfsImportPeriodRuntime {
    period: TimePeriod;
    sampleSize: number;
    segmentRuntimeMinutes: number[];
    totalRuntimeMinutes: number;
}

export interface RoutePlanner2GtfsImportPeriodCycle {
    period: TimePeriod;
    sampleSize: number;
    cycleTimeMinutes: number;
}

export interface RoutePlanner2GtfsImportPattern {
    id: string;
    routeId: string;
    routeShortName: string;
    routeLongName?: string;
    routeColor?: string;
    routeFamily?: RoutePlanner2RouteFamilyReference;
    serviceId: string;
    dayTypeLabel: string;
    directionId?: number;
    tripHeadsign?: string;
    shapeId?: string;
    tripCount: number;
    stopCount: number;
    shapePointCount: number;
    firstDepartureMinutes?: number;
    lastDepartureMinutes?: number;
    medianHeadwayMinutes?: number;
    blockCount?: number;
    scheduledRuntimes?: RoutePlanner2GtfsImportPeriodRuntime[];
    scheduledCycles?: RoutePlanner2GtfsImportPeriodCycle[];
    stops: RoutePlanner2GtfsImportStop[];
    shapePoints: RoutePlanner2GtfsShapePoint[];
    feedVersion?: string;
}

const DEFAULT_SERVICE: RoutePlanner2ServiceAssumptions = {
    firstTripTime: '06:00',
    lastTripTime: '22:00',
    frequencyMinutes: 30,
    startTerminalLayoverMinutes: 5,
    endTerminalLayoverMinutes: 5,
    intermediateStopDwellSeconds: 0,
};

const MIN_SELECTABLE_PATTERN_TRIPS = 6;
const DEFAULT_ROUTE_COLOR = '#6B7280';
const BARRIE_MERGED_ROUTE_FAMILIES = new Set(['2', '7', '12']);

export function getRoutePlanner2GtfsRouteFamily(routeShortName: string): RoutePlanner2RouteFamilyReference | undefined {
    const match = routeShortName.trim().toUpperCase().match(/^(\d+)([AB])$/);
    if (!match) return undefined;

    const [, shortName, branch] = match;
    if (!shortName || !branch || !BARRIE_MERGED_ROUTE_FAMILIES.has(shortName)) return undefined;

    const directionRole = branch === 'A' ? 'out' : 'back';
    const directionLabel = directionRole === 'out' ? 'Out' : 'Back';

    return {
        key: `barrie-merged-${shortName}`,
        name: `Route ${shortName}`,
        shortName,
        memberShortName: `${shortName}${branch}`,
        directionRole,
        directionLabel,
    };
}

function normalizeRouteColorHex(value: string | undefined): string | undefined {
    const normalized = value?.replace(/^#/, '').trim().toUpperCase();
    return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : undefined;
}

function getImportRouteColor(routeShortName: string, gtfsRouteColor?: string): string | undefined {
    const officialColor = getRouteColor(routeShortName);
    if (officialColor !== DEFAULT_ROUTE_COLOR) return normalizeRouteColorHex(officialColor);
    return normalizeRouteColorHex(gtfsRouteColor);
}

function createId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseGtfsMinutes(value: string | undefined): number {
    if (!value) return Number.POSITIVE_INFINITY;
    const [hours = '0', minutes = '0'] = value.split(':');
    return (Number(hours) * 60) + Number(minutes);
}

function parseFiniteGtfsMinutes(value: string | undefined): number | undefined {
    const minutes = parseGtfsMinutes(value);
    return Number.isFinite(minutes) ? minutes : undefined;
}

function formatGtfsMinutesAsTime(value: number | undefined): string | undefined {
    if (value == null || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    const normalized = ((rounded % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function median(values: number[]): number | undefined {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0) return undefined;
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[midpoint];
    const left = sorted[midpoint - 1];
    const right = sorted[midpoint];
    if (left == null || right == null) return undefined;
    return (left + right) / 2;
}

function mostCommonTypicalValue(values: number[]): number | undefined {
    const finiteValues = values.filter((value) => Number.isFinite(value));
    if (finiteValues.length === 0) return undefined;

    const medianValue = median(finiteValues) ?? finiteValues[0]!;
    const counts = new Map<number, number>();
    finiteValues.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    return Array.from(counts.entries())
        .sort(([valueA, countA], [valueB, countB]) =>
            countB - countA
            || Math.abs(valueA - medianValue) - Math.abs(valueB - medianValue)
            || valueA - valueB,
        )[0]?.[0];
}

function deriveMedianHeadwayMinutes(departures: number[]): number | undefined {
    const sortedDepartures = departures.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    const headways = sortedDepartures
        .slice(1)
        .map((departure, index) => departure - sortedDepartures[index]!)
        .filter((headway) => headway > 0);
    const medianHeadway = median(headways);
    return medianHeadway == null ? undefined : Math.max(1, Math.round(medianHeadway));
}

function getMaximumExpectedBlockCycleMinutes(
    medianHeadwayMinutes: number | undefined,
    blockCount: number | undefined,
): number | undefined {
    if (
        medianHeadwayMinutes == null
        || blockCount == null
        || !Number.isFinite(medianHeadwayMinutes)
        || !Number.isFinite(blockCount)
        || medianHeadwayMinutes <= 0
        || blockCount <= 0
    ) {
        return undefined;
    }

    const proxyCycleMinutes = medianHeadwayMinutes * blockCount;
    return Math.max(
        Math.round(proxyCycleMinutes * BLOCK_CYCLE_OUTLIER_MULTIPLIER),
        Math.round(proxyCycleMinutes + BLOCK_CYCLE_OUTLIER_BUFFER_MINUTES),
    );
}

function isDepartureInPeriod(departureMinutes: number, period: TimePeriod): boolean {
    const definition = TIME_PERIODS.find((item) => item.id === period);
    if (!definition) return false;
    return departureMinutes >= definition.startMinute && departureMinutes < definition.endMinute;
}

function deriveTripSegmentRuntimeMinutes(stopTimes: RoutePlanner2GtfsStopTime[], segmentIndex: number): number | undefined {
    const fromStopTime = stopTimes[segmentIndex];
    const toStopTime = stopTimes[segmentIndex + 1];
    if (!fromStopTime || !toStopTime) return undefined;

    const fromMinutes = parseFiniteGtfsMinutes(fromStopTime.departure_time) ?? parseFiniteGtfsMinutes(fromStopTime.arrival_time);
    const toMinutes = parseFiniteGtfsMinutes(toStopTime.arrival_time) ?? parseFiniteGtfsMinutes(toStopTime.departure_time);
    if (fromMinutes == null || toMinutes == null || toMinutes < fromMinutes) return undefined;

    return Math.max(1, Math.round(toMinutes - fromMinutes));
}

function deriveTripElapsedRuntimeMinutes(stopTimes: RoutePlanner2GtfsStopTime[]): number | undefined {
    const firstStopTime = stopTimes[0];
    const lastStopTime = stopTimes[stopTimes.length - 1];
    if (!firstStopTime || !lastStopTime) return undefined;

    const firstMinutes = parseFiniteGtfsMinutes(firstStopTime.departure_time) ?? parseFiniteGtfsMinutes(firstStopTime.arrival_time);
    const lastMinutes = parseFiniteGtfsMinutes(lastStopTime.arrival_time) ?? parseFiniteGtfsMinutes(lastStopTime.departure_time);
    if (firstMinutes == null || lastMinutes == null || lastMinutes < firstMinutes) return undefined;

    return Math.max(1, Math.round(lastMinutes - firstMinutes));
}

function fitSegmentRuntimeTotal(segmentRuntimeMinutes: number[], targetTotalRuntimeMinutes: number): number[] {
    const next = segmentRuntimeMinutes.map((runtimeMinutes) => Math.max(1, Math.round(runtimeMinutes)));
    if (next.length === 0) return next;

    const minimumTotal = next.length;
    const targetTotal = Math.max(minimumTotal, Math.round(targetTotalRuntimeMinutes));
    const currentTotal = next.reduce((sum, runtimeMinutes) => sum + runtimeMinutes, 0);
    let delta = currentTotal - targetTotal;

    while (delta > 0) {
        const reducibleSegments = next
            .map((runtimeMinutes, index) => ({ runtimeMinutes, index }))
            .filter((segment) => segment.runtimeMinutes > 1)
            .sort((a, b) => b.runtimeMinutes - a.runtimeMinutes || a.index - b.index);

        if (reducibleSegments.length === 0) break;

        for (const segment of reducibleSegments) {
            if (delta <= 0) break;
            if (next[segment.index] == null || next[segment.index] <= 1) continue;
            next[segment.index] -= 1;
            delta -= 1;
        }
    }

    while (delta < 0) {
        const expandableSegments = next
            .map((runtimeMinutes, index) => ({ runtimeMinutes, index }))
            .sort((a, b) => b.runtimeMinutes - a.runtimeMinutes || a.index - b.index);

        for (const segment of expandableSegments) {
            if (delta >= 0) break;
            next[segment.index] += 1;
            delta += 1;
        }
    }

    return next;
}

interface GtfsTripStopTimeSample {
    trip: RoutePlanner2GtfsTrip;
    stopTimes: RoutePlanner2GtfsStopTime[];
    firstDepartureMinutes: number;
}

function buildScheduledRuntimesForTripSamples(
    tripStopTimes: GtfsTripStopTimeSample[],
    stopCount: number,
): RoutePlanner2GtfsImportPeriodRuntime[] {
    if (stopCount < 2) return [];

    return TIME_PERIODS.flatMap((period): RoutePlanner2GtfsImportPeriodRuntime[] => {
        const periodTrips = tripStopTimes.filter((sample) => (
            Number.isFinite(sample.firstDepartureMinutes)
            && isDepartureInPeriod(sample.firstDepartureMinutes, period.id)
        ));
        if (periodTrips.length === 0) return [];

        const segmentRuntimeValues = Array.from({ length: stopCount - 1 }, () => [] as number[]);
        const tripElapsedRuntimeValues: number[] = [];
        periodTrips.forEach((sample) => {
            const elapsedRuntimeMinutes = deriveTripElapsedRuntimeMinutes(sample.stopTimes);
            if (elapsedRuntimeMinutes == null) return;

            const tripSegmentRuntimes: number[] = [];
            for (let index = 0; index < stopCount - 1; index += 1) {
                const runtimeMinutes = deriveTripSegmentRuntimeMinutes(sample.stopTimes, index);
                if (runtimeMinutes == null) return;
                tripSegmentRuntimes.push(runtimeMinutes);
            }
            tripElapsedRuntimeValues.push(elapsedRuntimeMinutes);
            tripSegmentRuntimes.forEach((runtimeMinutes, index) => {
                segmentRuntimeValues[index]?.push(runtimeMinutes);
            });
        });

        if (tripElapsedRuntimeValues.length === 0 || segmentRuntimeValues.some((values) => values.length === 0)) return [];
        const medianSegmentRuntimeMinutes = segmentRuntimeValues.map((values) => Math.max(1, Math.round(median(values) ?? 1)));
        const medianTripElapsedRuntimeMinutes = median(tripElapsedRuntimeValues)
            ?? medianSegmentRuntimeMinutes.reduce((sum, runtimeMinutes) => sum + runtimeMinutes, 0);
        // Dense GTFS feeds often repeat the same minute across adjacent local stops.
        // Keep those stop pairs usable as segment evidence, but preserve the trip's
        // first-stop-to-last-stop elapsed runtime so route totals and recovery stay realistic.
        const segmentRuntimeMinutes = fitSegmentRuntimeTotal(medianSegmentRuntimeMinutes, medianTripElapsedRuntimeMinutes);
        const sampleSize = Math.min(tripElapsedRuntimeValues.length, ...segmentRuntimeValues.map((values) => values.length));
        return [{
            period: period.id,
            sampleSize,
            segmentRuntimeMinutes,
            totalRuntimeMinutes: segmentRuntimeMinutes.reduce((sum, runtimeMinutes) => sum + runtimeMinutes, 0),
        }];
    });
}

function buildScheduledCyclesForTripSamples(
    tripStopTimes: GtfsTripStopTimeSample[],
    options: { medianHeadwayMinutes?: number; blockCount?: number } = {},
): RoutePlanner2GtfsImportPeriodCycle[] {
    const tripsByBlock = new Map<string, GtfsTripStopTimeSample[]>();
    const maximumExpectedCycleMinutes = getMaximumExpectedBlockCycleMinutes(
        options.medianHeadwayMinutes,
        options.blockCount,
    );

    tripStopTimes.forEach((sample) => {
        const blockId = sample.trip.block_id?.trim();
        if (!blockId || !Number.isFinite(sample.firstDepartureMinutes)) return;
        const blockTrips = tripsByBlock.get(blockId) ?? [];
        blockTrips.push(sample);
        tripsByBlock.set(blockId, blockTrips);
    });

    const cycleSamples: Array<{ startMinutes: number; cycleTimeMinutes: number }> = [];
    tripsByBlock.forEach((blockTrips) => {
        const sortedTrips = [...blockTrips].sort((a, b) => a.firstDepartureMinutes - b.firstDepartureMinutes);
        sortedTrips.slice(0, -1).forEach((sample, index) => {
            const nextTrip = sortedTrips[index + 1];
            if (!nextTrip) return;
            const cycleTimeMinutes = nextTrip.firstDepartureMinutes - sample.firstDepartureMinutes;
            if (!Number.isFinite(cycleTimeMinutes) || cycleTimeMinutes <= 0) return;
            // A long gap in the same block can be a break, deadhead, or off-service span,
            // not the repeating route cycle. Keep only plausible block-return windows.
            if (maximumExpectedCycleMinutes != null && cycleTimeMinutes > maximumExpectedCycleMinutes) return;
            cycleSamples.push({
                startMinutes: sample.firstDepartureMinutes,
                cycleTimeMinutes: Math.round(cycleTimeMinutes),
            });
        });
    });

    if (cycleSamples.length === 0) return [];

    return TIME_PERIODS.flatMap((period): RoutePlanner2GtfsImportPeriodCycle[] => {
        const periodCycles = cycleSamples
            .filter((sample) => isDepartureInPeriod(sample.startMinutes, period.id))
            .map((sample) => sample.cycleTimeMinutes);
        if (periodCycles.length === 0) return [];

        const cycleTimeMinutes = mostCommonTypicalValue(periodCycles);
        if (cycleTimeMinutes == null) return [];

        return [{
            period: period.id,
            sampleSize: periodCycles.length,
            cycleTimeMinutes,
        }];
    });
}

function getCalendarLabel(feed: RoutePlanner2GtfsImportFeed, serviceId: string): string {
    const calendar = feed.calendar?.find((item) => item.service_id === serviceId);
    if (!calendar) return serviceId;
    const isWeekday = calendar.monday && calendar.tuesday && calendar.wednesday && calendar.thursday && calendar.friday;
    if (isWeekday && !calendar.saturday && !calendar.sunday) return 'Weekday';
    if (calendar.saturday && !calendar.sunday && !isWeekday) return 'Saturday';
    if (calendar.sunday && !calendar.saturday && !isWeekday) return 'Sunday';
    return serviceId;
}

function normalizeStopTimes(stopTimes: RoutePlanner2GtfsStopTime[]): RoutePlanner2GtfsStopTime[] {
    return [...stopTimes].sort((a, b) => a.stop_sequence - b.stop_sequence);
}

function stopSequenceKey(stopTimes: RoutePlanner2GtfsStopTime[]): string {
    return normalizeStopTimes(stopTimes).map((stopTime) => stopTime.stop_id).join('>');
}

function distanceScore(point: { lat: number; lng: number }, stop: { lat: number; lng: number }): number {
    const latDistance = point.lat - stop.lat;
    const lngDistance = point.lng - stop.lng;
    return (latDistance * latDistance) + (lngDistance * lngDistance);
}

function findNearestShapeIndex(
    points: RoutePlanner2GtfsShapePoint[],
    stop: { lat: number; lng: number },
    startIndex: number,
): number {
    if (points.length === 0) return -1;
    let bestIndex = Math.max(0, Math.min(startIndex, points.length - 1));
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = bestIndex; index < points.length; index += 1) {
        const score = distanceScore(points[index]!, stop);
        if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return bestIndex;
}

export function simplifyRoutePlanner2GtfsShapePoints(
    points: RoutePlanner2GtfsShapePoint[],
    maxPoints = 60,
): RoutePlanner2GtfsShapePoint[] {
    const sorted = [...points].sort((a, b) => a.sequence - b.sequence);
    if (sorted.length <= maxPoints) return sorted;
    if (maxPoints <= 2) return [sorted[0]!, sorted[sorted.length - 1]!];

    const result: RoutePlanner2GtfsShapePoint[] = [];
    const lastIndex = sorted.length - 1;
    const step = lastIndex / (maxPoints - 1);
    const used = new Set<number>();

    for (let index = 0; index < maxPoints; index += 1) {
        const sourceIndex = Math.round(index * step);
        if (used.has(sourceIndex)) continue;
        used.add(sourceIndex);
        result.push(sorted[sourceIndex]!);
    }

    if (result[0] !== sorted[0]) result.unshift(sorted[0]!);
    if (result[result.length - 1] !== sorted[lastIndex]) result.push(sorted[lastIndex]!);

    return result.slice(0, maxPoints);
}

function buildSegmentWaypoints(
    stops: RoutePlanner2GtfsImportStop[],
    shapePoints: RoutePlanner2GtfsShapePoint[],
): RoutePlanner2RoutePoint[] {
    if (stops.length < 2 || shapePoints.length < 2) return [];

    const stopShapeIndices: number[] = [];
    let searchStartIndex = 0;
    stops.forEach((stop) => {
        const nearestIndex = findNearestShapeIndex(shapePoints, stop, searchStartIndex);
        stopShapeIndices.push(nearestIndex);
        searchStartIndex = Math.max(nearestIndex, searchStartIndex);
    });

    const alignment: RoutePlanner2RoutePoint[] = [];
    stops.slice(0, -1).forEach((fromStop, stopIndex) => {
        const toStop = stops[stopIndex + 1];
        if (!toStop) return;
        const fromIndex = stopShapeIndices[stopIndex] ?? -1;
        const toIndex = stopShapeIndices[stopIndex + 1] ?? -1;
        if (fromIndex < 0 || toIndex < 0 || toIndex <= fromIndex) return;

        const segmentInterior = shapePoints.slice(fromIndex + 1, toIndex);
        segmentInterior.forEach((point, pointIndex) => {
            alignment.push({
                id: `gtfs-shape-${fromStop.stopId}-${toStop.stopId}-${pointIndex + 1}`,
                lat: point.lat,
                lng: point.lng,
                sequence: alignment.length + 1,
                afterStopId: fromStop.stopId,
                beforeStopId: toStop.stopId,
                segmentSequence: pointIndex + 1,
            });
        });
    });

    return alignment;
}


function getFullRouteGroupKey(pattern: RoutePlanner2GtfsImportPattern): string {
    return [
        pattern.routeId,
        pattern.serviceId,
        pattern.directionId ?? 'none',
    ].join('|');
}

function filterToFullRoutePatterns(patterns: RoutePlanner2GtfsImportPattern[]): RoutePlanner2GtfsImportPattern[] {
    const maxStopCountByGroup = new Map<string, number>();

    patterns.forEach((pattern) => {
        const key = getFullRouteGroupKey(pattern);
        maxStopCountByGroup.set(key, Math.max(maxStopCountByGroup.get(key) ?? 0, pattern.stopCount));
    });

    return patterns.filter((pattern) => (
        pattern.tripCount >= MIN_SELECTABLE_PATTERN_TRIPS
        && pattern.stopCount === maxStopCountByGroup.get(getFullRouteGroupKey(pattern))
    ));
}

export function buildRoutePlanner2GtfsImportPatterns(feed: RoutePlanner2GtfsImportFeed): RoutePlanner2GtfsImportPattern[] {
    const routesById = new Map(feed.routes.map((route) => [route.route_id, route]));
    const stopsById = new Map(feed.stops.map((stop) => [stop.stop_id, stop]));
    const stopTimesByTrip = new Map<string, RoutePlanner2GtfsStopTime[]>();
    const shapesById = new Map<string, RoutePlanner2GtfsShapePoint[]>();

    feed.stopTimes.forEach((stopTime) => {
        const list = stopTimesByTrip.get(stopTime.trip_id) ?? [];
        list.push(stopTime);
        stopTimesByTrip.set(stopTime.trip_id, list);
    });

    feed.shapes?.forEach((shape) => {
        const list = shapesById.get(shape.shape_id) ?? [];
        list.push({
            lat: shape.shape_pt_lat,
            lng: shape.shape_pt_lon,
            sequence: shape.shape_pt_sequence,
        });
        shapesById.set(shape.shape_id, list);
    });

    interface Group {
        route: RoutePlanner2GtfsRoute;
        serviceId: string;
        directionId?: number;
        tripHeadsign?: string;
        shapeId?: string;
        trips: RoutePlanner2GtfsTrip[];
        sampleTrip: RoutePlanner2GtfsTrip;
        sampleStopTimes: RoutePlanner2GtfsStopTime[];
        firstDepartureMinutes: number;
        departureMinutes: number[];
        blockIds: Set<string>;
        tripStopTimes: GtfsTripStopTimeSample[];
    }

    const groups = new Map<string, Group>();

    feed.trips.forEach((trip) => {
        const route = routesById.get(trip.route_id);
        const stopTimes = normalizeStopTimes(stopTimesByTrip.get(trip.trip_id) ?? []);
        if (!route || stopTimes.length < 2) return;

        const key = [
            trip.route_id,
            trip.service_id,
            trip.direction_id ?? 'none',
            trip.shape_id ?? 'no-shape',
            stopSequenceKey(stopTimes),
        ].join('|');
        const firstDepartureMinutes = parseGtfsMinutes(stopTimes[0]?.departure_time ?? stopTimes[0]?.arrival_time);
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, {
                route,
                serviceId: trip.service_id,
                directionId: trip.direction_id,
                tripHeadsign: trip.trip_headsign,
                shapeId: trip.shape_id,
                trips: [trip],
                sampleTrip: trip,
                sampleStopTimes: stopTimes,
                firstDepartureMinutes,
                departureMinutes: Number.isFinite(firstDepartureMinutes) ? [firstDepartureMinutes] : [],
                blockIds: trip.block_id ? new Set([trip.block_id]) : new Set<string>(),
                tripStopTimes: [{ trip, stopTimes, firstDepartureMinutes }],
            });
            return;
        }

        existing.trips.push(trip);
        existing.tripStopTimes.push({ trip, stopTimes, firstDepartureMinutes });
        if (Number.isFinite(firstDepartureMinutes)) existing.departureMinutes.push(firstDepartureMinutes);
        if (trip.block_id) existing.blockIds.add(trip.block_id);
        if (firstDepartureMinutes < existing.firstDepartureMinutes) {
            existing.sampleTrip = trip;
            existing.sampleStopTimes = stopTimes;
            existing.firstDepartureMinutes = firstDepartureMinutes;
            existing.tripHeadsign = trip.trip_headsign ?? existing.tripHeadsign;
        }
    });

    const patterns = Array.from(groups.values()).map((group): RoutePlanner2GtfsImportPattern => {
        const stops = group.sampleStopTimes.flatMap((stopTime, index): RoutePlanner2GtfsImportStop[] => {
            const stop = stopsById.get(stopTime.stop_id);
            if (!stop) return [];
            return [{
                stopId: `gtfs-${stop.stop_id}-${index + 1}`,
                gtfsStopId: stop.stop_id,
                stopCode: stop.stop_code,
                name: stop.stop_name,
                lat: stop.stop_lat,
                lng: stop.stop_lon,
                sequence: index + 1,
                arrivalMinutes: parseFiniteGtfsMinutes(stopTime.arrival_time),
                departureMinutes: parseFiniteGtfsMinutes(stopTime.departure_time),
            }];
        });
        const shapePoints = simplifyRoutePlanner2GtfsShapePoints(
            group.shapeId ? (shapesById.get(group.shapeId) ?? []) : [],
        );
        const directionLabel = group.directionId == null ? 'none' : String(group.directionId);
        const id = `${group.route.route_id}|${group.serviceId}|${directionLabel}|${group.shapeId ?? 'no-shape'}|${stops.map((stop) => stop.stopId).join('>')}`;
        const sortedDepartures = group.departureMinutes.sort((a, b) => a - b);
        const medianHeadwayMinutes = deriveMedianHeadwayMinutes(sortedDepartures);
        const blockCount = group.blockIds.size > 0 ? group.blockIds.size : undefined;

        return {
            id,
            routeId: group.route.route_id,
            routeShortName: group.route.route_short_name,
            routeLongName: group.route.route_long_name,
            routeColor: getImportRouteColor(group.route.route_short_name, group.route.route_color),
            routeFamily: getRoutePlanner2GtfsRouteFamily(group.route.route_short_name),
            serviceId: group.serviceId,
            dayTypeLabel: getCalendarLabel(feed, group.serviceId),
            directionId: group.directionId,
            tripHeadsign: group.tripHeadsign,
            shapeId: group.shapeId,
            tripCount: group.trips.length,
            stopCount: stops.length,
            shapePointCount: group.shapeId ? (shapesById.get(group.shapeId)?.length ?? 0) : 0,
            firstDepartureMinutes: sortedDepartures[0],
            lastDepartureMinutes: sortedDepartures[sortedDepartures.length - 1],
            medianHeadwayMinutes,
            blockCount,
            scheduledRuntimes: buildScheduledRuntimesForTripSamples(group.tripStopTimes, stops.length),
            scheduledCycles: buildScheduledCyclesForTripSamples(group.tripStopTimes, { medianHeadwayMinutes, blockCount }),
            stops,
            shapePoints,
            feedVersion: feed.feedInfo?.feedVersion,
        };
    }).sort((a, b) => {
        const routeCompare = a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true });
        if (routeCompare !== 0) return routeCompare;
        const headsignCompare = (a.tripHeadsign ?? '').localeCompare(b.tripHeadsign ?? '');
        if (headsignCompare !== 0) return headsignCompare;
        return a.serviceId.localeCompare(b.serviceId);
    });

    return filterToFullRoutePatterns(patterns);
}

function buildFallbackFullDayScheduledRuntime(pattern: RoutePlanner2GtfsImportPattern): RoutePlanner2GtfsImportPeriodRuntime[] {
    const medianSegmentRuntimeMinutes = pattern.stops.slice(0, -1).flatMap((fromStop, index): number[] => {
        const toStop = pattern.stops[index + 1];
        if (!toStop) return [];

        const fromMinutes = fromStop.departureMinutes ?? fromStop.arrivalMinutes;
        const toMinutes = toStop.arrivalMinutes ?? toStop.departureMinutes;
        if (fromMinutes == null || toMinutes == null || toMinutes < fromMinutes) return [];

        return [Math.max(1, Math.round(toMinutes - fromMinutes))];
    });

    if (medianSegmentRuntimeMinutes.length !== Math.max(0, pattern.stops.length - 1)) return [];

    const firstStop = pattern.stops[0];
    const lastStop = pattern.stops[pattern.stops.length - 1];
    const firstMinutes = firstStop ? firstStop.departureMinutes ?? firstStop.arrivalMinutes : undefined;
    const lastMinutes = lastStop ? lastStop.arrivalMinutes ?? lastStop.departureMinutes : undefined;
    const elapsedRuntimeMinutes = firstMinutes != null && lastMinutes != null && lastMinutes >= firstMinutes
        ? Math.max(1, Math.round(lastMinutes - firstMinutes))
        : medianSegmentRuntimeMinutes.reduce((sum, runtimeMinutes) => sum + runtimeMinutes, 0);
    const segmentRuntimeMinutes = fitSegmentRuntimeTotal(medianSegmentRuntimeMinutes, elapsedRuntimeMinutes);

    return [{
        period: 'full-day',
        sampleSize: pattern.tripCount,
        segmentRuntimeMinutes,
        totalRuntimeMinutes: segmentRuntimeMinutes.reduce((sum, runtimeMinutes) => sum + runtimeMinutes, 0),
    }];
}

function buildGtfsScheduledRuntimeEstimates(
    pattern: RoutePlanner2GtfsImportPattern,
    now: string,
    routeShortName: string,
    evidenceDayType?: 'weekday' | 'saturday' | 'sunday',
): RoutePlanner2SegmentRuntime[] {
    const estimates: RoutePlanner2SegmentRuntime[] = [];
    const scheduledRuntimes = pattern.scheduledRuntimes && pattern.scheduledRuntimes.length > 0
        ? pattern.scheduledRuntimes
        : buildFallbackFullDayScheduledRuntime(pattern);

    scheduledRuntimes.forEach((periodRuntime) => {
        pattern.stops.slice(0, -1).forEach((fromStop, index) => {
            const toStop = pattern.stops[index + 1];
            const runtimeMinutes = periodRuntime.segmentRuntimeMinutes[index];
            if (!toStop || runtimeMinutes == null || !Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0) return;

            estimates.push({
                id: `segment-${fromStop.stopId}-${toStop.stopId}-${periodRuntime.period}`,
                fromStopId: fromStop.stopId,
                toStopId: toStop.stopId,
                runtimeMinutes,
                source: 'scheduled-proxy',
                confidence: 'high',
                sampleSize: periodRuntime.sampleSize,
                scheduledRuntimeMinutes: runtimeMinutes,
                matchQuality: 'exact-code',
                matchedFromStopId: fromStop.gtfsStopId,
                matchedToStopId: toStop.gtfsStopId,
                matchedRoutes: [routeShortName],
                evidenceDayType,
                evidencePeriod: periodRuntime.period,
                updatedAt: now,
            });
        });
    });

    return estimates;
}

function getGtfsDayType(dayTypeLabel: string): RoutePlanner2ServiceAssumptions['dayType'] {
    const normalized = dayTypeLabel.toLowerCase();
    if (normalized.includes('saturday')) return 'saturday';
    if (normalized.includes('sunday')) return 'sunday';
    if (normalized.includes('weekday')) return 'weekday';
    return undefined;
}

function getPlanningPeriodFromGtfsPeriod(period: TimePeriod): RoutePlanner2PlanningPeriod {
    return period === 'full-day' ? 'all-day' : period;
}

function buildServiceAssumptionsFromGtfsPattern(pattern: RoutePlanner2GtfsImportPattern): RoutePlanner2ServiceAssumptions {
    const firstTripTime = formatGtfsMinutesAsTime(pattern.firstDepartureMinutes);
    const lastTripTime = formatGtfsMinutesAsTime(pattern.lastDepartureMinutes);
    const targetBuses = pattern.blockCount && pattern.blockCount > 0 ? pattern.blockCount : undefined;
    const scheduledCycleWindows: NonNullable<RoutePlanner2ServiceAssumptions['scheduledCycleWindows']> = {};
    pattern.scheduledCycles?.forEach((cycle) => {
        const planningPeriod = getPlanningPeriodFromGtfsPeriod(cycle.period);
        scheduledCycleWindows[planningPeriod] = {
            cycleTimeMinutes: cycle.cycleTimeMinutes,
            sampleSize: cycle.sampleSize,
            source: 'gtfs-block',
        };
    });

    return {
        ...DEFAULT_SERVICE,
        ...(firstTripTime ? { firstTripTime } : {}),
        ...(lastTripTime ? { lastTripTime } : {}),
        ...(pattern.medianHeadwayMinutes ? { frequencyMinutes: pattern.medianHeadwayMinutes } : {}),
        ...(targetBuses ? {
            targetBuses,
            startTerminalLayoverMinutes: 0,
            endTerminalLayoverMinutes: 0,
        } : {}),
        dayType: getGtfsDayType(pattern.dayTypeLabel),
        planningPeriod: 'all-day',
        ...(Object.keys(scheduledCycleWindows).length > 0 ? { scheduledCycleWindows } : {}),
    };
}

function buildScenarioNameFromGtfsPattern(pattern: RoutePlanner2GtfsImportPattern): string {
    const baseName = pattern.routeFamily
        ? `${pattern.routeFamily.name} ${pattern.routeFamily.directionLabel}`
        : `Route ${pattern.routeShortName}`;
    return pattern.tripHeadsign ? `${baseName} - ${pattern.tripHeadsign}` : baseName;
}

export function createRoutePlanner2ScenarioFromGtfsPattern(
    pattern: RoutePlanner2GtfsImportPattern,
    options: { id?: string; now?: string } = {},
): RoutePlanner2Scenario {
    const now = options.now ?? new Date().toISOString();
    const stops: RoutePlanner2Stop[] = pattern.stops.map((stop, index) => ({
        id: stop.stopId,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        sequence: index + 1,
        role: index === 0
            ? 'start-terminal'
            : index === pattern.stops.length - 1
                ? 'end-terminal'
                : 'regular',
        source: 'barrie-stop',
        stopCode: stop.stopCode,
    }));
    const alignment = buildSegmentWaypoints(pattern.stops, pattern.shapePoints);
    const evidenceDayType = getGtfsDayType(pattern.dayTypeLabel);
    const runtimeEstimates = buildGtfsScheduledRuntimeEstimates(pattern, now, pattern.routeShortName, evidenceDayType);
    const routeColor = getImportRouteColor(pattern.routeShortName, pattern.routeColor);

    return {
        id: options.id ?? createId('scenario-gtfs'),
        name: buildScenarioNameFromGtfsPattern(pattern),
        status: 'draft',
        routeShape: 'one-way',
        routeFamily: pattern.routeFamily,
        source: {
            type: 'gtfs',
            routeId: pattern.routeId,
            routeShortName: pattern.routeShortName,
            routeLongName: pattern.routeLongName,
            routeColor: routeColor ? `#${routeColor}` : undefined,
            serviceId: pattern.serviceId,
            directionId: pattern.directionId,
            tripHeadsign: pattern.tripHeadsign,
            shapeId: pattern.shapeId,
            feedVersion: pattern.feedVersion,
            importedAt: now,
        },
        alignment,
        stops,
        service: buildServiceAssumptionsFromGtfsPattern(pattern),
        runtimeSourceMode: 'gtfs',
        runtimeEstimates,
        notes: 'Imported from GTFS as an editable planning copy. Changes here do not modify the GTFS feed.',
        createdAt: now,
        updatedAt: now,
    };
}
