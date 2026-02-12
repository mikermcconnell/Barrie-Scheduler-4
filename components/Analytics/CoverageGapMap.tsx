/**
 * Coverage Gap Map
 *
 * Leaflet map showing curved arcs between OD pairs, colored by coverage status:
 * - Green: Served by direct route
 * - Amber: Partial (one endpoint <1km from route)
 * - Red: Gap (both endpoints >1km from route)
 *
 * Uses raw Leaflet via useRef/useEffect (no react-leaflet) for React 19 compat.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ODCoverageGap } from '../../utils/transitAppTypes';
import { loadGtfsRouteShapes } from '../../utils/gtfsShapesLoader';

interface CoverageGapMapProps {
    gaps: ODCoverageGap[];
    height?: number;
    highlightedIndex?: number | null;
    onGapHover?: (index: number | null) => void;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];

const STATUS_COLORS = {
    served: '#16a34a',
    partial: '#d97706',
    gap: '#dc2626',
} as const;

function getGapStatus(gap: ODCoverageGap): 'served' | 'partial' | 'gap' {
    if (gap.isServedByDirectRoute) return 'served';
    if (gap.originRouteDistKm > 1 && gap.destRouteDistKm > 1) return 'gap';
    return 'partial';
}

function quadraticBezierArc(
    origin: [number, number],
    dest: [number, number],
    curveDirection: 1 | -1 = 1,
    segments: number = 16
): [number, number][] {
    const midLat = (origin[0] + dest[0]) / 2;
    const midLon = (origin[1] + dest[1]) / 2;
    const dLat = dest[0] - origin[0];
    const dLon = dest[1] - origin[1];
    const offsetLat = midLat + dLon * 0.2 * curveDirection;
    const offsetLon = midLon - dLat * 0.2 * curveDirection;

    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        const lat = u * u * origin[0] + 2 * u * t * offsetLat + t * t * dest[0];
        const lon = u * u * origin[1] + 2 * u * t * offsetLon + t * t * dest[1];
        points.push([lat, lon]);
    }
    return points;
}

function arrowheadPoints(
    arcPoints: [number, number][],
    sizeDeg: number = 0.004
): [number, number][][] {
    const n = arcPoints.length;
    if (n < 2) return [];
    const tip = arcPoints[n - 1];
    const prev = arcPoints[n - 2];
    const dx = tip[1] - prev[1];
    const dy = tip[0] - prev[0];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return [];
    const ux = dx / len;
    const uy = dy / len;

    const barb1: [number, number] = [
        tip[0] - uy * sizeDeg + ux * sizeDeg * 0.5,
        tip[1] - ux * sizeDeg - uy * sizeDeg * 0.5,
    ];
    const barb2: [number, number] = [
        tip[0] - uy * sizeDeg - ux * sizeDeg * 0.5,
        tip[1] - ux * sizeDeg + uy * sizeDeg * 0.5,
    ];

    return [[barb1, tip, barb2]];
}

export const CoverageGapMap: React.FC<CoverageGapMapProps> = ({
    gaps,
    height = 380,
    highlightedIndex = null,
    onGapHover,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const arcLayerRef = useRef<L.LayerGroup | null>(null);
    const routeLayerRef = useRef<L.LayerGroup | null>(null);
    const arcGroupsRef = useRef<{ lines: L.Path[]; origOpacity: number }[]>([]);

    const [showRoutes, setShowRoutes] = useState(false);

    // Compute arc width from trip count (2px–8px range)
    const tripRange = useMemo(() => {
        if (gaps.length === 0) return { min: 0, max: 1 };
        const counts = gaps.map(g => g.pair.count);
        return { min: Math.min(...counts), max: Math.max(...counts) };
    }, [gaps]);

    function arcWeight(count: number): number {
        if (tripRange.max === tripRange.min) return 5;
        const t = (count - tripRange.min) / (tripRange.max - tripRange.min);
        return 2 + t * 6;
    }

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: BARRIE_CENTER,
            zoom: 13,
            zoomControl: true,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            scrollWheelZoom: 'center',
            wheelDebounceTime: 24,
            wheelPxPerZoomLevel: 120,
            preferCanvas: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 18,
        }).addTo(map);

        mapRef.current = map;

        const ro = new ResizeObserver(() => {
            map.invalidateSize();
        });
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Build arc layer
    const buildArcLayer = useCallback(() => {
        const group = L.layerGroup();
        arcGroupsRef.current = [];

        if (gaps.length === 0) return group;

        // Zone dots — collect unique coordinates
        const zones = new Map<string, { lat: number; lon: number; isOrigin: boolean; isDest: boolean }>();
        for (const gap of gaps) {
            const oKey = `${gap.pair.originLat.toFixed(4)}_${gap.pair.originLon.toFixed(4)}`;
            const dKey = `${gap.pair.destLat.toFixed(4)}_${gap.pair.destLon.toFixed(4)}`;
            const oZone = zones.get(oKey);
            if (oZone) { oZone.isOrigin = true; }
            else { zones.set(oKey, { lat: gap.pair.originLat, lon: gap.pair.originLon, isOrigin: true, isDest: false }); }
            const dZone = zones.get(dKey);
            if (dZone) { dZone.isDest = true; }
            else { zones.set(dKey, { lat: gap.pair.destLat, lon: gap.pair.destLon, isOrigin: false, isDest: true }); }
        }

        for (const zone of zones.values()) {
            const fillColor = zone.isOrigin && zone.isDest ? '#8b5cf6'
                : zone.isOrigin ? '#10b981' : '#ef4444';
            L.circleMarker([zone.lat, zone.lon], {
                radius: 5,
                fillColor,
                fillOpacity: 0.7,
                color: '#ffffff',
                weight: 1.5,
            }).addTo(group);
        }

        // Draw arcs
        for (let i = 0; i < gaps.length; i++) {
            const gap = gaps[i];
            const status = getGapStatus(gap);
            const color = STATUS_COLORS[status];
            const weight = arcWeight(gap.pair.count);
            const opacity = 0.75;
            const lineElements: L.Path[] = [];

            const origin: [number, number] = [gap.pair.originLat, gap.pair.originLon];
            const dest: [number, number] = [gap.pair.destLat, gap.pair.destLon];
            const curveDir: 1 | -1 = i % 2 === 0 ? 1 : -1;
            const arcPoints = quadraticBezierArc(origin, dest, curveDir);

            const statusLabel = status === 'served'
                ? `Served (${gap.servingRoutes.join(', ')})`
                : status === 'partial' ? 'Partial' : 'Gap';
            const tooltipText = `${gap.originZoneName} → ${gap.destZoneName} | ${gap.pair.count.toLocaleString()} trips · ${gap.distanceKm.toFixed(1)}km | ${statusLabel}`;

            const polyline = L.polyline(arcPoints, {
                color,
                weight,
                opacity,
                lineCap: 'round',
                lineJoin: 'round',
            });
            polyline.bindTooltip(tooltipText, { direction: 'top', sticky: true });
            polyline.addTo(group);
            lineElements.push(polyline);

            // Arrowhead
            const arrows = arrowheadPoints(arcPoints, 0.003);
            for (const pts of arrows) {
                const arrow = L.polyline(pts, {
                    color,
                    weight: Math.max(weight * 0.7, 1.5),
                    opacity: Math.min(opacity + 0.15, 1),
                    lineCap: 'round',
                    lineJoin: 'round',
                }).addTo(group);
                lineElements.push(arrow);
            }

            arcGroupsRef.current.push({ lines: lineElements, origOpacity: opacity });

            // Hover → dim others to 0.2
            const idx = i;
            const highlight = () => {
                for (let j = 0; j < arcGroupsRef.current.length; j++) {
                    const g = arcGroupsRef.current[j];
                    const op = j === idx ? 1 : 0.2;
                    for (const el of g.lines) el.setStyle({ opacity: op });
                }
                onGapHover?.(idx);
            };
            const unhighlight = () => {
                for (const g of arcGroupsRef.current) {
                    for (const el of g.lines) el.setStyle({ opacity: g.origOpacity });
                }
                onGapHover?.(null);
            };
            for (const el of lineElements) {
                el.on('mouseover', highlight);
                el.on('mouseout', unhighlight);
            }
        }

        return group;
    }, [gaps, tripRange, onGapHover]);

    // Sync arc layer
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (arcLayerRef.current) {
            map.removeLayer(arcLayerRef.current);
            arcLayerRef.current = null;
        }

        const layer = buildArcLayer();
        layer.addTo(map);
        arcLayerRef.current = layer;

        // Fit bounds to arcs
        if (gaps.length > 0) {
            const allLats = gaps.flatMap(g => [g.pair.originLat, g.pair.destLat]);
            const allLons = gaps.flatMap(g => [g.pair.originLon, g.pair.destLon]);
            const bounds: L.LatLngBoundsLiteral = [
                [Math.min(...allLats), Math.min(...allLons)],
                [Math.max(...allLats), Math.max(...allLons)],
            ];
            map.fitBounds(bounds, { padding: [30, 30] });
        }
    }, [buildArcLayer, gaps]);

    // GTFS route overlay toggle
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (routeLayerRef.current) {
            map.removeLayer(routeLayerRef.current);
            routeLayerRef.current = null;
        }

        if (showRoutes) {
            const group = L.layerGroup();
            try {
                const shapes = loadGtfsRouteShapes();
                for (const shape of shapes) {
                    L.polyline(shape.points, {
                        color: `#${shape.routeColor}`,
                        weight: 3,
                        opacity: 0.5,
                        dashArray: '6 4',
                        lineCap: 'round',
                    })
                        .bindTooltip(`Route ${shape.routeShortName}`, { direction: 'top', sticky: true })
                        .addTo(group);
                }
            } catch { /* shapes unavailable */ }
            group.addTo(map);
            routeLayerRef.current = group;
        }
    }, [showRoutes]);

    // External highlight sync (table → map)
    useEffect(() => {
        if (!arcGroupsRef.current.length) return;
        if (highlightedIndex !== null && highlightedIndex >= 0 && highlightedIndex < arcGroupsRef.current.length) {
            for (let j = 0; j < arcGroupsRef.current.length; j++) {
                const g = arcGroupsRef.current[j];
                const op = j === highlightedIndex ? 1 : 0.2;
                for (const el of g.lines) el.setStyle({ opacity: op });
            }
        } else {
            for (const g of arcGroupsRef.current) {
                for (const el of g.lines) el.setStyle({ opacity: g.origOpacity });
            }
        }
    }, [highlightedIndex]);

    if (gaps.length === 0) return null;

    return (
        <div className="space-y-2">
            {/* Toggle button row */}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setShowRoutes(v => !v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        showRoutes
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    GTFS Routes
                </button>
            </div>

            {/* Map */}
            <div
                ref={containerRef}
                style={{ height, width: '100%' }}
                className="rounded-lg overflow-hidden border border-gray-200"
            />

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-500 px-1">
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-1 rounded" style={{ background: STATUS_COLORS.served }} />
                    Served
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-1 rounded" style={{ background: STATUS_COLORS.partial }} />
                    Partial
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-1 rounded" style={{ background: STATUS_COLORS.gap }} />
                    Gap
                </span>
                <span className="text-gray-300">|</span>
                <span>Arc width = trip volume</span>
            </div>
        </div>
    );
};
