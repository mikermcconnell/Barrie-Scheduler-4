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
            });
            return;
        }

        existing.trips.push(trip);
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

function buildGtfsScheduledRuntimeEstimates(
    stops: RoutePlanner2GtfsImportStop[],
    now: string,
    sampleSize: number,
    routeShortName: string,
    evidenceDayType?: 'weekday' | 'saturday' | 'sunday',
): RoutePlanner2SegmentRuntime[] {
    const estimates: RoutePlanner2SegmentRuntime[] = [];

    stops.slice(0, -1).forEach((fromStop, index) => {
        const toStop = stops[index + 1];
        if (!toStop) return;

        const fromMinutes = fromStop.departureMinutes ?? fromStop.arrivalMinutes;
        const toMinutes = toStop.arrivalMinutes ?? toStop.departureMinutes;
        if (fromMinutes == null || toMinutes == null || toMinutes < fromMinutes) return;

        const runtimeMinutes = Math.max(1, Math.round(toMinutes - fromMinutes));
        estimates.push({
            id: `segment-${fromStop.stopId}-${toStop.stopId}`,
            fromStopId: fromStop.stopId,
            toStopId: toStop.stopId,
            runtimeMinutes,
            source: 'scheduled-proxy',
            confidence: 'high',
            sampleSize,
            scheduledRuntimeMinutes: runtimeMinutes,
            matchQuality: 'exact-code',
            matchedFromStopId: fromStop.gtfsStopId,
            matchedToStopId: toStop.gtfsStopId,
            matchedRoutes: [routeShortName],
            evidenceDayType,
            evidencePeriod: 'full-day',
            updatedAt: now,
        });
    });

    return estimates;
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
    const dayTypeLabel = pattern.dayTypeLabel.toLowerCase();
    const evidenceDayType = dayTypeLabel.includes('saturday')
        ? 'saturday'
        : dayTypeLabel.includes('sunday')
            ? 'sunday'
            : dayTypeLabel.includes('weekday')
                ? 'weekday'
                : undefined;
    const runtimeEstimates = buildGtfsScheduledRuntimeEstimates(pattern.stops, now, pattern.tripCount, pattern.routeShortName, evidenceDayType);

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
        service: { ...DEFAULT_SERVICE },
        runtimeSourceMode: 'mapbox',
        runtimeEstimates,
        notes: 'Imported from GTFS as an editable planning copy. Changes here do not modify the GTFS feed.',
        createdAt: now,
        updatedAt: now,
    };
}
