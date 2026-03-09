/**
 * Coverage Gap Map
 *
 * Mapbox GL JS map showing curved arcs between OD pairs, colored by coverage status:
 * - Green: Served by direct route
 * - Amber: Partial (one endpoint <1km from route)
 * - Red: Gap (both endpoints >1km from route)
 *
 * Shared Mapbox implementation for OD coverage analysis.
 * Uses shared MapBase, ArcLayer, RouteOverlay components.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'mapbox-gl';
import { MapBase, ArcLayer, RouteOverlay } from '../shared';
import type { ArcData } from '../shared';
import type { ODCoverageGap } from '../../utils/transit-app/transitAppTypes';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';

interface CoverageGapMapProps {
    gaps: ODCoverageGap[];
    height?: number;
    highlightedIndex?: number | null;
    onGapHover?: (index: number | null) => void;
}

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

/** Compute arc line width from trip count using a 2px–8px range */
function arcWeight(count: number, min: number, max: number): number {
    if (max === min) return 5;
    const t = (count - min) / (max - min);
    return 2 + t * 6;
}

// ── Zone dot types for data-driven circle-color ───────────────────────────────

type ZoneDotType = 'both' | 'origin' | 'dest';

const ZONE_DOT_COLORS: Record<ZoneDotType, string> = {
    both: '#8b5cf6',
    origin: '#10b981',
    dest: '#ef4444',
};

// ── Arc layer ID — must match idPrefix used in ArcLayer ──────────────────────
const ARC_LAYER_ID = 'coverage-arcs-lines';

// ── Zone dot layer style ──────────────────────────────────────────────────────
const ZONE_DOT_LAYER: LayerProps = {
    id: 'coverage-zone-dots',
    type: 'circle',
    paint: {
        'circle-radius': 5,
        'circle-color': [
            'match',
            ['get', 'dotType'],
            'both', ZONE_DOT_COLORS.both,
            'origin', ZONE_DOT_COLORS.origin,
            'dest', ZONE_DOT_COLORS.dest,
            '#8b5cf6',
        ],
        'circle-opacity': 0.7,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
    },
};

export const CoverageGapMap: React.FC<CoverageGapMapProps> = ({
    gaps,
    height = 380,
    highlightedIndex = null,
    onGapHover,
}) => {
    const mapRef = useRef<MapRef>(null);
    const [showRoutes, setShowRoutes] = useState(false);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    // Keep onGapHover in a ref so event listeners don't go stale
    const onGapHoverRef = useRef(onGapHover);
    useEffect(() => { onGapHoverRef.current = onGapHover; }, [onGapHover]);

    // Load GTFS route shapes when toggle is on
    const routeShapes = useMemo(() => {
        if (!showRoutes) return [];
        try {
            return loadGtfsRouteShapes();
        } catch {
            return [];
        }
    }, [showRoutes]);

    // Trip count range for arc width normalization
    const tripRange = useMemo(() => {
        if (gaps.length === 0) return { min: 0, max: 1 };
        const counts = gaps.map(g => g.pair.count);
        return { min: Math.min(...counts), max: Math.max(...counts) };
    }, [gaps]);

    // Active highlight: external prop takes precedence over hover
    const activeIndex = highlightedIndex !== null ? highlightedIndex : hoveredIndex;

    // Build ArcData array with per-arc opacity based on active highlight
    const arcs = useMemo((): ArcData[] => {
        return gaps.map((gap, i) => {
            const status = getGapStatus(gap);
            const color = STATUS_COLORS[status];
            const width = arcWeight(gap.pair.count, tripRange.min, tripRange.max);
            const baseOpacity = 0.75;
            const opacity = activeIndex === null ? baseOpacity
                : i === activeIndex ? 1.0
                : 0.2;

            return {
                origin: [gap.pair.originLat, gap.pair.originLon],
                dest: [gap.pair.destLat, gap.pair.destLon],
                color,
                width,
                opacity,
                curveDirection: i % 2 === 0 ? 1 : -1,
                // Store index in properties so queryRenderedFeatures can identify the arc
                properties: { arcIndex: i },
            };
        });
    }, [gaps, tripRange, activeIndex]);

    // Build zone dots GeoJSON
    const zoneDotGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
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

        const features: GeoJSON.Feature[] = [];
        for (const zone of zones.values()) {
            const dotType: ZoneDotType = zone.isOrigin && zone.isDest ? 'both'
                : zone.isOrigin ? 'origin' : 'dest';
            features.push({
                type: 'Feature',
                properties: { dotType },
                geometry: { type: 'Point', coordinates: [zone.lon, zone.lat] },
            });
        }
        return { type: 'FeatureCollection', features };
    }, [gaps]);

    // FitBounds when gaps change (also called on initial load via onLoad)
    const fitToGaps = () => {
        if (gaps.length === 0) return;
        const allLats = gaps.flatMap(g => [g.pair.originLat, g.pair.destLat]);
        const allLons = gaps.flatMap(g => [g.pair.originLon, g.pair.destLon]);
        const bounds: [[number, number], [number, number]] = [
            [Math.min(...allLons), Math.min(...allLats)],
            [Math.max(...allLons), Math.max(...allLats)],
        ];
        mapRef.current?.fitBounds(bounds, { padding: 40 });
    };

    useEffect(() => {
        if (gaps.length === 0) return;
        const timer = setTimeout(fitToGaps, 150);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gaps]);

    // Wire native Mapbox hover listeners after map loads.
    // Using native listeners (not react-map-gl props) because MapBase doesn't
    // expose onMouseMove/onMouseLeave, and we need access to the raw map instance
    // for queryRenderedFeatures.
    const handleMapLoad = () => {
        fitToGaps();

        const map = mapRef.current?.getMap();
        if (!map) return;

        const onMouseMove = (e: MapMouseEvent) => {
            const features = map.queryRenderedFeatures(e.point, {
                layers: [ARC_LAYER_ID],
            });

            if (features.length > 0) {
                const idx = features[0].properties?.arcIndex as number | undefined;
                if (typeof idx === 'number') {
                    setHoveredIndex(idx);
                    onGapHoverRef.current?.(idx);
                    map.getCanvas().style.cursor = 'pointer';
                    return;
                }
            }

            setHoveredIndex(null);
            onGapHoverRef.current?.(null);
            map.getCanvas().style.cursor = '';
        };

        const onMouseLeave = () => {
            setHoveredIndex(null);
            onGapHoverRef.current?.(null);
            map.getCanvas().style.cursor = '';
        };

        map.on('mousemove', onMouseMove);
        map.on('mouseleave', onMouseLeave);

        // Cleanup is handled when the MapBase unmounts; the map instance is
        // destroyed so no explicit off() is needed here.
    };

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
                style={{ height, width: '100%' }}
                className="rounded-lg overflow-hidden border border-gray-200"
            >
                <MapBase
                    mapRef={mapRef}
                    showNavigation={true}
                    onLoad={handleMapLoad}
                >
                    {/* Arc layer — uses shared ArcLayer; per-arc opacity encodes hover/highlight */}
                    <ArcLayer
                        arcs={arcs}
                        showArrowheads={true}
                        arrowheadSize={0.003}
                        idPrefix="coverage-arcs"
                    />

                    {/* Zone dots — data-driven circle layer */}
                    <Source id="coverage-zone-dots-src" type="geojson" data={zoneDotGeoJSON}>
                        <Layer {...ZONE_DOT_LAYER} />
                    </Source>

                    {/* GTFS route overlay */}
                    {showRoutes && routeShapes.length > 0 && (
                        <RouteOverlay
                            shapes={routeShapes}
                            opacity={0.5}
                            weight={3}
                            dashed={true}
                            idPrefix="coverage-route-overlay"
                        />
                    )}
                </MapBase>
            </div>

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
