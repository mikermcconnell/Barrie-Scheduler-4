/**
 * Corridor Headway Map
 *
 * Leaflet map showing corridor-level headway where multiple routes overlap
 * on the same road. Shared corridors are colored/weighted by combined headway;
 * single-route segments are shown as thin route-colored lines.
 *
 * Follows StopActivityMap pattern: raw Leaflet via useRef/useEffect for React 19 compat.
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft } from 'lucide-react';
import { buildCorridorSegments, getCorridorJunctionStops, type CorridorSegment } from '../../utils/gtfs/corridorBuilder';
import {
    computeCorridorHeadways,
    getHeadwayStyle,
    TIME_PERIODS,
    DAY_TYPES,
    type TimePeriod,
    type DayType,
    type SegmentHeadway,
} from '../../utils/gtfs/corridorHeadway';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { HeadwayFilterBar } from './HeadwayFilterBar';
import { HeadwayLegend } from './HeadwayLegend';
import { CorridorDetailPanel } from './CorridorDetailPanel';

// ─── Constants ──────────────────────────────────────────────────────────

const BARRIE_CENTER: [number, number] = [44.38, -79.69];

interface HeadwayMapProps {
    onBack: () => void;
}

// ─── Main Component ─────────────────────────────────────────────────────

export const HeadwayMap: React.FC<HeadwayMapProps> = ({ onBack }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const corridorLayerRef = useRef<L.LayerGroup | null>(null);
    const junctionLayerRef = useRef<L.LayerGroup | null>(null);
    const highlightRef = useRef<L.Polyline | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [period, setPeriod] = useState<TimePeriod>('full-day');
    const [dayType, setDayType] = useState<DayType>('weekday');
    const [selectedSegment, setSelectedSegment] = useState<CorridorSegment | null>(null);
    const [loading, setLoading] = useState(true);

    // ─── Data ───────────────────────────────────────────────────────

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
        () => selectedSegment ? headways.get(selectedSegment.id) || null : null,
        [selectedSegment, headways],
    );

    const periodLabel = TIME_PERIODS.find(p => p.id === period)?.label || '';
    const dayTypeLabel = DAY_TYPES.find(d => d.id === dayType)?.label || '';

    // ─── Callbacks ──────────────────────────────────────────────────

    const toggleFullscreen = useCallback(() => setIsFullscreen(p => !p), []);

    const clearHighlight = useCallback(() => {
        if (highlightRef.current) {
            highlightRef.current.remove();
            highlightRef.current = null;
        }
    }, []);

    const highlightSegment = useCallback((seg: CorridorSegment) => {
        clearHighlight();
        const map = mapRef.current;
        if (!map || seg.geometry.length < 2) return;
        highlightRef.current = L.polyline(seg.geometry, {
            color: '#3b82f6',
            weight: 12,
            opacity: 0.3,
            interactive: false,
        }).addTo(map);
    }, [clearHighlight]);

    // ─── Effects ────────────────────────────────────────────────────

    // Escape key
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (selectedSegment) { setSelectedSegment(null); clearHighlight(); return; }
            if (isFullscreen) setIsFullscreen(false);
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [isFullscreen, selectedSegment, clearHighlight]);

    // Invalidate on fullscreen toggle
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
        const t1 = setTimeout(() => map.invalidateSize({ animate: false }), 100);
        const t2 = setTimeout(() => map.invalidateSize({ animate: false }), 300);
        return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
    }, [isFullscreen]);

    // Init map
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

        corridorLayerRef.current = L.layerGroup().addTo(map);
        junctionLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            map.remove();
            mapRef.current = null;
            corridorLayerRef.current = null;
            junctionLayerRef.current = null;
        };
    }, []);

    // Sync corridor polylines
    useEffect(() => {
        const layer = corridorLayerRef.current;
        if (!layer) return;
        layer.clearLayers();
        clearHighlight();

        if (segments.length === 0) return;

        // Draw single-route segments first (underneath), then shared
        const sorted = [...segments].sort((a, b) => {
            if (a.isShared === b.isShared) return 0;
            return a.isShared ? 1 : -1; // shared on top
        });

        for (const seg of sorted) {
            if (seg.geometry.length < 2) continue;

            const hw = headways.get(seg.id);
            const headwayMin = hw?.combinedHeadwayMin ?? null;

            let style: { color: string; weight: number; opacity: number };
            if (seg.isShared) {
                style = getHeadwayStyle(headwayMin, true);
            } else {
                // Single route: use route color
                const routeColor = seg.routeColors[0] || '888888';
                style = { color: `#${routeColor}`, weight: 2, opacity: 0.6 };
            }

            const polyline = L.polyline(seg.geometry, {
                color: style.color,
                weight: style.weight,
                opacity: style.opacity,
                lineCap: 'round',
                lineJoin: 'round',
            });

            // Tooltip
            const routeList = seg.routes.join(', ');
            const headwayText = hw
                ? hw.combinedHeadwayMin !== null
                    ? `Every ${hw.combinedHeadwayMin} min (${hw.combinedTripsPerHour} trips/hr · ${hw.totalTrips} trips)`
                    : `No service (${hw.totalTrips} trips)`
                : 'No data';
            polyline.bindTooltip(
                `<div style="font-size:11px;line-height:1.4">
                    <strong>Routes: ${routeList}</strong><br/>
                    ${headwayText}<br/>
                    <span style="color:#9ca3af">${seg.stopNames[0]} → ${seg.stopNames[seg.stopNames.length - 1]}</span>
                </div>`,
                { sticky: true },
            );

            // Hover
            polyline.on('mouseover', () => {
                polyline.setStyle({ weight: style.weight + 3, opacity: Math.min(style.opacity + 0.15, 1) });
            });
            polyline.on('mouseout', () => {
                polyline.setStyle({ weight: style.weight, opacity: style.opacity });
            });

            // Click
            polyline.on('click', () => {
                setSelectedSegment(seg);
                highlightSegment(seg);
            });

            polyline.addTo(layer);
        }
    }, [segments, headways, clearHighlight, highlightSegment]);

    // Sync junction markers
    useEffect(() => {
        const layer = junctionLayerRef.current;
        const map = mapRef.current;
        if (!layer || !map) return;

        const updateJunctions = () => {
            layer.clearLayers();
            const zoom = map.getZoom();
            if (zoom < 14) return; // Only show at higher zoom

            for (const stopId of junctionStops) {
                const coords = stopCoords.get(stopId);
                if (!coords) continue;
                const marker = L.circleMarker([coords.lat, coords.lon], {
                    radius: 4,
                    fillColor: '#ffffff',
                    fillOpacity: 0.9,
                    color: '#374151',
                    weight: 1.5,
                });
                marker.bindTooltip(coords.name, { direction: 'top', offset: [0, -6] });
                marker.addTo(layer);
            }
        };

        updateJunctions();
        map.on('zoomend', updateJunctions);
        return () => { map.off('zoomend', updateJunctions); };
    }, [junctionStops, stopCoords]);

    // Re-highlight selected segment when headways change
    useEffect(() => {
        if (selectedSegment) highlightSegment(selectedSegment);
    }, [selectedSegment, highlightSegment]);

    // ─── Render ─────────────────────────────────────────────────────

    return (
        <div
            ref={wrapperRef}
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
                    <span className="text-xs font-bold text-gray-700">Corridor Headway</span>
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
                    onClose={() => { setSelectedSegment(null); clearHighlight(); }}
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
            <div
                ref={containerRef}
                className={isFullscreen ? 'flex-1 w-full min-h-0' : 'h-[750px] w-full rounded-lg'}
            />
        </div>
    );
};
