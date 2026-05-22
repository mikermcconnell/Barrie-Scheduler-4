import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MarkerDragEvent, MapRef } from 'react-map-gl/mapbox';

import { MapBase } from '../../shared';
import {
    buildRoutePlanner2FallbackRoadSnapResult,
    snapRoutePlanner2ScenarioToRoad,
    type RoutePlanner2RoadLabelGeometry,
    type RoutePlanner2RoadSnapProgress,
} from '../../../utils/route-planner-2/routePlanner2RoadSnap';
import {
    buildRoutePlanner2StopSegmentPairs,
    buildRoutePlanner2StopSegmentPaths,
    getRoutePlanner2SegmentId,
} from '../../../utils/route-planner-2/routePlanner2Segments';
import {
    selectRoutePlanner2ItemsInBox,
    selectRoutePlanner2ItemsInLasso,
    type RoutePlanner2MapSelection,
    type RoutePlanner2MapSelectionMode,
    type RoutePlanner2SelectableMapItem,
    type RoutePlanner2SelectionPoint,
} from '../../../utils/route-planner-2/routePlanner2MapSelection';
import type { RoutePlanner2RoutePoint, RoutePlanner2Scenario, RoutePlanner2SegmentRuntime, RoutePlanner2Stop } from '../../../utils/route-planner-2/routePlanner2Types';

const ROUTE_LINE_LAYER_ID = 'route-planner-2-line';
const ROUTE_LINE_HIT_LAYER_ID = 'route-planner-2-line-hit';
const ROUTE_BACKGROUND_ROUTES_SOURCE_ID = 'route-planner-2-background-routes-source';
const ROUTE_BACKGROUND_ROUTES_LAYER_ID = 'route-planner-2-background-routes-line';
const ROUTE_DIRECTION_ARROW_SOURCE_ID = 'route-planner-2-direction-arrows';
const ROUTE_DIRECTION_ARROW_CENTER_LAYER_ID = 'route-planner-2-direction-arrows-center';
const ROUTE_DIRECTION_ARROW_OUTBOUND_LAYER_ID = 'route-planner-2-direction-arrows-outbound';
const ROUTE_DIRECTION_ARROW_RETURN_LAYER_ID = 'route-planner-2-direction-arrows-return';
const ROUTE_RUNTIME_SOURCE_SOURCE_ID = 'route-planner-2-runtime-source-overlay';
const ROUTE_RUNTIME_SOURCE_LAYER_ID = 'route-planner-2-runtime-source-line';
const ROUTE_HIGHLIGHTED_SEGMENT_SOURCE_ID = 'route-planner-2-highlighted-segment';
const ROUTE_HIGHLIGHTED_SEGMENT_LAYER_ID = 'route-planner-2-highlighted-segment-line';
const ROUTE_ROAD_NAME_LINE_LABEL_SOURCE_ID = 'route-planner-2-road-name-line-labels';
const ROUTE_ROAD_NAME_LINE_LABEL_LAYER_ID = 'route-planner-2-road-name-line-labels-text';
const ROUTE_ROAD_NAME_OVERVIEW_LABEL_SOURCE_ID = 'route-planner-2-road-name-overview-labels';
const ROUTE_ROAD_NAME_OVERVIEW_LABEL_LAYER_ID = 'route-planner-2-road-name-overview-labels-text';

interface RoutePlanner2MapCanvasProps {
    scenario: RoutePlanner2Scenario | null | undefined;
    backgroundScenarios?: RoutePlanner2Scenario[];
    selectedStopId: string | null;
    highlightedStopId?: string | null;
    highlightedWaypointId?: string | null;
    highlightedSegmentId?: string | null;
    selectionMode?: RoutePlanner2MapSelectionMode | null;
    selectedStopIds?: string[];
    selectedWaypointIds?: string[];
    onSelectionChange?: (selection: RoutePlanner2MapSelection) => void;
    onSelectStop: (stopId: string) => void;
    onAddStop: (coordinate: { lat: number; lng: number; name?: string }) => void;
    onDeleteStop: (stopId: string) => void;
    onMoveStop: (stopId: string, coordinate: { lat: number; lng: number }) => void;
    onAddLineWaypoint: (placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        applyToOppositeDirection?: boolean;
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
    onSetSegmentRuntimeOverride?: (segmentId: string, runtimeMinutes: number) => void;
    onClearSegmentRuntimeOverride?: (segmentId: string) => void;
    metricItems?: Array<{ label: string; value: string; detail?: string; description?: string; onClick?: () => void }>;
    segmentRuntimes?: RoutePlanner2SegmentRuntime[];
    stopLabelDetails?: RoutePlanner2MapStopLabelDetail[];
    showRuntimeSourceOverlay?: boolean;
    showRoadNameLabels?: boolean;
    roadNameLabelDensity?: RoutePlanner2RoadNameLabelDensity;
    onRoadNameLabelStatusChange?: (status: { available: boolean; count: number }) => void;
    overlayInsets?: {
        left: string;
        right: string;
        top?: string;
    };
}

interface RoutePlanner2SegmentGeometry {
    id: string;
    fromStopId: string;
    toStopId: string;
    coordinates: [number, number][];
    roadLabels?: RoutePlanner2RoadLabelGeometry[];
}

interface RoutePlanner2RoadLabelBounds {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
}

export type RoutePlanner2RoadNameLabelDensity = 'fewer' | 'normal' | 'more';

interface SelectionDraft {
    mode: RoutePlanner2MapSelectionMode;
    start: RoutePlanner2SelectionPoint;
    current: RoutePlanner2SelectionPoint;
    points: RoutePlanner2SelectionPoint[];
}

const ROAD_NAME_LABEL_DENSITY_LIMITS: Record<RoutePlanner2RoadNameLabelDensity, number> = {
    fewer: 6,
    normal: 12,
    more: 24,
};

const ROAD_NAME_LABEL_LINE_SPACING: Record<RoutePlanner2RoadNameLabelDensity, number> = {
    fewer: 150,
    normal: 96,
    more: 62,
};

interface PendingLineAction {
    fromStopId: string;
    toStopId: string;
    segmentId: string;
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

const backgroundRouteLineLayer: LayerProps = {
    id: ROUTE_BACKGROUND_ROUTES_LAYER_ID,
    type: 'line',
    paint: {
        'line-color': '#64748b',
        'line-width': 3,
        'line-opacity': 0.35,
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

const highlightedSegmentLineLayer: LayerProps = {
    id: ROUTE_HIGHLIGHTED_SEGMENT_LAYER_ID,
    type: 'line',
    paint: {
        'line-color': '#0891b2',
        'line-width': 10,
        'line-opacity': 0.88,
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

const roadNameLineLabelLayer: LayerProps = {
    id: ROUTE_ROAD_NAME_LINE_LABEL_LAYER_ID,
    type: 'symbol',
    minzoom: 12.8,
    layout: {
        'symbol-placement': 'line-center',
        'symbol-spacing': 72,
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-keep-upright': true,
        'text-max-angle': 45,
        'text-padding': 1,
    },
    paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2.8,
        'text-halo-blur': 0.3,
    },
};

const roadNameOverviewLabelLayer: LayerProps = {
    id: ROUTE_ROAD_NAME_OVERVIEW_LABEL_LAYER_ID,
    type: 'symbol',
    maxzoom: 13.2,
    layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-keep-upright': true,
        'text-max-angle': 45,
        'text-padding': 0,
    },
    paint: {
        'text-color': '#1f2937',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
        'text-halo-blur': 0.25,
    },
};

function getStopMarkerClass(stop: RoutePlanner2Stop, isSelected: boolean, isHighlighted: boolean): string {
    const roleClass = stop.role === 'start-terminal'
        ? 'bg-emerald-600'
        : stop.role === 'end-terminal'
            ? 'bg-rose-600'
            : stop.role === 'turnaround'
                ? 'bg-amber-600'
                : stop.role === 'timed'
                    ? 'bg-indigo-600'
                    : 'bg-cyan-600';
    return `flex h-8 min-w-8 items-center justify-center rounded-full border-2 px-2 text-[10px] font-black leading-none text-white shadow-lg ${roleClass} ${isSelected ? 'scale-110 border-slate-950' : 'border-white'} ${isHighlighted ? 'scale-110 ring-4 ring-cyan-200' : ''}`;
}

function getStopMarkerColor(stop: RoutePlanner2Stop): string {
    if (stop.role === 'start-terminal') return '#059669';
    if (stop.role === 'end-terminal') return '#e11d48';
    if (stop.role === 'turnaround') return '#d97706';
    if (stop.role === 'timed') return '#4f46e5';
    return '#0891b2';
}

function getExportLabelWidth(label: string): number {
    const longestLine = getRoutePlanner2MapStopLabelLines(label).reduce((longest, line) => Math.max(longest, line.length), 0);
    return Math.max(88, Math.min(212, Math.ceil((longestLine * 7.2) + 24)));
}

function RoutePlanner2ExportStopLabel({ label }: { label: string }) {
    const lines = getRoutePlanner2MapStopLabelLines(label);
    const width = getExportLabelWidth(label);
    const height = lines.length > 1 ? 42 : 28;

    return (
        <svg
            data-testid="rp2-export-stop-label"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="pointer-events-none overflow-visible drop-shadow-md"
            aria-hidden="true"
        >
            <rect x="1" y="1" width={width - 2} height={height - 2} rx="13" fill="rgba(255,255,255,0.94)" stroke="#cbd5e1" />
            {lines.map((line, index) => (
                <text
                    key={`${line}-${index}`}
                    x={width / 2}
                    y={lines.length > 1 ? (index === 0 ? 15 : 29) : height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    alignmentBaseline="middle"
                    fontFamily="Nunito, Arial, sans-serif"
                    fontSize={index === 0 ? '12.5' : '11.5'}
                    fontWeight={index === 0 ? '900' : '800'}
                    fill={index === 0 ? '#0f172a' : '#475569'}
                >
                    {line}
                </text>
            ))}
        </svg>
    );
}

function RoutePlanner2ExportStopMarker({ stop }: { stop: RoutePlanner2Stop }) {
    return (
        <svg
            data-testid={`rp2-export-stop-marker-${stop.id}`}
            width="44"
            height="44"
            viewBox="0 0 44 44"
            className="pointer-events-none overflow-visible drop-shadow-lg"
            aria-label={`Stop ${stop.sequence}`}
        >
            <circle cx="22" cy="22" r="18" fill={getStopMarkerColor(stop)} stroke="#ffffff" strokeWidth="3.5" />
            <text
                x="22"
                y="22"
                textAnchor="middle"
                dominantBaseline="central"
                alignmentBaseline="middle"
                fontFamily="Nunito, Arial, sans-serif"
                fontSize="14"
                fontWeight="900"
                fill="#ffffff"
            >
                {stop.sequence}
            </text>
        </svg>
    );
}

export interface RoutePlanner2MapStopLabelDetail {
    stopId: string;
    stopName?: string;
    address?: string;
    kidsAtStop: number;
    travelTimeLabel: string;
}

interface RoutePlanner2MapStopLabelOptions {
    includePlaceLabel?: boolean;
}

type RoutePlanner2StopLabelAnchor = 'top' | 'bottom' | 'left' | 'right';

interface RoutePlanner2StopLabelPlacement {
    anchor: RoutePlanner2StopLabelAnchor;
    offset: [number, number];
}

interface RoutePlanner2StopLabelBox {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

const STOP_LABEL_PLACEMENT_OPTIONS: Array<RoutePlanner2StopLabelPlacement & { preference: number }> = [
    { anchor: 'bottom', offset: [0, -24], preference: 0 },
    { anchor: 'right', offset: [-24, 0], preference: 8 },
    { anchor: 'left', offset: [24, 0], preference: 10 },
    { anchor: 'top', offset: [0, 28], preference: 16 },
];

export interface RoutePlanner2MapCapture {
    dataUrl: string;
    width: number;
    height: number;
}

export interface RoutePlanner2MapCaptureOptions {
    fitCoordinates?: [number, number][];
    padding?: number;
    showStopLabels?: boolean;
}

export interface RoutePlanner2MapCanvasHandle {
    captureMapImage: (options?: RoutePlanner2MapCaptureOptions) => Promise<RoutePlanner2MapCapture>;
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

function formatRuntimeMinutes(value: number | null | undefined): string {
    return value != null && Number.isFinite(value) ? `${value} min` : 'Not estimated';
}

function getCoordinateDistance(first: [number, number], second: [number, number]): number {
    const latScale = 111.32;
    const avgLat = ((first[1] + second[1]) / 2) * Math.PI / 180;
    const lngScale = Math.cos(avgLat) * 111.32;
    return Math.hypot((second[0] - first[0]) * lngScale, (second[1] - first[1]) * latScale);
}

function getLineDistance(coordinates: [number, number][]): number {
    return coordinates.slice(1).reduce((sum, coordinate, index) => (
        sum + getCoordinateDistance(coordinates[index]!, coordinate)
    ), 0);
}

function coordinateWithinBounds(coordinate: [number, number], bounds: RoutePlanner2RoadLabelBounds): boolean {
    return coordinate[0] >= bounds.minLng
        && coordinate[0] <= bounds.maxLng
        && coordinate[1] >= bounds.minLat
        && coordinate[1] <= bounds.maxLat;
}

function segmentIntersectsBounds(first: [number, number], second: [number, number], bounds: RoutePlanner2RoadLabelBounds): boolean {
    const minLng = Math.min(first[0], second[0]);
    const maxLng = Math.max(first[0], second[0]);
    const minLat = Math.min(first[1], second[1]);
    const maxLat = Math.max(first[1], second[1]);
    return maxLng >= bounds.minLng
        && minLng <= bounds.maxLng
        && maxLat >= bounds.minLat
        && minLat <= bounds.maxLat;
}

function constrainRoadLabelToBounds(
    label: RoutePlanner2RoadLabelGeometry,
    bounds: RoutePlanner2RoadLabelBounds | null,
): RoutePlanner2RoadLabelGeometry | null {
    if (!bounds) return label;

    const coordinates: [number, number][] = [];
    label.coordinates.slice(1).forEach((coordinate, index) => {
        const previous = label.coordinates[index]!;
        if (!segmentIntersectsBounds(previous, coordinate, bounds)) return;
        if (coordinates.length === 0 || !coordinatesEqual(coordinates[coordinates.length - 1]!, previous)) {
            coordinates.push(previous);
        }
        coordinates.push(coordinate);
    });

    const hasVisibleCoordinate = coordinates.some((coordinate) => coordinateWithinBounds(coordinate, bounds));
    if (coordinates.length < 2 || !hasVisibleCoordinate) return null;

    return { ...label, coordinates };
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

export function buildRoutePlanner2ScenarioOverlayGeoJson(scenarios: RoutePlanner2Scenario[]) {
    return {
        type: 'FeatureCollection' as const,
        features: scenarios.flatMap((scenario, index) => {
            const coordinates = getScenarioWaypoints(scenario);
            if (coordinates.length < 2) return [];
            return [{
                type: 'Feature' as const,
                properties: {
                    scenarioId: scenario.id,
                    name: scenario.name,
                    index,
                },
                geometry: {
                    type: 'LineString' as const,
                    coordinates,
                },
            }];
        }),
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

const ROAD_NAME_ABBREVIATIONS: Array<[RegExp, string]> = [
    [/\bStreet\b/gi, 'St'],
    [/\bRoad\b/gi, 'Rd'],
    [/\bDrive\b/gi, 'Dr'],
    [/\bAvenue\b/gi, 'Ave'],
    [/\bBoulevard\b/gi, 'Blvd'],
    [/\bCrescent\b/gi, 'Cres'],
    [/\bCourt\b/gi, 'Ct'],
    [/\bLane\b/gi, 'Ln'],
    [/\bParkway\b/gi, 'Pkwy'],
    [/\bTerrace\b/gi, 'Terr'],
    [/\bPlace\b/gi, 'Pl'],
    [/\bTrail\b/gi, 'Trl'],
    [/\bCircle\b/gi, 'Cir'],
    [/\bHighway\b/gi, 'Hwy'],
];

export function formatRoutePlanner2RoadNameLabel(name: string): string {
    return ROAD_NAME_ABBREVIATIONS.reduce(
        (label, [pattern, replacement]) => label.replace(pattern, replacement),
        name.replace(/\s+/g, ' ').trim(),
    );
}

function getRoadLabelFeatures(
    segmentGeometries: RoutePlanner2SegmentGeometry[],
    bounds: RoutePlanner2RoadLabelBounds | null = null,
    density: RoutePlanner2RoadNameLabelDensity = 'normal',
) {
    const uniqueLabels: Array<RoutePlanner2RoadLabelGeometry & { originalIndex: number }> = [];
    const indexesByName = new Map<string, number>();

    segmentGeometries
        .flatMap((segment) => segment.roadLabels ?? [])
        .map((label) => constrainRoadLabelToBounds(label, bounds))
        .filter((label): label is RoutePlanner2RoadLabelGeometry => Boolean(label))
        .filter((label) => label.name.trim() && label.coordinates.length >= 2)
        .forEach((label, originalIndex) => {
            const key = formatRoutePlanner2RoadNameLabel(label.name).toLocaleLowerCase();
            const existingIndex = indexesByName.get(key);
            if (existingIndex == null) {
                indexesByName.set(key, uniqueLabels.length);
                uniqueLabels.push({ ...label, originalIndex });
                return;
            }

            if (getLineDistance(label.coordinates) > getLineDistance(uniqueLabels[existingIndex]!.coordinates)) {
                uniqueLabels[existingIndex] = { ...label, originalIndex: uniqueLabels[existingIndex]!.originalIndex };
            }
        });

    const limit = ROAD_NAME_LABEL_DENSITY_LIMITS[density];
    if (uniqueLabels.length <= limit) return uniqueLabels;

    return uniqueLabels
        .map((label) => ({ label, distance: getLineDistance(label.coordinates) }))
        .sort((first, second) => second.distance - first.distance)
        .slice(0, limit)
        .map((item) => item.label)
        .sort((first, second) => first.originalIndex - second.originalIndex);
}

export function buildRoadNameLineLabelGeoJson(
    segmentGeometries: RoutePlanner2SegmentGeometry[],
    bounds: RoutePlanner2RoadLabelBounds | null = null,
    density: RoutePlanner2RoadNameLabelDensity = 'normal',
) {
    return {
        type: 'FeatureCollection' as const,
        features: getRoadLabelFeatures(segmentGeometries, bounds, density).map((label, index) => ({
            type: 'Feature' as const,
            properties: {
                id: `road-line-label-${index}`,
                name: label.name,
                label: formatRoutePlanner2RoadNameLabel(label.name),
            },
            geometry: {
                type: 'LineString' as const,
                coordinates: label.coordinates,
            },
        })),
    };
}

export function buildRoadNameOverviewLabelGeoJson(
    segmentGeometries: RoutePlanner2SegmentGeometry[],
    bounds: RoutePlanner2RoadLabelBounds | null = null,
    density: RoutePlanner2RoadNameLabelDensity = 'normal',
) {
    return {
        type: 'FeatureCollection' as const,
        features: getRoadLabelFeatures(segmentGeometries, bounds, density).map((label, index) => ({
            type: 'Feature' as const,
            properties: {
                id: `road-overview-label-${index}`,
                name: label.name,
                label: formatRoutePlanner2RoadNameLabel(label.name),
            },
            geometry: {
                type: 'LineString' as const,
                coordinates: label.coordinates,
            },
        })),
    };
}

function truncateStopLabelLine(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatRoutePlanner2StopAddressLabel(detail: RoutePlanner2MapStopLabelDetail): string | null {
    const addressLine = detail.address?.split(',')[0]?.replace(/\s+/g, ' ').trim();
    const fallbackName = detail.stopName?.replace(/\s+/g, ' ').trim();
    const label = addressLine || fallbackName;
    return label ? truncateStopLabelLine(label, 34) : null;
}

export function formatRoutePlanner2MapStopLabel(
    detail: RoutePlanner2MapStopLabelDetail | undefined,
    options: RoutePlanner2MapStopLabelOptions = {},
): string | null {
    if (!detail) return null;
    const placeLabel = options.includePlaceLabel ? formatRoutePlanner2StopAddressLabel(detail) : null;
    const kidsLabel = `${detail.kidsAtStop} ${detail.kidsAtStop === 1 ? 'kid' : 'kids'}`;
    const metricLabel = detail.travelTimeLabel === 'Not estimated'
        ? kidsLabel
        : `${detail.travelTimeLabel} · ${kidsLabel}`;
    return placeLabel ? `${placeLabel}\n${metricLabel}` : metricLabel;
}

function getRoutePlanner2MapStopLabelLines(label: string): string[] {
    return label.split('\n').map((line) => line.trim()).filter(Boolean);
}

function estimateRoutePlanner2StopLabelSize(label: string): { width: number; height: number } {
    const lines = getRoutePlanner2MapStopLabelLines(label);
    const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
    return {
        width: Math.max(92, Math.min(172, Math.ceil((longestLine * 6.4) + 26))),
        height: Math.max(28, (lines.length * 13) + 16),
    };
}

function getRoutePlanner2StopLabelBox(
    point: { x: number; y: number },
    size: { width: number; height: number },
    placement: RoutePlanner2StopLabelPlacement,
): RoutePlanner2StopLabelBox {
    const x = point.x + placement.offset[0];
    const y = point.y + placement.offset[1];

    if (placement.anchor === 'bottom') {
        return { left: x - (size.width / 2), right: x + (size.width / 2), top: y - size.height, bottom: y };
    }
    if (placement.anchor === 'top') {
        return { left: x - (size.width / 2), right: x + (size.width / 2), top: y, bottom: y + size.height };
    }
    if (placement.anchor === 'left') {
        return { left: x, right: x + size.width, top: y - (size.height / 2), bottom: y + (size.height / 2) };
    }
    return { left: x - size.width, right: x, top: y - (size.height / 2), bottom: y + (size.height / 2) };
}

function getRoutePlanner2StopLabelOverlapArea(first: RoutePlanner2StopLabelBox, second: RoutePlanner2StopLabelBox): number {
    const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
    const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    return width * height;
}

function getRoutePlanner2StopLabelEdgePenalty(box: RoutePlanner2StopLabelBox, bounds: { width: number; height: number } | null): number {
    if (!bounds) return 0;
    const margin = 8;
    return Math.max(0, margin - box.left)
        + Math.max(0, box.right - bounds.width + margin)
        + Math.max(0, margin - box.top)
        + Math.max(0, box.bottom - bounds.height + margin);
}

function buildHighlightedSegmentGeoJson(segment: RoutePlanner2SegmentGeometry | null) {
    return {
        type: 'FeatureCollection' as const,
        features: segment && segment.coordinates.length >= 2
            ? [{
                type: 'Feature' as const,
                properties: { id: segment.id },
                geometry: {
                    type: 'LineString' as const,
                    coordinates: segment.coordinates,
                },
            }]
            : [],
    };
}

function getDirectionPairKey(fromStopId: string, toStopId: string): string {
    return [fromStopId, toStopId].sort().join('::');
}

function shouldReverseTwoWayArrowGeometry(
    segment: RoutePlanner2SegmentGeometry,
    fromSequence: number,
    toSequence: number,
): boolean {
    if (fromSequence !== toSequence) return fromSequence > toSequence;

    // Fall back to stable IDs when imported data does not have distinct sequences.
    return segment.fromStopId > segment.toStopId;
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
                const fromSequence = fromStop?.sequence ?? 0;
                const toSequence = toStop?.sequence ?? 0;
                const lane = !isTwoWay
                    ? 'center'
                    : fromSequence <= toSequence
                        ? 'outbound'
                        : 'return';
                const shouldReverseGeometry = isTwoWay
                    ? shouldReverseTwoWayArrowGeometry(segment, fromSequence, toSequence)
                    : false;
                const coordinates = shouldReverseGeometry
                    ? [...segment.coordinates].reverse()
                    : segment.coordinates;
                const label = isTwoWay && shouldReverseGeometry ? '←' : '➜';

                return {
                    type: 'Feature' as const,
                    properties: {
                        id: segment.id,
                        lane,
                        label,
                    },
                    geometry: {
                        type: 'LineString' as const,
                        coordinates,
                    },
                };
            }),
    };
}

function sortStops(stops: RoutePlanner2Stop[]): RoutePlanner2Stop[] {
    return [...stops].sort((a, b) => a.sequence - b.sequence);
}

function waitForNextPaint(): Promise<void> {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }

    return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
        });
    });
}

function waitForMapIdle(map: { once: (event: 'idle', callback: () => void) => void; loaded?: () => boolean }, timeoutMs = 750): Promise<void> {
    if (map.loaded?.()) return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve();
        };
        const timeout = window.setTimeout(finish, timeoutMs);
        map.once('idle', finish);
    });
}

function getBoundsForCoordinates(coordinates: [number, number][]) {
    const lngs = coordinates.map((coordinate) => coordinate[0]);
    const lats = coordinates.map((coordinate) => coordinate[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const lngPadding = Math.max(0.003, (maxLng - minLng) * 0.08);
    const latPadding = Math.max(0.003, (maxLat - minLat) * 0.08);

    return [
        [minLng - lngPadding, minLat - latPadding],
        [maxLng + lngPadding, maxLat + latPadding],
    ] as [[number, number], [number, number]];
}

function getRoadLabelBoundsForCoordinates(coordinates: [number, number][]): RoutePlanner2RoadLabelBounds | null {
    if (coordinates.length === 0) return null;
    const [[minLng, minLat], [maxLng, maxLat]] = getBoundsForCoordinates(coordinates);
    return { minLng, minLat, maxLng, maxLat };
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
    const segmentPairs = buildRoutePlanner2StopSegmentPairs(scenario);

    if (segmentPairs.length > 0) {
        const waypoints: [number, number][] = [];

        segmentPairs.forEach(({ fromStop, toStop }, index) => {
            if (index === 0) waypoints.push([fromStop.lng, fromStop.lat]);
            const anchors = getLineAnchorForSegment(scenario.alignment, fromStop.id, toStop.id);
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
    segmentId: string;
    insertAfterWaypointId?: string;
    insertBeforeWaypointId?: string;
} | null {
    let closestSegment: {
        fromStopId: string;
        toStopId: string;
        segmentId: string;
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
                    segmentId: getRoutePlanner2SegmentId(fromStop.id, toStop.id),
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

export const RoutePlanner2MapCanvas = forwardRef<RoutePlanner2MapCanvasHandle, RoutePlanner2MapCanvasProps>(function RoutePlanner2MapCanvas({
    scenario,
    backgroundScenarios = [],
    selectedStopId,
    highlightedStopId,
    highlightedWaypointId,
    highlightedSegmentId,
    selectionMode = null,
    selectedStopIds = [],
    selectedWaypointIds = [],
    onSelectionChange,
    onSelectStop,
    onAddStop,
    onDeleteStop,
    onMoveStop,
    onAddLineWaypoint,
    onInsertStopOnLine,
    onMoveLineWaypoint,
    onDeleteLineWaypoint,
    onSegmentRuntimeEstimates,
    onSetSegmentRuntimeOverride,
    onClearSegmentRuntimeOverride,
    metricItems = [],
    segmentRuntimes = [],
    stopLabelDetails = [],
    showRuntimeSourceOverlay = false,
    showRoadNameLabels = false,
    roadNameLabelDensity = 'normal',
    onRoadNameLabelStatusChange,
    overlayInsets = { left: '8rem', right: '8rem' },
}, ref) {
    const [mapLoaded, setMapLoaded] = useState(false);
    const [snappedCoordinates, setSnappedCoordinates] = useState<[number, number][]>([]);
    const [snappedSegmentGeometries, setSnappedSegmentGeometries] = useState<RoutePlanner2SegmentGeometry[]>([]);
    const [roadBuildProgress, setRoadBuildProgress] = useState<RoutePlanner2RoadSnapProgress | null>(null);
    const [pendingLineAction, setPendingLineAction] = useState<PendingLineAction | null>(null);
    const [applyAnchorToReturn, setApplyAnchorToReturn] = useState(false);
    const [runtimeOverrideValue, setRuntimeOverrideValue] = useState('');
    const [activeDragPreview, setActiveDragPreview] = useState<ActiveDragPreview | null>(null);
    const [isExportCaptureMode, setIsExportCaptureMode] = useState(false);
    const [exportCaptureShowStopLabels, setExportCaptureShowStopLabels] = useState(true);
    const [exportRoadLabelBounds, setExportRoadLabelBounds] = useState<RoutePlanner2RoadLabelBounds | null>(null);
    const [mouseMapCoordinate, setMouseMapCoordinate] = useState<{ lat: number; lng: number } | null>(null);
    const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
    const [, setMapViewVersion] = useState(0);
    const mapRef = useRef<MapRef | null>(null);
    const captureContainerRef = useRef<HTMLElement | null>(null);
    const suppressMapClickUntilRef = useRef(0);

    const waypoints = useMemo(() => scenario ? getScenarioWaypoints(scenario) : [], [scenario]);
    const roadBuildKey = useMemo(() => getScenarioRoadBuildKey(scenario), [scenario]);
    const lineAnchorHandles = useMemo(() => scenario ? getRouteLineAnchorHandles(scenario) : [], [scenario]);
    const selectedStopIdSet = useMemo(() => new Set(selectedStopIds), [selectedStopIds]);
    const selectedWaypointIdSet = useMemo(() => new Set(selectedWaypointIds), [selectedWaypointIds]);
    const stopLabelDetailsByStopId = useMemo(
        () => new Map(stopLabelDetails.map((detail) => [detail.stopId, detail])),
        [stopLabelDetails],
    );
    const lineGeoJson = useMemo(() => buildLineGeoJson(snappedCoordinates.length ? snappedCoordinates : waypoints), [snappedCoordinates, waypoints]);
    const backgroundRouteGeoJson = useMemo(
        () => buildRoutePlanner2ScenarioOverlayGeoJson(backgroundScenarios),
        [backgroundScenarios],
    );
    const directionArrowGeoJson = useMemo(
        () => buildRoutePlanner2DirectionArrowGeoJson(scenario, snappedSegmentGeometries),
        [scenario, snappedSegmentGeometries],
    );
    const activeSegmentRuntimes = useMemo(() => {
        if (segmentRuntimes.length > 0) return segmentRuntimes;
        if (scenario?.feasibility?.segmentSummaries?.length) return scenario.feasibility.segmentSummaries;
        return scenario?.runtimeEstimates ?? [];
    }, [scenario?.feasibility?.segmentSummaries, scenario?.runtimeEstimates, segmentRuntimes]);
    const runtimeSourceOverlaySegments = useMemo(() => {
        if (!scenario) return [];

        const fallbackGeometries = buildRoutePlanner2StopSegmentPaths(scenario);
        const geometries = snappedSegmentGeometries.length > 0 ? snappedSegmentGeometries : fallbackGeometries;

        return geometries.map((geometry) => {
            const runtime = getRuntimeSourceOverlayRuntime(activeSegmentRuntimes, geometry);
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
    }, [activeSegmentRuntimes, scenario, snappedSegmentGeometries]);
    const runtimeSourceGeoJson = useMemo(
        () => buildRuntimeSourceGeoJson(runtimeSourceOverlaySegments),
        [runtimeSourceOverlaySegments],
    );
    const activeRoadNameLabelDensity = isExportCaptureMode ? 'more' : roadNameLabelDensity;
    const roadNameLineLabelGeoJson = useMemo(
        () => buildRoadNameLineLabelGeoJson(snappedSegmentGeometries, exportRoadLabelBounds, activeRoadNameLabelDensity),
        [activeRoadNameLabelDensity, exportRoadLabelBounds, snappedSegmentGeometries],
    );
    const roadNameOverviewLabelGeoJson = useMemo(
        () => buildRoadNameOverviewLabelGeoJson(snappedSegmentGeometries, exportRoadLabelBounds, activeRoadNameLabelDensity),
        [activeRoadNameLabelDensity, exportRoadLabelBounds, snappedSegmentGeometries],
    );
    const highlightedSegmentGeoJson = useMemo(() => {
        if (!scenario || !highlightedSegmentId) return buildHighlightedSegmentGeoJson(null);
        const fallbackGeometries = buildRoutePlanner2StopSegmentPaths(scenario).map((segment) => ({
            id: segment.id,
            fromStopId: segment.fromStopId,
            toStopId: segment.toStopId,
            coordinates: segment.coordinates,
        }));
        const geometries = snappedSegmentGeometries.length > 0 ? snappedSegmentGeometries : fallbackGeometries;
        const highlightedSegment = geometries.find((geometry) => geometry.id === highlightedSegmentId) ?? null;
        return buildHighlightedSegmentGeoJson(highlightedSegment);
    }, [highlightedSegmentId, scenario, snappedSegmentGeometries]);
    const hasRouteLine = lineGeoJson.features.length > 0;
    const hasBackgroundRoutes = backgroundRouteGeoJson.features.length > 0;
    const hasRuntimeSourceOverlay = runtimeSourceGeoJson.features.length > 0;
    const hasRoadNameLabels = roadNameLineLabelGeoJson.features.length > 0 || roadNameOverviewLabelGeoJson.features.length > 0;
    const roadNameLabelCount = Math.max(roadNameLineLabelGeoJson.features.length, roadNameOverviewLabelGeoJson.features.length);
    const hasDirectionArrows = directionArrowGeoJson.features.length > 0;
    const hasHighlightedSegment = highlightedSegmentGeoJson.features.length > 0;
    useEffect(() => {
        onRoadNameLabelStatusChange?.({ available: hasRoadNameLabels, count: roadNameLabelCount });
    }, [hasRoadNameLabels, onRoadNameLabelStatusChange, roadNameLabelCount]);
    useEffect(() => {
        if (!mapLoaded) return;
        const map = mapRef.current?.getMap();
        if (!map) return;

        let animationFrame = 0;
        const scheduleLabelPlacementRefresh = () => {
            if (animationFrame) return;
            animationFrame = window.requestAnimationFrame(() => {
                animationFrame = 0;
                setMapViewVersion((version) => (version + 1) % 100000);
            });
        };

        scheduleLabelPlacementRefresh();
        map.on('move', scheduleLabelPlacementRefresh);
        map.on('zoom', scheduleLabelPlacementRefresh);
        map.on('resize', scheduleLabelPlacementRefresh);

        return () => {
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            map.off('move', scheduleLabelPlacementRefresh);
            map.off('zoom', scheduleLabelPlacementRefresh);
            map.off('resize', scheduleLabelPlacementRefresh);
        };
    }, [mapLoaded]);
    const activeRouteLineLayer = useMemo<LayerProps>(() => ({
        ...routeLineLayer,
        paint: {
            ...routeLineLayer.paint,
            'line-width': isExportCaptureMode ? 7 : 5,
            'line-opacity': isExportCaptureMode ? 0.95 : 0.86,
        },
    }), [isExportCaptureMode, roadNameLabelDensity]);
    const activeDirectionArrowCenterLayer = useMemo<LayerProps>(() => ({
        ...routeDirectionArrowCenterLayer,
        layout: {
            ...routeDirectionArrowCenterLayer.layout,
            'text-size': isExportCaptureMode ? 30 : 24,
            'symbol-spacing': isExportCaptureMode ? 62 : 54,
        },
    }), [isExportCaptureMode]);
    const activeDirectionArrowOutboundLayer = useMemo<LayerProps>(() => ({
        ...routeDirectionArrowOutboundLayer,
        layout: {
            ...routeDirectionArrowOutboundLayer.layout,
            'text-size': isExportCaptureMode ? 30 : 24,
            'symbol-spacing': isExportCaptureMode ? 62 : 54,
        },
    }), [isExportCaptureMode]);
    const activeDirectionArrowReturnLayer = useMemo<LayerProps>(() => ({
        ...routeDirectionArrowReturnLayer,
        layout: {
            ...routeDirectionArrowReturnLayer.layout,
            'text-size': isExportCaptureMode ? 30 : 24,
            'symbol-spacing': isExportCaptureMode ? 62 : 54,
        },
    }), [isExportCaptureMode]);
    const activeRoadNameLineLabelLayer = useMemo<LayerProps>(() => ({
        ...roadNameLineLabelLayer,
        minzoom: isExportCaptureMode ? 0 : roadNameLineLabelLayer.minzoom,
        layout: {
            ...roadNameLineLabelLayer.layout,
            'symbol-spacing': isExportCaptureMode ? 84 : ROAD_NAME_LABEL_LINE_SPACING[roadNameLabelDensity],
            'text-size': isExportCaptureMode ? 16 : roadNameLabelDensity === 'more' ? 11 : 12,
        },
        paint: {
            ...roadNameLineLabelLayer.paint,
            'text-halo-width': isExportCaptureMode ? 3.4 : 2.8,
        },
    }), [isExportCaptureMode]);
    const activeRoadNameOverviewLabelLayer = useMemo<LayerProps>(() => ({
        ...roadNameOverviewLabelLayer,
        maxzoom: isExportCaptureMode ? 0 : roadNameOverviewLabelLayer.maxzoom,
        layout: {
            ...roadNameOverviewLabelLayer.layout,
            'text-size': isExportCaptureMode ? 15 : roadNameLabelDensity === 'more' ? 10 : 11,
        },
        paint: {
            ...roadNameOverviewLabelLayer.paint,
            'text-halo-width': isExportCaptureMode ? 3.4 : 3,
        },
    }), [isExportCaptureMode, roadNameLabelDensity]);

    const captureMapImage = useCallback(async (options: RoutePlanner2MapCaptureOptions = {}): Promise<RoutePlanner2MapCapture> => {
        if (!captureContainerRef.current) {
            throw new Error('The route map is not ready to export yet.');
        }

        const map = mapRef.current?.getMap();
        const originalView = map
            ? {
                center: map.getCenter(),
                zoom: map.getZoom(),
                bearing: map.getBearing(),
                pitch: map.getPitch(),
            }
            : null;
        const exportCoordinates = options.fitCoordinates?.length
            ? options.fitCoordinates
            : [
                ...(snappedCoordinates.length ? snappedCoordinates : waypoints),
                ...(scenario?.stops.map((stop): [number, number] => [stop.lng, stop.lat]) ?? []),
            ];

        setExportCaptureShowStopLabels(options.showStopLabels ?? true);
        setIsExportCaptureMode(true);
        setExportRoadLabelBounds(options.fitCoordinates?.length ? getRoadLabelBoundsForCoordinates(options.fitCoordinates) : null);

        try {
            await waitForNextPaint();

            if (map && exportCoordinates.length > 0) {
                map.resize();
                map.fitBounds(getBoundsForCoordinates(exportCoordinates), {
                    padding: options.padding ?? 42,
                    duration: 0,
                    animate: false,
                });
                await waitForMapIdle(map);
            }

            await waitForNextPaint();
            const { default: html2canvas } = await import('html2canvas');
            const rawCanvas = await html2canvas(captureContainerRef.current, {
                backgroundColor: '#ffffff',
                useCORS: true,
                allowTaint: false,
                scale: Math.min(window.devicePixelRatio || 1, 2),
            });
            const canvas = rawCanvas;

            return {
                dataUrl: canvas.toDataURL('image/png'),
                width: canvas.width,
                height: canvas.height,
            };
        } finally {
            if (map && originalView) {
                map.jumpTo(originalView);
            }
            setIsExportCaptureMode(false);
            setExportCaptureShowStopLabels(true);
            setExportRoadLabelBounds(null);
        }
    }, [scenario?.stops, snappedCoordinates, waypoints]);

    useImperativeHandle(ref, () => ({ captureMapImage }), [captureMapImage]);
    const pendingRuntime = useMemo(() => {
        if (!pendingLineAction) return null;
        return activeSegmentRuntimes.find((segment) => segment.id === pendingLineAction.segmentId)
            ?? activeSegmentRuntimes.find((segment) =>
                segment.fromStopId === pendingLineAction.fromStopId
                && segment.toStopId === pendingLineAction.toStopId,
            )
            ?? null;
    }, [activeSegmentRuntimes, pendingLineAction]);
    const pendingFromStop = useMemo(
        () => scenario?.stops.find((stop) => stop.id === pendingLineAction?.fromStopId) ?? null,
        [pendingLineAction?.fromStopId, scenario?.stops],
    );
    const pendingToStop = useMemo(
        () => scenario?.stops.find((stop) => stop.id === pendingLineAction?.toStopId) ?? null,
        [pendingLineAction?.toStopId, scenario?.stops],
    );
    const pendingHasReturnSegment = useMemo(() => {
        if (!scenario || !pendingLineAction) return false;
        return buildRoutePlanner2StopSegmentPairs(scenario).some(({ fromStop, toStop }) =>
            fromStop.id === pendingLineAction.toStopId && toStop.id === pendingLineAction.fromStopId,
        );
    }, [pendingLineAction, scenario]);

    useEffect(() => {
        if (!pendingLineAction) {
            setRuntimeOverrideValue('');
            setApplyAnchorToReturn(false);
            return;
        }
        setRuntimeOverrideValue(
            pendingRuntime?.runtimeMinutes != null ? String(pendingRuntime.runtimeMinutes) : '',
        );
    }, [pendingLineAction?.segmentId, pendingRuntime?.runtimeMinutes]);
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
        function handleKeyDown(event: KeyboardEvent) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target;
            if (target instanceof HTMLElement) {
                const tagName = target.tagName.toLowerCase();
                if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
            }

            if (event.key === '1') {
                if (!mouseMapCoordinate) return;
                event.preventDefault();
                onAddStop(mouseMapCoordinate);
                setApplyAnchorToReturn(false);
                setPendingLineAction(null);
                return;
            }

            if (event.key === '2') {
                if (!scenario || !mouseMapCoordinate || scenario.stops.length < 2) return;
                const segment = getClosestRouteSegment(scenario, mouseMapCoordinate);
                if (!segment) return;
                event.preventDefault();
                const shortcutMatchesPendingSegment = pendingLineAction
                    && pendingLineAction.fromStopId === segment.fromStopId
                    && pendingLineAction.toStopId === segment.toStopId;
                onAddLineWaypoint({
                    ...segment,
                    coordinate: mouseMapCoordinate,
                    applyToOppositeDirection: Boolean(shortcutMatchesPendingSegment && applyAnchorToReturn && pendingHasReturnSegment),
                });
                setApplyAnchorToReturn(false);
                setPendingLineAction(null);
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [applyAnchorToReturn, mouseMapCoordinate, onAddLineWaypoint, onAddStop, pendingHasReturnSegment, pendingLineAction, scenario]);

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

    function getSelectionPoint(event: PointerEvent<HTMLElement>): RoutePlanner2SelectionPoint {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    function projectSelectablePoint(point: { lat: number; lng: number }): RoutePlanner2SelectionPoint {
        const projected = mapRef.current?.getMap()?.project?.([point.lng, point.lat] as [number, number]);
        if (projected && typeof projected.x === 'number' && typeof projected.y === 'number') {
            return { x: projected.x, y: projected.y };
        }

        const rect = captureContainerRef.current?.getBoundingClientRect();
        const width = Math.max(1, rect?.width ?? 1);
        const height = Math.max(1, rect?.height ?? 1);
        const coordinates = [
            ...(scenario?.stops ?? []),
            ...lineAnchorHandles,
        ];
        const lngValues = coordinates.map((coordinate) => coordinate.lng);
        const latValues = coordinates.map((coordinate) => coordinate.lat);
        const minLng = Math.min(...lngValues, point.lng);
        const maxLng = Math.max(...lngValues, point.lng);
        const minLat = Math.min(...latValues, point.lat);
        const maxLat = Math.max(...latValues, point.lat);

        return {
            x: ((point.lng - minLng) / Math.max(0.000001, maxLng - minLng)) * width,
            y: ((maxLat - point.lat) / Math.max(0.000001, maxLat - minLat)) * height,
        };
    }

    function getSelectableMapItems(): RoutePlanner2SelectableMapItem[] {
        if (!scenario) return [];
        return [
            ...scenario.stops.map((stop): RoutePlanner2SelectableMapItem => ({
                id: stop.id,
                type: 'stop',
                point: projectSelectablePoint(stop),
            })),
            ...lineAnchorHandles.map((anchor): RoutePlanner2SelectableMapItem => ({
                id: anchor.id,
                type: 'waypoint',
                point: projectSelectablePoint(anchor),
            })),
        ];
    }

    function shouldIgnoreSelectionStart(target: EventTarget | null): boolean {
        return target instanceof HTMLElement
            && Boolean(target.closest('button,input,textarea,select,[data-rp2-selection-ignore]'));
    }

    function handleSelectionPointerDown(event: PointerEvent<HTMLElement>) {
        if (!selectionMode || isExportCaptureMode || shouldIgnoreSelectionStart(event.target)) return;
        const point = getSelectionPoint(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
        suppressMapClickUntilRef.current = Date.now() + 500;
        setSelectionDraft({ mode: selectionMode, start: point, current: point, points: [point] });
    }

    function handleSelectionPointerMove(event: PointerEvent<HTMLElement>) {
        if (!selectionDraft) return;
        const point = getSelectionPoint(event);
        event.preventDefault();
        event.stopPropagation();
        setSelectionDraft((current) => {
            if (!current) return current;
            const previousPoint = current.points[current.points.length - 1] ?? current.start;
            const distance = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
            return {
                ...current,
                current: point,
                points: current.mode === 'lasso' && distance >= 4 ? [...current.points, point] : current.points,
            };
        });
    }

    function handleSelectionPointerUp(event: PointerEvent<HTMLElement>) {
        if (!selectionDraft) return;
        const point = getSelectionPoint(event);
        event.preventDefault();
        event.stopPropagation();
        suppressMapClickUntilRef.current = Date.now() + 500;

        const items = getSelectableMapItems();
        const points = selectionDraft.mode === 'lasso' ? [...selectionDraft.points, point] : selectionDraft.points;
        const selection = selectionDraft.mode === 'box'
            ? selectRoutePlanner2ItemsInBox(items, selectionDraft.start, point)
            : selectRoutePlanner2ItemsInLasso(items, points);
        onSelectionChange?.(selection);
        setSelectionDraft(null);
    }

    function handleMapClick(event: MapMouseEvent) {
        if (selectionMode) return;
        if (Date.now() < suppressMapClickUntilRef.current) return;
        if (!scenario) return;
        const coordinate = { lat: event.lngLat.lat, lng: event.lngLat.lng };

        if (clickedRouteLine(event) && scenario.stops.length >= 2) {
            const segment = getClosestRouteSegment(scenario, coordinate);
            if (segment) {
                setApplyAnchorToReturn(false);
                setPendingLineAction({
                    fromStopId: segment.fromStopId,
                    toStopId: segment.toStopId,
                    segmentId: segment.segmentId,
                    insertAfterWaypointId: segment.insertAfterWaypointId,
                    insertBeforeWaypointId: segment.insertBeforeWaypointId,
                    coordinate,
                });
                return;
            }
        }

        if (pendingLineAction) {
            closePendingLineAction();
            return;
        }

        setPendingLineAction(null);
        setApplyAnchorToReturn(false);
    }

    function handleMapMouseMove(event: MapMouseEvent) {
        setMouseMapCoordinate({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    }

    function insertStopFromPendingAction() {
        if (!pendingLineAction) return;
        onInsertStopOnLine(pendingLineAction);
        closePendingLineAction();
    }

    function saveRuntimeOverrideFromPendingAction() {
        if (!pendingLineAction || !onSetSegmentRuntimeOverride) return;
        const runtimeMinutes = Number(runtimeOverrideValue);
        if (!Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0) return;
        onSetSegmentRuntimeOverride(pendingLineAction.segmentId, runtimeMinutes);
    }

    function clearRuntimeOverrideFromPendingAction() {
        if (!pendingLineAction || !onClearSegmentRuntimeOverride) return;
        onClearSegmentRuntimeOverride(pendingLineAction.segmentId);
    }

    function closePendingLineAction() {
        suppressMapClickUntilRef.current = Date.now() + 500;
        setApplyAnchorToReturn(false);
        setPendingLineAction(null);
    }

    function addAnchorFromPendingAction() {
        if (!pendingLineAction) return;
        onAddLineWaypoint({
            ...pendingLineAction,
            applyToOppositeDirection: applyAnchorToReturn && pendingHasReturnSegment,
        });
        closePendingLineAction();
    }

    function getPreviewCoordinate(type: ActiveDragPreview['type'], id: string, fallback: { lat: number; lng: number }) {
        return activeDragPreview?.type === type && activeDragPreview.id === id
            ? activeDragPreview.coordinate
            : fallback;
    }

    const stopLabelPlacementsByStopId = (() => {
        const placements = new Map<string, RoutePlanner2StopLabelPlacement>();
        if (!scenario?.stops.length) return placements;

        const map = mapRef.current?.getMap();
        const bounds = map
            ? { width: map.getCanvas().clientWidth, height: map.getCanvas().clientHeight }
            : null;
        const placedBoxes: RoutePlanner2StopLabelBox[] = [];

        scenario.stops
            .slice()
            .sort((first, second) => first.sequence - second.sequence)
            .forEach((stop) => {
                const detail = stopLabelDetailsByStopId.get(stop.id);
                const label = formatRoutePlanner2MapStopLabel(detail, { includePlaceLabel: true });
                if (!label || !map) {
                    placements.set(stop.id, STOP_LABEL_PLACEMENT_OPTIONS[0]);
                    return;
                }

                const coordinate = getPreviewCoordinate('stop', stop.id, stop);
                const point = map.project([coordinate.lng, coordinate.lat]);
                const size = estimateRoutePlanner2StopLabelSize(label);
                const bestPlacement = STOP_LABEL_PLACEMENT_OPTIONS
                    .map((placement) => {
                        const box = getRoutePlanner2StopLabelBox(point, size, placement);
                        const overlapPenalty = placedBoxes.reduce(
                            (total, placedBox) => total + getRoutePlanner2StopLabelOverlapArea(box, placedBox),
                            0,
                        );
                        return {
                            placement,
                            box,
                            score: overlapPenalty + (getRoutePlanner2StopLabelEdgePenalty(box, bounds) * 20) + placement.preference,
                        };
                    })
                    .sort((first, second) => first.score - second.score)[0];

                placements.set(stop.id, bestPlacement.placement);
                placedBoxes.push(bestPlacement.box);
            });

        return placements;
    })();

    function startMarkerDrag(type: ActiveDragPreview['type'], id: string, coordinate: { lat: number; lng: number }) {
        suppressMapClickUntilRef.current = Date.now() + 500;
        setApplyAnchorToReturn(false);
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
        '--rp2-overlay-top': overlayInsets.top ?? '1.5rem',
    } as CSSProperties;

    return (
        <section
            data-testid="rp2-map-canvas"
            ref={captureContainerRef}
            style={overlayStyle}
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={handleSelectionPointerUp}
            className={`h-full min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ${selectionMode ? 'cursor-crosshair' : ''}`}
        >
            <div className="relative h-full min-h-0">
                {!isExportCaptureMode && selectionMode && (
                    <div
                        data-testid="rp2-map-selection-banner"
                        className="pointer-events-none absolute left-[var(--rp2-overlay-left)] top-[var(--rp2-overlay-top)] z-20 rounded-2xl border border-cyan-200 bg-white/95 px-3 py-2 text-xs font-black text-cyan-800 shadow-lg"
                    >
                        {selectionMode === 'box' ? 'Box selection active' : 'Lasso selection active'} · drag around stops and anchors
                    </div>
                )}
                <MapBase
                    longitude={-79.69}
                    latitude={44.38}
                    zoom={12}
                    className="h-full"
                    mapStyle="mapbox://styles/mapbox/light-v11"
                    preserveDrawingBuffer
                    interactive={!isExportCaptureMode}
                    showNavigation={!isExportCaptureMode}
                    showScale={!isExportCaptureMode}
                    mapRef={mapRef}
                    onLoad={() => setMapLoaded(true)}
                    interactiveLayerIds={[ROUTE_LINE_HIT_LAYER_ID]}
                    onMouseMove={handleMapMouseMove}
                    onClick={handleMapClick}
                >
                    {mapLoaded && hasBackgroundRoutes && (
                        <Source id={ROUTE_BACKGROUND_ROUTES_SOURCE_ID} type="geojson" data={backgroundRouteGeoJson}>
                            <Layer {...backgroundRouteLineLayer} />
                        </Source>
                    )}
                    {mapLoaded && hasRouteLine && (
                        <Source id="route-planner-2-line-source" type="geojson" data={lineGeoJson}>
                            <Layer {...activeRouteLineLayer} />
                            <Layer {...routeLineHitLayer} />
                        </Source>
                    )}
                    {mapLoaded && showRuntimeSourceOverlay && hasRuntimeSourceOverlay && (
                        <Source id={ROUTE_RUNTIME_SOURCE_SOURCE_ID} type="geojson" data={runtimeSourceGeoJson}>
                            <Layer {...runtimeSourceLineLayer} />
                        </Source>
                    )}
                    {mapLoaded && hasHighlightedSegment && (
                        <Source id={ROUTE_HIGHLIGHTED_SEGMENT_SOURCE_ID} type="geojson" data={highlightedSegmentGeoJson}>
                            <Layer {...highlightedSegmentLineLayer} />
                        </Source>
                    )}
                    {mapLoaded && (showRoadNameLabels || isExportCaptureMode) && hasRoadNameLabels && (
                        <>
                            <Source id={ROUTE_ROAD_NAME_OVERVIEW_LABEL_SOURCE_ID} type="geojson" data={roadNameOverviewLabelGeoJson}>
                                <Layer {...activeRoadNameOverviewLabelLayer} />
                            </Source>
                            <Source id={ROUTE_ROAD_NAME_LINE_LABEL_SOURCE_ID} type="geojson" data={roadNameLineLabelGeoJson}>
                                <Layer {...activeRoadNameLineLabelLayer} />
                            </Source>
                        </>
                    )}
                    {mapLoaded && hasDirectionArrows && (
                        <Source id={ROUTE_DIRECTION_ARROW_SOURCE_ID} type="geojson" data={directionArrowGeoJson}>
                            <Layer {...activeDirectionArrowCenterLayer} />
                            <Layer {...activeDirectionArrowOutboundLayer} />
                            <Layer {...activeDirectionArrowReturnLayer} />
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
                                className="pointer-events-none inline-flex min-h-6 items-center justify-center rounded-full border border-white bg-white/95 px-2.5 text-center text-[11px] font-black leading-none text-slate-800 shadow-lg"
                                title={`${segment.segmentName}: ${segment.label}`}
                            >
                                {segment.segmentName} · {segment.label}
                            </div>
                        </Marker>
                    ))}
                    {!isExportCaptureMode && mapLoaded && lineAnchorHandles.map((handle) => {
                        const coordinate = getPreviewCoordinate('waypoint', handle.id, handle);
                        const isDragging = activeDragPreview?.type === 'waypoint' && activeDragPreview.id === handle.id;
                        const isHighlighted = highlightedWaypointId === handle.id;
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
                                    data-highlighted={isHighlighted ? 'true' : undefined}
                                    data-selected={selectedWaypointIdSet.has(handle.id) ? 'true' : undefined}
                                    className={`flex h-7 w-7 cursor-grab items-center justify-center rounded-full border-2 border-cyan-700 bg-white text-xs font-black text-cyan-700 shadow-lg ${isDragging ? 'scale-110 cursor-grabbing ring-4 ring-cyan-100' : ''} ${isHighlighted ? 'scale-110 ring-4 ring-cyan-200' : ''} ${selectedWaypointIdSet.has(handle.id) ? 'scale-110 ring-4 ring-violet-300' : ''}`}
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
                    {!isExportCaptureMode && mapLoaded && pendingLineAction && (
                        <Marker
                            longitude={pendingLineAction.coordinate.lng}
                            latitude={pendingLineAction.coordinate.lat}
                            anchor="bottom"
                        >
                            <div
                                data-testid="rp2-segment-runtime-popover"
                                className="w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Segment runtime</div>
                                        <div className="mt-1 text-sm font-black text-slate-900">
                                            {pendingFromStop?.sequence ?? '?'} {pendingFromStop?.name ?? 'From stop'} → {pendingToStop?.sequence ?? '?'} {pendingToStop?.name ?? 'To stop'}
                                        </div>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                                        {getRuntimeSourceOverlayLabel(pendingRuntime?.source ?? 'missing', pendingRuntime?.evidenceMethod)}
                                    </span>
                                </div>
                                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-2">
                                    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                                        <span>Current travel time</span>
                                        <span className="font-black text-slate-900">{formatRuntimeMinutes(pendingRuntime?.runtimeMinutes)}</span>
                                    </div>
                                    <label className="mt-2 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                                        Manual override minutes
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            value={runtimeOverrideValue}
                                            onChange={(event) => setRuntimeOverrideValue(event.target.value)}
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900"
                                            aria-label="Manual segment travel time in minutes"
                                        />
                                    </label>
                                    <div className="mt-2 flex gap-2">
                                        <button
                                            type="button"
                                            onClick={saveRuntimeOverrideFromPendingAction}
                                            disabled={!onSetSegmentRuntimeOverride || !Number.isFinite(Number(runtimeOverrideValue)) || Number(runtimeOverrideValue) <= 0}
                                            className="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Save override
                                        </button>
                                        <button
                                            type="button"
                                            onClick={clearRuntimeOverrideFromPendingAction}
                                            disabled={!onClearSegmentRuntimeOverride || pendingRuntime?.source !== 'manual'}
                                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-3 border-t border-slate-100 pt-3">
                                    <label className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${pendingHasReturnSegment ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                                        <input
                                            type="checkbox"
                                            checked={applyAnchorToReturn && pendingHasReturnSegment}
                                            disabled={!pendingHasReturnSegment}
                                            onChange={(event) => setApplyAnchorToReturn(event.target.checked)}
                                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                                            aria-label="Apply bend anchor to return direction too"
                                        />
                                        <span>
                                            <span className="block font-black">Apply to return direction too</span>
                                            <span className="mt-0.5 block text-[10px] font-semibold leading-snug text-slate-500">
                                                {pendingHasReturnSegment
                                                    ? 'Leave off when the detour only affects this direction.'
                                                    : 'No matching return segment on this route.'}
                                            </span>
                                        </span>
                                    </label>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={insertStopFromPendingAction}
                                        className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-800 hover:bg-cyan-100"
                                    >
                                        Add stop here · 1
                                    </button>
                                    <button
                                        type="button"
                                        onClick={addAnchorFromPendingAction}
                                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                    >
                                        Add bend here · 2
                                    </button>
                                    <button
                                        type="button"
                                        onClick={closePendingLineAction}
                                        className="col-span-2 rounded-xl px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </Marker>
                    )}
                    {mapLoaded && (!isExportCaptureMode || exportCaptureShowStopLabels) && scenario?.stops.map((stop) => {
                        const coordinate = getPreviewCoordinate('stop', stop.id, stop);
                        const label = formatRoutePlanner2MapStopLabel(
                            stopLabelDetailsByStopId.get(stop.id),
                            { includePlaceLabel: true },
                        );
                        if (!label) return null;
                        const labelLines = getRoutePlanner2MapStopLabelLines(label);
                        const labelPlacement = stopLabelPlacementsByStopId.get(stop.id) ?? STOP_LABEL_PLACEMENT_OPTIONS[0];

                        return (
                            <Marker
                                key={`stop-label-${stop.id}`}
                                longitude={coordinate.lng}
                                latitude={coordinate.lat}
                                anchor={labelPlacement.anchor}
                                offset={labelPlacement.offset}
                                style={{ pointerEvents: 'none' }}
                            >
                                {isExportCaptureMode ? (
                                    <RoutePlanner2ExportStopLabel label={label} />
                                ) : (
                                    <div
                                        data-testid={`rp2-map-stop-label-${stop.id}`}
                                        className="pointer-events-none inline-flex min-h-8 max-w-56 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white/95 px-2.5 py-1 text-center shadow-md backdrop-blur-sm"
                                    >
                                        {labelLines.map((line, index) => (
                                            <span
                                                key={`${line}-${index}`}
                                                className={index === 0
                                                    ? 'max-w-full truncate text-[10px] font-black leading-tight text-slate-900'
                                                    : 'max-w-full truncate text-[9px] font-bold leading-tight text-slate-600'}
                                            >
                                                {line}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </Marker>
                        );
                    })}
                    {mapLoaded && scenario?.stops.map((stop) => {
                        const coordinate = getPreviewCoordinate('stop', stop.id, stop);
                        const isDragging = activeDragPreview?.type === 'stop' && activeDragPreview.id === stop.id;
                        const isHighlighted = highlightedStopId === stop.id;
                        const isBulkSelected = selectedStopIdSet.has(stop.id);
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
                            {isExportCaptureMode ? (
                                <RoutePlanner2ExportStopMarker stop={stop} />
                            ) : (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onSelectStop(stop.id);
                                    }}
                                    data-highlighted={isHighlighted ? 'true' : undefined}
                                    data-selected={isBulkSelected ? 'true' : undefined}
                                    className={`${getStopMarkerClass(stop, selectedStopId === stop.id || isBulkSelected, isHighlighted)} cursor-grab ${isDragging ? 'scale-110 cursor-grabbing ring-4 ring-cyan-100' : ''} ${isBulkSelected ? 'ring-4 ring-violet-300' : ''}`}
                                    aria-label={`Select ${stop.name}`}
                                >
                                    {stop.sequence}
                                </button>
                            )}
                        </Marker>
                        );
                    })}
                </MapBase>
                {!isExportCaptureMode && selectionDraft && selectionDraft.mode === 'box' && (
                    <div
                        data-testid="rp2-map-selection-overlay"
                        className="pointer-events-none absolute z-20 rounded-xl border-2 border-dashed border-violet-500 bg-violet-500/10"
                        style={{
                            left: Math.min(selectionDraft.start.x, selectionDraft.current.x),
                            top: Math.min(selectionDraft.start.y, selectionDraft.current.y),
                            width: Math.abs(selectionDraft.current.x - selectionDraft.start.x),
                            height: Math.abs(selectionDraft.current.y - selectionDraft.start.y),
                        }}
                    />
                )}
                {!isExportCaptureMode && selectionDraft && selectionDraft.mode === 'lasso' && (
                    <svg
                        data-testid="rp2-map-selection-overlay"
                        className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                    >
                        <polyline
                            points={[...selectionDraft.points, selectionDraft.current].map((point) => `${point.x},${point.y}`).join(' ')}
                            fill="rgba(139, 92, 246, 0.12)"
                            stroke="#8b5cf6"
                            strokeDasharray="6 5"
                            strokeWidth="2"
                        />
                    </svg>
                )}

                {!isExportCaptureMode && roadBuildProgress && roadBuildProgress.totalSegments > 0 && roadBuildProgress.completedSegments < roadBuildProgress.totalSegments && (
                    <div
                    className="absolute w-72 rounded-2xl border border-cyan-100 bg-white/95 p-3 shadow-lg"
                    style={{ top: 'calc(var(--rp2-overlay-top) + 4.5rem)', right: 'var(--rp2-overlay-right)' }}
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


                {!isExportCaptureMode && metricItems.length > 0 && (
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

            </div>
        </section>
    );
});
