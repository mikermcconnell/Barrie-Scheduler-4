import type { DetourCoordinate } from './detourTypes';

export type { DetourCoordinate } from './detourTypes';

export interface DetourRouteAnchor {
    coordinate: DetourCoordinate;
    /** Segment beginning at this zero-based coordinate index. */
    segmentIndex: number;
    /** Position along the segment, from 0 to 1. */
    fraction: number;
}

export interface DetourStopLike {
    id: string;
    position: DetourCoordinate;
}

export interface DetourRouteSplit {
    before: DetourCoordinate[];
    bypassed: DetourCoordinate[];
    after: DetourCoordinate[];
    wrapsLoop: boolean;
}

export interface DetourFeatureCollection {
    type: 'FeatureCollection';
    features: Array<{
        type: 'Feature';
        geometry: { type: 'LineString'; coordinates: [number, number][] }
            | { type: 'Point'; coordinates: [number, number] };
        properties: Record<string, unknown>;
    }>;
}

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function sameCoordinate(first: DetourCoordinate, second: DetourCoordinate): boolean {
    return Math.abs(first.latitude - second.latitude) < EPSILON
        && Math.abs(first.longitude - second.longitude) < EPSILON;
}

function appendCoordinate(path: DetourCoordinate[], coordinate: DetourCoordinate): void {
    if (!path.length || !sameCoordinate(path[path.length - 1]!, coordinate)) path.push({ ...coordinate });
}

function normalizedAnchor(anchor: DetourRouteAnchor, geometry: DetourCoordinate[]): DetourRouteAnchor {
    const maxSegmentIndex = Math.max(0, geometry.length - 2);
    const segmentIndex = clamp(Math.floor(anchor.segmentIndex), 0, maxSegmentIndex);
    return {
        segmentIndex,
        fraction: clamp(anchor.fraction, 0, 1),
        coordinate: { ...anchor.coordinate },
    };
}

function anchorPosition(anchor: DetourRouteAnchor): number {
    return anchor.segmentIndex + anchor.fraction;
}

/** Finds the nearest location on a route polyline using a local planar projection. */
export function findNearestRouteAnchor(
    geometry: DetourCoordinate[],
    target: DetourCoordinate,
): DetourRouteAnchor | null {
    if (geometry.length === 0) return null;
    if (geometry.length === 1) return { coordinate: { ...geometry[0]! }, segmentIndex: 0, fraction: 0 };

    const latitudeScale = Math.max(0.01, Math.cos(target.latitude * Math.PI / 180));
    let best: DetourRouteAnchor | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < geometry.length - 1; index += 1) {
        const from = geometry[index]!;
        const to = geometry[index + 1]!;
        const dx = (to.longitude - from.longitude) * latitudeScale;
        const dy = to.latitude - from.latitude;
        const targetX = (target.longitude - from.longitude) * latitudeScale;
        const targetY = target.latitude - from.latitude;
        const lengthSquared = dx * dx + dy * dy;
        const fraction = lengthSquared <= EPSILON ? 0 : clamp((targetX * dx + targetY * dy) / lengthSquared, 0, 1);
        const coordinate = {
            longitude: from.longitude + ((to.longitude - from.longitude) * fraction),
            latitude: from.latitude + ((to.latitude - from.latitude) * fraction),
        };
        const distance = ((target.longitude - coordinate.longitude) * latitudeScale) ** 2
            + (target.latitude - coordinate.latitude) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { coordinate, segmentIndex: index, fraction };
        }
    }
    return best;
}

function sliceForward(
    geometry: DetourCoordinate[],
    start: DetourRouteAnchor,
    end: DetourRouteAnchor,
): DetourCoordinate[] {
    const result: DetourCoordinate[] = [];
    appendCoordinate(result, start.coordinate);
    for (let index = start.segmentIndex + 1; index <= end.segmentIndex; index += 1) {
        appendCoordinate(result, geometry[index]!);
    }
    appendCoordinate(result, end.coordinate);
    return result;
}

/**
 * Splits the original route into visible normal portions and the bypassed portion.
 * For loops, start/end order follows service travel order and may wrap through the seam.
 */
export function splitDetourRoute(
    geometry: DetourCoordinate[],
    startInput: DetourRouteAnchor,
    endInput: DetourRouteAnchor,
    isLoop = false,
): DetourRouteSplit | null {
    if (geometry.length < 2) return null;
    const start = normalizedAnchor(startInput, geometry);
    const end = normalizedAnchor(endInput, geometry);
    const wrapsLoop = isLoop && anchorPosition(end) < anchorPosition(start);

    if (!wrapsLoop) {
        const orderedStart = anchorPosition(start) <= anchorPosition(end) ? start : end;
        const orderedEnd = orderedStart === start ? end : start;
        const before = geometry.slice(0, orderedStart.segmentIndex + 1).map((point) => ({ ...point }));
        appendCoordinate(before, orderedStart.coordinate);
        const after: DetourCoordinate[] = [];
        appendCoordinate(after, orderedEnd.coordinate);
        geometry.slice(orderedEnd.segmentIndex + 1).forEach((point) => appendCoordinate(after, point));
        return {
            before,
            bypassed: sliceForward(geometry, orderedStart, orderedEnd),
            after,
            wrapsLoop: false,
        };
    }

    const firstPart = sliceForward(geometry, start, {
        segmentIndex: geometry.length - 2,
        fraction: 1,
        coordinate: geometry[geometry.length - 1]!,
    });
    const secondPart = sliceForward(geometry, {
        segmentIndex: 0,
        fraction: 0,
        coordinate: geometry[0]!,
    }, end);
    const bypassed = firstPart.map((point) => ({ ...point }));
    secondPart.forEach((point) => appendCoordinate(bypassed, point));

    const retained: DetourCoordinate[] = [];
    appendCoordinate(retained, end.coordinate);
    geometry.slice(end.segmentIndex + 1, start.segmentIndex + 1).forEach((point) => appendCoordinate(retained, point));
    appendCoordinate(retained, start.coordinate);
    return {
        before: retained,
        bypassed,
        after: [],
        wrapsLoop: true,
    };
}

function haversineMeters(first: DetourCoordinate, second: DetourCoordinate): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const dLat = radians(second.latitude - first.latitude);
    const dLng = radians(second.longitude - first.longitude);
    const firstLat = radians(first.latitude);
    const secondLat = radians(second.latitude);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

/** Suggests stops on the bypassed route section; final confirmation remains with the planner. */
export function suggestBypassedStopIds(
    stops: DetourStopLike[],
    bypassedGeometry: DetourCoordinate[],
    toleranceMeters = 45,
): string[] {
    if (bypassedGeometry.length < 2) return [];
    return stops.filter((stop) => {
        const target = stop.position;
        const nearest = findNearestRouteAnchor(bypassedGeometry, target);
        return nearest !== null && haversineMeters(target, nearest.coordinate) <= toleranceMeters;
    }).map((stop) => stop.id);
}

export function buildDetourLineGeoJson(
    coordinates: DetourCoordinate[],
    properties: Record<string, unknown> = {},
): DetourFeatureCollection {
    return {
        type: 'FeatureCollection',
        features: coordinates.length < 2 ? [] : [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coordinates.map(({ longitude, latitude }) => [longitude, latitude]) },
            properties,
        }],
    };
}

export function buildDetourPointsGeoJson<T extends { id: string; position: DetourCoordinate }>(
    points: T[],
    getProperties: (point: T) => Record<string, unknown> = (point) => ({ id: point.id }),
): DetourFeatureCollection {
    return {
        type: 'FeatureCollection',
        features: points.map((point) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.position.longitude, point.position.latitude] },
            properties: getProperties(point),
        })),
    };
}
