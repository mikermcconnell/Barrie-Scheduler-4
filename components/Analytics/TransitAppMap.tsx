/**
 * Transit App Map
 *
 * Leaflet map with two toggleable layers:
 * 1. Location heatmap (circle markers, green→yellow→red by log count)
 * 2. OD desire lines (curved arcs between origin-destination zone centroids)
 *
 * Features:
 * - Named zones via nearest GTFS stop lookup
 * - Rank-based color/width scaling
 * - Min-count threshold + top-N sliders
 * - Distance bands filter (short/medium/long)
 * - Time-of-day filter (AM/Midday/PM/Evening)
 * - Weekday/weekend filter
 * - Route corridor filter (1km buffer around GTFS shape)
 * - Click-to-isolate spider mode
 * - Click pair detail popup with zone names
 * - Bidirectional pair merging
 * - GTFS route overlay
 * - Collapsible OD summary table
 * - PDF export via jsPDF + autoTable
 *
 * Uses raw Leaflet via useRef/useEffect (no react-leaflet) for React 19 compat.
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import type { LocationGridCell, ODPairData, ODPair, StopCoverageGapCluster } from '../../utils/transit-app/transitAppTypes';
import { loadGtfsRouteShapes, pointToPolylineDistanceKm } from '../../utils/gtfs/gtfsShapesLoader';
import { findNearestStopName, getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { formatTimeBand, formatDayType, formatSeason } from './AnalyticsShared';

interface TransitAppMapProps {
    locationDensity: {
        cells: LocationGridCell[];
        bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
        totalPoints: number;
    };
    odPairs?: ODPairData;
    height?: number;
    defaultLayer?: MapLayer;
    seasonFilter?: SeasonFilter;
    onSeasonFilterChange?: (filter: SeasonFilter) => void;
    onDisplayedODPairsChange?: (pairs: ODPair[]) => void;
    coverageGapClusters?: StopCoverageGapCluster[];
}

type MapLayer = 'heatmap' | 'od';
type GeoFilter = 'barrie' | 'all';
type DistanceBand = 'all' | 'short' | 'medium' | 'long';
type TimePeriod = 'all' | 'am' | 'midday' | 'pm' | 'evening';
type DayFilter = 'all' | 'weekday' | 'weekend';
type ODPlannerView = 'map' | 'matrix';
type AllZonesRenderMode = 'focused' | 'overview' | 'corridor' | 'detail';
export type SeasonFilter = 'all' | 'jan' | 'jul' | 'sep' | 'other';



// Merged pair extends ODPair with bidirectional info
interface MergedODPair extends ODPair {
    reverseCount: number;
    netDirection: 'AB' | 'BA' | 'balanced';
    isMerged: boolean;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];
const BARRIE_BOUNDS = { minLat: 44.28, maxLat: 44.48, minLon: -79.80, maxLon: -79.58 };
// Tighter view bounds for fitBounds — urban core only
const BARRIE_VIEW_BOUNDS = { minLat: 44.34, maxLat: 44.42, minLon: -79.73, maxLon: -79.64 };
const SMOOTH_MAP_OPTIONS: Partial<L.MapOptions> = {
    // Fractional zoom + reduced wheel sensitivity makes trackpad/mouse-wheel zoom feel less jumpy.
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    scrollWheelZoom: 'center',
    wheelDebounceTime: 24,
    wheelPxPerZoomLevel: 120,
    preferCanvas: true,
};

function isInBarrie(lat: number, lon: number): boolean {
    return lat >= BARRIE_BOUNDS.minLat && lat <= BARRIE_BOUNDS.maxLat
        && lon >= BARRIE_BOUNDS.minLon && lon <= BARRIE_BOUNDS.maxLon;
}

function heatColor(t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    const stops: Array<{ t: number; rgb: [number, number, number] }> = [
        { t: 0.00, rgb: [37, 52, 148] },   // deep indigo
        { t: 0.25, rgb: [14, 116, 255] },  // vivid blue
        { t: 0.50, rgb: [6, 182, 212] },   // cyan
        { t: 0.70, rgb: [250, 204, 21] },  // yellow
        { t: 0.85, rgb: [249, 115, 22] },  // orange
        { t: 1.00, rgb: [220, 38, 38] },   // red
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (clamped >= a.t && clamped <= b.t) {
            const local = (clamped - a.t) / Math.max(0.0001, (b.t - a.t));
            const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * local);
            const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * local);
            const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * local);
            return `rgb(${r},${g},${bl})`;
        }
    }
    const last = stops[stops.length - 1].rgb;
    return `rgb(${last[0]},${last[1]},${last[2]})`;
}

// Rank-based colors: 1-7 get distinct vivid colors, 8+ get dark→light grey
const TOP_RANK_COLORS = [
    '#dc2626', // 1 - Red
    '#ea580c', // 2 - Red-orange
    '#f97316', // 3 - Orange
    '#eab308', // 4 - Amber
    '#84cc16', // 5 - Yellow-green
    '#22c55e', // 6 - Green
    '#16a34a', // 7 - Dark green
];
const OVERVIEW_ZOOM_MAX = 11.75;
const CORRIDOR_ZOOM_MAX = 13.25;
const CORRIDOR_MAX_ARCS = 140;
const DETAIL_MAX_ARCS = 260;
const MATRIX_PAGE_SIZE = 40;

function rankColor(rank: number): string {
    if (rank < TOP_RANK_COLORS.length) return TOP_RANK_COLORS[rank];
    // Ranks 8+: dark grey → light grey
    const greyRank = rank - TOP_RANK_COLORS.length;
    const t = Math.min(greyRank / 18, 1);
    const r = Math.round(55 + t * 101);
    const g = Math.round(65 + t * 98);
    const b = Math.round(81 + t * 94);
    return `rgb(${r},${g},${b})`;
}

function rankWeight(rank: number): number {
    if (rank < TOP_RANK_COLORS.length) return 12 - rank; // 12 down to 6
    const t = Math.min((rank - TOP_RANK_COLORS.length) / 18, 1);
    return 5 - t * 3; // 5 down to 2
}

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Describe a lat/lon as a human-readable location relative to Barrie centre */
export function describeLocationRelativeToBarrie(lat: number, lon: number): string {
    const dist = haversineKm(BARRIE_CENTER[0], BARRIE_CENTER[1], lat, lon);
    const dLat = lat - BARRIE_CENTER[0];
    const dLon = lon - BARRIE_CENTER[1];
    const angle = Math.atan2(dLon, dLat) * 180 / Math.PI;
    let dir: string;
    if (angle >= -22.5 && angle < 22.5) dir = 'N';
    else if (angle >= 22.5 && angle < 67.5) dir = 'NE';
    else if (angle >= 67.5 && angle < 112.5) dir = 'E';
    else if (angle >= 112.5 && angle < 157.5) dir = 'SE';
    else if (angle >= 157.5 || angle < -157.5) dir = 'S';
    else if (angle >= -157.5 && angle < -112.5) dir = 'SW';
    else if (angle >= -112.5 && angle < -67.5) dir = 'W';
    else dir = 'NW';

    if (dist < 1) return 'Central Barrie';
    if (isInBarrie(lat, lon)) return `${dir} Barrie`;
    return `${dist.toFixed(0)}km ${dir} of Barrie`;
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

// Time period hour ranges
const TIME_RANGES: Record<TimePeriod, [number, number]> = {
    all: [0, 24],
    am: [6, 9],
    midday: [9, 15],
    pm: [15, 19],
    evening: [19, 6], // wraps around midnight
};

function getCountForTimePeriod(pair: ODPair, period: TimePeriod): number {
    if (period === 'all' || !pair.hourlyBins) return pair.count;
    const [start, end] = TIME_RANGES[period];
    let sum = 0;
    if (start < end) {
        for (let h = start; h < end; h++) sum += pair.hourlyBins[h];
    } else {
        // Evening wraps: 19-23 + 0-5
        for (let h = start; h < 24; h++) sum += pair.hourlyBins[h];
        for (let h = 0; h < end; h++) sum += pair.hourlyBins[h];
    }
    return sum;
}

function getCountForFilters(
    pair: ODPair,
    timePeriod: TimePeriod,
    dayFilter: DayFilter,
    seasonFilter: SeasonFilter
): number {
    if (pair.odFilterBins && (timePeriod !== 'all' || dayFilter !== 'all' || seasonFilter !== 'all')) {
        const days: Array<'weekday' | 'saturday' | 'sunday'> =
            dayFilter === 'weekday'
                ? ['weekday']
                : dayFilter === 'weekend'
                    ? ['saturday', 'sunday']
                    : ['weekday', 'saturday', 'sunday'];

        const seasons: Array<'jan' | 'jul' | 'sep' | 'other'> =
            seasonFilter === 'all'
                ? ['jan', 'jul', 'sep', 'other']
                : [seasonFilter];

        const [start, end] = TIME_RANGES[timePeriod];
        const hours: number[] = [];
        if (timePeriod === 'all') {
            for (let h = 0; h < 24; h++) hours.push(h);
        } else if (start < end) {
            for (let h = start; h < end; h++) hours.push(h);
        } else {
            for (let h = start; h < 24; h++) hours.push(h);
            for (let h = 0; h < end; h++) hours.push(h);
        }

        let exact = 0;
        for (const day of days) {
            for (const season of seasons) {
                for (const hour of hours) {
                    exact += pair.odFilterBins[`${day}|${season}|${hour}`] || 0;
                }
            }
        }
        return exact;
    }

    const activeCounts: number[] = [];
    if (timePeriod !== 'all') {
        activeCounts.push(getCountForTimePeriod(pair, timePeriod));
    }

    if (dayFilter !== 'all') {
        const dayCount = dayFilter === 'weekday' ? pair.weekdayCount : pair.weekendCount;
        if (typeof dayCount === 'number') activeCounts.push(dayCount);
    }

    if (seasonFilter !== 'all') {
        const seasonCount = pair.seasonBins?.[seasonFilter];
        if (typeof seasonCount === 'number') activeCounts.push(seasonCount);
    }

    if (activeCounts.length === 0) return pair.count;
    // We do not have cross-tab data (time x day x season), so use a conservative
    // intersection proxy: the minimum count across active dimensions.
    return Math.min(pair.count, ...activeCounts);
}

function coordKey(lat: number, lon: number): string {
    return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

export const TransitAppMap: React.FC<TransitAppMapProps> = ({
    locationDensity,
    odPairs,
    height = 480,
    defaultLayer,
    seasonFilter: externalSeasonFilter,
    onSeasonFilterChange,
    onDisplayedODPairsChange,
    coverageGapClusters,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const heatmapLayerRef = useRef<L.LayerGroup | null>(null);
    const odLayerRef = useRef<L.LayerGroup | null>(null);
    const routeLayerRef = useRef<L.LayerGroup | null>(null);
    const stopLayerRef = useRef<L.LayerGroup | null>(null);
    const coverageLayerRef = useRef<L.LayerGroup | null>(null);
    const odLineGroupsRef = useRef<{ lines: L.Path[]; pair: MergedODPair; origOpacity: number }[]>([]);
    const lastFitTriggerRef = useRef<{
        activeLayer: MapLayer;
        geoFilter: GeoFilter;
        odPairsRef?: ODPairData;
        locationBoundsRef: TransitAppMapProps['locationDensity']['bounds'];
    } | null>(null);
    const prevMapViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null);

    const hasODData = Boolean(odPairs && odPairs.pairs.length > 0);
    const resolvedDefaultLayer: MapLayer =
        defaultLayer === 'od' && !hasODData
            ? 'heatmap'
            : (defaultLayer ?? (hasODData ? 'od' : 'heatmap'));

    // Existing state
    const [activeLayer, setActiveLayer] = useState<MapLayer>(resolvedDefaultLayer);
    const [plannerView, setPlannerView] = useState<ODPlannerView>('map');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [topN, setTopN] = useState(20);
    const [allZonesMode, setAllZonesMode] = useState(false);
    const [mapZoom, setMapZoom] = useState(13);
    const [geoFilter, setGeoFilter] = useState<GeoFilter>('barrie');

    // New state for features 3-12
    const [minCount, setMinCount] = useState(1);
    const [distanceBand, setDistanceBand] = useState<DistanceBand>('all');
    const [isolatedZone, setIsolatedZone] = useState<string | null>(null);
    const [zonePanelTopN, setZonePanelTopN] = useState<10 | 20>(10);
    const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');
    const [mergeBidirectional, setMergeBidirectional] = useState(false);
    const [dayFilter, setDayFilter] = useState<DayFilter>('all');
    const [showRoutes, setShowRoutes] = useState(false);
    const [showStops, setShowStops] = useState(false);
    const [corridorRoute, setCorridorRoute] = useState<string | null>(null);
    const [showTable, setShowTable] = useState(false);
    const [highlightedPairIdx, setHighlightedPairIdx] = useState<number | null>(null);
    const [sortColumn, setSortColumn] = useState<'rank' | 'trips' | 'dist' | 'origin' | 'dest'>('rank');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [matrixSearch, setMatrixSearch] = useState('');
    const [matrixPage, setMatrixPage] = useState(1);
    const [localSeasonFilter, setLocalSeasonFilter] = useState<SeasonFilter>('all');
    const seasonFilter = externalSeasonFilter ?? localSeasonFilter;
    const setSeasonFilter = (v: SeasonFilter) => {
        setLocalSeasonFilter(v);
        onSeasonFilterChange?.(v);
    };

    // Feature 2: Unified filter pipeline via useMemo
    const filteredPairs = useMemo((): MergedODPair[] => {
        if (!odPairs || odPairs.pairs.length === 0) return [];

        // Step 1: Geo filter
        let filtered = geoFilter === 'barrie'
            ? odPairs.pairs.filter(p =>
                isInBarrie(p.originLat, p.originLon) && isInBarrie(p.destLat, p.destLon))
            : [...odPairs.pairs];

        // Step 2: Apply time/day/season filters together with conservative count intersection.
        filtered = filtered
            .map(p => ({
                ...p,
                count: getCountForFilters(p, timePeriod, dayFilter, seasonFilter),
            }))
            .filter(p => p.count > 0);

        // Step 3: Min count threshold
        filtered = filtered.filter(p => p.count >= minCount);

        // Step 4: Distance band filter
        if (distanceBand !== 'all') {
            filtered = filtered.filter(p => {
                const km = haversineKm(p.originLat, p.originLon, p.destLat, p.destLon);
                if (distanceBand === 'short') return km < 3;
                if (distanceBand === 'medium') return km >= 3 && km < 10;
                return km >= 10; // long
            });
        }

        // Step 4b: Route corridor filter
        if (corridorRoute) {
            try {
                const shapes = loadGtfsRouteShapes();
                const matchShape = shapes.find(s => s.routeShortName === corridorRoute);
                if (matchShape && matchShape.points.length > 0) {
                    const BUFFER_KM = 1.0;
                    filtered = filtered.filter(p => {
                        const oDist = pointToPolylineDistanceKm([p.originLat, p.originLon], matchShape.points);
                        const dDist = pointToPolylineDistanceKm([p.destLat, p.destLon], matchShape.points);
                        return oDist <= BUFFER_KM && dDist <= BUFFER_KM;
                    });
                }
            } catch { /* shapes not available */ }
        }

        // Step 5: Re-sort by count desc
        filtered.sort((a, b) => b.count - a.count);

        // Step 6: Bidirectional merge (optional)
        let merged: MergedODPair[];
        if (mergeBidirectional) {
            const mergeMap = new Map<string, MergedODPair>();
            for (const p of filtered) {
                // Canonical key: alphabetically smaller coord pair first
                const keyAB = `${p.originLat.toFixed(4)}_${p.originLon.toFixed(4)}|${p.destLat.toFixed(4)}_${p.destLon.toFixed(4)}`;
                const keyBA = `${p.destLat.toFixed(4)}_${p.destLon.toFixed(4)}|${p.originLat.toFixed(4)}_${p.originLon.toFixed(4)}`;
                const canonical = keyAB < keyBA ? keyAB : keyBA;
                const isForward = keyAB <= keyBA;

                const existing = mergeMap.get(canonical);
                if (existing) {
                    if (isForward) {
                        existing.count += p.count;
                    } else {
                        existing.reverseCount += p.count;
                    }
                    // Recalc net direction
                    const diff = existing.count - existing.reverseCount;
                    existing.netDirection = Math.abs(diff) < Math.max(existing.count, existing.reverseCount) * 0.2
                        ? 'balanced' : diff > 0 ? 'AB' : 'BA';
                } else {
                    mergeMap.set(canonical, {
                        originLat: isForward ? p.originLat : p.destLat,
                        originLon: isForward ? p.originLon : p.destLon,
                        destLat: isForward ? p.destLat : p.originLat,
                        destLon: isForward ? p.destLon : p.originLon,
                        count: isForward ? p.count : 0,
                        reverseCount: isForward ? 0 : p.count,
                        netDirection: 'AB',
                        isMerged: true,
                        hourlyBins: p.hourlyBins,
                    });
                }
            }
            merged = Array.from(mergeMap.values()).map(m => ({
                ...m,
                count: m.count + m.reverseCount, // total for display
            }));
            merged.sort((a, b) => b.count - a.count);
        } else {
            merged = filtered.map(p => ({
                ...p,
                reverseCount: 0,
                netDirection: 'AB' as const,
                isMerged: false,
            }));
        }

        // Step 7: Isolated zone filter
        if (isolatedZone) {
            merged = merged.filter(p => {
                const oKey = `${p.originLat.toFixed(4)}_${p.originLon.toFixed(4)}`;
                const dKey = `${p.destLat.toFixed(4)}_${p.destLon.toFixed(4)}`;
                return oKey === isolatedZone || dKey === isolatedZone;
            });
        }

        return merged;
    }, [odPairs, geoFilter, timePeriod, dayFilter, seasonFilter, minCount, distanceBand, corridorRoute, mergeBidirectional, isolatedZone]);

    const displayedPairs = useMemo(
        () => allZonesMode ? filteredPairs : filteredPairs.slice(0, topN),
        [allZonesMode, filteredPairs, topN]
    );

    const allZonesRenderMode = useMemo((): AllZonesRenderMode => {
        if (!allZonesMode) return 'focused';
        if (mapZoom <= OVERVIEW_ZOOM_MAX) return 'overview';
        if (mapZoom <= CORRIDOR_ZOOM_MAX) return 'corridor';
        return 'detail';
    }, [allZonesMode, mapZoom]);

    // Feature 4: Summary stats
    const stats = useMemo(() => {
        if (!odPairs) return null;
        const totalTrips = displayedPairs.reduce((sum, p) => sum + p.count, 0);
        const pctOfTotal = odPairs.totalTripsProcessed > 0
            ? ((totalTrips / odPairs.totalTripsProcessed) * 100).toFixed(1)
            : '0';
        return {
            pairs: displayedPairs.length,
            totalFilteredPairs: filteredPairs.length,
            trips: totalTrips,
            pct: pctOfTotal,
        };
    }, [displayedPairs, filteredPairs.length, odPairs]);

    useEffect(() => {
        onDisplayedODPairsChange?.(displayedPairs);
    }, [displayedPairs, onDisplayedODPairsChange]);

    // Auto-zoom to zone extents when zone is selected
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (isolatedZone) {
            if (!prevMapViewRef.current) {
                prevMapViewRef.current = { center: map.getCenter(), zoom: map.getZoom() };
            }
            if (displayedPairs.length > 0) {
                const points: L.LatLngExpression[] = [];
                for (const pair of displayedPairs) {
                    points.push([pair.originLat, pair.originLon]);
                    points.push([pair.destLat, pair.destLon]);
                }
                const bounds = L.latLngBounds(points);
                map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [340, 50], maxZoom: 15 });
            }
        } else {
            if (prevMapViewRef.current) {
                map.setView(prevMapViewRef.current.center, prevMapViewRef.current.zoom, { animate: true });
                prevMapViewRef.current = null;
            }
        }
    }, [isolatedZone, displayedPairs]);

    // Invalidate map size when zone panel opens/closes (flex layout changes)
    useEffect(() => {
        setTimeout(() => mapRef.current?.invalidateSize(), 100);
    }, [isolatedZone]);

    const zoneNameCache = useMemo(() => {
        const cache = new Map<string, string>();
        if (!displayedPairs.length) return cache;
        for (const pair of displayedPairs) {
            for (const [lat, lon] of [
                [pair.originLat, pair.originLon],
                [pair.destLat, pair.destLon],
            ]) {
                const key = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
                if (cache.has(key)) continue;
                const name = findNearestStopName(lat, lon, 0.5);
                cache.set(key, name ?? describeLocationRelativeToBarrie(lat, lon));
            }
        }
        return cache;
    }, [displayedPairs]);

    const getZoneName = useCallback((lat: number, lon: number): string => {
        const key = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
        return zoneNameCache.get(key) ?? describeLocationRelativeToBarrie(lat, lon);
    }, [zoneNameCache]);

    // Zone detail panel data
    const zonePanelData = useMemo(() => {
        if (!isolatedZone || displayedPairs.length === 0) return null;

        const [latStr, lonStr] = isolatedZone.split('_');
        const zoneLat = parseFloat(latStr);
        const zoneLon = parseFloat(lonStr);
        const zoneName = getZoneName(zoneLat, zoneLon);

        let totalTrips = 0;
        const connectionSet = new Set<string>();
        let totalDistKm = 0;
        const hourlyTotals = new Array(24).fill(0);
        let hasHourly = false;

        interface FlowEntry {
            name: string;
            lat: number;
            lon: number;
            outbound: number;
            inbound: number;
            total: number;
            distKm: number;
        }
        const flowMap = new Map<string, FlowEntry>();

        for (const pair of displayedPairs) {
            const oKey = coordKey(pair.originLat, pair.originLon);
            const dKey = coordKey(pair.destLat, pair.destLon);
            const isOrigin = oKey === isolatedZone;
            const otherKey = isOrigin ? dKey : oKey;
            const otherLat = isOrigin ? pair.destLat : pair.originLat;
            const otherLon = isOrigin ? pair.destLon : pair.originLon;

            totalTrips += pair.count;
            connectionSet.add(otherKey);

            const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
            totalDistKm += distKm * pair.count;

            if (pair.hourlyBins) {
                hasHourly = true;
                for (let h = 0; h < 24; h++) hourlyTotals[h] += pair.hourlyBins[h];
            }

            const existing = flowMap.get(otherKey);
            if (existing) {
                if (isOrigin) existing.outbound += pair.count;
                else existing.inbound += pair.count;
                existing.total += pair.count;
            } else {
                flowMap.set(otherKey, {
                    name: getZoneName(otherLat, otherLon),
                    lat: otherLat,
                    lon: otherLon,
                    outbound: isOrigin ? pair.count : 0,
                    inbound: isOrigin ? 0 : pair.count,
                    total: pair.count,
                    distKm,
                });
            }
        }

        const flows = Array.from(flowMap.values()).sort((a, b) => b.total - a.total);
        const avgDistKm = totalTrips > 0 ? totalDistKm / totalTrips : 0;

        let peakPeriod: string | null = null;
        if (hasHourly) {
            const maxHour = hourlyTotals.indexOf(Math.max(...hourlyTotals));
            if (maxHour >= 6 && maxHour < 9) peakPeriod = 'AM Peak';
            else if (maxHour >= 9 && maxHour < 15) peakPeriod = 'Midday';
            else if (maxHour >= 15 && maxHour < 19) peakPeriod = 'PM Peak';
            else peakPeriod = 'Evening';
        }

        return {
            zoneName,
            zoneLat,
            zoneLon,
            totalTrips,
            uniqueConnections: connectionSet.size,
            avgDistKm,
            peakPeriod,
            flows,
        };
    }, [isolatedZone, displayedPairs, getZoneName]);

    useEffect(() => {
        setMatrixPage(1);
    }, [matrixSearch, filteredPairs, allZonesMode]);

    // Check if any pair has hourly data
    const hasHourlyData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => p.hourlyBins && p.hourlyBins.some(b => b > 0));
    }, [odPairs]);

    // Available GTFS route short names for corridor filter
    const availableRouteNames = useMemo(() => {
        try {
            return loadGtfsRouteShapes().map(s => s.routeShortName);
        } catch { return []; }
    }, []);

    // Check if any pair has weekday/weekend data
    const hasWeekdayData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => (p.weekdayCount ?? 0) > 0 || (p.weekendCount ?? 0) > 0);
    }, [odPairs]);

    // Check if any pair has season data
    const hasSeasonData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => p.seasonBins && (p.seasonBins.jan > 0 || p.seasonBins.jul > 0 || p.seasonBins.sep > 0 || p.seasonBins.other > 0));
    }, [odPairs]);
    const hasOtherSeasonData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => (p.seasonBins?.other || 0) > 0);
    }, [odPairs]);

    // Zone name cache: map coordinate key → nearest GTFS stop name
    // (moved above zonePanelData useMemo)

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: BARRIE_CENTER,
            zoom: 13,
            zoomControl: true,
            ...SMOOTH_MAP_OPTIONS,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 18,
        }).addTo(map);

        // Feature 6: Click map background to clear spider mode
        map.on('click', () => {
            setIsolatedZone(null);
        });
        map.on('zoomend', () => {
            setMapZoom(map.getZoom());
        });
        setMapZoom(map.getZoom());

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

    // Build heatmap layer
    const buildHeatmapLayer = useCallback(() => {
        const group = L.layerGroup();
        const filtered = geoFilter === 'barrie'
            ? locationDensity.cells.filter(c => isInBarrie(c.latBin, c.lonBin))
            : locationDensity.cells;
        if (filtered.length === 0) return group;

        const maxCount = filtered[0].count;
        const logMax = Math.log(maxCount + 1);

        // Render lowest values first so highest-value bubbles draw on top
        const ascending = [...filtered].reverse();

        for (const cell of ascending) {
            // Non-linear boost to improve visual separation in dense downtown cells.
            const normalized = Math.log(cell.count + 1) / Math.max(0.0001, logMax);
            const t = Math.pow(normalized, 0.65);
            const radius = 3 + Math.pow(t, 1.15) * 14;
            const baseColor = heatColor(t);
            L.circleMarker([cell.latBin, cell.lonBin], {
                radius,
                fillColor: baseColor,
                fillOpacity: 0.2 + t * 0.75,
                color: baseColor,
                weight: 0.6 + t * 0.8,
                opacity: 0.85,
            })
                .bindTooltip(`${cell.count.toLocaleString()} data points`, { direction: 'top' })
                .addTo(group);

            // Extra outline for the hottest cells to make peak clusters pop.
            if (t >= 0.9) {
                L.circleMarker([cell.latBin, cell.lonBin], {
                    radius: radius + 2.5,
                    fillOpacity: 0,
                    color: '#111827',
                    weight: 1.2,
                    opacity: 0.7,
                }).addTo(group);
            }
        }

        return group;
    }, [locationDensity, geoFilter]);

    // Build OD layer using pre-filtered displayedPairs
    const buildODLayer = useCallback(() => {
        const group = L.layerGroup();
        odLineGroupsRef.current = [];
        if (displayedPairs.length === 0) return group;

        const map = mapRef.current;
        const bounds = map?.getBounds();
        const paddedBounds = bounds ? bounds.pad(0.2) : null;
        const inViewport = (pair: MergedODPair) => {
            if (!paddedBounds) return true;
            return paddedBounds.contains([pair.originLat, pair.originLon])
                || paddedBounds.contains([pair.destLat, pair.destLon]);
        };

        const resolution = odPairs?.resolution ?? 0.005;
        const half = resolution / 2;
        const showArcs = !(allZonesMode && allZonesRenderMode === 'overview');

        let arcPairs = displayedPairs;
        if (allZonesMode && (allZonesRenderMode === 'corridor' || allZonesRenderMode === 'detail')) {
            arcPairs = arcPairs.filter(inViewport);
            arcPairs = allZonesRenderMode === 'corridor'
                ? arcPairs.slice(0, CORRIDOR_MAX_ARCS)
                : arcPairs.slice(0, DETAIL_MAX_ARCS);
        }

        const zoneSourcePairs = allZonesMode ? displayedPairs : arcPairs;
        const zoneMap = new Map<string, { lat: number; lon: number; isOrigin: boolean; isDest: boolean; trips: number }>();
        for (const pair of zoneSourcePairs) {
            const oKey = coordKey(pair.originLat, pair.originLon);
            const dKey = coordKey(pair.destLat, pair.destLon);
            const oZone = zoneMap.get(oKey);
            if (oZone) {
                oZone.isOrigin = true;
                oZone.trips += pair.count;
            } else {
                zoneMap.set(oKey, { lat: pair.originLat, lon: pair.originLon, isOrigin: true, isDest: false, trips: pair.count });
            }
            const dZone = zoneMap.get(dKey);
            if (dZone) {
                dZone.isDest = true;
                dZone.trips += pair.count;
            } else {
                zoneMap.set(dKey, { lat: pair.destLat, lon: pair.destLon, isOrigin: false, isDest: true, trips: pair.count });
            }
        }

        const maxZoneTrips = Math.max(...Array.from(zoneMap.values()).map(z => z.trips), 1);
        for (const [zoneKey, zone] of zoneMap) {
            const isSelected = zoneKey === isolatedZone;
            const fillColor = isSelected ? '#3b82f6'
                : zone.isOrigin && zone.isDest ? '#8b5cf6'
                : zone.isOrigin ? '#10b981'
                : '#ef4444';
            const zoneName = getZoneName(zone.lat, zone.lon);
            const t = zone.trips / maxZoneTrips;
            const isOverview = allZonesMode && allZonesRenderMode === 'overview';

            const rect = L.rectangle(
                [[zone.lat - half, zone.lon - half], [zone.lat + half, zone.lon + half]],
                {
                    fillColor,
                    fillOpacity: isSelected ? 0.3 : (isOverview ? 0.14 + t * 0.12 : 0.25),
                    color: isSelected ? '#1d4ed8' : fillColor,
                    weight: isSelected ? 2.5 : (isOverview ? 0.8 : 1),
                    opacity: isSelected ? 0.9 : (isOverview ? 0.35 : 0.5),
                }
            )
                .bindTooltip(`${zoneName} — ${zone.trips.toLocaleString()} trips`, { direction: 'top' })
                .addTo(group);

            const baseRadius = isSelected ? 11 : (isOverview ? 4 + t * 7 : 8);
            const zoneDot = L.circleMarker([zone.lat, zone.lon], {
                radius: baseRadius,
                fillColor,
                fillOpacity: isSelected ? 0.7 : (isOverview ? 0.55 : 0.4),
                color: '#ffffff',
                weight: isSelected ? 3 : 1.5,
                opacity: isSelected ? 1 : 0.7,
            }).addTo(group);

            zoneDot.on('mouseover', function (this: L.CircleMarker) {
                this.setStyle({ fillOpacity: 0.75, weight: 2.2, radius: baseRadius + 1.8 } as L.CircleMarkerOptions);
            });
            zoneDot.on('mouseout', function (this: L.CircleMarker) {
                this.setStyle({ fillOpacity: isOverview ? 0.55 : 0.4, weight: 1.5, radius: baseRadius } as L.CircleMarkerOptions);
            });

            zoneDot.on('click', (e: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e);
                setIsolatedZone(prev => prev === zoneKey ? null : zoneKey);
            });

            rect.on('click', (e: L.LeafletMouseEvent) => {
                L.DomEvent.stopPropagation(e);
                setIsolatedZone(prev => prev === zoneKey ? null : zoneKey);
            });
        }

        if (!showArcs || arcPairs.length === 0) {
            return group;
        }

        const allZonesDetail = allZonesMode && allZonesRenderMode === 'detail';
        for (let i = 0; i < arcPairs.length; i++) {
            const pair = arcPairs[i];
            const lineElements: L.Path[] = [];

            const color = allZonesMode ? '#334155' : rankColor(i);
            const weight = allZonesMode ? (allZonesDetail ? 2.2 : 1.5) : rankWeight(i);
            const opacity = allZonesMode
                ? (allZonesDetail ? 0.46 : 0.34)
                : (i < TOP_RANK_COLORS.length ? 0.85 : 0.7);

            const curveDir: 1 | -1 = i % 2 === 0 ? 1 : -1;
            let origin: [number, number] = [pair.originLat, pair.originLon];
            let dest: [number, number] = [pair.destLat, pair.destLon];
            if (pair.isMerged && pair.netDirection === 'BA') {
                [origin, dest] = [dest, origin];
            }
            const arcPoints = quadraticBezierArc(origin, dest, curveDir);

            const polyline = L.polyline(arcPoints, {
                color,
                weight,
                opacity,
                lineCap: 'round',
                lineJoin: 'round',
            });

            const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
            polyline.bindTooltip(`${pair.count.toLocaleString()} trips (${distKm.toFixed(1)} km)`, {
                direction: 'top', sticky: true,
            });

            const pctStr = odPairs && odPairs.totalTripsProcessed > 0
                ? ((pair.count / odPairs.totalTripsProcessed) * 100).toFixed(2)
                : '?';
            const originName = getZoneName(pair.originLat, pair.originLon);
            const destName = getZoneName(pair.destLat, pair.destLon);
            let popupContent = `<div style="font-size:12px;line-height:1.4">
                <b>${originName} → ${destName}</b><br/>
                <b>${pair.count.toLocaleString()} trips</b> (${pctStr}% of total)<br/>
                Distance: ${distKm.toFixed(1)} km`;
            if (pair.isMerged) {
                const fwd = pair.count - pair.reverseCount;
                popupContent += `<br/>A→B: ${fwd.toLocaleString()} | B→A: ${pair.reverseCount.toLocaleString()}`;
                popupContent += `<br/>Direction: ${pair.netDirection}`;
            }
            popupContent += '</div>';
            polyline.bindPopup(popupContent);

            polyline.addTo(group);
            lineElements.push(polyline);

            if (!allZonesMode && !(pair.isMerged && pair.netDirection === 'balanced')) {
                const arrowSize = i < TOP_RANK_COLORS.length ? 0.005 : 0.003;
                const arrows = arrowheadPoints(arcPoints, arrowSize);
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
            }

            if (!allZonesMode || allZonesDetail) {
                const dotRadius = allZonesMode ? 3 : (i < TOP_RANK_COLORS.length ? 6 : 4);
                const originDot = L.circleMarker([pair.originLat, pair.originLon], {
                    radius: dotRadius,
                    fillColor: '#10b981',
                    fillOpacity: 0.9,
                    color: '#ffffff',
                    weight: allZonesMode ? 1 : 2,
                }).addTo(group);
                lineElements.push(originDot);

                const destDot = L.circleMarker([pair.destLat, pair.destLon], {
                    radius: dotRadius,
                    fillColor: '#ef4444',
                    fillOpacity: 0.9,
                    color: '#ffffff',
                    weight: allZonesMode ? 1 : 2,
                }).addTo(group);
                lineElements.push(destDot);
            }

            odLineGroupsRef.current.push({ lines: lineElements, pair, origOpacity: opacity });

            if (!allZonesMode) {
                const midIdx = Math.floor(arcPoints.length / 2);
                const midPt = arcPoints[midIdx];
                const badgeSize = i < 5 ? 22 : 18;
                const fontSize = i < 5 ? 11 : 9;
                L.marker(midPt, {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="
                            background: ${color};
                            color: white;
                            width: ${badgeSize}px;
                            height: ${badgeSize}px;
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: ${fontSize}px;
                            font-weight: 700;
                            border: 2px solid white;
                            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                            pointer-events: none;
                        ">${i + 1}</div>`,
                        iconSize: [badgeSize, badgeSize],
                        iconAnchor: [badgeSize / 2, badgeSize / 2],
                    }),
                    interactive: false,
                }).addTo(group);
            }

            const highlight = () => {
                for (const g of odLineGroupsRef.current) {
                    if (g.pair === pair) {
                        for (const el of g.lines) el.setStyle({ opacity: 1 });
                    } else {
                        for (const el of g.lines) el.setStyle({ opacity: 0.2 });
                    }
                }
                setHighlightedPairIdx(i);
            };
            const unhighlight = () => {
                for (const g of odLineGroupsRef.current) {
                    for (const el of g.lines) el.setStyle({ opacity: g.origOpacity });
                }
                setHighlightedPairIdx(null);
            };

            for (const el of lineElements) {
                el.on('mouseover', highlight);
                el.on('mouseout', unhighlight);
            }
        }

        return group;
    }, [displayedPairs, odPairs, getZoneName, allZonesMode, allZonesRenderMode, isolatedZone]);

    // Feature 10: GTFS route overlay layer
    const buildRouteLayer = useCallback(() => {
        const group = L.layerGroup();
        try {
            const shapes = loadGtfsRouteShapes();
            for (const shape of shapes) {
                const color = `#${shape.routeColor}`;
                L.polyline(shape.points, {
                    color,
                    weight: 3,
                    opacity: 0.6,
                    dashArray: '6 4',
                    lineCap: 'round',
                })
                    .bindTooltip(`Route ${shape.routeShortName}`, { direction: 'top', sticky: true })
                    .addTo(group);
            }
        } catch (e) {
            console.warn('Failed to load GTFS shapes:', e);
        }
        return group;
    }, []);

    const buildStopLayer = useCallback(() => {
        const group = L.layerGroup();
        try {
            const stops = getAllStopsWithCoords();
            for (const stop of stops) {
                L.circleMarker([stop.lat, stop.lon], {
                    radius: 2,
                    fillColor: '#111827',
                    fillOpacity: 0.65,
                    color: '#ffffff',
                    weight: 0.5,
                })
                    .bindTooltip(stop.stop_name, { direction: 'top', sticky: true, opacity: 0.95 })
                    .addTo(group);
            }
        } catch (e) {
            console.warn('Failed to load GTFS stops:', e);
        }
        return group;
    }, []);

    const buildCoverageLayer = useCallback(() => {
        const group = L.layerGroup();
        if (!coverageGapClusters || coverageGapClusters.length === 0) return group;

        const maxCount = Math.max(...coverageGapClusters.map(cluster => cluster.tripCount), 1);
        for (const cluster of coverageGapClusters) {
            const t = cluster.tripCount / maxCount;
            const radius = 5 + t * 8;
            const marker = L.circleMarker([cluster.lat, cluster.lon], {
                radius,
                fillColor: '#dc2626',
                fillOpacity: 0.45,
                color: '#7f1d1d',
                weight: 1.5,
            });
            marker.bindPopup(
                `<div style="font-size:12px;line-height:1.4;">
                    <div style="font-weight:700;margin-bottom:4px;">Coverage Gap Cluster</div>
                    <div><strong>Trips:</strong> ${cluster.tripCount.toLocaleString()}</div>
                    <div><strong>Nearest Stop:</strong> ${cluster.nearestStopName ?? 'Unknown'}</div>
                    <div><strong>Distance:</strong> ${cluster.avgNearestStopDistanceKm.toFixed(2)} km avg</div>
                    <div><strong>Time:</strong> ${formatTimeBand(cluster.dominantTimeBand)}</div>
                    <div><strong>Day:</strong> ${formatDayType(cluster.dominantDayType)}</div>
                    <div><strong>Season:</strong> ${formatSeason(cluster.dominantSeason)}</div>
                </div>`
            );
            marker.addTo(group);
        }

        return group;
    }, [coverageGapClusters]);

    // Sync layers
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (heatmapLayerRef.current) {
            map.removeLayer(heatmapLayerRef.current);
            heatmapLayerRef.current = null;
        }
        if (odLayerRef.current) {
            map.removeLayer(odLayerRef.current);
            odLayerRef.current = null;
        }

        const barrieFit: L.LatLngBoundsLiteral = [
            [BARRIE_VIEW_BOUNDS.minLat, BARRIE_VIEW_BOUNDS.minLon],
            [BARRIE_VIEW_BOUNDS.maxLat, BARRIE_VIEW_BOUNDS.maxLon],
        ];
        const prev = lastFitTriggerRef.current;
        const shouldRefit = !prev
            || prev.activeLayer !== activeLayer
            || prev.geoFilter !== geoFilter
            || prev.odPairsRef !== odPairs
            || prev.locationBoundsRef !== locationDensity.bounds;

        if (activeLayer === 'heatmap') {
            const layer = buildHeatmapLayer();
            layer.addTo(map);
            heatmapLayerRef.current = layer;

            if (shouldRefit && geoFilter === 'barrie') {
                map.fitBounds(barrieFit, { padding: [20, 20] });
            } else if (shouldRefit) {
                const b = locationDensity.bounds;
                if (b.minLat !== 0 || b.maxLat !== 0) {
                    map.fitBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]], { padding: [20, 20] });
                }
            }
        } else {
            const layer = buildODLayer();
            layer.addTo(map);
            odLayerRef.current = layer;

            if (shouldRefit && geoFilter === 'barrie') {
                map.fitBounds(barrieFit, { padding: [20, 20] });
            } else if (shouldRefit && odPairs && odPairs.bounds.minLat !== 0) {
                const b = odPairs.bounds;
                map.fitBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]], { padding: [20, 20] });
            }
        }

        lastFitTriggerRef.current = {
            activeLayer,
            geoFilter,
            odPairsRef: odPairs,
            locationBoundsRef: locationDensity.bounds,
        };
    }, [activeLayer, geoFilter, buildHeatmapLayer, buildODLayer, locationDensity.bounds, odPairs]);

    // Feature 10: GTFS route overlay toggle
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (routeLayerRef.current) {
            map.removeLayer(routeLayerRef.current);
            routeLayerRef.current = null;
        }

        if (showRoutes) {
            const layer = buildRouteLayer();
            layer.addTo(map);
            routeLayerRef.current = layer;
        }
    }, [showRoutes, buildRouteLayer]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (stopLayerRef.current) {
            map.removeLayer(stopLayerRef.current);
            stopLayerRef.current = null;
        }

        if (showStops) {
            const layer = buildStopLayer();
            layer.addTo(map);
            stopLayerRef.current = layer;
        }
    }, [showStops, buildStopLayer]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        if (coverageLayerRef.current) {
            map.removeLayer(coverageLayerRef.current);
            coverageLayerRef.current = null;
        }

        if (coverageGapClusters && coverageGapClusters.length > 0) {
            const layer = buildCoverageLayer();
            layer.addTo(map);
            coverageLayerRef.current = layer;
        }
    }, [coverageGapClusters, buildCoverageLayer]);

    // Auto-enable GTFS overlay when corridor is selected
    useEffect(() => {
        if (corridorRoute && !showRoutes) setShowRoutes(true);
    }, [corridorRoute]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (coverageGapClusters && coverageGapClusters.length > 0 && !showStops) {
            setShowStops(true);
        }
    }, [coverageGapClusters, showStops]);

    // Export OD summary as PDF
    const exportPDF = useCallback(() => {
        if (!displayedPairs.length) return;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 14;

        // Title
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Transit App — Origin-Destination Summary', pageWidth / 2, margin, { align: 'center' });

        // Subtitle with active filters
        const filters: string[] = [];
        if (geoFilter === 'barrie') filters.push('Barrie only');
        if (corridorRoute) filters.push(`Route ${corridorRoute} corridor`);
        if (timePeriod !== 'all') filters.push(`Time: ${timePeriod}`);
        if (dayFilter !== 'all') filters.push(`Day: ${dayFilter}`);
        if (seasonFilter !== 'all') filters.push(`Season: ${seasonFilter.toUpperCase()}`);
        if (distanceBand !== 'all') filters.push(`Distance: ${distanceBand}`);
        if (mergeBidirectional) filters.push('Merged A↔B');
        const subtitle = filters.length > 0 ? `Filters: ${filters.join(', ')}` : 'No filters applied';
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(subtitle, pageWidth / 2, margin + 6, { align: 'center' });

        // Summary line
        const totalTrips = displayedPairs.reduce((s, p) => s + p.count, 0);
        doc.text(
            `${displayedPairs.length} pairs · ${totalTrips.toLocaleString()} trips · ${allZonesMode ? 'All filtered zones' : `Top ${topN}`}`,
            pageWidth / 2, margin + 11, { align: 'center' }
        );

        // Table
        const head = [['#', 'Origin', 'Destination', 'Trips', '% Total', 'Dist (km)']];
        if (hasWeekdayData) head[0].push('WD', 'WE');

        const body = displayedPairs.map((pair, i) => {
            const originName = getZoneName(pair.originLat, pair.originLon);
            const destName = getZoneName(pair.destLat, pair.destLon);
            const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
            const pct = odPairs && odPairs.totalTripsProcessed > 0
                ? ((pair.count / odPairs.totalTripsProcessed) * 100).toFixed(2)
                : '—';
            const row = [
                String(i + 1),
                originName,
                destName,
                pair.count.toLocaleString(),
                `${pct}%`,
                distKm.toFixed(1),
            ];
            if (hasWeekdayData) {
                row.push(String(pair.weekdayCount ?? '—'));
                row.push(String(pair.weekendCount ?? '—'));
            }
            return row;
        });

        doc.autoTable({
            head,
            body,
            startY: margin + 15,
            theme: 'grid',
            headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
            styles: { fontSize: 7, cellPadding: 1.5 },
            columnStyles: { 0: { cellWidth: 8 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
            margin: { left: margin, right: margin },
        });

        // Footer
        const footerY = doc.internal.pageSize.getHeight() - 8;
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text('Transit App sample data — not total ridership', margin, footerY);
        doc.text(new Date().toLocaleDateString(), pageWidth - margin, footerY, { align: 'right' });

        const date = new Date().toISOString().slice(0, 10);
        doc.save(`transit-od-summary-${date}.pdf`);
    }, [displayedPairs, getZoneName, geoFilter, corridorRoute, timePeriod, dayFilter, seasonFilter, distanceBand, mergeBidirectional, topN, hasWeekdayData, odPairs, allZonesMode]);

    const hasOD = odPairs && odPairs.pairs.length > 0;

    // Sorted table data — maintains original index for map↔table linking
    const sortedTableData = useMemo(() => {
        const indexed = displayedPairs.map((pair, i) => ({ pair, idx: i }));
        indexed.sort((a, b) => {
            let cmp = 0;
            switch (sortColumn) {
                case 'rank': cmp = a.idx - b.idx; break;
                case 'trips': cmp = a.pair.count - b.pair.count; break;
                case 'dist':
                    cmp = haversineKm(a.pair.originLat, a.pair.originLon, a.pair.destLat, a.pair.destLon)
                        - haversineKm(b.pair.originLat, b.pair.originLon, b.pair.destLat, b.pair.destLon);
                    break;
                case 'origin':
                    cmp = getZoneName(a.pair.originLat, a.pair.originLon)
                        .localeCompare(getZoneName(b.pair.originLat, b.pair.originLon));
                    break;
                case 'dest':
                    cmp = getZoneName(a.pair.destLat, a.pair.destLon)
                        .localeCompare(getZoneName(b.pair.destLat, b.pair.destLon));
                    break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return indexed;
    }, [displayedPairs, sortColumn, sortDir, getZoneName]);

    const handleSort = useCallback((col: typeof sortColumn) => {
        if (sortColumn === col) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(col);
            setSortDir(col === 'trips' ? 'desc' : 'asc');
        }
    }, [sortColumn]);

    const matrixSourcePairs = useMemo(
        () => allZonesMode ? filteredPairs : displayedPairs,
        [allZonesMode, filteredPairs, displayedPairs]
    );

    const matrixRows = useMemo(() => {
        const rows = matrixSourcePairs.map((pair, idx) => {
            const originKey = coordKey(pair.originLat, pair.originLon);
            const destKey = coordKey(pair.destLat, pair.destLon);
            const originName = getZoneName(pair.originLat, pair.originLon);
            const destName = getZoneName(pair.destLat, pair.destLon);
            const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
            const pct = odPairs && odPairs.totalTripsProcessed > 0
                ? ((pair.count / odPairs.totalTripsProcessed) * 100)
                : 0;
            return {
                idx,
                pair,
                originKey,
                destKey,
                originName,
                destName,
                distKm,
                pct,
            };
        });

        const q = matrixSearch.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(row =>
            row.originName.toLowerCase().includes(q)
            || row.destName.toLowerCase().includes(q)
        );
    }, [matrixSourcePairs, getZoneName, odPairs, matrixSearch]);

    const matrixPages = Math.max(1, Math.ceil(matrixRows.length / MATRIX_PAGE_SIZE));
    const matrixPageRows = useMemo(() => {
        const clampedPage = Math.min(matrixPage, matrixPages);
        const start = (clampedPage - 1) * MATRIX_PAGE_SIZE;
        return matrixRows.slice(start, start + MATRIX_PAGE_SIZE);
    }, [matrixRows, matrixPage, matrixPages]);

    useEffect(() => {
        setMatrixPage(p => Math.min(p, matrixPages));
    }, [matrixPages]);

    const matrixZoneHeaders = useMemo(() => {
        const zoneWeights = new Map<string, { key: string; name: string; trips: number }>();
        for (const row of matrixRows) {
            const o = zoneWeights.get(row.originKey);
            if (o) o.trips += row.pair.count;
            else zoneWeights.set(row.originKey, { key: row.originKey, name: row.originName, trips: row.pair.count });

            const d = zoneWeights.get(row.destKey);
            if (d) d.trips += row.pair.count;
            else zoneWeights.set(row.destKey, { key: row.destKey, name: row.destName, trips: row.pair.count });
        }
        return Array.from(zoneWeights.values())
            .sort((a, b) => b.trips - a.trips)
            .slice(0, 12);
    }, [matrixRows]);

    const matrixHeat = useMemo(() => {
        const lookup = new Map<string, number>();
        for (const row of matrixRows) {
            const key = `${row.originKey}|${row.destKey}`;
            lookup.set(key, (lookup.get(key) ?? 0) + row.pair.count);
        }
        const maxCell = Math.max(...Array.from(lookup.values()), 1);
        return { lookup, maxCell };
    }, [matrixRows]);

    // Table row → map arc highlight helpers
    const highlightArc = useCallback((pair: MergedODPair) => {
        for (const g of odLineGroupsRef.current) {
            for (const el of g.lines) el.setStyle({ opacity: 0.2 });
        }
        const group = odLineGroupsRef.current.find(g => g.pair === pair);
        if (group) {
            for (const el of group.lines) el.setStyle({ opacity: 1 });
        }
        const idx = displayedPairs.indexOf(pair);
        setHighlightedPairIdx(idx >= 0 ? idx : null);
    }, [displayedPairs]);

    const unhighlightArcs = useCallback(() => {
        for (const g of odLineGroupsRef.current) {
            for (const el of g.lines) el.setStyle({ opacity: g.origOpacity });
        }
        setHighlightedPairIdx(null);
    }, []);

    // Toggle button style helper
    const toggleBtn = (active: boolean, disabled?: boolean) =>
        `px-3 py-1.5 text-xs font-medium transition-colors ${
            disabled ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
            : active ? 'bg-gray-900 text-white'
            : 'bg-white text-gray-500 hover:bg-gray-50'
        }`;

    const fullscreenRef = useRef<HTMLDivElement>(null);
    const toggleFullscreen = () => {
        if (!fullscreenRef.current) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            fullscreenRef.current.requestFullscreen();
        }
    };

    useEffect(() => {
        const handler = () => {
            setIsFullscreen(!!document.fullscreenElement);
            // Invalidate map size after fullscreen transition
            setTimeout(() => mapRef.current?.invalidateSize(), 100);
        };
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    useEffect(() => {
        if (plannerView === 'map') {
            setTimeout(() => mapRef.current?.invalidateSize(), 80);
        }
    }, [plannerView]);

    const showMatrixPlanner = activeLayer === 'od' && hasOD && plannerView === 'matrix';
    const matrixCurrentPage = Math.min(matrixPage, matrixPages);
    const matrixStartRow = matrixRows.length === 0 ? 0 : ((matrixCurrentPage - 1) * MATRIX_PAGE_SIZE) + 1;
    const matrixEndRow = Math.min(matrixCurrentPage * MATRIX_PAGE_SIZE, matrixRows.length);

    return (
        <div ref={fullscreenRef} className={`space-y-2 ${isFullscreen ? 'bg-white p-4 overflow-auto' : ''}`}>
            {/* Row 1 — Primary controls */}
            <div className="flex items-center flex-wrap gap-2">
                {/* Layer toggle */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button onClick={() => setActiveLayer('heatmap')} className={toggleBtn(activeLayer === 'heatmap')}>
                        Heatmap
                    </button>
                    <button
                        onClick={() => hasOD && setActiveLayer('od')}
                        className={toggleBtn(activeLayer === 'od', !hasOD)}
                        title={hasOD ? 'Show OD desire lines' : 'No OD data — re-import to generate'}
                    >
                        OD Lines
                    </button>
                </div>

                {/* Geo filter */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button onClick={() => setGeoFilter('barrie')} className={toggleBtn(geoFilter === 'barrie')}>
                        Barrie
                    </button>
                    <button onClick={() => setGeoFilter('all')} className={toggleBtn(geoFilter === 'all')}>
                        Regional
                    </button>
                </div>

                {activeLayer === 'od' && hasOD && (
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        <button onClick={() => setPlannerView('map')} className={toggleBtn(plannerView === 'map')}>
                            Map
                        </button>
                        <button onClick={() => setPlannerView('matrix')} className={toggleBtn(plannerView === 'matrix')}>
                            Matrix
                        </button>
                    </div>
                )}

                {/* Route corridor */}
                {availableRouteNames.length > 0 && (
                    <div className="flex items-center gap-1">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Route:</span>
                        <select
                            value={corridorRoute ?? ''}
                            onChange={e => setCorridorRoute(e.target.value || null)}
                            className="px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600"
                        >
                            <option value="">All</option>
                            {availableRouteNames.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* GTFS Routes */}
                <button
                    onClick={() => setShowRoutes(v => !v)}
                    className={`${toggleBtn(showRoutes)} rounded-lg border ${showRoutes ? 'border-gray-900' : 'border-gray-200'}`}
                >
                    GTFS Routes
                </button>

                <button
                    onClick={() => setShowStops(v => !v)}
                    className={`${toggleBtn(showStops)} rounded-lg border ${showStops ? 'border-gray-900' : 'border-gray-200'}`}
                >
                    GTFS Stops
                </button>

                {/* Export PDF */}
                {activeLayer === 'od' && displayedPairs.length > 0 && (
                    <button
                        onClick={exportPDF}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Export PDF ↓
                    </button>
                )}

                {/* Fullscreen toggle */}
                <button
                    onClick={toggleFullscreen}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors ml-auto"
                    title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
                >
                    {isFullscreen ? '⊡ Exit' : '⛶ Fullscreen'}
                </button>
            </div>

            {/* Row 2 — Filters (OD only) */}
            {activeLayer === 'od' && hasOD && (
                <div className="flex items-center flex-wrap gap-4 bg-gray-50 rounded-lg border border-gray-100 px-4 py-2">
                    {/* All zones toggle */}
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">&nbsp;</span>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer py-0.5">
                            <input
                                type="checkbox"
                                checked={allZonesMode}
                                onChange={e => setAllZonesMode(e.target.checked)}
                                className="accent-gray-900"
                            />
                            All zones
                        </label>
                    </div>

                    {/* Pairs slider */}
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Pairs</span>
                        <div className="flex items-center gap-1.5">
                            <input type="range" min={5} max={50} value={topN}
                                onChange={e => setTopN(Number(e.target.value))}
                                disabled={allZonesMode}
                                className="w-16 accent-gray-900 disabled:opacity-40 disabled:cursor-not-allowed" />
                            <span className="text-xs font-medium text-gray-700 w-9 text-right">
                                {allZonesMode ? 'All' : topN}
                            </span>
                        </div>
                    </div>

                    {/* Threshold slider */}
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Threshold</span>
                        <div className="flex items-center gap-1.5">
                            <input type="range" min={1} max={50} value={minCount}
                                onChange={e => setMinCount(Number(e.target.value))}
                                className="w-16 accent-gray-900" />
                            <span className="text-xs font-medium text-gray-700 w-5 text-right">{minCount}</span>
                        </div>
                    </div>

                    {/* Distance bands */}
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Distance</span>
                        <div className="flex rounded border border-gray-200 overflow-hidden">
                            {(['all', 'short', 'medium', 'long'] as DistanceBand[]).map(band => (
                                <button key={band} onClick={() => setDistanceBand(band)}
                                    className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                        distanceBand === band ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}>
                                    {band === 'all' ? 'All' : band === 'short' ? '<3' : band === 'medium' ? '3-10' : '>10'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Time-of-day filter */}
                    {hasHourlyData && (
                        <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Time</span>
                            <div className="flex rounded border border-gray-200 overflow-hidden">
                                {([
                                    { key: 'all', label: 'All' },
                                    { key: 'am', label: 'AM' },
                                    { key: 'midday', label: 'Mid' },
                                    { key: 'pm', label: 'PM' },
                                    { key: 'evening', label: 'Eve' },
                                ] as { key: TimePeriod; label: string }[]).map(({ key, label }) => (
                                    <button key={key} onClick={() => setTimePeriod(key)}
                                        className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                            timePeriod === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                        }`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Day filter */}
                    {hasWeekdayData && (
                        <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Day</span>
                            <div className="flex rounded border border-gray-200 overflow-hidden">
                                {([
                                    { key: 'all', label: 'All' },
                                    { key: 'weekday', label: 'WD' },
                                    { key: 'weekend', label: 'WE' },
                                ] as { key: DayFilter; label: string }[]).map(({ key, label }) => (
                                    <button key={key} onClick={() => setDayFilter(key)}
                                        className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                            dayFilter === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                        }`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Season filter */}
                    {hasSeasonData && (
                        <div className="flex flex-col">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Season</span>
                            <div className="flex rounded border border-gray-200 overflow-hidden">
                                {([
                                    { key: 'all', label: 'All' },
                                    { key: 'jan', label: 'Jan' },
                                    { key: 'jul', label: 'Jul' },
                                    { key: 'sep', label: 'Sep' },
                                    ...(hasOtherSeasonData ? [{ key: 'other', label: 'Other' }] : []),
                                ] as { key: SeasonFilter; label: string }[]).map(({ key, label }) => (
                                    <button key={key} onClick={() => setSeasonFilter(key)}
                                        className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                            seasonFilter === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                        }`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Merge toggle */}
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">&nbsp;</span>
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer py-0.5">
                            <input type="checkbox" checked={mergeBidirectional}
                                onChange={e => setMergeBidirectional(e.target.checked)}
                                className="accent-gray-900" />
                            Merge
                        </label>
                    </div>
                </div>
            )}

            {/* Stats bar */}
            {activeLayer === 'od' && stats && (
                <div className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">{stats.pairs}</span> pairs
                    {allZonesMode && (
                        <>
                            <span className="text-gray-300"> / </span>
                            <span className="font-medium text-gray-700">{stats.totalFilteredPairs}</span> filtered
                        </>
                    )}
                    {' · '}
                    <span className="font-medium text-gray-700">{stats.trips.toLocaleString()}</span> trips
                    {' · '}
                    <span className="font-medium text-gray-700">{stats.pct}%</span> of total
                    {allZonesMode && (
                        <>
                            <span className="text-gray-300"> · </span>
                            <span className="text-gray-600">All zones: {allZonesRenderMode}</span>
                            <span className="text-gray-300"> @ </span>
                            <span className="text-gray-600">{mapZoom.toFixed(2)}x zoom</span>
                        </>
                    )}
                    <span className="text-gray-300"> · </span>
                    <span className="text-gray-400 italic">Transit App sample — not total ridership</span>
                    {isolatedZone && (() => {
                        const [latStr, lonStr] = isolatedZone.split('_');
                        const spiderName = getZoneName(parseFloat(latStr), parseFloat(lonStr));
                        return (
                            <>
                                <span className="text-gray-300"> · </span>
                                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-[11px] font-medium">
                                    {spiderName}
                                    <button onClick={() => setIsolatedZone(null)} className="text-blue-400 hover:text-blue-600 ml-0.5">×</button>
                                </span>
                            </>
                        );
                    })()}
                </div>
            )}

            {/* Map + Zone Panel row */}
            <div className={`flex gap-0 ${showMatrixPlanner ? 'hidden' : ''}`}
                 style={{ height: isFullscreen ? 'calc(100vh - 200px)' : height }}>
                {/* Map container */}
                <div
                    ref={containerRef}
                    className={`flex-1 overflow-hidden border border-gray-200 ${
                        isolatedZone && zonePanelData && activeLayer === 'od' ? 'rounded-l-lg' : 'rounded-lg'
                    }`}
                    style={{ minHeight: 0 }}
                />

                {/* Zone Detail Panel */}
                {isolatedZone && zonePanelData && activeLayer === 'od' && (
                    <div className="w-80 shrink-0 border border-l-0 border-gray-200 rounded-r-lg bg-white overflow-y-auto">
                        {/* Header */}
                        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-start justify-between">
                            <div className="min-w-0">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Selected Zone</div>
                                <div className="text-sm font-semibold text-gray-900 truncate">{zonePanelData.zoneName}</div>
                            </div>
                            <button
                                onClick={() => setIsolatedZone(null)}
                                className="shrink-0 ml-2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Close zone panel"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                </svg>
                            </button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-gray-100">
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Trips</div>
                                <div className="text-lg font-bold text-gray-900 tabular-nums">{zonePanelData.totalTrips.toLocaleString()}</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Connections</div>
                                <div className="text-lg font-bold text-gray-900 tabular-nums">{zonePanelData.uniqueConnections}</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Avg Distance</div>
                                <div className="text-lg font-bold text-gray-900 tabular-nums">{zonePanelData.avgDistKm.toFixed(1)} <span className="text-xs font-normal text-gray-500">km</span></div>
                            </div>
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                                <div className="text-[10px] text-gray-400 uppercase tracking-wider">Peak Period</div>
                                <div className="text-lg font-bold text-gray-900">{zonePanelData.peakPeriod ?? '—'}</div>
                            </div>
                        </div>

                        {/* Top Flows Header */}
                        <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Top Flows</span>
                            <div className="flex rounded border border-gray-200 overflow-hidden">
                                <button
                                    onClick={() => setZonePanelTopN(10)}
                                    className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                        zonePanelTopN === 10 ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    10
                                </button>
                                <button
                                    onClick={() => setZonePanelTopN(20)}
                                    className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                        zonePanelTopN === 20 ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    20
                                </button>
                            </div>
                        </div>

                        {/* Top Flows List */}
                        <div className="divide-y divide-gray-50">
                            {zonePanelData.flows.slice(0, zonePanelTopN).map((flow, i) => {
                                const pct = zonePanelData.totalTrips > 0
                                    ? ((flow.total / zonePanelData.totalTrips) * 100).toFixed(1)
                                    : '0';
                                return (
                                    <div
                                        key={`${flow.lat}_${flow.lon}`}
                                        className="px-4 py-2 flex items-center gap-2 hover:bg-gray-50 cursor-pointer transition-colors"
                                        onMouseEnter={() => {
                                            const matchPair = displayedPairs.find(p => {
                                                const oKey = coordKey(p.originLat, p.originLon);
                                                const dKey = coordKey(p.destLat, p.destLon);
                                                const otherKey = coordKey(flow.lat, flow.lon);
                                                return oKey === otherKey || dKey === otherKey;
                                            });
                                            if (matchPair) highlightArc(matchPair);
                                        }}
                                        onMouseLeave={unhighlightArcs}
                                        onClick={() => {
                                            const map = mapRef.current;
                                            if (map) {
                                                map.fitBounds(
                                                    [[zonePanelData.zoneLat, zonePanelData.zoneLon], [flow.lat, flow.lon]],
                                                    { paddingTopLeft: [50, 50], paddingBottomRight: [340, 50], maxZoom: 15 }
                                                );
                                            }
                                        }}
                                    >
                                        <span
                                            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                                            style={{ backgroundColor: rankColor(i) }}
                                        >
                                            {i + 1}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium text-gray-800 truncate">{flow.name}</div>
                                            <div className="text-[10px] text-gray-400">
                                                {flow.outbound > 0 && <span>{flow.outbound.toLocaleString()} out</span>}
                                                {flow.outbound > 0 && flow.inbound > 0 && <span> · </span>}
                                                {flow.inbound > 0 && <span>{flow.inbound.toLocaleString()} in</span>}
                                                <span className="ml-1">· {flow.distKm.toFixed(1)} km</span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="text-xs font-semibold text-gray-900 tabular-nums">{flow.total.toLocaleString()}</div>
                                            <div className="text-[10px] text-gray-400 tabular-nums">{pct}%</div>
                                        </div>
                                    </div>
                                );
                            })}

                            {zonePanelData.flows.length === 0 && (
                                <div className="px-4 py-6 text-center text-xs text-gray-400">No flows for this zone</div>
                            )}

                            {zonePanelData.flows.length > zonePanelTopN && (
                                <div className="px-4 py-2 text-center text-[10px] text-gray-400">
                                    +{zonePanelData.flows.length - zonePanelTopN} more flows
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {!showMatrixPlanner ? (
                <>
                    {/* Legend */}
                    <div className="flex items-start gap-6 text-xs border border-gray-200 rounded-lg px-4 py-2.5 bg-gray-50/50">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium pt-0.5 shrink-0">Legend</span>
                        {activeLayer === 'heatmap' ? (
                            <div className="flex items-center gap-2 text-gray-500">
                                <span className="w-16 h-2 rounded" style={{ background: 'linear-gradient(to right, rgb(37,52,148), rgb(14,116,255), rgb(6,182,212), rgb(250,204,21), rgb(249,115,22), rgb(220,38,38))' }} />
                                Cool (low) → Warm (high) trip planning density
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-4 flex-wrap text-gray-500">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-3 h-3 rounded-full bg-emerald-500 border border-white shadow-sm" /> Origin zone
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow-sm" /> Destination zone
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-12 h-2 rounded" style={{ background: 'linear-gradient(to right, #bfdbfe, #06b6d4, #f97316, #ef4444)' }} />
                                        Arc: low → high volume
                                    </span>
                                    {!allZonesMode && (
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-4 h-4 rounded-full bg-gray-700 text-white text-[9px] font-bold flex items-center justify-center shrink-0">1</span>
                                            Rank badge
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-4 text-gray-400 flex-wrap">
                                    <span><kbd className="px-1 py-0.5 bg-gray-200 text-gray-500 rounded text-[10px]">Click</kbd> zone → filter flows</span>
                                    <span><kbd className="px-1 py-0.5 bg-gray-200 text-gray-500 rounded text-[10px]">Click</kbd> arc → trip details</span>
                                    <span><kbd className="px-1 py-0.5 bg-gray-200 text-gray-500 rounded text-[10px]">Hover</kbd> → isolate pair</span>
                                    {allZonesMode && (
                                        <span className="text-gray-500">Zoom out for zones, zoom in for corridor/detail lines</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* OD Summary Table (collapsible, sortable, bidirectional highlight) */}
                    {activeLayer === 'od' && displayedPairs.length > 0 && (
                        <div>
                            <button
                                onClick={() => setShowTable(v => !v)}
                                className="text-xs text-gray-500 hover:text-gray-700 underline"
                            >
                                {showTable ? 'Hide summary table' : 'Show summary table'}
                            </button>
                            {showTable && (
                                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
                                    <table className="w-full text-xs">
                                        <thead className="sticky top-0 z-10">
                                            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[10px]">
                                                <th className="px-3 py-2 text-left w-8 cursor-pointer hover:text-gray-700 select-none"
                                                    onClick={() => handleSort('rank')}>
                                                    # {sortColumn === 'rank' && (sortDir === 'asc' ? '↑' : '↓')}
                                                </th>
                                                <th className="px-3 py-2 text-left cursor-pointer hover:text-gray-700 select-none"
                                                    onClick={() => handleSort('origin')}>
                                                    Origin {sortColumn === 'origin' && (sortDir === 'asc' ? '↑' : '↓')}
                                                </th>
                                                <th className="px-3 py-2 text-left cursor-pointer hover:text-gray-700 select-none"
                                                    onClick={() => handleSort('dest')}>
                                                    Destination {sortColumn === 'dest' && (sortDir === 'asc' ? '↑' : '↓')}
                                                </th>
                                                <th className="px-3 py-2 text-right cursor-pointer hover:text-gray-700 select-none"
                                                    onClick={() => handleSort('trips')}>
                                                    Trips {sortColumn === 'trips' && (sortDir === 'asc' ? '↑' : '↓')}
                                                </th>
                                                <th className="px-3 py-2 text-right">% Total</th>
                                                <th className="px-3 py-2 text-right cursor-pointer hover:text-gray-700 select-none"
                                                    onClick={() => handleSort('dist')}>
                                                    Dist (km) {sortColumn === 'dist' && (sortDir === 'asc' ? '↑' : '↓')}
                                                </th>
                                                {hasWeekdayData && <th className="px-3 py-2 text-right">WD</th>}
                                                {hasWeekdayData && <th className="px-3 py-2 text-right">WE</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedTableData.map(({ pair, idx }) => {
                                                const originName = getZoneName(pair.originLat, pair.originLon);
                                                const destName = getZoneName(pair.destLat, pair.destLon);
                                                const distKm = haversineKm(pair.originLat, pair.originLon, pair.destLat, pair.destLon);
                                                const pct = odPairs && odPairs.totalTripsProcessed > 0
                                                    ? ((pair.count / odPairs.totalTripsProcessed) * 100).toFixed(2)
                                                    : '—';
                                                const isHighlighted = highlightedPairIdx === idx;
                                                return (
                                                    <tr
                                                        key={idx}
                                                        className={`border-t border-gray-100 cursor-pointer transition-colors ${
                                                            isHighlighted ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'
                                                        }`}
                                                        onClick={() => highlightArc(pair)}
                                                        onMouseEnter={() => highlightArc(pair)}
                                                        onMouseLeave={unhighlightArcs}
                                                    >
                                                        <td className="px-3 py-1.5 text-gray-400 font-medium">{idx + 1}</td>
                                                        <td className="px-3 py-1.5 text-gray-700">{originName}</td>
                                                        <td className="px-3 py-1.5 text-gray-700">{destName}</td>
                                                        <td className="px-3 py-1.5 text-right font-medium text-gray-900">{pair.count.toLocaleString()}</td>
                                                        <td className="px-3 py-1.5 text-right text-gray-500">{pct}%</td>
                                                        <td className="px-3 py-1.5 text-right text-gray-500">{distKm.toFixed(1)}</td>
                                                        {hasWeekdayData && <td className="px-3 py-1.5 text-right text-gray-500">{pair.weekdayCount ?? '—'}</td>}
                                                        {hasWeekdayData && <td className="px-3 py-1.5 text-right text-gray-500">{pair.weekendCount ?? '—'}</td>}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </>
            ) : (
                <div className="space-y-3">
                    {!allZonesMode && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Matrix is currently scoped to top {topN} pairs. Enable <span className="font-semibold">All zones</span> to review the full filtered OD network.
                        </div>
                    )}

                    <div className="border border-gray-200 rounded-lg overflow-auto">
                        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
                            OD matrix (top {matrixZoneHeaders.length} zones by combined demand)
                        </div>
                        <table className="min-w-full text-[11px]">
                            <thead>
                                <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[10px]">
                                    <th className="px-3 py-2 text-left sticky left-0 bg-gray-50 z-10">Origin \ Dest</th>
                                    {matrixZoneHeaders.map(zone => (
                                        <th key={zone.key} className="px-2 py-2 text-right min-w-[84px]">{zone.name}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {matrixZoneHeaders.map(origin => (
                                    <tr key={origin.key} className="border-t border-gray-100">
                                        <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white z-10">{origin.name}</td>
                                        {matrixZoneHeaders.map(dest => {
                                            const cellCount = matrixHeat.lookup.get(`${origin.key}|${dest.key}`) ?? 0;
                                            const intensity = matrixHeat.maxCell > 0 ? (cellCount / matrixHeat.maxCell) : 0;
                                            const bg = cellCount > 0 ? `rgba(17, 24, 39, ${0.05 + intensity * 0.7})` : 'transparent';
                                            const fg = intensity >= 0.42 ? '#ffffff' : '#374151';
                                            return (
                                                <td
                                                    key={`${origin.key}|${dest.key}`}
                                                    className="px-2 py-1.5 text-right tabular-nums"
                                                    style={{ backgroundColor: bg, color: fg }}
                                                >
                                                    {cellCount > 0 ? cellCount.toLocaleString() : '—'}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-2 flex-wrap">
                            <input
                                type="text"
                                value={matrixSearch}
                                onChange={e => setMatrixSearch(e.target.value)}
                                placeholder="Search origin or destination zone"
                                className="px-2 py-1.5 text-xs rounded border border-gray-200 min-w-[240px]"
                            />
                            <span className="text-xs text-gray-500">{matrixRows.length.toLocaleString()} pairs</span>
                            <span className="text-xs text-gray-400">Showing {matrixStartRow}-{matrixEndRow}</span>
                            <div className="ml-auto flex items-center gap-1">
                                <button
                                    onClick={() => setMatrixPage(p => Math.max(1, p - 1))}
                                    disabled={matrixCurrentPage <= 1}
                                    className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Prev
                                </button>
                                <span className="text-xs text-gray-500 px-1">{matrixCurrentPage} / {matrixPages}</span>
                                <button
                                    onClick={() => setMatrixPage(p => Math.min(matrixPages, p + 1))}
                                    disabled={matrixCurrentPage >= matrixPages}
                                    className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                        <div className="max-h-[420px] overflow-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-gray-50 z-10">
                                    <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
                                        <th className="px-3 py-2 text-left w-8">#</th>
                                        <th className="px-3 py-2 text-left">Origin</th>
                                        <th className="px-3 py-2 text-left">Destination</th>
                                        <th className="px-3 py-2 text-right">Trips</th>
                                        <th className="px-3 py-2 text-right">% Total</th>
                                        <th className="px-3 py-2 text-right">Dist (km)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrixPageRows.map((row, i) => (
                                        <tr
                                            key={`${row.originKey}|${row.destKey}|${row.idx}`}
                                            className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                                            onClick={() => {
                                                setPlannerView('map');
                                                setTimeout(() => {
                                                    const map = mapRef.current;
                                                    if (map) {
                                                        map.invalidateSize();
                                                        map.fitBounds(
                                                            [[row.pair.originLat, row.pair.originLon], [row.pair.destLat, row.pair.destLon]],
                                                            { padding: [32, 32], maxZoom: 14 }
                                                        );
                                                    }
                                                    highlightArc(row.pair);
                                                }, 90);
                                            }}
                                        >
                                            <td className="px-3 py-1.5 text-gray-400 font-medium">{matrixStartRow + i}</td>
                                            <td className="px-3 py-1.5 text-gray-700">{row.originName}</td>
                                            <td className="px-3 py-1.5 text-gray-700">{row.destName}</td>
                                            <td className="px-3 py-1.5 text-right font-medium text-gray-900">{row.pair.count.toLocaleString()}</td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{row.pct.toFixed(2)}%</td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{row.distKm.toFixed(1)}</td>
                                        </tr>
                                    ))}
                                    {matrixPageRows.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-3 py-6 text-center text-gray-400">No OD pairs match the current filter/search.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
