/**
 * OD Pair Map Modal
 *
 * Shows a Leaflet map with animated curved arcs for a single OD pair journey.
 * Arcs draw sequentially leg-by-leg; transfer markers appear as each leg completes.
 * Falls back to info-only when geocodes are missing.
 */

import React, { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CheckCircle2, AlertTriangle, XCircle, MapPin, Route, ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { fmt } from './AnalyticsShared';
import type { GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import type { ODPairRouteMatch, MatchConfidence } from '../../utils/od-matrix/odRouteEstimation';

/* ── Brand & Color Constants ─────────────────────────── */

const ON_TEAL = '#00594C';
const ORIGIN_COLOR = '#2563eb';
const DESTINATION_COLOR = '#dc2626';

/** Distinct color per leg — cycles if more than 4 legs */
const LEG_COLORS = [
    '#2563eb', // blue
    '#7c3aed', // violet
    '#d97706', // amber
    '#0d9488', // teal
    '#e11d48', // rose
];
function legColor(i: number): string { return LEG_COLORS[i % LEG_COLORS.length]; }

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

/* ── Animation Timing ─────────────────────────────────── */

const ARC_START_DELAY = 500;
const ARC_DRAW_MS = 1000;
const LEG_GAP_MS = 200;

/* ── Scoped Styles ────────────────────────────────────── */

const MODAL_ANIMATION_STYLES = `
@keyframes odFadeInUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
.od-stagger-1 { animation: odFadeInUp 0.35s ease-out 0.05s both; }
.od-stagger-2 { animation: odFadeInUp 0.35s ease-out 0.15s both; }
.od-stagger-3 { animation: odFadeInUp 0.35s ease-out 0.3s both; }
.od-stagger-4 { animation: odFadeInUp 0.35s ease-out 0.45s both; }

/* Refined zoom controls */
.od-map-container .leaflet-control-zoom {
    border: none !important;
    border-radius: 10px !important;
    overflow: hidden !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
}
.od-map-container .leaflet-control-zoom a {
    background: rgba(255,255,255,0.92) !important;
    color: #4b5563 !important;
    border-color: rgba(0,0,0,0.06) !important;
    width: 30px !important;
    height: 30px !important;
    line-height: 30px !important;
    font-size: 15px !important;
    transition: background 0.15s, color 0.15s;
}
.od-map-container .leaflet-control-zoom a:hover {
    background: #fff !important;
    color: #111827 !important;
}
`;

/* ── Geometry Helpers ─────────────────────────────────── */

function quadraticBezierArc(
    origin: [number, number],
    dest: [number, number],
    curveDirection: 1 | -1 = 1,
    segments = 32
): [number, number][] {
    const midLat = (origin[0] + dest[0]) / 2;
    const midLon = (origin[1] + dest[1]) / 2;
    const dLat = dest[0] - origin[0];
    const dLon = dest[1] - origin[1];
    const offsetLat = midLat + dLon * 0.18 * curveDirection;
    const offsetLon = midLon - dLat * 0.18 * curveDirection;

    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        points.push([
            u * u * origin[0] + 2 * u * t * offsetLat + t * t * dest[0],
            u * u * origin[1] + 2 * u * t * offsetLon + t * t * dest[1],
        ]);
    }
    return points;
}

/* ── Marker Factories ─────────────────────────────────── */

/** Shared label: dark text with white halo, positioned right of marker */
function labelHtml(text: string, offsetY = '-50%'): string {
    return `<div style="
        color: #1f2937;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        text-shadow: 0 0 4px #fff, 0 0 4px #fff, 0 0 8px rgba(255,255,255,0.8);
        transform: translate(14px, ${offsetY});
    ">${text}</div>`;
}

function makeCircleMarker(
    latlng: [number, number],
    color: string,
    label: string,
    map: L.Map
): void {
    // Outer glow ring for visibility on light tiles
    L.circleMarker(latlng, {
        radius: 12,
        fillColor: color,
        fillOpacity: 0.15,
        color: color,
        weight: 0,
    }).addTo(map);

    L.circleMarker(latlng, {
        radius: 8,
        fillColor: color,
        fillOpacity: 0.9,
        color: '#fff',
        weight: 2.5,
    }).addTo(map);

    L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: labelHtml(label),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        }),
    }).addTo(map);
}

function makeDiamondMarker(
    latlng: [number, number],
    color: string,
    label: string,
    map: L.Map
): L.Marker[] {
    const diamond = L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: `<div style="
                width: 14px; height: 14px;
                background: ${color};
                border: 2px solid #fff;
                transform: rotate(45deg) translate(-50%, -50%);
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                position: absolute;
                top: -7px; left: -7px;
            "></div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        }),
    }).addTo(map);

    const labelMarker = L.marker(latlng, {
        icon: L.divIcon({
            className: '',
            html: labelHtml(label),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        }),
    }).addTo(map);

    return [diamond, labelMarker];
}

/* ── Arc Animation ────────────────────────────────────── */

function animateArc(
    polyline: L.Polyline,
    delayMs: number,
    cancelled: { current: boolean }
): void {
    setTimeout(() => {
        if (cancelled.current) return;
        const el = polyline.getElement();
        if (!el) return;
        const pathEl = el as unknown as SVGPathElement;

        // Reveal the stroke
        polyline.setStyle({ opacity: 0.85 });

        // Set dash pattern so line starts fully hidden
        const length = pathEl.getTotalLength?.() ?? 1000;
        pathEl.style.strokeDasharray = `${length}`;
        pathEl.style.strokeDashoffset = `${length}`;

        // Force reflow so initial offset commits before transition
        pathEl.getBoundingClientRect();

        // Animate the offset to draw the arc
        pathEl.style.transition = `stroke-dashoffset ${ARC_DRAW_MS}ms ease-in-out`;
        pathEl.style.strokeDashoffset = '0';
    }, delayMs);
}

/* ── Geocode Resolver ─────────────────────────────────── */

function resolveGeocode(
    stationName: string,
    geocodeCache: GeocodeCache | null
): GeocodedLocation | null {
    if (!geocodeCache) return null;
    const key = Object.keys(geocodeCache.stations).find(
        k => k.toLowerCase() === stationName.toLowerCase()
    );
    return key ? geocodeCache.stations[key] : null;
}

/* ── Sub-components ───────────────────────────────────── */

function ConfidenceIcon({ confidence }: { confidence: MatchConfidence }) {
    if (confidence === 'high') return <CheckCircle2 size={13} />;
    if (confidence === 'none') return <XCircle size={13} />;
    return <AlertTriangle size={13} />;
}

interface InfoRowProps {
    icon: React.ReactNode;
    label: string;
    children: React.ReactNode;
    isLast?: boolean;
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

/* ── Main Component ───────────────────────────────────── */

interface ODPairMapModalProps {
    pair: ODPairRouteMatch;
    geocodeCache: GeocodeCache | null;
    onClose: () => void;
}

export const ODPairMapModal: React.FC<ODPairMapModalProps> = ({
    pair,
    geocodeCache,
    onClose,
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);

    const originGeo = resolveGeocode(pair.origin, geocodeCache);
    const destGeo = resolveGeocode(pair.destination, geocodeCache);
    const hasCoords = Boolean(originGeo && destGeo);

    const transferStops = pair.transfer?.transferStops?.length
        ? pair.transfer.transferStops
        : pair.transfer ? [pair.transfer.viaStop] : [];
    const transferGeos = transferStops
        .map(name => ({ name, geo: resolveGeocode(name, geocodeCache) }))
        .filter((t): t is { name: string; geo: GeocodedLocation } => t.geo !== null);

    const transferRouteNames = pair.transfer?.legs?.length
        ? pair.transfer.legs.map(leg => leg.routeName)
        : pair.transfer ? [pair.transfer.leg1RouteName, pair.transfer.leg2RouteName] : [];

    // Initialize Leaflet map with sequential arc animation
    useEffect(() => {
        if (!hasCoords || !mapContainerRef.current || mapRef.current) return;
        if (!originGeo || !destGeo) return;

        const cancelled = { current: false };

        const map = L.map(mapContainerRef.current, {
            scrollWheelZoom: false,
            zoomSnap: 0.25,
            attributionControl: false,
        });
        mapRef.current = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 18,
            crossOrigin: 'anonymous',
            subdomains: 'abcd',
        } as L.TileLayerOptions).addTo(map);

        const originLatLng: [number, number] = [originGeo.lat, originGeo.lon];
        const destLatLng: [number, number] = [destGeo.lat, destGeo.lon];

        // Origin marker always visible immediately
        makeCircleMarker(originLatLng, ORIGIN_COLOR, pair.origin, map);

        if (transferGeos.length > 0) {
            const waypoints = [
                originLatLng,
                ...transferGeos.map(t => [t.geo.lat, t.geo.lon] as [number, number]),
                destLatLng,
            ];

            // Create transfer markers — hidden initially, color matches incoming leg
            const transferMarkerPairs: L.Marker[][] = [];
            for (let ti = 0; ti < transferGeos.length; ti++) {
                const t = transferGeos[ti];
                const markers = makeDiamondMarker(
                    [t.geo.lat, t.geo.lon], legColor(ti), t.name, map
                );
                markers.forEach(m => m.setOpacity(0));
                transferMarkerPairs.push(markers);
            }

            // Create all arc polylines — hidden initially (opacity: 0)
            for (let i = 0; i < waypoints.length - 1; i++) {
                const arc = quadraticBezierArc(
                    waypoints[i], waypoints[i + 1],
                    i % 2 === 0 ? 1 : -1
                );
                const polyline = L.polyline(arc, {
                    color: legColor(i),
                    weight: 4,
                    opacity: 0,
                    lineCap: 'round',
                    lineJoin: 'round',
                }).addTo(map);

                // Sequential timing: each leg starts after the previous finishes + gap
                const legDelay = ARC_START_DELAY + i * (ARC_DRAW_MS + LEG_GAP_MS);
                animateArc(polyline, legDelay, cancelled);

                // Reveal the transfer marker at this leg's destination
                if (i < transferMarkerPairs.length) {
                    const markerRevealTime = legDelay + ARC_DRAW_MS;
                    setTimeout(() => {
                        if (cancelled.current) return;
                        transferMarkerPairs[i].forEach(m => m.setOpacity(1));
                    }, markerRevealTime);
                }
            }

            // Destination marker appears when last arc finishes
            const lastLegIdx = waypoints.length - 2;
            const destRevealTime = ARC_START_DELAY + lastLegIdx * (ARC_DRAW_MS + LEG_GAP_MS) + ARC_DRAW_MS;
            setTimeout(() => {
                if (cancelled.current) return;
                makeCircleMarker(destLatLng, DESTINATION_COLOR, pair.destination, map);
            }, destRevealTime);

        } else {
            // Direct route: single arc, destination appears when arc finishes
            const arc = quadraticBezierArc(originLatLng, destLatLng);
            const polyline = L.polyline(arc, {
                color: legColor(0),
                weight: 4,
                opacity: 0,
                lineCap: 'round',
                lineJoin: 'round',
            }).addTo(map);
            animateArc(polyline, ARC_START_DELAY, cancelled);

            setTimeout(() => {
                if (cancelled.current) return;
                makeCircleMarker(destLatLng, DESTINATION_COLOR, pair.destination, map);
            }, ARC_START_DELAY + ARC_DRAW_MS);
        }

        // Fit bounds with asymmetric padding — extra top for labels above markers
        const allPoints: [number, number][] = [
            originLatLng,
            destLatLng,
            ...transferGeos.map(t => [t.geo.lat, t.geo.lon] as [number, number]),
        ];
        const bounds = L.latLngBounds(allPoints.map(p => L.latLng(p[0], p[1])));
        map.fitBounds(bounds, {
            paddingTopLeft: L.point(60, 80),
            paddingBottomRight: L.point(60, 50),
            maxZoom: 11,
        });

        return () => {
            cancelled.current = true;
            map.remove();
            mapRef.current = null;
        };
    }, [hasCoords, originGeo, destGeo, pair, transferGeos]);

    const tintClass = CONFIDENCE_TINT[pair.confidence];

    return (
        <Modal isOpen onClose={onClose} size="lg">
            <style>{MODAL_ANIMATION_STYLES}</style>

            {/* Ontario Northland brand accent bar */}
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
                {/* Hero journey count */}
                <div className="od-stagger-2">
                    <span
                        className="text-3xl font-bold text-gray-900 tracking-tight"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                        {fmt(pair.journeys)}
                    </span>
                    <span className="text-sm text-gray-400 ml-2 font-medium">journeys</span>
                </div>

                {/* Map or fallback */}
                <div className="od-stagger-3">
                    {hasCoords ? (
                        <div className="od-map-container relative rounded-xl overflow-hidden border border-gray-200/80 shadow-sm">
                            <div
                                ref={mapContainerRef}
                                className="w-full"
                                style={{ height: 380 }}
                            />
                            {/* Inner shadow vignette for depth */}
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

                {/* Info card with confidence-aware background tint */}
                <div className={`od-stagger-4 rounded-xl border border-gray-200/60 px-4 py-1 ${tintClass}`}>
                    <InfoRow
                        icon={<Route size={14} />}
                        label="Route"
                    >
                        {pair.transfer
                            ? transferRouteNames.join(' \u2192 ')
                            : pair.routeLongName || <span className="text-gray-400 italic">No route matched</span>}
                    </InfoRow>

                    <InfoRow
                        icon={<ArrowRight size={14} />}
                        label="Via"
                    >
                        {transferStops.length > 0
                            ? transferStops.join(' \u2192 ')
                            : <span className="text-gray-400">&mdash;</span>}
                    </InfoRow>

                    <InfoRow
                        icon={<MapPin size={14} />}
                        label="Stops"
                    >
                        {pair.confidence !== 'none' ? `${pair.intermediateStops} intermediate` : '\u2014'}
                    </InfoRow>

                    <InfoRow
                        icon={<ConfidenceIcon confidence={pair.confidence} />}
                        label="Confidence"
                        isLast
                    >
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
