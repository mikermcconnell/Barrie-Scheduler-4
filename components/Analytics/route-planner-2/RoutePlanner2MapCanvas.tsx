import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Loader2, MapPin, Plus, Search, Trash2 } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';

import { MapBase } from '../../shared';
import {
    buildRoutePlanner2FallbackRoadSnapResult,
    snapRoutePlanner2ScenarioToRoad,
    type RoutePlanner2RoadSnapProgress,
} from '../../../utils/route-planner-2/routePlanner2RoadSnap';
import {
    searchRoutePlanner2Addresses,
    type RoutePlanner2AddressSuggestion,
} from '../../../utils/route-planner-2/routePlanner2AddressSearch';
import {
    buildRoutePlanner2StopSegmentPairs,
    buildRoutePlanner2StopSegmentPaths,
    buildRoutePlanner2StopVisitSequence,
} from '../../../utils/route-planner-2/routePlanner2Segments';
import type { RoutePlanner2RoutePoint, RoutePlanner2RouteShape, RoutePlanner2Scenario, RoutePlanner2SegmentRuntime, RoutePlanner2Stop } from '../../../utils/route-planner-2/routePlanner2Types';

const ROUTE_LINE_LAYER_ID = 'route-planner-2-line';
const ROUTE_LINE_HIT_LAYER_ID = 'route-planner-2-line-hit';
const ROUTE_DIRECTION_ARROW_SOURCE_ID = 'route-planner-2-direction-arrows';
const ROUTE_DIRECTION_ARROW_CENTER_LAYER_ID = 'route-planner-2-direction-arrows-center';
const ROUTE_DIRECTION_ARROW_OUTBOUND_LAYER_ID = 'route-planner-2-direction-arrows-outbound';
const ROUTE_DIRECTION_ARROW_RETURN_LAYER_ID = 'route-planner-2-direction-arrows-return';
const ROUTE_RUNTIME_SOURCE_SOURCE_ID = 'route-planner-2-runtime-source-overlay';
const ROUTE_RUNTIME_SOURCE_LAYER_ID = 'route-planner-2-runtime-source-line';

interface RoutePlanner2MapCanvasProps {
    scenario: RoutePlanner2Scenario | null | undefined;
    selectedStopId: string | null;
    onSelectStop: (stopId: string) => void;
    onAddStop: (coordinate: { lat: number; lng: number; name?: string }) => void;
    onDeleteStop: (stopId: string) => void;
    onMoveStop: (stopId: string, coordinate: { lat: number; lng: number }) => void;
    onAddLineWaypoint: (placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        coordinate: { lat: number; lng: number };
    }) => void;
    onInsertStopOnLine: (placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        coordinate: { lat: number; lng: number };
    }) => void;
    onMoveLineWaypoint: (waypointId: string, coordinate: { lat: number; lng: number }) => void;
    onDeleteLineWaypoint: (waypointId: string) => void;
    onSegmentRuntimeEstimates: (estimates: RoutePlanner2SegmentRuntime[]) => void;
    onRouteShapeChange: (routeShape: RoutePlanner2RouteShape, turnaroundStopId?: string) => void;
    onSetTurnaroundStop: (stopId: string) => void;
    onAddNextStop?: () => void;
    onEnterDrawFocus?: () => void;
    onOpenStopList?: () => void;
    focusMode?: boolean;
    metricItems?: Array<{ label: string; value: string; detail?: string; description?: string; onClick?: () => void }>;
    overlayInsets?: {
        left: string;
        right: string;
    };
}

interface RoutePlanner2SegmentGeometry {
    id: string;
    fromStopId: string;
    toStopId: string;
    coordinates: [number, number][];
}

interface PendingLineAction {
    fromStopId: string;
    toStopId: string;
    insertAfterWaypointId?: string;
    insertBeforeWaypointId?: string;
    coordinate: { lat: number; lng: number };
}

interface ActiveDragPreview {
    type: 'stop' | 'waypoint';
    id: string;
    coordinate: { lat: number; lng: number };
    committed?: boolean;
}

const DRAG_COMMIT_TOLERANCE = 0.000001;

const routeLineLayer: LayerProps = {
    id: ROUTE_LINE_LAYER_ID,
    type: 'line',
    paint: {
        'line-color': '#0891b2',
        'line-width': 5,
        'line-opacity': 0.86,
    },
    layout: {
        'line-cap': 'round',
        'line-join': 'round',
    },
};

const routeLineHitLayer: LayerProps = {
    id: ROUTE_LINE_HIT_LAYER_ID,
    type: 'line',
    paint: {
        'line-color': '#0891b2',
        'line-width': 22,
        'line-opacity': 0.01,
    },
    layout: {
        'line-cap': 'round',
        'line-join': 'round',
    },
};

const runtimeSourceLineLayer: LayerProps = {
    id: ROUTE_RUNTIME_SOURCE_LAYER_ID,
    type: 'line',
    paint: {
        'line-color': ['get', 'color'],
        'line-width': 8,
        'line-opacity': 0.9,
    },
    layout: {
        'line-cap': 'round',
        'line-join': 'round',
    },
};

const routeDirectionArrowCenterLayer: LayerProps = {
    id: ROUTE_DIRECTION_ARROW_CENTER_LAYER_ID,
    type: 'symbol',
    filter: ['==', ['get', 'lane'], 'center'],
    layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 54,
        'text-field': ['get', 'label'],
        'text-size': 24,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-keep-upright': false,
    },
    paint: {
        'text-color': '#0e7490',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
    },
};

const routeDirectionArrowOutboundLayer: LayerProps = {
    ...routeDirectionArrowCenterLayer,
    id: ROUTE_DIRECTION_ARROW_OUTBOUND_LAYER_ID,
    filter: ['==', ['get', 'lane'], 'outbound'],
    layout: {
        ...routeDirectionArrowCenterLayer.layout,
        'text-offset': [0, -0.9],
    },
    paint: {
        'text-color': '#0891b2',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
    },
};

const routeDirectionArrowReturnLayer: LayerProps = {
    ...routeDirectionArrowCenterLayer,
    id: ROUTE_DIRECTION_ARROW_RETURN_LAYER_ID,
    filter: ['==', ['get', 'lane'], 'return'],
    layout: {
        ...routeDirectionArrowCenterLayer.layout,
        'text-offset': [0, 0.9],
    },
    paint: {
        'text-color': '#4f46e5',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
    },
};

function getStopMarkerClass(stop: RoutePlanner2Stop, isSelected: boolean): string {
    const roleClass = stop.role === 'start-terminal'
        ? 'bg-emerald-600'
        : stop.role === 'end-terminal'
            ? 'bg-rose-600'
            : stop.role === 'turnaround'
                ? 'bg-amber-600'
                : stop.role === 'timed'
                    ? 'bg-indigo-600'
                    : 'bg-cyan-600';
    return `flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-2 text-[10px] font-black text-white shadow-lg ${roleClass} ${isSelected ? 'scale-110 border-slate-950' : 'border-white'}`;
}

type RuntimeSourceOverlayItem = {
    id: string;
    source: RoutePlanner2SegmentRuntime['source'];
    label: string;
    color: string;
    labelCoordinate: { lat: number; lng: number };
    segmentName: string;
};

const runtimeSourceColors: Record<RoutePlanner2SegmentRuntime['source'], string> = {
    'scheduled-proxy': '#059669',
    'partial-scheduled-proxy': '#65a30d',
    'observed-proxy': '#2563eb',
    'observed-scheduled-blend': '#0f766e',
    mapbox: '#0891b2',
    manual: '#4f46e5',
    fallback: '#d97706',
    missing: '#64748b',
};

const runtimeSourceDotClasses: Record<RoutePlanner2SegmentRuntime['source'], string> = {
    'scheduled-proxy': 'bg-emerald-600',
    'partial-scheduled-proxy': 'bg-lime-600',
    'observed-proxy': 'bg-blue-600',
    'observed-scheduled-blend': 'bg-teal-700',
    mapbox: 'bg-cyan-600',
    manual: 'bg-indigo-600',
    fallback: 'bg-amber-600',
    missing: 'bg-slate-500',
};

function getRuntimeSourceOverlayLabel(source: RoutePlanner2SegmentRuntime['source'], evidenceMethod?: RoutePlanner2SegmentRuntime['evidenceMethod']): string {
    if (source === 'scheduled-proxy') return evidenceMethod === 'shape-overlap' ? 'GTFS shape match' : 'Scheduled GTFS';
    if (source === 'partial-scheduled-proxy') return 'Partial GTFS + estimate';
    if (source === 'observed-proxy') return 'Observed';
    if (source === 'observed-scheduled-blend') return 'Observed + schedule';
    if (source === 'mapbox') return 'Mapbox';
    if (source === 'manual') return 'Planner override';
    if (source === 'fallback') return 'Fallback';
    return 'Missing';
}

function getRuntimeSourceOverlayRuntime(
    estimates: RoutePlanner2SegmentRuntime[],
    geometry: RoutePlanner2SegmentGeometry,
): RoutePlanner2SegmentRuntime | undefined {
    return estimates.find((estimate) => estimate.id === geometry.id)
        ?? estimates.find((estimate) => estimate.fromStopId === geometry.fromStopId && estimate.toStopId === geometry.toStopId);
}

function getCoordinateDistance(first: [number, number], second: [number, number]): number {
    const latScale = 111.32;
    const avgLat = ((first[1] + second[1]) / 2) * Math.PI / 180;
    const lngScale = Math.cos(avgLat) * 111.32;
    return Math.hypot((second[0] - first[0]) * lngScale, (second[1] - first[1]) * latScale);
}

function getLineMidpointCoordinate(coordinates: [number, number][]): { lat: number; lng: number } {
    if (coordinates.length === 0) return { lat: 0, lng: 0 };
    if (coordinates.length === 1) return { lng: coordinates[0]![0], lat: coordinates[0]![1] };

    const segmentDistances = coordinates.slice(1).map((coordinate, index) => getCoordinateDistance(coordinates[index]!, coordinate));
    const totalDistance = segmentDistances.reduce((sum, distance) => sum + distance, 0);
    if (totalDistance <= 0) {
        const middle = coordinates[Math.floor(coordinates.length / 2)]!;
        return { lng: middle[0], lat: middle[1] };
    }

    let distanceSoFar = 0;
    const halfDistance = totalDistance / 2;
    for (let index = 0; index < segmentDistances.length; index += 1) {
        const distance = segmentDistances[index]!;
        if (distanceSoFar + distance >= halfDistance) {
            const from = coordinates[index]!;
            const to = coordinates[index + 1]!;
            const ratio = distance === 0 ? 0 : (halfDistance - distanceSoFar) / distance;
            return {
                lng: from[0] + ((to[0] - from[0]) * ratio),
                lat: from[1] + ((to[1] - from[1]) * ratio),
            };
        }
        distanceSoFar += distance;
    }

    const last = coordinates[coordinates.length - 1]!;
    return { lng: last[0], lat: last[1] };
}

interface RouteLineAnchorHandle {
    id: string;
    lat: number;
    lng: number;
}

type RoutePathPoint =
    | { type: 'stop'; id: string; lat: number; lng: number }
    | { type: 'waypoint'; id: string; lat: number; lng: number };

function buildLineGeoJson(coordinates: [number, number][]) {
    return {
        type: 'FeatureCollection' as const,
        features: coordinates.length >= 2
            ? [{
                type: 'Feature' as const,
                properties: {},
                geometry: {
                    type: 'LineString' as const,
                    coordinates,
                },
            }]
            : [],
    };
}

function buildRuntimeSourceGeoJson(segments: Array<RuntimeSourceOverlayItem & { coordinates: [number, number][] }>) {
    return {
        type: 'FeatureCollection' as const,
        features: segments.filter((segment) => segment.coordinates.length >= 2).map((segment) => ({
            type: 'Feature' as const,
            properties: {
                id: segment.id,
                source: segment.source,
                label: segment.label,
                color: segment.color,
            },
            geometry: {
                type: 'LineString' as const,
                coordinates: segment.coordinates,
            },
        })),
    };
}

function getDirectionPairKey(fromStopId: string, toStopId: string): string {
    return [fromStopId, toStopId].sort().join('::');
}

export function buildRoutePlanner2DirectionArrowGeoJson(
    scenario: RoutePlanner2Scenario | null | undefined,
    segmentGeometries: RoutePlanner2SegmentGeometry[],
) {
    const fallbackGeometries = scenario
        ? buildRoutePlanner2StopSegmentPaths(scenario).map((segment) => ({
            id: segment.id,
            fromStopId: segment.fromStopId,
            toStopId: segment.toStopId,
            coordinates: segment.coordinates,
        }))
        : [];
    const geometries = segmentGeometries.length > 0 ? segmentGeometries : fallbackGeometries;
    const pairCounts = geometries.reduce<Record<string, number>>((counts, segment) => {
        const key = getDirectionPairKey(segment.fromStopId, segment.toStopId);
        return { ...counts, [key]: (counts[key] ?? 0) + 1 };
    }, {});

    return {
        type: 'FeatureCollection' as const,
        features: geometries
            .filter((segment) => segment.coordinates.length >= 2)
            .map((segment) => {
                const fromStop = scenario?.stops.find((stop) => stop.id === segment.fromStopId);
                const toStop = scenario?.stops.find((stop) => stop.id === segment.toStopId);
                const isTwoWay = (pairCounts[getDirectionPairKey(segment.fromStopId, segment.toStopId)] ?? 0) > 1;
                const lane = !isTwoWay
                    ? 'center'
                    : (fromStop?.sequence ?? 0) <= (toStop?.sequence ?? 0)
                        ? 'outbound'
                        : 'return';

                return {
                    type: 'Feature' as const,
                    properties: {
                        id: segment.id,
                        lane,
                        label: '➜',
                    },
                    geometry: {
                        type: 'LineString' as const,
                        coordinates: segment.coordinates,
                    },
                };
            }),
    };
}

function sortStops(stops: RoutePlanner2Stop[]): RoutePlanner2Stop[] {
    return [...stops].sort((a, b) => a.sequence - b.sequence);
}

function getLineAnchorForSegment(
    alignment: RoutePlanner2RoutePoint[],
    fromStopId: string,
    toStopId: string,
): RoutePlanner2RoutePoint[] {
    return [...alignment]
        .filter((point) => point.afterStopId === fromStopId && point.beforeStopId === toStopId)
        .sort((a, b) => (a.segmentSequence ?? a.sequence) - (b.segmentSequence ?? b.sequence));
}

function getRouteLineAnchorHandles(scenario: RoutePlanner2Scenario): RouteLineAnchorHandle[] {
    return scenario.alignment
        .filter((point) => point.afterStopId && point.beforeStopId)
        .map((point) => ({
            id: point.id,
            lat: point.lat,
            lng: point.lng,
        }));
}

function getRoutePathPointsForStopSegment(
    scenario: RoutePlanner2Scenario,
    fromStop: RoutePlanner2Stop,
    toStop: RoutePlanner2Stop,
): RoutePathPoint[] {
    const directAnchors = getLineAnchorForSegment(scenario.alignment, fromStop.id, toStop.id);
    const lineAnchors = directAnchors.length > 0
        ? directAnchors
        : getLineAnchorForSegment(scenario.alignment, toStop.id, fromStop.id).reverse();

    return [
        { type: 'stop', id: fromStop.id, lat: fromStop.lat, lng: fromStop.lng },
        ...lineAnchors.map((anchor): RoutePathPoint => ({
            type: 'waypoint',
            id: anchor.id,
            lat: anchor.lat,
            lng: anchor.lng,
        })),
        { type: 'stop', id: toStop.id, lat: toStop.lat, lng: toStop.lng },
    ];
}

function getScenarioWaypoints(scenario: RoutePlanner2Scenario): [number, number][] {
    const segmentPairs = buildRoutePlanner2StopSegmentPairs(scenario);

    if (segmentPairs.length > 0) {
        const waypoints: [number, number][] = [];

        segmentPairs.forEach(({ fromStop, toStop }, index) => {
            if (index === 0) waypoints.push([fromStop.lng, fromStop.lat]);
            const directAnchors = getLineAnchorForSegment(scenario.alignment, fromStop.id, toStop.id);
            const anchors = directAnchors.length > 0
                ? directAnchors
                : getLineAnchorForSegment(scenario.alignment, toStop.id, fromStop.id).reverse();
            anchors.forEach((anchor) => {
                waypoints.push([anchor.lng, anchor.lat]);
            });
            waypoints.push([toStop.lng, toStop.lat]);
        });

        return waypoints;
    }

    const routePointWaypoints = [...scenario.alignment]
        .sort((a, b) => a.sequence - b.sequence)
        .map((point): [number, number] => [point.lng, point.lat]);

    return routePointWaypoints;
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

function stitchSegmentGeometryCoordinates(segmentGeometries: RoutePlanner2SegmentGeometry[]): [number, number][] {
    const stitched: [number, number][] = [];

    segmentGeometries.forEach((geometry, index) => {
        if (geometry.coordinates.length === 0) return;
        if (index === 0) {
            stitched.push(...geometry.coordinates);
            return;
        }

        const [first, ...rest] = geometry.coordinates;
        if (!stitched.length || !coordinatesEqual(stitched[stitched.length - 1]!, first)) {
            stitched.push(first);
        }
        stitched.push(...rest);
    });

    return stitched;
}

function getScenarioRoadBuildKey(scenario: RoutePlanner2Scenario | null | undefined): string {
    if (!scenario) return 'none';
    return buildRoutePlanner2StopSegmentPaths(scenario)
        .map((segment) => `${segment.id}:${segment.pathFingerprint}`)
        .join('||');
}

function getDrawingGuide(scenario: RoutePlanner2Scenario | null | undefined): { title: string; body?: string; actionLabel: string } {
    const stopCount = scenario?.stops.length ?? 0;
    const hasStartTerminal = scenario?.stops.some((stop) => stop.role === 'start-terminal') ?? false;
    const hasEndTerminal = scenario?.stops.some((stop) => stop.role === 'end-terminal') ?? false;

    if (stopCount === 0) {
        return {
            title: 'Click the map to place Stop 1',
            actionLabel: 'Add Stop 1',
        };
    }

    if (stopCount === 1) {
        return {
            title: 'Add the next stop',
            body: 'Mark terminals after adding at least two stops.',
            actionLabel: 'Add next stop',
        };
    }

    if (scenario?.routeShape === 'closed-loop') {
        return {
            title: 'Closed loop route',
            body: `The route returns from Stop ${stopCount} to Stop 1. Click the line, then drag the + handle to shape it.`,
            actionLabel: `Add Stop ${stopCount + 1}`,
        };
    }

    if (scenario?.routeShape === 'out-and-back') {
        const turnaroundStop = scenario.stops.find((stop) => stop.id === scenario.turnaroundStopId)
            ?? null;
        return {
            title: turnaroundStop ? `Out and back to ${turnaroundStop.name}` : 'Out and back needs a bus turnaround',
            body: turnaroundStop
                ? 'The return trip is added only from the marked bus turnaround. Use a real loop, terminal, or safe turning location — not a U-turn or 3-point turn.'
                : 'Select the far end stop and mark it as the bus turnaround before using this route for feasibility.',
            actionLabel: `Add Stop ${stopCount + 1}`,
        };
    }

    if (!hasStartTerminal || !hasEndTerminal) {
        return {
            title: 'Mark start and end terminals',
            body: 'Click the line between stops, then drag the + handle to shape the route.',
            actionLabel: `Add Stop ${stopCount + 1}`,
        };
    }

    return {
        title: 'Review feasibility',
        body: 'Click the line between stops, then drag the + handle to shape the route.',
        actionLabel: `Add Stop ${stopCount + 1}`,
    };
}

function getDragCoordinate(event: MarkerDragEvent): { lat: number; lng: number } {
    return { lat: event.lngLat.lat, lng: event.lngLat.lng };
}

function coordinatesClose(
    first: { lat: number; lng: number },
    second: { lat: number; lng: number },
): boolean {
    return Math.abs(first.lat - second.lat) <= DRAG_COMMIT_TOLERANCE
        && Math.abs(first.lng - second.lng) <= DRAG_COMMIT_TOLERANCE;
}

function getProjectedCoordinate(coordinate: { lat: number; lng: number }, referenceLat: number): { x: number; y: number } {
    return {
        x: coordinate.lng * Math.cos(referenceLat * Math.PI / 180),
        y: coordinate.lat,
    };
}

function getDistanceToSegment(
    point: { lat: number; lng: number },
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
): number {
    const referenceLat = point.lat;
    const projectedPoint = getProjectedCoordinate(point, referenceLat);
    const projectedStart = getProjectedCoordinate(start, referenceLat);
    const projectedEnd = getProjectedCoordinate(end, referenceLat);
    const dx = projectedEnd.x - projectedStart.x;
    const dy = projectedEnd.y - projectedStart.y;

    if (dx === 0 && dy === 0) {
        return Math.hypot(projectedPoint.x - projectedStart.x, projectedPoint.y - projectedStart.y);
    }

    const t = Math.max(0, Math.min(1, (
        ((projectedPoint.x - projectedStart.x) * dx) + ((projectedPoint.y - projectedStart.y) * dy)
    ) / ((dx * dx) + (dy * dy))));
    const closest = {
        x: projectedStart.x + (t * dx),
        y: projectedStart.y + (t * dy),
    };

    return Math.hypot(projectedPoint.x - closest.x, projectedPoint.y - closest.y);
}

function getClosestRouteSegment(
    scenario: RoutePlanner2Scenario,
    coordinate: { lat: number; lng: number },
): {
    fromStopId: string;
    toStopId: string;
    insertAfterWaypointId?: string;
    insertBeforeWaypointId?: string;
} | null {
    let closestSegment: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
    } | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const { fromStop, toStop } of buildRoutePlanner2StopSegmentPairs(scenario)) {
        const points = getRoutePathPointsForStopSegment(scenario, fromStop, toStop);

        for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
            const start = points[pointIndex];
            const end = points[pointIndex + 1];
            if (!start || !end) continue;
            const distance = getDistanceToSegment(coordinate, start, end);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestSegment = {
                    fromStopId: fromStop.id,
                    toStopId: toStop.id,
                    insertAfterWaypointId: start.type === 'waypoint' ? start.id : undefined,
                    insertBeforeWaypointId: end.type === 'waypoint' ? end.id : undefined,
                };
            }
        }
    }

    return closestSegment;
}

function clickedRouteLine(event: MapMouseEvent): boolean {
    const features = 'features' in event && Array.isArray(event.features) ? event.features : [];
    return features.some((feature) => feature.layer?.id === ROUTE_LINE_HIT_LAYER_ID || feature.layer?.id === ROUTE_LINE_LAYER_ID);
}

export function RoutePlanner2MapCanvas({
    scenario,
    selectedStopId,
    onSelectStop,
    onAddStop,
    onDeleteStop,
    onMoveStop,
    onAddLineWaypoint,
    onInsertStopOnLine,
    onMoveLineWaypoint,
    onDeleteLineWaypoint,
    onSegmentRuntimeEstimates,
    onRouteShapeChange,
    onSetTurnaroundStop,
    onAddNextStop,
    onEnterDrawFocus,
    onOpenStopList,
    focusMode = false,
    metricItems = [],
    overlayInsets = { left: '8rem', right: '8rem' },
}: RoutePlanner2MapCanvasProps) {
    const [mapLoaded, setMapLoaded] = useState(false);
    const [snappedCoordinates, setSnappedCoordinates] = useState<[number, number][]>([]);
    const [snappedSegmentGeometries, setSnappedSegmentGeometries] = useState<RoutePlanner2SegmentGeometry[]>([]);
    const [roadBuildProgress, setRoadBuildProgress] = useState<RoutePlanner2RoadSnapProgress | null>(null);
    const [pendingLineAction, setPendingLineAction] = useState<PendingLineAction | null>(null);
    const [activeDragPreview, setActiveDragPreview] = useState<ActiveDragPreview | null>(null);
    const [showRuntimeSourceOverlay, setShowRuntimeSourceOverlay] = useState(false);
    const [addressQuery, setAddressQuery] = useState('');
    const [addressSuggestions, setAddressSuggestions] = useState<RoutePlanner2AddressSuggestion[]>([]);
    const [selectedAddress, setSelectedAddress] = useState<RoutePlanner2AddressSuggestion | null>(null);
    const [addressSearchLoading, setAddressSearchLoading] = useState(false);
    const [addressSearchError, setAddressSearchError] = useState<string | null>(null);
    const suppressMapClickUntilRef = useRef(0);

    const waypoints = useMemo(() => scenario ? getScenarioWaypoints(scenario) : [], [scenario]);
    const roadBuildKey = useMemo(() => getScenarioRoadBuildKey(scenario), [scenario]);
    const lineAnchorHandles = useMemo(() => scenario ? getRouteLineAnchorHandles(scenario) : [], [scenario]);
    const lineGeoJson = useMemo(() => buildLineGeoJson(snappedCoordinates.length ? snappedCoordinates : waypoints), [snappedCoordinates, waypoints]);
    const directionArrowGeoJson = useMemo(
        () => buildRoutePlanner2DirectionArrowGeoJson(scenario, snappedSegmentGeometries),
        [scenario, snappedSegmentGeometries],
    );
    const runtimeSourceOverlaySegments = useMemo(() => {
        if (!scenario) return [];

        const fallbackGeometries = buildRoutePlanner2StopSegmentPaths(scenario);
        const geometries = snappedSegmentGeometries.length > 0 ? snappedSegmentGeometries : fallbackGeometries;
        const estimates = scenario.feasibility?.segmentSummaries?.length
            ? scenario.feasibility.segmentSummaries
            : scenario.runtimeEstimates ?? [];

        return geometries.map((geometry) => {
            const runtime = getRuntimeSourceOverlayRuntime(estimates, geometry);
            const source = runtime?.source ?? 'missing';
            const fromStop = scenario.stops.find((stop) => stop.id === geometry.fromStopId);
            const toStop = scenario.stops.find((stop) => stop.id === geometry.toStopId);

            return {
                id: geometry.id,
                source,
                label: getRuntimeSourceOverlayLabel(source, runtime?.evidenceMethod),
                color: runtimeSourceColors[source],
                labelCoordinate: getLineMidpointCoordinate(geometry.coordinates),
                segmentName: `${fromStop?.sequence ?? '?'}→${toStop?.sequence ?? '?'}`,
                coordinates: geometry.coordinates,
            };
        });
    }, [scenario, snappedSegmentGeometries]);
    const runtimeSourceGeoJson = useMemo(
        () => buildRuntimeSourceGeoJson(runtimeSourceOverlaySegments),
        [runtimeSourceOverlaySegments],
    );
    const runtimeSourceLegendItems = useMemo(() => {
        const summary = new Map<RoutePlanner2SegmentRuntime['source'], { source: RoutePlanner2SegmentRuntime['source']; label: string; count: number }>();
        runtimeSourceOverlaySegments.forEach((segment) => {
            const existing = summary.get(segment.source);
            if (existing) {
                existing.count += 1;
                return;
            }
            summary.set(segment.source, { source: segment.source, label: segment.label, count: 1 });
        });
        return Array.from(summary.values());
    }, [runtimeSourceOverlaySegments]);
    const hasRouteLine = lineGeoJson.features.length > 0;
    const hasRuntimeSourceOverlay = runtimeSourceGeoJson.features.length > 0;
    const hasDirectionArrows = directionArrowGeoJson.features.length > 0;
    const drawingGuide = getDrawingGuide(scenario);
    const sortedStops = useMemo(() => scenario ? sortStops(scenario.stops) : [], [scenario]);
    const stopVisitSequence = useMemo(() => scenario ? buildRoutePlanner2StopVisitSequence(scenario) : [], [scenario]);
    const selectedStop = sortedStops.find((stop) => stop.id === selectedStopId) ?? null;
    const firstStop = sortedStops[0] ?? null;
    const lastStop = sortedStops[sortedStops.length - 1] ?? null;
    const routeShapeLabel = scenario?.routeShape === 'closed-loop'
        ? 'Closed loop'
        : scenario?.routeShape === 'out-and-back'
        ? 'Out and back'
        : 'One-way';
    useEffect(() => {
        setAddressQuery('');
        setAddressSuggestions([]);
        setSelectedAddress(null);
        setAddressSearchError(null);
    }, [scenario?.id]);

    useEffect(() => {
        const trimmedQuery = addressQuery.trim();
        if (trimmedQuery.length < 3) {
            setAddressSuggestions([]);
            setAddressSearchLoading(false);
            setAddressSearchError(null);
            return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            setAddressSearchLoading(true);
            setAddressSearchError(null);
            searchRoutePlanner2Addresses(trimmedQuery, { signal: controller.signal })
                .then((suggestions) => {
                    setAddressSuggestions(suggestions);
                    if (suggestions.length === 0) {
                        setAddressSearchError('No matching addresses found.');
                    }
                })
                .catch((error) => {
                    if (controller.signal.aborted) return;
                    console.error('Route Planner 2 address search failed', error);
                    setAddressSuggestions([]);
                    setAddressSearchError('Address search is unavailable.');
                })
                .finally(() => {
                    if (!controller.signal.aborted) setAddressSearchLoading(false);
                });
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [addressQuery]);

    useEffect(() => {
        if (!activeDragPreview?.committed || !scenario) return;
        const committedCoordinate = activeDragPreview.type === 'stop'
            ? scenario.stops.find((stop) => stop.id === activeDragPreview.id)
            : scenario.alignment.find((point) => point.id === activeDragPreview.id);
        if (committedCoordinate && coordinatesClose(committedCoordinate, activeDragPreview.coordinate)) {
            setActiveDragPreview(null);
        }
    }, [activeDragPreview, scenario]);

    useEffect(() => {
        const controller = new AbortController();

        if (!scenario) {
            setSnappedCoordinates([]);
            setSnappedSegmentGeometries([]);
            setRoadBuildProgress(null);
            return () => controller.abort();
        }

        if (activeDragPreview) {
            setRoadBuildProgress(null);
            return () => controller.abort();
        }

        const fallbackResult = buildRoutePlanner2FallbackRoadSnapResult(scenario);
        setSnappedCoordinates(fallbackResult.coordinates);
        setSnappedSegmentGeometries(fallbackResult.segmentGeometries);
        setRoadBuildProgress(fallbackResult.segmentGeometries.length > 0
            ? { totalSegments: fallbackResult.segmentGeometries.length, completedSegments: 0 }
            : null);

        snapRoutePlanner2ScenarioToRoad(scenario, {
            concurrency: 3,
            signal: controller.signal,
            onProgress: (progress) => {
                if (controller.signal.aborted) return;
                setRoadBuildProgress(progress);
                if (!progress.segmentGeometry) return;
                setSnappedSegmentGeometries((current) => {
                    const nextGeometries = current.map((geometry) =>
                        geometry.id === progress.segmentGeometry?.id ? progress.segmentGeometry : geometry,
                    );
                    setSnappedCoordinates(stitchSegmentGeometryCoordinates(nextGeometries));
                    return nextGeometries;
                });
            },
        }).then((result) => {
            if (controller.signal.aborted) return;
            setSnappedCoordinates(result.coordinates);
            setSnappedSegmentGeometries(result.segmentGeometries);
            setRoadBuildProgress(result.segmentGeometries.length > 0
                ? { totalSegments: result.segmentGeometries.length, completedSegments: result.segmentGeometries.length }
                : null);
            onSegmentRuntimeEstimates(result.segmentEstimates);
        }).catch((error) => {
            if (controller.signal.aborted) return;
            console.error('Route Planner 2 road snap failed', error);
            setRoadBuildProgress(null);
        });

        return () => controller.abort();
    }, [roadBuildKey, onSegmentRuntimeEstimates, activeDragPreview]);

    function handleMapClick(event: MapMouseEvent) {
        if (Date.now() < suppressMapClickUntilRef.current) return;
        if (!scenario) return;
        const coordinate = { lat: event.lngLat.lat, lng: event.lngLat.lng };

        if (clickedRouteLine(event) && scenario.stops.length >= 2) {
            const segment = getClosestRouteSegment(scenario, coordinate);
            if (segment) {
                setPendingLineAction({
                    fromStopId: segment.fromStopId,
                    toStopId: segment.toStopId,
                    insertAfterWaypointId: segment.insertAfterWaypointId,
                    insertBeforeWaypointId: segment.insertBeforeWaypointId,
                    coordinate,
                });
                return;
            }
        }

        setPendingLineAction(null);
        onAddStop(coordinate);
    }

    function addAnchorFromPendingAction() {
        if (!pendingLineAction) return;
        onAddLineWaypoint(pendingLineAction);
        setPendingLineAction(null);
    }

    function insertStopFromPendingAction() {
        if (!pendingLineAction) return;
        onInsertStopOnLine(pendingLineAction);
        setPendingLineAction(null);
    }

    function selectAddressSuggestion(suggestion: RoutePlanner2AddressSuggestion) {
        setSelectedAddress(suggestion);
        setAddressQuery(suggestion.label);
        setAddressSuggestions((current) => {
            const exists = current.some((item) => item.id === suggestion.id);
            return exists ? current : [suggestion, ...current];
        });
        setAddressSearchError(null);
    }

    function addSelectedAddressStop() {
        const suggestion = selectedAddress ?? addressSuggestions[0];
        if (!suggestion) return;

        onAddStop({
            lat: suggestion.lat,
            lng: suggestion.lng,
            name: suggestion.name,
        });
        setAddressQuery('');
        setAddressSuggestions([]);
        setSelectedAddress(null);
        setAddressSearchError(null);
    }

    function getPreviewCoordinate(type: ActiveDragPreview['type'], id: string, fallback: { lat: number; lng: number }) {
        return activeDragPreview?.type === type && activeDragPreview.id === id
            ? activeDragPreview.coordinate
            : fallback;
    }

    function startMarkerDrag(type: ActiveDragPreview['type'], id: string, coordinate: { lat: number; lng: number }) {
        suppressMapClickUntilRef.current = Date.now() + 500;
        setPendingLineAction(null);
        setActiveDragPreview({ type, id, coordinate });
    }

    function updateMarkerDrag(type: ActiveDragPreview['type'], id: string, coordinate: { lat: number; lng: number }) {
        setActiveDragPreview((current) => current?.type === type && current.id === id
            ? { ...current, coordinate, committed: false }
            : { type, id, coordinate });
    }

    function finishStopDrag(stopId: string, coordinate: { lat: number; lng: number }) {
        suppressMapClickUntilRef.current = Date.now() + 500;
        setActiveDragPreview({ type: 'stop', id: stopId, coordinate, committed: true });
        onMoveStop(stopId, coordinate);
    }

    function finishWaypointDrag(waypointId: string, coordinate: { lat: number; lng: number }) {
        suppressMapClickUntilRef.current = Date.now() + 500;
        setActiveDragPreview({ type: 'waypoint', id: waypointId, coordinate, committed: true });
        onMoveLineWaypoint(waypointId, coordinate);
    }

    const overlayStyle = {
        '--rp2-overlay-left': overlayInsets.left,
        '--rp2-overlay-right': overlayInsets.right,
    } as CSSProperties;

    return (
        <section
            data-testid="rp2-map-canvas"
            style={overlayStyle}
            className="h-full min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
        >
            <div className="relative h-full min-h-0">
                <MapBase
                    longitude={-79.69}
                    latitude={44.38}
                    zoom={12}
                    className="h-full"
                    mapStyle="mapbox://styles/mapbox/light-v11"
                    showNavigation
                    showScale
                    onLoad={() => setMapLoaded(true)}
                    interactiveLayerIds={[ROUTE_LINE_HIT_LAYER_ID]}
                    onClick={handleMapClick}
                >
                    {mapLoaded && hasRouteLine && (
                        <Source id="route-planner-2-line-source" type="geojson" data={lineGeoJson}>
                            <Layer {...routeLineLayer} />
                            <Layer {...routeLineHitLayer} />
                        </Source>
                    )}
                    {mapLoaded && showRuntimeSourceOverlay && hasRuntimeSourceOverlay && (
                        <Source id={ROUTE_RUNTIME_SOURCE_SOURCE_ID} type="geojson" data={runtimeSourceGeoJson}>
                            <Layer {...runtimeSourceLineLayer} />
                        </Source>
                    )}
                    {mapLoaded && hasDirectionArrows && (
                        <Source id={ROUTE_DIRECTION_ARROW_SOURCE_ID} type="geojson" data={directionArrowGeoJson}>
                            <Layer {...routeDirectionArrowCenterLayer} />
                            <Layer {...routeDirectionArrowOutboundLayer} />
                            <Layer {...routeDirectionArrowReturnLayer} />
                        </Source>
                    )}
                    {mapLoaded && showRuntimeSourceOverlay && runtimeSourceOverlaySegments.map((segment) => (
                        <Marker
                            key={`runtime-source-${segment.id}`}
                            longitude={segment.labelCoordinate.lng}
                            latitude={segment.labelCoordinate.lat}
                            anchor="center"
                            style={{ pointerEvents: 'none' }}
                        >
                            <div
                                className="pointer-events-none rounded-full border border-white bg-white/95 px-2.5 py-1 text-[11px] font-black text-slate-800 shadow-lg"
                                title={`${segment.segmentName}: ${segment.label}`}
                            >
                                {segment.segmentName} · {segment.label}
                            </div>
                        </Marker>
                    ))}
                    {mapLoaded && lineAnchorHandles.map((handle) => {
                        const coordinate = getPreviewCoordinate('waypoint', handle.id, handle);
                        const isDragging = activeDragPreview?.type === 'waypoint' && activeDragPreview.id === handle.id;
                        return (
                        <Marker
                            key={handle.id}
                            longitude={coordinate.lng}
                            latitude={coordinate.lat}
                            anchor="center"
                            draggable
                            onDragStart={(event) => startMarkerDrag('waypoint', handle.id, getDragCoordinate(event))}
                            onDrag={(event) => updateMarkerDrag('waypoint', handle.id, getDragCoordinate(event))}
                            onDragEnd={(event) => finishWaypointDrag(handle.id, getDragCoordinate(event))}
                        >
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={(event) => event.stopPropagation()}
                                    className={`flex h-7 w-7 cursor-grab items-center justify-center rounded-full border-2 border-cyan-700 bg-white text-xs font-black text-cyan-700 shadow-lg ${isDragging ? 'scale-110 cursor-grabbing ring-4 ring-cyan-100' : ''}`}
                                    aria-label="Drag route line anchor"
                                    title="Drag to bend this route segment"
                                >
                                    +
                                </button>
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onDeleteLineWaypoint(handle.id);
                                    }}
                                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 shadow-md hover:bg-red-50"
                                    aria-label="Delete route line anchor"
                                    title="Delete route line anchor"
                                >
                                    <Trash2 size={11} />
                                </button>
                            </div>
                        </Marker>
                        );
                    })}
                    {mapLoaded && pendingLineAction && (
                        <Marker
                            longitude={pendingLineAction.coordinate.lng}
                            latitude={pendingLineAction.coordinate.lat}
                            anchor="bottom"
                        >
                            <div
                                className="w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="px-1 text-[10px] font-black uppercase tracking-wide text-slate-500">Route line</div>
                                <div className="mt-2 grid gap-2">
                                    <button
                                        type="button"
                                        onClick={insertStopFromPendingAction}
                                        className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-black text-white hover:bg-cyan-700"
                                    >
                                        Add stop here
                                    </button>
                                    <button
                                        type="button"
                                        onClick={addAnchorFromPendingAction}
                                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                    >
                                        Add bend anchor
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPendingLineAction(null)}
                                        className="rounded-xl px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </Marker>
                    )}
                    {mapLoaded && scenario?.stops.map((stop) => {
                        const coordinate = getPreviewCoordinate('stop', stop.id, stop);
                        const isDragging = activeDragPreview?.type === 'stop' && activeDragPreview.id === stop.id;
                        return (
                        <Marker
                            key={stop.id}
                            longitude={coordinate.lng}
                            latitude={coordinate.lat}
                            anchor="center"
                            draggable
                            onDragStart={(event) => {
                                onSelectStop(stop.id);
                                startMarkerDrag('stop', stop.id, getDragCoordinate(event));
                            }}
                            onDrag={(event) => updateMarkerDrag('stop', stop.id, getDragCoordinate(event))}
                            onDragEnd={(event) => finishStopDrag(stop.id, getDragCoordinate(event))}
                        >
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectStop(stop.id);
                                }}
                                className={`${getStopMarkerClass(stop, selectedStopId === stop.id)} cursor-grab ${isDragging ? 'scale-110 cursor-grabbing ring-4 ring-cyan-100' : ''}`}
                                aria-label={`Select ${stop.name}`}
                            >
                                {stop.sequence}
                            </button>
                        </Marker>
                        );
                    })}
                </MapBase>

                {scenario && (
                    <div
                        className="absolute top-6 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg"
                        style={{ right: 'var(--rp2-overlay-right)' }}
                    >
                        <div className="mb-1 px-1 text-[10px] font-black uppercase tracking-wide text-slate-500">View</div>
                        <button
                            type="button"
                            onClick={() => setShowRuntimeSourceOverlay((current) => !current)}
                            disabled={runtimeSourceOverlaySegments.length === 0}
                            data-testid="rp2-runtime-source-overlay-toggle"
                            aria-pressed={showRuntimeSourceOverlay}
                            className={`rounded-xl border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${showRuntimeSourceOverlay ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                        >
                            {showRuntimeSourceOverlay ? 'Hide source overlay' : 'Show source overlay'}
                        </button>
                        {showRuntimeSourceOverlay && runtimeSourceLegendItems.length > 0 && (
                            <div data-testid="rp2-runtime-source-overlay-legend" className="mt-3 border-t border-slate-100 pt-2">
                                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Runtime sources</div>
                                <div className="mt-2 space-y-1">
                                    {runtimeSourceLegendItems.map((item) => (
                                        <div key={item.source} className="flex items-center justify-between gap-3 text-xs font-bold text-slate-700">
                                            <span className="inline-flex items-center gap-2">
                                                <span className={`h-2.5 w-2.5 rounded-full ${runtimeSourceDotClasses[item.source]}`} />
                                                {item.label}
                                            </span>
                                            <span className="text-slate-500">{item.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {roadBuildProgress && roadBuildProgress.totalSegments > 0 && roadBuildProgress.completedSegments < roadBuildProgress.totalSegments && (
                    <div
                        className="absolute top-24 w-72 rounded-2xl border border-cyan-100 bg-white/95 p-3 shadow-lg"
                        style={{ right: 'var(--rp2-overlay-right)' }}
                        data-testid="rp2-road-build-progress"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-black uppercase tracking-wide text-cyan-700">Building route</div>
                                <div className="mt-1 text-sm font-bold text-slate-700">
                                    Calculating road path {roadBuildProgress.completedSegments} of {roadBuildProgress.totalSegments}
                                </div>
                            </div>
                            <Loader2 size={18} className="shrink-0 animate-spin text-cyan-600" />
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div
                                className="h-full rounded-full bg-cyan-500 transition-all"
                                style={{ width: `${Math.round((roadBuildProgress.completedSegments / roadBuildProgress.totalSegments) * 100)}%` }}
                            />
                        </div>
                    </div>
                )}

                <div
                    className="absolute top-6 max-w-sm rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg"
                    style={{ left: 'var(--rp2-overlay-left)' }}
                >
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-black uppercase tracking-wide text-cyan-700">Draw route</div>
                            <div className="mt-1 text-base font-black leading-5 text-slate-900">{drawingGuide.title}</div>
                        </div>
                        <button
                            type="button"
                            onClick={onEnterDrawFocus}
                            className="shrink-0 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-700 hover:bg-cyan-100"
                        >
                            Draw route
                        </button>
                    </div>
                    {drawingGuide.body && (
                        <p className="mt-2 text-sm leading-5 text-slate-600">{drawingGuide.body}</p>
                    )}
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-2">
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500" htmlFor="rp2-address-search">
                            Add stop by address
                        </label>
                        <div className="mt-2 flex gap-2">
                            <div className="relative min-w-0 flex-1">
                                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    id="rp2-address-search"
                                    type="text"
                                    value={addressQuery}
                                    onChange={(event) => {
                                        setSelectedAddress(null);
                                        setAddressQuery(event.target.value);
                                    }}
                                    placeholder="Start typing an address"
                                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm font-semibold text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                    autoComplete="off"
                                />
                                {addressSearchLoading && (
                                    <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-cyan-600" />
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={addSelectedAddressStop}
                                disabled={addressSuggestions.length === 0}
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                aria-label="Add selected address as stop"
                                title="Add selected address as stop"
                            >
                                <Plus size={18} />
                            </button>
                        </div>
                        {addressSuggestions.length > 0 && (
                            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                                {addressSuggestions.map((suggestion) => (
                                    <button
                                        key={suggestion.id}
                                        type="button"
                                        onClick={() => selectAddressSuggestion(suggestion)}
                                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-cyan-50 ${selectedAddress?.id === suggestion.id ? 'bg-cyan-50 text-cyan-900' : 'text-slate-700'}`}
                                    >
                                        <MapPin size={14} className="mt-0.5 shrink-0 text-cyan-600" />
                                        <span className="min-w-0">
                                            <span className="block font-black">{suggestion.name}</span>
                                            <span className="block truncate text-xs font-semibold text-slate-500">{suggestion.label}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {addressSearchError && (
                            <p className="mt-2 text-xs font-semibold text-amber-700">{addressSearchError}</p>
                        )}
                    </div>
                    {scenario && scenario.stops.length >= 2 && (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-2">
                            <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Route type</div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => onRouteShapeChange('one-way')}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-black ${scenario.routeShape === 'one-way' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                >
                                    One-way
                                </button>
                                {scenario.stops.length >= 3 && (
                                    <button
                                        type="button"
                                        onClick={() => onRouteShapeChange('closed-loop')}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-black ${scenario.routeShape === 'closed-loop' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                    >
                                        Closed loop
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => onRouteShapeChange('out-and-back')}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-black ${scenario.routeShape === 'out-and-back' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                >
                                    Out and back
                                </button>
                            </div>
                            <div className="mt-2 text-xs font-semibold text-slate-600">
                                {routeShapeLabel}: {stopVisitSequence.map((stop) => stop.sequence).join(' → ')}
                            </div>
                            {scenario.routeShape === 'out-and-back' && selectedStopId && selectedStopId !== sortedStops[0]?.id && (
                                <button
                                    type="button"
                                    onClick={() => onSetTurnaroundStop(selectedStopId)}
                                    className="mt-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                                >
                                                    Mark selected stop as bus turnaround
                                </button>
                            )}
                        </div>
                    )}
                    <div className="mt-3">
                        <button type="button" onClick={onAddNextStop} className="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-700">
                            {drawingGuide.actionLabel}
                        </button>
                    </div>
                    {focusMode && <div className="mt-2 text-xs font-bold text-cyan-700">Focus mode</div>}
                </div>

                {metricItems.length > 0 && (
                    <div
                        data-testid="rp2-map-metrics"
                        className="absolute bottom-4 right-4 grid max-w-3xl grid-cols-2 gap-2 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-xl sm:grid-cols-5"
                        style={{ right: 'var(--rp2-overlay-right)' }}
                    >
                        {metricItems.map((item) => {
                            const metricContent = (
                                <>
                                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{item.label}</div>
                                    <div className="mt-1 text-sm font-black text-slate-900">{item.value}</div>
                                    {item.detail && (
                                        <div className="mt-1 text-[10px] font-bold leading-4 text-slate-500">{item.detail}</div>
                                    )}
                                    {item.description && (
                                        <div
                                            role="tooltip"
                                            className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-700 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                        >
                                            {item.description}
                                        </div>
                                    )}
                                </>
                            );
                            const metricTestId = `rp2-map-metric-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

                            if (item.onClick) {
                                return (
                                    <button
                                        key={item.label}
                                        type="button"
                                        onClick={item.onClick}
                                        data-testid={metricTestId}
                                        className="group relative min-w-24 rounded-2xl bg-slate-50 px-3 py-2 text-left transition hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                                        aria-label={`Open ${item.label} source details`}
                                    >
                                        {metricContent}
                                    </button>
                                );
                            }

                            return (
                                <div key={item.label} data-testid={metricTestId} className="group relative min-w-24 rounded-2xl bg-slate-50 px-3 py-2">
                                    {metricContent}
                                </div>
                            );
                        })}
                    </div>
                )}

                {scenario && sortedStops.length > 0 && (
                    <div
                        data-testid="rp2-map-stop-tray"
                        data-collapsed="true"
                        className="absolute bottom-4 z-20 w-[min(16.5rem,calc(100%-2rem))] rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-lg"
                        style={{ left: 'var(--rp2-overlay-left)' }}
                    >
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-xs font-black uppercase tracking-wide text-slate-500">
                                        {sortedStops.length} {sortedStops.length === 1 ? 'stop' : 'stops'}
                                    </div>
                                    {selectedStop && (
                                        <div className="mt-1 truncate text-sm font-black text-slate-900">
                                            Selected: {selectedStop.sequence}. {selectedStop.name}
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={onOpenStopList}
                                    className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-800 hover:bg-cyan-100"
                                >
                                    Review stops
                                </button>
                            </div>
                            <div className="grid gap-1 text-xs font-semibold text-slate-600">
                                {firstStop && <div className="truncate">Start: {firstStop.name}</div>}
                                {lastStop && lastStop.id !== firstStop?.id && <div className="truncate">End: {lastStop.name}</div>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
