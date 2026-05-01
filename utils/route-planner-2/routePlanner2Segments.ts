import type { RoutePlanner2RoutePoint, RoutePlanner2Scenario, RoutePlanner2Stop } from './routePlanner2Types';

const COORD_PRECISION = 5;

export interface RoutePlanner2StopSegmentPath {
    id: string;
    fromStopId: string;
    toStopId: string;
    coordinates: [number, number][];
    pathFingerprint: string;
}

export interface RoutePlanner2StopSegmentPair {
    fromStop: RoutePlanner2Stop;
    toStop: RoutePlanner2Stop;
}

function roundCoord(value: number): number {
    return Math.round(value * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION;
}

export function sortRoutePlanner2Stops(stops: RoutePlanner2Stop[]): RoutePlanner2Stop[] {
    return [...stops].sort((a, b) => a.sequence - b.sequence);
}

export function getRoutePlanner2SegmentKey(fromStopId: string, toStopId: string): string {
    return `${fromStopId}::${toStopId}`;
}

export function getRoutePlanner2SegmentId(fromStopId: string, toStopId: string): string {
    return `segment-${fromStopId}-${toStopId}`;
}

export function getRoutePlanner2LineWaypointsForSegment(
    alignment: RoutePlanner2RoutePoint[],
    fromStopId: string,
    toStopId: string,
): RoutePlanner2RoutePoint[] {
    return [...alignment]
        .filter((point) => point.afterStopId === fromStopId && point.beforeStopId === toStopId)
        .sort((a, b) => (a.segmentSequence ?? a.sequence) - (b.segmentSequence ?? b.sequence));
}

function getMirroredLineWaypointsForSegment(
    alignment: RoutePlanner2RoutePoint[],
    fromStopId: string,
    toStopId: string,
): RoutePlanner2RoutePoint[] {
    const directWaypoints = getRoutePlanner2LineWaypointsForSegment(alignment, fromStopId, toStopId);
    if (directWaypoints.length > 0) return directWaypoints;

    return getRoutePlanner2LineWaypointsForSegment(alignment, toStopId, fromStopId).reverse();
}

export function buildRoutePlanner2PathFingerprint(coordinates: [number, number][]): string {
    return coordinates
        .map(([lng, lat]) => `${roundCoord(lng)},${roundCoord(lat)}`)
        .join('|');
}

export function getRoutePlanner2TurnaroundStop(scenario: RoutePlanner2Scenario): RoutePlanner2Stop | null {
    const stops = sortRoutePlanner2Stops(scenario.stops);
    if (stops.length < 2) return null;
    return stops.find((stop) => stop.id === scenario.turnaroundStopId) ?? stops[stops.length - 1] ?? null;
}

export function buildRoutePlanner2StopVisitSequence(scenario: RoutePlanner2Scenario): RoutePlanner2Stop[] {
    const stops = sortRoutePlanner2Stops(scenario.stops);

    if (stops.length < 2) return stops;

    if (scenario.routeShape === 'closed-loop') {
        return [...stops, stops[0]!];
    }

    if (scenario.routeShape === 'out-and-back') {
        const turnaroundStop = getRoutePlanner2TurnaroundStop(scenario);
        const turnaroundIndex = turnaroundStop
            ? stops.findIndex((stop) => stop.id === turnaroundStop.id)
            : stops.length - 1;
        if (turnaroundIndex <= 0) return stops;

        const outboundStops = stops.slice(0, turnaroundIndex + 1);
        const returnStops = outboundStops.slice(0, -1).reverse();
        return [...outboundStops, ...returnStops];
    }

    return stops;
}

export function buildRoutePlanner2StopSegmentPairs(scenario: RoutePlanner2Scenario): RoutePlanner2StopSegmentPair[] {
    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);

    return stopVisits.slice(0, -1).flatMap((fromStop, index): RoutePlanner2StopSegmentPair[] => {
        const toStop = stopVisits[index + 1];
        return toStop ? [{ fromStop, toStop }] : [];
    });
}

export function buildRoutePlanner2StopSegmentPaths(scenario: RoutePlanner2Scenario): RoutePlanner2StopSegmentPath[] {
    return buildRoutePlanner2StopSegmentPairs(scenario).map(({ fromStop, toStop }): RoutePlanner2StopSegmentPath => {
        const anchors = getMirroredLineWaypointsForSegment(scenario.alignment, fromStop.id, toStop.id);
        const coordinates: [number, number][] = [
            [fromStop.lng, fromStop.lat],
            ...anchors.map((anchor): [number, number] => [anchor.lng, anchor.lat]),
            [toStop.lng, toStop.lat],
        ];

        return {
            id: getRoutePlanner2SegmentId(fromStop.id, toStop.id),
            fromStopId: fromStop.id,
            toStopId: toStop.id,
            coordinates,
            pathFingerprint: buildRoutePlanner2PathFingerprint(coordinates),
        };
    });
}
