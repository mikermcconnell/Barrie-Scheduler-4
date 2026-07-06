import { buildRoutePlanner2StopVisitSequence } from './routePlanner2Segments';
import type { RoutePlanner2Scenario, RoutePlanner2SegmentRuntime } from './routePlanner2Types';

export type RoutePlanner2StopNudgeDirection = 'north' | 'south' | 'east' | 'west';

const EARTH_METERS_PER_DEGREE_LAT = 111_320;
export const ROUTE_PLANNER_2_STOP_NUDGE_METERS = 4;
export const ROUTE_PLANNER_2_STOP_SIDE_OFFSET_METERS = 14;

interface Coordinate {
    lat: number;
    lng: number;
}

interface ProjectedPoint {
    x: number;
    y: number;
}

export interface RoutePlanner2StopPlacementWarning {
    id: string;
    message: string;
    action: string;
}

function metersPerDegreeLng(referenceLat: number): number {
    return EARTH_METERS_PER_DEGREE_LAT * Math.max(0.1, Math.cos(referenceLat * Math.PI / 180));
}

function projectCoordinate(coordinate: Coordinate, referenceLat: number): ProjectedPoint {
    return {
        x: coordinate.lng * metersPerDegreeLng(referenceLat),
        y: coordinate.lat * EARTH_METERS_PER_DEGREE_LAT,
    };
}

function unprojectCoordinate(point: ProjectedPoint, referenceLat: number): Coordinate {
    return {
        lat: point.y / EARTH_METERS_PER_DEGREE_LAT,
        lng: point.x / metersPerDegreeLng(referenceLat),
    };
}

export function offsetRoutePlanner2CoordinateByMeters(
    coordinate: Coordinate,
    offset: { northMeters?: number; eastMeters?: number },
): Coordinate {
    const referenceLat = coordinate.lat;
    const projected = projectCoordinate(coordinate, referenceLat);
    return unprojectCoordinate({
        x: projected.x + (offset.eastMeters ?? 0),
        y: projected.y + (offset.northMeters ?? 0),
    }, referenceLat);
}

export function nudgeRoutePlanner2StopCoordinate(
    coordinate: Coordinate,
    direction: RoutePlanner2StopNudgeDirection,
    meters = ROUTE_PLANNER_2_STOP_NUDGE_METERS,
): Coordinate {
    if (direction === 'north') return offsetRoutePlanner2CoordinateByMeters(coordinate, { northMeters: meters });
    if (direction === 'south') return offsetRoutePlanner2CoordinateByMeters(coordinate, { northMeters: -meters });
    if (direction === 'east') return offsetRoutePlanner2CoordinateByMeters(coordinate, { eastMeters: meters });
    return offsetRoutePlanner2CoordinateByMeters(coordinate, { eastMeters: -meters });
}

function distanceKm(first: Coordinate, second: Coordinate): number {
    const referenceLat = (first.lat + second.lat) / 2;
    const firstPoint = projectCoordinate(first, referenceLat);
    const secondPoint = projectCoordinate(second, referenceLat);
    return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y) / 1000;
}

function getStopSideReferenceLine(scenario: RoutePlanner2Scenario, stopId: string): { start: Coordinate; end: Coordinate; usesSelectedStop: boolean } | null {
    const visits = buildRoutePlanner2StopVisitSequence(scenario);
    const stopIndex = visits.findIndex((stop) => stop.id === stopId);
    if (stopIndex < 0) return null;

    const selectedStop = visits[stopIndex];
    const previousStop = visits[stopIndex - 1];
    const nextStop = visits[stopIndex + 1];
    const previousPreviousStop = visits[stopIndex - 2];
    const nextNextStop = visits[stopIndex + 2];
    if (!selectedStop) return null;

    if (previousStop && nextStop) {
        return { start: previousStop, end: nextStop, usesSelectedStop: false };
    }
    if (nextStop && nextNextStop) {
        return { start: nextStop, end: nextNextStop, usesSelectedStop: false };
    }
    if (previousPreviousStop && previousStop) {
        return { start: previousPreviousStop, end: previousStop, usesSelectedStop: false };
    }
    if (nextStop) {
        return { start: selectedStop, end: nextStop, usesSelectedStop: true };
    }
    if (previousStop) {
        return { start: previousStop, end: selectedStop, usesSelectedStop: true };
    }

    return null;
}

export function canFlipRoutePlanner2StopSide(
    scenario: RoutePlanner2Scenario,
    stopId: string,
): boolean {
    const referenceLine = getStopSideReferenceLine(scenario, stopId);
    return Boolean(referenceLine && !referenceLine.usesSelectedStop);
}

export function flipRoutePlanner2StopSide(
    scenario: RoutePlanner2Scenario,
    stopId: string,
    fallbackOffsetMeters = ROUTE_PLANNER_2_STOP_SIDE_OFFSET_METERS,
): Coordinate | null {
    const stop = scenario.stops.find((candidate) => candidate.id === stopId);
    const referenceLine = getStopSideReferenceLine(scenario, stopId);
    if (!stop || !referenceLine || referenceLine.usesSelectedStop) return null;

    const referenceLat = stop.lat;
    const stopPoint = projectCoordinate(stop, referenceLat);
    const start = projectCoordinate(referenceLine.start, referenceLat);
    const end = projectCoordinate(referenceLine.end, referenceLat);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;

    const normal = { x: -dy / length, y: dx / length };
    const signedOffsetMeters = ((stopPoint.x - start.x) * normal.x) + ((stopPoint.y - start.y) * normal.y);
    const offsetMeters = Math.abs(signedOffsetMeters) < 1
        ? fallbackOffsetMeters
        : -2 * signedOffsetMeters;

    return unprojectCoordinate({
        x: stopPoint.x + normal.x * offsetMeters,
        y: stopPoint.y + normal.y * offsetMeters,
    }, referenceLat);
}

export function getRoutePlanner2StopPlacementWarning(
    scenario: RoutePlanner2Scenario,
    stopId: string,
    segmentRuntimes: RoutePlanner2SegmentRuntime[] = [],
): RoutePlanner2StopPlacementWarning | null {
    const stop = scenario.stops.find((candidate) => candidate.id === stopId);
    if (!stop || scenario.stops.length < 2) return null;

    for (const segment of segmentRuntimes) {
        if (segment.fromStopId !== stopId && segment.toStopId !== stopId) continue;
        if (!segment.distanceKm || segment.distanceKm <= 0) continue;

        const fromStop = scenario.stops.find((candidate) => candidate.id === segment.fromStopId);
        const toStop = scenario.stops.find((candidate) => candidate.id === segment.toStopId);
        if (!fromStop || !toStop) continue;

        const straightDistanceKm = distanceKm(fromStop, toStop);
        const suspiciousDistanceKm = Math.max(straightDistanceKm * 2.2, straightDistanceKm + 0.2);
        if (segment.distanceKm > suspiciousDistanceKm) {
            const canFlip = canFlipRoutePlanner2StopSide(scenario, stopId);
            return {
                id: `stop-side-detour-${stopId}-${segment.id}`,
                message: 'This stop may be on the wrong side of the street; the route to or from it has a large detour.',
                action: canFlip
                    ? 'Try Flip side, then use the nudge buttons if the bus stop still sits on the wrong curb.'
                    : 'Use the nudge buttons to move the bus stop to the correct curb.',
            };
        }
    }

    return null;
}
