import { TIME_PERIODS, type TimePeriod } from '../gtfs/corridorHeadway';
import type {
    RoutePlanner2RoutePoint,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2ServiceAssumptions,
    RoutePlanner2Stop,
} from './routePlanner2Types';

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

export interface RoutePlanner2GtfsImportPattern {
    id: string;
    routeId: string;
    routeShortName: string;
    routeLongName?: string;
    routeColor?: string;
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

function deriveMedianHeadwayMinutes(departures: number[]): number | undefined {
    const sortedDepartures = departures.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    const headways = sortedDepartures
        .slice(1)
        .map((departure, index) => departure - sortedDepartures[index]!)
        .filter((headway) => headway > 0);
    const medianHeadway = median(headways);
    return medianHeadway == null ? undefined : Math.max(1, Math.round(medianHeadway));
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
        periodTrips.forEach((sample) => {
            const tripSegmentRuntimes: number[] = [];
            for (let index = 0; index < stopCount - 1; index += 1) {
                const runtimeMinutes = deriveTripSegmentRuntimeMinutes(sample.stopTimes, index);
                if (runtimeMinutes == null) return;
                tripSegmentRuntimes.push(runtimeMinutes);
            }
            tripSegmentRuntimes.forEach((runtimeMinutes, index) => {
                segmentRuntimeValues[index]?.push(runtimeMinutes);
            });
        });

        if (segmentRuntimeValues.some((values) => values.length === 0)) return [];
        const segmentRuntimeMinutes = segmentRuntimeValues.map((values) => Math.max(1, Math.round(median(values) ?? 1)));
        const sampleSize = Math.min(...segmentRuntimeValues.map((values) => values.length));
        return [{
            period: period.id,
            sampleSize,
            segmentRuntimeMinutes,
            totalRuntimeMinutes: segmentRuntimeMinutes.reduce((sum, runtimeMinutes) => sum + runtimeMinutes, 0),
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

        return {
            id,
            routeId: group.route.route_id,
            routeShortName: group.route.route_short_name,
            routeLongName: group.route.route_long_name,
            routeColor: group.route.route_color,
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
            medianHeadwayMinutes: deriveMedianHeadwayMinutes(sortedDepartures),
            blockCount: group.blockIds.size > 0 ? group.blockIds.size : undefined,
            scheduledRuntimes: buildScheduledRuntimesForTripSamples(group.tripStopTimes, stops.length),
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
    const segmentRuntimeMinutes = pattern.stops.slice(0, -1).flatMap((fromStop, index): number[] => {
        const toStop = pattern.stops[index + 1];
        if (!toStop) return [];

        const fromMinutes = fromStop.departureMinutes ?? fromStop.arrivalMinutes;
        const toMinutes = toStop.arrivalMinutes ?? toStop.departureMinutes;
        if (fromMinutes == null || toMinutes == null || toMinutes < fromMinutes) return [];

        return [Math.max(1, Math.round(toMinutes - fromMinutes))];
    });

    if (segmentRuntimeMinutes.length !== Math.max(0, pattern.stops.length - 1)) return [];
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

function buildServiceAssumptionsFromGtfsPattern(pattern: RoutePlanner2GtfsImportPattern): RoutePlanner2ServiceAssumptions {
    const firstTripTime = formatGtfsMinutesAsTime(pattern.firstDepartureMinutes);
    const lastTripTime = formatGtfsMinutesAsTime(pattern.lastDepartureMinutes);
    const targetBuses = pattern.blockCount && pattern.blockCount > 0 ? pattern.blockCount : undefined;

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
    };
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

    return {
        id: options.id ?? createId('scenario-gtfs'),
        name: pattern.tripHeadsign ? `Route ${pattern.routeShortName} - ${pattern.tripHeadsign}` : `Route ${pattern.routeShortName}`,
        status: 'draft',
        routeShape: 'one-way',
        source: {
            type: 'gtfs',
            routeId: pattern.routeId,
            routeShortName: pattern.routeShortName,
            routeLongName: pattern.routeLongName,
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
