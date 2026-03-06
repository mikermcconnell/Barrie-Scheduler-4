/**
 * OD Pair Map Modal
 *
 * Shows a Mapbox map with animated curved arcs for a single OD pair journey.
 * Arcs draw sequentially leg-by-leg; transfer markers appear as each leg completes.
 * Falls back to info-only when geocodes are missing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Marker, Source } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import { CheckCircle2, AlertTriangle, XCircle, MapPin, Route, ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { MapBase, quadraticBezierArc, toGeoJSON } from '../shared';
import { fmt } from './AnalyticsShared';
import type { GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import type { ODPairRouteMatch, MatchConfidence } from '../../utils/od-matrix/odRouteEstimation';

const ON_TEAL = '#00594C';
const ORIGIN_COLOR = '#2563eb';
const DESTINATION_COLOR = '#dc2626';

const LEG_COLORS = [
    '#2563eb',
    '#7c3aed',
    '#d97706',
    '#0d9488',
    '#e11d48',
];

const CONFIDENCE_COLORS: Record<MatchConfidence, string> = {
    high: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    medium: 'text-amber-700 bg-amber-50 border-amber-200',
    low: 'text-orange-700 bg-orange-50 border-orange-200',
    none: 'text-red-700 bg-red-50 border-red-200',
};

const CONFIDENCE_TINT: Record<MatchConfidence, string> = {
    high: '',
    medium: '',
    low: 'bg-orange-50/40',
    none: 'bg-red-50/30',
};

const ARC_START_DELAY = 500;
const ARC_DRAW_MS = 1000;
const LEG_GAP_MS = 200;

const MODAL_ANIMATION_STYLES = `
@keyframes odFadeInUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
.od-stagger-1 { animation: odFadeInUp 0.35s ease-out 0.05s both; }
.od-stagger-2 { animation: odFadeInUp 0.35s ease-out 0.15s both; }
.od-stagger-3 { animation: odFadeInUp 0.35s ease-out 0.3s both; }
.od-stagger-4 { animation: odFadeInUp 0.35s ease-out 0.45s both; }

.od-map-container .mapboxgl-ctrl-group {
    border: none !important;
    border-radius: 10px !important;
    overflow: hidden !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
}
.od-map-container .mapboxgl-ctrl-group button {
    background: rgba(255,255,255,0.92) !important;
    color: #4b5563 !important;
    transition: background 0.15s, color 0.15s;
}
.od-map-container .mapboxgl-ctrl-group button:hover {
    background: #fff !important;
    color: #111827 !important;
}
`;

interface InfoRowProps {
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
    isLast?: boolean;
}

interface LegDescriptor {
    id: string;
    color: string;
    points: [number, number][];
    revealAtMs: number;
}

function legColor(i: number): string {
    return LEG_COLORS[i % LEG_COLORS.length];
}

function clamp01(value: number): number {
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function resolveGeocode(
    stationName: string,
    geocodeCache: GeocodeCache | null
): GeocodedLocation | null {
    if (!geocodeCache) return null;
    const key = Object.keys(geocodeCache.stations).find(
        (candidate) => candidate.toLowerCase() === stationName.toLowerCase()
    );
    return key ? geocodeCache.stations[key] : null;
}

function ConfidenceIcon({ confidence }: { confidence: MatchConfidence }) {
    if (confidence === 'high') return <CheckCircle2 size={13} />;
    if (confidence === 'none') return <XCircle size={13} />;
    return <AlertTriangle size={13} />;
}

function InfoRow({ icon, label, children, isLast }: InfoRowProps) {
    return (
        <div className={`flex items-start gap-3 py-2.5 ${isLast ? '' : 'border-b border-gray-100/80'}`}>
            <span className="text-gray-400 mt-0.5 shrink-0">{icon}</span>
            <span className="text-gray-500 font-medium text-sm w-24 shrink-0">{label}</span>
            <span className="text-gray-800 text-sm">{children}</span>
        </div>
    );
}

function LabelText({ text }: { text: string }) {
    return (
        <div
            className="absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold text-gray-800"
            style={{ textShadow: '0 0 4px #fff, 0 0 4px #fff, 0 0 8px rgba(255,255,255,0.8)' }}
        >
            {text}
        </div>
    );
}

function CircleMapMarker({ color, label }: { color: string; label: string }) {
    return (
        <div className="relative pointer-events-none" style={{ width: 24, height: 24 }}>
            <div
                className="absolute inset-0 rounded-full"
                style={{ background: color, opacity: 0.15 }}
            />
            <div
                className="absolute rounded-full border-2 border-white"
                style={{
                    width: 16,
                    height: 16,
                    top: 4,
                    left: 4,
                    background: color,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                }}
            />
            <LabelText text={label} />
        </div>
    );
}

function DiamondMapMarker({ color, label }: { color: string; label: string }) {
    return (
        <div className="relative pointer-events-none" style={{ width: 20, height: 20 }}>
            <div
                className="absolute left-1/2 top-1/2 border-2 border-white"
                style={{
                    width: 14,
                    height: 14,
                    background: color,
                    transform: 'translate(-50%, -50%) rotate(45deg)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
            />
            <LabelText text={label} />
        </div>
    );
}

function buildVisibleLine(points: [number, number][], progress: number): [number, number][] {
    if (points.length <= 1) return points;
    if (progress >= 1) return points;

    const maxIndex = points.length - 1;
    const endIndex = Math.max(1, Math.ceil(progress * maxIndex));
    return points.slice(0, endIndex + 1);
}

export const ODPairMapModal: React.FC<{
    pair: ODPairRouteMatch;
    geocodeCache: GeocodeCache | null;
    onClose: () => void;
}> = ({ pair, geocodeCache, onClose }) => {
    const mapRef = useRef<MapRef | null>(null);
    const hasFittedRef = useRef(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [mapReady, setMapReady] = useState(false);

    const originGeo = resolveGeocode(pair.origin, geocodeCache);
    const destGeo = resolveGeocode(pair.destination, geocodeCache);
    const hasCoords = Boolean(originGeo && destGeo);

    const transferStops = useMemo(() => (
        pair.transfer?.transferStops?.length
            ? pair.transfer.transferStops
            : pair.transfer ? [pair.transfer.viaStop] : []
    ), [pair.transfer]);

    const transferGeos = useMemo(() => transferStops
        .map((name) => ({ name, geo: resolveGeocode(name, geocodeCache) }))
        .filter((stop): stop is { name: string; geo: GeocodedLocation } => stop.geo !== null), [geocodeCache, transferStops]);

    const transferRouteNames = useMemo(() => (
        pair.transfer?.legs?.length
            ? pair.transfer.legs.map((leg) => leg.routeName)
            : pair.transfer ? [pair.transfer.leg1RouteName, pair.transfer.leg2RouteName] : []
    ), [pair.transfer]);

    const allPoints = useMemo(() => {
        if (!originGeo || !destGeo) return [] as [number, number][];
        return [
            [originGeo.lat, originGeo.lon] as [number, number],
            ...transferGeos.map((stop) => [stop.geo.lat, stop.geo.lon] as [number, number]),
            [destGeo.lat, destGeo.lon] as [number, number],
        ];
    }, [destGeo, originGeo, transferGeos]);

    const legs = useMemo<LegDescriptor[]>(() => {
        if (allPoints.length < 2) return [];
        return allPoints.slice(0, -1).map((origin, index) => ({
            id: `leg-${index}`,
            color: legColor(index),
            points: quadraticBezierArc(origin, allPoints[index + 1], index % 2 === 0 ? 1 : -1, 32),
            revealAtMs: ARC_START_DELAY + index * (ARC_DRAW_MS + LEG_GAP_MS) + ARC_DRAW_MS,
        }));
    }, [allPoints]);

    const totalAnimationMs = useMemo(() => {
        if (legs.length === 0) return 0;
        return legs[legs.length - 1].revealAtMs;
    }, [legs]);

    useEffect(() => {
        if (!hasCoords || totalAnimationMs === 0) {
            setElapsedMs(0);
            return;
        }

        let frameId = 0;
        let startTime = 0;

        const tick = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const nextElapsed = Math.min(timestamp - startTime, totalAnimationMs);
            setElapsedMs(nextElapsed);
            if (nextElapsed < totalAnimationMs) {
                frameId = window.requestAnimationFrame(tick);
            }
        };

        setElapsedMs(0);
        frameId = window.requestAnimationFrame(tick);

        return () => window.cancelAnimationFrame(frameId);
    }, [hasCoords, totalAnimationMs, pair]);

    useEffect(() => {
        hasFittedRef.current = false;
    }, [pair]);

    useEffect(() => {
        if (!mapReady || hasFittedRef.current || allPoints.length === 0) return;

        const longitudes = allPoints.map((point) => point[1]);
        const latitudes = allPoints.map((point) => point[0]);
        mapRef.current?.fitBounds(
            [
                [Math.min(...longitudes), Math.min(...latitudes)],
                [Math.max(...longitudes), Math.max(...latitudes)],
            ],
            {
                padding: { top: 80, right: 60, bottom: 50, left: 60 },
                maxZoom: 11,
                duration: 0,
            }
        );
        hasFittedRef.current = true;
    }, [allPoints, mapReady]);

    const lineGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => ({
        type: 'FeatureCollection',
        features: legs.flatMap((leg, index) => {
            const drawStartMs = ARC_START_DELAY + index * (ARC_DRAW_MS + LEG_GAP_MS);
            const progress = clamp01((elapsedMs - drawStartMs) / ARC_DRAW_MS);
            if (progress <= 0) return [];

            return [{
                type: 'Feature' as const,
                properties: {
                    color: leg.color,
                    opacity: 0.85,
                },
                geometry: {
                    type: 'LineString' as const,
                    coordinates: buildVisibleLine(leg.points, progress).map(toGeoJSON),
                },
            }];
        }),
    }), [elapsedMs, legs]);

    const lineLayer = useMemo<LayerProps>(() => ({
        id: 'od-pair-legs',
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 4,
            'line-opacity': ['get', 'opacity'],
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
    }), []);

    const destinationVisible = totalAnimationMs > 0 && elapsedMs >= totalAnimationMs;
    const tintClass = CONFIDENCE_TINT[pair.confidence];

    return (
        <Modal isOpen onClose={onClose} size="lg">
            <style>{MODAL_ANIMATION_STYLES}</style>

            <div
                className="h-1 rounded-t-2xl"
                style={{ background: `linear-gradient(90deg, ${ON_TEAL}, ${ON_TEAL}dd)` }}
            />

            <Modal.Header>
                <div className="flex items-center gap-2 od-stagger-1">
                    <MapPin size={18} style={{ color: ON_TEAL }} />
                    <span className="font-semibold">{pair.origin}</span>
                    <span className="text-gray-300 text-lg">&rarr;</span>
                    <span className="font-semibold">{pair.destination}</span>
                </div>
            </Modal.Header>

            <Modal.Body className="space-y-5">
                <div className="od-stagger-2">
                    <span
                        className="text-3xl font-bold text-gray-900 tracking-tight"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                        {fmt(pair.journeys)}
                    </span>
                    <span className="text-sm text-gray-400 ml-2 font-medium">journeys</span>
                </div>

                <div className="od-stagger-3">
                    {hasCoords && originGeo && destGeo ? (
                        <div className="od-map-container relative rounded-xl overflow-hidden border border-gray-200/80 shadow-sm">
                            <div className="w-full" style={{ height: 380 }}>
                                <MapBase
                                    mapRef={mapRef}
                                    latitude={originGeo.lat}
                                    longitude={originGeo.lon}
                                    zoom={6}
                                    mapStyle="mapbox://styles/mapbox/light-v11"
                                    showNavigation={true}
                                    onLoad={() => {
                                        mapRef.current?.getMap().scrollZoom.disable();
                                        setMapReady(true);
                                    }}
                                >
                                    {lineGeoJSON.features.length > 0 && (
                                        <Source id="od-pair-lines-src" type="geojson" data={lineGeoJSON}>
                                            <Layer {...lineLayer} />
                                        </Source>
                                    )}

                                    <Marker longitude={originGeo.lon} latitude={originGeo.lat} anchor="center">
                                        <CircleMapMarker color={ORIGIN_COLOR} label={pair.origin} />
                                    </Marker>

                                    {transferGeos.map((stop, index) => (
                                        elapsedMs >= legs[index]?.revealAtMs ? (
                                            <Marker
                                                key={`${stop.name}-${index}`}
                                                longitude={stop.geo.lon}
                                                latitude={stop.geo.lat}
                                                anchor="center"
                                            >
                                                <DiamondMapMarker color={legColor(index)} label={stop.name} />
                                            </Marker>
                                        ) : null
                                    ))}

                                    {destinationVisible && (
                                        <Marker longitude={destGeo.lon} latitude={destGeo.lat} anchor="center">
                                            <CircleMapMarker color={DESTINATION_COLOR} label={pair.destination} />
                                        </Marker>
                                    )}
                                </MapBase>
                            </div>
                            <div
                                className="absolute inset-0 pointer-events-none rounded-xl"
                                style={{ boxShadow: 'inset 0 0 30px rgba(0,0,0,0.08)' }}
                            />
                        </div>
                    ) : (
                        <div
                            className="w-full flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-sm"
                            style={{ height: 220 }}
                        >
                            Coordinates not available. Run geocoding to enable the map view.
                        </div>
                    )}
                </div>

                <div className={`od-stagger-4 rounded-xl border border-gray-200/60 px-4 py-1 ${tintClass}`}>
                    <InfoRow icon={<Route size={14} />} label="Route">
                        {pair.transfer
                            ? transferRouteNames.join(' -> ')
                            : pair.routeLongName || <span className="text-gray-400 italic">No route matched</span>}
                    </InfoRow>

                    <InfoRow icon={<ArrowRight size={14} />} label="Via">
                        {transferStops.length > 0
                            ? transferStops.join(' -> ')
                            : <span className="text-gray-400">-</span>}
                    </InfoRow>

                    <InfoRow icon={<MapPin size={14} />} label="Stops">
                        {pair.confidence !== 'none' ? `${pair.intermediateStops} intermediate` : '-'}
                    </InfoRow>

                    <InfoRow icon={<ConfidenceIcon confidence={pair.confidence} />} label="Confidence" isLast>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-full border ${CONFIDENCE_COLORS[pair.confidence]}`}>
                            <ConfidenceIcon confidence={pair.confidence} />
                            {pair.confidence}
                        </span>
                    </InfoRow>
                </div>
            </Modal.Body>
        </Modal>
    );
};
