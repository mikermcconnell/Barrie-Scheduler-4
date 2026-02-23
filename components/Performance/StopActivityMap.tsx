/**
 * Stop Activity Heatmap Map
 *
 * Full-featured Leaflet map for transit ridership analysis:
 * - 10-bin log-scale color coding (hollow zero → gray → yellow → orange → red)
 * - Zoom-dependent marker sizing
 * - Legend overlay
 * - Stop labels at high zoom
 * - Click-to-detail panel with hourly sparkline
 * - Boardings / Alightings / Total view toggle
 * - Route filter dropdown
 * - GTFS route lines overlay
 * - Hour-of-day slider with play/pause animation
 * - Stop search bar with autocomplete
 * - Fullscreen mode
 *
 * Coordinates enriched from GTFS stops.txt (authoritative source).
 * Uses raw Leaflet via useRef/useEffect for React 19 compat.
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { StopMetrics } from '../../utils/performanceDataTypes';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';
import {
    getStopActivityBreakdown,
    getStopRouteActivityBreakdown,
    getStopActivityValue,
    hasHourlyDataForStops,
    matchesStopSearch,
} from '../../utils/performanceStopActivity';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StopActivityMapProps {
    stops: StopMetrics[];
}

type ViewMode = 'total' | 'boardings' | 'alightings';

interface EnrichedStop extends StopMetrics {
    activity: number; // computed per viewMode + hour
    filteredBoardings: number; // reflects active hour filter
    filteredAlightings: number; // reflects active hour filter
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BARRIE_CENTER: [number, number] = [44.38, -79.69];
const OUTLINE_COLOR = '#374151';
const REFERENCE_ZOOM = 14;

/** 10-bin "Clean Heat" scale: hollow zero, solid fill for all non-zero bins */
const BINS = [
    { fill: 'transparent', fillOpacity: 0,    radius: 3,  label: 'Zero' },
    { fill: '#d1d5db',     fillOpacity: 0.70, radius: 4,  label: 'Minimal' },
    { fill: '#b0b5bc',     fillOpacity: 0.75, radius: 5,  label: 'Very Low' },
    { fill: '#fef9c3',     fillOpacity: 0.80, radius: 6,  label: 'Low' },
    { fill: '#fde68a',     fillOpacity: 0.82, radius: 7,  label: 'Below Avg' },
    { fill: '#fbbf24',     fillOpacity: 0.85, radius: 9,  label: 'Average' },
    { fill: '#f59e0b',     fillOpacity: 0.88, radius: 11, label: 'Above Avg' },
    { fill: '#f97316',     fillOpacity: 0.90, radius: 14, label: 'High' },
    { fill: '#ef4444',     fillOpacity: 0.93, radius: 17, label: 'Very High' },
    { fill: '#b91c1c',     fillOpacity: 0.95, radius: 21, label: 'Peak' },
] as const;

/** Predefined time-of-day ranges for quick investigation */
const HOUR_PRESETS: { label: string; detail: string; hours: number[] }[] = [
    { label: 'Early AM',   detail: '5–6 AM',   hours: [5, 6] },
    { label: 'AM Peak',    detail: '7–9 AM',   hours: [7, 8, 9] },
    { label: 'Midday',     detail: '10 AM–2 PM', hours: [10, 11, 12, 13, 14] },
    { label: 'PM Peak',    detail: '3–6 PM',   hours: [15, 16, 17, 18] },
    { label: 'Evening',    detail: '7–9 PM',   hours: [19, 20, 21] },
    { label: 'Late Night', detail: '10 PM–1 AM', hours: [22, 23, 0, 1] },
];

// ─── Utility Functions ──────────────────────────────────────────────────────

function zoomScale(zoom: number): number {
    return Math.max(0.3, Math.min(Math.pow(2, (zoom - REFERENCE_ZOOM) * 0.5), 2.0));
}

/** Log-scale binning: 0 for zero activity, 1-9 for non-zero using log intervals. */
function assignBins(activities: number[]): number[] {
    const nonZero = activities.filter(a => a > 0);
    if (nonZero.length === 0) return activities.map(() => 0);

    const logMax = Math.log(Math.max(...nonZero) + 1);
    if (logMax === 0) return activities.map(a => a > 0 ? 1 : 0);

    return activities.map(a => {
        if (a === 0) return 0;
        const t = Math.log(a + 1) / logMax; // 0→1
        const bin = Math.ceil(t * 9);       // 1→9
        return Math.max(1, Math.min(9, bin));
    });
}

function buildGtfsCoordsMap(): Map<string, { lat: number; lon: number; name: string }> {
    const gtfsStops = getAllStopsWithCoords();
    const map = new Map<string, { lat: number; lon: number; name: string }>();
    for (const s of gtfsStops) {
        map.set(s.stop_id, { lat: s.lat, lon: s.lon, name: s.stop_name });
    }
    return map;
}

function escapeHtml(raw: string): string {
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Ray-casting point-in-polygon test (geographic coords). */
function pointInPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [yi, xi] = poly[i], [yj, xj] = poly[j];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

const Legend: React.FC = () => (
    <div className="absolute bottom-6 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 px-2.5 py-2 text-[10px] pointer-events-auto">
        <div className="font-bold text-gray-600 mb-1 text-[11px]">Activity</div>
        {BINS.map((bin, i) => (
            <div key={i} className="flex items-center gap-1.5 py-[1px]">
                <span
                    className="inline-block w-3 h-3 rounded-full border flex-shrink-0"
                    style={{
                        backgroundColor: bin.fill === 'transparent' ? 'white' : bin.fill,
                        borderColor: OUTLINE_COLOR,
                        borderWidth: i === 0 ? 1.5 : 1,
                        opacity: i === 0 ? 0.5 : bin.fillOpacity + 0.1,
                    }}
                />
                <span className="text-gray-500">{bin.label}</span>
            </div>
        ))}
    </div>
);

const DetailPanel: React.FC<{
    stop: EnrichedStop;
    rank: number;
    total: number;
    activeHours: number[] | null;
    onClose: () => void;
}> = ({ stop, rank, total, activeHours, onClose }) => {
    const hasHourly = !!(stop.hourlyBoardings || stop.hourlyAlightings);
    const hourlyData = hasHourly
        ? Array.from({ length: 24 }, (_, h) => ({
            b: stop.hourlyBoardings?.[h] || 0,
            a: stop.hourlyAlightings?.[h] || 0,
        }))
        : null;
    const maxHourly = hourlyData
        ? Math.max(...hourlyData.map(d => d.b + d.a), 1)
        : 1;
    const routeRows = getStopRouteActivityBreakdown(stop, activeHours);
    const totalActivity = stop.filteredBoardings + stop.filteredAlightings;
    const attributedActivity = routeRows.reduce((sum, row) => sum + row.total, 0);
    const unattributedActivity = Math.max(0, totalActivity - attributedActivity);

    return (
        <div className="absolute top-2 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 w-72 pointer-events-auto">
            <div className="flex items-start justify-between px-3 pt-2.5 pb-1">
                <div>
                    <div className="font-bold text-gray-900 text-sm leading-tight">{stop.stopName}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">Stop {stop.stopId} · #{rank} of {total}</div>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 -mt-0.5 -mr-1 p-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-3 py-2 border-t border-gray-100">
                <div className="text-center">
                    <div className="text-xs font-bold text-cyan-600">{stop.filteredBoardings.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400 uppercase">Boardings</div>
                </div>
                <div className="text-center">
                    <div className="text-xs font-bold text-purple-600">{stop.filteredAlightings.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400 uppercase">Alightings</div>
                </div>
                <div className="text-center">
                    <div className="text-xs font-bold text-gray-800">{(stop.filteredBoardings + stop.filteredAlightings).toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400 uppercase">Total</div>
                </div>
            </div>
            {(routeRows.length > 0 || unattributedActivity > 0) && (
                <div className="px-3 py-2 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-1">
                        <div className="text-[9px] text-gray-400 uppercase">Ridership by Route</div>
                        {activeHours !== null && (
                            <div className="text-[8px] text-gray-300 uppercase">Selected Hours</div>
                        )}
                    </div>
                    <table className="w-full text-[10px]">
                        <thead>
                            <tr className="text-gray-400 uppercase">
                                <th className="text-left font-normal py-0.5">Route</th>
                                <th className="text-right font-normal py-0.5">Total</th>
                                <th className="text-right font-normal py-0.5">Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            {routeRows.map(row => {
                                const pct = totalActivity > 0 ? (row.total / totalActivity) * 100 : 0;
                                return (
                                    <tr key={row.routeId} className="border-t border-gray-50">
                                        <td className="py-0.5 text-gray-700 font-semibold">Route {row.routeId}</td>
                                        <td className="py-0.5 text-right text-gray-700 tabular-nums">{row.total.toLocaleString()}</td>
                                        <td className="py-0.5 text-right text-gray-500 tabular-nums">{pct.toFixed(1)}%</td>
                                    </tr>
                                );
                            })}
                            {unattributedActivity > 0 && (
                                <tr className="border-t border-gray-50">
                                    <td className="py-0.5 text-gray-500 font-semibold">Unattributed</td>
                                    <td className="py-0.5 text-right text-gray-500 tabular-nums">{unattributedActivity.toLocaleString()}</td>
                                    <td className="py-0.5 text-right text-gray-400 tabular-nums">
                                        {totalActivity > 0 ? ((unattributedActivity / totalActivity) * 100).toFixed(1) : '0.0'}%
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {stop.routes && stop.routes.length > 0 && (
                <div className="px-3 py-1.5 border-t border-gray-100">
                    <div className="text-[9px] text-gray-400 uppercase mb-0.5">Routes</div>
                    <div className="flex flex-wrap gap-1">
                        {stop.routes.map(r => (
                            <span key={r} className="bg-gray-100 text-gray-700 text-[10px] font-bold px-1.5 py-0.5 rounded">{r}</span>
                        ))}
                    </div>
                </div>
            )}
            {hourlyData && (
                <div className="px-3 py-2 border-t border-gray-100">
                    <div className="text-[9px] text-gray-400 uppercase mb-1">Hourly Pattern</div>
                    <svg width="100%" height="40" viewBox="0 0 240 40" preserveAspectRatio="none">
                        {hourlyData.map((d, h) => {
                            const barH = ((d.b + d.a) / maxHourly) * 36;
                            return (
                                <rect key={h} x={h * 10} y={40 - barH} width="8" height={barH}
                                    rx="1" fill={d.b + d.a > 0 ? '#06b6d4' : '#e5e7eb'} opacity="0.8" />
                            );
                        })}
                    </svg>
                    <div className="flex justify-between text-[8px] text-gray-300 mt-0.5">
                        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                    </div>
                </div>
            )}
        </div>
    );
};

const LassoSummaryPanel: React.FC<{
    selected: EnrichedStop[];
    onClose: () => void;
}> = ({ selected, onClose }) => {
    const totalB = selected.reduce((s, x) => s + x.filteredBoardings, 0);
    const totalA = selected.reduce((s, x) => s + x.filteredAlightings, 0);
    const routeSet = new Set<string>();
    for (const s of selected) s.routes?.forEach(r => routeSet.add(r));
    const routes = Array.from(routeSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const ranked = [...selected].sort((a, b) => b.activity - a.activity).slice(0, 20);

    return (
        <div className="absolute top-2 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 w-80 pointer-events-auto max-h-[calc(100%-5rem)] overflow-y-auto">
            <div className="flex items-start justify-between px-3 pt-2.5 pb-1">
                <div>
                    <div className="font-bold text-gray-900 text-sm leading-tight">Lasso Selection</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{selected.length} stops selected</div>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 -mt-0.5 -mr-1 p-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-3 py-2 border-t border-gray-100">
                <div className="text-center">
                    <div className="text-xs font-bold text-cyan-600">{totalB.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400 uppercase">Boardings</div>
                </div>
                <div className="text-center">
                    <div className="text-xs font-bold text-purple-600">{totalA.toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400 uppercase">Alightings</div>
                </div>
                <div className="text-center">
                    <div className="text-xs font-bold text-gray-800">{(totalB + totalA).toLocaleString()}</div>
                    <div className="text-[9px] text-gray-400 uppercase">Total</div>
                </div>
            </div>
            {routes.length > 0 && (
                <div className="px-3 py-1.5 border-t border-gray-100">
                    <div className="text-[9px] text-gray-400 uppercase mb-0.5">Routes Served</div>
                    <div className="flex flex-wrap gap-1">
                        {routes.map(r => (
                            <span key={r} className="bg-gray-100 text-gray-700 text-[10px] font-bold px-1.5 py-0.5 rounded">{r}</span>
                        ))}
                    </div>
                </div>
            )}
            <div className="px-3 py-2 border-t border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase mb-1">Top Stops by Activity</div>
                <table className="w-full text-[10px]">
                    <tbody>
                        {ranked.map((s, i) => (
                            <tr key={s.stopId} className="border-b border-gray-50 last:border-b-0">
                                <td className="py-0.5 pr-1 text-gray-300 w-5 text-right">{i + 1}</td>
                                <td className="py-0.5 text-gray-700 font-medium truncate max-w-[140px]">{s.stopName}</td>
                                <td className="py-0.5 pl-1 text-right text-gray-500 tabular-nums">{s.activity.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// ─── Main Component ─────────────────────────────────────────────────────────

export const StopActivityMap: React.FC<StopActivityMapProps> = ({ stops }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerLayerRef = useRef<L.LayerGroup | null>(null);
    const labelLayerRef = useRef<L.LayerGroup | null>(null);
    const routeLayerRef = useRef<L.LayerGroup | null>(null);
    const markersRef = useRef<{ marker: L.CircleMarker; bin: number; stop: EnrichedStop }[]>([]);
    const hasFittedRef = useRef(false);
    const highlightRef = useRef<L.CircleMarker | null>(null);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('total');
    const [selectedRoute, setSelectedRoute] = useState<string>('all');
    const [selectedStop, setSelectedStop] = useState<EnrichedStop | null>(null);
    const [activeHours, setActiveHours] = useState<number[] | null>(null);
    const [activePreset, setActivePreset] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const [showRouteLines, setShowRouteLines] = useState(true);
    const [lassoMode, setLassoMode] = useState(false);
    const [lassoSelection, setLassoSelection] = useState<EnrichedStop[] | null>(null);
    const lassoModeRef = useRef(false);
    const lassoLayerRef = useRef<L.LayerGroup | null>(null);
    const lassoHighlightsRef = useRef<L.CircleMarker[]>([]);
    const lassoDrawingRef = useRef<{ points: L.LatLng[]; polygon: L.Polygon } | null>(null);

    // ─── Memos ──────────────────────────────────────────────────────────

    const gtfsCoords = useMemo(() => buildGtfsCoordsMap(), []);

    const enrichedStops = useMemo(() => {
        return stops.map(stop => {
            const gtfs = gtfsCoords.get(stop.stopId);
            return gtfs ? { ...stop, lat: gtfs.lat, lon: gtfs.lon } : stop;
        });
    }, [stops, gtfsCoords]);

    const hasHourlyData = useMemo(() => hasHourlyDataForStops(enrichedStops), [enrichedStops]);

    const availableRoutes = useMemo(() => {
        const set = new Set<string>();
        for (const s of enrichedStops) {
            if (s.routes) s.routes.forEach(r => set.add(r));
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }, [enrichedStops]);

    const hasRoutes = availableRoutes.length > 0;

    const routeShapes = useMemo(() => {
        try { return loadGtfsRouteShapes(); } catch { return []; }
    }, []);

    const filteredStops = useMemo(() => {
        let result = enrichedStops.filter(s => s.lat && s.lon);
        if (selectedRoute !== 'all' && hasRoutes) {
            result = result.filter(s => s.routes?.includes(selectedRoute));
        }
        return result.map(s => {
            const filteredBreakdown = getStopActivityBreakdown(s, activeHours);
            return {
                ...s,
                filteredBoardings: filteredBreakdown.boardings,
                filteredAlightings: filteredBreakdown.alightings,
                activity: getStopActivityValue(s, viewMode, activeHours),
            };
        }) as EnrichedStop[];
    }, [enrichedStops, selectedRoute, hasRoutes, viewMode, activeHours]);

    // Sorted by activity for rank lookup
    const rankedStops = useMemo(() => {
        return [...filteredStops].sort((a, b) => b.activity - a.activity);
    }, [filteredStops]);

    // Search results
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        return filteredStops
            .filter(s => matchesStopSearch(s, searchQuery))
            .sort((a, b) => b.activity - a.activity)
            .slice(0, 8);
    }, [filteredStops, searchQuery]);

    // ─── Callbacks ──────────────────────────────────────────────────────

    const toggleFullscreen = useCallback(() => setIsFullscreen(p => !p), []);

    const applyZoomScale = useCallback((zoom: number) => {
        const scale = zoomScale(zoom);
        for (const { marker, bin } of markersRef.current) {
            marker.setRadius(BINS[bin].radius * scale);
        }
    }, []);

    const updateLabels = useCallback((zoom: number) => {
        const layer = labelLayerRef.current;
        if (!layer) return;
        layer.clearLayers();
        if (zoom < 15) return;

        const minBin = zoom >= 16 ? 1 : 7;
        const scale = zoomScale(zoom);
        for (const { stop, bin } of markersRef.current) {
            if (bin < minBin) continue;
            const offset = BINS[bin].radius * scale + 4;
            L.marker([stop.lat, stop.lon], {
                icon: L.divIcon({
                    className: 'stop-label-icon',
                    html: `<span style="font-size:9px;font-weight:600;color:#374151;white-space:nowrap;text-shadow:0 0 3px white,0 0 3px white,0 0 3px white">${escapeHtml(stop.stopName)}</span>`,
                    iconAnchor: [-offset, 5],
                }),
                interactive: false,
            }).addTo(layer);
        }
    }, []);

    const highlightStop = useCallback((stop: EnrichedStop) => {
        if (highlightRef.current) {
            highlightRef.current.remove();
            highlightRef.current = null;
        }
        const map = mapRef.current;
        if (!map) return;
        const scale = zoomScale(map.getZoom());
        const entry = markersRef.current.find(m => m.stop.stopId === stop.stopId);
        const r = entry ? BINS[entry.bin].radius * scale + 6 : 20;
        highlightRef.current = L.circleMarker([stop.lat, stop.lon], {
            radius: r,
            color: '#3b82f6',
            weight: 3,
            fillColor: '#3b82f6',
            fillOpacity: 0.15,
            interactive: false,
        }).addTo(map);
    }, []);

    const clearHighlight = useCallback(() => {
        if (highlightRef.current) {
            highlightRef.current.remove();
            highlightRef.current = null;
        }
    }, []);

    const flyToStop = useCallback((stop: EnrichedStop) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo([stop.lat, stop.lon], 16, { duration: 0.5 });
        setSelectedStop(stop);
        setSearchQuery('');
        setSearchFocused(false);
        highlightStop(stop);
    }, [highlightStop]);

    const clearLassoSelection = useCallback(() => {
        for (const c of lassoHighlightsRef.current) c.remove();
        lassoHighlightsRef.current = [];
        lassoLayerRef.current?.clearLayers();
        setLassoSelection(null);
    }, []);

    const toggleLassoMode = useCallback(() => {
        const next = !lassoModeRef.current;
        lassoModeRef.current = next;
        setLassoMode(next);
        const map = mapRef.current;
        if (!map) return;
        if (next) {
            map.dragging.disable();
            (map.getContainer() as HTMLElement).style.cursor = 'crosshair';
            // Clear any single-stop selection
            setSelectedStop(null);
            clearHighlight();
            clearLassoSelection();
        } else {
            map.dragging.enable();
            (map.getContainer() as HTMLElement).style.cursor = '';
            clearLassoSelection();
        }
    }, [clearHighlight, clearLassoSelection]);

    // ─── Effects ────────────────────────────────────────────────────────

    // Escape key — priority: clear lasso selection → exit lasso mode → exit fullscreen
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (lassoSelection) { clearLassoSelection(); return; }
            if (lassoModeRef.current) { toggleLassoMode(); return; }
            if (isFullscreen) setIsFullscreen(false);
        };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [isFullscreen, lassoSelection, clearLassoSelection, toggleLassoMode]);

    // Invalidate on fullscreen toggle — multiple calls to ensure tiles render
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
        const t1 = setTimeout(() => map.invalidateSize({ animate: false }), 100);
        const t2 = setTimeout(() => map.invalidateSize({ animate: false }), 300);
        return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
    }, [isFullscreen]);

    // Hour animation — steps through single hours 5→23
    const playHourRef = useRef(5);
    useEffect(() => {
        if (!isPlaying) return;
        const timer = setInterval(() => {
            const next = playHourRef.current + 1;
            if (next > 23) {
                setIsPlaying(false);
                setActiveHours(null);
                setActivePreset(null);
                playHourRef.current = 5;
                return;
            }
            playHourRef.current = next;
            setActiveHours([next]);
            setActivePreset(null);
        }, 800);
        return () => clearInterval(timer);
    }, [isPlaying]);

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

        routeLayerRef.current = L.layerGroup().addTo(map);
        markerLayerRef.current = L.layerGroup().addTo(map);
        labelLayerRef.current = L.layerGroup().addTo(map);
        lassoLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        map.on('zoomend', () => {
            const z = map.getZoom();
            applyZoomScale(z);
            updateLabels(z);
        });

        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            map.remove();
            mapRef.current = null;
            markerLayerRef.current = null;
            labelLayerRef.current = null;
            routeLayerRef.current = null;
            lassoLayerRef.current = null;
            markersRef.current = [];
        };
    }, [applyZoomScale, updateLabels]);

    // Sync route lines
    useEffect(() => {
        const layer = routeLayerRef.current;
        if (!layer) return;
        layer.clearLayers();
        if (!showRouteLines || routeShapes.length === 0) return;

        const shapes = selectedRoute === 'all'
            ? routeShapes
            : routeShapes.filter(s => s.routeId === selectedRoute || s.routeShortName === selectedRoute);

        for (const shape of shapes) {
            if (shape.points.length < 2) continue;
            L.polyline(shape.points, {
                color: `#${shape.routeColor}`,
                weight: selectedRoute === 'all' ? 2.5 : 4,
                opacity: selectedRoute === 'all' ? 0.65 : 0.85,
                interactive: false,
            }).addTo(layer);
        }
    }, [routeShapes, selectedRoute, showRouteLines]);

    // Lasso drawing handlers
    useEffect(() => {
        const container = containerRef.current;
        const map = mapRef.current;
        if (!container || !map) return;

        const onMouseDown = (e: MouseEvent) => {
            if (!lassoModeRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            // Clear previous selection
            for (const c of lassoHighlightsRef.current) c.remove();
            lassoHighlightsRef.current = [];
            lassoLayerRef.current?.clearLayers();
            setLassoSelection(null);

            const rect = container.getBoundingClientRect();
            const pt = L.point(e.clientX - rect.left, e.clientY - rect.top);
            const latlng = map.containerPointToLatLng(pt);
            const polygon = L.polygon([latlng], {
                color: '#f59e0b',
                weight: 2,
                dashArray: '6 4',
                fillColor: '#f59e0b',
                fillOpacity: 0.1,
                interactive: false,
            });
            polygon.addTo(lassoLayerRef.current!);
            lassoDrawingRef.current = { points: [latlng], polygon };
        };

        const onMouseMove = (e: MouseEvent) => {
            const drawing = lassoDrawingRef.current;
            if (!drawing) return;
            const rect = container.getBoundingClientRect();
            const pt = L.point(e.clientX - rect.left, e.clientY - rect.top);
            const latlng = map.containerPointToLatLng(pt);
            drawing.points.push(latlng);
            drawing.polygon.setLatLngs(drawing.points);
        };

        const onMouseUp = () => {
            const drawing = lassoDrawingRef.current;
            if (!drawing) return;
            lassoDrawingRef.current = null;

            if (drawing.points.length < 3) {
                lassoLayerRef.current?.clearLayers();
                return;
            }

            const polyCoords: [number, number][] = drawing.points.map(p => [p.lat, p.lng]);
            const hits: EnrichedStop[] = [];
            for (const { stop } of markersRef.current) {
                if (pointInPolygon(stop.lat, stop.lon, polyCoords)) {
                    hits.push(stop);
                }
            }

            if (hits.length === 0) {
                lassoLayerRef.current?.clearLayers();
                return;
            }

            // Highlight selected stops with amber circles
            const scale = zoomScale(map.getZoom());
            for (const stop of hits) {
                const entry = markersRef.current.find(m => m.stop.stopId === stop.stopId);
                const r = entry ? BINS[entry.bin].radius * scale + 4 : 14;
                const hl = L.circleMarker([stop.lat, stop.lon], {
                    radius: r,
                    color: '#f59e0b',
                    weight: 2.5,
                    fillColor: '#f59e0b',
                    fillOpacity: 0.2,
                    interactive: false,
                }).addTo(map);
                lassoHighlightsRef.current.push(hl);
            }
            setLassoSelection(hits);
        };

        container.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            container.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    // Sync markers
    useEffect(() => {
        const layer = markerLayerRef.current;
        const map = mapRef.current;
        if (!layer) return;
        layer.clearLayers();
        markersRef.current = [];
        clearHighlight();
        // Clear lasso selection when markers rebuild (route/view/hour change)
        for (const c of lassoHighlightsRef.current) c.remove();
        lassoHighlightsRef.current = [];
        lassoLayerRef.current?.clearLayers();
        setLassoSelection(null);

        if (filteredStops.length === 0) return;

        const activities = filteredStops.map(s => s.activity);
        const bins = assignBins(activities);

        // Sort low→high so high-activity renders on top
        const indexed = filteredStops.map((s, i) => ({ stop: s, bin: bins[i] }));
        indexed.sort((a, b) => a.bin - b.bin);

        const scale = map ? zoomScale(map.getZoom()) : 1;

        for (const { stop, bin } of indexed) {
            const cfg = BINS[bin];
            const isHollow = bin === 0;
            const scaledR = cfg.radius * scale;
            const safeStopName = escapeHtml(stop.stopName);
            const safeStopId = escapeHtml(stop.stopId);

            const marker = L.circleMarker([stop.lat, stop.lon], {
                radius: scaledR,
                fillColor: cfg.fill,
                fillOpacity: cfg.fillOpacity,
                color: OUTLINE_COLOR,
                weight: isHollow ? 1.5 : 1,
                opacity: isHollow ? 0.4 : 0.8,
            });

            marker.bindTooltip(
                `<div style="font-size:12px;line-height:1.4">
                    <strong>${safeStopName}</strong> <span style="color:#9ca3af">(${safeStopId})</span><br/>
                    Boardings: ${stop.filteredBoardings.toLocaleString()}<br/>
                    Alightings: ${stop.filteredAlightings.toLocaleString()}<br/>
                    Activity: ${(stop.filteredBoardings + stop.filteredAlightings).toLocaleString()}
                </div>`,
                { direction: 'top', offset: [0, -scaledR] }
            );

            if (!isHollow) {
                marker.on('mouseover', () => {
                    const cs = map ? zoomScale(map.getZoom()) : 1;
                    marker.setStyle({ radius: cfg.radius * cs + 3, fillOpacity: Math.min(cfg.fillOpacity + 0.1, 1) });
                });
                marker.on('mouseout', () => {
                    const cs = map ? zoomScale(map.getZoom()) : 1;
                    marker.setStyle({ radius: cfg.radius * cs, fillOpacity: cfg.fillOpacity });
                });
            }

            marker.on('click', () => {
                if (lassoModeRef.current) return;
                setSelectedStop(stop);
                highlightStop(stop);
            });

            marker.addTo(layer);
            markersRef.current.push({ marker, bin, stop });
        }

        // Auto-fit on first load
        if (!hasFittedRef.current && filteredStops.length > 0 && map) {
            const bounds = L.latLngBounds(filteredStops.map(s => [s.lat, s.lon] as [number, number]));
            map.fitBounds(bounds, { padding: [20, 20] });
            hasFittedRef.current = true;
        }

        // Update labels for current zoom
        if (map) updateLabels(map.getZoom());
    }, [filteredStops, clearHighlight, highlightStop, updateLabels]);

    // Re-highlight selected stop when markers rebuild
    useEffect(() => {
        if (selectedStop) highlightStop(selectedStop);
    }, [selectedStop, highlightStop]);

    // Keep selected stop synchronized with active route/time filters
    useEffect(() => {
        if (!selectedStop) return;
        const nextSelected = filteredStops.find(s => s.stopId === selectedStop.stopId);
        if (!nextSelected) {
            setSelectedStop(null);
            clearHighlight();
            return;
        }
        if (nextSelected !== selectedStop) {
            setSelectedStop(nextSelected);
        }
    }, [filteredStops, selectedStop, clearHighlight]);

    // ─── Computed for detail panel ──────────────────────────────────────

    const selectedRank = selectedStop
        ? rankedStops.findIndex(s => s.stopId === selectedStop.stopId) + 1
        : 0;

    // ─── Render ─────────────────────────────────────────────────────────

    return (
        <div
            ref={wrapperRef}
            className={isFullscreen
                ? 'fixed inset-0 z-50 bg-white flex flex-col'
                : 'relative'
            }
        >
            {/* ─── Control Bar ─── */}
            <div className="absolute top-2 left-12 right-2 z-[1000] flex flex-wrap items-center gap-2 pointer-events-none">
                {/* Search */}
                <div className="relative pointer-events-auto">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                        placeholder="Search stops..."
                        className="w-48 px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400"
                    />
                    {searchFocused && searchResults.length > 0 && (
                        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {searchResults.map(s => (
                                <button
                                    key={s.stopId}
                                    onMouseDown={() => flyToStop(s)}
                                    onMouseEnter={() => highlightStop(s)}
                                    onMouseLeave={clearHighlight}
                                    className="w-full text-left px-3 py-1.5 hover:bg-cyan-50 border-b border-gray-50 last:border-b-0"
                                >
                                    <span className="text-xs font-medium text-gray-800">{s.stopName}</span>
                                    <span className="text-[10px] text-gray-400 ml-1.5">#{s.stopId}</span>
                                    <span className="text-[10px] text-gray-400 float-right">{s.activity.toLocaleString()}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* View Mode */}
                <div className="flex bg-white rounded-md border border-gray-300 shadow-sm overflow-hidden pointer-events-auto">
                    {(['total', 'boardings', 'alightings'] as ViewMode[]).map(m => (
                        <button
                            key={m}
                            onClick={() => setViewMode(m)}
                            className={`px-2.5 py-1.5 text-[10px] font-bold uppercase transition-colors ${
                                viewMode === m
                                    ? 'bg-cyan-50 text-cyan-700'
                                    : 'text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            {m === 'total' ? 'Total' : m === 'boardings' ? 'Board' : 'Alight'}
                        </button>
                    ))}
                </div>

                {/* Route Filter */}
                {hasRoutes && (
                    <select
                        value={selectedRoute}
                        onChange={e => setSelectedRoute(e.target.value)}
                        className="px-2 py-1.5 text-xs bg-white border border-gray-300 rounded-md shadow-sm pointer-events-auto focus:outline-none focus:ring-1 focus:ring-cyan-400"
                    >
                        <option value="all">All Routes</option>
                        {availableRoutes.map(r => (
                            <option key={r} value={r}>Route {r}</option>
                        ))}
                    </select>
                )}

                {/* Route Lines Toggle */}
                <button
                    onClick={() => setShowRouteLines(p => !p)}
                    className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md border shadow-sm transition-colors pointer-events-auto ${
                        showRouteLines
                            ? 'bg-cyan-50 text-cyan-700 border-cyan-300'
                            : 'bg-white text-gray-400 border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    Routes
                </button>

                {/* Lasso Select */}
                <button
                    onClick={toggleLassoMode}
                    className={`px-2.5 py-1.5 text-[10px] font-bold rounded-md border shadow-sm transition-colors pointer-events-auto flex items-center gap-1 ${
                        lassoMode
                            ? 'bg-amber-50 text-amber-700 border-amber-300'
                            : 'bg-white text-gray-400 border-gray-300 hover:bg-gray-50'
                    }`}
                    title={lassoMode ? 'Exit lasso mode (Esc)' : 'Draw to select stops'}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2">
                        <circle cx="12" cy="12" r="9" />
                    </svg>
                    Lasso
                </button>

                {/* Spacer */}
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

            {/* ─── Time of Day ─── */}
            {hasHourlyData && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 px-3 py-2 pointer-events-auto" style={{ minWidth: 420 }}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Time of Day</span>
                        <div className="flex-1" />
                        {/* Preset pills */}
                        <button
                            onClick={() => { setActiveHours(null); setActivePreset(null); setIsPlaying(false); }}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                                activeHours === null ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:text-gray-600'
                            }`}
                        >
                            All Day
                        </button>
                        {HOUR_PRESETS.map(p => (
                            <button
                                key={p.label}
                                onClick={() => {
                                    setActiveHours(p.hours);
                                    setActivePreset(p.label);
                                    setIsPlaying(false);
                                }}
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                                    activePreset === p.label ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:text-gray-600'
                                }`}
                                title={p.detail}
                            >
                                {p.label}
                                <span className="text-[8px] font-normal ml-0.5 opacity-60">{p.detail}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                if (isPlaying) { setIsPlaying(false); }
                                else { playHourRef.current = 4; setActivePreset(null); setIsPlaying(true); }
                            }}
                            className="w-6 h-6 flex items-center justify-center rounded-full bg-cyan-100 text-cyan-700 hover:bg-cyan-200 flex-shrink-0"
                            title={isPlaying ? 'Pause' : 'Animate through hours'}
                        >
                            {isPlaying ? (
                                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="3" height="8" fill="currentColor"/><rect x="6" y="1" width="3" height="8" fill="currentColor"/></svg>
                            ) : (
                                <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="2,0 10,5 2,10" fill="currentColor"/></svg>
                            )}
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={23}
                            value={activeHours?.length === 1 ? activeHours[0] : 12}
                            onChange={e => {
                                const h = parseInt(e.target.value, 10);
                                setActiveHours([h]);
                                setActivePreset(null);
                                setIsPlaying(false);
                            }}
                            className="flex-1 h-1 accent-cyan-500"
                        />
                        <span className="text-xs font-bold text-gray-700 w-16 text-right tabular-nums">
                            {activeHours === null
                                ? 'All'
                                : activeHours.length === 1
                                    ? `${activeHours[0].toString().padStart(2, '0')}:00`
                                    : activePreset || `${activeHours[0]}–${activeHours[activeHours.length - 1]}h`
                            }
                        </span>
                    </div>
                </div>
            )}

            {/* ─── Legend ─── */}
            <Legend />

            {/* ─── Detail / Lasso Panel ─── */}
            {lassoSelection ? (
                <LassoSummaryPanel
                    selected={lassoSelection}
                    onClose={clearLassoSelection}
                />
            ) : selectedStop ? (
                <DetailPanel
                    stop={selectedStop}
                    rank={selectedRank}
                    total={filteredStops.length}
                    activeHours={activeHours}
                    onClose={() => { setSelectedStop(null); clearHighlight(); }}
                />
            ) : null}

            {/* ─── Map Container ─── */}
            <div
                ref={containerRef}
                className={isFullscreen ? 'flex-1 w-full min-h-0' : 'h-[750px] w-full rounded-lg'}
            />
        </div>
    );
};
