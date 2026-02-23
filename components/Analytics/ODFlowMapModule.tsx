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
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle, Download, Search } from 'lucide-react';
import { ChartCard } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import { isWithinCanada } from '../../utils/od-matrix/odMatrixGeocoder';
import { exportStopReportExcel } from '../../utils/od-matrix/odReportExporter';

interface ODFlowMapModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onFixMissingCoordinates?: () => void;
    onMapReady?: (el: HTMLDivElement) => void;
    onIsolatedStationChange?: (station: string | null) => void;
}

type ViewMode = 'map' | 'table';
type TopNOption = 10 | 25 | 50 | 100 | 'all';
type DirectionFilter = 'all' | 'inbound' | 'outbound';

const TOP_N_OPTIONS: { value: TopNOption; label: string }[] = [
    { value: 10, label: 'Top 10' },
    { value: 25, label: 'Top 25' },
    { value: 50, label: 'Top 50' },
    { value: 100, label: 'Top 100' },
    { value: 'all', label: 'All' },
];

const ONTARIO_CENTER: [number, number] = [46.5, -80.5];
// Blue-indigo monochromatic arc palette — professional, readable on light OSM tiles
const ARC_COLORS = ['#1e3a8a', '#1e40af', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#475569'];
const MAX_VISIBLE_LABELS = 12;
const LABEL_ZOOM_THRESHOLD = 7;
const LABEL_COLLISION_RADIUS = 28;
const CLUSTER_RADIUS = 20;
const CLUSTER_ZOOM_THRESHOLD = 9;   // below this zoom, nearby markers merge

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
    map: L.Map,
    radius: number
): ClusteredStation[] {
    const clusters: ClusteredStation[] = [];
    const clusterPixels: { x: number; y: number }[] = [];

    for (const station of stationList) {
        const px = map.latLngToContainerPoint(L.latLng(station.geo.lat, station.geo.lon));
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

function quadraticBezierArc(
    origin: [number, number],
    dest: [number, number],
    curveDirection: 1 | -1 = 1,
    segments = 16
): [number, number][] {
    const midLat = (origin[0] + dest[0]) / 2;
    const midLon = (origin[1] + dest[1]) / 2;
    const dLat = dest[0] - origin[0];
    const dLon = dest[1] - origin[1];
    const offsetLat = midLat + dLon * 0.18 * curveDirection;
    const offsetLon = midLon - dLat * 0.18 * curveDirection;

    const points: [number, number][] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const u = 1 - t;
        points.push([
            u * u * origin[0] + 2 * u * t * offsetLat + t * t * dest[0],
            u * u * origin[1] + 2 * u * t * offsetLon + t * t * dest[1],
        ]);
    }
    return points;
}

// Suppress unused warnings — kept for potential future use
void MAX_VISIBLE_LABELS;
void LABEL_ZOOM_THRESHOLD;

export const ODFlowMapModule: React.FC<ODFlowMapModuleProps> = ({
    data,
    geocodeCache,
    onFixMissingCoordinates,
    onMapReady,
    onIsolatedStationChange,
}) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layersRef = useRef<L.LayerGroup | null>(null);
    const styleRef = useRef<HTMLStyleElement | null>(null);

    const [viewMode, setViewMode] = useState<ViewMode>('map');
    const [topNOption, setTopNOption] = useState<TopNOption>(25);
    const [minJourneys, setMinJourneys] = useState(1);
    const [isolatedStation, setIsolatedStation] = useState<string | null>(null);
    const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const labelLayerRef = useRef<L.LayerGroup | null>(null);
    const lastFitBoundsKeyRef = useRef('');
    const [showLabels, setShowLabels] = useState(true);
    const [currentZoom, setCurrentZoom] = useState(6);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; station: string } | null>(null);
    const mapWrapperRef = useRef<HTMLDivElement>(null);

    // Suppress unused state warning — showLabels is a UI toggle kept for future use
    void showLabels;
    void lastFitBoundsKeyRef;

    useEffect(() => {
        onIsolatedStationChange?.(isolatedStation);
    }, [isolatedStation, onIsolatedStationChange]);

    const { geoLookup, outsideCanadaStations } = useMemo((): {
        geoLookup: Record<string, GeocodedLocation>;
        outsideCanadaStations: string[];
    } => {
        const lookup: Record<string, GeocodedLocation> = {};
        const outside = new Set<string>();

        if (geocodeCache?.stations) {
            Object.entries(geocodeCache.stations).forEach(([name, loc]) => {
                if (isWithinCanada(loc.lat, loc.lon)) lookup[name] = loc;
                else outside.add(name);
            });
        }

        data.stations.forEach((station) => {
            if (!station.geocode) return;
            if (isWithinCanada(station.geocode.lat, station.geocode.lon)) lookup[station.name] = station.geocode;
            else outside.add(station.name);
        });

        return {
            geoLookup: lookup,
            outsideCanadaStations: Array.from(outside).sort(),
        };
    }, [data.stations, geocodeCache]);

    const geocodedCount = useMemo(() => Object.keys(geoLookup).length, [geoLookup]);
    const ungeocodedCount = Math.max(0, data.stationCount - geocodedCount);

    const geocodedPairs = useMemo(() => (
        data.pairs
            .filter(pair => geoLookup[pair.origin] && geoLookup[pair.destination])
            .sort((a, b) => b.journeys - a.journeys)
    ), [data.pairs, geoLookup]);

    const filteredPairs = useMemo(() => {
        let pairs = geocodedPairs.filter(pair => pair.journeys >= minJourneys);
        if (isolatedStation) {
            pairs = pairs.filter(pair => pair.origin === isolatedStation || pair.destination === isolatedStation);
            if (directionFilter === 'outbound') {
                pairs = pairs.filter(pair => pair.origin === isolatedStation);
            } else if (directionFilter === 'inbound') {
                pairs = pairs.filter(pair => pair.destination === isolatedStation);
            }
        }
        return pairs;
    }, [geocodedPairs, minJourneys, isolatedStation, directionFilter]);

    const displayedPairs = useMemo(() => {
        if (topNOption === 'all') return filteredPairs;
        return filteredPairs.slice(0, topNOption);
    }, [filteredPairs, topNOption]);

    const displayedTrips = useMemo(() => (
        displayedPairs.reduce((sum, pair) => sum + pair.journeys, 0)
    ), [displayedPairs]);

    const displayedPct = data.totalJourneys > 0
        ? (displayedTrips / data.totalJourneys) * 100
        : 0;
    const pairsMeetingThreshold = useMemo(
        () => geocodedPairs.filter(pair => pair.journeys >= minJourneys).length,
        [geocodedPairs, minJourneys]
    );
    const isolatedSummaryPairs = useMemo(() => {
        if (!isolatedStation) return [] as Array<{
            rank: number;
            direction: 'Outbound' | 'Inbound';
            counterpart: string;
            journeys: number;
            stopShare: number;
        }>;

        const pairs = geocodedPairs
            .filter(pair => (
                pair.journeys >= minJourneys
                && (pair.origin === isolatedStation || pair.destination === isolatedStation)
            ))
            .sort((a, b) => b.journeys - a.journeys);

        const stopTrips = pairs.reduce((sum, pair) => sum + pair.journeys, 0);

        return pairs.map((pair, index) => {
            const outbound = pair.origin === isolatedStation;
            return {
                rank: index + 1,
                direction: outbound ? 'Outbound' : 'Inbound',
                counterpart: outbound ? pair.destination : pair.origin,
                journeys: pair.journeys,
                stopShare: stopTrips > 0 ? (pair.journeys / stopTrips) * 100 : 0,
            };
        });
    }, [isolatedStation, geocodedPairs, minJourneys]);

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

    useEffect(() => {
        if (!isolatedStation) setDirectionFilter('all');
    }, [isolatedStation]);

    // Map initialization
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        mapRef.current = L.map(mapContainerRef.current, {
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            scrollWheelZoom: 'center',
            preferCanvas: true,
        }).setView(ONTARIO_CENTER, 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 18,
            opacity: 0.8,
            crossOrigin: 'anonymous',
        } as L.TileLayerOptions).addTo(mapRef.current);

        if (onMapReady && mapContainerRef.current) {
            onMapReady(mapContainerRef.current);
        }

        // Pane z-index stack: lines → pulse ring → stops → stop labels → rank labels
        const linesPane = mapRef.current.createPane('od-lines');
        linesPane.style.zIndex = '420';
        const pulsePane = mapRef.current.createPane('od-pulse');
        pulsePane.style.zIndex = '425';
        pulsePane.style.pointerEvents = 'none';
        const stopsPane = mapRef.current.createPane('od-stops');
        stopsPane.style.zIndex = '430';
        const stopLabelsPane = mapRef.current.createPane('od-stop-labels');
        stopLabelsPane.style.zIndex = '435';
        stopLabelsPane.style.pointerEvents = 'none';
        const rankLabelsPane = mapRef.current.createPane('od-rank-labels');
        rankLabelsPane.style.zIndex = '440';

        // Inject pulse animation CSS once
        const style = document.createElement('style');
        style.textContent = `
          @keyframes od-pulse { 0%{transform:scale(1);opacity:.8} 70%{transform:scale(2.8);opacity:0} 100%{transform:scale(2.8);opacity:0} }
          .od-pulse-ring { animation: od-pulse 1.6s ease-out infinite; border-radius:50%; }
          .od-label-icon { background: transparent !important; border: none !important; }
`;
        document.head.appendChild(style);
        styleRef.current = style;

        layersRef.current = L.layerGroup().addTo(mapRef.current);
        labelLayerRef.current = L.layerGroup().addTo(mapRef.current);

        return () => {
            if (styleRef.current) {
                document.head.removeChild(styleRef.current);
                styleRef.current = null;
            }
            mapRef.current?.remove();
            mapRef.current = null;
            layersRef.current = null;
            labelLayerRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        let timer: ReturnType<typeof setTimeout>;
        const onZoomEnd = () => {
            clearTimeout(timer);
            timer = setTimeout(() => setCurrentZoom(map.getZoom()), 300);
        };
        map.on('zoomend', onZoomEnd);
        return () => {
            map.off('zoomend', onZoomEnd);
            clearTimeout(timer);
        };
    }, []);

    const renderLayers = useCallback(() => {
        if (!mapRef.current || !layersRef.current) return;
        layersRef.current.clearLayers();

        // Build per-station origin/destination tallies from visible pairs
        const zoneStats = new Map<string, { originTrips: number; destinationTrips: number }>();
        displayedPairs.forEach((pair) => {
            const originStats = zoneStats.get(pair.origin) || { originTrips: 0, destinationTrips: 0 };
            originStats.originTrips += pair.journeys;
            zoneStats.set(pair.origin, originStats);

            const destinationStats = zoneStats.get(pair.destination) || { originTrips: 0, destinationTrips: 0 };
            destinationStats.destinationTrips += pair.journeys;
            zoneStats.set(pair.destination, destinationStats);
        });

        // Build station list sorted by totalTrips descending (dominant stops become cluster centers)
        const stationList = Array.from(zoneStats.entries())
            .map(([name, stats]) => {
                const geo = geoLookup[name];
                if (!geo) return null;
                return { name, geo, originTrips: stats.originTrips, destinationTrips: stats.destinationTrips };
            })
            .filter((s): s is { name: string; geo: GeocodedLocation; originTrips: number; destinationTrips: number } => s !== null)
            .sort((a, b) => (b.originTrips + b.destinationTrips) - (a.originTrips + a.destinationTrips));

        const maxTotal = stationList.length > 0
            ? stationList[0].originTrips + stationList[0].destinationTrips
            : 1;

        // Cluster at low zoom to reduce clutter; use individual stations otherwise
        const clusters: ClusteredStation[] = currentZoom < CLUSTER_ZOOM_THRESHOLD
            ? clusterStations(stationList, mapRef.current, CLUSTER_RADIUS)
            : stationList.map(s => ({
                lat: s.geo.lat,
                lon: s.geo.lon,
                names: [s.name],
                originTrips: s.originTrips,
                destinationTrips: s.destinationTrips,
                totalTrips: s.originTrips + s.destinationTrips,
            }));

        const coords: [number, number][] = [];

        // Pulse ring for isolated stop (od-pulse pane renders behind the stop dot)
        if (isolatedStation) {
            const isolatedGeo = geoLookup[isolatedStation];
            if (isolatedGeo) {
                const isolatedStats = zoneStats.get(isolatedStation);
                const isolatedTotal = isolatedStats
                    ? isolatedStats.originTrips + isolatedStats.destinationTrips
                    : 0;
                const pulseSize = sqrtRadius(isolatedTotal, maxTotal) * 2 * 2.5;
                const pulseRing = L.marker([isolatedGeo.lat, isolatedGeo.lon], {
                    pane: 'od-pulse',
                    icon: L.divIcon({
                        className: '',
                        html: `<div class="od-pulse-ring" style="width:${pulseSize}px;height:${pulseSize}px;background:rgba(139,92,246,0.4);"></div>`,
                        iconSize: [pulseSize, pulseSize],
                        iconAnchor: [pulseSize / 2, pulseSize / 2],
                    }),
                    interactive: false,
                    keyboard: false,
                });
                pulseRing.addTo(layersRef.current);
            }
        }

        // Render station markers (clustered or individual)
        clusters.forEach((cluster) => {
            const isSingleStation = cluster.names.length === 1;
            const stationName = cluster.names[0];
            const isIsolated = isSingleStation && isolatedStation === stationName;
            const size = Math.max(10, Math.round(sqrtRadius(cluster.totalTrips, maxTotal) * 2));

            const marker = L.marker([cluster.lat, cluster.lon], {
                pane: 'od-stops',
                icon: L.divIcon({
                    className: '',
                    html: splitColorSvg(cluster.originTrips, cluster.destinationTrips, size, isIsolated),
                    iconSize: [size, size],
                    iconAnchor: [size / 2, size / 2],
                }),
                zIndexOffset: isIsolated ? 1000 : 0,
            });

            if (isSingleStation) {
                marker.bindTooltip(
                    `${stationName}<br/>Origin: ${cluster.originTrips.toLocaleString()} | Destination: ${cluster.destinationTrips.toLocaleString()}`,
                    { sticky: true, direction: 'top', opacity: 0.95 }
                );
                marker.on('click', () => {
                    setIsolatedStation((prev) => (prev === stationName ? null : stationName));
                });
                marker.on('contextmenu', (e) => {
                    const mouseEvent = e as L.LeafletMouseEvent;
                    setContextMenu({ x: mouseEvent.containerPoint.x, y: mouseEvent.containerPoint.y, station: stationName });
                });
            } else {
                marker.bindTooltip(
                    `${cluster.names.length} stations<br/>${cluster.names.slice(0, 4).join(', ')}${cluster.names.length > 4 ? '...' : ''}`,
                    { sticky: true, direction: 'top', opacity: 0.95 }
                );
                marker.on('click', () => {
                    const zoom = mapRef.current?.getZoom() ?? 8;
                    mapRef.current?.flyTo([cluster.lat, cluster.lon], zoom + 2);
                });
            }

            marker.addTo(layersRef.current!);
            coords.push([cluster.lat, cluster.lon]);
        });

        // Station name labels — label every visible station, but skip if another labeled
        // stop is within 35px on screen (the busiest stop wins since stationList is
        // sorted by totalTrips descending).
        const labeledStopPx: { x: number; y: number }[] = [];
        stationList.forEach((station) => {
            const stationPx = mapRef.current!.latLngToContainerPoint(
                L.latLng(station.geo.lat, station.geo.lon)
            );
            if (hasCollision(stationPx, labeledStopPx, 35)) return;
            labeledStopPx.push(stationPx);

            const nameLabel = L.marker([station.geo.lat, station.geo.lon], {
                pane: 'od-stop-labels',
                icon: L.divIcon({
                    className: 'od-label-icon',
                    html: `<div style="font-size:10px;font-weight:600;color:#1e293b;white-space:nowrap;pointer-events:none;background:rgba(255,255,255,0.84);border-radius:4px;padding:1px 5px;box-shadow:0 1px 3px rgba(0,0,0,0.12);transform:translate(10px,-50%)">${truncateLabel(station.name)}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                }),
                interactive: false,
                keyboard: false,
            });
            nameLabel.addTo(layersRef.current!);
        });

        const rankedPairs = displayedPairs.map((pair, index) => ({ pair, rank: index + 1 }));
        // Always label up to 25 routes — every visible pair gets a number
        const labelCap = Math.min(rankedPairs.length, 25);
        const maxJourneys = displayedPairs.length > 0 ? displayedPairs[0].journeys : 1;

        // Pass 1: Draw arcs (lower ranks first so top ranks render on top).
        const arcsByRank = new Map<number, [number, number][]>();
        rankedPairs.slice().reverse().forEach(({ pair, rank }) => {
            const originGeo = geoLookup[pair.origin];
            const destinationGeo = geoLookup[pair.destination];
            if (!originGeo || !destinationGeo) return;

            const arc = quadraticBezierArc(
                [originGeo.lat, originGeo.lon],
                [destinationGeo.lat, destinationGeo.lon],
                rank % 2 === 0 ? 1 : -1
            );
            arcsByRank.set(rank, arc);

            const line = L.polyline(arc, {
                pane: 'od-lines',
                color: rankColor(rank - 1),
                weight: volumeWeight(pair.journeys, maxJourneys),
                opacity: 0.68,
                lineCap: 'round',
            });

            line.bindPopup(`
                <div style="min-width:190px">
                    <div style="font-weight:600">${pair.origin} → ${pair.destination}</div>
                    <div style="color:#555;margin-top:3px">${pair.journeys.toLocaleString()} trips</div>
                    <div style="color:#777;margin-top:2px">Rank #${rank}</div>
                </div>
            `);
            line.addTo(layersRef.current!);
        });

        // Pass 2: Place rank labels — every pair up to labelCap gets a number.
        // When the ideal arc-midpoint position collides with an existing label, the label
        // is nudged to the nearest free spot and a dashed leader line connects it back.
        const placedLabelPositions: { x: number; y: number }[] = [];
        rankedPairs.forEach(({ rank }) => {
            if (rank > labelCap) return;
            const arc = arcsByRank.get(rank);
            if (!arc) return;

            const mid = arc[Math.floor(arc.length * 0.55)] || arc[Math.floor(arc.length / 2)];
            const idealPx = mapRef.current!.latLngToContainerPoint(L.latLng(mid[0], mid[1]));
            const labelPx = findNonCollidingPosition(idealPx, placedLabelPositions, LABEL_COLLISION_RADIUS, 65);
            if (labelPx === null) return; // No clean slot within 65px — skip rather than float label far away
            placedLabelPositions.push(labelPx);

            // Draw a dashed leader line when the label was nudged off the arc
            const offsetDist = Math.hypot(labelPx.x - idealPx.x, labelPx.y - idealPx.y);
            if (offsetDist > 3) {
                const arcLatLng = L.latLng(mid[0], mid[1]);
                const labelLatLng = mapRef.current!.containerPointToLatLng(L.point(labelPx.x, labelPx.y));
                L.polyline([arcLatLng, labelLatLng], {
                    pane: 'od-rank-labels',
                    color: '#1e3a8a',
                    weight: 2,
                    opacity: 0.6,
                    dashArray: '5 4',
                }).addTo(layersRef.current!);
            }

            const sz = labelSize(rank);
            const labelLatLng = mapRef.current!.containerPointToLatLng(L.point(labelPx.x, labelPx.y));
            const label = L.marker(labelLatLng, {
                pane: 'od-rank-labels',
                icon: L.divIcon({
                    className: '',
                    html: `<svg width="${sz}" height="${sz}" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="${sz/2}" cy="${sz/2}" r="${sz/2 - 1}"
                            fill="${labelBackground(rank)}"
                            stroke="rgba(255,255,255,${rank <= 3 ? 0.95 : 0.8})"
                            stroke-width="${rank <= 3 ? 2 : 1}"
                            opacity="${labelOpacity(rank)}"/>
                        <text x="${sz/2}" y="${sz/2}"
                            text-anchor="middle" dominant-baseline="central"
                            fill="white" font-size="${rank <= 3 ? 11 : 10}"
                            font-weight="700" font-family="sans-serif"
                            opacity="${labelOpacity(rank)}">${rank}</text>
                    </svg>`,
                    iconSize: [sz, sz],
                    iconAnchor: [sz / 2, sz / 2],
                }),
                interactive: false,
                keyboard: false,
                zIndexOffset: 10000 - rank,
            });
            label.addTo(layersRef.current!);
        });

    }, [displayedPairs, geoLookup, isolatedStation, topNOption, currentZoom]);

    useEffect(() => {
        renderLayers();
    }, [renderLayers]);

    // Auto-fit to data extent only when the dataset changes, not on every zoom.
    useEffect(() => {
        if (!mapRef.current || displayedPairs.length === 0) return;
        const coords: L.LatLngTuple[] = [];
        displayedPairs.forEach((pair) => {
            const og = geoLookup[pair.origin];
            const dg = geoLookup[pair.destination];
            if (og) coords.push([og.lat, og.lon]);
            if (dg) coords.push([dg.lat, dg.lon]);
        });
        const unique = coords.filter(
            (c, i, arr) => arr.findIndex((o) => o[0] === c[0] && o[1] === c[1]) === i
        );
        if (unique.length > 1) {
            mapRef.current.fitBounds(L.latLngBounds(unique), { padding: [32, 32], maxZoom: 13.75 });
        } else if (unique.length === 1) {
            mapRef.current.setView(unique[0], 11.5);
        } else {
            mapRef.current.setView(ONTARIO_CENTER, 6);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayedPairs, geoLookup]);

    useEffect(() => {
        if (viewMode !== 'map' || !mapRef.current) return;
        const timer = setTimeout(() => mapRef.current?.invalidateSize(), 80);
        return () => clearTimeout(timer);
    }, [viewMode, isFullscreen]);

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

    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 uppercase tracking-wide">Pairs</label>
                        <select
                            value={topNOption}
                            onChange={(e) => {
                                const v = e.target.value;
                                setTopNOption(v === 'all' ? 'all' : Number(v) as TopNOption);
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
                            onChange={(e) => setMinJourneys(Number(e.target.value))}
                            className="w-28 accent-gray-900"
                        />
                        <span className="text-sm font-medium text-gray-700 w-14 text-right">{minJourneys.toLocaleString()}</span>
                    </div>

                    <div className={`flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden bg-white ${!isolatedStation ? 'opacity-50' : ''}`}>
                        {(['all', 'outbound', 'inbound'] as const).map(dir => (
                            <button
                                key={dir}
                                onClick={() => setDirectionFilter(dir)}
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
                                            setIsolatedStation(name);
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
                                onClick={() => setIsolatedStation(null)}
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
                        <div className="mb-3 px-4 py-2.5 border border-amber-200 bg-amber-50 text-amber-700 text-sm rounded-lg">
                            {ungeocodedCount} station{ungeocodedCount === 1 ? '' : 's'} still missing coordinates.
                            {onFixMissingCoordinates && (
                                <button
                                    onClick={onFixMissingCoordinates}
                                    className="ml-2 underline font-medium hover:text-amber-800"
                                >
                                    Fix coordinates
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
                                ref={mapContainerRef}
                                className="rounded-lg overflow-hidden border border-gray-200"
                                style={{ height: isFullscreen ? 'calc(100vh - 220px)' : 560 }}
                            />
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
                                            setIsolatedStation(contextMenu.station);
                                            setDirectionFilter('outbound');
                                            setContextMenu(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                                    >
                                        Outbound only
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsolatedStation(contextMenu.station);
                                            setDirectionFilter('inbound');
                                            setContextMenu(null);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-gray-600 hover:bg-gray-50"
                                    >
                                        Inbound only
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsolatedStation(null);
                                            setDirectionFilter('all');
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
                                    Stop OD summary for <span className="font-semibold text-gray-800">{isolatedStation}</span> · {isolatedSummaryPairs.length} pair{isolatedSummaryPairs.length === 1 ? '' : 's'} (min journeys filter applied)
                                </span>
                                {isolatedSummaryPairs.length > 0 && (
                                    <button
                                        onClick={() => exportStopReportExcel(data, isolatedStation)}
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

                    <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50/70">
                        <span className="flex items-center gap-1.5">
                            <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
                                <path d="M2,7 A5,5 0 0,0 12,7 Z" fill="#10b981" />
                                <path d="M2,7 A5,5 0 0,1 12,7 Z" fill="#ef4444" />
                                <circle cx="7" cy="7" r="5" fill="none" stroke="white" strokeWidth="1.5" />
                            </svg>
                            Green = origin trips, Red = destination trips
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-14 h-2 rounded" style={{ background: `linear-gradient(to right, ${ARC_COLORS[0]}, ${ARC_COLORS[3]}, ${ARC_COLORS[5]}, #94a3b8)` }} />
                            Arc color: rank #1 (dark blue) → lower ranks (slate)
                        </span>
                        <span className="flex items-center gap-1.5">
                            <svg width="36" height="10" viewBox="0 0 36 10" className="shrink-0">
                                <line x1="0" y1="2.5" x2="36" y2="2.5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
                                <line x1="0" y1="7.5" x2="36" y2="7.5" stroke="#6b7280" strokeWidth="4" strokeLinecap="round" />
                            </svg>
                            Arc width = trip volume
                        </span>
                        <span className="flex items-center gap-1.5 text-gray-400">
                            Right-click stop for direction filter
                        </span>
                    </div>
                </ChartCard>
            </div>
        </div>
    );
};
