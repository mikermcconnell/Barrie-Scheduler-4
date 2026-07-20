import { snapRoutePlanner2WaypointsToRoad } from '../route-planner-2/routePlanner2RoadSnap';
import type { DetourCoordinate } from './detourGeometry';

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
    return {
        geometry: result.coordinates.map(([longitude, latitude]) => ({ longitude, latitude })),
        source: manual ? 'manual' : 'mapbox',
        requiresAcknowledgement: manual,
        warning: manual
            ? 'Road snapping was unavailable. Review this manual line for bus suitability and acknowledge it before export.'
            : undefined,
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
    };
}
