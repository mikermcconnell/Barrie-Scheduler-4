/**
 * OD Flow Map Module
 *
 * Transit-style OD map for matrix data:
 * - Curved rank-colored arcs
 * - Origin/destination zone markers with split-color proportional arcs
 * - Simple control bar + map/table toggle
 * - Canada guardrails for bad coordinates
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Marker, Popup } from 'react-map-gl/mapbox';
import type { MapRef, MapMouseEvent } from 'react-map-gl/mapbox';
import { AlertTriangle, Download, Search } from 'lucide-react';
import { ChartCard } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import type { ODRouteEstimationResult } from '../../utils/od-matrix/odRouteEstimation';
import { exportStopReportExcel } from '../../utils/od-matrix/odReportExporter';
import { buildStopRouteSummaryRows, getRoutePathLabel, getViaStopsLabel } from '../../utils/od-matrix/odStopRouteSummary';
import {
    buildScopedGeoLookup,
    filterODPairs,
    getGeocodedPairs,
    type ODDirectionFilter,
} from '../../utils/od-matrix/odFlowMapMetrics';
import { ArcLayer, MapBase, quadraticBezierArc } from '../shared';

interface ODFlowMapModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onFixMissingCoordinates?: () => void;
    onMapReady?: (el: HTMLDivElement) => void;
    isolatedStation: string | null;
    onIsolatedStationChange?: (station: string | null) => void;
    minJourneys: number;
    onMinJourneysChange?: (value: number) => void;
    directionFilter: ODDirectionFilter;
    onDirectionFilterChange?: (value: ODDirectionFilter) => void;
    routeEstimation?: ODRouteEstimationResult | null;
    routeEstimationLoading?: boolean;
}

type ViewMode = 'map' | 'table';
type TopNOption = 10 | 25 | 50 | 100 | 'all' | 'low10' | 'low25';

const TOP_N_OPTIONS: { value: TopNOption; label: string }[] = [
    { value: 10, label: 'Top 10' },
    { value: 25, label: 'Top 25' },
    { value: 50, label: 'Top 50' },
    { value: 100, label: 'Top 100' },
    { value: 'all', label: 'All' },
    { value: 'low25', label: 'Low 25' },
    { value: 'low10', label: 'Low 10' },
];

const ONTARIO_CENTER: [number, number] = [46.5, -80.5];
// Blue-indigo monochromatic arc palette — professional, readable on light OSM tiles
const ARC_COLORS = ['#1e3a8a', '#1e40af', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#475569'];
const MAX_VISIBLE_LABELS = 12;
const LABEL_ZOOM_THRESHOLD = 7;
const LABEL_COLLISION_RADIUS = 28;
const CLUSTER_RADIUS = 20;
const CLUSTER_ZOOM_THRESHOLD = 9;   // below this zoom, nearby markers merge
const ARC_LAYER_ID = 'od-flow-arcs-lines';
const MAP_STYLE = `
.od-flow-map .mapboxgl-ctrl-group {
    border: none !important;
    border-radius: 10px !important;
    overflow: hidden !important;
    box-shadow: 0 2px 10px rgba(15, 23, 42, 0.12) !important;
}
.od-flow-map .mapboxgl-ctrl-group button {
    background: rgba(255,255,255,0.94) !important;
    color: #475569 !important;
}
.od-flow-map .mapboxgl-ctrl-group button:hover {
    background: #ffffff !important;
    color: #111827 !important;
}
`;

function rankColor(rank: number): string {
    if (rank < ARC_COLORS.length) return ARC_COLORS[rank];
    // Fade from slate-500 (#64748b) to slate-400 (#94a3b8) for lower ranks
    const t = Math.min((rank - ARC_COLORS.length) / 18, 1);
    const r = Math.round(100 + t * 48);
    const g = Math.round(116 + t * 47);
    const b = Math.round(139 + t * 45);
    return `rgb(${r},${g},${b})`;
}

function volumeWeight(journeys: number, maxJourneys: number): number {
    const t = maxJourneys > 0 ? journeys / maxJourneys : 0;
    return 2 + t * 6; // range 2–8 px, capped tighter so arcs don't crowd the basemap
}

function labelSize(rank: number): number {
    if (rank <= 3) return 22;
    if (rank <= 7) return 18;
    return 16;
}

function labelOpacity(rank: number): number {
    if (rank <= 3) return 1.0;
    if (rank <= 7) return 0.9;
    return 0.75;
}

function labelBackground(rank: number): string {
    if (rank <= 3) return '#111827';
    if (rank <= 7) return '#1f2937';
    return '#374151';
}

function labelBorder(rank: number): string {
    if (rank <= 3) return '2px solid rgba(255,255,255,0.95)';
    return '1px solid rgba(255,255,255,0.8)';
}

function hasCollision(
    px: { x: number; y: number },
    placed: { x: number; y: number }[],
    minDistance: number
): boolean {
    for (const p of placed) {
        const dx = px.x - p.x;
        const dy = px.y - p.y;
        if (dx * dx + dy * dy < minDistance * minDistance) return true;
    }
    return false;
}

/** Truncates a station name to fit neatly in a map label pill. */
function truncateLabel(name: string, maxLen = 22): string {
    return name.length <= maxLen ? name : name.slice(0, maxLen - 1) + '\u2026';
}

/** Finds the nearest pixel position within `maxRadius` that doesn't collide with placed labels.
 *  Returns null if no clean position exists within the radius — caller should drop the label. */
function findNonCollidingPosition(
    idealPx: { x: number; y: number },
    placed: { x: number; y: number }[],
    minDistance: number,
    maxRadius = Infinity
): { x: number; y: number } | null {
    if (!hasCollision(idealPx, placed, minDistance)) return idealPx;

    const radii = [minDistance * 0.9, minDistance * 1.4, minDistance * 1.9, minDistance * 2.5];
    const angleSteps = 12;

    for (const radius of radii) {
        if (radius > maxRadius) break;
        for (let i = 0; i < angleSteps; i++) {
            const angle = (i / angleSteps) * 2 * Math.PI;
            const candidate = {
                x: idealPx.x + radius * Math.cos(angle),
                y: idealPx.y + radius * Math.sin(angle),
            };
            if (!hasCollision(candidate, placed, minDistance)) return candidate;
        }
    }

    return null; // No clean slot within maxRadius — caller should drop this label
}

interface ClusteredStation {
    lat: number;
    lon: number;
    names: string[];
    originTrips: number;
    destinationTrips: number;
    totalTrips: number;
}

/** Sqrt scaling gives better perceptual contrast than log10 between medium and high-volume stops. */
function sqrtRadius(total: number, maxTotal: number): number {
    const t = maxTotal > 0 ? Math.sqrt(total) / Math.sqrt(maxTotal) : 0;
    return 5 + t * 13; // range 5–18px
}

/** Returns SVG HTML for a proportional green (origin) / red (destination) split circle.
 *  Uses proper pie-slice <path> elements on a white disc — clean filled look, no donut effect. */
function splitColorSvg(originTrips: number, destTrips: number, size: number, isIsolated: boolean): string {
    const r = size / 2 - 1.5;
    const cx = size / 2;
    const cy = size / 2;
    const total = originTrips + destTrips;
    const bw = isIsolated ? 2.5 : 1.5;
    const shadow = isIsolated
        ? 'filter:drop-shadow(0 0 5px rgba(99,102,241,0.65))'
        : 'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.22))';

    // Polar helper: angle 0° = top, clockwise
    const toXY = (deg: number) => {
        const rad = (deg - 90) * Math.PI / 180;
        return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as [number, number];
    };
    const fmt = (n: number) => n.toFixed(2);

    if (total === 0 || originTrips === 0) {
        return `<svg width="${size}" height="${size}" style="${shadow}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ef4444"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${bw}"/></svg>`;
    }
    if (destTrips === 0) {
        return `<svg width="${size}" height="${size}" style="${shadow}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#10b981"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${bw}"/></svg>`;
    }

    const originAngle = (originTrips / total) * 360;
    const [gx1, gy1] = toXY(0);
    const [gx2, gy2] = toXY(originAngle);
    const [rx1, ry1] = [gx2, gy2];
    const [rx2, ry2] = toXY(360);
    const gLarge = originAngle > 180 ? 1 : 0;
    const rLarge = (360 - originAngle) > 180 ? 1 : 0;

    const greenPath = `M${fmt(cx)},${fmt(cy)} L${fmt(gx1)},${fmt(gy1)} A${fmt(r)},${fmt(r)} 0 ${gLarge} 1 ${fmt(gx2)},${fmt(gy2)} Z`;
    const redPath   = `M${fmt(cx)},${fmt(cy)} L${fmt(rx1)},${fmt(ry1)} A${fmt(r)},${fmt(r)} 0 ${rLarge} 1 ${fmt(rx2)},${fmt(ry2)} Z`;

    return `<svg width="${size}" height="${size}" style="${shadow}">
      <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="white"/>
      <path d="${greenPath}" fill="#10b981"/>
      <path d="${redPath}" fill="#ef4444"/>
      <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="#fff" stroke-width="${bw}"/>
    </svg>`;
}

/** Clusters stations by pixel proximity (descending trip volume, so dominant stops become cluster centers). */
function clusterStations(
    stationList: Array<{ name: string; geo: GeocodedLocation; originTrips: number; destinationTrips: number }>,
    project: (lat: number, lon: number) => { x: number; y: number },
    radius: number
): ClusteredStation[] {
    const clusters: ClusteredStation[] = [];
    const clusterPixels: { x: number; y: number }[] = [];

    for (const station of stationList) {
        const px = project(station.geo.lat, station.geo.lon);
        let assigned = false;
        for (let i = 0; i < clusters.length; i++) {
            const cpx = clusterPixels[i];
            const dx = px.x - cpx.x;
            const dy = px.y - cpx.y;
            if (dx * dx + dy * dy < radius * radius) {
                clusters[i].names.push(station.name);
                clusters[i].originTrips += station.originTrips;
                clusters[i].destinationTrips += station.destinationTrips;
                clusters[i].totalTrips += station.originTrips + station.destinationTrips;
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            clusters.push({
                lat: station.geo.lat,
                lon: station.geo.lon,
                names: [station.name],
                originTrips: station.originTrips,
                destinationTrips: station.destinationTrips,
                totalTrips: station.originTrips + station.destinationTrips,
            });
            clusterPixels.push({ x: px.x, y: px.y });
        }
    }
    return clusters;
}

function pairKey(value: string): string {
    return value.trim().toLowerCase();
}

function routeConfidenceBadgeClasses(confidence: 'high' | 'medium' | 'low' | 'none' | 'loading' | 'unavailable'): string {
    switch (confidence) {
        case 'high':
            return 'bg-emerald-100 text-emerald-700';
        case 'medium':
            return 'bg-amber-100 text-amber-700';
        case 'low':
            return 'bg-orange-100 text-orange-700';
        case 'none':
            return 'bg-red-100 text-red-700';
        case 'loading':
            return 'bg-slate-100 text-slate-600';
        default:
            return 'bg-gray-100 text-gray-600';
    }
}

function routeConfidenceLabel(confidence: 'high' | 'medium' | 'low' | 'none' | 'loading' | 'unavailable'): string {
    switch (confidence) {
        case 'none':
            return 'Unmatched';
        case 'loading':
            return 'Loading';
        case 'unavailable':
            return 'Unavailable';
        default:
            return confidence[0].toUpperCase() + confidence.slice(1);
    }
}

interface ArcPopupState {
    longitude: number;
    latitude: number;
    origin: string;
    destination: string;
    journeys: number;
    rank: number;
    routePath: string;
    viaStops: string;
}

function StopLabel({ text }: { text: string }) {
    return (
        <div
            className="pointer-events-none whitespace-nowrap text-[11px] font-bold text-slate-900"
            style={{
                letterSpacing: '0.01em',
                textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 6px #fff',
            }}
        >
            {text}
        </div>
    );
}

function BackgroundStopMarker({ isolated }: { isolated: boolean }) {
    return (
        <div
            style={{
                width: isolated ? 12 : 8,
                height: isolated ? 12 : 8,
                borderRadius: '9999px',
                background: isolated ? '#8b5cf6' : '#94a3b8',
                opacity: isolated ? 0.9 : 0.5,
                border: `${isolated ? 2 : 1}px solid ${isolated ? '#6d28d9' : '#64748b'}`,
                boxShadow: isolated ? '0 0 10px rgba(139,92,246,0.35)' : 'none',
            }}
        />
    );
}

function RankBadge({ rank }: { rank: number }) {
    const size = labelSize(rank);
    return (
        <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg">
            <circle
                cx={size / 2}
                cy={size / 2}
                r={size / 2 - 1}
                fill={labelBackground(rank)}
                stroke={rank <= 3 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)'}
                strokeWidth={rank <= 3 ? 2 : 1}
                opacity={labelOpacity(rank)}
            />
            <text
                x={size / 2}
                y={size / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={rank <= 3 ? 11 : 10}
                fontWeight="700"
                fontFamily="sans-serif"
                opacity={labelOpacity(rank)}
            >
                {rank}
            </text>
        </svg>
    );
}

function PulseRing({ size }: { size: number }) {
    return (
        <div
            className="rounded-full"
            style={{
                width: size,
                height: size,
                background: 'rgba(139,92,246,0.4)',
                animation: 'od-pulse 1.6s ease-out infinite',
            }}
        />
    );
}

// Suppress unused warnings — kept for potential future use
void MAX_VISIBLE_LABELS;
void LABEL_ZOOM_THRESHOLD;

export const ODFlowMapModule: React.FC<ODFlowMapModuleProps> = ({
    data,
    geocodeCache,
    onFixMissingCoordinates,
    onMapReady,
    isolatedStation,
    onIsolatedStationChange,
    minJourneys,
    onMinJourneysChange,
    directionFilter,
    onDirectionFilterChange,
    routeEstimation,
    routeEstimationLoading = false,
}) => {
    const mapHostRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MapRef | null>(null);

    const [viewMode, setViewMode] = useState<ViewMode>('map');
    const [topNOption, setTopNOption] = useState<TopNOption>(25);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showLabels, setShowLabels] = useState(true);
    const [currentZoom, setCurrentZoom] = useState(6);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; station: string } | null>(null);
    const mapWrapperRef = useRef<HTMLDivElement>(null);
    const [mapReady, setMapReady] = useState(false);
    const [arcPopup, setArcPopup] = useState<ArcPopupState | null>(null);

    // Suppress unused state warning — showLabels is a UI toggle kept for future use
    void showLabels;

    const { geoLookup, outsideCanadaStations } = useMemo((): {
        geoLookup: Record<string, GeocodedLocation>;
        outsideCanadaStations: string[];
    } => buildScopedGeoLookup(data.stations, geocodeCache), [data.stations, geocodeCache]);

    const geocodedCount = useMemo(
        () => data.stations.filter(station => !!geoLookup[station.name]).length,
        [data.stations, geoLookup],
    );
    const ungeocodedCount = Math.max(0, data.stationCount - geocodedCount);

    const geocodedPairs = useMemo(
        () => getGeocodedPairs(data.pairs, geoLookup),
        [data.pairs, geoLookup],
    );

    const filteredPairs = useMemo(() => filterODPairs({
        pairs: geocodedPairs,
        isolatedStation,
        directionFilter,
        minJourneys,
    }), [geocodedPairs, isolatedStation, directionFilter, minJourneys]);

    const displayedPairs = useMemo(() => {
        if (topNOption === 'all') return filteredPairs;
        if (topNOption === 'low10' || topNOption === 'low25') {
            const n = topNOption === 'low10' ? 10 : 25;
            return [...filteredPairs].reverse().slice(0, n);
        }
        return filteredPairs.slice(0, topNOption);
    }, [filteredPairs, topNOption]);

    const displayedTrips = useMemo(() => (
        displayedPairs.reduce((sum, pair) => sum + pair.journeys, 0)
    ), [displayedPairs]);

    const displayedPct = data.totalJourneys > 0
        ? (displayedTrips / data.totalJourneys) * 100
        : 0;
    const pairsMeetingThreshold = useMemo(
        () => filterODPairs({
            pairs: geocodedPairs,
            isolatedStation: null,
            directionFilter: 'all',
            minJourneys,
        }).length,
        [geocodedPairs, minJourneys]
    );
    const routeMatchLookup = useMemo(() => {
        const lookup = new Map<string, ODRouteEstimationResult['matches'][number]>();
        routeEstimation?.matches.forEach(match => {
            lookup.set(`${pairKey(match.origin)}|${pairKey(match.destination)}`, match);
        });
        return lookup;
    }, [routeEstimation]);
    const isolatedSummaryPairs = useMemo(() => (
        buildStopRouteSummaryRows({
            isolatedStation,
            pairs: geocodedPairs,
            minJourneys,
            directionFilter,
            routeEstimation,
            routeEstimationLoading,
        })
    ), [isolatedStation, geocodedPairs, minJourneys, directionFilter, routeEstimation, routeEstimationLoading]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return Object.keys(geoLookup)
            .filter(name => name.toLowerCase().includes(q))
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 15);
    }, [searchQuery, geoLookup]);

    // Close search dropdown on outside click
    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    // Close context menu on outside click
    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (mapWrapperRef.current && !mapWrapperRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    const zoneStats = useMemo(() => {
        const stats = new Map<string, { originTrips: number; destinationTrips: number }>();
        displayedPairs.forEach((pair) => {
            const originStats = stats.get(pair.origin) ?? { originTrips: 0, destinationTrips: 0 };
            originStats.originTrips += pair.journeys;
            stats.set(pair.origin, originStats);

            const destinationStats = stats.get(pair.destination) ?? { originTrips: 0, destinationTrips: 0 };
            destinationStats.destinationTrips += pair.journeys;
            stats.set(pair.destination, destinationStats);
        });
        return stats;
    }, [displayedPairs]);

    const stationList = useMemo(() => (
        Array.from(zoneStats.entries())
            .map(([name, stats]) => {
                const geo = geoLookup[name];
                if (!geo) return null;
                return { name, geo, originTrips: stats.originTrips, destinationTrips: stats.destinationTrips };
            })
            .filter((station): station is { name: string; geo: GeocodedLocation; originTrips: number; destinationTrips: number } => station !== null)
            .sort((a, b) => (b.originTrips + b.destinationTrips) - (a.originTrips + a.destinationTrips))
    ), [geoLookup, zoneStats]);

    const maxStationTotal = useMemo(
        () => stationList.length > 0 ? stationList[0].originTrips + stationList[0].destinationTrips : 1,
        [stationList]
    );

    const clusteredStations = useMemo(() => {
        if (stationList.length === 0) return [] as ClusteredStation[];
        if (!mapReady || !mapRef.current || currentZoom >= CLUSTER_ZOOM_THRESHOLD) {
            return stationList.map((station) => ({
                lat: station.geo.lat,
                lon: station.geo.lon,
                names: [station.name],
                originTrips: station.originTrips,
                destinationTrips: station.destinationTrips,
                totalTrips: station.originTrips + station.destinationTrips,
            }));
        }

        const map = mapRef.current.getMap();
        return clusterStations(
            stationList,
            (lat, lon) => {
                const point = map.project([lon, lat]);
                return { x: point.x, y: point.y };
            },
            CLUSTER_RADIUS
        );
    }, [currentZoom, mapReady, stationList]);

    const activeStations = useMemo(() => {
        const active = new Set<string>();
        displayedPairs.forEach((pair) => {
            if (geoLookup[pair.origin]) active.add(pair.origin);
            if (geoLookup[pair.destination]) active.add(pair.destination);
        });
        return active;
    }, [displayedPairs, geoLookup]);

    const backgroundStations = useMemo(() => (
        Object.entries(geoLookup)
            .filter(([name]) => !activeStations.has(name))
            .map(([name, geo]) => ({ name, geo }))
    ), [activeStations, geoLookup]);

    const rankedArcs = useMemo(() => {
        const maxJourneys = displayedPairs.length > 0 ? displayedPairs[0].journeys : 1;
        return displayedPairs.map((pair, index) => {
            const originGeo = geoLookup[pair.origin];
            const destinationGeo = geoLookup[pair.destination];
            if (!originGeo || !destinationGeo) return null;
            const rank = index + 1;
            const routeMatch = routeMatchLookup.get(`${pairKey(pair.origin)}|${pairKey(pair.destination)}`);
            return {
                rank,
                pair,
                routePath: getRoutePathLabel(routeMatch),
                viaStops: getViaStopsLabel(routeMatch),
                points: quadraticBezierArc(
                    [originGeo.lat, originGeo.lon],
                    [destinationGeo.lat, destinationGeo.lon],
                    rank % 2 === 0 ? 1 : -1
                ),
                arc: {
                    origin: [originGeo.lat, originGeo.lon] as [number, number],
                    dest: [destinationGeo.lat, destinationGeo.lon] as [number, number],
                    color: rankColor(rank - 1),
                    width: volumeWeight(pair.journeys, maxJourneys),
                    opacity: 0.68,
                    curveDirection: rank % 2 === 0 ? 1 as const : -1 as const,
                    properties: {
                        origin: pair.origin,
                        destination: pair.destination,
                        journeys: pair.journeys,
                        rank,
                        routePath: getRoutePathLabel(routeMatch),
                        viaStops: getViaStopsLabel(routeMatch),
                    },
                },
            };
        }).filter((item): item is NonNullable<typeof item> => item !== null);
    }, [displayedPairs, geoLookup, routeMatchLookup]);

    const stopLabels = useMemo(() => {
        if (!mapReady || !mapRef.current) return [] as Array<{ name: string; lat: number; lon: number }>;
        const map = mapRef.current.getMap();
        const labeledStopPx: { x: number; y: number }[] = [];

        return stationList.flatMap((station) => {
            const stationPx = map.project([station.geo.lon, station.geo.lat]);
            const px = { x: stationPx.x, y: stationPx.y };
            if (hasCollision(px, labeledStopPx, 50)) return [];
            labeledStopPx.push(px);
            return [{ name: truncateLabel(station.name), lat: station.geo.lat, lon: station.geo.lon }];
        });
    }, [mapReady, stationList, currentZoom]);

    const rankLabels = useMemo(() => {
        if (!mapReady || !mapRef.current) return [] as Array<{ rank: number; lat: number; lon: number }>;
        const map = mapRef.current.getMap();
        const labelCap = Math.min(rankedArcs.length, 25);
        const placedLabelPositions: { x: number; y: number }[] = [];

        return rankedArcs.flatMap((arcItem) => {
            if (arcItem.rank > labelCap) return [];
            const mid = arcItem.points[Math.floor(arcItem.points.length * 0.55)] || arcItem.points[Math.floor(arcItem.points.length / 2)];
            const idealPoint = map.project([mid[1], mid[0]]);
            const idealPx = { x: idealPoint.x, y: idealPoint.y };
            const labelPx = findNonCollidingPosition(idealPx, placedLabelPositions, LABEL_COLLISION_RADIUS, 65);
            if (labelPx === null) return [];
            placedLabelPositions.push(labelPx);
            const labelLngLat = map.unproject([labelPx.x, labelPx.y]);
            return [{ rank: arcItem.rank, lat: labelLngLat.lat, lon: labelLngLat.lng }];
        });
    }, [mapReady, rankedArcs, currentZoom]);

    const isolatedPulse = useMemo(() => {
        if (!isolatedStation) return null;
        const isolatedGeo = geoLookup[isolatedStation];
        if (!isolatedGeo) return null;
        const isolatedStats = zoneStats.get(isolatedStation);
        const isolatedTotal = isolatedStats ? isolatedStats.originTrips + isolatedStats.destinationTrips : 0;
        return {
            lat: isolatedGeo.lat,
            lon: isolatedGeo.lon,
            size: sqrtRadius(isolatedTotal, maxStationTotal) * 2 * 2.5,
        };
    }, [geoLookup, isolatedStation, maxStationTotal, zoneStats]);

    const handleStationContextMenu = useCallback((event: React.MouseEvent, station: string) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = mapWrapperRef.current?.getBoundingClientRect();
        if (!rect) return;
        setContextMenu({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            station,
        });
    }, []);

    const handleMapClick = useCallback((event: MapMouseEvent) => {
        setContextMenu(null);
        const feature = (event as unknown as { features?: { layer: { id: string }; properties?: Record<string, unknown> }[] }).features?.find((item: { layer: { id: string } }) => item.layer.id === ARC_LAYER_ID);
        if (!feature) {
            setArcPopup(null);
            return;
        }

        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        setArcPopup({
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
            origin: String(properties.origin ?? ''),
            destination: String(properties.destination ?? ''),
            journeys: Number(properties.journeys ?? 0),
            rank: Number(properties.rank ?? 0),
            routePath: String(properties.routePath ?? ''),
            viaStops: String(properties.viaStops ?? ''),
        });
    }, []);

    useEffect(() => {
        const map = mapRef.current?.getMap();
        if (!mapReady || !map) return;
        const onZoomEnd = () => setCurrentZoom(map.getZoom());
        map.on('zoomend', onZoomEnd);
        return () => {
            map.off('zoomend', onZoomEnd);
        };
    }, [mapReady]);

    useEffect(() => {
        if (!mapReady || !mapRef.current || displayedPairs.length === 0) return;
        const map = mapRef.current.getMap();
        const coords = displayedPairs.flatMap((pair) => {
            const originGeo = geoLookup[pair.origin];
            const destinationGeo = geoLookup[pair.destination];
            return [
                ...(originGeo ? [[originGeo.lon, originGeo.lat] as [number, number]] : []),
                ...(destinationGeo ? [[destinationGeo.lon, destinationGeo.lat] as [number, number]] : []),
            ];
        });
        const unique = coords.filter(
            (coord, index, list) => list.findIndex((other) => other[0] === coord[0] && other[1] === coord[1]) === index
        );

        const frameId = window.requestAnimationFrame(() => {
            map.resize();
            if (unique.length > 1) {
                const longitudes = unique.map((coord) => coord[0]);
                const latitudes = unique.map((coord) => coord[1]);
                map.fitBounds(
                    [
                        [Math.min(...longitudes), Math.min(...latitudes)],
                        [Math.max(...longitudes), Math.max(...latitudes)],
                    ],
                    { padding: 32, maxZoom: 13.75, duration: 0 }
                );
            } else if (unique.length === 1) {
                map.flyTo({ center: unique[0], zoom: 11.5, duration: 0 });
            } else {
                map.flyTo({ center: [ONTARIO_CENTER[1], ONTARIO_CENTER[0]], zoom: 6, duration: 0 });
            }
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [displayedPairs, geoLookup, mapReady]);

    useEffect(() => {
        if (viewMode !== 'map' || !mapReady || !mapRef.current) return;
        const timer = setTimeout(() => mapRef.current?.getMap().resize(), 80);
        return () => clearTimeout(timer);
    }, [viewMode, isFullscreen, mapReady]);

    useEffect(() => {
        if (!isFullscreen) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsFullscreen(false);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = prevOverflow;
        };
    }, [isFullscreen]);

    if (geocodedCount === 0) {
        return (
            <ChartCard title="Origin-Destination Map" subtitle="No valid station coordinates to render">
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <AlertTriangle size={32} className="mb-3 text-amber-400" />
                    <p className="font-medium text-gray-600">No Geocoded Stations</p>
                    <p className="text-sm mt-1">Import with geocoding and add manual coordinates for missing stops.</p>
                </div>
            </ChartCard>
        );
    }

    useEffect(() => {
        if (mapReady && mapHostRef.current) {
            onMapReady?.(mapHostRef.current);
        }
    }, [mapReady, onMapReady]);

    return (
        <>
            <style>{`
                @keyframes od-pulse { 0%{transform:scale(1);opacity:.8} 70%{transform:scale(2.8);opacity:0} 100%{transform:scale(2.8);opacity:0} }
                ${MAP_STYLE}
            `}</style>
            <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 uppercase tracking-wide">Pairs</label>
                        <select
                            value={topNOption}
                            onChange={(e) => {
                                const v = e.target.value;
                                setTopNOption(
                                    v === 'all' || v === 'low10' || v === 'low25'
                                        ? v
                                        : Number(v) as TopNOption
                                );
                            }}
                            className="px-2 py-1.5 text-xs font-medium border border-gray-200 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        >
                            {TOP_N_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 uppercase tracking-wide">Threshold</label>
                        <input
                            type="range"
                            min={1}
                            max={Math.max(1, Math.min(2000, geocodedPairs[0]?.journeys || 1))}
                            step={1}
                            value={minJourneys}
                            onChange={(e) => onMinJourneysChange?.(Number(e.target.value))}
                            className="w-28 accent-gray-900"
                        />
                        <span className="text-sm font-medium text-gray-700 w-14 text-right">{minJourneys.toLocaleString()}</span>
                    </div>

                    <div className={`flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden bg-white ${!isolatedStation ? 'opacity-50' : ''}`}>
                        {(['all', 'outbound', 'inbound'] as const).map(dir => (
                            <button
                                key={dir}
                                onClick={() => onDirectionFilterChange?.(dir)}
                                disabled={!isolatedStation}
                                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                    directionFilter === dir
                                        ? 'bg-gray-900 text-white'
                                        : 'text-gray-500 hover:bg-gray-50'
                                } disabled:cursor-not-allowed`}
                            >
                                {dir === 'all' ? 'All' : dir === 'outbound' ? 'Outbound' : 'Inbound'}
                            </button>
                        ))}
                    </div>

                    <div className="relative" ref={dropdownRef}>
                        <div className="flex items-center gap-1.5 border border-gray-200 rounded-md bg-white px-2 py-1">
                            <Search size={13} className="text-gray-400 shrink-0" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                placeholder="Search stops..."
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setShowDropdown(true);
                                }}
                                onFocus={() => { if (searchQuery.trim()) setShowDropdown(true); }}
                                className="w-36 text-xs bg-transparent outline-none placeholder:text-gray-400"
                            />
                        </div>
                        {showDropdown && searchResults.length > 0 && (
                            <div className="absolute top-full left-0 mt-1 w-64 max-h-60 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                {searchResults.map(name => (
                                    <button
                                        key={name}
                                        onClick={() => {
                                            onIsolatedStationChange?.(name);
                                            onDirectionFilterChange?.('all');
                                            setSearchQuery('');
                                            setShowDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 truncate"
                                    >
                                        {name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="ml-auto flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden bg-white">
                        <button
                            onClick={() => setViewMode('map')}
                            className={`px-3 py-1.5 text-xs font-medium ${viewMode === 'map' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            Map
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`px-3 py-1.5 text-xs font-medium ${viewMode === 'table' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            Table
                        </button>
                    </div>
                </div>

                <div className="mt-2 text-xs text-gray-500">
                    {displayedPairs.length.toLocaleString()} pairs · {displayedTrips.toLocaleString()} trips · {displayedPct.toFixed(1)}% of total
                    {isolatedStation && (
                        <span className="ml-2 inline-flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-violet-100 border border-violet-200 text-violet-800 font-medium">
                                Filtered stop: {isolatedStation}
                            </span>
                            <button
                                onClick={() => {
                                    onIsolatedStationChange?.(null);
                                    onDirectionFilterChange?.('all');
                                }}
                                className="px-2.5 py-0.5 rounded-md bg-violet-700 text-white font-semibold hover:bg-violet-800"
                            >
                                Clear stop filter
                            </button>
                        </span>
                    )}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                    Threshold = minimum trips required for an OD pair to appear on the map/table.
                    Current threshold ({minJourneys.toLocaleString()}) keeps {pairsMeetingThreshold.toLocaleString()} of {geocodedPairs.length.toLocaleString()} geocoded pairs.
                </div>
            </div>

            <div className={isFullscreen ? 'fixed inset-3 z-[80] bg-white rounded-xl border border-gray-200 shadow-2xl p-3 overflow-auto' : ''}>
                <ChartCard
                    title="Origin-Destination Map"
                    subtitle={`${displayedPairs.length.toLocaleString()} flow lines · ${geocodedCount.toLocaleString()} geocoded stations · ${displayedTrips.toLocaleString()} trips shown`}
                    headerExtra={(
                        <button
                            onClick={() => setIsFullscreen(prev => !prev)}
                            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-50"
                        >
                            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        </button>
                    )}
                >
                    {outsideCanadaStations.length > 0 && (
                    <div className="mb-3 px-4 py-3 border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg">
                        Out-of-Canada coordinates excluded: {outsideCanadaStations.slice(0, 8).join(', ')}
                        {outsideCanadaStations.length > 8 ? ', ...' : ''}. Use Fix coordinates to correct them.
                    </div>
                )}

                    {ungeocodedCount > 0 && (
                        <div className="mb-3 px-4 py-2.5 border border-amber-200 bg-amber-50 rounded-lg flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between text-sm text-amber-700 mb-1.5">
                                    <span className="font-medium">{geocodedCount}/{data.stationCount} stations geocoded</span>
                                    <span className="text-xs">{((geocodedCount / data.stationCount) * 100).toFixed(1)}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-amber-200 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-amber-500 rounded-full transition-all"
                                        style={{ width: `${(geocodedCount / data.stationCount) * 100}%` }}
                                    />
                                </div>
                            </div>
                            {onFixMissingCoordinates && (
                                <button
                                    onClick={onFixMissingCoordinates}
                                    className="shrink-0 px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                                >
                                    Fix {ungeocodedCount} missing
                                </button>
                            )}
                        </div>
                    )}

                    {displayedPairs.length === 0 && (
                        <div className="mb-3 px-4 py-2.5 border border-amber-200 bg-amber-50 text-amber-700 text-sm rounded-lg">
                            No OD flows match current filters.
                        </div>
                    )}

                    <div
                        className={viewMode === 'map' ? 'block' : 'hidden'}
                        aria-hidden={viewMode !== 'map'}
                    >
                        <div className="relative" ref={mapWrapperRef}>
                            <div
                                ref={mapHostRef}
                                className="od-flow-map rounded-lg overflow-hidden border border-gray-200"
                                style={{ height: isFullscreen ? 'calc(100vh - 220px)' : 560 }}
                            >
                                <MapBase
                                    mapRef={mapRef}
                                    latitude={ONTARIO_CENTER[0]}
                                    longitude={ONTARIO_CENTER[1]}
                                    zoom={6}
                                    mapStyle="mapbox://styles/mapbox/light-v11"
                                    showNavigation={true}
                                    interactiveLayerIds={[ARC_LAYER_ID]}
                                    onClick={handleMapClick}
                                    onLoad={() => {
                                        setMapReady(true);
                                        setCurrentZoom(mapRef.current?.getMap().getZoom() ?? 6);
                                    }}
                                >
                                    <ArcLayer arcs={rankedArcs.map((item) => item.arc)} idPrefix="od-flow-arcs" />

                                    {isolatedPulse && (
                                        <Marker longitude={isolatedPulse.lon} latitude={isolatedPulse.lat} anchor="center">
                                            <PulseRing size={isolatedPulse.size} />
                                        </Marker>
                                    )}

                                    {backgroundStations.map(({ name, geo }) => (
                                        <Marker key={`bg-${name}`} longitude={geo.lon} latitude={geo.lat} anchor="center">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onIsolatedStationChange?.(isolatedStation === name ? null : name);
                                                    onDirectionFilterChange?.('all');
                                                }}
                                                onContextMenu={(event) => handleStationContextMenu(event, name)}
                                                className="border-0 bg-transparent p-0"
                                                title={name}
                                            >
                                                <BackgroundStopMarker isolated={isolatedStation === name} />
                                            </button>
                                        </Marker>
                                    ))}

                                    {clusteredStations.map((cluster) => {
                                        const isSingleStation = cluster.names.length === 1;
                                        const stationName = cluster.names[0];
                                        const isIsolated = isSingleStation && isolatedStation === stationName;
                                        const size = Math.max(10, Math.round(sqrtRadius(cluster.totalTrips, maxStationTotal) * 2));
                                        const title = isSingleStation
                                            ? `${stationName} | Origin: ${cluster.originTrips.toLocaleString()} | Destination: ${cluster.destinationTrips.toLocaleString()}`
                                            : `${cluster.names.length} stations | ${cluster.names.slice(0, 4).join(', ')}${cluster.names.length > 4 ? '...' : ''}`;

                                        return (
                                            <Marker
                                                key={`cluster-${cluster.names.join('|')}`}
                                                longitude={cluster.lon}
                                                latitude={cluster.lat}
                                                anchor="center"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (isSingleStation) {
                                                            onIsolatedStationChange?.(isolatedStation === stationName ? null : stationName);
                                                            return;
                                                        }
                                                        const zoom = mapRef.current?.getMap().getZoom() ?? 8;
                                                        mapRef.current?.getMap().flyTo({
                                                            center: [cluster.lon, cluster.lat],
                                                            zoom: zoom + 2,
                                                        });
                                                    }}
                                                    onContextMenu={isSingleStation ? (event) => handleStationContextMenu(event, stationName) : undefined}
                                                    className="border-0 bg-transparent p-0"
                                                    title={title}
                                                >
                                                    <div
                                                        dangerouslySetInnerHTML={{
                                                            __html: splitColorSvg(cluster.originTrips, cluster.destinationTrips, size, isIsolated),
                                                        }}
                                                    />
                                                </button>
                                            </Marker>
                                        );
                                    })}

                                    {stopLabels.map((label) => (
                                        <Marker key={`label-${label.name}-${label.lat}-${label.lon}`} longitude={label.lon} latitude={label.lat} anchor="bottom">
                                            <div className="-translate-y-1/2">
                                                <StopLabel text={label.name} />
                                            </div>
                                        </Marker>
                                    ))}

                                    {rankLabels.map((label) => (
                                        <Marker key={`rank-${label.rank}-${label.lat}-${label.lon}`} longitude={label.lon} latitude={label.lat} anchor="center">
                                            <RankBadge rank={label.rank} />
                                        </Marker>
                                    ))}

                                    {arcPopup && (
                                        <Popup
                                            longitude={arcPopup.longitude}
                                            latitude={arcPopup.latitude}
                                            anchor="bottom"
                                            closeButton={true}
                                            closeOnClick={false}
                                            onClose={() => setArcPopup(null)}
                                            maxWidth="240px"
                                        >
                                            <div style={{ minWidth: 190 }}>
                                                <div style={{ fontWeight: 600 }}>{arcPopup.origin} {'->'} {arcPopup.destination}</div>
                                                <div style={{ color: '#555', marginTop: 3 }}>{arcPopup.journeys.toLocaleString()} trips</div>
                                                {arcPopup.routePath && (
                                                    <div style={{ color: '#374151', marginTop: 4 }}>
                                                        <span style={{ fontWeight: 600 }}>Route:</span> {arcPopup.routePath}
                                                    </div>
                                                )}
                                                {arcPopup.viaStops && (
                                                    <div style={{ color: '#6b7280', marginTop: 2 }}>
                                                        <span style={{ fontWeight: 600 }}>Via:</span> {arcPopup.viaStops}
                                                    </div>
                                                )}
                                                <div style={{ color: '#777', marginTop: 2 }}>Rank #{arcPopup.rank}</div>
                                            </div>
                                        </Popup>
                                    )}
                                </MapBase>
                            </div>
                            {contextMenu && (
                                <div
                                    className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-xs min-w-[140px]"
                                    style={{ left: contextMenu.x + 8, top: contextMenu.y + 8 }}
                                >
                                    <div className="px-3 py-1 font-semibold text-gray-700 border-b border-gray-100 truncate max-w-[160px]">
                                        {contextMenu.station}
                                    </div>
                                    <button
                                        onClick={() => {
                                            onIsolatedStationChange?.(contextMenu.station);
                                            onDirectionFilterChange?.('outbound');
                                            setContextMenu(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                                    >
                                        Outbound only
                                    </button>
                                    <button
                                        onClick={() => {
                                            onIsolatedStationChange?.(contextMenu.station);
                                            onDirectionFilterChange?.('inbound');
                                            setContextMenu(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                                    >
                                        Inbound only
                                    </button>
                                    <button
                                        onClick={() => {
                                            onIsolatedStationChange?.(null);
                                            onDirectionFilterChange?.('all');
                                            setContextMenu(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                                    >
                                        Clear filter
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div
                        className={viewMode === 'table' ? 'overflow-auto border border-gray-200 rounded-lg' : 'hidden'}
                        aria-hidden={viewMode !== 'table'}
                        style={viewMode === 'table' ? { maxHeight: isFullscreen ? 'calc(100vh - 220px)' : 560 } : undefined}
                    >
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-gray-50 z-10">
                                <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
                                    <th className="px-3 py-2 text-left w-10">#</th>
                                    <th className="px-3 py-2 text-left">Origin</th>
                                    <th className="px-3 py-2 text-left">Destination</th>
                                    <th className="px-3 py-2 text-right">Trips</th>
                                    <th className="px-3 py-2 text-right">% Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayedPairs.map((pair, index) => (
                                    <tr key={`${pair.origin}|${pair.destination}|${index}`} className="border-t border-gray-100 hover:bg-gray-50">
                                        <td className="px-3 py-1.5 text-gray-400">{index + 1}</td>
                                        <td className="px-3 py-1.5 text-gray-700">{pair.origin}</td>
                                        <td className="px-3 py-1.5 text-gray-700">{pair.destination}</td>
                                        <td className="px-3 py-1.5 text-right font-medium text-gray-900">{pair.journeys.toLocaleString()}</td>
                                        <td className="px-3 py-1.5 text-right text-gray-500">
                                            {data.totalJourneys > 0 ? ((pair.journeys / data.totalJourneys) * 100).toFixed(2) : '0.00'}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {viewMode === 'map' && isolatedStation && (
                        <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 flex items-center justify-between">
                                <span>
                                    Stop route summary for <span className="font-semibold text-gray-800">{isolatedStation}</span> · {isolatedSummaryPairs.length} pair{isolatedSummaryPairs.length === 1 ? '' : 's'} (min journeys filter applied)
                                </span>
                                {isolatedSummaryPairs.length > 0 && (
                                    <button
                                        onClick={() => exportStopReportExcel(data, isolatedStation, routeEstimation)}
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-white hover:text-gray-800 transition-colors"
                                    >
                                        <Download size={11} />
                                        Export Stop
                                    </button>
                                )}
                            </div>
                            <div className="overflow-auto" style={{ maxHeight: 260 }}>
                                {isolatedSummaryPairs.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-gray-500">No pairs match the current threshold for this stop.</div>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead className="sticky top-0 bg-gray-50 z-10">
                                            <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
                                                <th className="px-3 py-2 text-left w-10">#</th>
                                                <th className="px-3 py-2 text-left">Direction</th>
                                                <th className="px-3 py-2 text-left">Counterpart Stop</th>
                                                <th className="px-3 py-2 text-left">Route Taken</th>
                                                <th className="px-3 py-2 text-left">Via</th>
                                                <th className="px-3 py-2 text-right">Trips</th>
                                                <th className="px-3 py-2 text-right">% of Stop Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {isolatedSummaryPairs.map((row) => (
                                                <tr key={`${isolatedStation}|${row.counterpart}|${row.rank}`} className="border-t border-gray-100 hover:bg-gray-50">
                                                    <td className="px-3 py-1.5 text-gray-400">{row.rank}</td>
                                                    <td className="px-3 py-1.5">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${row.direction === 'Outbound' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                            {row.direction}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-1.5 text-gray-700">{row.counterpart}</td>
                                                    <td className="px-3 py-1.5 text-gray-700">
                                                        <div className="min-w-[220px]">
                                                            <div className={row.routePath ? 'font-medium text-gray-900' : 'text-gray-500'}>
                                                                {row.routePath || (row.confidence === 'loading' ? 'Loading route assignment...' : 'No resolved route')}
                                                            </div>
                                                            <span className={`mt-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${routeConfidenceBadgeClasses(row.confidence)}`}>
                                                                {routeConfidenceLabel(row.confidence)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-1.5 text-gray-600">{row.viaStops || '\u2014'}</td>
                                                    <td className="px-3 py-1.5 text-right font-medium text-gray-900">{row.journeys.toLocaleString()}</td>
                                                    <td className="px-3 py-1.5 text-right text-gray-600">{row.stopShare.toFixed(2)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-500">
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                            <svg width="16" height="16" viewBox="0 0 14 14" className="shrink-0">
                                <path d="M2,7 A5,5 0 0,0 12,7 Z" fill="#10b981" />
                                <path d="M2,7 A5,5 0 0,1 12,7 Z" fill="#ef4444" />
                                <circle cx="7" cy="7" r="5" fill="none" stroke="white" strokeWidth="1.5" />
                            </svg>
                            <div>
                                <span className="text-[10px] font-medium text-gray-700 block leading-tight">Stops</span>
                                <span className="text-[10px] text-gray-400 leading-tight">
                                    <span className="text-emerald-600">Green</span> origin · <span className="text-red-500">Red</span> dest
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                            <span className="w-10 h-2.5 rounded shrink-0" style={{ background: `linear-gradient(to right, ${ARC_COLORS[0]}, ${ARC_COLORS[3]}, ${ARC_COLORS[5]}, #94a3b8)` }} />
                            <div>
                                <span className="text-[10px] font-medium text-gray-700 block leading-tight">Arc Color</span>
                                <span className="text-[10px] text-gray-400 leading-tight">Rank #1 dark → lower light</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                            <svg width="32" height="12" viewBox="0 0 32 12" className="shrink-0">
                                <line x1="0" y1="3" x2="32" y2="3" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                                <line x1="0" y1="9" x2="32" y2="9" stroke="#6b7280" strokeWidth="4" strokeLinecap="round" />
                            </svg>
                            <div>
                                <span className="text-[10px] font-medium text-gray-700 block leading-tight">Arc Width</span>
                                <span className="text-[10px] text-gray-400 leading-tight">Proportional to volume</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                            <span className="text-[11px] text-gray-400 font-mono shrink-0">R-click</span>
                            <div>
                                <span className="text-[10px] font-medium text-gray-700 block leading-tight">Direction Filter</span>
                                <span className="text-[10px] text-gray-400 leading-tight">Right-click any stop</span>
                            </div>
                        </div>
                    </div>
                </ChartCard>
            </div>
            </div>
        </>
    );
};
