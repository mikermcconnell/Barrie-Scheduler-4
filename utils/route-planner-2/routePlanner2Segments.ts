import type { RoutePlanner2RoutePoint, RoutePlanner2Scenario, RoutePlanner2Stop } from './routePlanner2Types';

const COORD_PRECISION = 5;

export interface RoutePlanner2StopSegmentPath {
    id: string;
    fromStopId: string;
    toStopId: string;
    coordinates: [number, number][];
    pathFingerprint: string;
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

export function buildRoutePlanner2PathFingerprint(coordinates: [number, number][]): string {
    return coordinates
        .map(([lng, lat]) => `${roundCoord(lng)},${roundCoord(lat)}`)
        .join('|');
}

export function buildRoutePlanner2StopSegmentPaths(scenario: RoutePlanner2Scenario): RoutePlanner2StopSegmentPath[] {
    const stops = sortRoutePlanner2Stops(scenario.stops);

    return stops.slice(0, -1).flatMap((fromStop, index): RoutePlanner2StopSegmentPath[] => {
        const toStop = stops[index + 1];
        if (!toStop) return [];

        const anchors = getRoutePlanner2LineWaypointsForSegment(scenario.alignment, fromStop.id, toStop.id);
        const coordinates: [number, number][] = [
            [fromStop.lng, fromStop.lat],
            ...anchors.map((anchor): [number, number] => [anchor.lng, anchor.lat]),
            [toStop.lng, toStop.lat],
        ];

        return [{
            id: getRoutePlanner2SegmentId(fromStop.id, toStop.id),
            fromStopId: fromStop.id,
            toStopId: toStop.id,
            coordinates,
            pathFingerprint: buildRoutePlanner2PathFingerprint(coordinates),
        }];
    });
}
