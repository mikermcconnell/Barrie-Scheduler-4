import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';

import { MapBase } from '../../shared';
import { snapRoutePlanner2ScenarioToRoad, type RoutePlanner2RoadSnapSource } from '../../../utils/route-planner-2/routePlanner2RoadSnap';
import type { RoutePlanner2RoutePoint, RoutePlanner2Scenario, RoutePlanner2SegmentRuntime, RoutePlanner2Stop } from '../../../utils/route-planner-2/routePlanner2Types';

const ROUTE_LINE_LAYER_ID = 'route-planner-2-line';
const ROUTE_LINE_HIT_LAYER_ID = 'route-planner-2-line-hit';

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
    onMoveLineWaypoint: (waypointId: string, coordinate: { lat: number; lng: number }) => void;
    onSegmentRuntimeEstimates: (estimates: RoutePlanner2SegmentRuntime[]) => void;
    onAddNextStop?: () => void;
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

function formatStopRole(role: RoutePlanner2Stop['role']): string {
    if (role === 'start-terminal') return 'Start terminal';
    if (role === 'end-terminal') return 'End terminal';
    if (role === 'timed') return 'Timed stop';
    return 'Regular stop';
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
    const lineAnchors = getLineAnchorForSegment(scenario.alignment, fromStop.id, toStop.id);

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
    const stops = sortStops(scenario.stops);

    if (stops.length >= 2) {
        const waypoints: [number, number][] = [];

        stops.forEach((stop, index) => {
            waypoints.push([stop.lng, stop.lat]);
            const nextStop = stops[index + 1];
            if (!nextStop) return;
            const anchors = getLineAnchorForSegment(scenario.alignment, stop.id, nextStop.id);
            anchors.forEach((anchor) => {
                waypoints.push([anchor.lng, anchor.lat]);
            });
        });

        return waypoints;
    }

    const routePointWaypoints = [...scenario.alignment]
        .sort((a, b) => a.sequence - b.sequence)
        .map((point): [number, number] => [point.lng, point.lat]);

    return routePointWaypoints;
}

function getDrawingHint(scenario: RoutePlanner2Scenario | null | undefined): string {
    const stopCount = scenario?.stops.length ?? 0;
    if (stopCount === 0) return 'Start here: click the map where the route begins to place Stop 1.';
    if (stopCount === 1) return 'Now click the map where the route should go next to place Stop 2 and draw the first segment.';
    return `Keep clicking in travel order to add Stop ${stopCount + 1}, or select a stop to edit its role.`;
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
    const stops = sortStops(scenario.stops);
    let closestSegment: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
    } | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < stops.length - 1; index += 1) {
        const fromStop = stops[index];
        const toStop = stops[index + 1];
        if (!fromStop || !toStop) continue;

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
    onMoveLineWaypoint,
    onSegmentRuntimeEstimates,
    onAddNextStop,
}: RoutePlanner2MapCanvasProps) {
    const [mapLoaded, setMapLoaded] = useState(false);
    const [snappedCoordinates, setSnappedCoordinates] = useState<[number, number][]>([]);
    const [snapSource, setSnapSource] = useState<RoutePlanner2RoadSnapSource>('fallback');

    const waypoints = useMemo(() => scenario ? getScenarioWaypoints(scenario) : [], [scenario]);
    const lineAnchorHandles = useMemo(() => scenario ? getRouteLineAnchorHandles(scenario) : [], [scenario]);
    const lineGeoJson = useMemo(() => buildLineGeoJson(snappedCoordinates.length ? snappedCoordinates : waypoints), [snappedCoordinates, waypoints]);
    const hasRouteLine = lineGeoJson.features.length > 0;
    const drawingHint = getDrawingHint(scenario);

    useEffect(() => {
        let cancelled = false;

        if (!scenario) {
            setSnappedCoordinates([]);
            setSnapSource('fallback');
            return () => {
                cancelled = true;
            };
        }

        snapRoutePlanner2ScenarioToRoad(scenario).then((result) => {
            if (cancelled) return;
            setSnappedCoordinates(result.coordinates);
            setSnapSource(result.source);
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
                onAddLineWaypoint({
                    fromStopId: segment.fromStopId,
                    toStopId: segment.toStopId,
                    insertAfterWaypointId: segment.insertAfterWaypointId,
                    insertBeforeWaypointId: segment.insertBeforeWaypointId,
                    coordinate,
                });
                return;
            }
        }

        onAddStop(coordinate);
    }

    return (
        <section className="min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                    <h2 className="text-sm font-black text-slate-900">Mapbox planning map</h2>
                    <p className="text-xs text-slate-500">Build the route by clicking stops in travel order. The line appears after Stop 2.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                    Route snap: {snapSource === 'mapbox' ? 'Mapbox' : 'fallback'}
                </span>
            </div>

            <div className="relative h-[calc(100%-57px)] min-h-[460px]">
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
                    {mapLoaded && lineAnchorHandles.map((handle) => (
                        <Marker
                            key={handle.id}
                            longitude={handle.lng}
                            latitude={handle.lat}
                            anchor="center"
                            draggable
                            onDragEnd={(event) => onMoveLineWaypoint(handle.id, getDragCoordinate(event))}
                        >
                            <button
                                type="button"
                                onClick={(event) => event.stopPropagation()}
                                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-cyan-700 bg-white text-xs font-black text-cyan-700 shadow-lg"
                                aria-label="Drag route line anchor"
                                title="Drag to bend this route segment"
                            >
                                +
                            </button>
                        </Marker>
                    ))}
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

                <div className="absolute left-4 top-4 max-w-md rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white">
                            Draw route
                        </span>
                    </div>
                    <div className="mt-3 rounded-2xl bg-cyan-50 p-3 text-sm font-bold leading-5 text-cyan-900">
                        {drawingHint}
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                        Tip: click the route line to create a waypoint, then drag the + handle to bend the route.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={onAddNextStop} className="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white">
                            Add next stop
                        </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                        <div className="rounded-2xl bg-slate-50 p-3">
                            <div className="font-bold uppercase text-slate-500">Stops</div>
                            <div className="mt-1 text-lg font-black">{scenario?.stops.length ?? 0}</div>
                        </div>
                    </div>
                </div>

                {scenario && scenario.stops.length === 0 && (
                    <div className="pointer-events-none absolute bottom-6 left-1/2 max-w-md -translate-x-1/2 rounded-3xl border border-cyan-200 bg-white/95 p-4 text-center shadow-xl">
                        <div className="text-sm font-black text-slate-900">Start by clicking the map</div>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                            Draw route mode is already on. Your first click places Stop 1.
                        </p>
                    </div>
                )}

                {scenario && scenario.stops.length > 0 && (
                    <div className="absolute right-4 top-4 max-h-[360px] w-72 overflow-auto rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg">
                        <h3 className="text-sm font-black text-slate-900">Stop order</h3>
                        <div className="mt-3 space-y-2">
                            {scenario.stops.map((stop) => (
                                <div key={stop.id} className="flex items-stretch gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onSelectStop(stop.id)}
                                        className={`min-w-0 flex-1 rounded-2xl border p-3 text-left text-sm ${selectedStopId === stop.id ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-white'}`}
                                    >
                                        <div className="truncate font-bold text-slate-900">{stop.sequence}. {stop.name}</div>
                                        <div className="mt-1 text-xs font-semibold text-slate-500">{formatStopRole(stop.role)}</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteStop(stop.id)}
                                        className="flex w-11 shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                        aria-label={`Delete ${stop.name}`}
                                        title={`Delete ${stop.name}`}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
