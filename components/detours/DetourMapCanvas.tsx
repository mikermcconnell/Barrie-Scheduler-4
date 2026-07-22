import {
    Fragment,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    type CSSProperties,
} from 'react';
import { AlertTriangle, Camera, LocateFixed, Route } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef, MarkerDragEvent } from 'react-map-gl/mapbox';

import { MapBase } from '../shared/MapBase';
import type {
    DetourCoordinate,
    DetourMapFrame,
    DetourLineGeometry,
    DetourMapLabel as DetourDomainMapLabel,
    DetourRouteOverlay,
    DetourStreetLabel,
    DetourStopImpact,
} from '../../utils/detours/detourTypes';
import { streetLabelText } from '../../utils/detours/detourStreetLabels';
import {
    buildDetourLineGeoJson,
    buildDetourPointsGeoJson,
    findNearestRouteAnchor,
    splitDetourRoute,
    type DetourRouteAnchor,
} from '../../utils/detours/detourGeometry';

const ORIGINAL_LINE_ID = 'detour-original-line';
const BYPASS_LINE_ID = 'detour-bypassed-line';
const DETOUR_LINE_ID = 'detour-active-line';
const BYPASS_HIT_LAYER_ID = 'detour-bypassed-hit-area';
const DETOUR_HIT_LAYER_ID = 'detour-active-hit-area';
const STOPS_LAYER_ID = 'detour-stops';

export type DetourMapMode = 'select' | 'closure-start' | 'closure-end' | 'add-waypoint' | 'add-temporary-stop';
export type DetourMapSelection =
    | { type: 'stop-impact'; id: string }
    | { type: 'waypoint'; index: number }
    | { type: 'closure-waypoint'; index: number }
    | { type: 'street-label'; id: string }
    | { type: 'label'; id: string }
    | null;

export interface DetourBackgroundRoute {
    id: string;
    color?: string;
    coordinates: DetourCoordinate[];
}

export type DetourMapLabel = DetourDomainMapLabel;

export interface DetourMapCanvasHandle {
    fitToNotice: () => void;
    captureImage: (mimeType?: 'image/png' | 'image/jpeg', quality?: number) => Promise<string | null>;
}

export interface DetourMapCanvasProps {
    overlay: DetourRouteOverlay;
    additionalOverlays?: DetourRouteOverlay[];
    backgroundRoutes?: DetourBackgroundRoute[];
    walkingGeometry?: DetourLineGeometry;
    stopClosureMarkers?: {
        closed?: { id: string; label: string; position: DetourCoordinate } | null;
        replacement?: { id: string; label: string; position: DetourCoordinate } | null;
    };
    mapFrame?: DetourMapFrame;
    mode?: DetourMapMode;
    publicationMode?: boolean;
    selectedItem?: DetourMapSelection;
    labels?: DetourMapLabel[];
    className?: string;
    style?: CSSProperties;
    onSelectClosureStart: (anchor: DetourRouteAnchor) => void;
    onSelectClosureEnd: (anchor: DetourRouteAnchor) => void;
    onAddWaypoint: (coordinate: DetourCoordinate) => void;
    onInsertDetourWaypoint: (coordinate: DetourCoordinate) => void;
    onMoveWaypoint: (index: number, coordinate: DetourCoordinate) => void;
    onDeleteWaypoint: (index: number) => void;
    onAddClosureWaypoint: (coordinate: DetourCoordinate) => void;
    onMoveClosureWaypoint: (index: number, coordinate: DetourCoordinate) => void;
    onDeleteClosureWaypoint: (index: number) => void;
    onAddTemporaryStop: (coordinate: DetourCoordinate) => void;
    onMoveTemporaryStop: (impactId: string, coordinate: DetourCoordinate) => void;
    onMoveRouteLabel?: (coordinate: DetourCoordinate) => void;
    onMoveStreetLabel?: (labelId: string, coordinate: DetourCoordinate) => void;
    onConfirmStopImpact: (impactId: string, status: DetourStopImpact['status']) => void;
    onMoveLabel?: (labelId: string, coordinate: DetourCoordinate) => void;
    onSelectItem?: (selection: DetourMapSelection) => void;
    onCaptureImage?: (dataUrl: string) => void;
    onMapFrameChange?: (frame: DetourMapFrame) => void;
}

const backgroundLayer: LayerProps = {
    id: 'detour-background-routes',
    type: 'line',
    paint: {
        'line-color': ['coalesce', ['get', 'color'], '#94a3b8'],
        'line-opacity': 0.28,
        'line-width': 3,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const originalLayer: LayerProps = {
    id: ORIGINAL_LINE_ID,
    type: 'line',
    paint: { 'line-color': '#1f2937', 'line-opacity': 0.82, 'line-width': 5 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const originalCasingLayer: LayerProps = {
    id: 'detour-original-casing',
    type: 'line',
    paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.88, 'line-width': 9 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const bypassLayer: LayerProps = {
    id: BYPASS_LINE_ID,
    type: 'line',
    paint: {
        'line-color': '#dc2626',
        'line-opacity': 0.9,
        'line-width': 5,
        'line-dasharray': [1.5, 1.5],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const editableLineHitLayer: LayerProps = {
    id: DETOUR_HIT_LAYER_ID,
    type: 'line',
    paint: {
        'line-color': '#000000',
        'line-opacity': 0.01,
        'line-width': 20,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const bypassLabelLayer: LayerProps = {
    id: 'detour-bypassed-label',
    type: 'symbol',
    layout: {
        'symbol-placement': 'point',
        'text-field': 'DETOUR CLOSED',
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-letter-spacing': 0.06,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-anchor': 'center',
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'text-rotate': ['get', 'angle'],
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#b91c1c',
        'text-halo-width': 5,
        'text-halo-blur': 0.5,
    },
};

const detourWarningOutlineLayer: LayerProps = {
    id: 'detour-warning-outline',
    type: 'line',
    paint: { 'line-color': '#f97316', 'line-width': 12, 'line-opacity': 0.98 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const detourCasingLayer: LayerProps = {
    id: 'detour-active-casing',
    type: 'line',
    paint: { 'line-color': ['get', 'color'], 'line-width': 10, 'line-opacity': 0.96 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const detourLayer: LayerProps = {
    id: DETOUR_LINE_ID,
    type: 'line',
    paint: { 'line-color': '#1f2937', 'line-width': 6, 'line-opacity': 1 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

const directionArrowLayer: LayerProps = {
    id: 'detour-direction-arrows',
    type: 'symbol',
    layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 130,
        'text-field': '▶',
        'text-size': 15,
        'text-rotation-alignment': 'map',
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#111827',
        'text-halo-width': 1.5,
        'text-halo-blur': 0.5,
    },
};

const routeBadgeLayer: LayerProps = {
    id: 'detour-route-badge',
    type: 'symbol',
    layout: {
        'symbol-placement': 'point',
        'text-field': 'DETOUR',
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-letter-spacing': 0.08,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'text-rotate': ['get', 'angle'],
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#111827',
        'text-halo-width': 5,
        'text-halo-blur': 0.5,
    },
};

const stopLayer: LayerProps = {
    id: STOPS_LAYER_ID,
    type: 'circle',
    paint: {
        'circle-radius': [
            'match', ['get', 'status'],
            'temporary', 8,
            'closed', 7,
            5,
        ],
        'circle-color': [
            'match', ['get', 'status'],
            'closed', '#dc2626',
            'temporary', '#16a34a',
            '#2563eb',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
    },
};

const stopLabelLayer: LayerProps = {
    id: 'detour-stop-labels',
    type: 'symbol',
    minzoom: 12,
    layout: {
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-optional': true,
        'text-padding': 4,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
    },
    paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
};

const closureStreetLabelLayer: LayerProps = {
    id: 'detour-closure-street-labels',
    type: 'symbol',
    filter: ['==', ['get', 'path'], 'closure'],
    layout: {
        'symbol-placement': 'point',
        'text-field': ['get', 'label'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-letter-spacing': 0.04,
        'text-anchor': 'bottom',
        'text-offset': [0, -1.05],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'text-rotate': ['get', 'angle'],
    },
    paint: {
        'text-color': '#991b1b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 4,
        'text-halo-blur': 0.5,
        'text-opacity': ['case', ['boolean', ['get', 'confirmed'], false], 1, 0.62],
    },
};

const detourStreetLabelLayer: LayerProps = {
    ...closureStreetLabelLayer,
    id: 'detour-path-street-labels',
    filter: ['==', ['get', 'path'], 'detour'],
    paint: {
        'text-color': '#111827',
        'text-halo-color': '#fff7ed',
        'text-halo-width': 4,
        'text-halo-blur': 0.5,
        'text-opacity': ['case', ['boolean', ['get', 'confirmed'], false], 1, 0.62],
    },
};

const temporaryStopLabelLayer: LayerProps = {
    ...stopLabelLayer,
    id: 'detour-temporary-stop-labels',
    filter: ['==', ['get', 'status'], 'temporary'],
    layout: {
        ...stopLabelLayer.layout,
        'text-size': 12,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-anchor': 'bottom',
        'text-offset': [0, -1.35],
        'text-justify': 'center',
        'text-padding': 8,
        'text-optional': false,
        'text-allow-overlap': true,
        'text-ignore-placement': false,
    },
    paint: {
        'text-color': '#14532d',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
        'text-halo-blur': 0.5,
    },
};

const routeNumberCasingLayer: LayerProps = {
    id: 'detour-route-number-casing',
    type: 'symbol',
    layout: {
        'symbol-placement': 'point',
        'text-field': ['get', 'routeLabel'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 13,
        'text-letter-spacing': 0.02,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.75],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
        'text-rotate': ['get', 'angle'],
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#111827',
        'text-halo-width': 6,
        'text-halo-blur': 0.5,
    },
};

const routeNumberLabelLayer: LayerProps = {
    ...routeNumberCasingLayer,
    id: 'detour-route-number',
    paint: {
        'text-color': '#111827',
        'text-halo-color': '#ffffff',
        'text-halo-width': 4,
        'text-halo-blur': 0.25,
    },
};

const closedStopLabelLayer: LayerProps = {
    ...temporaryStopLabelLayer,
    id: 'detour-closed-stop-labels',
    filter: ['==', ['get', 'status'], 'closed'],
    layout: {
        ...stopLabelLayer.layout,
        'text-size': 12,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-variable-anchor': ['top-right', 'bottom-right', 'top-left', 'bottom-left'],
        'text-radial-offset': 0.75,
        'text-justify': 'auto',
        'text-padding': 4,
        'text-optional': false,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
    },
    paint: {
        'text-color': '#991b1b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
        'text-halo-blur': 0.5,
    },
};

const regularStopLabelLayer: LayerProps = {
    ...stopLabelLayer,
    filter: ['!', ['in', ['get', 'status'], ['literal', ['closed', 'temporary']]]],
};

const annotationLabelLayer: LayerProps = {
    id: 'detour-annotation-labels',
    type: 'symbol',
    layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-padding': 4,
    },
    paint: {
        'text-color': '#111827',
        'text-halo-color': '#ffffff',
        'text-halo-width': 4,
    },
};

const walkingLayer: LayerProps = {
    id: 'detour-walking-link',
    type: 'line',
    paint: {
        'line-color': '#15803d',
        'line-width': 4,
        'line-dasharray': [1, 1.5],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
};

function coordinateFromEvent(event: MapMouseEvent | MarkerDragEvent): DetourCoordinate {
    return { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
}

function getSegmentLabelAngle(start: DetourCoordinate, end: DetourCoordinate): number {
    const meanLatitudeRadians = ((start.latitude + end.latitude) / 2) * Math.PI / 180;
    const projectedLatitudeDelta = (end.latitude - start.latitude) / Math.max(Math.cos(meanLatitudeRadians), 0.01);
    let angle = -Math.atan2(projectedLatitudeDelta, end.longitude - start.longitude) * 180 / Math.PI;
    while (angle > 90) angle -= 180;
    while (angle < -90) angle += 180;
    return angle;
}

function getLineLabelPlacement(coordinates: DetourCoordinate[], lineFraction = 0.5): { position: DetourCoordinate; angle: number } | null {
    if (coordinates.length === 0) return null;
    if (coordinates.length === 1) return { position: coordinates[0]!, angle: 0 };
    const lengths = coordinates.slice(1).map((coordinate, index) => {
        const previous = coordinates[index]!;
        return Math.hypot(
            coordinate.longitude - previous.longitude,
            coordinate.latitude - previous.latitude,
        );
    });
    const target = lengths.reduce((sum, length) => sum + length, 0) * Math.min(1, Math.max(0, lineFraction));
    let travelled = 0;
    for (let index = 0; index < lengths.length; index += 1) {
        const segmentLength = lengths[index]!;
        if (travelled + segmentLength >= target) {
            const start = coordinates[index]!;
            const end = coordinates[index + 1]!;
            const fraction = segmentLength === 0 ? 0 : (target - travelled) / segmentLength;
            const position = {
                longitude: start.longitude + (end.longitude - start.longitude) * fraction,
                latitude: start.latitude + (end.latitude - start.latitude) * fraction,
            };
            return { position, angle: getSegmentLabelAngle(start, end) };
        }
        travelled += segmentLength;
    }
    return { position: coordinates.at(-1)!, angle: 0 };
}

function getRouteNumberPlacement(overlay: DetourRouteOverlay): { position: DetourCoordinate; angle: number } | null {
    const geometry = overlay.detourGeometry.coordinates;
    if (overlay.routeLabelPosition) {
        const anchor = findNearestRouteAnchor(geometry, overlay.routeLabelPosition);
        if (anchor) {
            const start = geometry[anchor.segmentIndex];
            const end = geometry[anchor.segmentIndex + 1];
            return {
                position: anchor.coordinate,
                angle: start && end ? getSegmentLabelAngle(start, end) : 0,
            };
        }
    }
    return getLineLabelPlacement(geometry, 0.3);
}

function buildRouteBadgeGeoJson(overlay: DetourRouteOverlay, includeDraft = false) {
    if (overlay.streetLabels?.some(label => label.path === 'detour' && (label.confirmed || includeDraft) && label.visible && label.streetName.trim())) {
        return buildDetourPointsGeoJson([]);
    }
    const placement = getLineLabelPlacement(overlay.detourGeometry.coordinates, 0.62);
    return buildDetourPointsGeoJson(placement ? [{ id: overlay.id, position: placement.position }] : [], () => ({
        angle: placement?.angle ?? 0,
    }));
}

function buildRouteNumberGeoJson(overlay: DetourRouteOverlay) {
    const placement = getRouteNumberPlacement(overlay);
    return buildDetourPointsGeoJson(placement ? [{ id: overlay.id, position: placement.position }] : [], () => ({
        routeLabel: overlay.routeSnapshot.routeShortName,
        angle: placement?.angle ?? 0,
    }));
}

function buildClosureLabelGeoJson(overlay: DetourRouteOverlay, includeDraft = false) {
    if (overlay.streetLabels?.some(label => label.path === 'closure' && (label.confirmed || includeDraft) && label.visible && label.streetName.trim())) {
        return buildDetourPointsGeoJson([]);
    }
    const placement = getLineLabelPlacement(overlay.closureGeometry.coordinates);
    return buildDetourPointsGeoJson(placement ? [{ id: overlay.id, position: placement.position }] : [], () => ({
        label: 'DETOUR CLOSED',
        angle: placement?.angle ?? 0,
    }));
}

function getStreetLabelPlacement(label: DetourStreetLabel, overlay: DetourRouteOverlay) {
    const geometry = label.path === 'closure'
        ? overlay.closureGeometry.coordinates
        : overlay.detourGeometry.coordinates;
    const anchor = findNearestRouteAnchor(geometry, label.position);
    if (!anchor) return null;
    const start = geometry[anchor.segmentIndex];
    const end = geometry[anchor.segmentIndex + 1];
    return {
        position: anchor.coordinate,
        angle: start && end ? getSegmentLabelAngle(start, end) : 0,
    };
}

function buildStreetLabelGeoJson(overlay: DetourRouteOverlay, includeDraft = false) {
    const labels = (overlay.streetLabels ?? []).flatMap(label => {
        if ((!label.confirmed && !includeDraft) || !label.visible || !label.streetName.trim()) return [];
        const placement = getStreetLabelPlacement(label, overlay);
        return placement ? [{ id: label.id, position: placement.position, label, angle: placement.angle }] : [];
    });
    return buildDetourPointsGeoJson(labels, item => ({
        id: item.id,
        path: item.label.path,
        label: streetLabelText(item.label),
        angle: item.angle,
        confirmed: item.label.confirmed,
    }));
}

function buildBackgroundGeoJson(routes: DetourBackgroundRoute[]) {
    return {
        type: 'FeatureCollection' as const,
        features: routes.filter(({ coordinates }) => coordinates.length >= 2).map((route) => ({
            type: 'Feature' as const,
            geometry: {
                type: 'LineString' as const,
                coordinates: route.coordinates.map(({ longitude, latitude }) => [longitude, latitude]),
            },
            properties: { id: route.id, color: route.color ?? '#94a3b8' },
        })),
    };
}

function buildVisibleOriginalGeoJson(overlay: DetourRouteOverlay) {
    const split = overlay.closureStart && overlay.closureEnd
        ? splitDetourRoute(
            overlay.routeSnapshot.originalGeometry,
            overlay.closureStart,
            overlay.closureEnd,
            overlay.routeSnapshot.isLoop,
        )
        : null;
    const visibleSegments = split
        ? [split.before, split.after]
        : [overlay.routeSnapshot.originalGeometry];
    const properties = {
        overlayId: overlay.id,
        color: overlay.routeSnapshot.routeColor || '#64748b',
    };

    return {
        type: 'FeatureCollection' as const,
        features: visibleSegments.flatMap((coordinates) => (
            buildDetourLineGeoJson(coordinates, properties).features
        )),
    };
}

function stopImpactPosition(impact: DetourStopImpact): DetourCoordinate | null {
    return impact.status === 'temporary'
        ? impact.temporaryStopPosition ?? null
        : impact.sourceStop?.position ?? null;
}

function getFitCoordinates(props: Pick<DetourMapCanvasProps, 'overlay' | 'additionalOverlays' | 'labels' | 'walkingGeometry' | 'stopClosureMarkers'>): DetourCoordinate[] {
    const allOverlays = [props.overlay, ...(props.additionalOverlays ?? [])];
    return [
        ...allOverlays.flatMap((item) => {
            const noticeGeometry = [
                ...item.closureGeometry.coordinates,
                ...item.detourGeometry.coordinates,
            ];
            return [
                ...(noticeGeometry.length ? noticeGeometry : item.routeSnapshot.originalGeometry),
                ...(item.streetLabels ?? []).filter(label => label.confirmed && label.visible).map(({ position }) => position),
                ...item.labels.map(({ position }) => position),
                ...item.stopImpacts.flatMap((impact) => {
                const position = stopImpactPosition(impact);
                return position ? [position] : [];
                }),
            ];
        }),
        ...(props.walkingGeometry?.coordinates ?? []),
        ...(props.stopClosureMarkers?.closed ? [props.stopClosureMarkers.closed.position] : []),
        ...(props.stopClosureMarkers?.replacement ? [props.stopClosureMarkers.replacement.position] : []),
        ...(props.labels ?? []).map(({ position }) => position),
    ];
}

export const DetourMapCanvas = forwardRef<DetourMapCanvasHandle, DetourMapCanvasProps>((props, ref) => {
    const {
        overlay,
        additionalOverlays = [],
        backgroundRoutes = [],
        mode = 'select',
        publicationMode = false,
        selectedItem,
        labels: labelsOverride,
        className,
        style,
    } = props;
    const mapRef = useRef<MapRef | null>(null);
    const labels = labelsOverride ?? overlay.labels;

    const backgroundGeoJson = useMemo(() => buildBackgroundGeoJson(backgroundRoutes), [backgroundRoutes]);
    const originalGeoJson = useMemo(() => buildVisibleOriginalGeoJson(overlay), [overlay]);
    const bypassGeoJson = useMemo(() => buildDetourLineGeoJson(
        overlay.closureGeometry.coordinates,
        { overlayId: overlay.id },
    ), [overlay]);
    const activeGeoJson = useMemo(() => buildDetourLineGeoJson(
        overlay.detourGeometry.coordinates,
        {
            overlayId: overlay.id,
            color: overlay.routeSnapshot.routeColor || '#2563eb',
            routeLabel: overlay.routeSnapshot.routeShortName,
        },
    ), [overlay]);
    const routeBadgeGeoJson = useMemo(() => buildRouteBadgeGeoJson(overlay, !publicationMode), [overlay, publicationMode]);
    const routeNumberGeoJson = useMemo(() => buildRouteNumberGeoJson(overlay), [overlay]);
    const routeNumberPlacement = useMemo(() => getRouteNumberPlacement(overlay), [overlay]);
    const closureLabelGeoJson = useMemo(() => buildClosureLabelGeoJson(overlay, !publicationMode), [overlay, publicationMode]);
    const streetLabelGeoJson = useMemo(() => buildStreetLabelGeoJson(overlay, !publicationMode), [overlay, publicationMode]);
    const stopGeoJson = useMemo(() => buildDetourPointsGeoJson(
        overlay.stopImpacts.flatMap((impact) => {
            const position = stopImpactPosition(impact);
            return position ? [{ id: impact.id, position, impact }] : [];
        }),
        ({ impact }) => ({
            id: impact.id,
            status: impact.status,
            reviewed: impact.reviewed,
            label: impact.status === 'temporary'
                ? [impact.temporaryStopCode?.trim(), (impact.temporaryStopName ?? 'Temporary stop').trim().toUpperCase()].filter(Boolean).join(' · ')
                : impact.status === 'closed'
                    ? impact.sourceStop?.stopCode
                        ? `STOP ${impact.sourceStop.stopCode} CLOSED`
                        : `${impact.sourceStop?.name ?? 'STOP'} CLOSED`
                    : impact.sourceStop?.stopCode ?? impact.sourceStop?.name ?? 'Stop',
        }),
    ), [overlay.stopImpacts]);
    const labelGeoJson = useMemo(() => buildDetourPointsGeoJson(
        labels,
        (label) => ({ id: label.id, label: label.text }),
    ), [labels]);
    const walkingGeoJson = useMemo(() => buildDetourLineGeoJson(
        props.walkingGeometry?.coordinates ?? [],
    ), [props.walkingGeometry]);
    const stopClosureGeoJson = useMemo(() => buildDetourPointsGeoJson(
        [props.stopClosureMarkers?.closed, props.stopClosureMarkers?.replacement]
            .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        (item) => ({
            id: item.id,
            label: item.label,
            status: item === props.stopClosureMarkers?.closed ? 'closed' : 'temporary',
        }),
    ), [props.stopClosureMarkers]);

    const fitToNotice = useCallback(() => {
        const coordinates = getFitCoordinates(props);
        if (!coordinates.length || !mapRef.current) return;
        const longitudes = coordinates.map(({ longitude }) => longitude);
        const latitudes = coordinates.map(({ latitude }) => latitude);
        mapRef.current.fitBounds([
            [Math.min(...longitudes), Math.min(...latitudes)],
            [Math.max(...longitudes), Math.max(...latitudes)],
        ], {
            padding: { top: 88, right: 88, bottom: 88, left: 88 },
            maxZoom: 16,
            bearing: 0,
            pitch: 0,
            duration: 0,
        });
    }, [props]);

    const captureImage = useCallback(async (mimeType: 'image/png' | 'image/jpeg' = 'image/png', quality?: number) => {
        try {
            const map = mapRef.current?.getMap();
            if (!map) return null;
            await new Promise<void>((resolve) => {
                let settled = false;
                let timeoutId: number | undefined;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
                    resolve();
                };
                map.once('idle', finish);
                map.triggerRepaint();
                timeoutId = window.setTimeout(finish, 1200);
                if (map.loaded() && map.areTilesLoaded()) {
                    requestAnimationFrame(() => requestAnimationFrame(finish));
                }
            });
            const dataUrl = map.getCanvas().toDataURL(mimeType, quality);
            if (dataUrl) props.onCaptureImage?.(dataUrl);
            return dataUrl;
        } catch (error) {
            console.error('Unable to capture detour map image', error);
            return null;
        }
    }, [props]);

    const handleMapLoad = useCallback(() => {
        const map = mapRef.current?.getMap();
        for (const layer of map?.getStyle().layers ?? []) {
            if (layer.type !== 'symbol' || layer.id.startsWith('detour-')) continue;
            const layout = (layer as { layout?: Record<string, unknown> }).layout;
            if (!layout || !('text-field' in layout)) continue;
            const opacity = layer.id.includes('road-label') ? 0.58 : 0.3;
            try {
                map?.setPaintProperty(layer.id, 'text-opacity', opacity);
            } catch {
                // Some third-party style layers do not expose text opacity.
            }
        }
        fitToNotice();
    }, [fitToNotice]);

    useImperativeHandle(ref, () => ({ fitToNotice, captureImage }), [captureImage, fitToNotice]);

    const handleMapClick = useCallback((event: MapMouseEvent) => {
        const feature = event.features?.[0];
        if (feature?.layer.id === STOPS_LAYER_ID) {
            const id = String(feature.properties?.id ?? '');
            if (id) props.onSelectItem?.({ type: 'stop-impact', id });
            return;
        }
        const coordinate = coordinateFromEvent(event);
        if (mode === 'closure-start' || mode === 'closure-end') {
            const anchor = findNearestRouteAnchor(overlay.routeSnapshot.originalGeometry, coordinate);
            if (!anchor) return;
            if (mode === 'closure-start') props.onSelectClosureStart(anchor);
            else props.onSelectClosureEnd(anchor);
        } else if (mode === 'add-waypoint') {
            props.onAddWaypoint(coordinate);
        } else if (mode === 'add-temporary-stop') {
            props.onAddTemporaryStop(coordinate);
        } else if (mode === 'select' && feature?.layer.id === DETOUR_HIT_LAYER_ID) {
            props.onInsertDetourWaypoint(coordinate);
        } else if (mode === 'select' && feature?.layer.id === BYPASS_HIT_LAYER_ID) {
            props.onAddClosureWaypoint(coordinate);
        } else {
            props.onSelectItem?.(null);
        }
    }, [mode, overlay.routeSnapshot.originalGeometry, props]);

    const manualWarning = overlay.detourGeometry.source === 'manual'
        && !overlay.detourGeometry.manualRoutingAcknowledged;
    const selectedImpact = selectedItem?.type === 'stop-impact'
        ? overlay.stopImpacts.find(({ id }) => id === selectedItem.id)
        : undefined;

    return (
        <section className={`relative min-h-[480px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ${className ?? ''}`} style={style}>
            <MapBase
                mapRef={mapRef}
                longitude={props.mapFrame?.center.longitude}
                latitude={props.mapFrame?.center.latitude}
                zoom={props.mapFrame?.zoom}
                preserveDrawingBuffer
                interactive={!publicationMode}
                showNavigation={!publicationMode}
                showScale={!publicationMode}
                className="h-full min-h-[480px]"
                interactiveLayerIds={[STOPS_LAYER_ID, DETOUR_HIT_LAYER_ID, BYPASS_HIT_LAYER_ID]}
                onClick={handleMapClick}
                onMoveEnd={publicationMode ? undefined : (event) => props.onMapFrameChange?.({
                    center: { latitude: event.viewState.latitude, longitude: event.viewState.longitude },
                    zoom: event.viewState.zoom,
                    bearing: event.viewState.bearing,
                    pitch: event.viewState.pitch,
                })}
                onLoad={handleMapLoad}
            >
                <Source id="detour-background-source" type="geojson" data={backgroundGeoJson}>
                    <Layer {...backgroundLayer} />
                </Source>
                <Source id="detour-original-source" type="geojson" data={originalGeoJson}>
                    <Layer {...originalCasingLayer} />
                    <Layer {...originalLayer} />
                </Source>
                {additionalOverlays.map((additional, index) => {
                    const prefix = `detour-additional-${index}`;
                    const extraStops = buildDetourPointsGeoJson(
                        additional.stopImpacts.flatMap((impact) => {
                            const position = stopImpactPosition(impact);
                            return position ? [{ id: impact.id, position, impact }] : [];
                        }),
                        ({ impact }) => ({
                            id: impact.id,
                            status: impact.status,
                            label: impact.status === 'temporary'
                                ? [impact.temporaryStopCode?.trim(), (impact.temporaryStopName ?? 'Temporary stop').trim().toUpperCase()].filter(Boolean).join(' · ')
                                : impact.status === 'closed'
                                    ? impact.sourceStop?.stopCode
                                        ? `STOP ${impact.sourceStop.stopCode} CLOSED`
                                        : `${impact.sourceStop?.name ?? 'STOP'} CLOSED`
                                    : impact.sourceStop?.stopCode ?? impact.sourceStop?.name ?? 'Stop',
                        }),
                    );
                    return (
                        <Fragment key={additional.id}>
                            <Source id={`${prefix}-original-source`} type="geojson" data={buildVisibleOriginalGeoJson(additional)}>
                                <Layer {...originalCasingLayer} id={`${prefix}-original-casing`} />
                                <Layer {...originalLayer} id={`${prefix}-original-line`} />
                            </Source>
                            <Source id={`${prefix}-closure-source`} type="geojson" data={buildDetourLineGeoJson(additional.closureGeometry.coordinates)}>
                                <Layer {...bypassLayer} id={`${prefix}-closure-line`} />
                            </Source>
                            <Source id={`${prefix}-closure-label-source`} type="geojson" data={buildClosureLabelGeoJson(additional, !publicationMode)}>
                                <Layer {...bypassLabelLayer} id={`${prefix}-closure-label`} />
                            </Source>
                            <Source id={`${prefix}-active-source`} type="geojson" data={buildDetourLineGeoJson(additional.detourGeometry.coordinates, {
                                color: additional.routeSnapshot.routeColor || '#2563eb',
                                routeLabel: additional.routeSnapshot.routeShortName,
                            })}>
                                <Layer {...detourWarningOutlineLayer} id={`${prefix}-warning-outline`} />
                                <Layer {...detourCasingLayer} id={`${prefix}-casing-line`} />
                                <Layer {...detourLayer} id={`${prefix}-active-line`} />
                                <Layer {...directionArrowLayer} id={`${prefix}-arrows`} />
                            </Source>
                            <Source id={`${prefix}-route-badge-source`} type="geojson" data={buildRouteBadgeGeoJson(additional, !publicationMode)}>
                                <Layer {...routeBadgeLayer} id={`${prefix}-route-badge`} />
                            </Source>
                            <Source id={`${prefix}-route-number-source`} type="geojson" data={buildRouteNumberGeoJson(additional)}>
                                <Layer {...routeNumberCasingLayer} id={`${prefix}-route-number-casing`} />
                                <Layer {...routeNumberLabelLayer} id={`${prefix}-route-number`} />
                            </Source>
                            <Source id={`${prefix}-street-label-source`} type="geojson" data={buildStreetLabelGeoJson(additional, !publicationMode)}>
                                <Layer {...closureStreetLabelLayer} id={`${prefix}-closure-street-labels`} />
                                <Layer {...detourStreetLabelLayer} id={`${prefix}-detour-street-labels`} />
                            </Source>
                            <Source id={`${prefix}-stops-source`} type="geojson" data={extraStops}>
                                <Layer {...stopLayer} id={`${prefix}-stops`} />
                                <Layer {...regularStopLabelLayer} id={`${prefix}-stop-labels`} />
                                <Layer {...closedStopLabelLayer} id={`${prefix}-closed-stop-labels`} />
                                <Layer {...temporaryStopLabelLayer} id={`${prefix}-temporary-stop-labels`} />
                            </Source>
                            <Source id={`${prefix}-labels-source`} type="geojson" data={buildDetourPointsGeoJson(
                                additional.labels,
                                (label) => ({ id: label.id, label: label.text }),
                            )}>
                                <Layer {...annotationLabelLayer} id={`${prefix}-labels`} />
                            </Source>
                        </Fragment>
                    );
                })}
                <Source id="detour-bypassed-source" type="geojson" data={bypassGeoJson}>
                    {!publicationMode && <Layer {...editableLineHitLayer} id={BYPASS_HIT_LAYER_ID} />}
                    <Layer {...bypassLayer} />
                </Source>
                <Source id="detour-bypassed-label-source" type="geojson" data={closureLabelGeoJson}>
                    <Layer {...bypassLabelLayer} />
                </Source>
                <Source id="detour-active-source" type="geojson" data={activeGeoJson}>
                    {!publicationMode && <Layer {...editableLineHitLayer} id={DETOUR_HIT_LAYER_ID} />}
                    <Layer {...detourWarningOutlineLayer} />
                    <Layer {...detourCasingLayer} />
                    <Layer {...detourLayer} />
                    <Layer {...directionArrowLayer} />
                </Source>
                <Source id="detour-route-badge-source" type="geojson" data={routeBadgeGeoJson}>
                    <Layer {...routeBadgeLayer} />
                </Source>
                <Source id="detour-route-number-source" type="geojson" data={routeNumberGeoJson}>
                    <Layer {...routeNumberCasingLayer} />
                    <Layer {...routeNumberLabelLayer} />
                </Source>
                <Source id="detour-street-label-source" type="geojson" data={streetLabelGeoJson}>
                    <Layer {...closureStreetLabelLayer} />
                    <Layer {...detourStreetLabelLayer} />
                </Source>
                <Source id="detour-stop-source" type="geojson" data={stopGeoJson}>
                    <Layer {...stopLayer} />
                    <Layer {...regularStopLabelLayer} />
                    <Layer {...closedStopLabelLayer} />
                    <Layer {...temporaryStopLabelLayer} />
                </Source>
                <Source id="detour-label-source" type="geojson" data={labelGeoJson}>
                    <Layer {...annotationLabelLayer} />
                </Source>
                <Source id="detour-walking-source" type="geojson" data={walkingGeoJson}>
                    <Layer {...walkingLayer} />
                </Source>
                <Source id="detour-stop-closure-source" type="geojson" data={stopClosureGeoJson}>
                    <Layer {...stopLayer} id="detour-stop-closure-markers" />
                    <Layer {...regularStopLabelLayer} id="detour-stop-closure-labels" />
                    <Layer {...closedStopLabelLayer} id="detour-stop-closure-closed-labels" />
                    <Layer {...temporaryStopLabelLayer} id="detour-stop-closure-temporary-labels" />
                </Source>

                {!publicationMode && overlay.detourWaypoints.map((coordinate, index) => {
                    const isStart = index === 0;
                    const isEnd = index === overlay.detourWaypoints.length - 1;
                    const isEndpoint = isStart || isEnd;
                    return (
                        <Marker
                            key={`waypoint-${index}`}
                            longitude={coordinate.longitude}
                            latitude={coordinate.latitude}
                            draggable
                            anchor="center"
                            onDragEnd={(event) => props.onMoveWaypoint(index, coordinateFromEvent(event))}
                        >
                            <button
                                type="button"
                                aria-label={isStart ? 'Diversion junction' : isEnd ? 'Rejoin junction' : `Detour waypoint ${index + 1}`}
                                title={isEndpoint ? 'Shared junction for the active route, closed section, and detour path' : 'Detour path anchor'}
                                className={`h-4 w-4 rotate-45 rounded-[2px] border-2 border-white shadow ring-2 ${
                                    selectedItem?.type === 'waypoint' && selectedItem.index === index
                                        ? isEndpoint ? 'bg-blue-700 ring-blue-300' : 'bg-orange-600 ring-orange-300'
                                        : isEndpoint ? 'bg-blue-600 ring-blue-200' : 'bg-orange-500 ring-orange-200'
                                }`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    props.onSelectItem?.({ type: 'waypoint', index });
                                }}
                                onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    if (!isEndpoint) props.onDeleteWaypoint(index);
                                }}
                            />
                        </Marker>
                    );
                })}

                {!publicationMode && routeNumberPlacement && props.onMoveRouteLabel && (
                    <Marker
                        longitude={routeNumberPlacement.position.longitude}
                        latitude={routeNumberPlacement.position.latitude}
                        draggable
                        anchor="center"
                        onDragEnd={(event) => props.onMoveRouteLabel?.(coordinateFromEvent(event))}
                    >
                        <button
                            type="button"
                            aria-label={`Move route ${overlay.routeSnapshot.routeShortName} label`}
                            title={`Drag to move route ${overlay.routeSnapshot.routeShortName} label`}
                            className="h-3 w-3 -translate-y-5 cursor-move rounded-full border-2 border-white bg-violet-600 shadow ring-2 ring-violet-200"
                        />
                    </Marker>
                )}

                {!publicationMode && props.onMoveStreetLabel && (overlay.streetLabels ?? [])
                    .filter(label => label.visible && label.streetName.trim())
                    .map(label => {
                        const placement = getStreetLabelPlacement(label, overlay);
                        if (!placement) return null;
                        return (
                            <Marker
                                key={`street-label-${label.id}`}
                                longitude={placement.position.longitude}
                                latitude={placement.position.latitude}
                                draggable
                                anchor="center"
                                onDragEnd={(event) => props.onMoveStreetLabel?.(label.id, coordinateFromEvent(event))}
                            >
                                <button
                                    type="button"
                                    aria-label={`Move ${streetLabelText(label)} label`}
                                    title="Drag to reposition this public street label"
                                    className={`h-3 w-3 -translate-y-6 cursor-move rounded-full border-2 border-white shadow ring-2 ${
                                        label.path === 'closure'
                                            ? 'bg-red-600 ring-red-200'
                                            : 'bg-orange-500 ring-orange-200'
                                    }`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        props.onSelectItem?.({ type: 'street-label', id: label.id });
                                    }}
                                />
                            </Marker>
                        );
                    })}

                {!publicationMode && overlay.closureWaypoints.map((coordinate, index) => (
                    <Marker
                        key={`closure-waypoint-${index}`}
                        longitude={coordinate.longitude}
                        latitude={coordinate.latitude}
                        draggable
                        anchor="center"
                        onDragEnd={(event) => props.onMoveClosureWaypoint(index, coordinateFromEvent(event))}
                    >
                        <button
                            type="button"
                            aria-label={`Closed-section anchor ${index + 1}`}
                            className={`h-4 w-4 rotate-45 rounded-[2px] border-2 border-white shadow ring-2 ${
                                selectedItem?.type === 'closure-waypoint' && selectedItem.index === index
                                    ? 'bg-red-700 ring-red-300'
                                    : 'bg-red-500 ring-red-200'
                            }`}
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onSelectItem?.({ type: 'closure-waypoint', index });
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                props.onDeleteClosureWaypoint(index);
                            }}
                        />
                    </Marker>
                ))}

                {!publicationMode && overlay.stopImpacts.filter((impact) => impact.status === 'temporary' && impact.temporaryStopPosition).map((impact) => (
                    <Marker
                        key={`temporary-${impact.id}`}
                        longitude={impact.temporaryStopPosition!.longitude}
                        latitude={impact.temporaryStopPosition!.latitude}
                        draggable
                        anchor="center"
                        onDragEnd={(event) => props.onMoveTemporaryStop(impact.id, coordinateFromEvent(event))}
                    >
                        <button
                            type="button"
                            aria-label={`Move ${impact.temporaryStopName ?? 'temporary stop'}`}
                            className="h-6 w-6 cursor-move rounded-full bg-transparent"
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onSelectItem?.({ type: 'stop-impact', id: impact.id });
                            }}
                        />
                    </Marker>
                ))}

                {!publicationMode && labels.map((label) => (
                    <Marker
                        key={label.id}
                        longitude={label.position.longitude}
                        latitude={label.position.latitude}
                        draggable={Boolean(props.onMoveLabel)}
                        anchor="center"
                        onDragEnd={(event) => props.onMoveLabel?.(label.id, coordinateFromEvent(event))}
                    >
                        <button
                            type="button"
                            className="rounded-md border border-gray-300 bg-white/95 px-2 py-1 text-xs font-bold text-gray-800 shadow-sm"
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onSelectItem?.({ type: 'label', id: label.id });
                            }}
                        >
                            {label.text}
                        </button>
                    </Marker>
                ))}
            </MapBase>

            {!publicationMode && <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white/95 p-2 shadow-sm backdrop-blur">
                <span className="flex items-center gap-1.5 border-r border-gray-200 pr-2 text-xs font-bold text-gray-700">
                    <Route className="h-4 w-4 text-blue-600" />
                    {overlay.routeSnapshot.routeShortName} · {overlay.routeSnapshot.directionLabel}
                </span>
                <button type="button" onClick={fitToNotice} className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100" aria-label="Fit notice to map">
                    <LocateFixed className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => captureImage()} className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100" aria-label="Capture map image">
                    <Camera className="h-4 w-4" />
                </button>
            </div>}

            {!publicationMode && manualWarning && (
                <div role="alert" className="absolute bottom-8 left-3 max-w-sm rounded-lg border border-amber-300 bg-amber-50/95 p-3 text-xs font-semibold text-amber-900 shadow-md backdrop-blur">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <span>Manual line: road snapping was unavailable. Review bus suitability and acknowledge this routing before export.</span>
                    </div>
                </div>
            )}
            {!publicationMode && selectedImpact && (
                <div className="absolute bottom-8 right-3 w-64 rounded-lg border border-gray-200 bg-white/95 p-3 shadow-md backdrop-blur">
                    <div className="text-xs font-bold text-gray-900">
                        {selectedImpact.sourceStop?.name ?? selectedImpact.temporaryStopName ?? 'Stop impact'}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1" aria-label="Confirm stop impact">
                        {(['open', 'closed', 'temporary'] as const).map((status) => (
                            <button
                                key={status}
                                type="button"
                                onClick={() => props.onConfirmStopImpact(selectedImpact.id, status)}
                                className={`rounded-md px-2 py-1.5 text-[11px] font-bold capitalize ${
                                    selectedImpact.status === status
                                        ? 'bg-gray-900 text-white'
                                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
});

DetourMapCanvas.displayName = 'DetourMapCanvas';
