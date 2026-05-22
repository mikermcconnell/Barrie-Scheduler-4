export type RoutePlanner2MapSelectionMode = 'box' | 'lasso';

export interface RoutePlanner2SelectionPoint {
    x: number;
    y: number;
}

export interface RoutePlanner2SelectableMapItem {
    id: string;
    type: 'stop' | 'waypoint';
    point: RoutePlanner2SelectionPoint;
}

export interface RoutePlanner2MapSelection {
    stopIds: string[];
    waypointIds: string[];
}

const EMPTY_SELECTION: RoutePlanner2MapSelection = { stopIds: [], waypointIds: [] };

function toSelection(items: RoutePlanner2SelectableMapItem[]): RoutePlanner2MapSelection {
    return {
        stopIds: items.filter((item) => item.type === 'stop').map((item) => item.id),
        waypointIds: items.filter((item) => item.type === 'waypoint').map((item) => item.id),
    };
}

export function selectRoutePlanner2ItemsInBox(
    items: RoutePlanner2SelectableMapItem[],
    start: RoutePlanner2SelectionPoint,
    end: RoutePlanner2SelectionPoint,
): RoutePlanner2MapSelection {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    return toSelection(items.filter(({ point }) =>
        point.x >= minX
        && point.x <= maxX
        && point.y >= minY
        && point.y <= maxY,
    ));
}

function isPointInPolygon(point: RoutePlanner2SelectionPoint, polygon: RoutePlanner2SelectionPoint[]): boolean {
    let inside = false;

    for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
        const current = polygon[index]!;
        const previous = polygon[previousIndex]!;
        const crossesY = current.y > point.y !== previous.y > point.y;
        if (!crossesY) continue;

        const intersectionX = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
        if (point.x < intersectionX) inside = !inside;
    }

    return inside;
}

export function selectRoutePlanner2ItemsInLasso(
    items: RoutePlanner2SelectableMapItem[],
    points: RoutePlanner2SelectionPoint[],
): RoutePlanner2MapSelection {
    if (points.length < 3) return EMPTY_SELECTION;
    return toSelection(items.filter((item) => isPointInPolygon(item.point, points)));
}
