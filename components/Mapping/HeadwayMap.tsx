/**
 * Corridor Headway Map
 *
 * Mapbox GL JS map showing corridor-level headway where multiple routes overlap
 * on the same road. Shared corridors are colored/weighted by combined headway
 * severity; single-route segments are shown as thin route-colored lines.
 *
 * Shared Mapbox implementation for corridor-level headway analysis.
 */

import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';
import { Source, Layer, Popup } from 'react-map-gl/mapbox';
import type { LayerProps, MapMouseEvent, MapRef } from 'react-map-gl/mapbox';
import { ArrowLeft } from 'lucide-react';
import { buildCorridorSegments, getCorridorJunctionStops, type CorridorSegment } from '../../utils/gtfs/corridorBuilder';
import {
    computeCorridorHeadways,
    getHeadwayStyle,
    TIME_PERIODS,
    DAY_TYPES,
    type TimePeriod,
    type DayType,
} from '../../utils/gtfs/corridorHeadway';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { MapBase, StopDotLayer, toGeoJSON } from '../shared';
import type { StopPoint } from '../shared';
import { HeadwayFilterBar } from './HeadwayFilterBar';
import { HeadwayLegend } from './HeadwayLegend';
import { CorridorDetailPanel } from './CorridorDetailPanel';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SegmentFeatureProps {
    segmentId: string;
    color: string;
    weight: number;
    opacity: number;
    offset: number;
    isShared: boolean;
    routeList: string;
    headwayText: string;
    directionText: string;
    fromStop: string;
    toStop: string;
}

interface HoverInfo {
    longitude: number;
    latitude: number;
    props: SegmentFeatureProps;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface HeadwayMapProps {
    onBack: () => void;
}

// ─── Layer IDs ───────────────────────────────────────────────────────────────

const CORRIDOR_SRC = 'corridor-segments';
const CORRIDOR_LAYER = 'corridor-lines';
const CORRIDOR_HOVER_LAYER = 'corridor-lines-hover';
const HIGHLIGHT_SRC = 'corridor-highlight';
const HIGHLIGHT_LAYER = 'corridor-highlight-line';

function buildDirectionalOffsetLookup(segments: readonly CorridorSegment[]): Map<string, number> {
    const byStopKey = new Map<string, CorridorSegment[]>();
    const offsets = new Map<string, number>();
    const processedKeys = new Set<string>();

    for (const segment of segments) {
        const key = segment.stops.join('>');
        const existing = byStopKey.get(key);
        if (existing) existing.push(segment);
        else byStopKey.set(key, [segment]);
    }

    for (const [key, forwardSegments] of byStopKey.entries()) {
        if (processedKeys.has(key)) continue;

        const reverseKey = [...key.split('>')].reverse().join('>');
        if (reverseKey === key || !byStopKey.has(reverseKey)) {
            forwardSegments.forEach(segment => offsets.set(segment.id, 0));
            processedKeys.add(key);
            continue;
        }

        // Mapbox applies line-offset relative to the line direction.
        // Reverse geometries naturally land on the opposite side with the same sign.
        const pairedOffset = 6;
        for (const segment of forwardSegments) {
            offsets.set(segment.id, pairedOffset);
        }
        for (const segment of byStopKey.get(reverseKey) || []) {
            offsets.set(segment.id, pairedOffset);
        }

        processedKeys.add(key);
        processedKeys.add(reverseKey);
    }

    return offsets;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const HeadwayMap: React.FC<HeadwayMapProps> = ({ onBack }) => {
    const mapRef = useRef<MapRef | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [period, setPeriod] = useState<TimePeriod>('full-day');
    const [dayType, setDayType] = useState<DayType>('weekday');
    const [selectedSegment, setSelectedSegment] = useState<CorridorSegment | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const [loading, setLoading] = useState(true);

    // ─── Data ────────────────────────────────────────────────────────────

    const segments = useMemo(() => {
        try {
            const segs = buildCorridorSegments();
            setLoading(false);
            return segs;
        } catch (e) {
            console.error('Failed to build corridor segments:', e);
            setLoading(false);
            return [];
        }
    }, []);

    const junctionStops = useMemo(() => getCorridorJunctionStops(segments), [segments]);
    const segmentOffsets = useMemo(() => buildDirectionalOffsetLookup(segments), [segments]);

    const stopCoords = useMemo(() => {
        const map = new Map<string, { lat: number; lon: number; name: string }>();
        for (const s of getAllStopsWithCoords()) {
            map.set(s.stop_id, { lat: s.lat, lon: s.lon, name: s.stop_name });
        }
        return map;
    }, []);

    const headways = useMemo(
        () => computeCorridorHeadways(segments, period, dayType),
        [segments, period, dayType],
    );

    const selectedHeadway = useMemo(
        () => (selectedSegment ? headways.get(selectedSegment.id) || null : null),
        [selectedSegment, headways],
    );
    const selectedOffset = selectedSegment ? (segmentOffsets.get(selectedSegment.id) || 0) : 0;

    const periodLabel = TIME_PERIODS.find(p => p.id === period)?.label || '';
    const dayTypeLabel = DAY_TYPES.find(d => d.id === dayType)?.label || '';

    // ─── Junction stops as StopPoint[] for StopDotLayer ──────────────────

    const junctionStopPoints = useMemo((): StopPoint[] => {
        const points: StopPoint[] = [];
        for (const stopId of junctionStops) {
            const coords = stopCoords.get(stopId);
            if (coords) {
                points.push({ id: stopId, lat: coords.lat, lon: coords.lon, name: coords.name });
            }
        }
        return points;
    }, [junctionStops, stopCoords]);

    // ─── Corridor GeoJSON ─────────────────────────────────────────────────
    //
    // Single-route segments are drawn first (lower sort index → drawn underneath).
    // Shared segments sit on top. This is achieved by ordering features so that
    // single-route segments come first, then shared.

    const corridorGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        const sorted = [...segments].sort((a, b) => {
            if (a.isShared === b.isShared) return 0;
            return a.isShared ? 1 : -1; // shared last = rendered on top
        });

        const features: GeoJSON.Feature[] = [];
        for (const seg of sorted) {
            if (seg.geometry.length < 2) continue;

            const hw = headways.get(seg.id);
            const headwayMin = hw?.combinedHeadwayMin ?? null;
            const offset = segmentOffsets.get(seg.id) || 0;

            let style: { color: string; weight: number; opacity: number };
            if (seg.isShared) {
                style = getHeadwayStyle(headwayMin, true);
            } else {
                const routeColor = seg.routeColors[0] || '888888';
                style = { color: `#${routeColor}`, weight: 2, opacity: 0.6 };
            }

            const headwayText = hw
                ? hw.combinedHeadwayMin !== null
                    ? `Every ${hw.combinedHeadwayMin} min (${hw.combinedTripsPerHour} trips/hr · ${hw.totalTrips} trips)`
                    : `No service (${hw.totalTrips} trips)`
                : 'No data';

            const props: SegmentFeatureProps = {
                segmentId: seg.id,
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                offset,
                isShared: seg.isShared,
                routeList: seg.routes.join(', '),
                headwayText,
                directionText: `${seg.stopNames[0] ?? ''} → ${seg.stopNames[seg.stopNames.length - 1] ?? ''}`,
                fromStop: seg.stopNames[0] ?? '',
                toStop: seg.stopNames[seg.stopNames.length - 1] ?? '',
            };

            features.push({
                type: 'Feature',
                id: seg.id,
                properties: props,
                geometry: {
                    type: 'LineString',
                    coordinates: seg.geometry.map(toGeoJSON),
                },
            });
        }

        return { type: 'FeatureCollection', features };
    }, [segments, headways, segmentOffsets]);

    // ─── Highlight GeoJSON for selected segment ───────────────────────────

    const highlightGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        if (!selectedSegment || selectedSegment.geometry.length < 2) {
            return { type: 'FeatureCollection', features: [] };
        }
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { offset: selectedOffset },
                geometry: {
                    type: 'LineString',
                    coordinates: selectedSegment.geometry.map(toGeoJSON),
                },
            }],
        };
    }, [selectedOffset, selectedSegment]);

    // ─── Layer styles ─────────────────────────────────────────────────────

    const corridorLayerStyle: LayerProps = {
        id: CORRIDOR_LAYER,
        type: 'line' as const,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': ['get', 'color'] as unknown as string,
            'line-width': ['get', 'weight'] as unknown as number,
            'line-opacity': ['get', 'opacity'] as unknown as number,
            'line-offset': ['get', 'offset'] as unknown as number,
        },
    };

    // Hover layer: same source, filtered to hovered segment with bumped width/opacity
    const corridorHoverLayerStyle: LayerProps = {
        id: CORRIDOR_HOVER_LAYER,
        type: 'line' as const,
        filter: (hoveredId !== null
            ? ['==', ['get', 'segmentId'], hoveredId]
            : ['==', ['literal', true], ['literal', false]]) as unknown as mapboxgl.FilterSpecification,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': ['get', 'color'] as unknown as string,
            'line-width': ['+', ['get', 'weight'], 3] as unknown as number,
            'line-opacity': ['min', ['+', ['get', 'opacity'], 0.15], 1] as unknown as number,
            'line-offset': ['get', 'offset'] as unknown as number,
        },
    };

    const highlightLayerStyle = {
        id: HIGHLIGHT_LAYER,
        type: 'line' as const,
        layout: {
            'line-cap': 'round' as const,
            'line-join': 'round' as const,
        },
        paint: {
            'line-color': '#3b82f6',
            'line-width': 12,
            'line-opacity': 0.3,
            'line-offset': ['coalesce', ['get', 'offset'], 0] as unknown as number,
        },
    };

    // ─── Map interaction handlers ─────────────────────────────────────────

    const handleMouseMove = useCallback((e: MapMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) {
            setHoveredId(null);
            setHoverInfo(null);
            // Reset cursor
            const canvas1 = mapRef.current?.getMap().getCanvas();
            if (canvas1) canvas1.style.cursor = '';
            return;
        }
        const props = feature.properties as SegmentFeatureProps;
        setHoveredId(props.segmentId);
        setHoverInfo({
            longitude: e.lngLat.lng,
            latitude: e.lngLat.lat,
            props,
        });
        const canvas2 = mapRef.current?.getMap().getCanvas();
        if (canvas2) canvas2.style.cursor = 'pointer';
    }, []);

    const handleMouseLeave = useCallback(() => {
        setHoveredId(null);
        setHoverInfo(null);
        const canvas3 = mapRef.current?.getMap().getCanvas();
        if (canvas3) canvas3.style.cursor = '';
    }, []);

    const handleClick = useCallback((e: MapMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as SegmentFeatureProps;
        const seg = segments.find(s => s.id === props.segmentId) ?? null;
        setSelectedSegment(seg);
    }, [segments]);

    const clearSelection = useCallback(() => {
        setSelectedSegment(null);
    }, []);

    // ─── Fullscreen toggle ────────────────────────────────────────────────

    const toggleFullscreen = useCallback(() => setIsFullscreen(p => !p), []);

    // Invalidate map size on fullscreen change
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const raf = requestAnimationFrame(() => map.resize());
        const t1 = setTimeout(() => map.resize(), 100);
        const t2 = setTimeout(() => map.resize(), 300);
        return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
    }, [isFullscreen]);

    // ─── Escape key handler ───────────────────────────────────────────────

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (selectedSegment) { clearSelection(); return; }
            if (isFullscreen) setIsFullscreen(false);
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [isFullscreen, selectedSegment, clearSelection]);

    // ─── Render ───────────────────────────────────────────────────────────

    return (
        <div
            className={isFullscreen
                ? 'fixed inset-0 z-50 bg-white flex flex-col'
                : 'relative'
            }
        >
            {/* ─── Top Bar ─── */}
            <div className="absolute top-2 left-2 right-2 z-[1000] flex flex-wrap items-center gap-2 pointer-events-none">
                {/* Back button */}
                <button
                    onClick={onBack}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md shadow-sm text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors pointer-events-auto"
                >
                    <ArrowLeft size={14} />
                    Back
                </button>

                {/* Title */}
                <div className="bg-white/90 backdrop-blur-sm rounded-md px-2.5 py-1.5 shadow-sm border border-gray-200 pointer-events-auto">
                    <span className="text-xs font-bold text-gray-700">Directional Corridor Headway</span>
                    <span className="text-[10px] text-gray-400 ml-1.5">{periodLabel} · {dayTypeLabel}</span>
                    {segments.length > 0 && (
                        <span className="text-[10px] text-gray-400 ml-1.5">
                            · {segments.filter(s => s.isShared).length} shared / {segments.length} total
                        </span>
                    )}
                </div>

                {/* Filters */}
                <div className="pointer-events-auto">
                    <HeadwayFilterBar
                        period={period}
                        dayType={dayType}
                        onPeriodChange={setPeriod}
                        onDayTypeChange={setDayType}
                    />
                </div>

                <div className="flex-1" />

                {/* Fullscreen */}
                <button
                    onClick={toggleFullscreen}
                    className="bg-white border border-gray-300 rounded-md px-2 py-1.5 shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-1.5 text-xs font-medium text-gray-600 pointer-events-auto"
                    title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                >
                    {isFullscreen ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                            <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                    )}
                    {isFullscreen ? 'Exit' : 'Fullscreen'}
                </button>
            </div>

            {/* ─── Legend ─── */}
            <HeadwayLegend />

            {/* ─── Detail Panel ─── */}
            {selectedSegment && (
                <CorridorDetailPanel
                    segment={selectedSegment}
                    headway={selectedHeadway}
                    periodLabel={periodLabel}
                    dayTypeLabel={dayTypeLabel}
                    onClose={clearSelection}
                />
            )}

            {/* ─── Loading overlay ─── */}
            {loading && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-white/80">
                    <div className="text-sm text-gray-500 animate-pulse">Building corridor map...</div>
                </div>
            )}

            {/* ─── Empty state ─── */}
            {!loading && segments.length === 0 && (
                <div className="absolute inset-0 z-[1001] flex items-center justify-center pointer-events-none">
                    <div className="bg-white/95 rounded-lg shadow-md border border-gray-200 px-6 py-4 text-center">
                        <div className="text-sm font-medium text-gray-700 mb-1">No corridor data</div>
                        <div className="text-xs text-gray-400">GTFS stop_times data could not be parsed.</div>
                    </div>
                </div>
            )}

            {/* ─── Map Container ─── */}
            <div className={isFullscreen ? 'flex-1 w-full min-h-0' : 'h-[750px] w-full rounded-lg'}>
                <MapBase
                    mapRef={mapRef}
                    showNavigation
                    showScale
                    className="w-full h-full"
                    interactiveLayerIds={[CORRIDOR_LAYER]}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}
                >
                    {/* Corridor polylines */}
                    <Source id={CORRIDOR_SRC} type="geojson" data={corridorGeoJSON}>
                        <Layer {...corridorLayerStyle} />
                        <Layer {...corridorHoverLayerStyle} />
                    </Source>

                    {/* Blue highlight for selected segment */}
                    <Source id={HIGHLIGHT_SRC} type="geojson" data={highlightGeoJSON}>
                        <Layer {...highlightLayerStyle} />
                    </Source>

                    {/* Junction stops (white dots, minZoom 14) */}
                    <StopDotLayer
                        stops={junctionStopPoints}
                        radius={4}
                        color="#ffffff"
                        opacity={0.9}
                        outlineColor="#374151"
                        outlineWidth={1.5}
                        minZoom={14}
                        idPrefix="junction-stops"
                    />

                    {/* Hover tooltip */}
                    {hoverInfo && (
                        <Popup
                            longitude={hoverInfo.longitude}
                            latitude={hoverInfo.latitude}
                            closeButton={false}
                            closeOnClick={false}
                            anchor="bottom"
                            offset={8}
                        >
                            <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                                <strong>Routes: {hoverInfo.props.routeList}</strong><br />
                                {hoverInfo.props.headwayText}<br />
                                <span style={{ color: '#9ca3af' }}>
                                    {hoverInfo.props.directionText}
                                </span>
                            </div>
                        </Popup>
                    )}
                </MapBase>
            </div>
        </div>
    );
};
