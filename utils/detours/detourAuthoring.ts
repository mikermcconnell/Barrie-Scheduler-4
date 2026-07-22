import { snapRoutePlanner2WaypointsToRoad } from '../route-planner-2/routePlanner2RoadSnap';
import { findNearestRouteAnchor, splitDetourRoute, type DetourCoordinate } from './detourGeometry';
import type { DetourRouteOverlay } from './detourTypes';

export interface DetourWaypoint extends DetourCoordinate {
    id: string;
}

export interface DetourSnapResult {
    geometry: DetourCoordinate[];
    source: 'mapbox' | 'manual';
    requiresAcknowledgement: boolean;
    warning?: string;
    distanceMeters?: number;
    durationSeconds?: number;
    roadLabels?: Array<{ name: string; geometry: DetourCoordinate[] }>;
}

export interface InsertDetourControlPointResult {
    waypoints: DetourCoordinate[];
    index: number;
    coordinate: DetourCoordinate;
}

export interface EditDetourGeometryAnchorsResult {
    anchors: DetourCoordinate[];
    geometry: DetourCoordinate[];
    anchorIndex: number;
}

function coordinatesAreNear(first: DetourCoordinate, second: DetourCoordinate, thresholdMetres = 8): boolean {
    const latitudeMetres = (first.latitude - second.latitude) * 111_320;
    const meanLatitudeRadians = ((first.latitude + second.latitude) / 2) * Math.PI / 180;
    const longitudeMetres = (first.longitude - second.longitude) * 111_320 * Math.cos(meanLatitudeRadians);
    return Math.hypot(latitudeMetres, longitudeMetres) <= thresholdMetres;
}

function lineWithExactEndpoints(
    coordinates: DetourCoordinate[],
    start: DetourCoordinate,
    end: DetourCoordinate,
): DetourCoordinate[] {
    if (coordinates.length < 2) return [{ ...start }, { ...end }];
    return coordinates.map((coordinate, index) => index === 0
        ? { ...start }
        : index === coordinates.length - 1
            ? { ...end }
            : { ...coordinate });
}

/** Ensures the active route split, closed section, and replacement path share exact junction coordinates. */
export function normalizeDetourOverlayJunctions(overlay: DetourRouteOverlay): DetourRouteOverlay {
    const { closureStart, closureEnd } = overlay;
    if (!closureStart || !closureEnd) return overlay;
    const start = closureStart.coordinate;
    const end = closureEnd.coordinate;
    const split = splitDetourRoute(
        overlay.routeSnapshot.originalGeometry,
        closureStart,
        closureEnd,
        overlay.routeSnapshot.isLoop,
    );
    const closureCoordinates = overlay.closureGeometry.coordinates.length >= 2
        ? lineWithExactEndpoints(overlay.closureGeometry.coordinates, start, end)
        : split?.bypassed ?? [{ ...start }, { ...end }];
    return {
        ...overlay,
        closureGeometry: { ...overlay.closureGeometry, coordinates: closureCoordinates },
        detourWaypoints: lineWithExactEndpoints(overlay.detourWaypoints, start, end),
        detourGeometry: {
            ...overlay.detourGeometry,
            coordinates: lineWithExactEndpoints(overlay.detourGeometry.coordinates, start, end),
        },
    };
}

/** Inserts a clicked line point between the surrounding planner controls, preserving path order. */
export function insertDetourControlPointOnLine(
    waypoints: DetourCoordinate[],
    geometry: DetourCoordinate[],
    clickedCoordinate: DetourCoordinate,
): InsertDetourControlPointResult | null {
    if (waypoints.length < 2 || geometry.length < 2) return null;
    const clickedAnchor = findNearestRouteAnchor(geometry, clickedCoordinate);
    if (!clickedAnchor) return null;
    const clickedPosition = clickedAnchor.segmentIndex + clickedAnchor.fraction;
    const controlPositions = waypoints.map((waypoint) => {
        const anchor = findNearestRouteAnchor(geometry, waypoint);
        return anchor ? anchor.segmentIndex + anchor.fraction : Number.POSITIVE_INFINITY;
    });
    const firstLaterControl = controlPositions.findIndex((position, index) => index > 0 && position > clickedPosition);
    const index = Math.max(1, Math.min(
        firstLaterControl < 0 ? waypoints.length - 1 : firstLaterControl,
        waypoints.length - 1,
    ));
    const coordinate = clickedAnchor.coordinate;
    const duplicate = waypoints.some(waypoint => coordinatesAreNear(waypoint, coordinate));
    if (duplicate) return null;
    return {
        waypoints: [
            ...waypoints.slice(0, index),
            coordinate,
            ...waypoints.slice(index),
        ],
        index,
        coordinate,
    };
}

/** Adds a sparse editable anchor while retaining the existing dense line geometry. */
export function insertDetourGeometryAnchor(
    anchors: DetourCoordinate[],
    geometry: DetourCoordinate[],
    clickedCoordinate: DetourCoordinate,
): EditDetourGeometryAnchorsResult | null {
    if (geometry.length < 2) return null;
    const clickedAnchor = findNearestRouteAnchor(geometry, clickedCoordinate);
    if (!clickedAnchor) return null;
    const coordinate = clickedAnchor.coordinate;
    const endpoints = [geometry[0], geometry.at(-1)].filter((point): point is DetourCoordinate => Boolean(point));
    const duplicate = [...anchors, ...endpoints].some(anchor => coordinatesAreNear(anchor, coordinate));
    if (duplicate) return null;
    const clickedPosition = clickedAnchor.segmentIndex + clickedAnchor.fraction;
    const firstLaterAnchor = anchors.findIndex((anchor) => {
        const position = findNearestRouteAnchor(geometry, anchor);
        return position ? position.segmentIndex + position.fraction > clickedPosition : false;
    });
    const anchorIndex = firstLaterAnchor < 0 ? anchors.length : firstLaterAnchor;
    const geometryIndex = clickedAnchor.segmentIndex + 1;
    return {
        anchors: [...anchors.slice(0, anchorIndex), coordinate, ...anchors.slice(anchorIndex)],
        geometry: [...geometry.slice(0, geometryIndex), coordinate, ...geometry.slice(geometryIndex)],
        anchorIndex,
    };
}

export function moveDetourGeometryAnchor(
    anchors: DetourCoordinate[],
    geometry: DetourCoordinate[],
    anchorIndex: number,
    coordinate: DetourCoordinate,
): EditDetourGeometryAnchorsResult | null {
    const current = anchors[anchorIndex];
    if (!current) return null;
    const geometryIndices = anchors.map((anchor) => {
        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        geometry.forEach((point, index) => {
            const distance = (point.latitude - anchor.latitude) ** 2 + (point.longitude - anchor.longitude) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });
        return bestIndex;
    });
    const geometryIndex = geometryIndices[anchorIndex] ?? -1;
    if (geometryIndex < 0) return null;
    const previousIndex = anchorIndex > 0 ? geometryIndices[anchorIndex - 1]! : 0;
    const nextIndex = anchorIndex < anchors.length - 1 ? geometryIndices[anchorIndex + 1]! : geometry.length - 1;
    const longitudeDelta = coordinate.longitude - current.longitude;
    const latitudeDelta = coordinate.latitude - current.latitude;
    const nextGeometry = geometry.map((point, index) => {
        if (index < previousIndex || index > nextIndex) return point;
        const weight = index <= geometryIndex
            ? (geometryIndex === previousIndex ? 1 : (index - previousIndex) / (geometryIndex - previousIndex))
            : (nextIndex === geometryIndex ? 1 : (nextIndex - index) / (nextIndex - geometryIndex));
        return {
            longitude: point.longitude + longitudeDelta * weight,
            latitude: point.latitude + latitudeDelta * weight,
        };
    });
    return {
        anchors: moveDetourControlPoint(anchors, anchorIndex, coordinate),
        geometry: nextGeometry,
        anchorIndex,
    };
}

export function deleteDetourGeometryAnchor(
    anchors: DetourCoordinate[],
    geometry: DetourCoordinate[],
    anchorIndex: number,
): Omit<EditDetourGeometryAnchorsResult, 'anchorIndex'> | null {
    const current = anchors[anchorIndex];
    if (!current) return null;
    let geometryIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    geometry.forEach((point, index) => {
        const distance = (point.latitude - current.latitude) ** 2 + (point.longitude - current.longitude) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            geometryIndex = index;
        }
    });
    if (geometryIndex <= 0 || geometryIndex >= geometry.length - 1) return null;
    return {
        anchors: deleteDetourControlPoint(anchors, anchorIndex),
        geometry: deleteDetourControlPoint(geometry, geometryIndex),
    };
}

/** Adds a planner control point without treating dense snapped vertices as editable handles. */
export function addDetourControlPoint(
    waypoints: DetourCoordinate[],
    coordinate: DetourCoordinate,
    insertAfterIndex = waypoints.length - 1,
): DetourCoordinate[] {
    const insertionIndex = Math.max(0, Math.min(insertAfterIndex + 1, waypoints.length));
    return [
        ...waypoints.slice(0, insertionIndex),
        { ...coordinate },
        ...waypoints.slice(insertionIndex),
    ];
}

export function moveDetourControlPoint(
    waypoints: DetourCoordinate[],
    index: number,
    coordinate: DetourCoordinate,
): DetourCoordinate[] {
    const current = waypoints[index];
    if (!current || (current.latitude === coordinate.latitude && current.longitude === coordinate.longitude)) return waypoints;
    return waypoints.map((waypoint, waypointIndex) => waypointIndex === index ? { ...coordinate } : waypoint);
}

export function deleteDetourControlPoint(waypoints: DetourCoordinate[], index: number): DetourCoordinate[] {
    if (index < 0 || index >= waypoints.length) return waypoints;
    return waypoints.filter((_, waypointIndex) => waypointIndex !== index);
}

export function addDetourWaypoint(
    waypoints: DetourWaypoint[],
    waypoint: DetourWaypoint,
    insertAfterId?: string,
): DetourWaypoint[] {
    if (waypoints.some(({ id }) => id === waypoint.id)) return waypoints;
    if (!insertAfterId) return [...waypoints, { ...waypoint }];
    const index = waypoints.findIndex(({ id }) => id === insertAfterId);
    if (index < 0) return [...waypoints, { ...waypoint }];
    return [...waypoints.slice(0, index + 1), { ...waypoint }, ...waypoints.slice(index + 1)];
}

export function moveDetourWaypoint(
    waypoints: DetourWaypoint[],
    waypointId: string,
    coordinate: DetourCoordinate,
): DetourWaypoint[] {
    let changed = false;
    const next = waypoints.map((waypoint) => {
        if (waypoint.id !== waypointId || (
            waypoint.latitude === coordinate.latitude && waypoint.longitude === coordinate.longitude
        )) return waypoint;
        changed = true;
        return { ...waypoint, ...coordinate };
    });
    return changed ? next : waypoints;
}

export function deleteDetourWaypoint(waypoints: DetourWaypoint[], waypointId: string): DetourWaypoint[] {
    if (!waypoints.some(({ id }) => id === waypointId)) return waypoints;
    return waypoints.filter(({ id }) => id !== waypointId);
}

export function moveDetourMapItem<T extends { id: string; position: DetourCoordinate }>(
    items: T[],
    itemId: string,
    coordinate: DetourCoordinate,
): T[] {
    let changed = false;
    const next = items.map((item) => {
        if (item.id !== itemId || (
            item.position.latitude === coordinate.latitude && item.position.longitude === coordinate.longitude
        )) return item;
        changed = true;
        return { ...item, position: { ...coordinate } };
    });
    return changed ? next : items;
}

/** Thin detour-specific adapter around the already tested Route Planner 2 road service. */
export async function snapDetourWaypointsToRoad(
    waypoints: DetourCoordinate[],
    options: { token?: string | null; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<DetourSnapResult> {
    const result = await snapRoutePlanner2WaypointsToRoad(
        waypoints.map(({ longitude, latitude }) => [longitude, latitude]),
        options,
    );
    const manual = result.source !== 'mapbox';
    const geometry = result.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }));
    const exactGeometry = waypoints.length >= 2
        ? lineWithExactEndpoints(geometry, waypoints[0]!, waypoints.at(-1)!)
        : geometry;
    return {
        geometry: exactGeometry,
        source: manual ? 'manual' : 'mapbox',
        requiresAcknowledgement: manual,
        warning: manual
            ? 'Road snapping was unavailable. Review this manual line for bus suitability and acknowledge it before export.'
            : undefined,
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
        roadLabels: result.roadLabels?.map(label => ({
            name: label.name,
            geometry: label.coordinates.map(([longitude, latitude]) => ({ longitude, latitude })),
        })),
    };
}
