import React, { useMemo, useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowUpDown, Map as MapIcon, Table } from 'lucide-react';
import type {
    TransitAppDataSummary,
    TransferPattern,
    TransferPairSummary,
    TransferPriorityTier,
    TransferTripAnchor,
    TransferTimeBand,
} from '../../utils/transit-app/transitAppTypes';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { ChartCard, MetricCard, NoData, fmt, formatTimeBand } from './AnalyticsShared';

interface TransfersModuleProps {
    data: TransitAppDataSummary;
}

type SortField = 'count' | 'avgWaitMinutes';
type ViewMode = 'table' | 'map';
type MapLimit = 10 | 20 | 'all';


function formatPriority(priority: TransferPriorityTier): string {
    switch (priority) {
        case 'high': return 'High';
        case 'medium': return 'Medium';
        case 'low': return 'Low';
        default: return priority;
    }
}

function priorityColor(priority: TransferPriorityTier): string {
    switch (priority) {
        case 'high': return 'text-red-700 bg-red-50';
        case 'medium': return 'text-amber-700 bg-amber-50';
        case 'low': return 'text-emerald-700 bg-emerald-50';
        default: return 'text-gray-700 bg-gray-100';
    }
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

function markerColor(rank: number): string {
    if (rank === 0) return '#dc2626'; // red-600
    if (rank === 1) return '#ea580c'; // orange-600
    if (rank === 2) return '#d97706'; // amber-600
    if (rank < 6) return '#0891b2';   // cyan-600
    return '#64748b';                 // slate-500
}

const TransferMap: React.FC<{ pairs: TransferPairSummary[] }> = ({ pairs }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layerRef = useRef<L.LayerGroup | null>(null);

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

    // Geocode pairs
    const geoPairs = useMemo((): GeocodedTransferPair[] => {
        const results: GeocodedTransferPair[] = [];
        for (const pair of pairs) {
            if (!pair.transferStopName) continue;
            const coords = stopCoordMap.get(pair.transferStopName.toLowerCase().trim());
            if (coords) {
                results.push({ ...pair, lat: coords.lat, lon: coords.lon });
            }
        }
        return results;
    }, [pairs, stopCoordMap]);

    // Initialize map once
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, {
            center: BARRIE_CENTER,
            zoom: 13,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            scrollWheelZoom: 'center',
            wheelPxPerZoomLevel: 120,
            preferCanvas: true,
        });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 19,
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            layerRef.current = null;
        };
    }, []);

    // Update markers when geoPairs change
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (geoPairs.length === 0) return;

        // Group by location to handle overlapping stops
        const byLocation = new Map<string, GeocodedTransferPair[]>();
        for (const gp of geoPairs) {
            const locKey = `${gp.lat.toFixed(5)},${gp.lon.toFixed(5)}`;
            const existing = byLocation.get(locKey);
            if (existing) existing.push(gp);
            else byLocation.set(locKey, [gp]);
        }

        const maxCount = Math.max(...geoPairs.map(p => p.totalCount), 1);
        let globalRank = 0;

        // Sort ascending so highest-volume renders on top
        const sortedGroups = Array.from(byLocation.entries())
            .sort((a, b) => {
                const sumA = a[1].reduce((s, p) => s + p.totalCount, 0);
                const sumB = b[1].reduce((s, p) => s + p.totalCount, 0);
                return sumA - sumB;
            });

        for (const [, groupPairs] of sortedGroups) {
            // Sort within group by volume ascending (highest on top)
            const sorted = [...groupPairs].sort((a, b) => a.totalCount - b.totalCount);
            const angleStep = sorted.length > 1 ? (2 * Math.PI) / sorted.length : 0;
            const offsetDistance = sorted.length > 1 ? 0.0003 : 0;

            for (let i = 0; i < sorted.length; i++) {
                const gp = sorted[i];
                const rank = globalRank++;

                // Angular offset for overlapping stops
                const angle = angleStep * i;
                const lat = gp.lat + offsetDistance * Math.sin(angle);
                const lon = gp.lon + offsetDistance * Math.cos(angle);

                // Log-scale radius: min 6, max 22
                const logScale = Math.log(gp.totalCount + 1) / Math.log(maxCount + 1);
                const radius = 6 + logScale * 16;

                const circle = L.circleMarker([lat, lon], {
                    radius,
                    fillColor: markerColor(rank),
                    fillOpacity: 0.75,
                    color: '#fff',
                    weight: 1.5,
                });

                circle.bindTooltip(
                    `Route ${gp.fromRoute} → Route ${gp.toRoute} at ${gp.transferStopName}`,
                    { direction: 'top', offset: [0, -radius] }
                );

                const popupHtml = `
                    <div style="font-size:13px;min-width:180px">
                        <div style="font-weight:600;margin-bottom:4px">
                            ${gp.fromRoute} → ${gp.toRoute}
                        </div>
                        <div style="color:#666;margin-bottom:6px">${gp.transferStopName}</div>
                        <table style="font-size:12px;width:100%">
                            <tr><td style="color:#888">Volume</td><td style="text-align:right;font-weight:600">${gp.totalCount.toLocaleString()}</td></tr>
                            <tr><td style="color:#888">Avg Wait</td><td style="text-align:right">${gp.avgWaitMinutes} min</td></tr>
                            <tr><td style="color:#888">Peak Bands</td><td style="text-align:right">${gp.dominantTimeBands.map(formatTimeBand).join(', ') || 'N/A'}</td></tr>
                            <tr><td style="color:#888">Arrivals</td><td style="text-align:right;font-size:11px">${formatTripAnchorsHtml(gp.fromTripAnchors)}</td></tr>
                            <tr><td style="color:#888">Departures</td><td style="text-align:right;font-size:11px">${formatTripAnchorsHtml(gp.toTripAnchors)}</td></tr>
                        </table>
                    </div>
                `;
                circle.bindPopup(popupHtml, { maxWidth: 280 });
                circle.addTo(layer);
            }
        }

        // Fit bounds to markers
        if (geoPairs.length > 0) {
            const bounds = L.latLngBounds(geoPairs.map(gp => [gp.lat, gp.lon] as [number, number]));
            mapRef.current?.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        }
    }, [geoPairs]);

    const unmatchedCount = pairs.filter(p => {
        if (!p.transferStopName) return true;
        return !stopCoordMap.has(p.transferStopName.toLowerCase().trim());
    }).length;

    return (
        <div className="relative">
            <div ref={containerRef} style={{ height: 500 }} className="rounded-lg border border-gray-200" />
            {geoPairs.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 rounded-lg">
                    <p className="text-gray-500 text-sm">No transfer stops could be matched to GTFS coordinates</p>
                </div>
            )}
            {unmatchedCount > 0 && geoPairs.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                    {unmatchedCount} pair{unmatchedCount > 1 ? 's' : ''} not shown (no GTFS coordinate match)
                </p>
            )}
        </div>
    );
};

function formatTripAnchorsHtml(anchors?: TransferTripAnchor[]): string {
    if (!anchors || anchors.length === 0) return 'N/A';
    return anchors.slice(0, 2).map(a => `${a.timeLabel} (${a.sharePct}%)`).join(', ');
}

// ── Main Module ─────────────────────────────────────────────────────────────

export const TransfersModule: React.FC<TransfersModuleProps> = ({ data }) => {
    const [sortBy, setSortBy] = useState<SortField>('count');
    const [groupByRoute, setGroupByRoute] = useState(false);
    const [scope, setScope] = useState<ScopeFilter>('barrie');
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [mapLimit, setMapLimit] = useState<MapLimit>(10);
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
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard
                            icon={null}
                            label="Transfer Events"
                            value={fmt(transferAnalysis.totals.transferEvents)}
                            color="cyan"
                        />
                        <MetricCard
                            icon={null}
                            label="GO-Linked Events"
                            value={fmt(transferAnalysis.totals.goLinkedTransferEvents)}
                            color="indigo"
                        />
                        <MetricCard
                            icon={null}
                            label="Unique Route Pairs"
                            value={fmt(transferAnalysis.totals.uniqueRoutePairs)}
                            color="emerald"
                        />
                        <MetricCard
                            icon={null}
                            label="Route Match Rate"
                            value={`${Math.round(transferAnalysis.normalization.routeMatchRate * 100)}%`}
                            color="amber"
                        />
                    </div>

                    <ChartCard
                        title="Top Transfer Pairs"
                        subtitle={viewMode === 'map'
                            ? `Showing ${mapLimit === 'all' ? mapPairs.length : mapLimit} on map`
                            : 'Ranked by planned transfer volume'
                        }
                        headerExtra={
                            <div className="flex items-center gap-2">
                                {viewMode === 'map' && (
                                    <div className="flex rounded-lg border border-gray-200 overflow-hidden mr-2">
                                        {([10, 20, 'all'] as const).map(limit => (
                                            <button
                                                key={String(limit)}
                                                onClick={() => setMapLimit(limit)}
                                                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                                    mapLimit === limit
                                                        ? 'bg-gray-900 text-white'
                                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                                }`}
                                            >
                                                {limit === 'all' ? 'All' : `Top ${limit}`}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                                    <button
                                        onClick={() => setViewMode('table')}
                                        className={`px-2.5 py-1 text-[11px] font-medium transition-colors flex items-center gap-1 ${
                                            viewMode === 'table'
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-white text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >
                                        <Table size={12} /> Table
                                    </button>
                                    <button
                                        onClick={() => setViewMode('map')}
                                        className={`px-2.5 py-1 text-[11px] font-medium transition-colors flex items-center gap-1 ${
                                            viewMode === 'map'
                                                ? 'bg-gray-900 text-white'
                                                : 'bg-white text-gray-500 hover:bg-gray-50'
                                        }`}
                                    >
                                        <MapIcon size={12} /> Map
                                    </button>
                                </div>
                            </div>
                        }
                    >
                        {viewMode === 'map' ? (
                            <TransferMap pairs={mapPairs} />
                        ) : filteredTopPairs.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200">
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">From</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">To</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">Stop</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">Common Arrival/Departure Times</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">Peak Bands</th>
                                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Volume</th>
                                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg Wait</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTopPairs.map((row, i) => (
                                            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                                <td className="py-2 px-3 font-medium">{row.fromRoute}</td>
                                                <td className="py-2 px-3 font-medium">{row.toRoute}</td>
                                                <td className="py-2 px-3 text-gray-500">{row.transferStopName || 'Unknown'}</td>
                                                <td className="py-2 px-3 text-gray-500">
                                                    <div className="text-xs">Arrival: {formatTripAnchors(row.fromTripAnchors)}</div>
                                                    <div className="text-xs">Departure: {formatTripAnchors(row.toTripAnchors)}</div>
                                                </td>
                                                <td className="py-2 px-3 text-gray-500">
                                                    {row.dominantTimeBands.map(formatTimeBand).join(', ') || 'N/A'}
                                                </td>
                                                <td className="py-2 px-3 text-right font-bold">{fmt(row.totalCount)}</td>
                                                <td className="py-2 px-3 text-right text-gray-500">{row.avgWaitMinutes} min</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <NoData />
                        )}
                    </ChartCard>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <ChartCard
                            title="GO-Linked Transfers"
                            subtitle="Volumes by route pair and time band"
                        >
                            {filteredGoLinked.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-200">
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">From</th>
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">To</th>
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Band</th>
                                                <th className="text-right py-2 px-3 text-gray-500 font-medium">Count</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredGoLinked.slice(0, 15).map((row, i) => (
                                                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                                    <td className="py-2 px-3">{row.fromRoute}</td>
                                                    <td className="py-2 px-3">{row.toRoute}</td>
                                                    <td className="py-2 px-3 text-gray-500">{formatTimeBand(row.timeBand)}</td>
                                                    <td className="py-2 px-3 text-right font-bold">{fmt(row.totalCount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <NoData />
                            )}
                        </ChartCard>

                        <ChartCard
                            title="Connection Targets"
                            subtitle="Import-ready candidates for Scheduler 4"
                        >
                            {filteredConnectionTargets.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-200">
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Pair</th>
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Stop ID</th>
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Common Arrival/Departure Times</th>
                                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Bands</th>
                                                <th className="text-right py-2 px-3 text-gray-500 font-medium">Tier</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredConnectionTargets.slice(0, 15).map((row, i) => (
                                                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                                    <td className="py-2 px-3">
                                                        <div className="font-medium">{row.fromRoute} → {row.toRoute}</div>
                                                        <div className="text-xs text-gray-400">{row.locationStopName || 'Unknown stop'}</div>
                                                    </td>
                                                    <td className="py-2 px-3 text-gray-500">{row.locationStopId || 'Unmatched'}</td>
                                                    <td className="py-2 px-3 text-gray-500">
                                                        <div className="text-xs">Arrival: {formatTripAnchors(row.fromTripAnchors)}</div>
                                                        <div className="text-xs">Departure: {formatTripAnchors(row.toTripAnchors)}</div>
                                                    </td>
                                                    <td className="py-2 px-3 text-gray-500">{row.timeBands.map(formatTimeBand).join(', ')}</td>
                                                    <td className="py-2 px-3 text-right">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${priorityColor(row.priorityTier)}`}>
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
                        </ChartCard>
                    </div>
                </>
            )}

            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-medium">Sort:</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        <button
                            onClick={() => setSortBy('count')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                sortBy === 'count'
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            By Count
                        </button>
                        <button
                            onClick={() => setSortBy('avgWaitMinutes')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                sortBy === 'avgWaitMinutes'
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            By Wait Time
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-medium">Scope:</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        <button
                            onClick={() => setScope('barrie')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                scope === 'barrie'
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            Barrie Only
                        </button>
                        <button
                            onClick={() => setScope('regional')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                scope === 'regional'
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            Regional
                        </button>
                        <button
                            onClick={() => setScope('all')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                scope === 'all'
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                        >
                            All
                        </button>
                    </div>
                </div>
                <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={groupByRoute}
                        onChange={e => setGroupByRoute(e.target.checked)}
                        className="accent-cyan-500"
                    />
                    Group by route pair
                </label>
            </div>

            {groupByRoute && groupedPatterns ? (
                <div className="space-y-4">
                    {groupedPatterns.map(group => (
                        <ChartCard
                            key={group.routePair}
                            title={group.routePair}
                            subtitle={`${fmt(group.totalCount)} transfers, avg ${group.avgWait.toFixed(1)} min wait`}
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200">
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">From Stop</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">To Stop</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">Common Arrival Times</th>
                                            <th className="text-left py-2 px-3 text-gray-500 font-medium">Common Departure Times</th>
                                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Count</th>
                                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg Wait</th>
                                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Min/Max</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.patterns.map((tp, i) => (
                                            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                                <td className="py-2 px-3 text-gray-500 truncate max-w-[180px]">{tp.fromStop}</td>
                                                <td className="py-2 px-3 text-gray-500 truncate max-w-[180px]">{tp.toStop}</td>
                                                <td className="py-2 px-3 text-gray-500 text-xs">{formatTripAnchors(tp.fromTripAnchors)}</td>
                                                <td className="py-2 px-3 text-gray-500 text-xs">{formatTripAnchors(tp.toTripAnchors)}</td>
                                                <td className="py-2 px-3 text-right font-bold">{tp.count}</td>
                                                <td className="py-2 px-3 text-right">{tp.avgWaitMinutes} min</td>
                                                <td className="py-2 px-3 text-right text-gray-400">{tp.minWaitMinutes}-{tp.maxWaitMinutes}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </ChartCard>
                    ))}
                </div>
            ) : (
                <ChartCard
                    title="Transfer Patterns"
                    subtitle={`${fmt(sortedPatterns.length)} route-to-route transfers`}
                    headerExtra={
                        <button
                            onClick={() => setSortBy(prev => prev === 'count' ? 'avgWaitMinutes' : 'count')}
                            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                        >
                            <ArrowUpDown size={12} />
                            {sortBy === 'count' ? 'Count' : 'Wait'}
                        </button>
                    }
                >
                    {sortedPatterns.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-2 px-3 text-gray-500 font-medium">From Route</th>
                                        <th className="text-left py-2 px-3 text-gray-500 font-medium">To Route</th>
                                        <th className="text-left py-2 px-3 text-gray-500 font-medium">Transfer Stop</th>
                                        <th className="text-left py-2 px-3 text-gray-500 font-medium">Common Arrival Times</th>
                                        <th className="text-left py-2 px-3 text-gray-500 font-medium">Common Departure Times</th>
                                        <th className="text-right py-2 px-3 text-gray-500 font-medium">Count</th>
                                        <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg Wait</th>
                                        <th className="text-right py-2 px-3 text-gray-500 font-medium">Min/Max</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedPatterns.map((tp, i) => (
                                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-2 px-3 font-medium">{tp.fromRoute}</td>
                                            <td className="py-2 px-3 font-medium">{tp.toRoute}</td>
                                            <td className="py-2 px-3 text-gray-500 truncate max-w-[200px]">{tp.fromStop} → {tp.toStop}</td>
                                            <td className="py-2 px-3 text-gray-500 text-xs">{formatTripAnchors(tp.fromTripAnchors)}</td>
                                            <td className="py-2 px-3 text-gray-500 text-xs">{formatTripAnchors(tp.toTripAnchors)}</td>
                                            <td className="py-2 px-3 text-right font-bold">{tp.count}</td>
                                            <td className="py-2 px-3 text-right">{tp.avgWaitMinutes} min</td>
                                            <td className="py-2 px-3 text-right text-gray-400">{tp.minWaitMinutes}-{tp.maxWaitMinutes}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>
            )}
        </div>
    );
};
