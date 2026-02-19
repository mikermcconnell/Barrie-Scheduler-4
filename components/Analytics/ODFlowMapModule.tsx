/**
 * OD Flow Map Module
 *
 * Transit-style OD map for matrix data:
 * - Curved rank-colored arcs
 * - Origin/destination zone markers
 * - Simple control bar + map/table toggle
 * - Ontario guardrails for bad coordinates
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle } from 'lucide-react';
import { ChartCard } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';
import { isWithinOntario } from '../../utils/od-matrix/odMatrixGeocoder';

interface ODFlowMapModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
}

type ViewMode = 'map' | 'table';

const ONTARIO_CENTER: [number, number] = [46.5, -80.5];
const TOP_RANK_COLORS = ['#dc2626', '#ea580c', '#f97316', '#eab308', '#84cc16', '#22c55e', '#16a34a'];
const RANK_LABEL_CAP_ALL_ZONES = 60;

function rankColor(rank: number): string {
    if (rank < TOP_RANK_COLORS.length) return TOP_RANK_COLORS[rank];
    const greyRank = rank - TOP_RANK_COLORS.length;
    const t = Math.min(greyRank / 18, 1);
    const r = Math.round(55 + t * 101);
    const g = Math.round(65 + t * 98);
    const b = Math.round(81 + t * 94);
    return `rgb(${r},${g},${b})`;
}

function rankWeight(rank: number): number {
    if (rank < TOP_RANK_COLORS.length) return 10 - rank;
    const t = Math.min((rank - TOP_RANK_COLORS.length) / 18, 1);
    return 4.5 - t * 2.5;
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

export const ODFlowMapModule: React.FC<ODFlowMapModuleProps> = ({ data, geocodeCache }) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layersRef = useRef<L.LayerGroup | null>(null);

    const [viewMode, setViewMode] = useState<ViewMode>('map');
    const [topN, setTopN] = useState(20);
    const [allZones, setAllZones] = useState(false);
    const [minJourneys, setMinJourneys] = useState(1);
    const [isolatedStation, setIsolatedStation] = useState<string | null>(null);

    const { geoLookup, outsideOntarioStations } = useMemo((): {
        geoLookup: Record<string, GeocodedLocation>;
        outsideOntarioStations: string[];
    } => {
        const lookup: Record<string, GeocodedLocation> = {};
        const outside = new Set<string>();

        if (geocodeCache?.stations) {
            Object.entries(geocodeCache.stations).forEach(([name, loc]) => {
                if (isWithinOntario(loc.lat, loc.lon)) lookup[name] = loc;
                else outside.add(name);
            });
        }

        data.stations.forEach((station) => {
            if (!station.geocode) return;
            if (isWithinOntario(station.geocode.lat, station.geocode.lon)) lookup[station.name] = station.geocode;
            else outside.add(station.name);
        });

        return {
            geoLookup: lookup,
            outsideOntarioStations: Array.from(outside).sort(),
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
        }
        return pairs;
    }, [geocodedPairs, minJourneys, isolatedStation]);

    const displayedPairs = useMemo(() => {
        if (allZones) return filteredPairs;
        return filteredPairs.slice(0, topN);
    }, [filteredPairs, allZones, topN]);

    const displayedTrips = useMemo(() => (
        displayedPairs.reduce((sum, pair) => sum + pair.journeys, 0)
    ), [displayedPairs]);

    const displayedPct = data.totalJourneys > 0
        ? (displayedTrips / data.totalJourneys) * 100
        : 0;
    const maxPairs = Math.max(1, Math.min(500, geocodedPairs.length));

    useEffect(() => {
        if (topN > maxPairs) setTopN(maxPairs);
        if (topN < 1) setTopN(1);
    }, [topN, maxPairs]);

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
        }).addTo(mapRef.current);

        layersRef.current = L.layerGroup().addTo(mapRef.current);

        return () => {
            mapRef.current?.remove();
            mapRef.current = null;
            layersRef.current = null;
        };
    }, []);

    const renderLayers = useCallback(() => {
        if (!mapRef.current || !layersRef.current) return;
        layersRef.current.clearLayers();

        const zoneStats = new Map<string, { originTrips: number; destinationTrips: number }>();
        displayedPairs.forEach((pair) => {
            const originStats = zoneStats.get(pair.origin) || { originTrips: 0, destinationTrips: 0 };
            originStats.originTrips += pair.journeys;
            zoneStats.set(pair.origin, originStats);

            const destinationStats = zoneStats.get(pair.destination) || { originTrips: 0, destinationTrips: 0 };
            destinationStats.destinationTrips += pair.journeys;
            zoneStats.set(pair.destination, destinationStats);
        });

        const coords: [number, number][] = [];

        Array.from(zoneStats.entries()).forEach(([stationName, stats]) => {
            const geo = geoLookup[stationName];
            if (!geo) return;

            const total = stats.originTrips + stats.destinationTrips;
            const radius = Math.max(5, Math.min(16, 4 + Math.log10(total + 1) * 3));
            const isOrigin = stats.originTrips > 0;
            const isDestination = stats.destinationTrips > 0;
            const isIsolated = isolatedStation === stationName;

            const fillColor = isOrigin && isDestination
                ? '#f97316'
                : isOrigin
                    ? '#10b981'
                    : '#ef4444';

            const marker = L.circleMarker([geo.lat, geo.lon], {
                radius,
                fillColor,
                fillOpacity: isIsolated ? 0.95 : 0.8,
                color: isIsolated ? '#111827' : '#ffffff',
                weight: isIsolated ? 2.5 : 1.25,
            });

            marker.bindTooltip(
                `${stationName}<br/>Origin: ${stats.originTrips.toLocaleString()} | Destination: ${stats.destinationTrips.toLocaleString()}`,
                { sticky: true, direction: 'top', opacity: 0.95 }
            );
            marker.on('click', () => {
                setIsolatedStation((prev) => (prev === stationName ? null : stationName));
            });

            marker.addTo(layersRef.current!);
            coords.push([geo.lat, geo.lon]);
        });

        const rankedPairs = displayedPairs.map((pair, index) => ({ pair, rank: index + 1 }));
        const labelCap = allZones ? Math.min(RANK_LABEL_CAP_ALL_ZONES, rankedPairs.length) : rankedPairs.length;

        // Draw lower-ranked lines first, then higher-ranked lines so #1 is visually on top.
        rankedPairs.slice().reverse().forEach(({ pair, rank }) => {
            const originGeo = geoLookup[pair.origin];
            const destinationGeo = geoLookup[pair.destination];
            if (!originGeo || !destinationGeo) return;

            const arc = quadraticBezierArc(
                [originGeo.lat, originGeo.lon],
                [destinationGeo.lat, destinationGeo.lon],
                rank % 2 === 0 ? 1 : -1
            );

            const line = L.polyline(arc, {
                color: rankColor(rank - 1),
                weight: rankWeight(rank - 1),
                opacity: 0.78,
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

            if (rank <= labelCap) {
                const mid = arc[Math.floor(arc.length * 0.55)] || arc[Math.floor(arc.length / 2)];
                const label = L.marker(mid, {
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="
                            width:20px;height:20px;border-radius:9999px;
                            background:#111827;color:#fff;font-size:11px;font-weight:700;
                            display:flex;align-items:center;justify-content:center;
                            border:1px solid rgba(255,255,255,0.9);box-shadow:0 1px 2px rgba(0,0,0,0.25);
                        ">${rank}</div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10],
                    }),
                    interactive: false,
                    keyboard: false,
                    zIndexOffset: 10000 - rank,
                });
                label.addTo(layersRef.current!);
            }
        });

        if (coords.length > 1) {
            mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [32, 32], maxZoom: 13.75 });
        } else if (coords.length === 1) {
            mapRef.current.setView(coords[0], 11.5);
        } else {
            mapRef.current.setView(ONTARIO_CENTER, 6);
        }
    }, [displayedPairs, geoLookup, isolatedStation, allZones]);

    useEffect(() => {
        renderLayers();
    }, [renderLayers]);

    useEffect(() => {
        if (viewMode !== 'map' || !mapRef.current) return;
        const timer = setTimeout(() => mapRef.current?.invalidateSize(), 80);
        return () => clearTimeout(timer);
    }, [viewMode]);

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
                        <input
                            type="range"
                            min={1}
                            max={maxPairs}
                            step={1}
                            value={Math.min(topN, maxPairs)}
                            onChange={(e) => setTopN(Number(e.target.value))}
                            disabled={allZones || geocodedPairs.length === 0}
                            className="w-28 accent-gray-900 disabled:opacity-50"
                        />
                        <span className="text-sm font-medium text-gray-700 w-10 text-right">{allZones ? 'All' : topN}</span>
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

                    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                        <input
                            type="checkbox"
                            checked={allZones}
                            onChange={(e) => setAllZones(e.target.checked)}
                            className="accent-gray-900"
                        />
                        All zones
                    </label>

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
                        <button
                            onClick={() => setIsolatedStation(null)}
                            className="ml-2 text-violet-600 hover:text-violet-800 underline"
                        >
                            showing: {isolatedStation} (clear)
                        </button>
                    )}
                </div>
            </div>

            <ChartCard
                title="Origin-Destination Map"
                subtitle={`${displayedPairs.length.toLocaleString()} flow lines · ${geocodedCount.toLocaleString()} geocoded stations`}
            >
                {outsideOntarioStations.length > 0 && (
                    <div className="mb-3 px-4 py-3 border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg">
                        Out-of-Ontario coordinates excluded: {outsideOntarioStations.slice(0, 8).join(', ')}
                        {outsideOntarioStations.length > 8 ? ', ...' : ''}. Re-import and enter manual Ontario coordinates.
                    </div>
                )}

                {ungeocodedCount > 0 && (
                    <div className="mb-3 px-4 py-2.5 border border-amber-200 bg-amber-50 text-amber-700 text-sm rounded-lg">
                        {ungeocodedCount} station{ungeocodedCount === 1 ? '' : 's'} still missing coordinates.
                    </div>
                )}

                {displayedPairs.length === 0 && (
                    <div className="mb-3 px-4 py-2.5 border border-amber-200 bg-amber-50 text-amber-700 text-sm rounded-lg">
                        No OD flows match current filters.
                    </div>
                )}

                {viewMode === 'map' ? (
                    <div
                        ref={mapContainerRef}
                        className="rounded-lg overflow-hidden border border-gray-200"
                        style={{ height: 560 }}
                    />
                ) : (
                    <div className="max-h-[560px] overflow-auto border border-gray-200 rounded-lg">
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
                )}

                <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50/70">
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 border border-white shadow-sm" /> Origin zone
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow-sm" /> Destination zone
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-orange-500 border border-white shadow-sm" /> Mixed zone
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-12 h-2 rounded" style={{ background: 'linear-gradient(to right, #bfdbfe, #06b6d4, #f97316, #ef4444)' }} />
                        Arc color: lower rank to higher rank
                    </span>
                </div>
            </ChartCard>
        </div>
    );
};
