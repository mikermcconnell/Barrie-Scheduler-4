import {
    Fragment,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    type CSSProperties,
} from 'react';
import { AlertTriangle, Camera, LocateFixed, MapPin, Route } from 'lucide-react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef, MarkerDragEvent } from 'react-map-gl/mapbox';

import { MapBase } from '../shared/MapBase';
import type {
    DetourCoordinate,
    DetourMapFrame,
    DetourLineGeometry,
    DetourMapLabel as DetourDomainMapLabel,
    DetourRouteOverlay,
    DetourStopImpact,
} from '../../utils/detours/detourTypes';
import {
    buildDetourLineGeoJson,
    buildDetourPointsGeoJson,
    findNearestRouteAnchor,
    type DetourRouteAnchor,
} from '../../utils/detours/detourGeometry';

const ORIGINAL_LINE_ID = 'detour-original-line';
const BYPASS_LINE_ID = 'detour-bypassed-line';
const DETOUR_LINE_ID = 'detour-active-line';
const STOPS_LAYER_ID = 'detour-stops';
const CLOSURES_LAYER_ID = 'detour-closure-markers';

export type DetourMapMode = 'select' | 'closure-start' | 'closure-end' | 'add-waypoint' | 'add-temporary-stop';
export type DetourMapSelection =
    | { type: 'stop-impact'; id: string }
    | { type: 'waypoint'; index: number }
    | { type: 'closure-start' | 'closure-end' }
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
    captureImage: (mimeType?: 'image/png' | 'image/jpeg', quality?: number) => string | null;
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
    selectedItem?: DetourMapSelection;
    closureStart?: DetourRouteAnchor | null;
    closureEnd?: DetourRouteAnchor | null;
    labels?: DetourMapLabel[];
    className?: string;
    style?: CSSProperties;
    onSelectClosureStart: (anchor: DetourRouteAnchor) => void;
    onSelectClosureEnd: (anchor: DetourRouteAnchor) => void;
    onAddWaypoint: (coordinate: DetourCoordinate) => void;
    onMoveWaypoint: (index: number, coordinate: DetourCoordinate) => void;
    onDeleteWaypoint: (index: number) => void;
    onAddTemporaryStop: (coordinate: DetourCoordinate) => void;
    onMoveTemporaryStop: (impactId: string, coordinate: DetourCoordinate) => void;
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
        'symbol-spacing': 72,
        'text-field': '›',
        'text-size': 28,
        'text-rotation-alignment': 'map',
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 2 },
};

const routeBadgeLayer: LayerProps = {
    id: 'detour-route-badge',
    type: 'symbol',
    layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'routeLabel'],
        'text-size': 13,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
    },
    paint: {
        'text-color': '#ffffff',
        'text-halo-color': ['get', 'color'],
        'text-halo-width': 6,
    },
};

const stopLayer: LayerProps = {
    id: STOPS_LAYER_ID,
    type: 'circle',
    paint: {
        'circle-radius': ['case', ['==', ['get', 'status'], 'temporary'], 7, 6],
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
        'text-size': 11,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
        'text-optional': true,
    },
    paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
};

const closureMarkerLayer: LayerProps = {
    id: CLOSURES_LAYER_ID,
    type: 'circle',
    paint: {
        'circle-radius': 9,
        'circle-color': '#dc2626',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
    },
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

function stopImpactPosition(impact: DetourStopImpact): DetourCoordinate | null {
    return impact.status === 'temporary'
        ? impact.temporaryStopPosition ?? null
        : impact.sourceStop?.position ?? null;
}

function getFitCoordinates(props: Pick<DetourMapCanvasProps, 'overlay' | 'additionalOverlays' | 'labels' | 'walkingGeometry' | 'stopClosureMarkers'>): DetourCoordinate[] {
    const allOverlays = [props.overlay, ...(props.additionalOverlays ?? [])];
    return [
        ...allOverlays.flatMap((item) => [
            ...item.routeSnapshot.originalGeometry,
            ...item.detourGeometry.coordinates,
            ...item.closureGeometry.coordinates,
            ...item.labels.map(({ position }) => position),
            ...item.stopImpacts.flatMap((impact) => {
                const position = stopImpactPosition(impact);
                return position ? [position] : [];
            }),
        ]),
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
        selectedItem,
        closureStart: closureStartOverride,
        closureEnd: closureEndOverride,
        labels: labelsOverride,
        className,
        style,
    } = props;
    const mapRef = useRef<MapRef | null>(null);
    const closureStart = closureStartOverride === undefined ? overlay.closureStart : closureStartOverride;
    const closureEnd = closureEndOverride === undefined ? overlay.closureEnd : closureEndOverride;
    const labels = labelsOverride ?? overlay.labels;

    const backgroundGeoJson = useMemo(() => buildBackgroundGeoJson(backgroundRoutes), [backgroundRoutes]);
    const originalGeoJson = useMemo(() => buildDetourLineGeoJson(
        overlay.routeSnapshot.originalGeometry,
        { overlayId: overlay.id, color: overlay.routeSnapshot.routeColor || '#64748b' },
    ), [overlay]);
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
                ? impact.temporaryStopName ?? 'Temporary stop'
                : impact.sourceStop?.stopCode ?? impact.sourceStop?.name ?? 'Stop',
        }),
    ), [overlay.stopImpacts]);
    const closureGeoJson = useMemo(() => buildDetourPointsGeoJson(
        [
            ...(closureStart ? [{ id: 'start', position: closureStart.coordinate }] : []),
            ...(closureEnd ? [{ id: 'end', position: closureEnd.coordinate }] : []),
        ],
        ({ id }) => ({ id }),
    ), [closureEnd, closureStart]);
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
        ], { padding: 72, maxZoom: 16, duration: 0 });
    }, [props]);

    const captureImage = useCallback((mimeType: 'image/png' | 'image/jpeg' = 'image/png', quality?: number) => {
        try {
            const dataUrl = mapRef.current?.getCanvas().toDataURL(mimeType, quality) ?? null;
            if (dataUrl) props.onCaptureImage?.(dataUrl);
            return dataUrl;
        } catch (error) {
            console.error('Unable to capture detour map image', error);
            return null;
        }
    }, [props]);

    useImperativeHandle(ref, () => ({ fitToNotice, captureImage }), [captureImage, fitToNotice]);

    const handleMapClick = useCallback((event: MapMouseEvent) => {
        const feature = event.features?.[0];
        if (feature?.layer.id === STOPS_LAYER_ID) {
            const id = String(feature.properties?.id ?? '');
            if (id) props.onSelectItem?.({ type: 'stop-impact', id });
            return;
        }
        if (feature?.layer.id === CLOSURES_LAYER_ID) {
            const type = feature.properties?.id === 'start' ? 'closure-start' : 'closure-end';
            props.onSelectItem?.({ type });
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
                showNavigation
                showScale
                className="h-full min-h-[480px]"
                interactiveLayerIds={[STOPS_LAYER_ID, CLOSURES_LAYER_ID]}
                onClick={handleMapClick}
                onMoveEnd={(event) => props.onMapFrameChange?.({
                    center: { latitude: event.viewState.latitude, longitude: event.viewState.longitude },
                    zoom: event.viewState.zoom,
                    bearing: event.viewState.bearing,
                    pitch: event.viewState.pitch,
                })}
                onLoad={fitToNotice}
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
                        ({ impact }) => ({ id: impact.id, status: impact.status, label: impact.sourceStop?.stopCode ?? impact.temporaryStopName ?? '' }),
                    );
                    return (
                        <Fragment key={additional.id}>
                            <Source id={`${prefix}-original-source`} type="geojson" data={buildDetourLineGeoJson(additional.routeSnapshot.originalGeometry, { color: additional.routeSnapshot.routeColor || '#64748b' })}>
                                <Layer {...originalCasingLayer} id={`${prefix}-original-casing`} />
                                <Layer {...originalLayer} id={`${prefix}-original-line`} />
                            </Source>
                            <Source id={`${prefix}-closure-source`} type="geojson" data={buildDetourLineGeoJson(additional.closureGeometry.coordinates)}>
                                <Layer {...bypassLayer} id={`${prefix}-closure-line`} />
                            </Source>
                            <Source id={`${prefix}-active-source`} type="geojson" data={buildDetourLineGeoJson(additional.detourGeometry.coordinates, {
                                color: additional.routeSnapshot.routeColor || '#2563eb',
                                routeLabel: additional.routeSnapshot.routeShortName,
                            })}>
                                <Layer {...detourCasingLayer} id={`${prefix}-casing-line`} />
                                <Layer {...detourLayer} id={`${prefix}-active-line`} />
                                <Layer {...directionArrowLayer} id={`${prefix}-arrows`} />
                                <Layer {...routeBadgeLayer} id={`${prefix}-route-badge`} />
                            </Source>
                            <Source id={`${prefix}-stops-source`} type="geojson" data={extraStops}>
                                <Layer {...stopLayer} id={`${prefix}-stops`} />
                                <Layer {...stopLabelLayer} id={`${prefix}-stop-labels`} />
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
                    <Layer {...bypassLayer} />
                </Source>
                <Source id="detour-active-source" type="geojson" data={activeGeoJson}>
                    <Layer {...detourCasingLayer} />
                    <Layer {...detourLayer} />
                    <Layer {...directionArrowLayer} />
                    <Layer {...routeBadgeLayer} />
                </Source>
                <Source id="detour-stop-source" type="geojson" data={stopGeoJson}>
                    <Layer {...stopLayer} />
                    <Layer {...stopLabelLayer} />
                </Source>
                <Source id="detour-closure-source" type="geojson" data={closureGeoJson}>
                    <Layer {...closureMarkerLayer} />
                </Source>
                <Source id="detour-label-source" type="geojson" data={labelGeoJson}>
                    <Layer {...annotationLabelLayer} />
                </Source>
                <Source id="detour-walking-source" type="geojson" data={walkingGeoJson}>
                    <Layer {...walkingLayer} />
                </Source>
                <Source id="detour-stop-closure-source" type="geojson" data={stopClosureGeoJson}>
                    <Layer {...stopLayer} id="detour-stop-closure-markers" />
                    <Layer {...stopLabelLayer} id="detour-stop-closure-labels" />
                </Source>

                {overlay.detourWaypoints.map((coordinate, index) => (
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
                            aria-label={`Detour waypoint ${index + 1}`}
                            className={`h-4 w-4 rounded-full border-2 border-white shadow ring-2 ${
                                selectedItem?.type === 'waypoint' && selectedItem.index === index
                                    ? 'bg-blue-600 ring-blue-300'
                                    : 'bg-slate-700 ring-slate-300'
                            }`}
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onSelectItem?.({ type: 'waypoint', index });
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                props.onDeleteWaypoint(index);
                            }}
                        />
                    </Marker>
                ))}

                {overlay.stopImpacts.filter((impact) => impact.status === 'temporary' && impact.temporaryStopPosition).map((impact) => (
                    <Marker
                        key={`temporary-${impact.id}`}
                        longitude={impact.temporaryStopPosition!.longitude}
                        latitude={impact.temporaryStopPosition!.latitude}
                        draggable
                        anchor="bottom"
                        onDragEnd={(event) => props.onMoveTemporaryStop(impact.id, coordinateFromEvent(event))}
                    >
                        <button
                            type="button"
                            aria-label={`Move ${impact.temporaryStopName ?? 'temporary stop'}`}
                            className="rounded-full border-2 border-white bg-green-600 p-1 text-white shadow-md"
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onSelectItem?.({ type: 'stop-impact', id: impact.id });
                            }}
                        >
                            <MapPin className="h-4 w-4" />
                        </button>
                    </Marker>
                ))}

                {labels.map((label) => (
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

            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white/95 p-2 shadow-sm backdrop-blur">
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
            </div>

            {manualWarning && (
                <div role="alert" className="absolute bottom-8 left-3 max-w-sm rounded-lg border border-amber-300 bg-amber-50/95 p-3 text-xs font-semibold text-amber-900 shadow-md backdrop-blur">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <span>Manual line: road snapping was unavailable. Review bus suitability and acknowledge this routing before export.</span>
                    </div>
                </div>
            )}
            {selectedImpact && (
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
