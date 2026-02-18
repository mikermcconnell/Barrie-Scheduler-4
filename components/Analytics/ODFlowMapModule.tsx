/**
 * OD Flow Map Module
 *
 * Leaflet map with station markers and flow lines between OD pairs.
 * Raw Leaflet via useRef/useEffect (no react-leaflet) for React 19 compat.
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertTriangle } from 'lucide-react';
import { ChartCard } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache, GeocodedLocation } from '../../utils/od-matrix/odMatrixTypes';

interface ODFlowMapModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
}

const ONTARIO_CENTER: [number, number] = [46.5, -80.5];

export const ODFlowMapModule: React.FC<ODFlowMapModuleProps> = ({ data, geocodeCache }) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const layersRef = useRef<L.LayerGroup | null>(null);

    const [topN, setTopN] = useState(50);
    const [minJourneys, setMinJourneys] = useState(0);
    const [isolatedStation, setIsolatedStation] = useState<string | null>(null);

    // Build geocode lookup from cache or station data
    const geoLookup = useMemo((): Record<string, GeocodedLocation> => {
        const lookup: Record<string, GeocodedLocation> = {};

        // From geocode cache
        if (geocodeCache?.stations) {
            Object.entries(geocodeCache.stations).forEach(([name, loc]) => {
                lookup[name] = loc;
            });
        }

        // From station geocode fields (may override cache)
        data.stations.forEach(s => {
            if (s.geocode) {
                lookup[s.name] = s.geocode;
            }
        });

        return lookup;
    }, [data.stations, geocodeCache]);

    const geocodedCount = useMemo(() => Object.keys(geoLookup).length, [geoLookup]);
    const ungeocodedCount = data.stationCount - geocodedCount;

    // Filter pairs based on controls
    const visiblePairs = useMemo(() => {
        let pairs = [...data.topPairs];

        if (isolatedStation) {
            pairs = data.pairs.filter(
                p => p.origin === isolatedStation || p.destination === isolatedStation
            ).sort((a, b) => b.journeys - a.journeys);
        }

        if (minJourneys > 0) {
            pairs = pairs.filter(p => p.journeys >= minJourneys);
        }

        // Only include pairs where both stations are geocoded
        pairs = pairs.filter(p => geoLookup[p.origin] && geoLookup[p.destination]);

        return pairs.slice(0, topN);
    }, [data.topPairs, data.pairs, topN, minJourneys, isolatedStation, geoLookup]);

    const maxJourneys = useMemo(() => {
        if (visiblePairs.length === 0) return 1;
        return visiblePairs[0].journeys;
    }, [visiblePairs]);

    // Initialize map
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        mapRef.current = L.map(mapContainerRef.current, {
            zoomSnap: 0.25,
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

    // Render markers and lines
    const renderLayers = useCallback(() => {
        if (!mapRef.current || !layersRef.current) return;
        layersRef.current.clearLayers();

        const stationMarkers = new Map<string, L.CircleMarker>();

        // Add station markers
        data.stations.forEach(station => {
            const geo = geoLookup[station.name];
            if (!geo) return;

            const radius = Math.max(4, Math.min(15, Math.log(station.totalVolume + 1) * 1.5));
            const isIsolated = isolatedStation === station.name;

            const marker = L.circleMarker([geo.lat, geo.lon], {
                radius,
                fillColor: isIsolated ? '#7c3aed' : '#6366f1',
                fillOpacity: isIsolated ? 0.9 : 0.7,
                color: isIsolated ? '#4c1d95' : '#4338ca',
                weight: isIsolated ? 3 : 1,
            });

            marker.bindPopup(`
                <div style="min-width:150px">
                    <strong>${station.name}</strong><br/>
                    <span style="color:#666">Origin: ${station.totalOrigin.toLocaleString()}</span><br/>
                    <span style="color:#666">Destination: ${station.totalDestination.toLocaleString()}</span><br/>
                    <span style="color:#666">Total: ${station.totalVolume.toLocaleString()}</span>
                </div>
            `);

            marker.on('click', () => {
                setIsolatedStation(prev => prev === station.name ? null : station.name);
            });

            marker.addTo(layersRef.current!);
            stationMarkers.set(station.name, marker);
        });

        // Add flow lines
        visiblePairs.forEach(pair => {
            const originGeo = geoLookup[pair.origin];
            const destGeo = geoLookup[pair.destination];
            if (!originGeo || !destGeo) return;

            const intensity = pair.journeys / maxJourneys;
            const weight = Math.max(1, Math.min(8, intensity * 8));
            const opacity = Math.max(0.2, Math.min(0.7, intensity * 0.7));

            const line = L.polyline(
                [[originGeo.lat, originGeo.lon], [destGeo.lat, destGeo.lon]],
                {
                    color: '#7c3aed',
                    weight,
                    opacity,
                    dashArray: undefined,
                }
            );

            line.bindPopup(`
                <div style="min-width:180px">
                    <strong>${pair.origin}</strong> → <strong>${pair.destination}</strong><br/>
                    <span style="color:#666">${pair.journeys.toLocaleString()} journeys</span>
                </div>
            `);

            line.addTo(layersRef.current!);
        });

        // Fit bounds to geocoded stations
        const coords = data.stations
            .map(s => geoLookup[s.name])
            .filter((g): g is GeocodedLocation => !!g)
            .map(g => [g.lat, g.lon] as [number, number]);

        if (coords.length > 1) {
            mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
        } else if (coords.length === 1) {
            mapRef.current.setView(coords[0], 10);
        }
    }, [data.stations, visiblePairs, geoLookup, maxJourneys, isolatedStation]);

    useEffect(() => {
        renderLayers();
    }, [renderLayers]);

    if (geocodedCount === 0) {
        return (
            <ChartCard title="Flow Map" subtitle="Geographic visualization of travel flows">
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <AlertTriangle size={32} className="mb-3 text-amber-400" />
                    <p className="font-medium text-gray-600">No Geocoded Stations</p>
                    <p className="text-sm mt-1">Re-import with geocoding enabled to see the flow map.</p>
                </div>
            </ChartCard>
        );
    }

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-500 font-medium">Top pairs:</label>
                    <input
                        type="range"
                        min={10}
                        max={200}
                        step={10}
                        value={topN}
                        onChange={(e) => setTopN(Number(e.target.value))}
                        className="w-32 accent-violet-500"
                    />
                    <span className="text-sm font-medium text-gray-700 w-8">{topN}</span>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-500 font-medium">Min journeys:</label>
                    <input
                        type="range"
                        min={0}
                        max={Math.floor(maxJourneys / 2)}
                        step={Math.max(1, Math.floor(maxJourneys / 100))}
                        value={minJourneys}
                        onChange={(e) => setMinJourneys(Number(e.target.value))}
                        className="w-32 accent-violet-500"
                    />
                    <span className="text-sm font-medium text-gray-700 w-16">{minJourneys.toLocaleString()}</span>
                </div>
                {isolatedStation && (
                    <button
                        onClick={() => setIsolatedStation(null)}
                        className="px-3 py-1 text-xs bg-violet-100 text-violet-700 rounded-full font-medium hover:bg-violet-200 transition-colors"
                    >
                        Showing: {isolatedStation} &times;
                    </button>
                )}
                {ungeocodedCount > 0 && (
                    <span className="text-xs text-amber-500">
                        {ungeocodedCount} station{ungeocodedCount !== 1 ? 's' : ''} not geocoded
                    </span>
                )}
            </div>

            {/* Map */}
            <ChartCard
                title="Flow Map"
                subtitle={`${visiblePairs.length} flow lines · ${geocodedCount} geocoded stations · click station to isolate`}
            >
                <div
                    ref={mapContainerRef}
                    className="rounded-lg overflow-hidden"
                    style={{ height: 600 }}
                />
            </ChartCard>
        </div>
    );
};
