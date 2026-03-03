import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
    ArrowUpDown,
    Map as MapIcon,
    Table,
    Repeat,
    Train,
    GitBranch,
    Target,
} from 'lucide-react';
import type {
    TransitAppDataSummary,
    TransferPattern,
    TransferPairSummary,
    TransferPriorityTier,
    TransferTripAnchor,
    TransferTimeBand,
} from '../../utils/transit-app/transitAppTypes';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';
import { NoData, fmt, formatTimeBand } from './AnalyticsShared';

interface TransfersModuleProps {
    data: TransitAppDataSummary;
}

type SortField = 'count' | 'avgWaitMinutes';
type ViewMode = 'table' | 'map';
type MapLimit = 10 | 20 | 'all';
type TimeBandFilter = 'all' | TransferTimeBand;


function formatPriority(priority: TransferPriorityTier): string {
    switch (priority) {
        case 'high': return 'High';
        case 'medium': return 'Medium';
        case 'low': return 'Low';
        default: return priority;
    }
}

function priorityBadgeClass(priority: TransferPriorityTier): string {
    switch (priority) {
        case 'high': return 'bg-red-500 text-white';
        case 'medium': return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200';
        case 'low': return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';
        default: return 'bg-slate-100 text-slate-500';
    }
}

function waitTimeClass(minutes: number): string {
    if (minutes > 10) return 'text-red-600 font-semibold';
    if (minutes >= 5) return 'text-amber-600';
    return 'text-emerald-600';
}

function formatTripAnchors(anchors?: TransferTripAnchor[]): string {
    if (!anchors || anchors.length === 0) return 'N/A';
    return anchors
        .slice(0, 2)
        .map(anchor => `${anchor.timeLabel} (${anchor.sharePct}%)`)
        .join(', ');
}

type ScopeFilter = 'all' | 'barrie' | 'regional';

/** Barrie Transit routes are local numbered routes + letter suffixes. GO = "BR" or 60–69 range. */
function isBarrieRoute(route: string): boolean {
    const upper = route.trim().toUpperCase();
    if (upper === 'BR') return false;
    const num = parseInt(upper, 10);
    if (!isNaN(num) && num >= 60 && num <= 69) return false;
    return true;
}

function looksBarrieStopName(stopName: string): boolean {
    const upper = stopName.trim().toUpperCase();
    if (!upper) return false;
    return upper.includes('BARRIE') || upper.includes('ALLANDALE');
}

function isBarrieTransferStop(
    transferStopId: string | null | undefined,
    transferStopName: string | null | undefined,
    fromStop: string | null | undefined,
    toStop: string | null | undefined,
    fromRoute: string | null | undefined,
    toRoute: string | null | undefined
): boolean {
    if (transferStopId) return true;
    const routeSuggestsBarrie = isBarrieRoute(fromRoute || '') && isBarrieRoute(toRoute || '');

    const stopHints = [transferStopName, fromStop, toStop]
        .filter((value): value is string => Boolean(value && value.trim().length > 0));

    if (stopHints.length > 0) {
        return stopHints.some(looksBarrieStopName) || routeSuggestsBarrie;
    }

    // Backward-compatibility fallback for older saved rows with no stop metadata.
    return routeSuggestsBarrie;
}

function matchesScope(isBarrieStop: boolean, scope: ScopeFilter): boolean {
    if (scope === 'all') return true;
    if (scope === 'barrie') return isBarrieStop;
    return !isBarrieStop;
}

// ── Transfer Map Sub-Component ──────────────────────────────────────────────

const BARRIE_CENTER: [number, number] = [44.39, -79.69];

interface GeocodedTransferPair extends TransferPairSummary {
    lat: number;
    lon: number;
}

/** Bright arc colors optimized for dark map theme */
function arcColor(rank: number): string {
    if (rank === 0) return '#ff4d4f'; // bright red — #1
    if (rank === 1) return '#ff7a45'; // bright orange — #2
    if (rank === 2) return '#ffc53d'; // bright amber — #3
    if (rank < 6) return '#36cfc9';   // bright cyan — #4-6
    return '#8c8c8c';                 // neutral — rest
}

/** Build dark-themed popup HTML for a transfer pair */
function buildDarkPopup(gp: GeocodedTransferPair, color: string): string {
    const typeLabel = gp.transferType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const isGo = gp.transferType.includes('go');
    const goTag = isGo
        ? '<span style="display:inline-flex;padding:1px 5px;border-radius:4px;background:#4f46e520;color:#818cf8;font-size:9px;font-weight:600;letter-spacing:0.5px">GO</span>'
        : '';
    return `
        <div style="font-size:13px;min-width:220px;font-family:system-ui">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
                <span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:6px;background:${color}22;color:${color};font-weight:700;font-size:13px">${gp.fromRoute}</span>
                <span style="color:#64748b;font-size:11px">\u2192</span>
                <span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:6px;background:${color}22;color:${color};font-weight:700;font-size:13px">${gp.toRoute}</span>
                ${goTag}
            </div>
            <div style="color:#94a3b8;margin-bottom:10px;font-size:11px">${gp.transferStopName}</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px">
                <span style="color:#64748b">Volume</span><span style="text-align:right;font-weight:700;color:#f1f5f9">${gp.totalCount.toLocaleString()}</span>
                <span style="color:#64748b">Avg Wait</span><span style="text-align:right;color:#f1f5f9">${gp.avgWaitMinutes} min</span>
                <span style="color:#64748b">Type</span><span style="text-align:right;color:#cbd5e1">${typeLabel}</span>
                <span style="color:#64748b">Peak Bands</span><span style="text-align:right;color:#cbd5e1">${gp.dominantTimeBands.map(formatTimeBand).join(', ') || 'N/A'}</span>
                <span style="color:#64748b">Arrivals</span><span style="text-align:right;font-size:11px;color:#94a3b8">${formatTripAnchorsHtml(gp.fromTripAnchors)}</span>
                <span style="color:#64748b">Departures</span><span style="text-align:right;font-size:11px;color:#94a3b8">${formatTripAnchorsHtml(gp.toTripAnchors)}</span>
            </div>
        </div>
    `;
}

/** CSS for hub glow and dark popups */
const MAP_STYLES = `
@keyframes hub-ring {
    0% { transform: scale(0.8); opacity: 0.6; }
    100% { transform: scale(2.2); opacity: 0; }
}
.transfer-hub { background: none !important; border: none !important; }
.hub-glow {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
}
.hub-glow .core {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 0 8px 3px var(--c);
    z-index: 1;
}
.hub-glow .ring {
    position: absolute; inset: -2px;
    border-radius: 50%;
    border: 1.5px solid var(--c);
    animation: hub-ring 2.5s ease-out infinite;
}
.hub-glow.dim .core { opacity: 0.15; box-shadow: none; }
.hub-glow.dim .ring { animation: none; opacity: 0; }
.dark-popup .leaflet-popup-content-wrapper {
    background: rgba(15, 23, 42, 0.95);
    color: #e2e8f0;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.15);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.dark-popup .leaflet-popup-tip { background: rgba(15, 23, 42, 0.95); }
.dark-popup .leaflet-popup-close-button { color: #64748b; }
.dark-popup .leaflet-popup-close-button:hover { color: #e2e8f0; }
`;

const TIME_BAND_OPTIONS: { key: TimeBandFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'am_peak', label: 'AM' },
    { key: 'midday', label: 'Mid' },
    { key: 'pm_peak', label: 'PM' },
    { key: 'evening', label: 'Eve' },
];

interface TransferMapProps {
    pairs: TransferPairSummary[];
    timeBandFilter: TimeBandFilter;
    isolatedStop: string | null;
    onIsolateStop: (stop: string | null) => void;
    showRoutes: boolean;
}

const TransferMap: React.FC<TransferMapProps> = ({
    pairs, timeBandFilter, isolatedStop, onIsolateStop, showRoutes,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerLayerRef = useRef<L.LayerGroup | null>(null);
    const routeLayerRef = useRef<L.LayerGroup | null>(null);
    const hasFittedRef = useRef(false);

    // Inject CSS for arc animations, hub glow, and dark popups
    useEffect(() => {
        const id = 'transfer-map-styles';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = MAP_STYLES;
        document.head.appendChild(el);
        return () => { document.getElementById(id)?.remove(); };
    }, []);

    // Build stop name → coords lookup once
    const stopCoordMap = useMemo(() => {
        const allStops = getAllStopsWithCoords();
        const map = new Map<string, { lat: number; lon: number }>();
        for (const s of allStops) {
            const key = s.stop_name.toLowerCase().trim();
            if (!map.has(key)) {
                map.set(key, { lat: s.lat, lon: s.lon });
            }
        }
        return map;
    }, []);

    // Filter by time band, then geocode
    const geoPairs = useMemo((): GeocodedTransferPair[] => {
        const results: GeocodedTransferPair[] = [];
        for (const pair of pairs) {
            if (timeBandFilter !== 'all') {
                if (!pair.dominantTimeBands.includes(timeBandFilter)) continue;
            }
            if (!pair.transferStopName) continue;
            const coords = stopCoordMap.get(pair.transferStopName.toLowerCase().trim());
            if (coords) {
                results.push({ ...pair, lat: coords.lat, lon: coords.lon });
            }
        }
        return results;
    }, [pairs, stopCoordMap, timeBandFilter]);

    // Build GTFS route layer (dimmer for dark basemap)
    const buildRouteLayer = useCallback(() => {
        const group = L.layerGroup();
        try {
            const shapes = loadGtfsRouteShapes();
            for (const shape of shapes) {
                const color = `#${shape.routeColor}`;
                L.polyline(shape.points, {
                    color,
                    weight: 3,
                    opacity: 0.4,
                    dashArray: '6 4',
                    lineCap: 'round',
                })
                    .bindTooltip(`Route ${shape.routeShortName}`, { direction: 'top', sticky: true })
                    .addTo(group);
            }
        } catch {
            // GTFS shapes not available
        }
        return group;
    }, []);

    // Initialize map with dark basemap
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, {
            center: BARRIE_CENTER,
            zoom: 13,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            scrollWheelZoom: 'center',
            wheelPxPerZoomLevel: 120,
        });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
        }).addTo(map);
        markerLayerRef.current = L.layerGroup().addTo(map);
        routeLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        map.on('click', () => onIsolateStop(null));

        return () => {
            map.remove();
            mapRef.current = null;
            markerLayerRef.current = null;
            routeLayerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Toggle GTFS route overlay
    useEffect(() => {
        const rl = routeLayerRef.current;
        if (!rl) return;
        rl.clearLayers();
        if (showRoutes) {
            const routeGroup = buildRouteLayer();
            routeGroup.eachLayer(layer => layer.addTo(rl));
        }
    }, [showRoutes, buildRouteLayer]);

    // Render circle markers + hub glow
    useEffect(() => {
        const layer = markerLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (geoPairs.length === 0) return;

        // Rank pairs by volume
        const ranked = [...geoPairs].sort((a, b) => b.totalCount - a.totalCount);
        const rankMap = new Map<GeocodedTransferPair, number>();
        ranked.forEach((gp, i) => rankMap.set(gp, i));

        // Group by location to handle overlapping stops
        const byLocation = new Map<string, GeocodedTransferPair[]>();
        for (const gp of geoPairs) {
            const locKey = `${gp.lat.toFixed(5)},${gp.lon.toFixed(5)}`;
            const arr = byLocation.get(locKey);
            if (arr) arr.push(gp); else byLocation.set(locKey, [gp]);
        }

        const maxCount = Math.max(...geoPairs.map(p => p.totalCount), 1);

        // Sort groups ascending so highest-volume group renders on top
        const sortedGroups = Array.from(byLocation.entries())
            .sort((a, b) => {
                const sumA = a[1].reduce((s, p) => s + p.totalCount, 0);
                const sumB = b[1].reduce((s, p) => s + p.totalCount, 0);
                return sumA - sumB;
            });

        for (const [, groupPairs] of sortedGroups) {
            const sorted = [...groupPairs].sort((a, b) => a.totalCount - b.totalCount);
            const angleStep = sorted.length > 1 ? (2 * Math.PI) / sorted.length : 0;
            const offsetDistance = sorted.length > 1 ? 0.0003 : 0;

            for (let i = 0; i < sorted.length; i++) {
                const gp = sorted[i];
                const rank = rankMap.get(gp) ?? geoPairs.length;
                const stopKey = gp.transferStopName?.toLowerCase().trim() ?? '';
                const isActive = isolatedStop === null || isolatedStop === stopKey;
                const color = arcColor(rank);
                const isGo = gp.transferType.includes('go');

                const angle = angleStep * i;
                const lat = gp.lat + offsetDistance * Math.sin(angle);
                const lon = gp.lon + offsetDistance * Math.cos(angle);

                const logScale = Math.log(gp.totalCount + 1) / Math.log(maxCount + 1);
                const radius = 8 + logScale * 18;

                const circle = L.circleMarker([lat, lon], {
                    radius,
                    fillColor: color,
                    fillOpacity: isActive ? 0.7 : 0.1,
                    color: isGo ? '#818cf8' : 'rgba(255,255,255,0.25)',
                    weight: isGo ? 2.5 : 1.5,
                    opacity: isActive ? 1 : 0.15,
                });

                circle.bindTooltip(
                    `Route ${gp.fromRoute} \u2192 Route ${gp.toRoute} at ${gp.transferStopName}`,
                    { direction: 'top', offset: [0, -radius], className: 'dark-popup' }
                );

                circle.bindPopup(buildDarkPopup(gp, color), { maxWidth: 280, className: 'dark-popup' });

                circle.on('click', (e: L.LeafletMouseEvent) => {
                    L.DomEvent.stopPropagation(e);
                    onIsolateStop(isolatedStop === stopKey ? null : stopKey);
                });

                circle.addTo(layer);
            }

            // Hub glow at center of each location group
            const rep = sorted[sorted.length - 1];
            const repRank = rankMap.get(rep) ?? geoPairs.length;
            const hubColor = arcColor(repRank);
            const stopKey = rep.transferStopName?.toLowerCase().trim() ?? '';
            const hubActive = isolatedStop === null || isolatedStop === stopKey;

            const hub = L.marker([rep.lat, rep.lon], {
                icon: L.divIcon({
                    className: 'transfer-hub',
                    html: `<div class="hub-glow ${hubActive ? '' : 'dim'}" style="--c:${hubColor}"><div class="core"></div><div class="ring"></div></div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                }),
                interactive: true,
            });

            hub.bindTooltip(rep.transferStopName || '', { direction: 'top', offset: [0, -14] });
            hub.on('click', (e: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e);
                onIsolateStop(isolatedStop === stopKey ? null : stopKey);
            });

            hub.addTo(layer);
        }

        // Fit bounds only on first render with data
        if (geoPairs.length > 0 && !hasFittedRef.current) {
            const bounds = L.latLngBounds(geoPairs.map(gp => [gp.lat, gp.lon] as [number, number]));
            mapRef.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
            hasFittedRef.current = true;
        }
    }, [geoPairs, isolatedStop, onIsolateStop]);

    const unmatchedCount = pairs.filter(p => {
        if (!p.transferStopName) return true;
        return !stopCoordMap.has(p.transferStopName.toLowerCase().trim());
    }).length;

    return (
        <div className="relative">
            <div ref={containerRef} style={{ height: 550 }} className="rounded-b-xl" />

            {geoPairs.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 rounded-b-xl">
                    <p className="text-slate-400 text-sm">No transfer stops matched for this filter combination</p>
                </div>
            )}

            {/* Floating legend — dark frosted glass */}
            <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/80 backdrop-blur-md border border-slate-700/40 rounded-lg px-3.5 py-2.5 shadow-2xl">
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-300">
                        <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff4d4f' }} /> #1
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff7a45' }} /> #2
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ffc53d' }} /> #3
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#36cfc9' }} /> #4–6
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#8c8c8c' }} /> Rest
                        </span>
                        <span className="text-slate-600">|</span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full border-[2px]" style={{ borderColor: 'rgba(255,255,255,0.25)', background: '#64748b' }} /> Local
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full border-[2px]" style={{ borderColor: '#818cf8', background: '#64748b' }} /> GO
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        <span>Size = volume (log)</span>
                        <span className="text-slate-600">|</span>
                        <span>Click marker to isolate</span>
                    </div>
                </div>
            </div>

            {/* Unmatched count badge — dark theme */}
            {unmatchedCount > 0 && geoPairs.length > 0 && (
                <div className="absolute top-3 right-3 z-[1000] bg-amber-950/80 backdrop-blur-sm border border-amber-700/40 rounded-lg px-2.5 py-1.5 shadow-lg">
                    <p className="text-[10px] text-amber-300 font-medium">
                        {unmatchedCount} pair{unmatchedCount > 1 ? 's' : ''} not shown (no coords)
                    </p>
                </div>
            )}
        </div>
    );
};

function formatTripAnchorsHtml(anchors?: TransferTripAnchor[]): string {
    if (!anchors || anchors.length === 0) return 'N/A';
    return anchors.slice(0, 2).map(a => `${a.timeLabel} (${a.sharePct}%)`).join(', ');
}

// ── Segmented Button Group ──────────────────────────────────────────────────

const SegBtn: React.FC<{
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150 ${
            active
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
        }`}
    >
        {children}
    </button>
);

// ── Section Card ────────────────────────────────────────────────────────────

const SectionCard: React.FC<{
    title: string;
    subtitle: string;
    accentColor?: string;
    headerExtra?: React.ReactNode;
    noPadding?: boolean;
    children: React.ReactNode;
}> = ({ title, subtitle, accentColor, headerExtra, noPadding, children }) => (
    <div
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
        style={accentColor ? { borderTopWidth: 3, borderTopColor: accentColor } : undefined}
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
                <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">{title}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
            </div>
            {headerExtra}
        </div>
        <div className={noPadding ? '' : 'p-5'}>
            {children}
        </div>
    </div>
);

// ── Main Module ─────────────────────────────────────────────────────────────

export const TransfersModule: React.FC<TransfersModuleProps> = ({ data }) => {
    const [sortBy, setSortBy] = useState<SortField>('count');
    const [groupByRoute, setGroupByRoute] = useState(false);
    const [scope, setScope] = useState<ScopeFilter>('barrie');
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [mapLimit, setMapLimit] = useState<MapLimit>(10);
    const [timeBandFilter, setTimeBandFilter] = useState<TimeBandFilter>('all');
    const [isolatedStop, setIsolatedStop] = useState<string | null>(null);
    const [showRoutes, setShowRoutes] = useState(false);
    const { transferPatterns, transferAnalysis } = data;

    const sortedPatterns = useMemo(() => {
        return [...transferPatterns]
            .filter(tp => matchesScope(isBarrieTransferStop(
                tp.transferStopId,
                tp.transferStopName,
                tp.fromStop,
                tp.toStop,
                tp.fromRoute,
                tp.toRoute
            ), scope))
            .sort((a, b) => {
                if (sortBy === 'count') return b.count - a.count;
                return a.avgWaitMinutes - b.avgWaitMinutes;
            });
    }, [transferPatterns, sortBy, scope]);

    const groupedPatterns = useMemo(() => {
        if (!groupByRoute) return null;
        const groups = new Map<string, TransferPattern[]>();
        for (const tp of sortedPatterns) {
            const key = `${tp.fromRoute} → ${tp.toRoute}`;
            const existing = groups.get(key);
            if (existing) {
                existing.push(tp);
            } else {
                groups.set(key, [tp]);
            }
        }
        return Array.from(groups.entries())
            .map(([routePair, patterns]) => ({
                routePair,
                totalCount: patterns.reduce((sum, p) => sum + p.count, 0),
                avgWait: patterns.reduce((sum, p) => sum + p.avgWaitMinutes * p.count, 0)
                    / patterns.reduce((sum, p) => sum + p.count, 0),
                patterns,
            }))
            .sort((a, b) => b.totalCount - a.totalCount);
    }, [sortedPatterns, groupByRoute]);

    const filteredTopPairs = useMemo(() => {
        if (!transferAnalysis) return [];
        return transferAnalysis.topTransferPairs.filter(row =>
            matchesScope(isBarrieTransferStop(
                row.transferStopId,
                row.transferStopName,
                null,
                null,
                row.fromRoute,
                row.toRoute
            ), scope)
        );
    }, [transferAnalysis, scope]);

    const maxTopPairVolume = useMemo(() => {
        return Math.max(...filteredTopPairs.map(p => p.totalCount), 1);
    }, [filteredTopPairs]);

    const filteredGoLinked = useMemo(() => {
        if (!transferAnalysis) return [];
        return transferAnalysis.goLinkedSummary.filter(row =>
            matchesScope(isBarrieTransferStop(
                row.transferStopId,
                row.transferStopName,
                null,
                null,
                row.fromRoute,
                row.toRoute
            ), scope)
        );
    }, [transferAnalysis, scope]);

    const filteredConnectionTargets = useMemo(() => {
        if (!transferAnalysis) return [];
        return transferAnalysis.connectionTargets.filter(row =>
            matchesScope(isBarrieTransferStop(
                row.locationStopId,
                row.locationStopName,
                null,
                null,
                row.fromRoute,
                row.toRoute
            ), scope)
        );
    }, [transferAnalysis, scope]);

    const mapPairs = useMemo(() => {
        if (mapLimit === 'all') return filteredTopPairs;
        return filteredTopPairs.slice(0, mapLimit);
    }, [filteredTopPairs, mapLimit]);

    return (
        <div className="space-y-6">
            {transferAnalysis && (
                <>
                    {/* ── KPI Strip ──────────────────────────────────────────── */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-cyan-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600 shrink-0">
                                    <Repeat size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {fmt(transferAnalysis.totals.transferEvents)}
                                    </p>
                                    <p className="text-sm text-slate-500">Transfer Events</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-indigo-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                                    <Train size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {fmt(transferAnalysis.totals.goLinkedTransferEvents)}
                                    </p>
                                    <p className="text-sm text-slate-500">GO-Linked Events</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-emerald-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                                    <GitBranch size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {fmt(transferAnalysis.totals.uniqueRoutePairs)}
                                    </p>
                                    <p className="text-sm text-slate-500">Unique Route Pairs</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-amber-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                                    <Target size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {`${Math.round(transferAnalysis.normalization.routeMatchRate * 100)}%`}
                                    </p>
                                    <p className="text-sm text-slate-500">Route Match Rate</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Unified Control Toolbar ─────────────────────────── */}
                    <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Scope</span>
                            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                <SegBtn active={scope === 'barrie'} onClick={() => setScope('barrie')}>Barrie</SegBtn>
                                <SegBtn active={scope === 'regional'} onClick={() => setScope('regional')}>Regional</SegBtn>
                                <SegBtn active={scope === 'all'} onClick={() => setScope('all')}>All</SegBtn>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                            {/* Map-specific controls */}
                            {viewMode === 'map' && (
                                <>
                                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                        {([10, 20, 'all'] as const).map(limit => (
                                            <SegBtn
                                                key={String(limit)}
                                                active={mapLimit === limit}
                                                onClick={() => setMapLimit(limit)}
                                            >
                                                {limit === 'all' ? 'All' : `Top ${limit}`}
                                            </SegBtn>
                                        ))}
                                    </div>
                                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                        {TIME_BAND_OPTIONS.map(({ key, label }) => (
                                            <SegBtn
                                                key={key}
                                                active={timeBandFilter === key}
                                                onClick={() => setTimeBandFilter(key)}
                                            >
                                                {label}
                                            </SegBtn>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => setShowRoutes(v => !v)}
                                        className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-150 ${
                                            showRoutes
                                                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                        }`}
                                    >
                                        Routes
                                    </button>
                                    {isolatedStop && (
                                        <span className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1">
                                            <span className="font-semibold truncate max-w-[120px]">{isolatedStop}</span>
                                            <button
                                                onClick={() => setIsolatedStop(null)}
                                                className="text-slate-400 hover:text-slate-700 transition-colors"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    )}
                                </>
                            )}

                            {/* View toggle */}
                            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                <SegBtn active={viewMode === 'table'} onClick={() => setViewMode('table')}>
                                    <span className="flex items-center gap-1"><Table size={12} /> Table</span>
                                </SegBtn>
                                <SegBtn active={viewMode === 'map'} onClick={() => setViewMode('map')}>
                                    <span className="flex items-center gap-1"><MapIcon size={12} /> Map</span>
                                </SegBtn>
                            </div>
                        </div>
                    </div>

                    {/* ── Top Transfer Pairs — Hero Section ───────────────── */}
                    <SectionCard
                        title="Top Transfer Pairs"
                        subtitle={viewMode === 'map'
                            ? `Showing ${mapLimit === 'all' ? mapPairs.length : mapLimit} pairs on map`
                            : `${filteredTopPairs.length} pairs ranked by transfer volume`
                        }
                        noPadding
                    >
                        {viewMode === 'map' ? (
                            <TransferMap
                                pairs={mapPairs}
                                timeBandFilter={timeBandFilter}
                                isolatedStop={isolatedStop}
                                onIsolateStop={setIsolatedStop}
                                showRoutes={showRoutes}
                            />
                        ) : filteredTopPairs.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50/80">
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Transfer Stop</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arrival / Departure Times</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Peak Bands</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Volume</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Avg Wait</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTopPairs.map((row, i) => (
                                            <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                <td className="py-2.5 px-4">
                                                    <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-slate-100 text-xs font-bold text-slate-700">
                                                        {row.fromRoute}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-slate-100 text-xs font-bold text-slate-700">
                                                        {row.toRoute}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4 text-slate-600 text-xs">{row.transferStopName || 'Unknown'}</td>
                                                <td className="py-2.5 px-4">
                                                    <div className="text-xs text-slate-500 space-y-0.5">
                                                        <div><span className="text-slate-400 w-8 inline-block">Arr</span> {formatTripAnchors(row.fromTripAnchors)}</div>
                                                        <div><span className="text-slate-400 w-8 inline-block">Dep</span> {formatTripAnchors(row.toTripAnchors)}</div>
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {row.dominantTimeBands.length > 0
                                                            ? row.dominantTimeBands.map(band => (
                                                                <span key={band} className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600">
                                                                    {formatTimeBand(band)}
                                                                </span>
                                                            ))
                                                            : <span className="text-xs text-slate-300">N/A</span>
                                                        }
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-cyan-500 rounded-full transition-all"
                                                                style={{ width: `${Math.min(100, (row.totalCount / maxTopPairVolume) * 100)}%` }}
                                                            />
                                                        </div>
                                                        <span className="font-bold text-slate-900 tabular-nums text-xs">{fmt(row.totalCount)}</span>
                                                    </div>
                                                </td>
                                                <td className={`py-2.5 px-4 text-right tabular-nums text-xs ${waitTimeClass(row.avgWaitMinutes)}`}>
                                                    {row.avgWaitMinutes} min
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="p-5">
                                <NoData />
                            </div>
                        )}
                    </SectionCard>

                    {/* ── GO-Linked + Connection Targets ──────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <SectionCard
                            title="GO-Linked Transfers"
                            subtitle="Volumes by route pair and time band"
                            accentColor="#6366f1"
                        >
                            {filteredGoLinked.length > 0 ? (
                                <div className="overflow-x-auto -mx-5 -mb-5">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50/80">
                                                <th className="text-left py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Band</th>
                                                <th className="text-right py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Count</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredGoLinked.slice(0, 15).map((row, i) => (
                                                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                    <td className="py-2 px-5">
                                                        <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-indigo-50 text-[10px] font-bold text-indigo-700">
                                                            {row.fromRoute}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-4">
                                                        <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-indigo-50 text-[10px] font-bold text-indigo-700">
                                                            {row.toRoute}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-4">
                                                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600">
                                                            {formatTimeBand(row.timeBand)}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-5 text-right font-bold text-slate-900 tabular-nums text-xs">{fmt(row.totalCount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <NoData />
                            )}
                        </SectionCard>

                        <SectionCard
                            title="Connection Targets"
                            subtitle="Import-ready candidates for Scheduler 4"
                            accentColor="#10b981"
                        >
                            {filteredConnectionTargets.length > 0 ? (
                                <div className="overflow-x-auto -mx-5 -mb-5">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50/80">
                                                <th className="text-left py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Pair</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Stop ID</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arr / Dep Times</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Bands</th>
                                                <th className="text-right py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Tier</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredConnectionTargets.slice(0, 15).map((row, i) => (
                                                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                    <td className="py-2 px-5">
                                                        <div className="font-semibold text-slate-800 text-xs">{row.fromRoute} → {row.toRoute}</div>
                                                        <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{row.locationStopName || 'Unknown stop'}</div>
                                                    </td>
                                                    <td className="py-2 px-4 text-xs text-slate-500 font-mono">{row.locationStopId || '—'}</td>
                                                    <td className="py-2 px-4">
                                                        <div className="text-[10px] text-slate-500 space-y-0.5">
                                                            <div><span className="text-slate-400">Arr</span> {formatTripAnchors(row.fromTripAnchors)}</div>
                                                            <div><span className="text-slate-400">Dep</span> {formatTripAnchors(row.toTripAnchors)}</div>
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-4">
                                                        <div className="flex flex-wrap gap-0.5">
                                                            {row.timeBands.map(band => (
                                                                <span key={band} className="inline-block px-1 py-0.5 text-[9px] font-medium rounded bg-slate-100 text-slate-500">
                                                                    {formatTimeBand(band)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-5 text-right">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${priorityBadgeClass(row.priorityTier)}`}>
                                                            {formatPriority(row.priorityTier)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <NoData />
                            )}
                        </SectionCard>
                    </div>
                </>
            )}

            {/* ── Transfer Patterns Detail ────────────────────────────── */}
            {groupByRoute && groupedPatterns ? (
                <div className="space-y-4">
                    {groupedPatterns.map(group => (
                        <SectionCard
                            key={group.routePair}
                            title={group.routePair}
                            subtitle={`${fmt(group.totalCount)} transfers · avg ${group.avgWait.toFixed(1)} min wait`}
                            headerExtra={
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={groupByRoute}
                                            onChange={e => setGroupByRoute(e.target.checked)}
                                            className="accent-slate-900 w-3.5 h-3.5"
                                        />
                                        Grouped
                                    </label>
                                </div>
                            }
                            noPadding
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50/80">
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From Stop</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To Stop</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arrival Times</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Departure Times</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Count</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Avg Wait</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Range</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.patterns.map((tp, i) => (
                                            <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                <td className="py-2 px-4 text-slate-600 text-xs truncate max-w-[180px]">{tp.fromStop}</td>
                                                <td className="py-2 px-4 text-slate-600 text-xs truncate max-w-[180px]">{tp.toStop}</td>
                                                <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.fromTripAnchors)}</td>
                                                <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.toTripAnchors)}</td>
                                                <td className="py-2 px-4 text-right font-bold text-slate-900 tabular-nums text-xs">{tp.count}</td>
                                                <td className={`py-2 px-4 text-right tabular-nums text-xs ${waitTimeClass(tp.avgWaitMinutes)}`}>{tp.avgWaitMinutes} min</td>
                                                <td className="py-2 px-4 text-right text-slate-400 tabular-nums text-[11px]">{tp.minWaitMinutes}–{tp.maxWaitMinutes}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </SectionCard>
                    ))}
                </div>
            ) : (
                <SectionCard
                    title="Transfer Patterns"
                    subtitle={`${fmt(sortedPatterns.length)} route-to-route transfers`}
                    headerExtra={
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={groupByRoute}
                                    onChange={e => setGroupByRoute(e.target.checked)}
                                    className="accent-slate-900 w-3.5 h-3.5"
                                />
                                Group by route
                            </label>
                            <button
                                onClick={() => setSortBy(prev => prev === 'count' ? 'avgWaitMinutes' : 'count')}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all duration-150"
                            >
                                <ArrowUpDown size={12} />
                                {sortBy === 'count' ? 'Count' : 'Wait'}
                            </button>
                        </div>
                    }
                    noPadding
                >
                    {sortedPatterns.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50/80">
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Transfer Stop</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arrival Times</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Departure Times</th>
                                        <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Count</th>
                                        <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Avg Wait</th>
                                        <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Range</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedPatterns.map((tp, i) => (
                                        <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                            <td className="py-2 px-4">
                                                <span className="inline-flex items-center justify-center w-8 h-5 rounded bg-slate-100 text-[10px] font-bold text-slate-700">
                                                    {tp.fromRoute}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4">
                                                <span className="inline-flex items-center justify-center w-8 h-5 rounded bg-slate-100 text-[10px] font-bold text-slate-700">
                                                    {tp.toRoute}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4 text-slate-500 text-xs truncate max-w-[200px]">{tp.fromStop} → {tp.toStop}</td>
                                            <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.fromTripAnchors)}</td>
                                            <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.toTripAnchors)}</td>
                                            <td className="py-2 px-4 text-right font-bold text-slate-900 tabular-nums text-xs">{tp.count}</td>
                                            <td className={`py-2 px-4 text-right tabular-nums text-xs ${waitTimeClass(tp.avgWaitMinutes)}`}>{tp.avgWaitMinutes} min</td>
                                            <td className="py-2 px-4 text-right text-slate-400 tabular-nums text-[11px]">{tp.minWaitMinutes}–{tp.maxWaitMinutes}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-5">
                            <NoData />
                        </div>
                    )}
                </SectionCard>
            )}
        </div>
    );
};
