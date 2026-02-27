/**
 * OD Route Estimation Module
 *
 * Matches OD pairs to GTFS routes spatially using the bundled
 * Ontario Northland GTFS zip. Auto-runs on mount, with an
 * "Update GTFS" option for loading a newer static file.
 */

import React, { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts';
import {
    Upload,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Search,
    Loader2,
} from 'lucide-react';
import { ChartCard, MetricCard, fmt } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';
import {
    estimateRoutes,
    type ODRouteEstimationResult,
    type MatchConfidence,
    type StationMatchType,
} from '../../utils/od-matrix/odRouteEstimation';
import gtfsZipUrl from '../../gtfs.zip?url';

interface ODRouteEstimationModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
}

const CONFIDENCE_COLORS: Record<MatchConfidence, string> = {
    high: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    medium: 'text-amber-700 bg-amber-50 border-amber-200',
    low: 'text-orange-700 bg-orange-50 border-orange-200',
    none: 'text-red-700 bg-red-50 border-red-200',
};

const MATCH_TYPE_COLORS: Record<StationMatchType, string> = {
    exact: 'text-emerald-700 bg-emerald-50',
    contains: 'text-cyan-700 bg-cyan-50',
    alias: 'text-amber-700 bg-amber-50',
    unmatched: 'text-red-700 bg-red-50',
};

const BAR_COLORS = ['#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#8b5cf6', '#a78bfa'];
const PAIR_TABLE_HEIGHT_PX = 500;
const PAIR_ROW_HEIGHT_PX = 44;
const PAIR_OVERSCAN_ROWS = 12;
const STATION_TABLE_HEIGHT_PX = 400;
const STATION_ROW_HEIGHT_PX = 40;
const STATION_OVERSCAN_ROWS = 10;

// Module-level cache — persists across tab switches (component unmount/remount)
let cachedEstimation: {
    dataKey: string;
    fileName: string;
    result: ODRouteEstimationResult;
} | null = null;

function getDataKey(data: ODMatrixDataSummary): string {
    return `${data.metadata.importId || ''}_${data.totalJourneys}_${data.pairs.length}`;
}

function normalizeKey(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function summarizeItems(items: string[], maxItems = 2): string {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        const key = normalizeKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        uniq.push(item);
    }

    if (uniq.length === 0) return '';
    if (uniq.length <= maxItems) return uniq.join(', ');
    return `${uniq.slice(0, maxItems).join(', ')} (+${uniq.length - maxItems} more)`;
}

function extractViaLabel(path: string): string | null {
    const match = path.match(/\(via (.+)\)\s*$/i);
    return match?.[1]?.trim() || null;
}

function detailedConfidenceExplanation(match: {
    confidence: MatchConfidence;
    candidateCount: number;
    plausiblePaths?: string[];
    transfer?: {
        legs?: { routeName: string }[];
        transferStops?: string[];
    };
    routeLongName: string | null;
}): string {
    const plausible = match.plausiblePaths?.slice(0, 3) || [];
    const plausibleText = plausible.length > 1
        ? ` Plausible paths: ${plausible.join(' | ')}.`
        : '';

    if (match.confidence === 'none') {
        return 'No valid direct or transfer path could be resolved for this OD pair.';
    }

    const legCount = match.transfer?.legs?.length || (match.transfer ? 2 : 1);
    const transferStopCount = match.transfer?.transferStops?.length || 0;

    if (match.transfer) {
        if (match.confidence === 'high') {
            return legCount <= 2
                ? 'A clear transfer path was found with a strong best option.'
                : `A clear ${legCount}-leg transfer path was found.`;
        }
        if (match.confidence === 'medium') {
            const base = match.candidateCount > 1
                ? `${match.candidateCount} transfer-path options matched; shortest ${legCount}-leg path selected.`
                : `Transfer required (${legCount} legs, ${transferStopCount} transfer stop${transferStopCount === 1 ? '' : 's'}).`;
            return `${base}${plausibleText}`;
        }
        return `${match.candidateCount} transfer-path options were similarly plausible.${plausibleText}`;
    }

    if (match.confidence === 'high') {
        return 'Only one direct route matched this OD pair.';
    }
    if (match.confidence === 'medium') {
        const base = match.candidateCount > 1
            ? `${match.candidateCount} direct routes include this OD pair; shortest-stop route selected.`
            : 'Direct route matched with moderate certainty.';
        return `${base}${plausibleText}`;
    }
    return `${match.candidateCount} direct route candidates were similarly plausible.${plausibleText}`;
}

function confidenceExplanation(match: {
    confidence: MatchConfidence;
    candidateCount: number;
    plausiblePaths?: string[];
    transfer?: {
        legs?: { routeName: string }[];
        transferStops?: string[];
    };
    routeLongName: string | null;
}): string {
    if (match.confidence === 'none') {
        return 'No viable route found.';
    }

    const selectedRoute = match.routeLongName || 'selected route';
    const plausible = match.plausiblePaths || [];
    const altRoutes = plausible.filter(p => normalizeKey(p) !== normalizeKey(selectedRoute));

    if (!match.transfer) {
        if (match.candidateCount <= 1) return 'Single direct route match.';
        const alt = summarizeItems(altRoutes, 2);
        if (match.confidence === 'medium') {
            return alt
                ? `Direct (${match.candidateCount} routes): chose shortest-stop route; alt: ${alt}.`
                : `Direct (${match.candidateCount} routes): chose shortest-stop route.`;
        }
        return alt
            ? `Direct ambiguous (${match.candidateCount} routes): selected route; alt: ${alt}.`
            : `Direct ambiguous (${match.candidateCount} routes).`;
    }

    const selectedVia = (match.transfer.transferStops || []).join(' → ') || 'transfer stop chain';
    const altVias = plausible
        .map(extractViaLabel)
        .filter((v): v is string => Boolean(v))
        .filter(v => normalizeKey(v) !== normalizeKey(selectedVia));
    const altViaText = summarizeItems(altVias, 2);

    if (match.candidateCount <= 1) {
        return `Transfer required; selected via ${selectedVia}.`;
    }
    if (match.confidence === 'medium') {
        return altViaText
            ? `Transfer (${match.candidateCount} options): selected via ${selectedVia}; alt via ${altViaText}.`
            : `Transfer (${match.candidateCount} options): selected via ${selectedVia}.`;
    }
    return altViaText
        ? `Transfer ambiguous (${match.candidateCount} options): selected via ${selectedVia}; alt via ${altViaText}.`
        : `Transfer ambiguous (${match.candidateCount} options): selected via ${selectedVia}.`;
}

function stationMatchExplanation(match: {
    matchType: StationMatchType;
    reason?: string;
    nearMatches?: string[];
}): string {
    const nameOnlyNote = 'Route assignment matching here is name-based (not geocode-based).';

    if (match.reason && match.reason.trim()) {
        if (match.nearMatches && match.nearMatches.length > 0 && match.matchType === 'unmatched') {
            return `${match.reason} Closest GTFS: ${match.nearMatches.join(', ')}. ${nameOnlyNote}`;
        }
        if (match.matchType === 'unmatched') {
            return `${match.reason} ${nameOnlyNote}`;
        }
        return match.reason;
    }

    switch (match.matchType) {
        case 'exact':
            return 'Exact normalized station-name match.';
        case 'contains':
            return 'Partial/token match to a GTFS stop name variant.';
        case 'alias':
            return 'Matched through known station alias mapping.';
        case 'unmatched':
            return 'No GTFS stop matched after exact, partial/token, and alias checks.';
        default:
            return '';
    }
}

export const ODRouteEstimationModule: React.FC<ODRouteEstimationModuleProps> = ({ data }) => {
    const dataKey = getDataKey(data);
    const hasCached = cachedEstimation?.dataKey === dataKey;

    const [result, setResult] = useState<ODRouteEstimationResult | null>(hasCached ? cachedEstimation!.result : null);
    const [loading, setLoading] = useState(!hasCached);
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState(hasCached ? cachedEstimation!.fileName : 'Ontario Northland GTFS (bundled)');
    const [search, setSearch] = useState('');
    const [confidenceFilter, setConfidenceFilter] = useState<MatchConfidence | 'all'>('all');
    const [updating, setUpdating] = useState(false);
    const [pairScrollTop, setPairScrollTop] = useState(0);
    const [stationScrollTop, setStationScrollTop] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const deferredSearch = useDeferredValue(search);

    // Auto-load bundled GTFS zip on mount (skipped if cached)
    useEffect(() => {
        if (hasCached) return;

        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(gtfsZipUrl);
                if (!response.ok) throw new Error('Failed to load bundled GTFS zip');
                const buffer = await response.arrayBuffer();
                if (cancelled) return;
                const estimation = estimateRoutes(buffer, data);
                if (!cancelled) {
                    cachedEstimation = { dataKey, fileName: 'Ontario Northland GTFS (bundled)', result: estimation };
                    setResult(estimation);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load GTFS data');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [data, dataKey, hasCached]);

    const handleUpdateGtfs = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUpdating(true);
        setError(null);

        try {
            const buffer = await file.arrayBuffer();
            const estimation = estimateRoutes(buffer, data);
            cachedEstimation = { dataKey, fileName: file.name, result: estimation };
            setResult(estimation);
            setFileName(file.name);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to process GTFS zip');
        } finally {
            setUpdating(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [data, dataKey]);

    const filteredMatches = useMemo(() => {
        if (!result) return [];
        let matches = result.matches;

        if (confidenceFilter !== 'all') {
            matches = matches.filter(m => m.confidence === confidenceFilter);
        }

        if (deferredSearch.trim()) {
            const q = deferredSearch.toLowerCase();
            matches = matches.filter(
                m => m.origin.toLowerCase().includes(q)
                    || m.destination.toLowerCase().includes(q)
                    || (m.routeShortName?.toLowerCase().includes(q))
                    || (m.routeLongName?.toLowerCase().includes(q))
            );
        }

        return matches;
    }, [result, deferredSearch, confidenceFilter]);

    const chartData = useMemo(() => {
        if (!result) return [];
        return result.routeDistribution.map(r => ({
            label: r.routeLongName || r.routeShortName,
            fullLabel: r.routeLongName ? `${r.routeShortName} — ${r.routeLongName}` : r.routeShortName,
            journeys: r.journeys,
            pairs: r.pairCount,
        }));
    }, [result]);

    const pairWindow = useMemo(() => {
        const totalRows = filteredMatches.length;
        if (totalRows === 0) {
            return {
                start: 0,
                end: 0,
                topSpacerPx: 0,
                bottomSpacerPx: 0,
                rows: [] as typeof filteredMatches,
            };
        }

        const start = Math.max(0, Math.floor(pairScrollTop / PAIR_ROW_HEIGHT_PX) - PAIR_OVERSCAN_ROWS);
        const visibleCount = Math.ceil(PAIR_TABLE_HEIGHT_PX / PAIR_ROW_HEIGHT_PX) + (PAIR_OVERSCAN_ROWS * 2);
        const end = Math.min(totalRows, start + visibleCount);
        return {
            start,
            end,
            topSpacerPx: start * PAIR_ROW_HEIGHT_PX,
            bottomSpacerPx: Math.max(0, (totalRows - end) * PAIR_ROW_HEIGHT_PX),
            rows: filteredMatches.slice(start, end),
        };
    }, [filteredMatches, pairScrollTop]);

    const handlePairTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setPairScrollTop(e.currentTarget.scrollTop);
    }, []);

    useEffect(() => {
        setPairScrollTop(0);
    }, [deferredSearch, confidenceFilter, result?.totalMatched, result?.totalUnmatched]);

    // Loading state
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 size={32} className="mb-3 animate-spin text-violet-400" />
                <p className="text-sm text-gray-500">Loading Ontario Northland GTFS...</p>
            </div>
        );
    }

    // Error with no result
    if (!result && error) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <XCircle size={16} />
                    {error}
                </div>
            </div>
        );
    }

    if (!result) return null;

    const matchedPct = result.totalJourneys > 0
        ? ((result.matchedJourneys / result.totalJourneys) * 100).toFixed(1)
        : '0';

    return (
        <div className="flex flex-col gap-6">
            {/* File info + Update GTFS */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    <span>GTFS: <span className="font-medium text-gray-700">{fileName}</span></span>
                </div>
                <div className="relative">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip"
                        onChange={handleUpdateGtfs}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={updating}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                    >
                        {updating ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        {updating ? 'Processing...' : 'Update GTFS'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <XCircle size={16} />
                    {error}
                </div>
            )}

            {/* Summary Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<CheckCircle2 size={20} />}
                    label="Matched Pairs"
                    value={fmt(result.totalMatched)}
                    color="emerald"
                    subValue={`of ${fmt(result.totalMatched + result.totalUnmatched)} total`}
                />
                <MetricCard
                    icon={<XCircle size={20} />}
                    label="Unmatched Pairs"
                    value={fmt(result.totalUnmatched)}
                    color={result.totalUnmatched > 0 ? 'red' : 'emerald'}
                />
                <MetricCard
                    icon={<CheckCircle2 size={20} />}
                    label="Matched Journeys"
                    value={`${matchedPct}%`}
                    color="cyan"
                    subValue={`${fmt(result.matchedJourneys)} of ${fmt(result.totalJourneys)}`}
                />
                <MetricCard
                    icon={<CheckCircle2 size={20} />}
                    label="Routes Found"
                    value={String(result.routeDistribution.length)}
                    color="indigo"
                />
            </div>

            <div className="order-3">
                {/* Route Distribution Chart */}
                {chartData.length > 0 && (
                    <ChartCard
                        title="Route Distribution"
                        subtitle="Estimated passenger journeys per GTFS route"
                    >
                        <div style={{ height: Math.max(200, chartData.length * 50) }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={chartData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                                    <YAxis
                                        type="category"
                                        dataKey="label"
                                        width={180}
                                        tick={{ fontSize: 12 }}
                                    />
                                    <Tooltip
                                        formatter={(value: number) => [fmt(value), 'Journeys']}
                                        labelFormatter={(_: string, payload) => {
                                            const item = payload?.[0]?.payload;
                                            return item?.fullLabel || '';
                                        }}
                                    />
                                    <Bar dataKey="journeys" radius={[0, 4, 4, 0]}>
                                        {chartData.map((_entry, i) => (
                                            <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </ChartCard>
                )}
            </div>

            <div className="order-4">
                {/* Station Match Report */}
                <ChartCard
                    title="Station Match Report"
                    subtitle={`${result.stationMatchReport.filter(s => s.matchType !== 'unmatched').length} of ${result.stationMatchReport.length} stations matched`}
                >
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-200">
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">OD Station</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">GTFS Stop</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium w-28">Match Type</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium min-w-[260px]">Why</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.stationMatchReport.map((s) => (
                                <tr
                                        key={s.odName}
                                        className={`border-b border-gray-50 ${s.matchType === 'unmatched' ? 'bg-red-50/30' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="py-2 px-3 text-xs text-gray-700 font-medium">{s.odName}</td>
                                        <td className="py-2 px-3 text-xs text-gray-600">
                                            {s.gtfsStopName || <span className="text-red-400 italic">No match</span>}
                                        </td>
                                    <td className="py-2 px-3">
                                        <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full ${MATCH_TYPE_COLORS[s.matchType]}`}>
                                            {s.matchType}
                                        </span>
                                    </td>
                                    <td className="py-2 px-3 text-xs text-gray-600">
                                        {stationMatchExplanation(s)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </ChartCard>
            </div>

            <div className="order-2">
                {/* Pair Results Table */}
                <ChartCard
                title="Pair Route Assignments"
                subtitle={`${filteredMatches.length} pairs shown`}
                headerExtra={
                    <div className="flex items-center gap-2">
                        {/* Confidence filter */}
                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                            {(['all', 'high', 'medium', 'low', 'none'] as const).map(opt => (
                                <button
                                    key={opt}
                                    onClick={() => setConfidenceFilter(opt)}
                                    className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                        confidenceFilter === opt
                                            ? 'bg-gray-900 text-white'
                                            : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    {opt === 'all' ? 'All' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                                </button>
                            ))}
                        </div>
                        {/* Search */}
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search..."
                                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent w-40"
                            />
                        </div>
                    </div>
                }
            >
                <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    <p className="font-semibold text-gray-700">Assignment logic summary</p>
                    <p className="mt-1">
                        1) Station names are normalized and alias-matched to GTFS stops.
                        2) Direct routes are checked first (origin must appear before destination in route stop order).
                        3) If multiple direct routes match, the shortest-stop path is selected.
                        4) If no direct route matches, transfer paths up to 4 legs are evaluated and ranked by fewest legs, then hub preference, then fewer stops.
                        5) Confidence reflects uniqueness: single clear winner = higher confidence; multiple plausible options = lower confidence.
                    </p>
                </div>
                <div
                    className="overflow-x-auto overflow-y-auto"
                    style={{ maxHeight: `${PAIR_TABLE_HEIGHT_PX}px` }}
                    onScroll={handlePairTableScroll}
                >
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-gray-200">
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Origin</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Destination</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium w-24">Journeys</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Route</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Via</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium w-16">Stops</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium w-24">Confidence</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium min-w-[260px]">Why</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pairWindow.topSpacerPx > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={8} style={{ height: `${pairWindow.topSpacerPx}px`, padding: 0, border: 0 }} />
                                </tr>
                            )}
                            {pairWindow.rows.map((m, i) => {
                                const rowIndex = pairWindow.start + i;
                                const transferRouteNames = m.transfer?.legs?.length
                                    ? m.transfer.legs.map(leg => leg.routeName)
                                    : (m.transfer ? [m.transfer.leg1RouteName, m.transfer.leg2RouteName] : []);
                                const transferStops = m.transfer?.transferStops?.length
                                    ? m.transfer.transferStops
                                    : (m.transfer ? [m.transfer.viaStop] : []);
                                const why = confidenceExplanation(m);
                                const whyDetail = detailedConfidenceExplanation(m);

                                return (
                                    <tr
                                        key={`${m.origin}-${m.destination}-${rowIndex}`}
                                        className="h-11 border-b border-gray-50 hover:bg-gray-50"
                                    >
                                        <td className="py-2 px-3 text-xs text-gray-700"><span className="block truncate max-w-[180px]" title={m.origin}>{m.origin}</span></td>
                                        <td className="py-2 px-3 text-xs text-gray-700"><span className="block truncate max-w-[180px]" title={m.destination}>{m.destination}</span></td>
                                        <td className="py-2 px-3 text-right font-bold text-gray-900">{fmt(m.journeys)}</td>
                                        <td className="py-2 px-3 text-xs text-gray-700">
                                            {m.transfer ? (
                                                <span className="block truncate max-w-[260px]" title={m.routeLongName || ''}>{transferRouteNames.join(' → ')}</span>
                                            ) : m.routeLongName ? (
                                                <span className="block truncate max-w-[260px]" title={m.routeId || ''}>{m.routeLongName}</span>
                                            ) : (
                                                <span className="text-gray-400 italic">—</span>
                                            )}
                                        </td>
                                        <td className="py-2 px-3 text-xs text-gray-600">
                                            {m.transfer ? (
                                                <span
                                                    className="inline-flex max-w-[220px] items-center gap-1 truncate px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded text-[11px] font-medium"
                                                    title={transferStops.join(' → ')}
                                                >
                                                    {transferStops.join(' → ')}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="py-2 px-3 text-right text-xs text-gray-500">
                                            {m.confidence !== 'none' ? m.intermediateStops : '—'}
                                        </td>
                                        <td className="py-2 px-3">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border ${CONFIDENCE_COLORS[m.confidence]}`}>
                                                {m.confidence === 'high' && <CheckCircle2 size={11} />}
                                                {m.confidence === 'medium' && <AlertTriangle size={11} />}
                                                {m.confidence === 'low' && <AlertTriangle size={11} />}
                                                {m.confidence === 'none' && <XCircle size={11} />}
                                                {m.confidence}
                                            </span>
                                        </td>
                                        <td
                                            className="py-2 px-3 text-xs text-gray-600"
                                            title={whyDetail}
                                        >
                                            <span className="block truncate max-w-[360px]">{why}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {pairWindow.bottomSpacerPx > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={8} style={{ height: `${pairWindow.bottomSpacerPx}px`, padding: 0, border: 0 }} />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                </ChartCard>
            </div>
        </div>
    );
};
