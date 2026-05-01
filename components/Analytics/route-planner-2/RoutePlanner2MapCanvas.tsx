import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Trash2 } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';

import { MapBase } from '../../shared';
import { snapRoutePlanner2ScenarioToRoad } from '../../../utils/route-planner-2/routePlanner2RoadSnap';
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

interface RoutePlanner2MapCanvasProps {
    scenario: RoutePlanner2Scenario | null | undefined;
    selectedStopId: string | null;
    onSelectStop: (stopId: string) => void;
    onAddStop: (coordinate: { lat: number; lng: number }) => void;
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
    focusMode?: boolean;
    metricItems?: Array<{ label: string; value: string; description?: string }>;
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

const routeDirectionArrowCenterLayer: LayerProps = {
    id: ROUTE_DIRECTION_ARROW_CENTER_LAYER_ID,
    type: 'symbol',
    filter: ['==', ['get', 'lane'], 'center'],
    layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 72,
        'text-field': '▶',
        'text-size': 17,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-keep-upright': false,
    },
    paint: {
        'text-color': '#0e7490',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
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
        'text-halo-width': 2,
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
        'text-halo-width': 2,
    },
};

function getStopMarkerClass(stop: RoutePlanner2Stop, isSelected: boolean): string {
    const roleClass = stop.role === 'start-terminal'
        ? 'bg-emerald-600'
        : stop.role === 'end-terminal'
            ? 'bg-rose-600'
            : stop.role === 'timed'
                ? 'bg-indigo-600'
                : 'bg-cyan-600';
    return `flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-2 text-[10px] font-black text-white shadow-lg ${roleClass} ${isSelected ? 'scale-110 border-slate-950' : 'border-white'}`;
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
            ?? sortStops(scenario.stops)[stopCount - 1];
        return {
            title: `Out and back to ${turnaroundStop?.name ?? `Stop ${stopCount}`}`,
            body: 'The return trip is added automatically in reverse order. Select a stop and set it as the turnaround if needed.',
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
    focusMode = false,
    metricItems = [],
    overlayInsets = { left: '8rem', right: '8rem' },
}: RoutePlanner2MapCanvasProps) {
    const [mapLoaded, setMapLoaded] = useState(false);
    const [snappedCoordinates, setSnappedCoordinates] = useState<[number, number][]>([]);
    const [snappedSegmentGeometries, setSnappedSegmentGeometries] = useState<RoutePlanner2SegmentGeometry[]>([]);
    const [pendingLineAction, setPendingLineAction] = useState<PendingLineAction | null>(null);
    const [showLargeStopTray, setShowLargeStopTray] = useState(false);

    const waypoints = useMemo(() => scenario ? getScenarioWaypoints(scenario) : [], [scenario]);
    const lineAnchorHandles = useMemo(() => scenario ? getRouteLineAnchorHandles(scenario) : [], [scenario]);
    const lineGeoJson = useMemo(() => buildLineGeoJson(snappedCoordinates.length ? snappedCoordinates : waypoints), [snappedCoordinates, waypoints]);
    const directionArrowGeoJson = useMemo(
        () => buildRoutePlanner2DirectionArrowGeoJson(scenario, snappedSegmentGeometries),
        [scenario, snappedSegmentGeometries],
    );
    const hasRouteLine = lineGeoJson.features.length > 0;
    const hasDirectionArrows = directionArrowGeoJson.features.length > 0;
    const drawingGuide = getDrawingGuide(scenario);
    const sortedStops = useMemo(() => scenario ? sortStops(scenario.stops) : [], [scenario]);
    const stopVisitSequence = useMemo(() => scenario ? buildRoutePlanner2StopVisitSequence(scenario) : [], [scenario]);
    const isLargeStopList = sortedStops.length > 10;
    const visibleStopTrayStops = isLargeStopList && !showLargeStopTray ? [] : sortedStops;
    const selectedStop = sortedStops.find((stop) => stop.id === selectedStopId) ?? null;
    const firstStop = sortedStops[0] ?? null;
    const lastStop = sortedStops[sortedStops.length - 1] ?? null;
    const routeShapeLabel = scenario?.routeShape === 'closed-loop'
        ? 'Closed loop'
        : scenario?.routeShape === 'out-and-back'
        ? 'Out and back'
        : 'One-way';

    useEffect(() => {
        setShowLargeStopTray(false);
    }, [scenario?.id]);

    useEffect(() => {
        let cancelled = false;

        if (!scenario) {
            setSnappedCoordinates([]);
            setSnappedSegmentGeometries([]);
            return () => {
                cancelled = true;
            };
        }

        snapRoutePlanner2ScenarioToRoad(scenario).then((result) => {
            if (cancelled) return;
            setSnappedCoordinates(result.coordinates);
            setSnappedSegmentGeometries(result.segmentGeometries);
            onSegmentRuntimeEstimates(result.segmentEstimates);
        });

        return () => {
            cancelled = true;
        };
    }, [scenario, onSegmentRuntimeEstimates]);

    function handleMapClick(event: MapMouseEvent) {
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

    const overlayStyle = {
        '--rp2-overlay-left': overlayInsets.left,
        '--rp2-overlay-right': overlayInsets.right,
    } as CSSProperties;

    return (
        <section
            data-testid="rp2-map-canvas"
            style={overlayStyle}
            className="h-full min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
        >
            <div className="relative h-full min-h-[520px]">
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
                    {mapLoaded && hasDirectionArrows && (
                        <Source id={ROUTE_DIRECTION_ARROW_SOURCE_ID} type="geojson" data={directionArrowGeoJson}>
                            <Layer {...routeDirectionArrowCenterLayer} />
                            <Layer {...routeDirectionArrowOutboundLayer} />
                            <Layer {...routeDirectionArrowReturnLayer} />
                        </Source>
                    )}
                    {mapLoaded && lineAnchorHandles.map((handle) => (
                        <Marker
                            key={handle.id}
                            longitude={handle.lng}
                            latitude={handle.lat}
                            anchor="center"
                            draggable
                            onDragEnd={(event) => onMoveLineWaypoint(handle.id, getDragCoordinate(event))}
                        >
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={(event) => event.stopPropagation()}
                                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-cyan-700 bg-white text-xs font-black text-cyan-700 shadow-lg"
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
                    ))}
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
                    {mapLoaded && scenario?.stops.map((stop) => (
                        <Marker
                            key={stop.id}
                            longitude={stop.lng}
                            latitude={stop.lat}
                            anchor="center"
                            draggable
                            onDragStart={() => onSelectStop(stop.id)}
                            onDragEnd={(event) => onMoveStop(stop.id, getDragCoordinate(event))}
                        >
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectStop(stop.id);
                                }}
                                className={getStopMarkerClass(stop, selectedStopId === stop.id)}
                                aria-label={`Select ${stop.name}`}
                            >
                                {stop.sequence}
                            </button>
                        </Marker>
                    ))}
                </MapBase>

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
                                    Use selected stop as turnaround
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
                        {metricItems.map((item) => (
                            <div key={item.label} className="group relative min-w-24 rounded-2xl bg-slate-50 px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{item.label}</div>
                                <div className="mt-1 text-sm font-black text-slate-900">{item.value}</div>
                                {item.description && (
                                    <div
                                        role="tooltip"
                                        className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-700 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                    >
                                        {item.description}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {scenario && sortedStops.length > 0 && (
                    <div
                        data-testid="rp2-map-stop-tray"
                        data-collapsed={isLargeStopList && !showLargeStopTray ? 'true' : 'false'}
                        className={`absolute bottom-14 max-w-[min(44rem,calc(100%-2rem))] rounded-3xl border border-slate-200 bg-white/95 p-2 shadow-lg ${isLargeStopList && showLargeStopTray ? 'max-h-72 overflow-y-auto' : ''}`}
                        style={{ left: 'var(--rp2-overlay-left)' }}
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 text-xs font-black uppercase tracking-wide text-slate-500">
                                {sortedStops.length} {sortedStops.length === 1 ? 'stop' : 'stops'}
                            </span>
                            {isLargeStopList && !showLargeStopTray && (
                                <>
                                    {firstStop && <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Start: {firstStop.name}</span>}
                                    {lastStop && <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">End: {lastStop.name}</span>}
                                    {selectedStop && <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-800">Selected: {selectedStop.sequence}. {selectedStop.name}</span>}
                                </>
                            )}
                            {visibleStopTrayStops.map((stop) => (
                                <div key={stop.id} className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onSelectStop(stop.id)}
                                        className={`rounded-full border px-3 py-2 text-xs font-bold ${selectedStopId === stop.id ? 'border-cyan-300 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white text-slate-700'}`}
                                    >
                                        {stop.sequence}. {stop.name}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteStop(stop.id)}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                        aria-label={`Delete ${stop.name}`}
                                        title={`Delete ${stop.name}`}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                            {isLargeStopList && (
                                <button
                                    type="button"
                                    onClick={() => setShowLargeStopTray((current) => !current)}
                                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                >
                                    {showLargeStopTray ? 'Hide stops' : 'Show all stops'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
