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
    MapPin,
    ChevronUp,
    ChevronDown,
    Route,
    Layers,
    BarChart3,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fmt } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import {
    estimateRoutes,
    type ODRouteEstimationResult,
    type MatchConfidence,
    type StationMatchType,
    type ODPairRouteMatch,
} from '../../utils/od-matrix/odRouteEstimation';
import { ODPairMapModal } from './ODPairMapModal';
import gtfsZipUrl from '../../gtfs.zip?url';

interface ODRouteEstimationModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onResultReady?: (result: ODRouteEstimationResult) => void;
}

const CONFIDENCE_COLORS: Record<MatchConfidence, string> = {
    high: 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200',
    medium: 'text-amber-700 bg-amber-50 ring-1 ring-amber-200',
    low: 'text-orange-700 bg-orange-50 ring-1 ring-orange-200',
    none: 'text-red-700 bg-red-50 ring-1 ring-red-200',
};

const MATCH_TYPE_COLORS: Record<StationMatchType, string> = {
    exact: 'text-emerald-700 bg-emerald-50',
    contains: 'text-cyan-700 bg-cyan-50',
    alias: 'text-amber-700 bg-amber-50',
    coordinate: 'text-blue-700 bg-blue-50',
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
    let geocodeCount = 0;
    for (const station of data.stations) {
        if (station.geocode && Number.isFinite(station.geocode.lat) && Number.isFinite(station.geocode.lon)) {
            geocodeCount++;
        }
    }
    return `${data.metadata.importId || ''}_${data.metadata.importedAt || ''}_${data.totalJourneys}_${data.pairs.length}_${geocodeCount}`;
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
    const matchingNote = 'Route assignment uses name matching first, with coordinate fallback when OD coordinates are available.';

    if (match.reason && match.reason.trim()) {
        if (match.nearMatches && match.nearMatches.length > 0 && match.matchType === 'unmatched') {
            return `${match.reason} Closest GTFS: ${match.nearMatches.join(', ')}. ${matchingNote}`;
        }
        if (match.matchType === 'unmatched') {
            return `${match.reason} ${matchingNote}`;
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
        case 'coordinate':
            return 'Matched using nearest coordinate fallback.';
        case 'unmatched':
            return 'No GTFS stop matched after exact, partial/token, and alias checks.';
        default:
            return '';
    }
}

type PairSortColumn = 'origin' | 'destination' | 'route' | 'stops' | 'confidence' | 'why';
type SortDirection = 'asc' | 'desc';

const CONFIDENCE_ORDER: Record<MatchConfidence, number> = { high: 0, medium: 1, low: 2, none: 3 };

function getRouteLabel(m: ODPairRouteMatch): string {
    if (m.transfer) {
        const names = m.transfer.legs?.length
            ? m.transfer.legs.map(leg => leg.routeName)
            : [m.transfer.leg1RouteName, m.transfer.leg2RouteName];
        return names.join(' → ');
    }
    return m.routeLongName || '';
}

function resolveGeocode(
    stationName: string,
    geocodeCache: GeocodeCache | null,
): GeocodedLocation | null {
    if (!geocodeCache) return null;
    const key = Object.keys(geocodeCache.stations).find(
        k => k.toLowerCase() === stationName.toLowerCase(),
    );
    return key ? geocodeCache.stations[key] : null;
}

interface TransferPointAgg {
    stopName: string;
    lat: number;
    lon: number;
    totalJourneys: number;
    pairCount: number;
    connectingRoutes: string[];
}

const TRANSFER_MAP_HEIGHT_PX = 540;
const BAR_WIDTH = 28;
const BAR_SIDE_WIDTH = 8;
const MAX_BAR_HEIGHT = 120;
const LABEL_VOLUME_THRESHOLD = 0.03; // hide labels for points < 3% of max volume

// Shared color scale: green (low) → yellow → orange → red (high)
// Used by bars, dots, AND glows so everything matches.
const COLOR_STOPS: [number, number, number, number][] = [
    [0.0, 34, 197, 94],    // green-500
    [0.35, 234, 179, 8],   // yellow-500
    [0.65, 249, 115, 22],  // orange-500
    [1.0, 239, 68, 68],    // red-500
];

function interpolateColor(ratio: number, lighten: number = 0): string {
    let r = 239, g = 68, b = 68; // fallback red
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
        const [t0, r0, g0, b0] = COLOR_STOPS[i];
        const [t1, r1, g1, b1] = COLOR_STOPS[i + 1];
        if (ratio <= t1) {
            const t = (ratio - t0) / (t1 - t0);
            r = Math.round(r0 + (r1 - r0) * t);
            g = Math.round(g0 + (g1 - g0) * t);
            b = Math.round(b0 + (b1 - b0) * t);
            break;
        }
    }
    if (lighten > 0) {
        r = Math.min(255, r + Math.round((255 - r) * lighten));
        g = Math.min(255, g + Math.round((255 - g) * lighten));
        b = Math.min(255, b + Math.round((255 - b) * lighten));
    } else if (lighten < 0) {
        const d = -lighten;
        r = Math.round(r * (1 - d));
        g = Math.round(g * (1 - d));
        b = Math.round(b * (1 - d));
    }
    return `rgb(${r},${g},${b})`;
}

function barColor(ratio: number): string { return interpolateColor(ratio); }
function barColorDark(ratio: number): string { return interpolateColor(ratio, -0.25); }
function barColorLight(ratio: number): string { return interpolateColor(ratio, 0.35); }
function glowGradientColor(ratio: number): string { return interpolateColor(ratio); }

/** Title case: "THUNDER BAY" → "Thunder Bay" */
function toTitleCase(s: string): string {
    return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

function buildBarHtml(ratio: number, journeys: number): string {
    const barHeight = Math.max(18, Math.round(ratio * MAX_BAR_HEIGHT));

    return `<div style="position:relative;width:${BAR_WIDTH + BAR_SIDE_WIDTH}px;height:${barHeight + 26}px;pointer-events:auto;cursor:pointer;">
        <div style="position:absolute;bottom:0;left:0;width:${BAR_WIDTH}px;height:${barHeight}px;
            background:linear-gradient(to top,${barColorDark(ratio)},${barColor(ratio)});
            border-radius:3px 3px 0 0;opacity:0.92;
            box-shadow:0 2px 6px rgba(0,0,0,0.2);"></div>
        <div style="position:absolute;bottom:0;left:${BAR_WIDTH}px;width:${BAR_SIDE_WIDTH}px;height:${barHeight}px;
            background:linear-gradient(to top,${barColorDark(Math.max(0, ratio - 0.1))},${barColorDark(ratio)});
            transform:skewY(-40deg);transform-origin:bottom left;opacity:0.7;"></div>
        <div style="position:absolute;bottom:${barHeight}px;left:0;width:${BAR_WIDTH}px;height:${BAR_SIDE_WIDTH}px;
            background:${barColorLight(ratio)};
            transform:skewX(-40deg);transform-origin:bottom left;opacity:0.85;
            border-radius:3px 3px 0 0;"></div>
        <div style="position:absolute;bottom:${barHeight + 8}px;left:50%;transform:translateX(-50%);
            white-space:nowrap;font-size:10px;font-weight:700;color:#1e293b;
            background:rgba(255,255,255,0.85);padding:1px 4px;border-radius:3px;
            box-shadow:0 1px 2px rgba(0,0,0,0.08);
            pointer-events:none;">${fmt(journeys)}</div>
    </div>`;
}

// ── Inline UI Components ────────────────────────────────────────────────────

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

// ── Main Component ──────────────────────────────────────────────────────────

export const ODRouteEstimationModule: React.FC<ODRouteEstimationModuleProps> = ({ data, geocodeCache, onResultReady }) => {
    const dataKey = getDataKey(data);
    const hasCached = cachedEstimation?.dataKey === dataKey;

    const [result, setResult] = useState<ODRouteEstimationResult | null>(hasCached ? cachedEstimation!.result : null);
    const [loading, setLoading] = useState(!hasCached);
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState(hasCached ? cachedEstimation!.fileName : 'Ontario Northland GTFS (bundled)');
    const [search, setSearch] = useState('');
    const [confidenceFilter, setConfidenceFilter] = useState<MatchConfidence | 'all'>('all');
    const [updating, setUpdating] = useState(false);
    const [selectedPair, setSelectedPair] = useState<ODPairRouteMatch | null>(null);
    const [pairScrollTop, setPairScrollTop] = useState(0);
    const [stationScrollTop, setStationScrollTop] = useState(0);
    const [pairSortCol, setPairSortCol] = useState<PairSortColumn | null>(null);
    const [pairSortDir, setPairSortDir] = useState<SortDirection>('asc');
    const [transferTopN, setTransferTopN] = useState<number | 'all'>(10);
    const [showBars, setShowBars] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const deferredSearch = useDeferredValue(search);

    useEffect(() => {
        if (hasCached && cachedEstimation?.result) {
            onResultReady?.(cachedEstimation.result);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
                    onResultReady?.(estimation);
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
            onResultReady?.(estimation);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to process GTFS zip');
        } finally {
            setUpdating(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [data, dataKey, onResultReady]);

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

    const sortedMatches = useMemo(() => {
        if (!pairSortCol) return filteredMatches;
        const dir = pairSortDir === 'asc' ? 1 : -1;
        return [...filteredMatches].sort((a, b) => {
            switch (pairSortCol) {
                case 'origin':
                    return dir * a.origin.localeCompare(b.origin);
                case 'destination':
                    return dir * a.destination.localeCompare(b.destination);
                case 'route':
                    return dir * getRouteLabel(a).localeCompare(getRouteLabel(b));
                case 'stops': {
                    const aStops = a.confidence !== 'none' ? a.intermediateStops : Infinity;
                    const bStops = b.confidence !== 'none' ? b.intermediateStops : Infinity;
                    return dir * (aStops - bStops);
                }
                case 'confidence':
                    return dir * (CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]);
                case 'why':
                    return dir * confidenceExplanation(a).localeCompare(confidenceExplanation(b));
                default:
                    return 0;
            }
        });
    }, [filteredMatches, pairSortCol, pairSortDir]);

    const handlePairSort = useCallback((col: PairSortColumn) => {
        setPairSortCol(prev => {
            if (prev === col) {
                setPairSortDir(d => {
                    if (d === 'asc') return 'desc';
                    setPairSortCol(null);
                    return 'asc';
                });
                return col;
            }
            setPairSortDir('asc');
            return col;
        });
        setPairScrollTop(0);
    }, []);

    const chartData = useMemo(() => {
        if (!result) return [];
        return result.routeDistribution.map(r => ({
            label: r.routeLongName || r.routeShortName,
            fullLabel: r.routeLongName ? `${r.routeShortName} — ${r.routeLongName}` : r.routeShortName,
            journeys: r.journeys,
            pairs: r.pairCount,
        }));
    }, [result]);

    const stationWindow = useMemo(() => {
        const rows = result?.stationMatchReport || [];
        const totalRows = rows.length;
        if (totalRows === 0) {
            return { start: 0, end: 0, topSpacerPx: 0, bottomSpacerPx: 0, rows: [] as typeof rows };
        }
        const start = Math.max(0, Math.floor(stationScrollTop / STATION_ROW_HEIGHT_PX) - STATION_OVERSCAN_ROWS);
        const visibleCount = Math.ceil(STATION_TABLE_HEIGHT_PX / STATION_ROW_HEIGHT_PX) + (STATION_OVERSCAN_ROWS * 2);
        const end = Math.min(totalRows, start + visibleCount);
        return {
            start, end,
            topSpacerPx: start * STATION_ROW_HEIGHT_PX,
            bottomSpacerPx: Math.max(0, (totalRows - end) * STATION_ROW_HEIGHT_PX),
            rows: rows.slice(start, end),
        };
    }, [result?.stationMatchReport, stationScrollTop]);

    const pairWindow = useMemo(() => {
        const totalRows = sortedMatches.length;
        if (totalRows === 0) {
            return { start: 0, end: 0, topSpacerPx: 0, bottomSpacerPx: 0, rows: [] as typeof sortedMatches };
        }
        const start = Math.max(0, Math.floor(pairScrollTop / PAIR_ROW_HEIGHT_PX) - PAIR_OVERSCAN_ROWS);
        const visibleCount = Math.ceil(PAIR_TABLE_HEIGHT_PX / PAIR_ROW_HEIGHT_PX) + (PAIR_OVERSCAN_ROWS * 2);
        const end = Math.min(totalRows, start + visibleCount);
        return {
            start, end,
            topSpacerPx: start * PAIR_ROW_HEIGHT_PX,
            bottomSpacerPx: Math.max(0, (totalRows - end) * PAIR_ROW_HEIGHT_PX),
            rows: sortedMatches.slice(start, end),
        };
    }, [sortedMatches, pairScrollTop]);

    const handlePairTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setPairScrollTop(e.currentTarget.scrollTop);
    }, []);

    const handleStationTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setStationScrollTop(e.currentTarget.scrollTop);
    }, []);

    useEffect(() => { setPairScrollTop(0); }, [deferredSearch, confidenceFilter, result?.totalMatched, result?.totalUnmatched, pairSortCol, pairSortDir]);
    useEffect(() => { setStationScrollTop(0); }, [result?.stationMatchReport.length]);

    // ── Transfer heatmap data ────────────────────────────────────
    const transferPoints = useMemo((): TransferPointAgg[] => {
        if (!result || !geocodeCache) return [];
        const agg = new Map<string, { journeys: number; pairs: number; routes: Set<string> }>();

        for (const m of result.matches) {
            if (!m.transfer) continue;
            const stops = m.transfer.transferStops?.length
                ? m.transfer.transferStops
                : m.transfer.viaStop ? [m.transfer.viaStop] : [];
            const routeNames = m.transfer.legs?.length
                ? m.transfer.legs.map(leg => leg.routeName)
                : [m.transfer.leg1RouteName, m.transfer.leg2RouteName];

            for (const stop of stops) {
                const entry = agg.get(stop) ?? { journeys: 0, pairs: 0, routes: new Set<string>() };
                entry.journeys += m.journeys;
                entry.pairs += 1;
                for (const r of routeNames) { if (r) entry.routes.add(r); }
                agg.set(stop, entry);
            }
        }

        const points: TransferPointAgg[] = [];
        for (const [stopName, { journeys, pairs, routes }] of agg) {
            const geo = resolveGeocode(stopName, geocodeCache);
            if (!geo) continue;
            points.push({ stopName, lat: geo.lat, lon: geo.lon, totalJourneys: journeys, pairCount: pairs, connectingRoutes: [...routes].sort() });
        }
        return points.sort((a, b) => b.totalJourneys - a.totalJourneys);
    }, [result, geocodeCache]);

    const displayedTransferPoints = useMemo(() => {
        if (transferTopN === 'all') return transferPoints;
        return transferPoints.slice(0, transferTopN);
    }, [transferPoints, transferTopN]);

    const transferMapRef = useRef<HTMLDivElement>(null);
    const leafletMapRef = useRef<L.Map | null>(null);

    useEffect(() => {
        if (leafletMapRef.current) {
            leafletMapRef.current.remove();
            leafletMapRef.current = null;
        }
        if (transferMapRef.current) {
            delete (transferMapRef.current as unknown as Record<string, unknown>)._leaflet_id;
        }
        if (!transferMapRef.current || displayedTransferPoints.length === 0) return;

        const map = L.map(transferMapRef.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: false });
        leafletMapRef.current = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

        // Inject tooltip label styles — title case, pill background for readability
        const style = document.createElement('style');
        style.textContent = [
            `.transfer-label{background:rgba(255,255,255,0.88)!important;border:none!important;box-shadow:0 1px 3px rgba(0,0,0,0.12)!important;font-size:11px!important;font-weight:700!important;color:#1e293b!important;padding:2px 6px!important;border-radius:4px!important;line-height:1.3!important;}`,
            `.transfer-label::before{display:none!important;}`,
            `.transfer-label-minor{background:rgba(255,255,255,0.7)!important;border:none!important;box-shadow:none!important;font-size:9px!important;font-weight:600!important;color:#64748b!important;padding:1px 4px!important;border-radius:3px!important;}`,
            `.transfer-label-minor::before{display:none!important;}`,
        ].join('');
        transferMapRef.current.appendChild(style);

        const maxJourneys = Math.max(...displayedTransferPoints.map(p => p.totalJourneys));

        // Radial glow per point — no additive stacking, largest point = hottest glow
        for (const pt of displayedTransferPoints) {
            const ratio = maxJourneys > 0 ? pt.totalJourneys / maxJourneys : 0;
            const glowSize = 40 + Math.round(ratio * 120); // 40–160px diameter
            const glowColor = glowGradientColor(ratio);
            const glowIcon = L.divIcon({
                html: `<div style="width:${glowSize}px;height:${glowSize}px;border-radius:50%;background:radial-gradient(circle,${glowColor} 0%,rgba(255,255,255,0) 70%);opacity:${0.35 + ratio * 0.35};pointer-events:none;"></div>`,
                className: '',
                iconSize: [glowSize, glowSize],
                iconAnchor: [glowSize / 2, glowSize / 2],
            });
            L.marker([pt.lat, pt.lon], { icon: glowIcon, interactive: false, zIndexOffset: -1000 }).addTo(map);
        }

        const bounds = L.latLngBounds([]);

        // Smart label direction: pick direction that points away from the centroid of nearby points
        const centroidLat = displayedTransferPoints.reduce((s, p) => s + p.lat, 0) / displayedTransferPoints.length;
        const centroidLon = displayedTransferPoints.reduce((s, p) => s + p.lon, 0) / displayedTransferPoints.length;

        function pickDirection(lat: number, lon: number): L.Direction {
            const dLat = lat - centroidLat;
            const dLon = lon - centroidLon;
            if (Math.abs(dLon) > Math.abs(dLat)) return dLon > 0 ? 'right' : 'left';
            return dLat > 0 ? 'top' : 'bottom';
        }

        for (let i = 0; i < displayedTransferPoints.length; i++) {
            const pt = displayedTransferPoints[i];
            const ratio = maxJourneys > 0 ? pt.totalJourneys / maxJourneys : 0;
            const bHeight = Math.max(18, Math.round(ratio * MAX_BAR_HEIGHT));

            let marker: L.Marker | L.CircleMarker;
            if (showBars) {
                const icon = L.divIcon({
                    html: buildBarHtml(ratio, pt.totalJourneys),
                    className: '',
                    iconSize: [BAR_WIDTH + BAR_SIDE_WIDTH, bHeight + 26],
                    iconAnchor: [BAR_WIDTH / 2, bHeight],
                });
                marker = L.marker([pt.lat, pt.lon], { icon }).addTo(map);
            } else {
                const radius = 6 + Math.round(ratio * 18);
                marker = L.circleMarker([pt.lat, pt.lon], {
                    radius,
                    fillColor: barColor(ratio),
                    fillOpacity: 0.85,
                    color: '#fff',
                    weight: 2,
                }).addTo(map);
            }

            // Label: title case, smart direction, visual hierarchy by volume
            const displayName = toTitleCase(pt.stopName);
            const isMinor = ratio < LABEL_VOLUME_THRESHOLD;
            const dir = pickDirection(pt.lat, pt.lon);
            // In dot mode, include journey count in label for non-minor points
            const labelText = !showBars && !isMinor
                ? `${displayName}  <span style="font-weight:800;color:#475569">${fmt(pt.totalJourneys)}</span>`
                : displayName;
            const dotRadius = 6 + Math.round(ratio * 18);
            const labelOffset = showBars
                ? (dir === 'top' ? [0, -bHeight - 14] : dir === 'bottom' ? [0, 8] : [14, -bHeight / 2])
                : (dir === 'top' ? [0, -(dotRadius + 4)] : dir === 'bottom' ? [0, dotRadius + 4] : [dotRadius + 6, 0]);
            marker.bindTooltip(labelText, {
                permanent: !isMinor,
                direction: dir,
                className: isMinor ? 'transfer-label-minor' : 'transfer-label',
                offset: labelOffset as L.PointExpression,
            });

            const routeList = pt.connectingRoutes.length > 0
                ? pt.connectingRoutes.map(r => `<li style="font-size:11px;color:#374151">${r}</li>`).join('')
                : '<li style="font-size:11px;color:#9ca3af;font-style:italic">Unknown</li>';
            marker.bindPopup(
                `<div style="min-width:180px"><div style="font-weight:700;font-size:13px;color:#1e293b;margin-bottom:4px">${displayName}</div>` +
                `<div style="font-size:11px;color:#64748b;margin-bottom:6px">${fmt(pt.totalJourneys)} journeys · ${pt.pairCount} pair${pt.pairCount === 1 ? '' : 's'}</div>` +
                `<div style="font-size:10px;font-weight:600;color:#7c3aed;text-transform:uppercase;margin-bottom:2px">Connecting Routes</div>` +
                `<ul style="margin:0;padding-left:14px">${routeList}</ul></div>`, { maxWidth: 260 },
            );
            bounds.extend([pt.lat, pt.lon]);
        }

        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 9 });

        return () => { map.remove(); leafletMapRef.current = null; };
    }, [displayedTransferPoints, showBars]);

    // ── Loading state ───────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                <Loader2 size={32} className="mb-3 animate-spin text-violet-400" />
                <p className="text-sm text-slate-500">Loading Ontario Northland GTFS...</p>
            </div>
        );
    }

    if (!result && error) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <XCircle size={16} /> {error}
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
            {/* ── GTFS Source Bar ─────────────────────────────────── */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    <span>GTFS: <span className="font-semibold text-slate-700">{fileName}</span></span>
                </div>
                <div className="relative">
                    <input ref={fileInputRef} type="file" accept=".zip" onChange={handleUpdateGtfs} className="hidden" />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={updating}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-all duration-150"
                    >
                        {updating ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        {updating ? 'Processing...' : 'Update GTFS'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <XCircle size={16} /> {error}
                </div>
            )}

            {/* ── KPI Strip ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-emerald-500">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0"><CheckCircle2 size={18} /></div>
                        <div className="min-w-0">
                            <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">{fmt(result.totalMatched)}</p>
                            <p className="text-sm text-slate-500">Matched Pairs</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">of {fmt(result.totalMatched + result.totalUnmatched)} total</p>
                        </div>
                    </div>
                </div>

                <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] ${result.totalUnmatched > 0 ? 'border-l-red-500' : 'border-l-emerald-500'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg shrink-0 ${result.totalUnmatched > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}><XCircle size={18} /></div>
                        <div className="min-w-0">
                            <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">{fmt(result.totalUnmatched)}</p>
                            <p className="text-sm text-slate-500">Unmatched Pairs</p>
                            {result.totalUnmatched > 0 && (
                                <p className="text-[10px] text-slate-400 mt-0.5">{fmt(result.unmatchedRoutePairs ?? 0)} no route · {fmt(result.unmatchedStationPairs ?? 0)} no station</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-cyan-500">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600 shrink-0"><Route size={18} /></div>
                        <div className="min-w-0">
                            <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">{matchedPct}%</p>
                            <p className="text-sm text-slate-500">Matched Journeys</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{fmt(result.matchedJourneys)} of {fmt(result.totalJourneys)}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-indigo-500">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0"><Layers size={18} /></div>
                        <div className="min-w-0">
                            <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">{result.routeDistribution.length}</p>
                            <p className="text-sm text-slate-500">Routes Found</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Pair Route Assignments ──────────────────────────── */}
            <div className="order-2">
                <SectionCard
                    title="Pair Route Assignments"
                    subtitle={`${filteredMatches.length} pairs shown`}
                    headerExtra={
                        <div className="flex items-center gap-2">
                            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                {(['all', 'high', 'medium', 'low', 'none'] as const).map(opt => (
                                    <SegBtn key={opt} active={confidenceFilter === opt} onClick={() => setConfidenceFilter(opt)}>
                                        {opt === 'all' ? 'All' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                                    </SegBtn>
                                ))}
                            </div>
                            <div className="relative">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
                                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent w-40 transition-all duration-150"
                                />
                            </div>
                        </div>
                    }
                    noPadding
                >
                    <div className="mx-5 mt-4 mb-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs text-slate-600">
                        <p className="font-semibold text-slate-700">Assignment logic summary</p>
                        <p className="mt-1">
                            1) Station names are normalized and alias-matched to GTFS stops.
                            2) Direct routes are checked first (origin must appear before destination in route stop order).
                            3) If multiple direct routes match, the shortest-stop path is selected.
                            4) If no direct route matches, transfer paths up to 4 legs are evaluated and ranked by fewest legs, then hub preference, then fewer stops.
                            5) Confidence reflects uniqueness: single clear winner = higher confidence; multiple plausible options = lower confidence.
                        </p>
                    </div>
                    <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: `${PAIR_TABLE_HEIGHT_PX}px` }} onScroll={handlePairTableScroll}>
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm z-10">
                                <tr className="border-b border-slate-200">
                                    <th className="w-10 py-2.5 px-2"></th>
                                    {([
                                        ['origin', 'text-left', 'Origin', ''],
                                        ['destination', 'text-left', 'Destination', ''],
                                        [null, 'text-right', 'Journeys', 'w-24'],
                                        ['route', 'text-left', 'Route', ''],
                                        [null, 'text-left', 'Via', ''],
                                        ['stops', 'text-right', 'Stops', 'w-16'],
                                        ['confidence', 'text-left', 'Confidence', 'w-24'],
                                        ['why', 'text-left', 'Why', 'min-w-[260px]'],
                                    ] as const).map(([col, align, label, extra]) => {
                                        const sortable = col !== null;
                                        const active = pairSortCol === col;
                                        return (
                                            <th
                                                key={label}
                                                className={`${align} py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider ${extra} ${sortable ? 'cursor-pointer select-none hover:text-slate-700' : ''} ${active ? 'text-slate-800' : 'text-slate-500'}`}
                                                onClick={sortable ? () => handlePairSort(col) : undefined}
                                            >
                                                <span className="inline-flex items-center gap-0.5">
                                                    {label}
                                                    {sortable && active && (pairSortDir === 'asc' ? <ChevronUp size={14} className="text-violet-500" /> : <ChevronDown size={14} className="text-violet-500" />)}
                                                </span>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {pairWindow.topSpacerPx > 0 && <tr aria-hidden="true"><td colSpan={9} style={{ height: `${pairWindow.topSpacerPx}px`, padding: 0, border: 0 }} /></tr>}
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
                                        <tr key={`${m.origin}-${m.destination}-${rowIndex}`} className={`h-11 border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${rowIndex % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                            <td className="py-2 px-2 text-center">
                                                <button onClick={() => setSelectedPair(m)} className="p-1 rounded hover:bg-violet-50 text-slate-400 hover:text-violet-500 transition-all duration-150" title="View journey map">
                                                    <MapPin size={16} />
                                                </button>
                                            </td>
                                            <td className="py-2 px-3 text-xs text-slate-700"><span className="block truncate max-w-[180px]" title={m.origin}>{m.origin}</span></td>
                                            <td className="py-2 px-3 text-xs text-slate-700"><span className="block truncate max-w-[180px]" title={m.destination}>{m.destination}</span></td>
                                            <td className="py-2 px-3 text-right font-bold text-slate-900 tabular-nums">{fmt(m.journeys)}</td>
                                            <td className="py-2 px-3 text-xs text-slate-700">
                                                {m.transfer ? (
                                                    <span className="block truncate max-w-[260px]" title={m.routeLongName || ''}>{transferRouteNames.join(' → ')}</span>
                                                ) : m.routeLongName ? (
                                                    <span className="block truncate max-w-[260px]" title={m.routeId || ''}>{m.routeLongName}</span>
                                                ) : (
                                                    <span className="text-slate-400 italic">—</span>
                                                )}
                                            </td>
                                            <td className="py-2 px-3 text-xs text-slate-600">
                                                {m.transfer ? (
                                                    <span className="inline-flex max-w-[220px] items-center gap-1 truncate px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded text-[11px] font-medium" title={transferStops.join(' → ')}>
                                                        {transferStops.join(' → ')}
                                                    </span>
                                                ) : <span className="text-slate-400">—</span>}
                                            </td>
                                            <td className="py-2 px-3 text-right text-xs text-slate-500 tabular-nums">{m.confidence !== 'none' ? m.intermediateStops : '—'}</td>
                                            <td className="py-2 px-3">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ${CONFIDENCE_COLORS[m.confidence]}`}>
                                                    {m.confidence === 'high' && <CheckCircle2 size={11} />}
                                                    {m.confidence === 'medium' && <AlertTriangle size={11} />}
                                                    {m.confidence === 'low' && <AlertTriangle size={11} />}
                                                    {m.confidence === 'none' && <XCircle size={11} />}
                                                    {m.confidence}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-xs text-slate-600" title={whyDetail}>
                                                <span className="block truncate max-w-[360px]">{why}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {pairWindow.bottomSpacerPx > 0 && <tr aria-hidden="true"><td colSpan={9} style={{ height: `${pairWindow.bottomSpacerPx}px`, padding: 0, border: 0 }} /></tr>}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            </div>

            {/* ── Route Distribution Chart ────────────────────────── */}
            <div className="order-3">
                {chartData.length > 0 && (
                    <SectionCard title="Route Distribution" subtitle="Estimated passenger journeys per GTFS route" accentColor="#7c3aed">
                        <div style={{ height: Math.max(200, chartData.length * 50) }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                                    <YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 12 }} />
                                    <Tooltip
                                        formatter={(value: number) => [fmt(value), 'Journeys']}
                                        labelFormatter={(_: string, payload) => { const item = payload?.[0]?.payload; return item?.fullLabel || ''; }}
                                    />
                                    <Bar dataKey="journeys" radius={[0, 4, 4, 0]}>
                                        {chartData.map((_entry, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </SectionCard>
                )}
            </div>

            {/* ── Transfer Point Heatmap ──────────────────────────── */}
            {transferPoints.length > 0 && (
                <div className="order-[3]">
                    <SectionCard
                        title="Transfer Point Heatmap"
                        subtitle={`${transferPoints.length} transfer point${transferPoints.length === 1 ? '' : 's'}${transferPoints.length > 10 ? ` (showing ${displayedTransferPoints.length})` : ' (showing all)'} · ${fmt(displayedTransferPoints.reduce((s, p) => s + p.totalJourneys, 0))} journeys`}
                        accentColor="#06b6d4"
                        headerExtra={
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowBars(v => !v)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-150 ${
                                        showBars
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
                                    }`}
                                    title={showBars ? 'Hide 3D bars' : 'Show 3D bars'}
                                >
                                    <BarChart3 size={13} />
                                    3D Bars
                                </button>
                                {transferPoints.length > 10 && (
                                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                        {([10, 20, 50, 100, 'all'] as const)
                                            .filter(opt => opt === 'all' || opt < transferPoints.length)
                                            .map(opt => (
                                                <SegBtn key={String(opt)} active={transferTopN === opt} onClick={() => setTransferTopN(opt)}>
                                                    {opt === 'all' ? `All (${transferPoints.length})` : `Top ${opt}`}
                                                </SegBtn>
                                            ))}
                                    </div>
                                )}
                            </div>
                        }
                    >
                        <div className="relative">
                            <div ref={transferMapRef} style={{ height: `${TRANSFER_MAP_HEIGHT_PX}px` }} className="rounded-lg shadow-inner" />
                            {/* Floating legend overlay */}
                            <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg shadow-md border border-slate-200/60 px-3 py-2.5 flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-20 h-3 rounded-full" style={{ background: 'linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)' }} />
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-semibold text-slate-600 leading-tight">Volume</span>
                                        <span className="text-[9px] text-slate-400 leading-tight">Low → High</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 overflow-x-auto overflow-y-auto border-t border-slate-100" style={{ maxHeight: '260px' }}>
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm">
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-2.5 px-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wider w-12">Rank</th>
                                        <th className="text-left py-2.5 px-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Transfer Point</th>
                                        <th className="text-right py-2.5 px-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wider w-24">Journeys</th>
                                        <th className="text-right py-2.5 px-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wider w-16">Pairs</th>
                                        <th className="text-left py-2.5 px-3 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Connecting Routes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayedTransferPoints.map((pt, i) => (
                                        <tr key={pt.stopName} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                            <td className="py-1.5 px-3 text-xs text-slate-400 font-medium tabular-nums">{i + 1}</td>
                                            <td className="py-1.5 px-3 text-xs text-slate-800 font-semibold">{pt.stopName}</td>
                                            <td className="py-1.5 px-3 text-right text-xs font-bold text-slate-900 tabular-nums">{fmt(pt.totalJourneys)}</td>
                                            <td className="py-1.5 px-3 text-right text-xs text-slate-500 tabular-nums">{pt.pairCount}</td>
                                            <td className="py-1.5 px-3 text-xs text-slate-600">
                                                <span className="block truncate max-w-[300px]" title={pt.connectingRoutes.join(', ')}>{pt.connectingRoutes.join(', ') || '—'}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </SectionCard>
                </div>
            )}

            {/* ── Station Match Report ────────────────────────────── */}
            <div className="order-4">
                <SectionCard
                    title="Station Match Report"
                    subtitle={`${result.stationMatchReport.filter(s => s.matchType !== 'unmatched').length} of ${result.stationMatchReport.length} stations matched`}
                    noPadding
                >
                    <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: `${STATION_TABLE_HEIGHT_PX}px` }} onScroll={handleStationTableScroll}>
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm">
                                <tr className="border-b border-slate-200">
                                    <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">OD Station</th>
                                    <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">GTFS Stop</th>
                                    <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider w-28">Match Type</th>
                                    <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider min-w-[260px]">Why</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stationWindow.topSpacerPx > 0 && <tr aria-hidden="true"><td colSpan={4} style={{ height: `${stationWindow.topSpacerPx}px`, padding: 0, border: 0 }} /></tr>}
                                {stationWindow.rows.map((s, i) => {
                                    const rowIndex = stationWindow.start + i;
                                    return (
                                        <tr
                                            key={`${s.odName}-${rowIndex}`}
                                            className={`h-10 border-b border-slate-50 transition-colors ${s.matchType === 'unmatched' ? 'bg-red-50/30' : 'hover:bg-slate-50/50'} ${rowIndex % 2 === 1 ? 'bg-slate-25' : ''}`}
                                        >
                                            <td className="py-2 px-4 text-xs text-slate-700 font-medium">
                                                <span className="block truncate max-w-[220px]" title={s.odName}>{s.odName}</span>
                                            </td>
                                            <td className="py-2 px-4 text-xs text-slate-600">
                                                {s.gtfsStopName
                                                    ? <span className="block truncate max-w-[220px]" title={s.gtfsStopName}>{s.gtfsStopName}</span>
                                                    : <span className="text-red-400 italic">No match</span>}
                                            </td>
                                            <td className="py-2 px-4">
                                                <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full ${MATCH_TYPE_COLORS[s.matchType]}`}>
                                                    {s.matchType}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4 text-xs text-slate-600">
                                                <span className="block truncate max-w-[520px]" title={stationMatchExplanation(s)}>{stationMatchExplanation(s)}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {stationWindow.bottomSpacerPx > 0 && <tr aria-hidden="true"><td colSpan={4} style={{ height: `${stationWindow.bottomSpacerPx}px`, padding: 0, border: 0 }} /></tr>}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            </div>

            {selectedPair && (
                <ODPairMapModal pair={selectedPair} geocodeCache={geocodeCache} onClose={() => setSelectedPair(null)} />
            )}
        </div>
    );
};
